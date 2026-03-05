/**
 * Story 0.5 (Task 5): client-side polling fallback.
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
  // 1) Start in realtime mode when socket connection is healthy.
  private timer: ReturnType<typeof setInterval> | null = null
  private since: string | undefined
  private readonly intervalMs: number

  constructor(private readonly options: PollingOptions<T>) {
    this.intervalMs = options.intervalMs ?? 30_000
  }

  async start(initialSince?: string) {
    // 2) When server emits fallback (or reconnect budget is exhausted), start polling.
    if (this.timer) return
    this.since = initialSince
    this.options.onActivate?.()
    await this.tick()
    this.timer = setInterval(() => {
      void this.tick()
    }, this.intervalMs)
  }

  stop() {
    // 4) Stop polling when realtime recovers.
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
      // Signals callers that fallback mode is no longer active.
      this.options.onDeactivate?.()
    }
  }

  private async tick() {
    // 3) Track nextSince cursor to fetch only new events.
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
