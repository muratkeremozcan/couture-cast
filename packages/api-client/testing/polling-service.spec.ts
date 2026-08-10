import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PollingService } from '../src/realtime/polling-service'

type Poll = { events: string[]; nextSince?: string | null }

function emptyPoll(): Poll {
  return { events: [] }
}

describe('PollingService', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // Fallback exists because realtime already failed, so the first fetch has to
  // happen immediately rather than one interval later.
  it('fetches once immediately on start and signals activation', async () => {
    const fetcher = vi.fn<(since?: string) => Promise<Poll>>().mockResolvedValue({
      events: ['a'],
      nextSince: '2026-08-09T12:00:00.000Z',
    })
    const onEvents = vi.fn()
    const onActivate = vi.fn()
    const service = new PollingService({ fetcher, onEvents, onActivate })

    await service.start('2026-08-09T11:00:00.000Z')

    expect(onActivate).toHaveBeenCalledOnce()
    expect(fetcher).toHaveBeenCalledExactlyOnceWith('2026-08-09T11:00:00.000Z')
    expect(onEvents).toHaveBeenCalledExactlyOnceWith(['a'])

    service.stop()
  })

  it('starts without a cursor when no initial since is supplied', async () => {
    const fetcher = vi
      .fn<(since?: string) => Promise<Poll>>()
      .mockResolvedValue(emptyPoll())
    const service = new PollingService({ fetcher, onEvents: vi.fn() })

    await service.start()

    expect(fetcher).toHaveBeenCalledWith(undefined)

    service.stop()
  })

  // The cursor is the only thing preventing the client from replaying the whole
  // backlog on every poll.
  it('advances the cursor to the returned nextSince on each poll', async () => {
    const fetcher = vi
      .fn<(since?: string) => Promise<Poll>>()
      .mockResolvedValueOnce({ events: ['a'], nextSince: 'cursor-1' })
      .mockResolvedValueOnce({ events: ['b'], nextSince: 'cursor-2' })
      .mockResolvedValue(emptyPoll())
    const service = new PollingService({ fetcher, onEvents: vi.fn(), intervalMs: 1_000 })

    await service.start('cursor-0')
    await vi.advanceTimersByTimeAsync(1_000)
    await vi.advanceTimersByTimeAsync(1_000)

    expect(fetcher.mock.calls.map(([since]) => since)).toEqual([
      'cursor-0',
      'cursor-1',
      'cursor-2',
    ])

    service.stop()
  })

  // A null cursor means "nothing new"; overwriting the cursor with it would
  // reset the client to the beginning of the stream.
  it('keeps the previous cursor when the server returns a null nextSince', async () => {
    const fetcher = vi
      .fn<(since?: string) => Promise<Poll>>()
      .mockResolvedValueOnce({ events: [], nextSince: null })
      .mockResolvedValue(emptyPoll())
    const service = new PollingService({ fetcher, onEvents: vi.fn(), intervalMs: 1_000 })

    await service.start('cursor-0')
    await vi.advanceTimersByTimeAsync(1_000)

    expect(fetcher.mock.calls.map(([since]) => since)).toEqual(['cursor-0', 'cursor-0'])

    service.stop()
  })

  it('does not invoke onEvents for an empty poll', async () => {
    const onEvents = vi.fn()
    const service = new PollingService({
      fetcher: vi.fn<(since?: string) => Promise<Poll>>().mockResolvedValue(emptyPoll()),
      onEvents,
    })

    await service.start()

    expect(onEvents).not.toHaveBeenCalled()

    service.stop()
  })

  it('polls on the default thirty second cadence when no interval is given', async () => {
    const fetcher = vi
      .fn<(since?: string) => Promise<Poll>>()
      .mockResolvedValue(emptyPoll())
    const service = new PollingService({ fetcher, onEvents: vi.fn() })

    await service.start()
    await vi.advanceTimersByTimeAsync(29_999)
    expect(fetcher).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(1)
    expect(fetcher).toHaveBeenCalledTimes(2)

    service.stop()
  })

  // Fallback is triggered by socket events that can fire more than once; a
  // second start must not leave an orphaned interval running forever.
  it('ignores a second start while polling is already active', async () => {
    const fetcher = vi
      .fn<(since?: string) => Promise<Poll>>()
      .mockResolvedValue(emptyPoll())
    const onActivate = vi.fn()
    const service = new PollingService({
      fetcher,
      onEvents: vi.fn(),
      onActivate,
      intervalMs: 1_000,
    })

    await service.start()
    await service.start()
    await vi.advanceTimersByTimeAsync(1_000)

    expect(onActivate).toHaveBeenCalledOnce()
    expect(fetcher).toHaveBeenCalledTimes(2)

    service.stop()
  })

  it('stops polling and signals deactivation when realtime recovers', async () => {
    const fetcher = vi
      .fn<(since?: string) => Promise<Poll>>()
      .mockResolvedValue(emptyPoll())
    const onDeactivate = vi.fn()
    const service = new PollingService({
      fetcher,
      onEvents: vi.fn(),
      onDeactivate,
      intervalMs: 1_000,
    })

    await service.start()
    service.stop()
    await vi.advanceTimersByTimeAsync(5_000)

    expect(onDeactivate).toHaveBeenCalledOnce()
    expect(fetcher).toHaveBeenCalledOnce()
  })

  // stop() is called from socket reconnect handlers that may fire when polling
  // was never active; it must stay silent rather than report a false recovery.
  it('is a no-op when stopped before it was ever started', () => {
    const onDeactivate = vi.fn()
    const service = new PollingService({
      fetcher: vi.fn<(since?: string) => Promise<Poll>>().mockResolvedValue(emptyPoll()),
      onEvents: vi.fn(),
      onDeactivate,
    })

    service.stop()
    service.stop()

    expect(onDeactivate).not.toHaveBeenCalled()
  })

  it('can be restarted after a stop', async () => {
    const fetcher = vi
      .fn<(since?: string) => Promise<Poll>>()
      .mockResolvedValue(emptyPoll())
    const onActivate = vi.fn()
    const service = new PollingService({
      fetcher,
      onEvents: vi.fn(),
      onActivate,
      intervalMs: 1_000,
    })

    await service.start()
    service.stop()
    await service.start()

    expect(onActivate).toHaveBeenCalledTimes(2)
    expect(fetcher).toHaveBeenCalledTimes(2)

    service.stop()
  })

  // A failing poll is the expected case on the degraded networks that put the
  // client in fallback mode; it must report and keep polling, not tear down.
  it('reports a failed poll and keeps polling on the next tick', async () => {
    const fetcher = vi
      .fn<(since?: string) => Promise<Poll>>()
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValue({ events: ['recovered'] })
    const onError = vi.fn()
    const onEvents = vi.fn()
    const service = new PollingService({ fetcher, onEvents, onError, intervalMs: 1_000 })

    await service.start()

    expect(onError).toHaveBeenCalledOnce()
    expect(onError.mock.calls[0]?.[0]).toBeInstanceOf(Error)
    expect(onEvents).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1_000)

    expect(onEvents).toHaveBeenCalledExactlyOnceWith(['recovered'])

    service.stop()
  })

  // onError is optional, so a consumer that never supplies one must not turn a
  // transient fetch failure into an unhandled rejection.
  it('swallows a failed poll when no error handler is registered', async () => {
    const fetcher = vi
      .fn<(since?: string) => Promise<Poll>>()
      .mockRejectedValue(new Error('network down'))
    const service = new PollingService({ fetcher, onEvents: vi.fn(), intervalMs: 1_000 })

    await expect(service.start()).resolves.toBeUndefined()
    await vi.advanceTimersByTimeAsync(1_000)

    expect(fetcher).toHaveBeenCalledTimes(2)

    service.stop()
  })
})
