// Story 6.6 I/O matrix: pinned snapshots, signed cursors and live rechecks across
// pages, against a real PG17 database and an owned Redis key space.
import { describe, expect, it } from 'vitest'
import { COMMUNITY_SPOTLIGHT_READS_PER_MINUTE } from '@couture/api-client/contracts/http'
import { CommunityRateLimitException } from '../src/modules/community/community-rate-limit.exception.js'
import { areaComponentsOf } from '../src/modules/community/community-spotlight-area.js'
import {
  SPOTLIGHT_TEST_AS_OF,
  SPOTLIGHT_TEST_NOW,
  hoursBeforeAsOf,
  spotlightTestContext,
} from './helpers/community-spotlight-context.js'

const ctx = spotlightTestContext('paging')
const INVALID = { response: { statusCode: 400, code: 'invalid_cursor' } }

async function publish(
  author: string,
  area: ReturnType<typeof ctx.area>,
  publishedAt: Date,
  id: string
) {
  const components = areaComponentsOf(area)
  await ctx.prisma.lookbookPost.create({
    data: {
      id,
      user_id: author,
      status: 'published',
      caption: id,
      alt_text: `Alt ${id}`,
      image_object_path: `community/${id}/spotlight.png`,
      alt_text_confirmed_at: publishedAt,
      submitted_at: publishedAt,
      published_at: publishedAt,
      area_country: components.country,
      area_region: components.region,
      area_city: components.city,
    },
  })
  return id
}

describe('6.6 spotlight paging', () => {
  it('6.6-INT-040 pages a pinned snapshot by rank with a signed next cursor', async () => {
    const area = ctx.area('pages')
    const cohort = await ctx.cohort(area, 8)
    const viewer = await ctx.member(area)
    const first = await ctx.read(viewer)
    expect(first.items.map((item) => item.rank)).toEqual([1, 2, 3, 4, 5, 6])
    expect(first.nextCursor).toEqual(expect.any(String))
    const second = await ctx.read(viewer, { cursor: first.nextCursor! })
    expect(second).toMatchObject({ level: 'city', label: area.city, nextCursor: null })
    expect(second.items.map((item) => item.id)).toEqual(cohort.expectedOrder.slice(6))
    expect(second.items.map((item) => item.rank)).toEqual([7, 8])
  })

  it('6.6-INT-041 takedown mid-scroll is skipped by index: no entry repeats or shifts', async () => {
    const area = ctx.area('takedown')
    const cohort = await ctx.cohort(area, 9)
    const viewer = await ctx.member(area)
    const first = await ctx.read(viewer)
    const removed = cohort.expectedOrder[6]!
    await ctx.repository.withdrawPostAndRequestErasure(removed, new Date())
    const second = await ctx.read(viewer, { cursor: first.nextCursor! })
    expect(second.items.map((item) => [item.id, item.rank])).toEqual([
      [cohort.expectedOrder[7], 8],
      [cohort.expectedOrder[8], 9],
    ])
    const restarted = await ctx.read(viewer, { limit: 12 })
    expect(restarted.items.map((item) => item.id)).not.toContain(removed)
    // A snapshot entry that failed live visibility forced a rebuild, so ranks close up.
    expect(restarted.items.map((item) => item.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
  })

  it('6.6-INT-042 fifth author erased outside the top 60: page one falls to region, old cursors die', async () => {
    const area = ctx.area('erased-fifth')
    const authors = [] as string[]
    for (let index = 0; index < 5; index += 1) authors.push(await ctx.member())
    for (let index = 0; index < 60; index += 1) {
      const author = authors[index % 4]!
      const id = await publish(
        author,
        area,
        hoursBeforeAsOf(index + 1),
        `${area.city}-top-${index}`
      )
      await ctx.react(authors[(index + 1) % 4]!, id, 'love')
    }
    const tail = await publish(
      authors[4]!,
      area,
      hoursBeforeAsOf(150),
      `${area.city}-tail`
    )
    await ctx.react(authors[0]!, tail, 'applause')
    // A neighbouring city keeps the region above the cohort without the fifth author.
    await ctx.cohort({ ...area, city: `${area.city} East` }, 5)
    const viewer = await ctx.member(area)
    const first = await ctx.read(viewer)
    expect(first.level).toBe('city')
    expect(first.nextCursor).not.toBeNull()

    await ctx.repository.requestErasureForUser(authors[4]!, new Date())
    // No invalidator run: the live cohort count alone decides the level.
    const after = await ctx.read(viewer)
    expect(after).toMatchObject({ level: 'region', label: area.region })
    await expect(ctx.read(viewer, { cursor: first.nextCursor! })).rejects.toMatchObject(
      INVALID
    )
  })

  it('6.6-INT-043 refuses a foreign cursor and a cursor from an area the viewer left', async () => {
    const area = ctx.area('foreign')
    await ctx.cohort(area, 8)
    const viewer = await ctx.member(area)
    const neighbour = await ctx.member(area)
    const first = await ctx.read(viewer)
    await expect(
      ctx.read(neighbour, { cursor: first.nextCursor! })
    ).rejects.toMatchObject(INVALID)

    const elsewhere = ctx.area('moved')
    await ctx.cohort(elsewhere, 5)
    await ctx.prisma.savedLocation.updateMany({
      where: { user_id: viewer },
      data: {
        country: elsewhere.country,
        region: elsewhere.region,
        city: elsewhere.city,
      },
    })
    await expect(ctx.read(viewer, { cursor: first.nextCursor! })).rejects.toMatchObject(
      INVALID
    )
    await expect(ctx.read(viewer, { cursor: 'forged.cursor' })).rejects.toMatchObject(
      INVALID
    )
  })

  it("6.6-INT-044 later pages recheck the cohort at the snapshot's own as_of", async () => {
    const area = ctx.area('recheck')
    const cohort = await ctx.cohort(area, 7)
    // An outside reactor keeps the remaining posts eligible once authors leave,
    // because erasure also removes the leaving authors' own reactions.
    const outsider = await ctx.member()
    for (const post of cohort.posts) await ctx.react(outsider, post.id, 'love')
    const viewer = await ctx.member(area)
    const first = await ctx.read(viewer)
    // Three authors leave the cohort at the snapshot's as_of while a new author
    // publishes after it, so the level still resolves to the city right now.
    await ctx.repository.requestErasureForUser(cohort.authorIds[5]!, new Date())
    await ctx.repository.requestErasureForUser(cohort.authorIds[6]!, new Date())
    await ctx.repository.requestErasureForUser(cohort.authorIds[4]!, new Date())
    const newcomer = await ctx.member()
    const late = await publish(
      newcomer,
      area,
      new Date(SPOTLIGHT_TEST_AS_OF.getTime() + 30_000),
      `${area.city}-late`
    )
    await ctx.react(cohort.authorIds[0]!, late, 'love')
    ctx.clock.current = new Date(SPOTLIGHT_TEST_NOW.getTime() + 60_000)
    expect((await ctx.read(viewer)).level).toBe('city')
    await expect(ctx.read(viewer, { cursor: first.nextCursor! })).rejects.toMatchObject(
      INVALID
    )
  })

  it('6.6-INT-045 an expired snapshot recomputes at the cursor as_of and continues when identical', async () => {
    const area = ctx.area('expired')
    const cohort = await ctx.cohort(area, 8)
    const viewer = await ctx.member(area)
    const first = await ctx.read(viewer)
    const keys = await ctx.redis.keys(`${ctx.prefix}:snapshot:*`)
    await ctx.redis.del(...keys)
    ctx.clock.current = new Date(SPOTLIGHT_TEST_NOW.getTime() + 120_000)
    const second = await ctx.read(viewer, { cursor: first.nextCursor! })
    expect(second.items.map((item) => item.id)).toEqual(cohort.expectedOrder.slice(6))
  })

  it("6.6-INT-046 labels with the viewer's own saved spelling, never an author's", async () => {
    const area = ctx.area('label')
    await ctx.cohort(area)
    const viewer = await ctx.member({
      country: area.country,
      region: area.region,
      city: `  ${area.city.toUpperCase()} `,
    })
    await expect(ctx.read(viewer)).resolves.toMatchObject({
      level: 'city',
      label: area.city.toUpperCase(),
    })
  })
})

describe('6.6 spotlight read limit', () => {
  it('6.6-INT-070 allows 30 spotlight reads a minute, cursor pages included, and resets each minute', async () => {
    const area = ctx.area('read-limit')
    await ctx.cohort(area, 5)
    const viewer = await ctx.member(area)
    expect(COMMUNITY_SPOTLIGHT_READS_PER_MINUTE).toBe(30)
    const first = await ctx.read(viewer, { limit: 2 })
    // Replaying one cursor is counted like any other read.
    for (let read = 1; read < 30; read += 1)
      await expect(
        ctx.read(viewer, { limit: 2, cursor: first.nextCursor! })
      ).resolves.toMatchObject({ level: 'city' })
    for (const cursor of [first.nextCursor!, undefined]) {
      const refused = await ctx
        .read(viewer, { limit: 2, ...(cursor ? { cursor } : {}) })
        .catch((error: unknown) => error)
      expect(refused).toBeInstanceOf(CommunityRateLimitException)
      // SPOTLIGHT_TEST_NOW is 30 seconds into its minute.
      expect((refused as CommunityRateLimitException).retryAfterSeconds).toBe(30)
      expect((refused as CommunityRateLimitException).getStatus()).toBe(429)
    }

    // Another member keeps a separate window.
    const neighbour = await ctx.member(area)
    await expect(ctx.read(neighbour)).resolves.toMatchObject({ level: 'city' })

    ctx.clock.current = new Date(SPOTLIGHT_TEST_NOW.getTime() + 30_000)
    await expect(ctx.read(viewer, { limit: 2 })).resolves.toMatchObject({ level: 'city' })
    await expect(
      ctx.prisma.communitySpotlightReadWindow.findUniqueOrThrow({
        where: { user_id: viewer },
      })
    ).resolves.toMatchObject({ reads: 1 })
  })
})
