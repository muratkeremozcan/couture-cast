// Story 6.6: the invalidator's failure branches. The happy paths, the retention
// floor and the Redis retry run against real services in
// integration/community-spotlight-invalidation.integration.spec.ts.
import type { PrismaClient } from '@prisma/client'
import { describe, expect, it, vi } from 'vitest'
import { areaHashesOf, storedAreaComponents } from './community-spotlight-area'
import type { CommunitySpotlightCache } from './community-spotlight-cache'
import { CommunitySpotlightInvalidator } from './community-spotlight-invalidator'

const HEAD = { epoch: 'epoch-1', sequence: 9n, retention_floor: 0n }

function boundary(overrides: {
  head?: unknown
  cursor?: unknown
  events?: unknown[]
  posts?: unknown[]
  fail?: 'head' | 'posts' | 'advance'
}) {
  const reject = () => Promise.reject(new Error('database unavailable'))
  const prisma = {
    communityStreamHead: {
      findUnique: vi.fn(() =>
        overrides.fail === 'head' ? reject() : Promise.resolve(overrides.head ?? HEAD)
      ),
    },
    communitySpotlightCursor: {
      findUnique: vi.fn(() => Promise.resolve(overrides.cursor ?? null)),
      updateMany: vi.fn(() =>
        overrides.fail === 'advance' ? reject() : Promise.resolve({ count: 1 })
      ),
      upsert: vi.fn(() => Promise.resolve({})),
    },
    communityStreamEvent: {
      findMany: vi.fn(() => Promise.resolve(overrides.events ?? [])),
    },
    lookbookPost: {
      findMany: vi.fn(() =>
        overrides.fail === 'posts' ? reject() : Promise.resolve(overrides.posts ?? [])
      ),
    },
  }
  const cache = {
    bumpEpoch: vi.fn(() => Promise.resolve()),
    bumpAreas: vi.fn(() => Promise.resolve()),
  }
  return {
    prisma,
    cache,
    invalidator: new CommunitySpotlightInvalidator(
      prisma as unknown as PrismaClient,
      cache as unknown as CommunitySpotlightCache
    ),
  }
}

describe('6.6 spotlight invalidator', () => {
  it('6.6-UNIT-030 idles without a public stream head', async () => {
    const { invalidator, cache, prisma } = boundary({})
    prisma.communityStreamHead.findUnique.mockResolvedValueOnce(null as never)
    await expect(invalidator.process()).resolves.toEqual({ status: 'idle' })
    expect(cache.bumpEpoch).not.toHaveBeenCalled()
  })

  it('6.6-UNIT-031 starts at the head with an epoch bump on first run', async () => {
    const { invalidator, cache, prisma } = boundary({})
    await expect(invalidator.process()).resolves.toEqual({
      status: 'resumed_at_head',
      position: 9n,
    })
    expect(cache.bumpEpoch).toHaveBeenCalledTimes(1)
    expect(prisma.communitySpotlightCursor.upsert).toHaveBeenCalled()
  })

  it('6.6-UNIT-032 maps area events to their versions and unmappable events to the epoch', async () => {
    const area = { area_country: 'PT', area_region: 'lisboa', area_city: 'lisbon' }
    const { invalidator, cache } = boundary({
      cursor: { epoch: 'epoch-1', position: 4n },
      events: [
        { sequence: 5n, kind: 'reactions.changed', post_id: 'post-1' },
        { sequence: 6n, kind: 'reactions.changed', post_id: 'post-gone' },
      ],
      posts: [{ id: 'post-1', ...area }],
    })
    await expect(invalidator.process()).resolves.toEqual({
      status: 'advanced',
      processed: 2,
      position: 6n,
    })
    expect(cache.bumpEpoch).toHaveBeenCalledTimes(1)
    expect(cache.bumpAreas).toHaveBeenCalledWith(areaHashesOf(storedAreaComponents(area)))
  })

  it('6.6-UNIT-035 leaves epoch and versions alone for a live never-stamped post', async () => {
    const { invalidator, cache, prisma } = boundary({
      cursor: { epoch: 'epoch-1', position: 4n },
      events: [{ sequence: 5n, kind: 'reactions.changed', post_id: 'post-unstamped' }],
      posts: [
        {
          id: 'post-unstamped',
          area_country: null,
          area_region: null,
          area_city: null,
          anonymized_at: null,
          erasure_requested_at: null,
        },
      ],
    })
    await expect(invalidator.process()).resolves.toEqual({
      status: 'advanced',
      processed: 1,
      position: 5n,
    })
    expect(cache.bumpEpoch).not.toHaveBeenCalled()
    expect(cache.bumpAreas).toHaveBeenCalledWith([])
    const [advance] = prisma.communitySpotlightCursor.updateMany.mock
      .calls[0] as unknown as [{ data: { position: bigint } }]
    expect(advance.data.position).toBe(5n)
  })

  it('6.6-UNIT-036 bumps the epoch for an anonymized or erasure-requested post', async () => {
    for (const cleared of [
      { anonymized_at: new Date(), erasure_requested_at: null },
      { anonymized_at: null, erasure_requested_at: new Date() },
    ]) {
      const { invalidator, cache } = boundary({
        cursor: { epoch: 'epoch-1', position: 4n },
        events: [{ sequence: 5n, kind: 'post.updated', post_id: 'post-erased' }],
        posts: [
          {
            id: 'post-erased',
            area_country: 'PT',
            area_region: 'lisboa',
            area_city: 'lisbon',
            ...cleared,
          },
        ],
      })
      await expect(invalidator.process()).resolves.toMatchObject({ status: 'advanced' })
      expect(cache.bumpEpoch).toHaveBeenCalledTimes(1)
      expect(cache.bumpAreas).toHaveBeenCalledWith([])
    }
  })

  it('6.6-UNIT-033 defers on database failures before and after Redis, never throwing', async () => {
    for (const fail of ['head', 'posts', 'advance'] as const) {
      const { invalidator } = boundary({
        fail,
        cursor: { epoch: 'epoch-1', position: 4n },
        events: [{ sequence: 5n, kind: 'reactions.changed', post_id: 'post-1' }],
      })
      await expect(invalidator.process()).resolves.toEqual({
        status: 'deferred',
        reason: 'database_unavailable',
      })
    }
  })

  it('6.6-UNIT-034 defers a first-run epoch bump that Redis refuses', async () => {
    const { invalidator, cache, prisma } = boundary({})
    cache.bumpEpoch.mockRejectedValueOnce(new Error('Connection is closed.'))
    await expect(invalidator.process()).resolves.toEqual({
      status: 'deferred',
      reason: 'redis_unavailable',
    })
    expect(prisma.communitySpotlightCursor.upsert).not.toHaveBeenCalled()
  })

  it('6.6-UNIT-037 bounds a stalled pass and never starts a second one beside it', async () => {
    vi.useFakeTimers()
    try {
      const { invalidator, cache } = boundary({})
      cache.bumpEpoch.mockImplementation(() => new Promise<never>(() => undefined))
      const first = invalidator.processWithin(2000)
      await vi.advanceTimersByTimeAsync(1999)
      await expect(invalidator.processWithin(2000)).resolves.toEqual({
        status: 'deferred',
        reason: 'in_flight',
      })
      await vi.advanceTimersByTimeAsync(1)
      await expect(first).resolves.toEqual({ status: 'deferred', reason: 'timeout' })
      expect(cache.bumpEpoch).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('6.6-UNIT-038 a pass inside its budget returns its own outcome and frees the slot', async () => {
    const { invalidator, cache } = boundary({})
    await expect(invalidator.processWithin()).resolves.toMatchObject({
      status: 'resumed_at_head',
    })
    await expect(invalidator.processWithin()).resolves.toMatchObject({
      status: 'resumed_at_head',
    })
    expect(cache.bumpEpoch).toHaveBeenCalledTimes(2)
  })
})
