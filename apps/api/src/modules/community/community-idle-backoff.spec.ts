import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  IDLE_TICK,
  nextLoopDelay,
  PROGRESS_TICK,
  startBackoffLoop,
  tickFromCount,
  type BackoffLoop,
  type LoopTick,
} from './community-idle-backoff.js'

const policy = { baseMs: 1_000, idleCapMs: 10_000 }

describe('nextLoopDelay', () => {
  it('doubles an idle delay up to the cap', () => {
    const delays = [policy.baseMs]
    for (let tick = 0; tick < 6; tick++)
      delays.push(nextLoopDelay(policy, delays.at(-1)!, IDLE_TICK))
    expect(delays).toEqual([1_000, 2_000, 4_000, 8_000, 10_000, 10_000, 10_000])
  })

  it('returns to the base cadence the moment a tick makes progress', () => {
    expect(nextLoopDelay(policy, 10_000, PROGRESS_TICK)).toBe(1_000)
  })

  it('backs a failed tick off like an idle one', () => {
    expect(nextLoopDelay(policy, 4_000, 'failed')).toBe(8_000)
    expect(nextLoopDelay(policy, 10_000, 'failed')).toBe(10_000)
  })

  it('never sleeps past known due work, and never below the base cadence', () => {
    expect(nextLoopDelay(policy, 8_000, { progressed: false, dueInMs: 2_500.2 })).toBe(
      2_501
    )
    expect(nextLoopDelay(policy, 8_000, { progressed: false, dueInMs: -50 })).toBe(1_000)
    expect(nextLoopDelay(policy, 1_000, { progressed: false, dueInMs: 60_000 })).toBe(
      2_000
    )
    expect(nextLoopDelay(policy, 1_000, { progressed: false, dueInMs: null })).toBe(2_000)
  })

  it('counts any item as progress', () => {
    expect(tickFromCount(0)).toBe(IDLE_TICK)
    expect(tickFromCount(3)).toBe(PROGRESS_TICK)
  })
})

describe('startBackoffLoop', () => {
  let loop: BackoffLoop | undefined
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    loop?.stop()
    loop = undefined
    vi.useRealTimers()
  })

  function recording(results: (LoopTick | Error)[] = []) {
    const startedAt = Date.now()
    const calls: number[] = []
    const work = vi.fn(() => {
      calls.push(Date.now() - startedAt)
      const next = results.shift() ?? IDLE_TICK
      return next instanceof Error ? Promise.reject(next) : Promise.resolve(next)
    })
    return { calls, work }
  }

  it('runs at the base delay first, then backs off while idle', async () => {
    const { calls, work } = recording()
    loop = startBackoffLoop({ policy, work, onError: vi.fn() })
    await vi.advanceTimersByTimeAsync(25_000)
    expect(calls).toEqual([1_000, 3_000, 7_000, 15_000, 25_000])
    expect(loop.delayMs).toBe(10_000)
  })

  it('reports a failure, keeps running, and backs off', async () => {
    const onError = vi.fn()
    const failure = new Error('database down')
    const { calls, work } = recording([failure, failure])
    loop = startBackoffLoop({ policy, work, onError })
    await vi.advanceTimersByTimeAsync(7_000)
    expect(calls).toEqual([1_000, 3_000, 7_000])
    expect(onError).toHaveBeenCalledTimes(2)
    expect(onError).toHaveBeenCalledWith(failure)
  })

  it('survives a work function that throws synchronously and an error handler that throws', async () => {
    let calls = 0
    loop = startBackoffLoop({
      policy,
      work: () => {
        calls += 1
        throw new Error('synchronous')
      },
      onError: () => {
        throw new Error('logger down')
      },
    })
    await vi.advanceTimersByTimeAsync(3_000)
    expect(calls).toBe(2)
  })

  it('wakes an idle loop at once and resumes from the base cadence', async () => {
    const { calls, work } = recording()
    loop = startBackoffLoop({ policy, work, onError: vi.fn() })
    await vi.advanceTimersByTimeAsync(15_000)
    expect(calls).toEqual([1_000, 3_000, 7_000, 15_000])
    loop.wake()
    await vi.advanceTimersByTimeAsync(0)
    expect(calls.at(-1)).toBe(15_000)
    expect(calls).toHaveLength(5)
    await vi.advanceTimersByTimeAsync(2_000)
    expect(calls).toEqual([1_000, 3_000, 7_000, 15_000, 15_000, 17_000])
  })

  it('runs once more right after a tick that was running when woken, without overlapping it', async () => {
    let finish!: () => void
    let running = 0
    let overlapped = false
    let calls = 0
    loop = startBackoffLoop({
      policy,
      work: () => {
        calls += 1
        running += 1
        if (running > 1) overlapped = true
        return new Promise<LoopTick>((resolve) => {
          finish = () => {
            running -= 1
            resolve(IDLE_TICK)
          }
        })
      },
      onError: vi.fn(),
    })
    await vi.advanceTimersByTimeAsync(1_000)
    expect(calls).toBe(1)
    loop.wake()
    await vi.advanceTimersByTimeAsync(5_000)
    expect(calls).toBe(1)
    finish()
    await vi.advanceTimersByTimeAsync(0)
    expect(calls).toBe(2)
    expect(overlapped).toBe(false)
    finish()
  })

  it('schedules nothing after stop, even when a tick was running', async () => {
    let finish!: () => void
    let calls = 0
    const tracked: Promise<unknown>[] = []
    loop = startBackoffLoop({
      policy,
      work: () => {
        calls += 1
        return new Promise<LoopTick>((resolve) => {
          finish = () => resolve(PROGRESS_TICK)
        })
      },
      onError: vi.fn(),
      track: (flight) => tracked.push(flight),
    })
    await vi.advanceTimersByTimeAsync(1_000)
    loop.stop()
    loop.wake()
    finish()
    await Promise.all(tracked)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(calls).toBe(1)
    expect(vi.getTimerCount()).toBe(0)
  })
})
