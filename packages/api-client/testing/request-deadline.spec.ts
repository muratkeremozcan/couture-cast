// Learning path Step 43: Realtime engagement and push notifications.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-43-realtime-engagement-and-push-notifications
import { afterEach, expect, it, vi } from 'vitest'
import { withRequestDeadline } from '../src/request-deadline'

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})
it('settled success and failure release their timer and every caller listener', async () => {
  vi.useFakeTimers()
  for (const fails of [false, true]) {
    const owner = new AbortController()
    const remove = vi.spyOn(owner.signal, 'removeEventListener')
    const failure = new Error('request failure')
    let used!: AbortSignal
    const request = withRequestDeadline(
      2000,
      [undefined, null, owner.signal],
      (signal) => {
        used = signal
        return fails ? Promise.reject(failure) : Promise.resolve('result')
      }
    )
    if (fails) await expect(request).rejects.toBe(failure)
    else expect(await request).toBe('result')
    expect(remove).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
    owner.abort()
    expect(used.aborted).toBe(false)
  }
})
it.each(['timeout', 'caller', 'already-aborted'] as const)(
  'propagates %s without newer AbortSignal statics and releases all resources',
  async (mode) => {
    vi.useFakeTimers()
    expect(Reflect.has(AbortSignal, 'timeout')).toBe(false)
    expect(Reflect.has(AbortSignal, 'any')).toBe(false)
    const owner = new AbortController()
    const second = new AbortController()
    if (mode === 'already-aborted') owner.abort()
    let used!: AbortSignal
    let finish!: () => void
    const flight = withRequestDeadline(2000, [owner.signal, second.signal], (signal) => {
      used = signal
      return new Promise<void>((resolve) => {
        finish = resolve
      })
    })
    if (mode === 'timeout') {
      await vi.advanceTimersByTimeAsync(1999)
      expect(used.aborted).toBe(false)
      await vi.advanceTimersByTimeAsync(1)
    } else if (mode === 'caller') second.abort()
    expect(used.aborted).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
    finish()
    await flight
  }
)
it('cleans up a synchronous request setup exception', async () => {
  vi.useFakeTimers()
  const failure = new Error('setup failed')
  await expect(
    withRequestDeadline(2000, [], () => {
      throw failure
    })
  ).rejects.toBe(failure)
  expect(vi.getTimerCount()).toBe(0)
})
