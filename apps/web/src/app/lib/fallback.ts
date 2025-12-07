import { PollingService } from '@couture/api-client/realtime/polling-service'
import type { BaseEvent } from '@couture/api-client/types/socket-events'
type MinimalSocket = { on: (event: string, callback: () => void) => void }

type Telemetry = (event: string, payload?: Record<string, unknown>) => void

export function createFallbackController(
  socket: MinimalSocket,
  fetcher: (
    since?: string
  ) => Promise<{ events: BaseEvent[]; nextSince?: string | null }>,
  telemetry: Telemetry = () => undefined
): { startPolling: () => void; stopPolling: () => void } {
  let polling: PollingService<BaseEvent> | null = null

  const stopPolling = () => {
    if (polling) {
      polling.stop()
      polling = null
    }
  }

  const startPolling = () => {
    if (polling) return
    const instance = new PollingService<BaseEvent>({
      fetcher,
      onEvents: () => telemetry('polling_events_received'),
      onError: (err: unknown) => telemetry('polling_error', { err }),
      onActivate: () => telemetry('polling_activated'),
      onDeactivate: () => telemetry('polling_deactivated'),
    })
    polling = instance
    void instance.start()
  }

  socket.on('disconnect', startPolling)
  socket.on('connect', stopPolling)

  return { startPolling, stopPolling }
}
