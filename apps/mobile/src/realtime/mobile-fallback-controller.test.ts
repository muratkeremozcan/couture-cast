/* eslint-disable @typescript-eslint/unbound-method -- assertions read vi.fn() members off their mock object, which is the established pattern for these suites. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BaseEvent } from '@couture/api-client'

import { createMobileFallbackController } from './mobile-fallback-controller'

/**
 * PollingService defaults to a 30s interval and the controller does not override
 * it, so every assertion about a *subsequent* poll has to drive the clock.
 */
const POLL_INTERVAL_MS = 30_000

function fakeSocket() {
  const handlers = new Map<string, (() => void)[]>()
  return {
    socket: {
      on(event: string, callback: () => void) {
        handlers.set(event, [...(handlers.get(event) ?? []), callback])
      },
    },
    emit(event: string) {
      for (const handler of handlers.get(event) ?? []) {
        handler()
      }
    },
  }
}

function ritualEvent(id: string): BaseEvent {
  return {
    version: '1.0.0',
    timestamp: '2026-08-09T00:00:00.000Z',
    userId: 'user-1',
    data: { id },
  }
}

describe('createMobileFallbackController', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('starts polling when the socket drops and reports the events it recovers', async () => {
    vi.useFakeTimers()
    const { socket, emit } = fakeSocket()
    const fetcher = vi.fn().mockResolvedValue({ events: [ritualEvent('e-1')] })
    const telemetry = vi.fn()
    const controller = createMobileFallbackController(socket, fetcher, telemetry)

    emit('disconnect')
    await vi.advanceTimersByTimeAsync(0)

    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(telemetry).toHaveBeenCalledWith('polling_activated')
    expect(telemetry).toHaveBeenCalledWith('polling_events_received')

    controller.stopPolling()
  })

  /**
   * Mobile reconnects flap, so `disconnect` can fire repeatedly before the socket
   * settles. A second poller would double-fetch the same stream and deliver every
   * ritual event twice.
   */
  it('stays idempotent across repeated disconnects instead of double-fetching', async () => {
    vi.useFakeTimers()
    const { socket, emit } = fakeSocket()
    const fetcher = vi.fn().mockResolvedValue({ events: [] })
    const controller = createMobileFallbackController(socket, fetcher)

    emit('disconnect')
    emit('disconnect')
    controller.startPolling()
    await vi.advanceTimersByTimeAsync(0)

    expect(fetcher).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS)
    expect(fetcher).toHaveBeenCalledTimes(2)

    controller.stopPolling()
  })

  it('tears polling down on reconnect so realtime is not shadowed by a poll loop', async () => {
    vi.useFakeTimers()
    const { socket, emit } = fakeSocket()
    const fetcher = vi.fn().mockResolvedValue({ events: [] })
    const telemetry = vi.fn()
    createMobileFallbackController(socket, fetcher, telemetry)

    emit('disconnect')
    await vi.advanceTimersByTimeAsync(0)
    emit('connect')

    expect(telemetry).toHaveBeenCalledWith('polling_deactivated')

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  /** A `connect` with no fallback in flight must not throw or emit a phantom stop. */
  it('ignores a reconnect that arrives while polling was never running', () => {
    const { socket, emit } = fakeSocket()
    const telemetry = vi.fn()
    const controller = createMobileFallbackController(socket, vi.fn(), telemetry)

    emit('connect')
    controller.stopPolling()

    expect(telemetry).not.toHaveBeenCalled()
  })

  it('resumes fallback after a reconnect is followed by another drop', async () => {
    vi.useFakeTimers()
    const { socket, emit } = fakeSocket()
    const fetcher = vi.fn().mockResolvedValue({ events: [] })
    const controller = createMobileFallbackController(socket, fetcher)

    emit('disconnect')
    await vi.advanceTimersByTimeAsync(0)
    emit('connect')
    emit('disconnect')
    await vi.advanceTimersByTimeAsync(0)

    expect(fetcher).toHaveBeenCalledTimes(2)

    controller.stopPolling()
  })

  /**
   * The core rule: a degraded backend must not end the fallback. If one failed
   * fetch killed polling, a socket-less client would go permanently silent.
   */
  it('keeps polling after a failed fetch and surfaces the failure as telemetry', async () => {
    vi.useFakeTimers()
    const { socket, emit } = fakeSocket()
    const failure = new Error('gateway unavailable')
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(failure)
      .mockResolvedValue({ events: [ritualEvent('e-2')] })
    const telemetry = vi.fn()
    const controller = createMobileFallbackController(socket, fetcher, telemetry)

    emit('disconnect')
    await vi.advanceTimersByTimeAsync(0)

    expect(telemetry).toHaveBeenCalledWith('polling_error', { err: failure })
    expect(telemetry).not.toHaveBeenCalledWith('polling_events_received')

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS)

    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(telemetry).toHaveBeenCalledWith('polling_events_received')

    controller.stopPolling()
  })

  /** Telemetry is optional; analytics being absent cannot break the fallback. */
  it('runs the whole fallback lifecycle without a telemetry sink', async () => {
    vi.useFakeTimers()
    const { socket, emit } = fakeSocket()
    const fetcher = vi.fn().mockRejectedValue(new Error('offline'))
    createMobileFallbackController(socket, fetcher)

    emit('disconnect')
    await vi.advanceTimersByTimeAsync(0)
    emit('connect')

    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('advances the since cursor so each poll only asks for unseen events', async () => {
    vi.useFakeTimers()
    const { socket, emit } = fakeSocket()
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({ events: [ritualEvent('e-1')], nextSince: 'cursor-1' })
      .mockResolvedValue({ events: [], nextSince: null })
    const controller = createMobileFallbackController(socket, fetcher)

    emit('disconnect')
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS)

    expect(fetcher.mock.calls[0]?.[0]).toBeUndefined()
    expect(fetcher.mock.calls[1]?.[0]).toBe('cursor-1')

    controller.stopPolling()
  })
})
