import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  connectCommunityTransport,
  type CommunityTransportState,
} from '../src/realtime/community-transport'

// Socket.IO is the external boundary. Every retry, token lookup, strict control
// parse and teardown below executes the production transport.
const boundary = vi.hoisted(() => ({ io: vi.fn() }))
vi.mock('socket.io-client', () => ({ io: boundary.io }))
class SocketBoundary {
  listeners = new Map<string, ((value?: unknown) => void)[]>()
  on = vi.fn((name: string, callback: (value?: unknown) => void) => {
    this.listeners.set(name, [...(this.listeners.get(name) ?? []), callback])
    return this
  })
  connect = vi.fn()
  disconnect = vi.fn()
  removeAllListeners = vi.fn(() => this.listeners.clear())
  receive(name: string, value?: unknown) {
    for (const callback of this.listeners.get(name) ?? []) callback(value)
  }
}
const sockets: SocketBoundary[] = []
const stops: (() => void)[] = []
async function start(
  token = vi.fn<() => Promise<string | undefined>>().mockResolvedValue('token-1')
) {
  const state = vi.fn<(value: CommunityTransportState) => void>()
  const changed = vi.fn()
  stops.push(
    connectCommunityTransport({
      baseUrl: 'https://api.synthetic.test/',
      token,
      state,
      changed,
    })
  )
  await Promise.resolve()
  return { state, changed, token }
}
beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  sockets.length = 0
  boundary.io.mockImplementation(() => {
    const socket = new SocketBoundary()
    sockets.push(socket)
    return socket
  })
  vi.spyOn(Math, 'random').mockReturnValue(0.5)
})
afterEach(() => {
  stops.splice(0).forEach((stop) => stop())
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('Story 6.5 R16 L3: production websocket transport lifecycle', () => {
  it('uses websocket-only transport and delivers only a strict identifier-free doorbell', async () => {
    const { changed, state } = await start()
    expect(boundary.io).toHaveBeenCalledWith('https://api.synthetic.test/community', {
      path: '/api/realtime',
      addTrailingSlash: false,
      transports: ['websocket'],
      auth: { token: 'token-1' },
      reconnection: false,
      forceNew: true,
      autoConnect: false,
      timeout: 2000,
    })
    const socket = sockets[0]!
    expect(socket.connect).toHaveBeenCalledOnce()
    socket.receive('connect')
    expect(state).toHaveBeenLastCalledWith('connected')
    socket.receive('community:changed', {
      version: 1,
      type: 'community:changed',
      postId: 'leak',
    })
    socket.receive('community:changed', { version: 2, type: 'community:changed' })
    expect(changed).not.toHaveBeenCalled()
    socket.receive('community:changed', { version: 1, type: 'community:changed' })
    expect(changed).toHaveBeenCalledOnce()
  })

  it('backs off 500ms to a 15s base with jitter, one timer per failure and a fresh token each attempt', async () => {
    let version = 0
    const token = vi.fn(() => Promise.resolve(`fresh-${++version}`))
    await start(token)
    // Math.random=0.5 adds 10%; the capped base still has bounded jitter.
    for (const delay of [550, 1100, 2200, 4400, 8800, 16500, 16500]) {
      const previous = sockets.at(-1)!
      const count = sockets.length
      previous.receive('disconnect')
      previous.receive('connect_error', new Error('offline'))
      await vi.advanceTimersByTimeAsync(delay - 1)
      expect(sockets).toHaveLength(count)
      await vi.advanceTimersByTimeAsync(1)
      expect(sockets).toHaveLength(count + 1)
      expect(token).toHaveBeenCalledTimes(count + 1)
      expect(boundary.io.mock.calls.at(-1)![1]).toMatchObject({
        auth: {
          token: `fresh-${count + 1}`,
        },
      })
      expect(previous.removeAllListeners).toHaveBeenCalledOnce()
      expect(previous.disconnect).toHaveBeenCalledOnce()
    }
  })

  it.each([0, 0.999])(
    'keeps first retry in the 500..600ms jitter envelope at random=%s',
    async (random) => {
      vi.mocked(Math.random).mockReturnValue(random)
      await start()
      const schedule = vi.spyOn(globalThis, 'setTimeout')
      sockets[0]!.receive('disconnect')
      const delay = schedule.mock.calls.at(-1)![1] as number
      expect(delay).toBe(500 + random * 100)
      expect(delay).toBeGreaterThanOrEqual(500)
      expect(delay).toBeLessThan(600)
    }
  )

  it('resets backoff only after 30 seconds continuously connected', async () => {
    await start()
    sockets[0]!.receive('disconnect')
    await vi.advanceTimersByTimeAsync(550)
    sockets[1]!.receive('connect')
    await vi.advanceTimersByTimeAsync(29_999)
    sockets[1]!.receive('disconnect')
    await vi.advanceTimersByTimeAsync(1099)
    expect(sockets).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(sockets).toHaveLength(3)
    sockets[2]!.receive('connect')
    await vi.advanceTimersByTimeAsync(30_000)
    sockets[2]!.receive('disconnect')
    await vi.advanceTimersByTimeAsync(549)
    expect(sockets).toHaveLength(3)
    await vi.advanceTimersByTimeAsync(1)
    expect(sockets).toHaveLength(4)
  })

  it('cancels the 30-second stability reset when unavailable control ends the connection', async () => {
    await start()
    sockets[0]!.receive('disconnect')
    await vi.advanceTimersByTimeAsync(550)
    sockets[1]!.receive('connect')
    await vi.advanceTimersByTimeAsync(29_999)
    sockets[1]!.receive('community:availability', { version: 1, status: 'unavailable' })
    await vi.advanceTimersByTimeAsync(1100)
    expect(sockets).toHaveLength(3)
    sockets[2]!.receive('connect_error', new Error('still unavailable'))
    await vi.advanceTimersByTimeAsync(2199)
    expect(sockets).toHaveLength(3)
    await vi.advanceTimersByTimeAsync(1)
    expect(sockets).toHaveLength(4)
  })

  it('retries unavailable control and stops permanently for affirmative denial', async () => {
    const { state, token } = await start()
    sockets[0]!.receive('community:availability', { version: 1, status: 'unavailable' })
    expect(state).toHaveBeenLastCalledWith('unavailable')
    expect(sockets[0]!.disconnect).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(550)
    expect(token).toHaveBeenCalledTimes(2)
    sockets[1]!.receive('community:availability', { version: 1, status: 'denied' })
    expect(state).toHaveBeenLastCalledWith('denied')
    await vi.advanceTimersByTimeAsync(120_000)
    expect(token).toHaveBeenCalledTimes(2)
    expect(sockets[1]!.listeners.size).toBe(0)
  })

  it('ignores malformed availability and retries an unavailable token dependency', async () => {
    const token = vi
      .fn<() => Promise<string | undefined>>()
      .mockRejectedValueOnce(new Error('identity dependency unavailable'))
      .mockResolvedValue('recovered-token')
    const { state } = await start(token)
    expect(state).toHaveBeenLastCalledWith('unavailable')
    expect(sockets).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(550)
    expect(sockets).toHaveLength(1)
    sockets[0]!.receive('community:availability', {
      version: 1,
      status: 'denied',
      memberId: 'leak',
    })
    expect(sockets[0]!.disconnect).not.toHaveBeenCalled()
    expect(state).not.toHaveBeenCalledWith('denied')
  })

  it('stops retries for a strict denied handshake control', async () => {
    const { state, token } = await start()
    sockets[0]!.receive(
      'connect_error',
      Object.assign(new Error('generic'), {
        data: { version: 1, status: 'denied' },
      })
    )
    expect(state).toHaveBeenCalledExactlyOnceWith('denied')
    expect(sockets[0]!.listeners.size).toBe(0)
    await vi.advanceTimersByTimeAsync(120_000)
    expect(token).toHaveBeenCalledOnce()
  })

  it('retries typed unavailable handshake control using a fresh token', async () => {
    const token = vi
      .fn<() => Promise<string | undefined>>()
      .mockResolvedValueOnce('before-outage')
      .mockResolvedValue('after-outage')
    const { state } = await start(token)
    sockets[0]!.receive(
      'connect_error',
      Object.assign(new Error('generic'), {
        data: { version: 1, status: 'unavailable' },
      })
    )
    expect(state).toHaveBeenCalledExactlyOnceWith('unavailable')
    await vi.advanceTimersByTimeAsync(550)
    expect(boundary.io.mock.calls.at(-1)![1]).toMatchObject({
      auth: { token: 'after-outage' },
    })
    expect(token).toHaveBeenCalledTimes(2)
  })

  it('treats malformed handshake denial as recoverable without accepting extra data', async () => {
    const { state, token } = await start()
    sockets[0]!.receive(
      'connect_error',
      Object.assign(new Error('generic'), {
        data: { version: 1, status: 'denied', memberId: 'unexpected' },
      })
    )
    expect(state).toHaveBeenCalledExactlyOnceWith('recovering')
    await vi.advanceTimersByTimeAsync(550)
    expect(token).toHaveBeenCalledTimes(2)
  })

  it('denies a missing token without opening a socket or scheduling retries', async () => {
    const token = vi.fn<() => Promise<string | undefined>>().mockResolvedValue(undefined)
    const { state } = await start(token)
    expect(state).toHaveBeenCalledExactlyOnceWith('denied')
    await vi.advanceTimersByTimeAsync(120_000)
    expect(token).toHaveBeenCalledOnce()
    expect(boundary.io).not.toHaveBeenCalled()
  })

  it('tears down listeners and timers and fences an unresolved token at stop', async () => {
    const { state, changed, token } = await start()
    sockets[0]!.receive('connect')
    sockets[0]!.receive('disconnect')
    stops.pop()!()
    expect(sockets[0]!.listeners.size).toBe(0)
    sockets[0]!.receive('community:changed', { version: 1, type: 'community:changed' })
    await vi.advanceTimersByTimeAsync(120_000)
    expect(token).toHaveBeenCalledOnce()
    expect(changed).not.toHaveBeenCalled()
    expect(state.mock.calls.map(([value]) => value)).toEqual(['connected', 'recovering'])
    let release!: (value: string) => void
    const pending = start(
      vi.fn(
        () =>
          new Promise<string>((resolve) => {
            release = resolve
          })
      )
    )
    stops.pop()!()
    release('late-token')
    await pending
    await Promise.resolve()
    expect(boundary.io).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })
})
