// Learning path Step 44: Community city spotlight.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-44-community-city-spotlight
// Story 6.6: the City Spotlight fixtures plan a cohort whose ranking is known in
// advance and whose areas are what the API itself stamps.
import { describe, expect, it, vi } from 'vitest'
import { canonicalCountryCode, canonicalSpotlightArea } from '@couture/utils'
import {
  SEEDED_SPOTLIGHT_AREA,
  SEEDED_SPOTLIGHT_COHORT_SIZE,
  SPOTLIGHT_FIXTURE_COHORT_AUTHORS,
  buildSpotlightSavedLocationCreateInput,
  normalizeSpotlightAreaNames,
  persistSpotlightCohort,
  planSpotlightCohort,
  uniqueSpotlightArea,
} from '../src/factories/community-spotlight.factory.js'

const SEED_TIME = new Date('2026-10-22T12:00:00.000Z')
const AUTHORS = ['author-a', 'author-b', 'author-c', 'author-d', 'author-e']

describe('spotlight fixture areas', () => {
  it('stamps the canonical components the API derives from the same names', () => {
    expect(normalizeSpotlightAreaNames(SEEDED_SPOTLIGHT_AREA)).toEqual({
      country: 'US',
      region: 'illinois',
      city: 'chicago',
    })
    expect(
      normalizeSpotlightAreaNames({
        country: 'Brasil',
        region: 'São Paulo',
        city: 'São Paulo',
      })
    ).toEqual(
      canonicalSpotlightArea({ country: 'BR', region: 'Sao Paulo', city: 'SAO PAULO' })
    )
  })

  it('refuses names that would leave a post unstamped', () => {
    expect(() =>
      normalizeSpotlightAreaNames({ country: 'Atlantis', region: 'North', city: 'Port' })
    ).toThrow(/does not resolve to a full city tuple/)
    expect(() =>
      normalizeSpotlightAreaNames({ country: 'Portugal', region: '  ', city: 'Lisbon' })
    ).toThrow(/does not resolve/)
  })

  it('hands out a real, distinct country per call and never an explicitly named one', () => {
    const areas = Array.from({ length: 20 }, (_, index) =>
      uniqueSpotlightArea(`namespace-${index}`)
    )
    const codes = areas.map((area) => canonicalCountryCode(area.country))
    expect(codes.every((code) => code !== null)).toBe(true)
    expect(new Set(codes).size).toBe(areas.length)
    for (const named of ['US', 'PT', 'BR', 'DE', 'TR', 'GB', 'GE'])
      expect(codes).not.toContain(named)
    // Names, never bare codes, so privacy assertions cannot match by accident.
    expect(areas.every((area) => area.country.length > 2)).toBe(true)
    expect(uniqueSpotlightArea('same').region).toBe(uniqueSpotlightArea('same').region)
    expect(uniqueSpotlightArea('same').country).not.toBe(
      uniqueSpotlightArea('same').country
    )
  })

  it('throws once every fixture country in the process is taken', async () => {
    // A fresh module instance owns its own counter, so exhausting it here leaves
    // the statically imported one untouched whatever order the tests run in.
    vi.resetModules()
    const fresh = await import('../src/factories/community-spotlight.factory.js')
    let taken = 0
    expect(() => {
      for (;;) {
        fresh.uniqueSpotlightArea(`exhaust-${taken}`)
        taken += 1
      }
    }).toThrow(/Every fixture country is already taken/)
    expect(taken).toBeGreaterThan(200)
  })
})

describe('planSpotlightCohort', () => {
  const plan = planSpotlightCohort({
    namespace: 'unit',
    seedTime: SEED_TIME,
    area: SEEDED_SPOTLIGHT_AREA,
    authorIds: AUTHORS,
  })

  it('publishes one post per author an hour apart, before the seed time', () => {
    expect(SPOTLIGHT_FIXTURE_COHORT_AUTHORS).toBe(5)
    expect(SEEDED_SPOTLIGHT_COHORT_SIZE).toBe(7)
    expect(plan.posts.map((post) => post.id)).toEqual([
      'unit-spotlight-1',
      'unit-spotlight-2',
      'unit-spotlight-3',
      'unit-spotlight-4',
      'unit-spotlight-5',
    ])
    expect(plan.posts.map((post) => post.userId)).toEqual(AUTHORS)
    plan.posts.forEach((post, index) => {
      expect(post.publishedAt?.getTime()).toBe(
        SEED_TIME.getTime() - (index + 1) * 3_600_000
      )
      expect(post).toMatchObject({
        status: 'published',
        caption: `Spotlight look ${index + 1}`,
        locationKey: null,
        areaCountry: 'US',
        areaRegion: 'illinois',
        areaCity: 'chicago',
      })
    })
    expect(plan.expectedOrder).toEqual(plan.posts.map((post) => post.id))
  })

  it('gives fresher posts strictly more non-author reactions, never a self reaction', () => {
    const counts = plan.posts.map(
      (post) => plan.reactions.filter((reaction) => reaction.postId === post.id).length
    )
    expect(counts).toEqual([4, 3, 2, 1, 1])
    for (const reaction of plan.reactions) {
      const post = plan.posts.find((candidate) => candidate.id === reaction.postId)!
      expect(reaction.userId).not.toBe(post.userId)
      expect(['applause', 'love', 'inspiration']).toContain(reaction.selection)
    }
  })

  it('takes a caption prefix and an image path when given', () => {
    const custom = planSpotlightCohort({
      namespace: 'custom',
      seedTime: SEED_TIME,
      area: SEEDED_SPOTLIGHT_AREA,
      authorIds: AUTHORS.slice(0, 2),
      captionPrefix: 'Seeded spotlight look',
      imageObjectPath: 'community/seed/look.jpg',
    })
    expect(custom.posts.map((post) => post.caption)).toEqual([
      'Seeded spotlight look 1',
      'Seeded spotlight look 2',
    ])
    expect(
      custom.posts.every((post) => post.imageObjectPath === 'community/seed/look.jpg')
    ).toBe(true)
    // Two authors: each post still gets its one non-author reaction.
    expect(
      custom.reactions.map((reaction) => [reaction.userId, reaction.postId])
    ).toEqual([
      ['author-b', 'custom-spotlight-1'],
      ['author-a', 'custom-spotlight-2'],
    ])
  })
})

describe('buildSpotlightSavedLocationCreateInput', () => {
  it('saves the area as typed, as a primary location with a stable key', () => {
    const input = buildSpotlightSavedLocationCreateInput('user-1', SEEDED_SPOTLIGHT_AREA)
    expect(input).toMatchObject({
      user_id: 'user-1',
      label: 'Chicago',
      city: 'Chicago',
      region: 'Illinois',
      country: 'United States',
      is_primary: true,
      timezone: 'UTC',
    })
    expect(input.location_key).toMatch(/^spotlight-[0-9a-f]{12}$/)
    expect(
      buildSpotlightSavedLocationCreateInput('user-1', SEEDED_SPOTLIGHT_AREA)
    ).toEqual(input)
    expect(
      buildSpotlightSavedLocationCreateInput('user-2', SEEDED_SPOTLIGHT_AREA).location_key
    ).not.toBe(input.location_key)
  })

  it('honours overrides', () => {
    expect(
      buildSpotlightSavedLocationCreateInput('user-1', SEEDED_SPOTLIGHT_AREA, {
        isPrimary: false,
        locationKey: 'fixed-key',
        label: 'Home',
      })
    ).toMatchObject({ is_primary: false, location_key: 'fixed-key', label: 'Home' })
  })
})

describe('persistSpotlightCohort', () => {
  it('upserts every post by id with its area, then every reaction by member and post', async () => {
    const plan = planSpotlightCohort({
      namespace: 'persist',
      seedTime: SEED_TIME,
      area: SEEDED_SPOTLIGHT_AREA,
      authorIds: AUTHORS.slice(0, 3),
    })
    const prisma = {
      lookbookPost: { upsert: vi.fn(() => Promise.resolve({})) },
      communityReaction: { upsert: vi.fn(() => Promise.resolve({})) },
    }
    await persistSpotlightCohort(prisma as never, plan)
    expect(prisma.lookbookPost.upsert).toHaveBeenCalledTimes(3)
    const [first] = prisma.lookbookPost.upsert.mock.calls[0] as unknown as [
      {
        where: { id: string }
        create: Record<string, unknown>
        update: Record<string, unknown>
      },
    ]
    expect(first.where).toEqual({ id: 'persist-spotlight-1' })
    expect(first.create).toMatchObject({
      id: 'persist-spotlight-1',
      status: 'published',
      area_country: 'US',
      area_region: 'illinois',
      area_city: 'chicago',
      published_at: plan.posts[0]!.publishedAt,
    })
    expect(first.update).not.toHaveProperty('id')
    expect(prisma.communityReaction.upsert).toHaveBeenCalledTimes(plan.reactions.length)
    const [reaction] = prisma.communityReaction.upsert.mock.calls[0] as unknown as [
      { where: unknown; create: Record<string, unknown>; update: unknown },
    ]
    const planned = plan.reactions[0]!
    expect(reaction.where).toEqual({
      user_id_post_id: { user_id: planned.userId, post_id: planned.postId },
    })
    expect(reaction.create).toMatchObject({ selection: planned.selection, revision: 1 })
    expect(reaction.update).toEqual({ selection: planned.selection })
  })
})
