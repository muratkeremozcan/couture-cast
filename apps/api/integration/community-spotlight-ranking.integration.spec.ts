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
    const { country } = ctx.area('same-name')
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
    const thinCountry = ctx.area('thin')
    await ctx.cohort(thinCountry, 4)
    const viewer = await ctx.member(thinCountry)
    await expect(ctx.read(viewer)).resolves.toEqual({
      level: 'none',
      label: null,
      items: [],
      nextCursor: null,
    })
  })

  it('6.6-INT-006 no usable location: none, a null or blank country, or one that resolves to no ISO code', async () => {
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
    const unresolved = await ctx.member({
      country: 'Atlantis',
      region: area.region,
      city: area.city,
    })
    for (const viewer of [none, countryless, blank, unresolved])
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

  it('6.6-INT-009 equal scores and counts order by id desc, below a newer post that wins on score', async () => {
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

  it('6.6-INT-014 equal scores order by non-author reactions desc in SQL and in the pure reference', async () => {
    const area = ctx.area('reaction-tiebreak')
    const cohort = await ctx.cohort(area)
    // 1 / (2 + 2)^1.5 and 8 / (14 + 2)^1.5 are both exactly 0.125. Both the
    // published_at and the id tiebreak favor the newer post, so only the
    // reactions term ranks the older one first.
    const newer = await post(await ctx.member(), area, hoursBeforeAsOf(2), {
      id: `tie-z-${cohort.area.city}`,
    })
    const older = await post(await ctx.member(), area, hoursBeforeAsOf(14), {
      id: `tie-a-${cohort.area.city}`,
    })
    await ctx.react(cohort.authorIds[0]!, newer, 'love')
    for (let index = 0; index < 8; index += 1)
      await ctx.react(await ctx.member(), older, 'applause')

    const ranking = await ctx.spotlightRepository.rank(
      areaComponentsOf(area),
      'city',
      SPOTLIGHT_TEST_AS_OF
    )
    const row = (id: string) => ranking.rows.find((entry) => entry.id === id)!
    // Fixture guard: the pair is an exact tie on score, in SQL and in the formula.
    expect(row(newer)).toMatchObject({ reactions: 1, score: 0.125 })
    expect(row(older)).toMatchObject({ reactions: 8, score: 0.125 })
    expect(
      spotlightScore(1, spotlightAgeHours(SPOTLIGHT_TEST_AS_OF, row(newer).publishedAt))
    ).toBe(
      spotlightScore(8, spotlightAgeHours(SPOTLIGHT_TEST_AS_OF, row(older).publishedAt))
    )
    const ids = ranking.rows.map((entry) => entry.id)
    expect(ids.filter((id) => id === newer || id === older)).toEqual([older, newer])
    expect(ids).toEqual(
      rankSpotlightEntries(SPOTLIGHT_TEST_AS_OF, ranking.rows).map((entry) => entry.id)
    )

    const viewer = await ctx.member(area)
    const served = (await ctx.read(viewer, { limit: 12 })).items.map((item) => item.id)
    expect(served.filter((id) => id === newer || id === older)).toEqual([older, newer])
  })

  it('6.6-INT-013 the windowed partial indexes exist with their visibility predicate', async () => {
    const indexes = await ctx.prisma.$queryRaw<{ indexname: string; indexdef: string }[]>`
      SELECT indexname, indexdef FROM pg_indexes
      WHERE indexname IN (
        'LookbookPost_spotlight_area_window_idx',
        'LookbookPost_spotlight_region_window_idx',
        'LookbookPost_spotlight_country_window_idx',
        'CommunityReaction_spotlight_post_idx'
      )
    `
    const definition = (name: string) =>
      indexes.find((index) => index.indexname === name)?.indexdef ?? ''
    for (const [name, columns, component] of [
      [
        'LookbookPost_spotlight_area_window_idx',
        '(area_country, area_region, area_city, published_at DESC)',
        'area_country IS NOT NULL',
      ],
      [
        'LookbookPost_spotlight_region_window_idx',
        '(area_country, area_region, published_at DESC) INCLUDE (area_city, user_id, reaction_generation)',
        'area_region IS NOT NULL',
      ],
      [
        'LookbookPost_spotlight_country_window_idx',
        '(area_country, published_at DESC) INCLUDE (area_region, area_city, user_id, reaction_generation)',
        'area_country IS NOT NULL',
      ],
    ] as const) {
      expect(definition(name), name).toContain(columns)
      expect(definition(name), name).toContain("status = 'published'")
      expect(definition(name), name).toContain('erasure_requested_at IS NULL')
      expect(definition(name), name).toContain('anonymized_at IS NULL')
      expect(definition(name), name).toContain(component)
    }
    expect(definition('CommunityReaction_spotlight_post_idx')).toContain(
      '(post_id) INCLUDE (user_id) WHERE (selection IS NOT NULL)'
    )
  })
})
