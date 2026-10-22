/**
 * An abort or deadline error that exists on every runtime. Hermes has no DOMException
 * global, so code that can run on React Native builds a plain Error and callers branch on
 * `error.name`, never on `instanceof DOMException`.
 */
export function abortError(
  message: string,
  name: 'AbortError' | 'TimeoutError' = 'AbortError'
): Error {
  const error = new Error(message)
  error.name = name
  return error
}

/** Portable to React Native's AbortController polyfill. Each call owns its cleanup. */
export async function withRequestDeadline<T>(
  timeoutMs: number,
  signals: readonly (AbortSignal | null | undefined)[],
  request: (signal: AbortSignal) => Promise<T>
): Promise<T> {
  const controller = new AbortController()
  const listeners: { signal: AbortSignal; abort: () => void }[] = []
  let timer: ReturnType<typeof setTimeout> | undefined
  const cleanup = () => {
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
    for (const { signal, abort } of listeners) signal.removeEventListener('abort', abort)
    listeners.length = 0
  }
  const abort = (reason?: unknown) => {
    controller.abort(reason)
    cleanup()
  }
  for (const signal of signals) {
    if (!signal) continue
    if (signal.aborted) {
      abort(signal.reason)
      break
    }
    const listener = () => abort(signal.reason)
    listeners.push({ signal, abort: listener })
    signal.addEventListener('abort', listener, { once: true })
  }
  if (!controller.signal.aborted) timer = setTimeout(() => abort(), timeoutMs)
  try {
    return await request(controller.signal)
  } finally {
    cleanup()
  }
}
