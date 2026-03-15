/**
 * Story 0.5 owner file: client-side polling fallback.
 *
 * Ritual context:
 * - In Couture Cast, a "ritual" is the user-facing daily outfit/alert experience.
 * - Realtime ritual streams currently exposed in-app are:
 *   1) `ritual:update` (scheduled/in-progress/completed lifecycle),
 *   2) `alert:weather` (conditions that affect today's outfit decisions),
 *   3) `lookbook:new` (fresh community inspiration tied to the ritual flow).
 * - These exist to keep recommendations timely, preserve trust in alerts, and sustain daily engagement.
 *
 * Why this exists:
 * - Realtime sockets can fail in constrained networks or prolonged offline conditions.
 * - Polling provides predictable eventual delivery without requiring persistent connections.
 *
 * Setup flow from client perspective:
 * 1) Start in realtime mode when socket connection is healthy.
 * 2) When server emits fallback (or reconnect budget is exhausted), start polling.
 * 3) Track nextSince cursor to fetch only new events.
 * 4) Stop polling when realtime recovers.
 *
 * Alternative:
 * - Realtime-only client behavior, which is lower complexity but less resilient for mobile/offline use.
 *
 * Ownership anchor:
 * - Story 0.5 Task 5 owner: activate, advance, and stop client polling when realtime is unavailable.
 *
 * Flow refs:
 * - S0.5/T2: server disconnect logic decides when the client should stop retrying.
 * - S0.5/T3: push can cover background delivery, but polling keeps foreground sync deterministic.
 */
export type PollingOptions<T> = {
  intervalMs?: number
  fetcher: (since?: string) => Promise<{ events: T[]; nextSince?: string | null }>
  onEvents: (events: T[]) => void
  onError?: (error: unknown) => void
  onActivate?: () => void
  onDeactivate?: () => void
}

export class PollingService<T> {
  // Flow ref S0.5/T5: start in realtime mode and keep polling idle until fallback is needed.
  private timer: ReturnType<typeof setInterval> | null = null
  private since: string | undefined
  private readonly intervalMs: number

  constructor(private readonly options: PollingOptions<T>) {
    this.intervalMs = options.intervalMs ?? 30_000
  }

  async start(initialSince?: string) {
    // Flow ref S0.5/T5: when server fallback is active, start polling.
    if (this.timer) return
    this.since = initialSince
    this.options.onActivate?.()
    await this.tick()
    this.timer = setInterval(() => {
      void this.tick()
    }, this.intervalMs)
  }

  stop() {
    // Flow ref S0.5/T5: stop polling when realtime recovers.
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
      // Signals callers that fallback mode is no longer active.
      this.options.onDeactivate?.()
    }
  }

  private async tick() {
    // Flow ref S0.5/T5: advance nextSince so each poll fetches only unseen events.
    try {
      const { events, nextSince } = await this.options.fetcher(this.since)
      if (events.length) {
        this.options.onEvents(events)
      }
      if (nextSince) {
        this.since = nextSince
      }
    } catch (error) {
      this.options.onError?.(error)
    }
  }
}
