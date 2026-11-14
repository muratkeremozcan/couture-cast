/**
 * One unit of background work runs inside a headless JS task, so React Native keeps JS timers
 * running for it in a process with no resumed Activity (see HeadlessJsTimersModule.kt). The native
 * side starts the task; the task's JS body waits here until the work ends.
 */
export const HEADLESS_TIMERS_TASK_KEY = 'CoutureCastHeadlessJsTimers'
/** WorkManager stops a worker after 10 minutes; the timers scope ends before that at the latest. */
export const HEADLESS_TIMERS_TIMEOUT_MS = 9 * 60 * 1000

type HeadlessTask = (data: { scope?: number }) => Promise<void>

export type HeadlessTimersNative = {
  begin(scope: number, timeoutMs: number): Promise<number | null>
}

export function createHeadlessTimers(
  native: HeadlessTimersNative | null,
  registerHeadlessTask: (key: string, provider: () => HeadlessTask) => void
) {
  const running = new Map<number, Promise<void>>()
  let nextScope = 1
  if (native)
    registerHeadlessTask(HEADLESS_TIMERS_TASK_KEY, () => async ({ scope }) => {
      // Work that ended before the task reached JS has nothing left to wait for.
      await (scope === undefined ? undefined : running.get(scope))
    })

  return async function withHeadlessJsTimers<T>(work: () => Promise<T>): Promise<T> {
    if (!native) return work()
    const scope = nextScope++
    let release: (() => void) | undefined
    running.set(
      scope,
      new Promise<void>((resolve) => {
        release = resolve
      })
    )
    try {
      try {
        await native.begin(scope, HEADLESS_TIMERS_TIMEOUT_MS)
      } catch (error) {
        // Without the scope the work still runs; it only waits longer for its timers.
        console.warn('[HeadlessJsTimers] could not start the timers scope', error)
      }
      return await work()
    } finally {
      release?.()
      running.delete(scope)
    }
  }
}
