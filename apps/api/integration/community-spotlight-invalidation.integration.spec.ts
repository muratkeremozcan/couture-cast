// Story 6.6 I/O matrix: the Redis read model, its invalidator and the rebuild race,
// against a real PG17 database and an owned Redis key space.
import { describe, expect, it, vi } from 'vitest'
import {
  areaComponentsOf,
  areaHash,
} from '../src/modules/community/community-spotlight-area.js'
import { CommunitySpotlightCache } from '../src/modules/community/community-spotlight-cache.js'
import { CommunitySpotlightInvalidator } from '../src/modules/community/community-spotlight-invalidator.js'
import { CommunitySpotlightRepository } from '../src/modules/community/community-spotlight.repository.js'
import {
  hoursBeforeAsOf,
  spotlightTestContext,
  unavailableRedis,
} from './helpers/community-spotlight-context.js'
import { buildLookbookPostCreateInput, createLookbookPost } from '@couture/testing'

const ctx = spotlightTestContext('invalidation')

async function primedArea(label: string, authors = 5) {
  const area = ctx.area(label)
  const cohort = await ctx.cohort(area, authors)
  const viewer = await ctx.member(area)
  await ctx.drain()
  const first = await ctx.read(viewer, { limit: 12 })
  return { area, cohort, viewer, first, hash: areaHash(areaComponentsOf(area), 'city') }
}

async function freshPost(author: string, area: ReturnType<typeof ctx.area>) {
  const normalized = areaComponentsOf(area)
  const fixture = createLookbookPost(
    {
      userId: author,
      areaCountry: normalized.country,
      areaRegion: normalized.region,
      areaCity: normalized.city,
      publishedAt: hoursBeforeAsOf(0.5),
    },
    { now: hoursBeforeAsOf(0.5) }
  )
  await ctx.prisma.lookbookPost.create({ data: buildLookbookPostCreateInput(fixture) })
  return fixture.id
}

describe('6.6 spotlight read model', () => {
  it('6.6-INT-020 a reaction on a snapshot post rebuilds on the very next page one, without the invalidator', async () => {
    const { cohort, viewer, first } = await primedArea('in-snapshot')
    const rank = vi.spyOn(ctx.spotlightRepository, 'rank')
    const cached = await ctx.read(viewer, { limit: 12 })
    expect(cached.items.map((item) => [item.id, item.rank])).toEqual(
      first.items.map((item) => [item.id, item.rank])
    )
    expect(rank).not.toHaveBeenCalled()

    const last = cohort.expectedOrder.at(-1)!
    const totalBefore = first.items.find((item) => item.id === last)!.reactions!.total
    await ctx.react(await ctx.member(), last, 'love')
    const rebuilt = await ctx.read(viewer, { limit: 12 })
    expect(rank).toHaveBeenCalledTimes(1)
    expect(rebuilt.items.find((item) => item.id === last)!.reactions!.total).toBe(
      totalBefore + 1
    )
    rank.mockRestore()
  })

  it('6.6-INT-021 a post gaining its first reaction appears after the invalidator processes its event', async () => {
    const { area, cohort, viewer } = await primedArea('outside-snapshot')
    const newcomer = await freshPost(await ctx.member(), area)
    await ctx.react(cohort.authorIds[0]!, newcomer, 'applause')

    // The cached snapshot still answers until its area version moves.
    expect((await ctx.read(viewer, { limit: 12 })).items.map((i) => i.id)).not.toContain(
      newcomer
    )
    await expect(ctx.drain()).resolves.toMatchObject({ status: 'advanced' })
    expect((await ctx.read(viewer, { limit: 12 })).items.map((i) => i.id)).toContain(
      newcomer
    )
  })

  it('6.6-INT-022 Redis failure defers the invalidator without moving its cursor, then it retries', async () => {
    const { area, cohort, viewer } = await primedArea('retry')
    const before = await ctx.prisma.communitySpotlightCursor.findUniqueOrThrow({
      where: { id: 'public' },
    })
    const newcomer = await freshPost(await ctx.member(), area)
    await ctx.react(cohort.authorIds[1]!, newcomer, 'love')
    while ((await ctx.streams.append()) > 0) {
      // drain the outbox into appended events
    }
    const failing = new CommunitySpotlightInvalidator(
      ctx.prisma,
      new CommunitySpotlightCache(unavailableRedis, ctx.prefix)
    )
    await expect(failing.process()).resolves.toEqual({
      status: 'deferred',
      reason: 'redis_unavailable',
    })
    const unchanged = await ctx.prisma.communitySpotlightCursor.findUniqueOrThrow({
      where: { id: 'public' },
    })
    expect(unchanged.position).toBe(before.position)
    expect((await ctx.read(viewer, { limit: 12 })).items.map((i) => i.id)).not.toContain(
      newcomer
    )

    await expect(ctx.invalidator.process()).resolves.toMatchObject({ status: 'advanced' })
    expect((await ctx.read(viewer, { limit: 12 })).items.map((i) => i.id)).toContain(
      newcomer
    )
  })

  it('6.6-INT-023 a rebuild racing an invalidation never publishes its stale pointer', async () => {
    const { area, cohort, viewer, hash } = await primedArea('race')
    const newcomer = await freshPost(await ctx.member(), area)
    await ctx.drain()
    const unspied = new CommunitySpotlightRepository(ctx.prisma)
    const rank = vi.spyOn(ctx.spotlightRepository, 'rank')
    // Force a rebuild, then let a commit land after the builder read the area
    // version and its rows but before it publishes.
    await ctx.cache.bumpAreas([hash])
    rank.mockImplementationOnce(async (...args) => {
      const result = await unspied.rank(...args)
      await ctx.react(cohort.authorIds[2]!, newcomer, 'love')
      await ctx.drain()
      return result
    })
    const stale = await ctx.read(viewer, { limit: 12 })
    expect(stale.items.map((i) => i.id)).not.toContain(newcomer)
    const counters = await ctx.cache.counters(hash)
    await expect(ctx.cache.current('city', hash, counters)).resolves.toBeNull()
    rank.mockRestore()
    expect((await ctx.read(viewer, { limit: 12 })).items.map((i) => i.id)).toContain(
      newcomer
    )
  })

  it('6.6-INT-024 the compare-and-set refuses a pointer whose area version moved', async () => {
    const { hash } = await primedArea('cas')
    const counters = await ctx.cache.counters(hash)
    const current = await ctx.cache.current('city', hash, counters)
    expect(current).not.toBeNull()
    await ctx.cache.bumpAreas([hash])
    await expect(ctx.cache.publish(current!, counters)).resolves.toBe(false)
    await expect(
      ctx.cache.current('city', hash, await ctx.cache.counters(hash))
    ).resolves.toBeNull()
  })

  it('6.6-INT-025 a resync event bumps the global epoch and orphans every pointer', async () => {
    const { viewer, cohort, hash } = await primedArea('resync')
    const epoch = await ctx.redis.get(ctx.cache.epochKey())
    const counters = await ctx.cache.counters(hash)
    expect(await ctx.cache.current('city', hash, counters)).not.toBeNull()
    const { sequence: headBefore } =
      await ctx.prisma.communityStreamHead.findUniqueOrThrow({
        where: { id: 'public' },
      })
    // Deleting a published post leaves only an anonymous resync marker.
    await ctx.prisma.communityReaction.deleteMany({
      where: { post_id: cohort.posts.at(-1)!.id },
    })
    await ctx.prisma.lookbookPost.delete({ where: { id: cohort.posts.at(-1)!.id } })
    await ctx.drain()
    // A missing post also bumps the epoch, so the bump alone cannot show the
    // append converted these rows: every new public event is an anonymous resync.
    const appended = await ctx.prisma.communityStreamEvent.findMany({
      where: { stream_id: 'public', sequence: { gt: headBefore } },
      orderBy: { sequence: 'asc' },
      select: { kind: true, post_id: true },
    })
    expect(appended.length).toBeGreaterThan(0)
    for (const event of appended) expect(event).toEqual({ kind: 'resync', post_id: null })
    const after = await ctx.redis.get(ctx.cache.epochKey())
    expect(after).not.toBe(epoch)
    expect(
      await ctx.cache.current('city', hash, await ctx.cache.counters(hash))
    ).toBeNull()
    const page = await ctx.read(viewer, { limit: 12 })
    expect(page.items.map((i) => i.id)).not.toContain(cohort.posts.at(-1)!.id)
  })

  it('6.6-INT-026 a cursor behind the retention floor bumps the epoch and resumes at the head', async () => {
    await primedArea('retention')
    const head = await ctx.prisma.communityStreamHead.findUniqueOrThrow({
      where: { id: 'public' },
    })
    const epoch = await ctx.redis.get(ctx.cache.epochKey())
    await ctx.prisma.communitySpotlightCursor.update({
      where: { id: 'public' },
      data: { position: 0n },
    })
    await ctx.prisma.communityStreamHead.update({
      where: { id: 'public' },
      data: { retention_floor: head.sequence },
    })
    await expect(ctx.invalidator.process()).resolves.toEqual({
      status: 'resumed_at_head',
      position: head.sequence,
    })
    expect(await ctx.redis.get(ctx.cache.epochKey())).not.toBe(epoch)
    const cursor = await ctx.prisma.communitySpotlightCursor.findUniqueOrThrow({
      where: { id: 'public' },
    })
    expect(cursor.position).toBe(head.sequence)
  })

  it('6.6-INT-027 counters stay exact strings past 2^53 and a missing one reseeds randomly', async () => {
    const { hash } = await primedArea('counters')
    await ctx.redis.set(ctx.cache.areaVersionKey(hash), '9007199254740992')
    await ctx.cache.bumpAreas([hash])
    expect(await ctx.redis.get(ctx.cache.areaVersionKey(hash))).toBe('9007199254740993')
    expect((await ctx.cache.counters(hash)).version).toBe('9007199254740993')

    await ctx.redis.del(ctx.cache.epochKey())
    const reseeded = await ctx.cache.counters(hash)
    expect(reseeded.epoch).toMatch(/^\d+$/)
    expect(await ctx.redis.ttl(ctx.cache.epochKey())).toBe(-1)
    expect(await ctx.redis.ttl(ctx.cache.areaVersionKey(hash))).toBe(-1)
  })

  it('6.6-INT-028 snapshots and pointers expire after 600 seconds', async () => {
    const { hash } = await primedArea('ttl')
    const counters = await ctx.cache.counters(hash)
    const pointer = ctx.cache.pointerKey(counters.epoch, 'city', hash)
    const snapshot = await ctx.cache.current('city', hash, counters)
    for (const key of [pointer, ctx.cache.snapshotKey(snapshot!.id)]) {
      const ttl = await ctx.redis.ttl(key)
      expect(ttl).toBeGreaterThan(590)
      expect(ttl).toBeLessThanOrEqual(600)
    }
  })

  it('6.6-INT-029 Redis down: page one ranks from the database and page two recomputes the same snapshot', async () => {
    const area = ctx.area('redis-down')
    const cohort = await ctx.cohort(area, 8)
    const viewer = await ctx.member(area)
    const offline = ctx.serviceWith(unavailableRedis)
    const read = (cursor?: string) =>
      offline.getSpotlight({ userId: viewer, platform: 'web', limit: 6, cursor })
    const first = await read()
    expect(first.level).toBe('city')
    expect(first.items.map((i) => i.id)).toEqual(cohort.expectedOrder.slice(0, 6))
    const second = await read(first.nextCursor!)
    expect(second.items.map((i) => i.id)).toEqual(cohort.expectedOrder.slice(6))
    expect(second.items.map((i) => i.rank)).toEqual([7, 8])
    expect(second.nextCursor).toBeNull()

    // The ranking moves between pages: the last two swap, so the recomputed
    // snapshot id no longer matches the cursor.
    for (let index = 0; index < 3; index += 1)
      await ctx.react(await ctx.member(), cohort.expectedOrder.at(-1)!, 'love')
    await expect(read(first.nextCursor!)).rejects.toMatchObject({
      response: { statusCode: 400, code: 'invalid_cursor' },
    })
  })

  it('6.6-INT-030 the invalidator maps an event to its city, region and country versions', async () => {
    const { area, cohort } = await primedArea('levels')
    const components = areaComponentsOf(area)
    const keys = (['city', 'region', 'country'] as const).map((level) =>
      ctx.cache.areaVersionKey(areaHash(components, level))
    )
    const before = await Promise.all(keys.map((key) => ctx.redis.get(key)))
    await ctx.react(await ctx.member(), cohort.posts[0]!.id, 'love')
    await ctx.drain()
    const after = await Promise.all(keys.map((key) => ctx.redis.get(key)))
    after.forEach((value, index) => {
      expect(value).not.toBeNull()
      expect(value).not.toBe(before[index])
    })
  })
  it('6.6-INT-031 a reaction on a live never-stamped post moves no version and no epoch', async () => {
    const { area, hash } = await primedArea('never-stamped')
    const components = areaComponentsOf(area)
    const hashes = (['city', 'region', 'country'] as const).map((level) =>
      areaHash(components, level)
    )
    // Seed every level's counter, so a bump from a missing key also shows.
    for (const levelHash of hashes) await ctx.cache.counters(levelHash)
    const keys = [
      ctx.cache.epochKey(),
      ...hashes.map((levelHash) => ctx.cache.areaVersionKey(levelHash)),
    ]
    const before = await Promise.all(keys.map((key) => ctx.redis.get(key)))
    expect(before.every((value) => value !== null)).toBe(true)

    // Published before area stamping existed: live, visible, and in no area.
    const fixture = createLookbookPost(
      {
        userId: await ctx.member(),
        areaCountry: null,
        areaRegion: null,
        areaCity: null,
        publishedAt: hoursBeforeAsOf(0.5),
      },
      { now: hoursBeforeAsOf(0.5) }
    )
    await ctx.prisma.lookbookPost.create({ data: buildLookbookPostCreateInput(fixture) })
    await ctx.react(await ctx.member(), fixture.id, 'love')
    const { sequence: headBefore } =
      await ctx.prisma.communityStreamHead.findUniqueOrThrow({
        where: { id: 'public' },
      })

    await expect(ctx.drain()).resolves.toMatchObject({ status: 'advanced' })
    // The reaction reached the stream as an event naming the post, so the
    // invalidator really planned it and found no area to bump.
    const { sequence: headAfter } =
      await ctx.prisma.communityStreamHead.findUniqueOrThrow({
        where: { id: 'public' },
      })
    expect(headAfter).toBeGreaterThan(headBefore)
    await expect(
      ctx.prisma.communityStreamEvent.findMany({
        where: { stream_id: 'public', sequence: { gt: headBefore } },
        select: { post_id: true },
      })
    ).resolves.toContainEqual({ post_id: fixture.id })
    expect(await Promise.all(keys.map((key) => ctx.redis.get(key)))).toEqual(before)
    await expect(
      ctx.cache.current('city', hash, await ctx.cache.counters(hash))
    ).resolves.not.toBeNull()
  })
})
