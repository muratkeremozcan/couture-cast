export type PollingOptions<T> = {
  intervalMs?: number
  fetcher: (since?: string) => Promise<{ events: T[]; nextSince?: string | null }>
  onEvents: (events: T[]) => void
  onError?: (error: unknown) => void
  onActivate?: () => void
  onDeactivate?: () => void
}

export class PollingService<T> {
  private timer: ReturnType<typeof setInterval> | null = null
  private since: string | undefined
  private readonly intervalMs: number

  constructor(private readonly options: PollingOptions<T>) {
    this.intervalMs = options.intervalMs ?? 30_000
  }

  async start(initialSince?: string) {
    if (this.timer) return
    this.since = initialSince
    this.options.onActivate?.()
    await this.tick()
    this.timer = setInterval(() => {
      void this.tick()
    }, this.intervalMs)
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
      this.options.onDeactivate?.()
    }
  }

  private async tick() {
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
