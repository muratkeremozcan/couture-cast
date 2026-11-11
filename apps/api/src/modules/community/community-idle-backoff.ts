// Idle backoff owner: the cadence of every polling loop in both community worker compositions.

/**
 * How one polling loop paces itself.
 *
 * A loop runs at `baseMs` while it finds work.
 * Each tick that finds nothing doubles the delay, up to `idleCapMs`.
 * The first tick that finds work drops it back to `baseMs`.
 * `idleCapMs` is therefore the longest a loop that was idle can take to notice new work, and each
 * loop picks it from the latency bound its story sets.
 */
export interface IdleBackoffPolicy {
  readonly baseMs: number
  readonly idleCapMs: number
}

/**
 * What one tick reports.
 * `progressed` means the tick moved work forward: it claimed, delivered, appended or deleted
 * something, so more may be waiting.
 * `dueInMs` is the time until the earliest work the loop already knows about becomes due, read
 * from the database clock; an idle loop never sleeps past it.
 */
export interface LoopTick {
  readonly progressed: boolean
  readonly dueInMs?: number | null
}

export const IDLE_TICK: LoopTick = { progressed: false }
export const PROGRESS_TICK: LoopTick = { progressed: true }

/** A tick that counted items: any item counts as progress. */
export function tickFromCount(count: number): LoopTick {
  return count > 0 ? PROGRESS_TICK : IDLE_TICK
}

/**
 * The delay before the next tick.
 * A failed tick backs off like an idle one, so a dependency that keeps failing is retried at the
 * idle cap and is not hammered at the base cadence.
 */
export function nextLoopDelay(
  policy: IdleBackoffPolicy,
  previousMs: number,
  tick: LoopTick | 'failed'
): number {
  if (tick !== 'failed' && tick.progressed) return policy.baseMs
  const backedOff = Math.min(policy.idleCapMs, Math.max(policy.baseMs, previousMs * 2))
  if (tick === 'failed' || tick.dueInMs === undefined || tick.dueInMs === null)
    return backedOff
  return Math.min(backedOff, Math.max(policy.baseMs, Math.ceil(tick.dueInMs)))
}

export interface BackoffLoop {
  /** Runs the loop at once at its base cadence; used when a sibling loop just produced work. */
  wake(): void
  /** Cancels the pending tick; a running tick finishes and schedules nothing. */
  stop(): void
  /** The delay the loop scheduled last, for logs and tests. */
  readonly delayMs: number
}

/**
 * Runs `work` on the policy's cadence, never overlapping itself and never rejecting.
 * `track` receives every tick in flight, so a shutdown can wait for them.
 */
export function startBackoffLoop(options: {
  policy: IdleBackoffPolicy
  work: () => Promise<LoopTick>
  onError: (error: unknown) => void
  track?: (flight: Promise<unknown>) => void
}): BackoffLoop {
  const { policy, work, onError, track } = options
  let delayMs = policy.baseMs
  let timer: ReturnType<typeof setTimeout> | undefined
  let running = false
  let wakeRequested = false
  let stopped = false

  const schedule = (ms: number) => {
    if (stopped) return
    timer = setTimeout(tick, ms)
    timer.unref?.()
  }
  function tick() {
    timer = undefined
    running = true
    const flight = Promise.resolve()
      .then(work)
      .then(
        (result) => nextLoopDelay(policy, delayMs, result),
        (error: unknown) => {
          try {
            onError(error)
          } catch {
            // A failing logger must not stop the loop.
          }
          return nextLoopDelay(policy, delayMs, 'failed')
        }
      )
      .then((next) => {
        running = false
        delayMs = wakeRequested ? 0 : next
        wakeRequested = false
        schedule(delayMs)
        if (delayMs === 0) delayMs = policy.baseMs
      })
    track?.(flight)
  }
  schedule(delayMs)

  return {
    wake() {
      if (stopped) return
      if (running) {
        wakeRequested = true
        return
      }
      if (timer) clearTimeout(timer)
      delayMs = policy.baseMs
      schedule(0)
    },
    stop() {
      stopped = true
      if (timer) clearTimeout(timer)
      timer = undefined
    },
    get delayMs() {
      return delayMs
    },
  }
}
