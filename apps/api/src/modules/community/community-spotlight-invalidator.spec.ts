// Story 6.6: the invalidator's failure branches. The happy paths, the retention
// floor and the Redis retry run against real services in
// integration/community-spotlight-invalidation.integration.spec.ts.
import type { PrismaClient } from '@prisma/client'
import { describe, expect, it, vi } from 'vitest'
import { areaComponentsOf, areaHashesOf } from './community-spotlight-area'
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
    const area = { area_country: 'pt', area_region: 'lisboa', area_city: 'lisbon' }
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
    expect(cache.bumpAreas).toHaveBeenCalledWith(
      areaHashesOf(areaComponentsOf({ country: 'pt', region: 'lisboa', city: 'lisbon' }))
    )
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
})
