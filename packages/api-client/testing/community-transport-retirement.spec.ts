// Learning path Step 43: Realtime engagement and push notifications.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-43-realtime-engagement-and-push-notifications
import { afterEach, describe, expect, it, vi } from 'vitest'
import { connectCommunityTransport } from '../src/realtime/community-transport'

const boundary = vi.hoisted(() => ({ io: vi.fn() }))
vi.mock('socket.io-client', () => ({ io: boundary.io }))
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})
describe('retired socket callback ownership', () => {
  it('queued deliveries from a retired socket cannot publish state, doorbells or retries', async () => {
    vi.useFakeTimers()
    const callbacks = new Map<string, (value?: unknown) => void>()
    const socket = {
      on: vi.fn((event: string, callback: (value?: unknown) => void) => {
        callbacks.set(event, callback)
        return socket
      }),
      connect: vi.fn(),
      disconnect: vi.fn(),
      removeAllListeners: vi.fn(),
    }
    boundary.io.mockReturnValue(socket)
    const state = vi.fn(),
      changed = vi.fn()
    const stop = connectCommunityTransport({
      baseUrl: 'https://api.invalid',
      token: () => Promise.resolve('fixture'),
      state,
      changed,
    })
    await Promise.resolve()
    expect(socket.connect).toHaveBeenCalledTimes(1)
    stop()
    // External event queues can retain callbacks after removeAllListeners().
    callbacks.get('connect')?.()
    callbacks.get('community:changed')?.({ version: 1, type: 'community:changed' })
    callbacks.get('community:availability')?.({ version: 1, status: 'unavailable' })
    callbacks.get('disconnect')?.()
    callbacks.get('connect_error')?.({ data: { version: 1, status: 'denied' } })
    await vi.advanceTimersByTimeAsync(60_000)
    expect(state).not.toHaveBeenCalled()
    expect(changed).not.toHaveBeenCalled()
    expect(boundary.io).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })
  it('a token supplier rejection after teardown cannot announce an outage or retry', async () => {
    vi.useFakeTimers()
    let reject!: (error: Error) => void
    const token = new Promise<string>((_, fail) => {
      reject = fail
    })
    const state = vi.fn()
    const stop = connectCommunityTransport({
      baseUrl: 'https://api.invalid',
      token: () => token,
      state,
      changed: vi.fn(),
    })
    stop()
    reject(new Error('retired dependency'))
    await vi.advanceTimersByTimeAsync(60_000)
    expect(state).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })
})
