import type { BaseEvent } from '@couture/api-client/types/socket-events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createFallbackController } from './fallback'

/**
 * `PollingService` polls on a fixed 30s interval that `createFallbackController`
 * does not expose, so the only way to observe a second poll (or prove polling
 * really stopped) is to drive the clock.
 */
beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

const POLL_INTERVAL_MS = 30_000

function fakeSocket() {
  const listeners = new Map<string, () => void>()
  return {
    socket: {
      on: (event: string, callback: () => void) => {
        listeners.set(event, callback)
      },
    },
    emit: (event: string) => {
      const listener = listeners.get(event)
      if (!listener) throw new Error(`No listener registered for "${event}"`)
      listener()
    },
    registeredEvents: () => [...listeners.keys()],
  }
}

function pollEvent(id: string): BaseEvent {
  return {
    eventId: id,
    userId: 'user-1',
    emittedAt: '2026-08-10T09:00:00.000Z',
  } as unknown as BaseEvent
}

describe('createFallbackController', () => {
  it('subscribes to both socket lifecycle events without polling up front', () => {
    const { socket, registeredEvents } = fakeSocket()
    const fetcher = vi.fn().mockResolvedValue({ events: [], nextSince: null })

    createFallbackController(socket, fetcher)

    expect(registeredEvents()).toEqual(expect.arrayContaining(['disconnect', 'connect']))
    // A healthy socket must not pay for polling.
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('starts polling on disconnect and advances the cursor on each poll', async () => {
    const { socket, emit } = fakeSocket()
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({
        events: [pollEvent('evt-1')],
        nextSince: '2026-08-10T09:00:01.000Z',
      })
      .mockResolvedValue({ events: [], nextSince: null })
    const telemetry = vi.fn()

    createFallbackController(socket, fetcher, telemetry)
    emit('disconnect')
    await vi.advanceTimersByTimeAsync(0)

    expect(telemetry).toHaveBeenCalledWith('polling_activated')
    expect(telemetry).toHaveBeenCalledWith('polling_events_received')
    expect(fetcher).toHaveBeenCalledWith(undefined)

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS)

    // Only unseen events: the second poll carries the cursor the first returned.
    expect(fetcher).toHaveBeenNthCalledWith(2, '2026-08-10T09:00:01.000Z')
  })

  /** An empty poll is the common case and must stay silent, not spam telemetry. */
  it('does not report received events when a poll returns nothing', async () => {
    const { socket, emit } = fakeSocket()
    const fetcher = vi.fn().mockResolvedValue({ events: [], nextSince: null })
    const telemetry = vi.fn()

    createFallbackController(socket, fetcher, telemetry)
    emit('disconnect')
    await vi.advanceTimersByTimeAsync(0)

    expect(telemetry).toHaveBeenCalledWith('polling_activated')
    expect(telemetry).not.toHaveBeenCalledWith('polling_events_received')
  })

  /**
   * A degraded poll endpoint must not take the fallback down with it: the whole
   * point of this controller is that the ritual keeps updating while the socket
   * is unavailable.
   */
  it('reports a failed poll and keeps polling', async () => {
    const { socket, emit } = fakeSocket()
    const failure = new Error('poll endpoint unavailable')
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(failure)
      .mockResolvedValue({ events: [], nextSince: null })
    const telemetry = vi.fn()

    createFallbackController(socket, fetcher, telemetry)
    emit('disconnect')
    await vi.advanceTimersByTimeAsync(0)

    expect(telemetry).toHaveBeenCalledWith('polling_error', { err: failure })

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS)
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('stops polling when the socket reconnects', async () => {
    const { socket, emit } = fakeSocket()
    const fetcher = vi.fn().mockResolvedValue({ events: [], nextSince: null })
    const telemetry = vi.fn()

    createFallbackController(socket, fetcher, telemetry)
    emit('disconnect')
    await vi.advanceTimersByTimeAsync(0)
    expect(fetcher).toHaveBeenCalledTimes(1)

    emit('connect')
    expect(telemetry).toHaveBeenCalledWith('polling_deactivated')

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  /**
   * Socket.io re-emits `disconnect` on every failed reconnect attempt. Without
   * the guard each one would stack another 30s poll loop on the same endpoint.
   */
  it('ignores repeated disconnects instead of stacking poll loops', async () => {
    const { socket, emit } = fakeSocket()
    const fetcher = vi.fn().mockResolvedValue({ events: [], nextSince: null })

    createFallbackController(socket, fetcher)
    emit('disconnect')
    emit('disconnect')
    emit('disconnect')
    await vi.advanceTimersByTimeAsync(0)

    expect(fetcher).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS)
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('treats a reconnect with no polling in flight as a no-op', async () => {
    const { socket, emit } = fakeSocket()
    const fetcher = vi.fn().mockResolvedValue({ events: [], nextSince: null })
    const telemetry = vi.fn()

    createFallbackController(socket, fetcher, telemetry)
    emit('connect')
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS)

    expect(telemetry).not.toHaveBeenCalled()
    expect(fetcher).not.toHaveBeenCalled()
  })

  /** Telemetry is optional wiring; polling must work without an analytics sink. */
  it('polls normally when no telemetry sink is supplied', async () => {
    const { socket, emit } = fakeSocket()
    const fetcher = vi
      .fn()
      .mockResolvedValue({ events: [pollEvent('evt-1')], nextSince: null })

    const controller = createFallbackController(socket, fetcher)
    emit('disconnect')
    await vi.advanceTimersByTimeAsync(0)

    expect(fetcher).toHaveBeenCalledTimes(1)
    controller.stopPolling()
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  /** The returned handles let a caller drive fallback without a socket event. */
  it('exposes start and stop handles that restart a fresh poll loop', async () => {
    const { socket } = fakeSocket()
    const fetcher = vi.fn().mockResolvedValue({ events: [], nextSince: null })
    const telemetry = vi.fn()

    const controller = createFallbackController(socket, fetcher, telemetry)

    controller.startPolling()
    await vi.advanceTimersByTimeAsync(0)
    controller.stopPolling()

    controller.startPolling()
    await vi.advanceTimersByTimeAsync(0)

    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(
      telemetry.mock.calls.filter(([name]) => name === 'polling_activated')
    ).toHaveLength(2)

    controller.stopPolling()
  })
})
