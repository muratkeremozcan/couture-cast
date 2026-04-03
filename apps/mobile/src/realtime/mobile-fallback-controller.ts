// Step 12 step 5 owner: searchable owner anchor
import { PollingService, type BaseEvent } from '@couture/api-client'

type MinimalSocket = { on: (event: string, callback: () => void) => void }

type Telemetry = (event: string, payload?: Record<string, unknown>) => void

/** Realtime fallback controller for mobile event streams.
 * Why this file exists:
 * - Realtime sockets are fast when they work, but mobile connectivity is not stable.
 * - If the socket drops, the app still needs a way to catch up on missed events.
 * - This file switches the app into polling mode until the socket reconnects.
 * Alternatives:
 * - Do nothing and wait for reconnect, which risks stale UI.
 * - Write a separate mobile-only polling loop, which would duplicate shared logic.
 * Flow (where we did this):
 *   1) listen for socket disconnects.
 *   2) start shared polling if it is not already running.
 *   3) stop polling as soon as the realtime socket reconnects.
 */
export function createMobileFallbackController(
  socket: MinimalSocket,
  fetcher: (
    since?: string
  ) => Promise<{ events: BaseEvent[]; nextSince?: string | null }>,
  telemetry: Telemetry = () => undefined
): { startPolling: () => void; stopPolling: () => void } {
  let polling: PollingService<BaseEvent> | null = null

  const stopPolling = () => {
    // 3) once realtime is healthy again, polling becomes redundant and should
    // be torn down so we do not double-fetch the same stream.
    if (polling) {
      polling.stop()
      polling = null
    }
  }

  const startPolling = () => {
    // 2) guard against duplicate pollers. Mobile reconnects can flap, so this
    // controller must remain idempotent.
    if (polling) return

    // Reuse the shared polling service so reconnect behavior stays consistent
    // with the API-client package instead of inventing a mobile-only loop.
    const instance = new PollingService<BaseEvent>({
      fetcher,
      onEvents: () => telemetry('polling_events_received'),
      onError: (err) => telemetry('polling_error', { err }),
      onActivate: () => telemetry('polling_activated'),
      onDeactivate: () => telemetry('polling_deactivated'),
    })
    polling = instance
    void instance.start()
  }

  // 1) socket events drive the fallback lifecycle instead of app code having
  // to remember when to toggle polling manually.
  socket.on('disconnect', startPolling)
  socket.on('connect', stopPolling)

  return { startPolling, stopPolling }
}
