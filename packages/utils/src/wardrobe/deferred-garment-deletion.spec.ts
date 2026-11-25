// Learning path Step 64: Garment delete (7.6-UNIT-001..008, 013..018, deferred deletion controller).
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-64-garment-delete
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SAVE_FEEDBACK_TIMINGS } from '../save-feedback'
import {
  createDeferredGarmentDeletion,
  type DeferredGarmentDeletionEvent,
  type DeferredGarmentDeletionTimer,
} from './deferred-garment-deletion'

/** A manual timer: `advance` runs every callback due by then, in order. */
function createFakeTimer() {
  let now = 0
  let nextHandle = 1
  const scheduled = new Map<number, { at: number; callback: () => void }>()
  const timer: DeferredGarmentDeletionTimer = {
    setTimeout: (callback, ms) => {
      const handle = nextHandle++
      scheduled.set(handle, { at: now + ms, callback })
      return handle
    },
    clearTimeout: (handle) => {
      scheduled.delete(handle as number)
    },
  }
  const advance = (ms: number) => {
    now += ms
    for (const [handle, entry] of [...scheduled.entries()].sort(
      (a, b) => a[1].at - b[1].at
    )) {
      if (entry.at > now) continue
      scheduled.delete(handle)
      entry.callback()
    }
  }
  return { timer, advance, active: () => scheduled.size }
}

function setup() {
  const fake = createFakeTimer()
  const controller = createDeferredGarmentDeletion({ timer: fake.timer })
  const events: DeferredGarmentDeletionEvent[] = []
  controller.subscribe((event) => events.push(event))
  return { ...fake, controller, events }
}

const flushMicrotasks = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

describe('createDeferredGarmentDeletion', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('[P0] [7.6-UNIT-001] hides the id at once and commits exactly once when the window ends', async () => {
    const { controller, advance, events } = setup()
    const commit = vi.fn().mockResolvedValue(undefined)

    expect(controller.schedule('g1', commit)).toBe(true)
    expect(controller.pendingIds()).toEqual(['g1'])
    expect(controller.isPending('g1')).toBe(true)
    expect(commit).not.toHaveBeenCalled()

    advance(5_000)
    await flushMicrotasks()

    expect(commit).toHaveBeenCalledTimes(1)
    expect(commit).toHaveBeenCalledWith({ keepalive: false })
    expect(controller.pendingIds()).toEqual([])
    expect(events).toEqual([
      { type: 'scheduled', id: 'g1' },
      { type: 'committing', id: 'g1' },
      { type: 'committed', id: 'g1' },
    ])
    advance(10_000)
    expect(commit).toHaveBeenCalledTimes(1)
  })

  it('[P0] [7.6-UNIT-002] sends nothing at 4999 ms; Undo before the end cancels for good', async () => {
    const { controller, advance, events, active } = setup()
    const commit = vi.fn().mockResolvedValue(undefined)

    controller.schedule('g1', commit)
    advance(4_999)
    expect(commit).not.toHaveBeenCalled()

    expect(controller.undo('g1')).toBe(true)
    expect(controller.pendingIds()).toEqual([])
    expect(active()).toBe(0)
    advance(10_000)
    await flushMicrotasks()

    expect(commit).not.toHaveBeenCalled()
    expect(events).toEqual([
      { type: 'scheduled', id: 'g1' },
      { type: 'undone', id: 'g1' },
    ])
  })

  it('[P0] [7.6-UNIT-003] Undo after the commit started is a no-op that reports false', async () => {
    const { controller, advance, events } = setup()
    let finish: () => void = () => undefined
    const commit = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        })
    )

    controller.schedule('g1', commit)
    advance(5_000)
    expect(commit).toHaveBeenCalledTimes(1)
    expect(controller.undo('g1')).toBe(false)
    expect(controller.isPending('g1')).toBe(true)

    finish()
    await flushMicrotasks()
    expect(controller.undo('g1')).toBe(false)
    expect(events.map((event) => event.type)).toEqual([
      'scheduled',
      'committing',
      'committed',
    ])
  })

  it('[P1] [7.6-UNIT-004] ignores an unknown id, a repeated schedule, and stops notifying after unsubscribe', () => {
    const { controller, events } = setup()
    const commit = vi.fn().mockResolvedValue(undefined)
    const late: DeferredGarmentDeletionEvent[] = []
    const unsubscribe = controller.subscribe((event) => late.push(event))

    expect(controller.undo('missing')).toBe(false)
    expect(controller.schedule('g1', commit)).toBe(true)
    expect(controller.schedule('g1', commit)).toBe(false)
    unsubscribe()
    controller.undo('g1')

    expect(events).toEqual([
      { type: 'scheduled', id: 'g1' },
      { type: 'undone', id: 'g1' },
    ])
    expect(late).toEqual([{ type: 'scheduled', id: 'g1' }])
  })

  it('[P0] [7.6-UNIT-005] a second delete commits the first at once and gets its own full window', async () => {
    const { controller, advance } = setup()
    const first = vi.fn().mockResolvedValue(undefined)
    const second = vi.fn().mockResolvedValue(undefined)

    controller.schedule('g1', first)
    advance(2_000)
    controller.schedule('g2', second)
    await flushMicrotasks()

    expect(first).toHaveBeenCalledTimes(1)
    expect(controller.pendingIds()).toEqual(['g2'])

    advance(4_999)
    expect(second).not.toHaveBeenCalled()
    expect(controller.undo('g2')).toBe(true)
    advance(10_000)
    expect(second).not.toHaveBeenCalled()
    expect(first).toHaveBeenCalledTimes(1)
  })

  it('[P0] [7.6-UNIT-006] flush commits every pending id once; a second flush and the late timer send nothing more', async () => {
    const { controller, advance } = setup()
    const commit = vi.fn().mockResolvedValue(undefined)

    controller.schedule('g1', commit)
    await controller.flush({ keepalive: true })

    expect(commit).toHaveBeenCalledTimes(1)
    expect(commit).toHaveBeenCalledWith({ keepalive: true })
    expect(controller.pendingIds()).toEqual([])

    await controller.flush()
    advance(10_000)
    await flushMicrotasks()
    expect(commit).toHaveBeenCalledTimes(1)
  })

  it('[P0] [7.6-UNIT-006] flush also waits for a send already in flight, without sending it twice', async () => {
    const { controller, advance } = setup()
    let finish: () => void = () => undefined
    const commit = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        })
    )
    controller.schedule('g1', commit)
    advance(5_000)

    let flushed = false
    const flushing = controller.flush().then(() => {
      flushed = true
    })
    await flushMicrotasks()
    expect(flushed).toBe(false)

    finish()
    await flushing
    expect(flushed).toBe(true)
    expect(commit).toHaveBeenCalledTimes(1)
  })

  it('[P1] [7.6-UNIT-007] a rejected commit reports the id as failed, never as committed', async () => {
    const { controller, advance, events } = setup()
    const error = new Error('offline')
    controller.schedule('g1', vi.fn().mockRejectedValue(error))

    advance(5_000)
    await flushMicrotasks()

    expect(events).toEqual([
      { type: 'scheduled', id: 'g1' },
      { type: 'committing', id: 'g1' },
      { type: 'failed', id: 'g1', error },
    ])
    expect(controller.pendingIds()).toEqual([])
  })

  it('[P1] [7.6-UNIT-007] a commit that throws synchronously is reported as failed', async () => {
    const { controller, events } = setup()
    const error = new Error('boom')
    const result = await controller.commitNow('g1', () => {
      throw error
    })
    expect(result).toBe(false)
    expect(events.at(-1)).toEqual({ type: 'failed', id: 'g1', error })
  })

  it('[P0] [7.6-UNIT-013] commitNow sends at once with no window, and retry after a failure sends again', async () => {
    const { controller, events, active } = setup()
    const commit = vi
      .fn()
      .mockRejectedValueOnce(new Error('500'))
      .mockResolvedValueOnce(undefined)

    const sending = controller.commitNow('g1', commit)
    expect(controller.isPending('g1')).toBe(true)
    expect(controller.undo('g1')).toBe(false)
    expect(active()).toBe(0)
    await expect(sending).resolves.toBe(false)

    await expect(controller.retry('g1', commit)).resolves.toBe(true)
    expect(commit).toHaveBeenCalledTimes(2)
    expect(events.map((event) => event.type)).toEqual([
      'committing',
      'failed',
      'failuresToReport',
      'committing',
      'committed',
    ])
  })

  it('[P1] [7.6-UNIT-013] commitNow on a piece inside its window commits that delete now, once', async () => {
    const { controller, advance } = setup()
    const commit = vi.fn().mockResolvedValue(undefined)
    controller.schedule('g1', commit)

    const first = controller.commitNow('g1', commit)
    const second = controller.commitNow('g1', commit)
    await expect(first).resolves.toBe(true)
    await expect(second).resolves.toBe(true)
    advance(10_000)
    expect(commit).toHaveBeenCalledTimes(1)
  })

  it('[P1] [7.6-UNIT-013] D9: a failed earlier commit is reported while a later delete stays hidden on its own timer', async () => {
    const { controller, advance, events } = setup()
    const error = new Error('500')
    controller.schedule('g1', vi.fn().mockRejectedValue(error))
    const second = vi.fn().mockResolvedValue(undefined)
    controller.schedule('g2', second)
    await flushMicrotasks()

    expect(events).toContainEqual({ type: 'failed', id: 'g1', error })
    expect(controller.pendingIds()).toEqual(['g2'])
    advance(4_999)
    expect(second).not.toHaveBeenCalled()
    advance(1)
    await flushMicrotasks()
    expect(second).toHaveBeenCalledTimes(1)
  })

  it('[P0] [7.6-UNIT-016] commitNow of another piece first sends every delete still in its window', async () => {
    const { controller, advance } = setup()
    const first = vi.fn().mockResolvedValue(undefined)
    const second = vi.fn().mockResolvedValue(undefined)
    controller.schedule('g1', first)
    advance(1_000)

    await expect(controller.commitNow('g2', second)).resolves.toBe(true)
    await flushMicrotasks()

    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(1)
    expect(first.mock.invocationCallOrder[0]).toBeLessThan(
      second.mock.invocationCallOrder[0]!
    )
    expect(controller.undo('g1')).toBe(false)
    expect(controller.pendingIds()).toEqual([])
    advance(10_000)
    await flushMicrotasks()
    expect(first).toHaveBeenCalledTimes(1)
  })

  it('[P0] [7.6-UNIT-017] retry sends only its own id; a delete inside its window keeps its timer and Undo', async () => {
    const { controller, advance } = setup()
    const failing = vi.fn().mockRejectedValueOnce(new Error('500'))
    controller.schedule('g1', failing)
    const later = vi.fn().mockResolvedValue(undefined)
    controller.schedule('g2', later)
    await flushMicrotasks()
    advance(1_000)

    const again = vi.fn().mockResolvedValue(undefined)
    await expect(controller.retry('g1', again)).resolves.toBe(true)

    expect(again).toHaveBeenCalledTimes(1)
    expect(later).not.toHaveBeenCalled()
    expect(controller.hasOpenWindow()).toBe(true)
    expect(controller.undo('g2')).toBe(true)
    advance(10_000)
    await flushMicrotasks()
    expect(later).not.toHaveBeenCalled()
  })

  it('[P0] [7.6-UNIT-017] after a retry, a delete inside its window is sent once, at its own deadline', async () => {
    const { controller, advance } = setup()
    controller.schedule('g1', vi.fn().mockRejectedValueOnce(new Error('500')))
    const later = vi.fn().mockResolvedValue(undefined)
    controller.schedule('g2', later)
    await flushMicrotasks()
    advance(1_000)

    await expect(
      controller.retry('g1', vi.fn().mockResolvedValue(undefined))
    ).resolves.toBe(true)
    advance(3_999)
    await flushMicrotasks()
    expect(later).not.toHaveBeenCalled()
    expect(controller.isPending('g2')).toBe(true)

    advance(1)
    await flushMicrotasks()
    expect(later).toHaveBeenCalledTimes(1)
    advance(10_000)
    await flushMicrotasks()
    expect(later).toHaveBeenCalledTimes(1)
  })

  it('[P0] [7.6-UNIT-018] D9: a failure report waits for the open window, then names every failure once', async () => {
    const { controller, advance, events } = setup()
    const reports = () => events.filter((event) => event.type === 'failuresToReport')
    const first = new Error('first')
    const second = new Error('second')
    controller.schedule('g1', vi.fn().mockRejectedValue(first))
    controller.schedule('g2', vi.fn().mockRejectedValue(second))
    const last = vi.fn().mockResolvedValue(undefined)
    controller.schedule('g3', last)
    await flushMicrotasks()

    expect(events).toContainEqual({ type: 'failed', id: 'g1', error: first })
    expect(events).toContainEqual({ type: 'failed', id: 'g2', error: second })
    expect(controller.pendingIds()).toEqual(['g3'])
    expect(reports()).toEqual([])

    advance(4_999)
    expect(reports()).toEqual([])
    advance(1)
    await flushMicrotasks()

    expect(last).toHaveBeenCalledTimes(1)
    expect(reports()).toEqual([
      {
        type: 'failuresToReport',
        failures: [
          { id: 'g1', error: first },
          { id: 'g2', error: second },
        ],
      },
    ])
  })

  it('[P1] [7.6-UNIT-018] Undo of the last open window releases the report; with no window it comes at once', async () => {
    const { controller, events } = setup()
    const error = new Error('500')
    controller.schedule('g1', vi.fn().mockRejectedValue(error))
    controller.schedule('g2', vi.fn().mockResolvedValue(undefined))
    await flushMicrotasks()
    expect(events.some((event) => event.type === 'failuresToReport')).toBe(false)

    expect(controller.undo('g2')).toBe(true)
    expect(events.slice(-2)).toEqual([
      { type: 'undone', id: 'g2' },
      { type: 'failuresToReport', failures: [{ id: 'g1', error }] },
    ])

    void controller.commitNow('g3', vi.fn().mockRejectedValue(error))
    await flushMicrotasks()
    expect(events.at(-1)).toEqual({
      type: 'failuresToReport',
      failures: [{ id: 'g3', error }],
    })
  })

  it('[P1] [7.6-UNIT-018] a retried or rescheduled failure is never reported', async () => {
    const { controller, events, advance } = setup()
    const error = new Error('500')
    controller.schedule('g1', vi.fn().mockRejectedValue(error))
    controller.schedule('g2', vi.fn().mockRejectedValue(error))
    controller.schedule('g3', vi.fn().mockResolvedValue(undefined))
    await flushMicrotasks()

    await controller.retry('g1', vi.fn().mockResolvedValue(undefined))
    const again = vi.fn().mockResolvedValue(undefined)
    expect(controller.schedule('g2', again)).toBe(true)
    advance(5_000)
    await flushMicrotasks()

    expect(again).toHaveBeenCalledTimes(1)
    expect(controller.pendingIds()).toEqual([])
    expect(events.some((event) => event.type === 'failuresToReport')).toBe(false)
  })

  it('[P1] [7.6-UNIT-018] reset drops unreported failures', async () => {
    const { controller, events, advance } = setup()
    controller.schedule('g1', vi.fn().mockRejectedValue(new Error('500')))
    controller.schedule('g2', vi.fn().mockResolvedValue(undefined))
    await flushMicrotasks()

    controller.reset()
    advance(10_000)
    await flushMicrotasks()

    expect(events.some((event) => event.type === 'failuresToReport')).toBe(false)
  })

  it('[P1] [7.6-UNIT-015] a throwing listener neither fails the send nor silences later listeners', async () => {
    const { controller, advance } = setup()
    const later: DeferredGarmentDeletionEvent[] = []
    controller.subscribe(() => {
      throw new Error('listener fault')
    })
    controller.subscribe((event) => later.push(event))
    const commit = vi.fn().mockResolvedValue(undefined)

    expect(controller.schedule('g1', commit)).toBe(true)
    advance(5_000)
    await flushMicrotasks()

    expect(commit).toHaveBeenCalledTimes(1)
    expect(later.map((event) => event.type)).toEqual([
      'scheduled',
      'committing',
      'committed',
    ])
    await expect(controller.commitNow('g2', commit)).resolves.toBe(true)
  })

  it('[P1] [7.6-UNIT-014] reset drops every pending delete without committing (test seam, D10)', async () => {
    const { controller, advance, active } = setup()
    const commit = vi.fn().mockResolvedValue(undefined)
    controller.schedule('g1', commit)

    controller.reset()
    expect(controller.pendingIds()).toEqual([])
    expect(active()).toBe(0)
    advance(10_000)
    await flushMicrotasks()
    expect(commit).not.toHaveBeenCalled()
  })

  it('[P2] [7.6-UNIT-014] a send that settles after reset leaves a newer delete of the same id alone', async () => {
    const { controller, advance } = setup()
    const settle: { resolve: () => void; reject: (error: Error) => void }[] = []
    const slow = () =>
      new Promise<void>((resolve, reject) => {
        settle.push({ resolve, reject })
      })

    void controller.commitNow('g1', slow)
    void controller.commitNow('g2', slow)
    controller.reset()
    controller.schedule('g1', vi.fn().mockResolvedValue(undefined))
    controller.schedule('g2', vi.fn().mockResolvedValue(undefined))
    advance(0)

    settle[0]!.resolve()
    settle[1]!.reject(new Error('late'))
    await flushMicrotasks()
    expect(controller.pendingIds()).toEqual(['g2'])
  })

  it('[P2] [7.6-UNIT-008] the window is the CC-7.1 status bar duration on the default timer', async () => {
    vi.useFakeTimers()
    const controller = createDeferredGarmentDeletion()
    const commit = vi.fn().mockResolvedValue(undefined)
    controller.schedule('g1', commit)

    await vi.advanceTimersByTimeAsync(SAVE_FEEDBACK_TIMINGS.statusBarDurationMs - 1)
    expect(commit).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(commit).toHaveBeenCalledTimes(1)

    controller.schedule('g2', commit)
    expect(controller.undo('g2')).toBe(true)
    await vi.advanceTimersByTimeAsync(SAVE_FEEDBACK_TIMINGS.statusBarDurationMs)
    expect(commit).toHaveBeenCalledTimes(1)
  })

  it('[P2] [7.6-UNIT-008] honours an explicit window length', () => {
    const fake = createFakeTimer()
    const controller = createDeferredGarmentDeletion({ timer: fake.timer, windowMs: 100 })
    const commit = vi.fn().mockResolvedValue(undefined)
    controller.schedule('g1', commit)
    fake.advance(100)
    expect(commit).toHaveBeenCalledTimes(1)
  })
})
