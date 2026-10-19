import { describe, expect, it, vi } from 'vitest'
import { runMobileE2EFlow } from '../../../scripts/lib/mobile-e2e-flow-retry.mjs'

const timeout = () => Object.assign(new Error('watchdog timeout'), { timedOut: true })

describe('mobile E2E watchdog orchestration', () => {
  it('resets once before a successful initial run', async () => {
    const order: string[] = []
    const onRetry = vi.fn()
    await runMobileE2EFlow({
      reset: () => {
        order.push('reset')
        return Promise.resolve()
      },
      run: () => {
        order.push('run')
        return Promise.resolve()
      },
      onRetry,
    })
    expect(order).toEqual(['reset', 'run'])
    expect(onRetry).not.toHaveBeenCalled()
  })

  it('refuses to execute when fixture reset wiring is missing', async () => {
    const run = vi.fn()
    await expect(
      Reflect.apply(runMobileE2EFlow, undefined, [{ run, onRetry: vi.fn() }])
    ).rejects.toThrow('requires a fixture reset')
    expect(run).not.toHaveBeenCalled()
  })

  it('stops before the initial run when its reset fails', async () => {
    const failure = new Error('initial reset failed')
    const run = vi.fn()
    const onRetry = vi.fn()
    await expect(
      runMobileE2EFlow({ run, reset: vi.fn().mockRejectedValue(failure), onRetry })
    ).rejects.toBe(failure)
    expect(run).not.toHaveBeenCalled()
    expect(onRetry).not.toHaveBeenCalled()
  })

  it('stops before the retry when its reset fails', async () => {
    const failure = new Error('retry reset failed')
    const reset = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(failure)
    const run = vi.fn().mockRejectedValue(timeout())
    const onRetry = vi.fn()
    await expect(runMobileE2EFlow({ run, reset, onRetry })).rejects.toBe(failure)
    expect(reset).toHaveBeenCalledTimes(2)
    expect(run).toHaveBeenCalledTimes(1)
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('preserves a regular failure without another reset or retry', async () => {
    const failure = new Error('assertion failed')
    const reset = vi.fn().mockResolvedValue(undefined)
    const run = vi.fn().mockRejectedValue(failure)
    const onRetry = vi.fn()
    await expect(runMobileE2EFlow({ run, reset, onRetry })).rejects.toBe(failure)
    expect(reset).toHaveBeenCalledTimes(1)
    expect(run).toHaveBeenCalledTimes(1)
    expect(onRetry).not.toHaveBeenCalled()
  })

  it('limits repeated watchdog failures to two total attempts', async () => {
    const first = timeout()
    const second = timeout()
    const reset = vi.fn().mockResolvedValue(undefined)
    const run = vi.fn().mockRejectedValueOnce(first).mockRejectedValueOnce(second)
    const onRetry = vi.fn()
    await expect(runMobileE2EFlow({ run, reset, onRetry })).rejects.toBe(second)
    expect(reset).toHaveBeenCalledTimes(2)
    expect(run).toHaveBeenCalledTimes(2)
    expect(onRetry).toHaveBeenCalledExactlyOnceWith(first)
  })
})
