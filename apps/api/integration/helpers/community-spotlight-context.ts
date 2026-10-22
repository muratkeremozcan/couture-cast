// Story 6.6: one owned PG17 database and one owned Redis key space per spotlight suite.
import { randomUUID } from 'node:crypto'
import Redis from 'ioredis'
import { PrismaClient } from '@prisma/client'
import { afterAll, beforeAll, beforeEach, vi } from 'vitest'
import type { CommunityReactionSelection } from '@couture/api-client/contracts/http'
import {
  buildSpotlightSavedLocationCreateInput,
  createUser,
  persistSpotlightCohort,
  persistUser,
  planSpotlightCohort,
  uniqueSpotlightArea,
  type SpotlightAreaNames,
} from '@couture/testing'
import { getRedisConfig, redisOptionsFromConfig } from '../../src/config/redis.js'
import type { AnalyticsCaptureEvent } from '../../src/analytics/analytics.service.js'
import { CommunityRepository } from '../../src/modules/community/community.repository.js'
import { CommunityService } from '../../src/modules/community/community.service.js'
import { CommunityStreamRepository } from '../../src/modules/community/community-stream.repository.js'
import { InMemoryCommunityStorage } from '../../src/modules/community/community-storage.fake.js'
import {
  CommunitySpotlightCache,
  type SpotlightRedis,
} from '../../src/modules/community/community-spotlight-cache.js'
import { CommunitySpotlightInvalidator } from '../../src/modules/community/community-spotlight-invalidator.js'
import { CommunitySpotlightRepository } from '../../src/modules/community/community-spotlight.repository.js'
import {
  CommunitySpotlightService,
  type GetSpotlightParams,
} from '../../src/modules/community/community-spotlight.service.js'
import { TelemetryService } from '../../src/modules/telemetry/telemetry.service.js'
import { isolatedCommunityDatabase } from './isolated-community-database.js'

/** Seconds past the minute, so `as_of` truncation is exercised on every read. */
export const SPOTLIGHT_TEST_NOW = new Date('2026-10-22T12:00:30.000Z')
export const SPOTLIGHT_TEST_AS_OF = new Date('2026-10-22T12:00:00.000Z')

export function hoursBeforeAsOf(hours: number): Date {
  return new Date(SPOTLIGHT_TEST_AS_OF.getTime() - hours * 3_600_000)
}

/**
 * A Redis double that refuses every command, standing in for a connection
 * refused with `enableOfflineQueue: false`.
 */
export const unavailableRedis: SpotlightRedis = {
  get: () => Promise.reject(new Error('Connection is closed.')),
  set: () => Promise.reject(new Error('Connection is closed.')),
  eval: () => Promise.reject(new Error('Connection is closed.')),
}

export function spotlightTestContext(label: string) {
  const database = isolatedCommunityDatabase()
  const prisma = new PrismaClient({ datasources: { db: { url: database.url } } })
  const config = getRedisConfig()
  const redis = new Redis(config.url, {
    ...redisOptionsFromConfig(config),
    maxRetriesPerRequest: 1,
    enableOfflineQueue: true,
    connectTimeout: 1000,
    lazyConnect: true,
  })
  redis.on('error', () => undefined)
  const prefix = `cc66-test:${label}:${randomUUID()}`
  const clock = { current: SPOTLIGHT_TEST_NOW, now: () => clock.current }
  const analytics: AnalyticsCaptureEvent[] = []
  const analyticsClient = {
    capture: (event: AnalyticsCaptureEvent) => analytics.push(event),
  }
  const telemetry = new TelemetryService(prisma, analyticsClient)
  const repository = new CommunityRepository(prisma)
  const flags = {
    getFeatureFlag: vi.fn(() => Promise.resolve(true)),
    communityReadEvaluation: vi.fn(() =>
      Promise.resolve({
        value: true,
        expiresAt: new Date(Date.now() + 60_000),
        validUntil: performance.now() + 60_000,
      })
    ),
  }
  const storage = new InMemoryCommunityStorage()
  const community = new CommunityService(
    repository,
    flags as never,
    {} as never,
    telemetry,
    storage,
    {} as never
  )
  const spotlightRepository = new CommunitySpotlightRepository(prisma)
  const cache = new CommunitySpotlightCache(redis as unknown as SpotlightRedis, prefix)
  const streams = new CommunityStreamRepository(prisma)
  const invalidator = new CommunitySpotlightInvalidator(prisma, cache)

  function serviceWith(client: SpotlightRedis = redis as unknown as SpotlightRedis) {
    return new CommunitySpotlightService(
      spotlightRepository,
      community,
      telemetry,
      client,
      clock,
      prefix
    )
  }
  const service = serviceWith()

  type LocationInput = Partial<Record<'country' | 'region' | 'city', string | null>>

  /** An eligible member, optionally with one saved location holding these components. */
  async function member(location?: LocationInput | null) {
    const user = await persistUser(
      prisma,
      createUser({ profilePreferences: { compliance: { accountStatus: 'active' } } })
    )
    if (location) {
      const base = buildSpotlightSavedLocationCreateInput(user.id, {
        country: location.country ?? 'none',
        region: location.region ?? 'none',
        city: location.city ?? 'none',
      })
      await prisma.savedLocation.create({
        data: {
          ...base,
          country: location.country ?? null,
          region: location.region ?? null,
          city: location.city ?? null,
        },
      })
    }
    return user.id
  }

  /** `count` authors in `area`, one ranked post each, published relative to `as_of`. */
  async function cohort(area: SpotlightAreaNames, count = 5, namespace = randomUUID()) {
    const authorIds: string[] = []
    for (let index = 0; index < count; index += 1) authorIds.push(await member())
    const plan = planSpotlightCohort({
      namespace,
      seedTime: SPOTLIGHT_TEST_AS_OF,
      area,
      authorIds,
    })
    await persistSpotlightCohort(prisma, plan)
    return { ...plan, authorIds }
  }

  async function react(
    userId: string,
    postId: string,
    selection: CommunityReactionSelection
  ) {
    await prisma.communityReaction.upsert({
      where: { user_id_post_id: { user_id: userId, post_id: postId } },
      create: { user_id: userId, post_id: postId, selection, revision: 1 },
      update: { selection, revision: { increment: 1 } },
    })
  }

  /** Commits stream events for everything written so far, then lets the invalidator run. */
  async function drain() {
    while ((await streams.append()) > 0) {
      // Append is bounded per batch; keep going until the outbox is empty.
    }
    return invalidator.process()
  }

  function read(viewer: string, overrides: Partial<GetSpotlightParams> = {}) {
    return service.getSpotlight({
      userId: viewer,
      platform: 'web',
      limit: 6,
      reactions: true,
      ...overrides,
    })
  }

  beforeAll(async () => {
    await database.migrate()
    // Schema probe: this suite fails, never skips, when the migration is absent.
    await prisma.$queryRaw`SELECT 1 FROM "CommunitySpotlightCursor" LIMIT 1`
    await redis.connect()
    await redis.ping()
  }, 60_000)
  beforeEach(() => {
    clock.current = SPOTLIGHT_TEST_NOW
    analytics.splice(0)
  })
  afterAll(async () => {
    try {
      let cursor = '0'
      do {
        const [next, keys] = await redis.scan(
          cursor,
          'MATCH',
          `${prefix}:*`,
          'COUNT',
          500
        )
        cursor = next
        if (keys.length) await redis.del(...keys)
      } while (cursor !== '0')
      redis.disconnect()
      await prisma.$disconnect()
    } finally {
      await database.drop()
    }
  })

  return {
    prisma,
    redis,
    prefix,
    clock,
    analytics,
    telemetry,
    flags,
    repository,
    community,
    spotlightRepository,
    cache,
    streams,
    invalidator,
    service,
    serviceWith,
    member,
    cohort,
    react,
    drain,
    read,
    area: (suffix: string) => uniqueSpotlightArea(`${label}:${suffix}:${randomUUID()}`),
  }
}
