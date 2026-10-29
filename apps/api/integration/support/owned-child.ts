import {
  spawn,
  type ChildProcess,
  type SpawnOptionsWithoutStdio,
} from 'node:child_process'

/** A test owns exactly this child. Cleanup also runs when Vitest times out its body. */
export function ownedChild(input: {
  command: string
  args: string[]
  options?: SpawnOptionsWithoutStdio
  timeoutMs: number
  onFinished: (cleanup: () => Promise<void>) => void
  onOutput?: (output: string, child: ChildProcess) => void
}) {
  const child = spawn(input.command, input.args, {
    ...input.options,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  let failure: Error | undefined
  let closed = false
  let finish!: () => void
  const closure = new Promise<void>((resolve) => {
    finish = resolve
  })
  const stop = async () => {
    if (closed) return
    // SIGKILL bounds cleanup even when startup or a SIGTERM handler is stuck.
    if (child.pid) child.kill('SIGKILL')
    let deadline: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        closure,
        new Promise<never>((_, reject) => {
          deadline = setTimeout(
            () => reject(new Error('owned_child_cleanup_timeout')),
            2_000
          )
        }),
      ])
    } finally {
      clearTimeout(deadline)
    }
  }
  const result = new Promise<{
    code: number | null
    signal: NodeJS.Signals | null
    output: string
  }>((resolve, reject) => {
    const deadline = setTimeout(() => {
      failure = new Error('owned_child_lifecycle_timeout')
      if (child.pid) child.kill('SIGKILL')
    }, input.timeoutMs)
    child.once('error', (error) => {
      failure = error
    })
    const read = (chunk: Buffer) => {
      output += chunk.toString()
      try {
        input.onOutput?.(output, child)
      } catch (error) {
        failure = error instanceof Error ? error : new Error(String(error))
        child.kill('SIGKILL')
      }
    }
    child.stdout.on('data', read)
    child.stderr.on('data', read)
    child.once('close', (code, signal) => {
      closed = true
      clearTimeout(deadline)
      finish()
      if (failure) reject(failure)
      else resolve({ code, signal, output })
    })
  })
  // A timed-out test may no longer await result when cleanup closes its child.
  // Keep that rejection observed; callers still receive the original promise.
  void result.catch(() => undefined)
  input.onFinished(stop)
  return { child, result, stop }
}
