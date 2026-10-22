// Story 6.6 I/O matrix: level selection, eligibility and deterministic ranking
// against a real PG17 database and an owned Redis key space.
import { describe, expect, it } from 'vitest'
import { buildLookbookPostCreateInput, createLookbookPost } from '@couture/testing'
import { areaComponentsOf } from '../src/modules/community/community-spotlight-area.js'
import {
  rankSpotlightEntries,
  spotlightScore,
  spotlightAgeHours,
} from '../src/modules/community/community-spotlight-ranking.js'
import {
  SPOTLIGHT_TEST_AS_OF,
  hoursBeforeAsOf,
  spotlightTestContext,
} from './helpers/community-spotlight-context.js'

const ctx = spotlightTestContext('ranking')

async function post(
  author: string,
  area: { country: string; region: string; city: string },
  publishedAt: Date,
  overrides: Parameters<typeof createLookbookPost>[0] = {}
) {
  const normalized = areaComponentsOf(area)
  const fixture = createLookbookPost(
    {
      userId: author,
      areaCountry: normalized.country,
      areaRegion: normalized.region,
      areaCity: normalized.city,
      publishedAt,
      submittedAt: publishedAt,
      altTextConfirmedAt: publishedAt,
      ...overrides,
    },
    { now: publishedAt }
  )
  await ctx.prisma.lookbookPost.create({ data: buildLookbookPostCreateInput(fixture) })
  return fixture.id
}

describe('6.6 spotlight level selection', () => {
  it('6.6-INT-001 city cohort met: ranks the city with the viewer label in score order', async () => {
    const area = ctx.area('city-met')
    const cohort = await ctx.cohort(area)
    const viewer = await ctx.member(area)
    const page = await ctx.read(viewer, { limit: 12 })
    expect(page.level).toBe('city')
    expect(page.label).toBe(area.city)
    expect(page.items.map((item) => item.id)).toEqual(cohort.expectedOrder)
    expect(page.items.map((item) => item.rank)).toEqual([1, 2, 3, 4, 5])
    expect(page.nextCursor).toBeNull()
    expect(Object.keys(page).sort()).toEqual(['items', 'label', 'level', 'nextCursor'])
  })

  it('6.6-INT-002 city thin, region met: 3 city authors and 7 region authors rank the region', async () => {
    const area = ctx.area('region-met')
    await ctx.cohort(area, 3)
    await ctx.cohort({ ...area, city: `${area.city} North` }, 4)
    const viewer = await ctx.member(area)
    const page = await ctx.read(viewer, { limit: 12 })
    expect(page.level).toBe('region')
    expect(page.label).toBe(area.region)
    expect(page.items).toHaveLength(7)
  })

  it('6.6-INT-003 same city name in two regions never merges: the country holds all six', async () => {
    const base = ctx.area('same-name')
    const country = `Country ${base.region}`
    const left = { country, region: 'West', city: 'Springfield' }
    const right = { country, region: 'East', city: 'Springfield' }
    await ctx.cohort(left, 3)
    await ctx.cohort(right, 3)
    const viewer = await ctx.member(left)
    const page = await ctx.read(viewer, { limit: 12 })
    expect(page.level).toBe('country')
    expect(page.label).toBe(country)
    expect(page.items).toHaveLength(6)
  })

  it('6.6-INT-004 a viewer with a null city and a set region starts at the region', async () => {
    const area = ctx.area('partial')
    await ctx.cohort(area)
    const viewer = await ctx.member({
      country: area.country,
      region: area.region,
      city: null,
    })
    const page = await ctx.read(viewer)
    expect(page.level).toBe('region')
    expect(page.label).toBe(area.region)
  })

  it('6.6-INT-005 under five authors at the country is none with no items', async () => {
    const area = ctx.area('thin')
    const thinCountry = { ...area, country: `Thin ${area.region}` }
    await ctx.cohort(thinCountry, 4)
    const viewer = await ctx.member(thinCountry)
    await expect(ctx.read(viewer)).resolves.toEqual({
      level: 'none',
      label: null,
      items: [],
      nextCursor: null,
    })
  })

  it('6.6-INT-006 no usable location: no saved location, or one without a country, is none', async () => {
    const area = ctx.area('no-location')
    await ctx.cohort(area)
    const none = await ctx.member(null)
    const countryless = await ctx.member({
      country: null,
      region: area.region,
      city: area.city,
    })
    const blank = await ctx.member({
      country: '   ',
      region: area.region,
      city: area.city,
    })
    for (const viewer of [none, countryless, blank])
      await expect(ctx.read(viewer)).resolves.toMatchObject({ level: 'none', items: [] })
  })

  it('6.6-INT-007 picks the first saved location with a country in is_primary, created_at order', async () => {
    const area = ctx.area('ordered')
    await ctx.cohort(area)
    const viewer = await ctx.member({ country: null, region: 'Ignored', city: 'Ignored' })
    await ctx.prisma.savedLocation.updateMany({
      where: { user_id: viewer },
      data: { is_primary: true },
    })
    await ctx.prisma.savedLocation.create({
      data: {
        user_id: viewer,
        label: 'Second',
        location_key: `ordered-${viewer}`,
        latitude: 0,
        longitude: 0,
        timezone: 'UTC',
        is_primary: false,
        country: area.country,
        region: area.region,
        city: area.city,
      },
    })
    await expect(ctx.read(viewer)).resolves.toMatchObject({
      level: 'city',
      label: area.city,
    })
  })
})

describe('6.6 spotlight eligibility and ranking', () => {
  it('6.6-INT-008 window edges: exactly as_of minus 7 days is excluded, exactly as_of is included', async () => {
    const area = ctx.area('window')
    const cohort = await ctx.cohort(area)
    const [first, second, reactor] = cohort.authorIds as [string, string, string]
    const atAsOf = await post(first, area, SPOTLIGHT_TEST_AS_OF)
    const atEdge = await post(second, area, hoursBeforeAsOf(7 * 24))
    await ctx.react(reactor, atAsOf, 'love')
    await ctx.react(reactor, atEdge, 'love')
    const viewer = await ctx.member(area)
    const ids = (await ctx.read(viewer, { limit: 12 })).items.map((item) => item.id)
    expect(ids).toContain(atAsOf)
    expect(ids).not.toContain(atEdge)
  })

  it('6.6-INT-009 equal scores and counts order by published_at desc, then id desc', async () => {
    const area = ctx.area('ties')
    const cohort = await ctx.cohort(area)
    const [first, second, third, reactor] = cohort.authorIds as [
      string,
      string,
      string,
      string,
    ]
    const at = hoursBeforeAsOf(100)
    const ids = [
      await post(first, area, at, { id: `tie-a-${cohort.area.city}` }),
      await post(second, area, at, { id: `tie-c-${cohort.area.city}` }),
      await post(third, area, hoursBeforeAsOf(99), { id: `tie-b-${cohort.area.city}` }),
    ]
    for (const id of ids) await ctx.react(reactor, id, 'applause')
    const viewer = await ctx.member(area)
    const ranked = (await ctx.read(viewer, { limit: 12 })).items.map((item) => item.id)
    expect(ranked.filter((id) => id.startsWith('tie-'))).toEqual([ids[2], ids[1], ids[0]])
  })

  it('6.6-INT-010 only self reactions make a post ineligible and do not count toward the cohort', async () => {
    const area = ctx.area('self')
    const cohort = await ctx.cohort(area, 4)
    const author = await ctx.member()
    const selfOnly = await post(author, area, hoursBeforeAsOf(1))
    await ctx.react(author, selfOnly, 'love')
    const viewer = await ctx.member(area)
    // Four real authors plus a self-reacted fifth is still under the cohort.
    await expect(ctx.read(viewer)).resolves.toMatchObject({ level: 'none' })
    await ctx.react(cohort.authorIds[0]!, selfOnly, 'love')
    const page = await ctx.read(viewer, { limit: 12 })
    expect(page.level).toBe('city')
    expect(page.items.map((item) => item.id)).toContain(selfOnly)
  })

  it('6.6-INT-011 every hidden form stays out of ranking and cohort, like PUBLICLY_VISIBLE_POST_WHERE', async () => {
    const area = ctx.area('visibility')
    const cohort = await ctx.cohort(area, 4)
    const reactor = cohort.authorIds[0]!
    const hidden = [
      { status: 'withdrawn' as const },
      { status: 'consent_suspended' as const },
      { status: 'flagged' as const },
      { erasureRequestedAt: hoursBeforeAsOf(1) },
      { userId: 'canary-user-spotlight' },
    ]
    await ctx.prisma.user.upsert({
      where: { id: 'canary-user-spotlight' },
      update: {},
      create: {
        id: 'canary-user-spotlight',
        email: 'canary-user-spotlight@synthetic.test',
      },
    })
    for (const overrides of hidden) {
      const author = overrides.userId ?? (await ctx.member())
      const id = await post(author, area, hoursBeforeAsOf(2), {
        ...overrides,
        userId: author,
      })
      await ctx.react(reactor, id, 'love')
    }
    const viewer = await ctx.member(area)
    await expect(ctx.read(viewer)).resolves.toMatchObject({ level: 'none' })
  })

  it('6.6-INT-012 identical data and as_of rank identically, and SQL scores equal the pure formula', async () => {
    const area = ctx.area('deterministic')
    const cohort = await ctx.cohort(area, 6)
    const components = areaComponentsOf(area)
    const first = await ctx.spotlightRepository.rank(
      components,
      'city',
      SPOTLIGHT_TEST_AS_OF
    )
    const second = await ctx.spotlightRepository.rank(
      components,
      'city',
      SPOTLIGHT_TEST_AS_OF
    )
    expect(second).toEqual(first)
    expect(first.cohort).toBe(6)
    for (const row of first.rows)
      expect(row.score).toBeCloseTo(
        spotlightScore(
          row.reactions,
          spotlightAgeHours(SPOTLIGHT_TEST_AS_OF, row.publishedAt)
        ),
        12
      )
    const reference = rankSpotlightEntries(SPOTLIGHT_TEST_AS_OF, first.rows)
    expect(first.rows.map((row) => row.id)).toEqual(reference.map((row) => row.id))
    expect(first.rows.map((row) => row.id)).toEqual(cohort.expectedOrder)
  })

  it('6.6-INT-013 the windowed partial index exists with its visibility predicate', async () => {
    const [index] = await ctx.prisma.$queryRaw<{ indexdef: string }[]>`
      SELECT indexdef FROM pg_indexes
      WHERE tablename = 'LookbookPost' AND indexname = 'LookbookPost_spotlight_area_window_idx'
    `
    expect(index?.indexdef).toContain(
      '(area_country, area_region, area_city, published_at DESC)'
    )
    expect(index?.indexdef).toContain("status = 'published'")
    expect(index?.indexdef).toContain('area_country IS NOT NULL')
  })
})
