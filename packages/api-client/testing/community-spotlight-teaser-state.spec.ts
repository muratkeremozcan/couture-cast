// Learning path Step 46: Home spotlight teaser.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-46-home-spotlight-teaser
// Story 6.7: the Home teaser lifecycle under a controlled clock. No real sleeps:
// every timer and the clock are the test's own.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  SPOTLIGHT_TEASER_EXPIRY_MS,
  SPOTLIGHT_TEASER_READ_FLOOR_MS,
  SPOTLIGHT_TEASER_REREAD_MS,
  SpotlightTeaserState,
  spotlightTeaserValueOf,
} from '../src/community-spotlight-teaser-state'
import type {
  CommunityReactionSpotlight,
  CommunityReactionSpotlightItem,
} from '../src/contracts/http'

const item = (id: string): CommunityReactionSpotlightItem => ({
  id,
  caption: 'Layered wool for the wind.',
  altText: 'A camel coat over a grey knit.',
  climateBand: 'temperate_wet',
  imageAccess: {
    url: `https://cdn.couturecast.test/${id}.jpg`,
    expiresAt: '2026-10-23T12:15:00.000Z',
  },
  publishedAt: '2026-10-22T09:00:00.000Z',
  createdAt: '2026-10-22T08:59:00.000Z',
  status: 'published',
  challengeId: null,
  author: { displayName: 'Ana', isSelf: false },
  rank: 1,
  reactions: {
    counts: { applause: 2, love: 1, inspiration: 0 },
    total: 3,
    viewerReaction: null,
    revision: 1,
    generation: 1,
  },
})

const page = (id = 'post-1'): CommunityReactionSpotlight => ({
  level: 'city',
  label: 'Lisbon',
  items: [item(id)],
  nextCursor: 'next',
})

class RateLimited extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super('rate limited')
  }
}

interface Deferred {
  signal: AbortSignal
  resolve: (value: CommunityReactionSpotlight) => void
  reject: (error: unknown) => void
}

function harness() {
  const reads: Deferred[] = []
  const state = new SpotlightTeaserState({
    read: (signal) =>
      new Promise<CommunityReactionSpotlight>((resolve, reject) => {
        reads.push({ signal, resolve, reject })
      }),
    retryAfterSeconds: (error) =>
      error instanceof RateLimited ? error.retryAfterSeconds : undefined,
  })
  const settle = async (index: number, value: CommunityReactionSpotlight | Error) => {
    const read = reads[index]!
    if (value instanceof Error) read.reject(value)
    else read.resolve(value)
    await vi.advanceTimersByTimeAsync(0)
  }
  return { state, reads, settle }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-23T12:00:00.000Z'))
})
afterEach(() => {
  vi.useRealTimers()
})

describe('6.7 spotlight teaser render rule', () => {
  it('6.7-UNIT-020 renders only a served level with one entry, a label and an image', () => {
    expect(spotlightTeaserValueOf(page(), 'member-1', 5)).toEqual({
      memberId: 'member-1',
      item: item('post-1'),
      level: 'city',
      label: 'Lisbon',
      completedAt: 5,
    })
    expect(
      spotlightTeaserValueOf(
        { level: 'none', label: null, items: [], nextCursor: null },
        'member-1',
        5
      )
    ).toBeNull()
    expect(spotlightTeaserValueOf({ ...page(), items: [] }, 'member-1', 5)).toBeNull()
    expect(spotlightTeaserValueOf({ ...page(), label: null }, 'member-1', 5)).toBeNull()
  })
})

describe('6.7 spotlight teaser lifecycle', () => {
  it('6.7-UNIT-021 cold start reads nothing until a member resolves while active', async () => {
    const { state, reads, settle } = harness()
    state.setActive(true)
    state.setMember(undefined)
    expect(reads).toHaveLength(0)
    state.setMember(null)
    expect(reads).toHaveLength(0)
    state.setMember('member-1')
    expect(reads).toHaveLength(1)
    await settle(0, page())
    expect(state.getSnapshot()?.item.id).toBe('post-1')
  })

  it('6.7-UNIT-022 an inactive surface never reads, and activation reads at once', () => {
    const { state, reads } = harness()
    state.setMember('member-1')
    expect(reads).toHaveLength(0)
    state.setActive(true)
    expect(reads).toHaveLength(1)
  })

  it('6.7-UNIT-023 empty, none and failed reads render nothing', async () => {
    const { state, reads, settle } = harness()
    state.setActive(true)
    state.setMember('member-1')
    await settle(0, { level: 'none', label: null, items: [], nextCursor: null })
    expect(state.getSnapshot()).toBeNull()
    vi.advanceTimersByTime(SPOTLIGHT_TEASER_READ_FLOOR_MS)
    state.trigger()
    await settle(1, new Error('503 disabled'))
    expect(state.getSnapshot()).toBeNull()
    expect(reads).toHaveLength(2)
  })

  it('6.7-UNIT-024 re-reads 4 minutes after the last attempt and keeps the value until it settles', async () => {
    const { state, reads, settle } = harness()
    state.setActive(true)
    state.setMember('member-1')
    // The read takes 2 seconds; the re-read anchors to its start, not its end.
    await vi.advanceTimersByTimeAsync(2000)
    await settle(0, page('post-1'))
    await vi.advanceTimersByTimeAsync(SPOTLIGHT_TEASER_REREAD_MS - 2001)
    expect(reads).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(reads).toHaveLength(2)
    expect(state.isReading()).toBe(true)
    expect(state.getSnapshot()?.item.id).toBe('post-1')
    // A different rank-1 entry replaces the content in place.
    await settle(1, page('post-2'))
    expect(state.getSnapshot()?.item.id).toBe('post-2')
  })

  it('6.7-UNIT-025 expires 5 minutes after the read completed without a successful re-read', async () => {
    const { state, reads, settle } = harness()
    state.setActive(true)
    state.setMember('member-1')
    await vi.advanceTimersByTimeAsync(3000)
    await settle(0, page())
    // The 4-minute re-read starts and hangs past expiry.
    await vi.advanceTimersByTimeAsync(SPOTLIGHT_TEASER_REREAD_MS - 3000)
    expect(reads).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(
      SPOTLIGHT_TEASER_EXPIRY_MS - SPOTLIGHT_TEASER_REREAD_MS + 2999
    )
    expect(state.getSnapshot()).not.toBeNull()
    await vi.advanceTimersByTimeAsync(1)
    expect(state.getSnapshot()).toBeNull()
  })

  it('6.7-UNIT-026 expiry still runs while the surface is inactive', async () => {
    const { state, reads, settle } = harness()
    state.setActive(true)
    state.setMember('member-1')
    await settle(0, page())
    state.setActive(false)
    await vi.advanceTimersByTimeAsync(SPOTLIGHT_TEASER_EXPIRY_MS)
    expect(state.getSnapshot()).toBeNull()
    expect(reads).toHaveLength(1)
  })

  it('6.7-UNIT-027 a failed re-read removes the teaser and schedules no timed retry', async () => {
    const { state, reads, settle } = harness()
    state.setActive(true)
    state.setMember('member-1')
    await settle(0, page())
    await vi.advanceTimersByTimeAsync(SPOTLIGHT_TEASER_REREAD_MS)
    await settle(1, new Error('500'))
    expect(state.getSnapshot()).toBeNull()
    await vi.advanceTimersByTimeAsync(SPOTLIGHT_TEASER_REREAD_MS * 3)
    expect(reads).toHaveLength(2)
    // The next focus, foreground or visibility trigger reads again.
    state.trigger()
    expect(reads).toHaveLength(3)
  })

  it('6.7-UNIT-028 a quick return inside 60 seconds reads nothing and keeps the value', async () => {
    const { state, reads, settle } = harness()
    state.setActive(true)
    state.setMember('member-1')
    await settle(0, page())
    state.setActive(false)
    await vi.advanceTimersByTimeAsync(SPOTLIGHT_TEASER_READ_FLOOR_MS - 1)
    state.setActive(true)
    state.trigger()
    expect(reads).toHaveLength(1)
    expect(state.getSnapshot()?.item.id).toBe('post-1')
    state.setActive(false)
    await vi.advanceTimersByTimeAsync(1)
    state.setActive(true)
    expect(reads).toHaveLength(2)
  })

  it('6.7-UNIT-029 reads at most once per 60 seconds even after a failure', async () => {
    const { state, reads, settle } = harness()
    state.setActive(true)
    state.setMember('member-1')
    await settle(0, new Error('network'))
    state.trigger()
    state.setActive(false)
    state.setActive(true)
    expect(reads).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(SPOTLIGHT_TEASER_READ_FLOOR_MS)
    state.trigger()
    expect(reads).toHaveLength(2)
  })

  it('6.7-UNIT-039 a quick return re-arms the timed re-read from the last attempt', async () => {
    const { state, reads, settle } = harness()
    state.setActive(true)
    state.setMember('member-1')
    await settle(0, page())
    state.setActive(false)
    await vi.advanceTimersByTimeAsync(30_000)
    state.setActive(true)
    expect(reads).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(SPOTLIGHT_TEASER_REREAD_MS - 30_001)
    expect(reads).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(reads).toHaveLength(2)
    expect(state.getSnapshot()?.item.id).toBe('post-1')
  })

  it('6.7-UNIT-040 a successful read with nothing to show still schedules the timed re-read', async () => {
    const { state, reads, settle } = harness()
    state.setActive(true)
    state.setMember('member-1')
    await settle(0, { level: 'none', label: null, items: [], nextCursor: null })
    expect(state.getSnapshot()).toBeNull()
    await vi.advanceTimersByTimeAsync(SPOTLIGHT_TEASER_REREAD_MS - 1)
    expect(reads).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(reads).toHaveLength(2)
    // The cohort became eligible: the timed re-read shows it without a trigger.
    await settle(1, page('post-2'))
    expect(state.getSnapshot()?.item.id).toBe('post-2')
  })

  it.each<[string, CommunityReactionSpotlight]>([
    ['level none', { level: 'none', label: null, items: [], nextCursor: null }],
    ['no items', { ...page(), items: [] }],
  ])(
    '6.7-UNIT-041 a re-read that answers %s removes the withdrawn entry and keeps re-reading',
    async (_, withdrawn) => {
      const { state, reads, settle } = harness()
      const changes = vi.fn()
      state.subscribe(changes)
      state.setActive(true)
      state.setMember('member-1')
      await settle(0, page('post-1'))
      expect(state.getSnapshot()?.item.id).toBe('post-1')
      changes.mockClear()
      await vi.advanceTimersByTimeAsync(SPOTLIGHT_TEASER_REREAD_MS)
      await settle(1, withdrawn)
      expect(state.getSnapshot()).toBeNull()
      expect(changes).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(SPOTLIGHT_TEASER_REREAD_MS)
      expect(reads).toHaveLength(3)
    }
  )

  it('6.7-UNIT-042 a quick return after a failed read arms no timed retry', async () => {
    const { state, reads, settle } = harness()
    state.setActive(true)
    state.setMember('member-1')
    await settle(0, new Error('500'))
    state.setActive(false)
    await vi.advanceTimersByTimeAsync(30_000)
    state.setActive(true)
    await vi.advanceTimersByTimeAsync(SPOTLIGHT_TEASER_REREAD_MS * 2)
    expect(reads).toHaveLength(1)
    // Only the next focus, foreground or visibility trigger reads again.
    state.trigger()
    expect(reads).toHaveLength(2)
  })

  it('6.7-UNIT-030 a 429 Retry-After defers the next read until it passes', async () => {
    const { state, reads, settle } = harness()
    state.setActive(true)
    state.setMember('member-1')
    await settle(0, new RateLimited(90))
    await vi.advanceTimersByTimeAsync(SPOTLIGHT_TEASER_READ_FLOOR_MS)
    state.trigger()
    expect(reads).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(30_000 - 1)
    state.trigger()
    expect(reads).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    state.trigger()
    expect(reads).toHaveLength(2)
  })

  it('6.7-UNIT-031 an identity change clears the value, aborts the read, drops the late response and resets the floor', async () => {
    const { state, reads, settle } = harness()
    state.setActive(true)
    state.setMember('member-1')
    await settle(0, page('post-1'))
    await vi.advanceTimersByTimeAsync(SPOTLIGHT_TEASER_REREAD_MS)
    expect(reads).toHaveLength(2)
    state.setMember('member-2')
    expect(state.getSnapshot()).toBeNull()
    expect(reads[1]!.signal.aborted).toBe(true)
    // The new member reads at once, inside the old member's 60-second floor.
    expect(reads).toHaveLength(3)
    await settle(1, page('late-for-member-1'))
    expect(state.getSnapshot()).toBeNull()
    await settle(2, page('post-for-member-2'))
    expect(state.getSnapshot()).toMatchObject({
      memberId: 'member-2',
      item: { id: 'post-for-member-2' },
    })
  })

  it('6.7-UNIT-036 honors a long finite Retry-After to the millisecond', async () => {
    const { state, reads, settle } = harness()
    state.setActive(true)
    state.setMember('member-1')
    await settle(0, new RateLimited(600))
    // Past the floor, the re-read interval and the value's expiry: still deferred.
    await vi.advanceTimersByTimeAsync(SPOTLIGHT_TEASER_EXPIRY_MS + 1_000)
    state.trigger()
    expect(reads).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(600_000 - SPOTLIGHT_TEASER_EXPIRY_MS - 1_000 - 1)
    state.trigger()
    expect(reads).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    state.trigger()
    expect(reads).toHaveLength(2)
  })

  it.each([
    ['infinity', Number.POSITIVE_INFINITY],
    ['NaN', Number.NaN],
    ['zero', 0],
    ['minus 30', -30],
  ])(
    '6.7-UNIT-043 ignores a Retry-After of %s and keeps only the read floor',
    async (_label, retryAfterSeconds) => {
      const { state, reads, settle } = harness()
      state.setActive(true)
      state.setMember('member-1')
      await settle(0, new RateLimited(retryAfterSeconds))
      await vi.advanceTimersByTimeAsync(SPOTLIGHT_TEASER_READ_FLOOR_MS - 1)
      state.trigger()
      expect(reads).toHaveLength(1)
      await vi.advanceTimersByTimeAsync(1)
      state.trigger()
      expect(reads).toHaveLength(2)
    }
  )

  it('6.7-UNIT-032 the Retry-After deferral belongs to the member who earned it', async () => {
    const { state, reads, settle } = harness()
    state.setActive(true)
    state.setMember('member-1')
    await settle(0, new RateLimited(600))
    state.setMember('member-2')
    expect(reads).toHaveLength(2)
  })

  it('6.7-UNIT-033 sign-out clears the value and reads nothing', async () => {
    const { state, reads, settle } = harness()
    state.setActive(true)
    state.setMember('member-1')
    await settle(0, page())
    state.setMember(null)
    expect(state.getSnapshot()).toBeNull()
    await vi.advanceTimersByTimeAsync(SPOTLIGHT_TEASER_EXPIRY_MS * 2)
    state.trigger()
    expect(reads).toHaveLength(1)
  })

  it('6.7-UNIT-034 an image failure removes the value; the next timed re-read may restore it', async () => {
    const { state, reads, settle } = harness()
    state.setActive(true)
    state.setMember('member-1')
    await settle(0, page())
    state.removeValue()
    expect(state.getSnapshot()).toBeNull()
    await vi.advanceTimersByTimeAsync(SPOTLIGHT_TEASER_REREAD_MS)
    await settle(1, page('post-2'))
    expect(state.getSnapshot()?.item.id).toBe('post-2')
    expect(reads).toHaveLength(2)
  })

  it('6.7-UNIT-037 drops a late failure from an earlier member and ignores a repeated activity signal', async () => {
    const { state, reads, settle } = harness()
    state.setActive(true)
    state.setActive(true)
    expect(reads).toHaveLength(0)
    state.setMember('member-1')
    await settle(0, page('post-1'))
    await vi.advanceTimersByTimeAsync(SPOTLIGHT_TEASER_REREAD_MS)
    state.setMember('member-2')
    await settle(2, page('post-2'))
    // Member 1's re-read fails after the change: no deferral, no removal.
    await settle(1, new RateLimited(600))
    expect(state.getSnapshot()?.item.id).toBe('post-2')
    await vi.advanceTimersByTimeAsync(SPOTLIGHT_TEASER_READ_FLOOR_MS)
    state.trigger()
    expect(reads).toHaveLength(4)
  })

  it('6.7-UNIT-038 an unsubscribed listener hears nothing more', async () => {
    const { state, settle } = harness()
    const listener = vi.fn()
    const unsubscribe = state.subscribe(listener)
    unsubscribe()
    state.setActive(true)
    state.setMember('member-1')
    await settle(0, page())
    expect(listener).not.toHaveBeenCalled()
  })

  it('6.7-UNIT-035 notifies subscribers on every change and stops after dispose', async () => {
    const { state, reads, settle } = harness()
    const listener = vi.fn()
    state.subscribe(listener)
    state.setActive(true)
    state.setMember('member-1')
    await settle(0, page())
    expect(listener).toHaveBeenCalledTimes(1)
    state.dispose()
    await vi.advanceTimersByTimeAsync(SPOTLIGHT_TEASER_EXPIRY_MS * 2)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(reads).toHaveLength(1)
  })
})
