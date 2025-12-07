import { test, expect } from '../support/fixtures/merged-fixtures'
import { createFallbackController } from '../../apps/web/src/app/lib/fallback'
import type { BaseEvent } from '@couture/api-client'

process.env.API_E2E_UI_MODE = 'true'

class FakeSocket {
  private listeners: Record<string, (() => void)[]> = {}

  on(event: string, callback: () => void) {
    if (!this.listeners[event]) {
      this.listeners[event] = []
    }
    this.listeners[event].push(callback)
  }

  emit(event: string) {
    this.listeners[event]?.forEach((callback) => callback())
  }
}

test.describe('Realtime fallback', () => {
  test('[P1] switches to polling on disconnect and stops on reconnect', async () => {
    const socket = new FakeSocket()
    const telemetry: string[] = []
    const fetchCalls: (string | undefined)[] = []

    const sampleEvents: BaseEvent[] = [
      {
        version: 'v1',
        timestamp: '2025-01-02T00:00:00.000Z',
        userId: 'user-1',
        data: { message: 'alert' },
      },
    ]

    const controller = createFallbackController(
      socket,
      (since) => {
        fetchCalls.push(since)
        // First call returns a batch and nextSince, subsequent calls are empty
        if (since) return Promise.resolve({ events: [], nextSince: null })
        return Promise.resolve({
          events: sampleEvents,
          nextSince: sampleEvents[0]?.timestamp ?? null,
        })
      },
      (event) => telemetry.push(event)
    )

    socket.emit('disconnect')

    await expect.poll(() => fetchCalls.length).toBe(1)
    expect(telemetry).toContain('polling_activated')
    expect(telemetry).toContain('polling_events_received')

    socket.emit('connect')

    await expect.poll(() => telemetry.includes('polling_deactivated')).toBe(true)

    // Ensure no extra polling cycles fire after reconnect
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(fetchCalls.length).toBe(1)

    controller.stopPolling()
  })
})
