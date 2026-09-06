// Learning path Step 38: Community feed by climate band.
//
// Story 6.1 AC7: the two experiment arms must receive DIFFERENT FEEDS.
//
// This is the end-to-end half of the defect that started the experiment work.
// The variant used to be computed AFTER the query, so every viewer was served
// whatever mode the client asked for while analytics faithfully reported an
// assignment that changed nothing. Both arms saw the same rows, and a measured
// lift between two arms receiving the same feed is noise at any traffic volume,
// so the story's advance condition -- climate matching advances only on at least
// 10% relative non-self card-open lift -- was unmeasurable.
//
// The service tier proves the SELECTION: that an all-arm viewer asking for
// `auto` causes `findPublishedFeedPosts` to be called with `filterBand:
// undefined`. What only this tier can prove is the consequence: that two
// viewers whose ids fall in different arms actually receive different ROWS from
// a real database for the identical request. The outer tiers cannot, because
// they deliberately do not control the assignment.
//
// THE ASSIGNMENT IS NEVER MOCKED AND NEVER PINNED TO A LITERAL ID. Mocking
// `resolveCommunityExperimentVariant` would make this a restatement of the
// service test one tier up. Pinning an id chosen because it hashes conveniently
// would make it a test of a hash, and it would stop testing anything the day the
// assignment input changes. Instead the arms are DERIVED: candidate ids are
// generated and the real function is asked which arm each falls in, so the
// fixture follows the implementation wherever it goes.
//
// The same reasoning applies to the band. It is not asserted as a literal
// either; the real classifier is asked what the fixture's weather resolves to,
// and the corpus is seeded around the answer.
import 'reflect-metadata'
import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { buildLookbookPostCreateInput, createLookbookPost } from '@couture/testing'
import { classifyClimateBand, type ClimateBand } from '@couture/utils'
import type { FeatureFlagsService } from '../src/modules/feature-flags/feature-flags.service.js'
import type { GuardianService } from '../src/modules/guardian/guardian.service.js'
import type { TelemetryService } from '../src/modules/telemetry/telemetry.service.js'
import type { WeatherQueryService } from '../src/modules/weather/weather-query.service.js'
import { CommunityRepository } from '../src/modules/community/community.repository.js'
import { CommunityService } from '../src/modules/community/community.service.js'
import { InMemoryCommunityStorage } from '../src/modules/community/community-storage.fake.js'
import { resolveCommunityExperimentVariant } from '../src/modules/community/community-analytics.js'

const databaseUrl =
  process.env.INTEGRATION_TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } })

let schemaReady = false

async function probeSchema(): Promise<void> {
  try {
    await prisma.$queryRaw`SELECT 1 FROM "LookbookPost" LIMIT 1`
    await prisma.$queryRaw`SELECT 1 FROM "SavedLocation" LIMIT 1`
    schemaReady = true
  } catch (error) {
    schemaReady = false
    // eslint-disable-next-line no-console
    console.warn(
      '[community-experiment] Skipped: could not query the Story 6.1 community schema. ' +
        'Run `npm run db:migrate` against the integration database. Underlying error:',
      error
    )
  }
}

function requireSchema(context: { skip: () => void }): boolean {
  if (!schemaReady) {
    context.skip()
    return false
  }
  return true
}

const namespace = `community-experiment-${randomUUID().slice(0, 8)}`
const LOCATION_KEY = `${namespace}-location`

/**
 * Four temperate, dry days. The values are the fixture; the BAND they produce is
 * not asserted here, it is read back out of the real classifier below, so a
 * threshold change moves the fixture's band rather than breaking the test.
 */
const DAILY_SUMMARIES = Array.from({ length: 4 }, (_, index) => ({
  localDate: `2026-03-0${index + 1}`,
  condition: 'clear',
  temperatureMin: 14,
  temperatureMax: 20,
  precipitationProbability: 0.05,
  precipitationAmount: 0,
  windSpeed: 6,
}))

/**
 * Finds a user id in the requested arm by ASKING the real assignment function.
 *
 * Assignment is `sha256('community-experiment:' + userId)[0] % 2`, so about half
 * of any candidate set falls in each arm and a handful of tries is enough. The
 * loop is bounded so a change that made the function constant fails here loudly
 * instead of hanging.
 */
function findUserIdInArm(arm: 'auto' | 'all'): string {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const candidate = `${namespace}-${arm}-${randomUUID()}`
    if (resolveCommunityExperimentVariant(candidate) === arm) {
      return candidate
    }
  }
  throw new Error(
    `No candidate id fell in the '${arm}' arm across 200 tries. The assignment ` +
      'function is no longer splitting roughly evenly, which is itself a defect.'
  )
}

let autoArmUserId = ''
let allArmUserId = ''
let authorUserId = ''
let resolvedBand: ClimateBand
let offBand: ClimateBand
const inBandPostIds: string[] = []
const offBandPostIds: string[] = []

const storage = new InMemoryCommunityStorage()

/** Flags, telemetry, weather and guardian are doubles; the feed query is real. */
const featureFlagsService = {
  getFeatureFlag: vi.fn().mockResolvedValue(true),
} as unknown as FeatureFlagsService

const telemetryService = {
  captureEvent: vi.fn().mockResolvedValue(undefined),
} as unknown as TelemetryService

const weatherQueryService = {
  getLatestWeather: vi.fn().mockResolvedValue({
    status: 'fresh',
    data: { daily_summaries: DAILY_SUMMARIES },
  }),
} as unknown as WeatherQueryService

const guardianService = {} as unknown as GuardianService

const service = new CommunityService(
  new CommunityRepository(prisma),
  featureFlagsService,
  weatherQueryService,
  telemetryService,
  storage,
  guardianService
)

async function seedPost(band: ClimateBand, label: string): Promise<string> {
  const fixture = createLookbookPost({
    id: `${namespace}-${label}-${randomUUID().slice(0, 8)}`,
    userId: authorUserId,
    status: 'published',
    climateBand: band,
    publishedAt: new Date(),
  })
  await prisma.lookbookPost.create({ data: buildLookbookPostCreateInput(fixture) })
  return fixture.id
}

beforeAll(async () => {
  await probeSchema()
  if (!schemaReady) return

  // Ask the real classifier what this weather is, rather than asserting a band
  // the thresholds might legitimately move.
  const classified = classifyClimateBand(DAILY_SUMMARIES)
  if (!classified) {
    throw new Error('The fixture weather no longer classifies to any band.')
  }
  resolvedBand = classified
  offBand = resolvedBand === 'cold_wet' ? 'warm_dry' : 'cold_wet'

  autoArmUserId = findUserIdInArm('auto')
  allArmUserId = findUserIdInArm('all')

  const author = await prisma.user.create({
    data: { email: `${namespace}-author@synthetic.test` },
  })
  authorUserId = author.id

  for (const [userId, arm] of [
    [autoArmUserId, 'auto'],
    [allArmUserId, 'all'],
  ] as const) {
    await prisma.user.create({
      data: { id: userId, email: `${namespace}-${arm}@synthetic.test` },
    })
    // A viewer with no saved location resolves no band at all, and an
    // unresolved band collapses both arms onto `all`, which would make this
    // test pass for the wrong reason.
    await prisma.savedLocation.create({
      data: {
        user_id: userId,
        label: 'Home',
        location_key: LOCATION_KEY,
        latitude: 41.878,
        longitude: -87.63,
        timezone: 'America/Chicago',
        is_primary: true,
        sort_order: 0,
      },
    })
  }

  for (let index = 0; index < 3; index += 1) {
    inBandPostIds.push(await seedPost(resolvedBand, `in-band-${index}`))
    offBandPostIds.push(await seedPost(offBand, `off-band-${index}`))
  }
})

afterAll(async () => {
  if (schemaReady) {
    const owned = { user: { email: { startsWith: namespace } } }
    await prisma.communityModerationOutbox.deleteMany({
      where: { post: { user: { email: { startsWith: namespace } } } },
    })
    await prisma.lookbookPost.deleteMany({ where: owned })
    await prisma.savedLocation.deleteMany({ where: owned })
    await prisma.communityAlias.deleteMany({ where: owned })
    await prisma.user.deleteMany({ where: { email: { startsWith: namespace } } })
  }
  await prisma.$disconnect()
})

describe('6.1 community feed experiment arms', () => {
  it('6.1-INT-070 serves band-filtered rows to the auto arm and unfiltered rows to the all arm', async (context) => {
    if (!requireSchema(context)) return

    // The identical request from both viewers. Everything that differs in the
    // responses is caused by the assignment and nothing else.
    const [autoFeed, allFeed] = await Promise.all([
      service.getFeed({
        userId: autoArmUserId,
        platform: 'web',
        mode: 'auto',
        limit: 50,
      }),
      service.getFeed({ userId: allArmUserId, platform: 'web', mode: 'auto', limit: 50 }),
    ])

    // The assignment landed where the fixture derived it, and the band resolved,
    // so neither arm collapsed onto `all` for an unrelated reason.
    expect(autoFeed.experimentVariant).toBe('auto')
    expect(allFeed.experimentVariant).toBe('all')
    expect(autoFeed.viewerBand).toBe(resolvedBand)
    expect(allFeed.viewerBand).toBe(resolvedBand)
    expect(autoFeed.bandResolved).toBe(true)
    expect(allFeed.bandResolved).toBe(true)

    // The mode SERVED, not the mode requested. Both asked for `auto`, and the
    // assignment is what `auto` resolves to: the auto arm keeps `auto`, which
    // the client renders as "your region" and which `resolveFilterBand` turns
    // into the viewer's own band, while the all arm is served `all` and no band
    // filter at all. The served mode is echoed back precisely so the two arms
    // are distinguishable by the client and by analytics.
    expect(autoFeed.mode).toBe('auto')
    expect(allFeed.mode).toBe('all')

    const autoIds = autoFeed.items.map((item) => item.id)
    const allIds = allFeed.items.map((item) => item.id)

    // The auto arm is band-filtered: it sees this suite's in-band posts and none
    // of its off-band ones, and every row it did receive carries the band.
    for (const id of inBandPostIds) {
      expect(autoIds).toContain(id)
    }
    for (const id of offBandPostIds) {
      expect(autoIds).not.toContain(id)
    }
    expect(autoFeed.items.every((item) => item.climateBand === resolvedBand)).toBe(true)

    // The all arm is not filtered: it receives the off-band posts the auto arm
    // was denied.
    for (const id of offBandPostIds) {
      expect(allIds).toContain(id)
    }

    // And the two pages genuinely differ, which is the claim AC7 rests on. If
    // the variant were computed after the query again, these would be equal and
    // every assertion above about `mode` would still pass.
    expect(allIds).not.toEqual(autoIds)
    expect(allIds.filter((id) => !autoIds.includes(id)).length).toBeGreaterThan(0)
  })

  it('6.1-INT-071 keeps a viewer in the same arm across repeated requests', async (context) => {
    if (!requireSchema(context)) return

    // Assignment is a pure function of the user id, so it has to be stable: an
    // arm that were redrawn per request would scramble the experiment and, worse,
    // would mint page-two cursors under a different effective mode than page one.
    const first = await service.getFeed({
      userId: autoArmUserId,
      platform: 'web',
      mode: 'auto',
      limit: 5,
    })
    const second = await service.getFeed({
      userId: autoArmUserId,
      platform: 'web',
      mode: 'auto',
      limit: 5,
    })

    expect(second.experimentVariant).toBe(first.experimentVariant)
    expect(second.mode).toBe(first.mode)
  })

  it('6.1-INT-072 honours an explicit mode over the assignment for both arms', async (context) => {
    if (!requireSchema(context)) return

    // The experiment only decides what `auto` means. A viewer who explicitly
    // picks a band gets that band whichever arm they are in, or the chips would
    // silently do nothing for half the audience.
    const [autoArm, allArm] = await Promise.all([
      service.getFeed({
        userId: autoArmUserId,
        platform: 'web',
        mode: offBand,
        limit: 50,
      }),
      service.getFeed({
        userId: allArmUserId,
        platform: 'web',
        mode: offBand,
        limit: 50,
      }),
    ])

    expect(autoArm.mode).toBe(offBand)
    expect(allArm.mode).toBe(offBand)

    for (const feed of [autoArm, allArm]) {
      const ids = feed.items.map((item) => item.id)
      for (const id of offBandPostIds) {
        expect(ids).toContain(id)
      }
      for (const id of inBandPostIds) {
        expect(ids).not.toContain(id)
      }
    }
  })
})
