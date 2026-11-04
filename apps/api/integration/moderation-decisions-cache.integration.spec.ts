// Story 6.11 test owner: public caches and screening intake against real Postgres and real Redis, with no worker running.
// I-K-TAKEDOWN-READS, -BAN-EPOCH, -REDIS-DOWN, -OVERTURN, -REPLAY-RERUN, -NO-PUBLIC, -COMMENT-STREAM, -RELEASE,
// I-S-INTAKE, -LOOP, -IDENTITY, -FINDING-PARITY.
import { createHash, randomUUID } from 'node:crypto'
import { Logger, type INestApplication } from '@nestjs/common'
import Redis from 'ioredis'
import sharp from 'sharp'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  communityCommentSubmissionResponseSchema,
  communityCommentsResponseSchema,
  communityFeedResponseSchema,
  communitySpotlightResponseSchema,
  deriveCaseRisk,
  moderationAppealResponseSchema,
  moderationCasesResponseSchema,
  moderationDecisionResponseSchema,
  allocateCommunityPostResponseSchema,
  type ModerationCaseSummary,
} from '@couture/api-client/contracts/http'
import {
  buildLookbookPostCreateInput,
  buildSpotlightSavedLocationCreateInput,
  createLookbookPost,
  normalizeSpotlightAreaNames,
  persistSpotlightCohort,
  planSpotlightCohort,
  uniqueSpotlightArea,
} from '@couture/testing'
import { getRedisConfig, redisOptionsFromConfig } from '../src/config/redis.js'
import { CommunityCommentsProcessor } from '../src/modules/community/community-comments.processor.js'
import { FixtureCommunityModerationEngine } from '../src/modules/community/community-moderation.engine.js'
import { CommunityModerationProcessor } from '../src/modules/community/community-moderation.processor.js'
import { CommunityRepository } from '../src/modules/community/community.repository.js'
import { CommunityService } from '../src/modules/community/community.service.js'
import {
  areaHash,
  areaHashesOf,
} from '../src/modules/community/community-spotlight-area.js'
import {
  CommunitySpotlightCache,
  type SpotlightRedis,
} from '../src/modules/community/community-spotlight-cache.js'
import { CommunitySpotlightInvalidator } from '../src/modules/community/community-spotlight-invalidator.js'
import { CommunitySpotlightRepository } from '../src/modules/community/community-spotlight.repository.js'
import { CommunitySpotlightService } from '../src/modules/community/community-spotlight.service.js'
import { InMemoryCommunityStorage } from '../src/modules/community/community-storage.fake.js'
import { CommunityStreamRepository } from '../src/modules/community/community-stream.repository.js'
import { MODERATION_AFTER_COMMIT_BOUND_MS } from '../src/modules/moderation/moderation-sanctions.service.js'
import { unavailableRedis } from './helpers/community-spotlight-context.js'
import { drainCommunityOutbox } from './helpers/community-outbox-drain.js'
import {
  banMarker,
  decisionFixtures,
  moderationDecisionsTestContext,
  type DecisionBoot,
  type SeededMember,
} from './helpers/moderation-decisions-seed.js'

vi.setConfig({ testTimeout: 30_000 })

/** Seconds past the minute, so the spotlight `as_of` truncation runs on every read. */
const NOW = new Date('2026-11-04T12:00:30.000Z')
const AS_OF = new Date('2026-11-04T12:00:00.000Z')
/** Inside the spotlight window and before `as_of`, so a seeded post can rank. */
const RANKED_AT = new Date(AS_OF.getTime() - 30 * 60_000)
const DAY_MS = 86_400_000
const REASON = 'Breaks the community rules.'
/** Room for the transaction itself on a slow machine. An unbounded step never returns at all. */
const AFTER_COMMIT_MARGIN_MS = 1500

const ctx = moderationDecisionsTestContext()
const { prisma, clock, flags, flagValues } = ctx
const fx = decisionFixtures(prisma, clock.now)

const redisConfig = getRedisConfig()
const redis = new Redis(redisConfig.url, {
  ...redisOptionsFromConfig(redisConfig),
  maxRetriesPerRequest: 1,
  enableOfflineQueue: true,
  connectTimeout: 1000,
  lazyConnect: true,
})
redis.on('error', () => undefined)
const liveRedis = redis as unknown as SpotlightRedis
const prefix = `cc611-test:cache:${randomUUID()}`
const cache = new CommunitySpotlightCache(liveRedis, prefix)
const invalidator = new CommunitySpotlightInvalidator(prisma, cache)
const streams = new CommunityStreamRepository(prisma)

const media = new InMemoryCommunityStorage()
const weather = {
  getLatestWeather: () => Promise.resolve({ status: 'unavailable' as const }),
}
const telemetry = { captureEvent: vi.fn(() => Promise.resolve()) }

/** The spotlight read path of production: real service, real repository, a Redis client of the test's choosing. */
function spotlightWith(client: SpotlightRedis) {
  const community = new CommunityService(
    new CommunityRepository(prisma),
    flags as never,
    weather as never,
    telemetry as never,
    media,
    {} as never
  )
  return new CommunitySpotlightService(
    new CommunitySpotlightRepository(prisma),
    community,
    telemetry as never,
    client,
    { now: clock.now },
    prefix
  )
}

const booted: INestApplication[] = []

/**
 * The real spotlight and stream on the decision app.
 * This spec reads the feed, so it also passes the weather, telemetry and storage doubles.
 */
async function bootWith(client: SpotlightRedis): Promise<DecisionBoot> {
  const boot = await ctx.bootApp({
    spotlight: spotlightWith(client),
    streams,
    community: { weather, telemetry, storage: media },
  })
  booted.push(boot.app)
  return boot
}

let live: DecisionBoot
let jpegBytes: Buffer
let jpegChecksum: string

beforeAll(async () => {
  clock.at(NOW)
  await redis.connect()
  await redis.ping()
  live = await bootWith(liveRedis)
  jpegBytes = await sharp({
    create: {
      width: 512,
      height: 640,
      channels: 3,
      background: { r: 200, g: 180, b: 160 },
    },
  })
    .jpeg()
    .toBuffer()
  jpegChecksum = createHash('sha256').update(jpegBytes).digest('hex')
}, 120_000)

afterEach(() => {
  clock.at(NOW)
  flagValues.clear()
})

afterAll(async () => {
  await Promise.all(booted.map((app) => app.close()))
  let cursor = '0'
  do {
    const [next, keys] = await redis.scan(cursor, 'MATCH', `${prefix}:*`, 'COUNT', 500)
    cursor = next
    if (keys.length) await redis.del(...keys)
  } while (cursor !== '0')
  redis.disconnect()
})

const moderator = async (boot: DecisionBoot = live) =>
  boot.staff('moderator', await fx.operator())
const admin = async (boot: DecisionBoot = live) =>
  boot.staff('admin', await fx.operator())

function applied(response: { status: number; body: unknown }) {
  expect(response.status, JSON.stringify(response.body)).toBe(200)
  return moderationDecisionResponseSchema.parse(response.body).data
}

function appealed(response: { status: number; body: unknown }) {
  expect(response.status, JSON.stringify(response.body)).toBe(200)
  return moderationAppealResponseSchema.parse(response.body).data
}

// --- Spotlight seed and reads ---

type SeededArea = Awaited<ReturnType<typeof seededArea>>

/** A city with six ranked authors, so removing one post leaves the cohort above five, and a viewer who lives there. */
async function seededArea(label: string) {
  const names = uniqueSpotlightArea(`${fx.runId}:${label}`)
  const components = normalizeSpotlightAreaNames(names)
  const authorIds: string[] = []
  for (let index = 0; index < 6; index += 1)
    authorIds.push((await fx.member('cohort')).id)
  const plan = planSpotlightCohort({
    namespace: `${fx.runId}-${label}`,
    seedTime: AS_OF,
    area: names,
    authorIds,
  })
  await persistSpotlightCohort(prisma, plan)
  const viewer = await fx.member('viewer')
  await prisma.savedLocation.create({
    data: buildSpotlightSavedLocationCreateInput(viewer.id, names),
  })
  return {
    components,
    viewer,
    cohortPosts: plan.expectedOrder,
    cityHash: areaHash(components, 'city'),
    hashes: areaHashesOf(components),
  }
}

/** A post stamped with the area and carrying a reaction from someone else, which is what lets it rank. */
async function rankedPost(
  area: SeededArea,
  author: SeededMember,
  status: 'published' | 'flagged' = 'published'
) {
  const post = await fx.post({
    authorId: author.id,
    status,
    area: area.components,
    publishedAt: RANKED_AT,
  })
  const fan = await fx.member('fan')
  await prisma.communityReaction.create({
    data: { user_id: fan.id, post_id: post.id, selection: 'love', revision: 1 },
  })
  return post
}

async function reportedPost(
  area: SeededArea,
  author: SeededMember,
  status: 'published' | 'flagged' = 'published'
) {
  const post = await rankedPost(area, author, status)
  const reporter = await fx.member('reporter')
  await fx.postReport(post.id, reporter.id)
  return { post, caseId: `post.${post.id}` }
}

/**
 * Appends what the seed wrote and brings the invalidator cursor to the head.
 * It also clears the one-second assist claim a decision in an earlier test left, which is that test's state.
 */
async function settleStream() {
  await drainCommunityOutbox(prisma, streams)
  for (let pass = 0; pass < 20; pass += 1) {
    const outcome = await invalidator.process()
    if (outcome.status === 'idle') break
    expect(outcome.status).not.toBe('deferred')
  }
  await prisma.$executeRaw`UPDATE "CommunityStreamHead" SET last_assist_at = NULL`
}

const spotlightRead = async (
  boot: DecisionBoot,
  viewer: { id: string },
  surface: 'community' | 'home_teaser' = 'community'
) => {
  const response = await boot
    .member(viewer.id)
    .get(`/api/v1/community/spotlight?limit=12&surface=${surface}`)
  expect(response.status, JSON.stringify(response.body)).toBe(200)
  return communitySpotlightResponseSchema.parse(response.body).data
}

const spotlightIds = async (
  boot: DecisionBoot,
  viewer: { id: string },
  surface: 'community' | 'home_teaser' = 'community'
) => (await spotlightRead(boot, viewer, surface)).items.map((item) => item.id)

async function feedIds(viewer: { id: string }) {
  const ids: string[] = []
  let cursor: string | null = null
  do {
    const query: string = cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''
    const response = await live
      .member(viewer.id)
      .get(`/api/v1/community/feed?mode=all&limit=30${query}`)
    expect(response.status, JSON.stringify(response.body)).toBe(200)
    const page = communityFeedResponseSchema.parse(response.body).data
    ids.push(...page.items.map((item) => item.id))
    cursor = page.nextCursor
  } while (cursor)
  return ids
}

async function commentIds(viewer: { id: string }, postId: string) {
  const response = await live
    .member(viewer.id)
    .get(`/api/v1/community/posts/${postId}/comments`)
  expect(response.status, JSON.stringify(response.body)).toBe(200)
  return communityCommentsResponseSchema
    .parse(response.body)
    .data.items.map((item) => item.id)
}

/** Publishes the area's snapshot through the real read and seeds every counter a bump can move. */
async function primeArea(area: SeededArea) {
  await settleStream()
  for (const hash of area.hashes) await cache.counters(hash)
  const page = await spotlightRead(live, area.viewer)
  expect(page.level).toBe('city')
  const pointer = await currentSnapshot(area)
  expect(pointer).not.toBeNull()
  return pointer!
}

const currentSnapshot = async (area: SeededArea) =>
  cache.current('city', area.cityHash, await cache.counters(area.cityHash))

const areaVersions = (area: SeededArea) =>
  Promise.all(area.hashes.map((hash) => redis.get(cache.areaVersionKey(hash))))
const epochValue = () => redis.get(cache.epochKey())

function expectEveryVersionMoved(
  before: (string | null)[],
  after: (string | null)[]
): void {
  expect(after).toHaveLength(3)
  after.forEach((value, index) => {
    expect(value).not.toBeNull()
    expect(value).not.toBe(before[index])
  })
}

const spotlightCursor = async () =>
  (await prisma.communitySpotlightCursor.findUniqueOrThrow({ where: { id: 'public' } }))
    .position
const publicHead = async () =>
  (await prisma.communityStreamHead.findUniqueOrThrow({ where: { id: 'public' } }))
    .sequence

/** The outbox row the trigger wrote, and the public stream event an append made from it. */
async function publicEvent(where: {
  kind: string
  post_id?: string
  comment_id?: string
}) {
  const outbox = await prisma.communityDomainOutbox.findFirstOrThrow({
    where: { stream_id: 'public', ...where },
    orderBy: { created_at: 'desc' },
  })
  expect(outbox.appended_at).not.toBeNull()
  return prisma.communityStreamEvent.findFirstOrThrow({
    where: { source_outbox_id: outbox.id },
  })
}

// --- Screening seed ---

const flagging = () =>
  new FixtureCommunityModerationEngine({
    textOutcome: { passed: false, reasons: ['text_policy_match'] },
    imageOutcome: { passed: true, reasons: [] },
  })

const postProcessor = () =>
  new CommunityModerationProcessor(
    prisma,
    media,
    telemetry as never,
    flagging(),
    undefined,
    flags as never
  )

/** A post the way publish leaves it: `pending_review`, its bytes in storage, an outbox row. */
async function pendingPost(author: { id: string }) {
  const id = `${fx.runId}-pending-${randomUUID()}`
  const objectPath = `community/${id}/${randomUUID()}.jpg`
  const fixture = createLookbookPost(
    {
      id,
      userId: author.id,
      status: 'pending_review',
      caption: 'A classic autumn trench',
      altText: 'Full length photo of a trench coat outfit',
      imageObjectPath: objectPath,
      imageContentType: 'image/jpeg',
      imageChecksum: jpegChecksum,
      imageByteSize: jpegBytes.length,
      publishedAt: null,
      submittedAt: clock.now(),
    },
    { now: clock.now() }
  )
  await prisma.lookbookPost.create({ data: buildLookbookPostCreateInput(fixture) })
  await prisma.communityModerationOutbox.create({ data: { post_id: id } })
  media.put(objectPath, jpegBytes)
  return { postId: id, objectPath }
}

async function queueItems(boot: DecisionBoot = live) {
  const staff = await moderator(boot)
  const items = new Map<string, ModerationCaseSummary>()
  let cursor: string | null = null
  do {
    const query: string = cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''
    const response = await staff.get(`/api/v1/moderation/cases?limit=50${query}`)
    expect(response.status, JSON.stringify(response.body)).toBe(200)
    const page = moderationCasesResponseSchema.parse(response.body).data
    for (const item of page.items) items.set(item.caseId, item)
    cursor = page.nextCursor
  } while (cursor)
  return { staff, items }
}

// --- Public caches ---

describe('I-K-TAKEDOWN-READS: a takedown reaches every public read with no worker (E2, S6)', () => {
  it('removes the post from spotlight, teaser, feed, post and comment reads on the next request', async () => {
    const area = await seededArea('takedown')
    const author = await fx.member('author')
    const { post, caseId } = await reportedPost(area, author)
    const commenter = await fx.member('commenter')
    const comment = await fx.comment({ postId: post.id, authorId: commenter.id })
    const primed = await primeArea(area)
    expect(primed.entries.map((entry) => entry.id)).toContain(post.id)

    const reader = live.member(area.viewer.id)
    expect(await spotlightIds(live, area.viewer)).toContain(post.id)
    expect(await spotlightIds(live, area.viewer, 'home_teaser')).toContain(post.id)
    expect(await feedIds(area.viewer)).toContain(post.id)
    expect((await reader.get(`/api/v1/community/posts/${post.id}`)).status).toBe(200)
    expect(await commentIds(area.viewer, post.id)).toContain(comment.id)

    const versions = await areaVersions(area)
    const epoch = await epochValue()
    const head = await publicHead()
    const cursor = await spotlightCursor()

    const staff = await moderator()
    const result = applied(
      await staff.decide(caseId, { action: 'takedown', reason: REASON })
    )
    expect(result).toMatchObject({
      targetStatus: 'flagged',
      cacheInvalidation: 'completed',
      replayed: false,
    })

    // The request moved the counters itself, since the invalidator cursor never advanced.
    expectEveryVersionMoved(versions, await areaVersions(area))
    expect(await epochValue()).toBe(epoch)
    expect(await spotlightCursor()).toBe(cursor)

    const spotlight = await spotlightIds(live, area.viewer)
    expect(spotlight).not.toContain(post.id)
    expect(spotlight).toEqual(expect.arrayContaining(area.cohortPosts) as unknown)
    expect(await spotlightIds(live, area.viewer, 'home_teaser')).not.toContain(post.id)
    expect(await feedIds(area.viewer)).not.toContain(post.id)
    expect((await reader.get(`/api/v1/community/posts/${post.id}`)).status).toBe(404)
    expect((await reader.get(`/api/v1/community/posts/${post.id}/comments`)).status).toBe(
      404
    )

    const rebuilt = await currentSnapshot(area)
    expect(rebuilt?.entries.map((entry) => entry.id)).not.toContain(post.id)

    // A public removal goes out as an anonymous resync, which is what the client re-reads on.
    const event = await publicEvent({ kind: 'post.removed', post_id: post.id })
    expect(event).toMatchObject({ stream_id: 'public', kind: 'resync', post_id: null })
    expect(event.sequence).toBeGreaterThan(head)
  })
})

describe('I-K-BAN-EPOCH: which read models a ban moves (E2, S6)', () => {
  it('a permanent ban moves the epoch, so three areas rebuild with no entry from the member', async () => {
    const subject = await fx.member('subject')
    const areas = [
      await seededArea('perm-a'),
      await seededArea('perm-b'),
      await seededArea('perm-c'),
    ]
    const first = await reportedPost(areas[0]!, subject)
    const others = [
      await rankedPost(areas[1]!, subject),
      await rankedPost(areas[2]!, subject),
    ]
    const owned = [first.post.id, ...others.map((post) => post.id)]
    for (const [index, area] of areas.entries()) {
      const primed = await primeArea(area)
      expect(primed.entries.map((entry) => entry.id)).toContain(owned[index])
    }
    const epoch = await epochValue()
    const staff = await admin()
    const result = applied(
      await staff.decide(first.caseId, {
        action: 'ban',
        reason: REASON,
        ban: { kind: 'permanent' },
      })
    )
    expect(result.cacheInvalidation).toBe('completed')
    expect(result.sanction?.kind).toBe('permanent')
    expect(await epochValue()).not.toBe(epoch)

    for (const area of areas) {
      // The epoch orphaned the pointer, so the area rebuilds whatever its own version says.
      expect(await currentSnapshot(area)).toBeNull()
      const ids = await spotlightIds(live, area.viewer)
      expect(ids).toEqual(expect.arrayContaining(area.cohortPosts) as unknown)
      for (const id of owned) expect(ids).not.toContain(id)
      const rebuilt = await currentSnapshot(area)
      expect(rebuilt).not.toBeNull()
      for (const id of owned)
        expect(rebuilt!.entries.map((entry) => entry.id)).not.toContain(id)
    }
  })

  it('a temporary ban bumps only the target areas and leaves other content ranked', async () => {
    const subject = await fx.member('subject')
    const target = await seededArea('temp-target')
    const other = await seededArea('temp-other')
    const { post, caseId } = await reportedPost(target, subject)
    const elsewhere = await rankedPost(other, subject)
    await primeArea(target)
    const otherPrimed = await primeArea(other)
    expect(otherPrimed.entries.map((entry) => entry.id)).toContain(elsewhere.id)

    const epoch = await epochValue()
    const targetVersions = await areaVersions(target)
    const otherVersions = await areaVersions(other)

    const staff = await moderator()
    const result = applied(
      await staff.decide(caseId, {
        action: 'ban',
        reason: REASON,
        ban: { kind: 'temporary', durationDays: 7 },
      })
    )
    expect(result.cacheInvalidation).toBe('completed')
    expect(result.sanction?.kind).toBe('temporary')

    expect(await epochValue()).toBe(epoch)
    expectEveryVersionMoved(targetVersions, await areaVersions(target))
    expect(await areaVersions(other)).toEqual(otherVersions)
    expect((await currentSnapshot(other))?.id).toBe(otherPrimed.id)

    expect(await spotlightIds(live, target.viewer)).not.toContain(post.id)
    expect(await spotlightIds(live, other.viewer)).toContain(elsewhere.id)
  })
})

describe('I-K-REDIS-DOWN: an outage changes only cacheInvalidation (E2, S6, S-11)', () => {
  /** Runs `work` and returns the warn lines it logged. */
  async function warnLines(work: () => Promise<void>) {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    try {
      await work()
      return warn.mock.calls.map((call) => call[0] as unknown)
    } finally {
      warn.mockRestore()
    }
  }

  it('a failing Redis: 200, deferred, one closed log line, the next read excludes, the bump replays', async () => {
    const down = await bootWith(unavailableRedis)
    const area = await seededArea('redis-failing')
    const author = await fx.member('author')
    const { post, caseId } = await reportedPost(area, author)
    await primeArea(area)
    const versions = await areaVersions(area)
    const epoch = await epochValue()
    const staff = await moderator(down)

    let response: { status: number; body: unknown } = { status: 0, body: null }
    const lines = await warnLines(async () => {
      response = await staff.decide(caseId, { action: 'takedown', reason: REASON })
    })
    const result = applied(response)
    expect(result).toMatchObject({
      cacheInvalidation: 'deferred',
      targetStatus: 'flagged',
    })

    // The decision stands.
    const rows = await prisma.moderationDecision.findMany({ where: { case_key: caseId } })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ action: 'takedown', moderator_id: staff.id })
    expect(
      (await prisma.lookbookPost.findUniqueOrThrow({ where: { id: post.id } })).status
    ).toBe('flagged')

    // One line, closed code, nothing identifying.
    expect(lines).toEqual([{ event: 'moderation_cache_invalidation_deferred' }])

    // No bump happened, so only the visibility recheck can keep the post out.
    expect(await areaVersions(area)).toEqual(versions)
    expect(await epochValue()).toBe(epoch)
    expect(await spotlightIds(down, area.viewer)).not.toContain(post.id)
    expect(await spotlightIds(live, area.viewer)).not.toContain(post.id)

    // The stream holds what Redis missed: a pass while it is down defers, and the next one replays.
    await drainCommunityOutbox(prisma, streams)
    const cursor = await spotlightCursor()
    const offline = new CommunitySpotlightInvalidator(
      prisma,
      new CommunitySpotlightCache(unavailableRedis, prefix)
    )
    await expect(offline.process()).resolves.toEqual({
      status: 'deferred',
      reason: 'redis_unavailable',
    })
    expect(await spotlightCursor()).toBe(cursor)
    const event = await publicEvent({ kind: 'post.removed', post_id: post.id })
    const beforeReplay = await epochValue()
    await expect(invalidator.process()).resolves.toMatchObject({ status: 'advanced' })
    expect(await epochValue()).not.toBe(beforeReplay)
    expect(await spotlightCursor()).toBeGreaterThanOrEqual(event.sequence)
  })

  it('a hanging Redis: the 200 returns inside the after-commit bound, deferred', async () => {
    const hanging = {
      get: vi.fn(() => new Promise<string | null>(() => undefined)),
      set: vi.fn(() => new Promise<'OK' | null>(() => undefined)),
      eval: vi.fn(() => new Promise<unknown>(() => undefined)),
    }
    const stuck = await bootWith(hanging)
    const area = await seededArea('redis-hanging')
    const author = await fx.member('author')
    const { post, caseId } = await reportedPost(area, author)
    await primeArea(area)
    const versions = await areaVersions(area)
    const staff = await moderator(stuck)
    const { revision } = await staff.detail(caseId)

    const started = performance.now()
    const response = await staff.decide(caseId, {
      action: 'takedown',
      reason: REASON,
      expectedRevision: revision,
    })
    const elapsed = performance.now() - started

    expect(applied(response).cacheInvalidation).toBe('deferred')
    // The bump really ran and really hung, and only the bound let the response go.
    expect(hanging.eval).toHaveBeenCalledTimes(1)
    expect(elapsed).toBeGreaterThanOrEqual(MODERATION_AFTER_COMMIT_BOUND_MS - 50)
    expect(elapsed).toBeLessThan(
      MODERATION_AFTER_COMMIT_BOUND_MS + AFTER_COMMIT_MARGIN_MS
    )

    expect(
      (await prisma.lookbookPost.findUniqueOrThrow({ where: { id: post.id } })).status
    ).toBe('flagged')
    expect(await prisma.moderationDecision.count({ where: { case_key: caseId } })).toBe(1)
    expect(await areaVersions(area)).toEqual(versions)
    expect(await spotlightIds(live, area.viewer)).not.toContain(post.id)

    // Redis answers again: the durable cursor replays the bump.
    await drainCommunityOutbox(prisma, streams)
    const beforeReplay = await epochValue()
    await expect(invalidator.process()).resolves.toMatchObject({ status: 'advanced' })
    expect(await epochValue()).not.toBe(beforeReplay)
  })
})

describe('I-K-OVERTURN: an overturned appeal returns content with no worker (E2, S6)', () => {
  it('moves the epoch and restored content returns on the next read, the taken-down target stays down', async () => {
    const area = await seededArea('overturn')
    const subject = await fx.member('subject')
    const { post: target, caseId } = await reportedPost(area, subject)
    const other = await rankedPost(area, subject)
    await primeArea(area)
    const staff = await admin()

    const ban = applied(
      await staff.decide(caseId, {
        action: 'ban',
        reason: REASON,
        ban: { kind: 'permanent' },
      })
    )
    const sanctionId = ban.sanction!.sanctionId
    const banned = await spotlightIds(live, area.viewer)
    expect(banned).not.toContain(other.id)
    expect(banned).not.toContain(target.id)

    // A step that restores nothing moves nothing.
    const epochBeforeRequest = await epochValue()
    appealed(await staff.appeal(sanctionId, { status: 'requested', reason: REASON }))
    expect(await epochValue()).toBe(epochBeforeRequest)

    // Replaying the ban moves the epoch once more, so this read publishes the pointer the overturn must orphan.
    await settleStream()
    await spotlightIds(live, area.viewer)
    expect(await currentSnapshot(area)).not.toBeNull()
    const epoch = await epochValue()
    const cursor = await spotlightCursor()
    const overturned = appealed(
      await staff.appeal(sanctionId, { status: 'overturned', reason: REASON })
    )
    expect(overturned).toMatchObject({
      cacheInvalidation: 'completed',
      active: false,
      restoredCount: 1,
    })

    expect(await epochValue()).not.toBe(epoch)
    expect(await spotlightCursor()).toBe(cursor)
    expect(await currentSnapshot(area)).toBeNull()

    const ids = await spotlightIds(live, area.viewer)
    expect(ids).toContain(other.id)
    expect(ids).not.toContain(target.id)
  })
})

describe('I-K-REPLAY-RERUN: a retry repairs a crash after commit (E2, S6, TEA-13)', () => {
  it('stored response, no new decision row, and the bump runs and reports its own result', async () => {
    const down = await bootWith(unavailableRedis)
    const area = await seededArea('replay')
    const author = await fx.member('author')
    const { post, caseId } = await reportedPost(area, author)
    await primeArea(area)
    const operator = await fx.operator()
    const mutationId = randomUUID()
    const versions = await areaVersions(area)

    // The commit lands and the after-commit step dies, which is what a crash leaves behind.
    const crashed = down.staff('moderator', operator)
    const first = applied(
      await crashed.decide(caseId, { action: 'takedown', reason: REASON, mutationId })
    )
    expect(first).toMatchObject({ replayed: false, cacheInvalidation: 'deferred' })
    expect(await areaVersions(area)).toEqual(versions)

    const stored = await prisma.moderationDecision.findFirstOrThrow({
      where: { case_key: caseId },
    })
    expect(stored.response).not.toHaveProperty('cacheInvalidation')
    expect(stored.response).not.toHaveProperty('replayed')

    // A retry while Redis is still down reports that retry's own outcome.
    const stillDown = applied(
      await crashed.decide(caseId, {
        action: 'takedown',
        reason: REASON,
        mutationId,
        expectedRevision: first.revision,
      })
    )
    expect(stillDown).toMatchObject({ replayed: true, cacheInvalidation: 'deferred' })
    expect(await areaVersions(area)).toEqual(versions)

    // The retry after recovery runs the bump the crash lost.
    const retried = applied(
      await live.staff('moderator', operator).decide(caseId, {
        action: 'takedown',
        reason: REASON,
        mutationId,
        expectedRevision: first.revision,
      })
    )
    expect(retried).toMatchObject({
      decisionId: first.decisionId,
      decidedAt: first.decidedAt,
      revision: first.revision,
      targetStatus: 'flagged',
      replayed: true,
      cacheInvalidation: 'completed',
    })
    expectEveryVersionMoved(versions, await areaVersions(area))

    const rows = await prisma.moderationDecision.findMany({ where: { case_key: caseId } })
    expect(rows).toHaveLength(1)
    expect(rows[0]!.id).toBe(stored.id)
    expect(await spotlightIds(live, area.viewer)).not.toContain(post.id)
  })
})

describe('I-K-NO-PUBLIC: the D12 inventory stays true (E2, S6)', () => {
  it('feed, comments, spotlight and teaser responses hold no public or s-maxage directive', async () => {
    const area = await seededArea('headers')
    const author = await fx.member('author')
    const post = await rankedPost(area, author)
    const root = await fx.comment({ postId: post.id, authorId: author.id })
    await primeArea(area)
    const reader = live.member(area.viewer.id)
    const routes = [
      '/api/v1/community/feed?mode=all',
      '/api/v1/community/spotlight',
      '/api/v1/community/spotlight?surface=home_teaser',
      `/api/v1/community/posts/${post.id}`,
      `/api/v1/community/posts/${post.id}/comments`,
      `/api/v1/community/posts/${post.id}/comments/${root.id}/replies`,
    ]
    for (const route of routes) {
      const response = await reader.get(route)
      expect(response.status, route).toBe(200)
      const directive = response.headers['cache-control'] as string | undefined
      expect(directive, route).toBe('private, no-store')
      expect(directive, route).not.toMatch(/public|s-maxage/i)
      expect(response.headers['cdn-cache-control'], route).toBeUndefined()
      expect(response.headers['surrogate-control'], route).toBeUndefined()
    }
  })
})

describe('I-K-COMMENT-STREAM: comment decisions reach the stream with no worker (E2, S6)', () => {
  it('a takedown records comment.removed in the transaction, before any append runs', async () => {
    const seeded = await fx.commentCase()
    await settleStream()
    // The helper's default boot has a stream double, so nothing here can append.
    const noAssist = await ctx.bootApp()
    booted.push(noAssist.app)
    const staff = await moderator(noAssist)
    applied(await staff.decide(seeded.caseId, { action: 'takedown', reason: REASON }))
    expect(ctx.streams.assist).toHaveBeenCalledTimes(1)
    const recorded = await prisma.communityDomainOutbox.findFirstOrThrow({
      where: {
        stream_id: 'public',
        kind: 'comment.removed',
        comment_id: seeded.commentId,
      },
    })
    expect(recorded.appended_at).toBeNull()
    expect(recorded.post_id).toBe(seeded.postId)
    await expect(streams.assist()).resolves.toBeGreaterThan(0)
    await expect(
      publicEvent({ kind: 'comment.removed', comment_id: seeded.commentId })
    ).resolves.toMatchObject({ stream_id: 'public', kind: 'resync' })
  })

  it('a takedown through the route reaches the public stream, and the thread drops the comment', async () => {
    const seeded = await fx.commentCase()
    await settleStream()
    const reader = await fx.member('reader')
    expect(await commentIds(reader, seeded.postId)).toContain(seeded.commentId)
    const head = await publicHead()
    const cursor = await spotlightCursor()
    const staff = await moderator()
    const result = applied(
      await staff.decide(seeded.caseId, { action: 'takedown', reason: REASON })
    )
    expect(result).toMatchObject({
      targetStatus: 'blocked',
      cacheInvalidation: 'completed',
    })
    const event = await publicEvent({
      kind: 'comment.removed',
      comment_id: seeded.commentId,
    })
    expect(event).toMatchObject({ stream_id: 'public', kind: 'resync' })
    expect(event.sequence).toBeGreaterThan(head)
    expect(await spotlightCursor()).toBe(cursor)
    expect(await commentIds(reader, seeded.postId)).not.toContain(seeded.commentId)
  })

  it('a ban and its overturn record comment.removed and comment.published', async () => {
    const subject = await fx.member('subject')
    const origin = await fx.postCase({ author: subject })
    const owner = await fx.member('owner')
    const host = await fx.post({ authorId: owner.id })
    const comment = await fx.comment({ postId: host.id, authorId: subject.id })
    const reader = await fx.member('reader')
    await settleStream()
    expect(await commentIds(reader, host.id)).toContain(comment.id)
    const staff = await admin()

    const ban = applied(
      await staff.decide(origin.caseId, {
        action: 'ban',
        reason: REASON,
        ban: { kind: 'permanent' },
      })
    )
    expect(ban.cacheInvalidation).toBe('completed')
    await expect(
      publicEvent({ kind: 'comment.removed', comment_id: comment.id })
    ).resolves.toMatchObject({ stream_id: 'public', kind: 'resync' })
    expect(await commentIds(reader, host.id)).not.toContain(comment.id)

    const sanctionId = ban.sanction!.sanctionId
    appealed(await staff.appeal(sanctionId, { status: 'requested', reason: REASON }))
    await settleStream()
    const head = await publicHead()
    const overturned = appealed(
      await staff.appeal(sanctionId, { status: 'overturned', reason: REASON })
    )
    expect(overturned.cacheInvalidation).toBe('completed')

    const event = await publicEvent({ kind: 'comment.published', comment_id: comment.id })
    expect(event).toMatchObject({
      stream_id: 'public',
      kind: 'comment.published',
      post_id: host.id,
      comment_id: comment.id,
    })
    expect(event.sequence).toBeGreaterThan(head)
    expect(await commentIds(reader, host.id)).toContain(comment.id)
  })
})

describe('I-K-RELEASE: a release shows on the next read and resolve or escalate bump nothing (S6, TEA-21)', () => {
  it('a released post appears on the next spotlight read for its area', async () => {
    const area = await seededArea('release')
    const author = await fx.member('author')
    const { post, caseId } = await reportedPost(area, author, 'flagged')
    const primed = await primeArea(area)
    expect(primed.entries.map((entry) => entry.id)).not.toContain(post.id)
    const versions = await areaVersions(area)
    const epoch = await epochValue()
    const cursor = await spotlightCursor()

    const staff = await moderator()
    const result = applied(
      await staff.decide(caseId, { action: 'release', reason: REASON })
    )
    expect(result).toMatchObject({
      targetStatus: 'published',
      cacheInvalidation: 'completed',
    })
    expectEveryVersionMoved(versions, await areaVersions(area))
    expect(await epochValue()).toBe(epoch)
    expect(await spotlightCursor()).toBe(cursor)

    expect(await spotlightIds(live, area.viewer)).toContain(post.id)
    expect(await spotlightIds(live, area.viewer, 'home_teaser')).toContain(post.id)
    expect(await feedIds(area.viewer)).toContain(post.id)
  })

  it('resolve and escalate run no bump and report completed', async () => {
    const area = await seededArea('no-bump')
    const resolved = await reportedPost(area, await fx.member('author'))
    const escalated = await reportedPost(area, await fx.member('author'))
    const primed = await primeArea(area)
    const versions = await areaVersions(area)
    const epoch = await epochValue()
    const staff = await moderator()
    const assist = vi.spyOn(streams, 'assist')
    try {
      expect(
        applied(
          await staff.decide(resolved.caseId, { action: 'resolve', reason: REASON })
        )
      ).toMatchObject({ targetStatus: 'published', cacheInvalidation: 'completed' })
      expect(
        applied(
          await staff.decide(escalated.caseId, { action: 'escalate', reason: REASON })
        )
      ).toMatchObject({ escalated: true, cacheInvalidation: 'completed' })
      expect(assist).not.toHaveBeenCalled()
    } finally {
      assist.mockRestore()
    }
    expect(await areaVersions(area)).toEqual(versions)
    expect(await epochValue()).toBe(epoch)
    expect((await currentSnapshot(area))?.id).toBe(primed.id)
  })
})

// --- Screening intake ---

describe('I-S-INTAKE: a screener flag reaches the queue through the real processor (S1, D11)', () => {
  it('queues post.<id> with one screening report, due in 24 hours, and offers release', async () => {
    const author = await fx.member('author')
    const { postId, objectPath } = await pendingPost(author)
    const caseId = `post.${postId}`
    ctx.pinWallClock(NOW)
    try {
      await postProcessor().process({ postId, uploadSessionId: postId })
    } finally {
      ctx.unpinWallClock()
    }

    const row = await prisma.lookbookPost.findUniqueOrThrow({ where: { id: postId } })
    expect(row).toMatchObject({
      status: 'flagged',
      moderation_reason: 'text_policy_match',
    })
    const due = new Date(NOW.getTime() + DAY_MS)
    const reports = await prisma.communityPostReport.findMany({
      where: { post_id: postId },
    })
    expect(reports).toHaveLength(1)
    expect(reports[0]).toMatchObject({
      origin: 'screening',
      reporter_id: null,
      reason: 'inappropriate_content',
      subject_alias: author.alias,
      image_object_path: objectPath,
      sla_due_at: due,
      created_at: NOW,
    })
    expect(reports[0]!.content_snapshot).not.toBeNull()

    const { staff, items } = await queueItems()
    expect(items.get(caseId)).toMatchObject({
      source: 'post',
      status: 'open',
      reportCount: 1,
      reasons: ['inappropriate_content'],
      slaDueAt: due.toISOString(),
      slaState: 'on_track',
      hasFinding: true,
    })

    const detail = await staff.detail(caseId)
    expect(detail.reportCount).toBe(1)
    expect(detail.reporters.map((reporter) => reporter.identity)).toEqual([
      { state: 'screening', alias: null },
    ])
    expect(detail.subject).toEqual({ state: 'alias', alias: author.alias })
    expect(detail.priorActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ actorKind: 'screening', action: 'flagged' }),
      ]) as unknown
    )
    expect(detail.allowedActions).toContain('release')
  })
})

describe('I-S-LOOP: the first path out of a held item with no script (E1, S1)', () => {
  it('a post: upload, screen, flag, queue, release, feed', async () => {
    const author = await fx.member('author')
    const member = live.member(author.id)
    const allocated = await member
      .post('/api/v1/community/posts/allocate')
      .set('Idempotency-Key', randomUUID())
      .send({
        locale: 'en-US',
        contentType: 'image/jpeg',
        byteSize: jpegBytes.length,
        sha256: jpegChecksum,
        widthPx: 512,
        heightPx: 640,
      })
    expect(allocated.status, JSON.stringify(allocated.body)).toBe(200)
    const session = allocateCommunityPostResponseSchema.parse(allocated.body).data
    const draft = await prisma.lookbookPost.findUniqueOrThrow({
      where: { id: session.postId },
    })
    await media.upload(draft.image_object_path!, jpegBytes, 'image/jpeg')
    const published = await member
      .post('/api/v1/community/posts/publish')
      .set('Idempotency-Key', randomUUID())
      .send({
        postId: session.postId,
        uploadSessionId: session.uploadSessionId,
        altText: 'Full length photo of a trench coat outfit',
        altTextConfirmed: true,
        caption: 'A classic autumn trench',
        locale: 'en-US',
      })
    expect(published.status, JSON.stringify(published.body)).toBe(200)

    await postProcessor().process({
      postId: session.postId,
      uploadSessionId: session.uploadSessionId,
    })
    expect(
      (await prisma.lookbookPost.findUniqueOrThrow({ where: { id: session.postId } }))
        .status
    ).toBe('flagged')
    const reader = await fx.member('reader')
    expect(await feedIds(reader)).not.toContain(session.postId)

    const caseId = `post.${session.postId}`
    const { staff, items } = await queueItems()
    expect(items.get(caseId)?.reportCount).toBe(1)
    const result = applied(
      await staff.decide(caseId, { action: 'release', reason: REASON })
    )
    expect(result).toMatchObject({
      targetStatus: 'published',
      caseStatus: 'resolved',
      cacheInvalidation: 'completed',
    })

    expect(await feedIds(reader)).toContain(session.postId)
    expect((await queueItems()).items.has(caseId)).toBe(false)
  })

  it('a comment: submit, screen, hold, queue, release, thread', async () => {
    const owner = await fx.member('owner')
    const host = await fx.post({ authorId: owner.id })
    const author = await fx.member('author')
    const created = await live
      .member(author.id)
      .post(`/api/v1/community/posts/${host.id}/comments`)
      .send({
        mutationId: randomUUID(),
        body: 'Love the layers on this one',
        locale: 'en-US',
        parentId: null,
      })
    expect(created.status, JSON.stringify(created.body)).toBe(200)
    const submission = communityCommentSubmissionResponseSchema.parse(created.body).data
    const commentId = submission.id

    await new CommunityCommentsProcessor(
      prisma,
      new FixtureCommunityModerationEngine({
        textOutcome: {
          passed: false,
          reasons: ['text_policy_match'],
          disposition: 'review',
        },
      }),
      flags as never
    ).process(commentId)
    const held = await prisma.communityComment.findUniqueOrThrow({
      where: { id: commentId },
    })
    expect(held).toMatchObject({
      status: 'held_for_review',
      screening_reason: 'text_policy_match',
      publication_sequence: null,
    })
    const reader = await fx.member('reader')
    expect(await commentIds(reader, host.id)).not.toContain(commentId)

    const caseId = `comment.${commentId}`
    const { staff, items } = await queueItems()
    expect(items.get(caseId)).toMatchObject({ reportCount: 1, hasFinding: true })
    const detail = await staff.detail(caseId)
    expect(detail.reporters.map((reporter) => reporter.identity)).toEqual([
      { state: 'screening', alias: null },
    ])
    expect(detail.allowedActions).toContain('release')

    const result = applied(
      await staff.decide(caseId, { action: 'release', reason: REASON })
    )
    expect(result).toMatchObject({
      targetStatus: 'published',
      caseStatus: 'resolved',
      cacheInvalidation: 'completed',
    })
    expect(await commentIds(reader, host.id)).toContain(commentId)
    expect((await queueItems()).items.has(caseId)).toBe(false)
  })
})

describe('I-S-IDENTITY: who a null reporter is (S1, D11, TEA-16)', () => {
  it('an erased member reporter stays erased and a screening report reads screening, on posts and comments', async () => {
    const author = await fx.member('author')
    const post = await fx.post({ authorId: author.id })
    await fx.postReport(post.id, null)
    await fx.postReport(post.id, null, { origin: 'screening' })
    const seededComment = await fx.commentCase({ reports: 0 })
    await fx.commentReport(seededComment.commentId, null)
    const screened = await fx.commentReport(seededComment.commentId, null)
    await prisma.communityCommentReport.update({
      where: { id: screened.id },
      data: { origin: 'screening' },
    })
    const staff = await moderator()
    for (const caseId of [`post.${post.id}`, seededComment.caseId]) {
      const detail = await staff.detail(caseId)
      expect(detail.reporters.map((reporter) => reporter.identity.state).sort()).toEqual([
        'erased',
        'screening',
      ])
      for (const reporter of detail.reporters) expect(reporter.identity.alias).toBeNull()
    }
  })

  it('the flag copies an existing alias', async () => {
    const author = await fx.member('author')
    const { postId } = await pendingPost(author)
    await postProcessor().process({ postId, uploadSessionId: postId })
    const report = await prisma.communityPostReport.findFirstOrThrow({
      where: { post_id: postId },
    })
    expect(report.subject_alias).toBe(author.alias)
    const staff = await moderator()
    expect((await staff.detail(`post.${postId}`)).subject).toEqual({
      state: 'alias',
      alias: author.alias,
    })
  })

  it('the flag never creates an alias, and the read falls back to a live one', async () => {
    // An operator identity is a member with no alias row.
    const author = await fx.operator()
    const { postId } = await pendingPost(author)
    const caseId = `post.${postId}`
    await postProcessor().process({ postId, uploadSessionId: postId })
    const report = await prisma.communityPostReport.findFirstOrThrow({
      where: { post_id: postId },
    })
    expect(report.subject_alias).toBeNull()
    const staff = await moderator()
    expect((await staff.detail(caseId)).subject).toEqual({
      state: 'unknown',
      alias: null,
    })
    expect(
      await prisma.communityAlias.findUnique({ where: { user_id: author.id } })
    ).toBeNull()

    const alias = `${fx.runId}-late-alias`
    await prisma.communityAlias.create({ data: { user_id: author.id, alias } })
    expect((await staff.detail(caseId)).subject).toEqual({ state: 'alias', alias })
  })

  it('review_failed stays with the retry workers and out of the queue', async () => {
    const author = await fx.member('author')
    const { postId } = await pendingPost(author)
    await postProcessor().markFailed(postId, 'STORAGE_PERMISSION_DENIED')
    expect(
      (await prisma.lookbookPost.findUniqueOrThrow({ where: { id: postId } })).status
    ).toBe('review_failed')
    expect(await prisma.communityPostReport.count({ where: { post_id: postId } })).toBe(0)
    const { staff, items } = await queueItems()
    expect(items.has(`post.${postId}`)).toBe(false)
    expect((await staff.get(`/api/v1/moderation/cases/post.${postId}`)).status).toBe(404)
  })
})

describe('I-S-FINDING-PARITY: an operator hold is no finding, in SQL or TypeScript (S1, TEA-04, S-12)', () => {
  /** The public queue item against the public detail, and both against the shared derivation. */
  async function expectParity(
    cases: { label: string; caseId: string; finding: boolean }[]
  ) {
    const { staff, items } = await queueItems()
    for (const { label, caseId, finding } of cases) {
      const risk = deriveCaseRisk({
        reasons: ['harassment'],
        hasFinding: finding,
        distinctOpenReporters: 1,
      })
      const item = items.get(caseId)
      expect(item, label).toBeDefined()
      expect(item?.hasFinding, `${label}: SQL finding`).toBe(finding)
      expect(item?.risk, `${label}: SQL risk`).toBe(risk)
      const detail = await staff.detail(caseId)
      expect(detail.risk, `${label}: TypeScript risk`).toBe(risk)
      if (!finding) expect(detail.findings, `${label}: no finding block`).toBeNull()
    }
  }

  it('the operator values read no finding at the same rank, and unrelated rows still read one', async () => {
    const marker = banMarker(randomUUID())
    const comment = async (
      status: 'blocked' | 'held_for_review',
      screeningReason: string | null
    ) =>
      (
        await fx.commentCase({
          status,
          screeningReason,
          ...(status === 'blocked' ? { wasPublished: true } : {}),
        })
      ).caseId
    const post = async (moderationReason: string | null) =>
      (
        await fx.postCase({
          status: 'flagged',
          moderationReason,
          publishedAt: clock.now(),
        })
      ).caseId
    const cases = [
      {
        label: 'blocked comment, operator_takedown',
        caseId: await comment('blocked', 'operator_takedown'),
        finding: false,
      },
      {
        label: 'blocked comment, ban marker',
        caseId: await comment('blocked', marker),
        finding: false,
      },
      {
        label: 'held comment, ban marker',
        caseId: await comment('held_for_review', marker),
        finding: false,
      },
      {
        label: 'post, operator_takedown',
        caseId: await post('operator_takedown'),
        finding: false,
      },
      { label: 'post, ban marker', caseId: await post(marker), finding: false },
      {
        label: 'blocked comment, screening code',
        caseId: await comment('blocked', 'text_policy_match'),
        finding: true,
      },
      {
        label: 'held comment, screening code',
        caseId: await comment('held_for_review', 'text_policy_match'),
        finding: true,
      },
      {
        label: 'blocked comment, no reason',
        caseId: await comment('blocked', null),
        finding: true,
      },
      {
        label: 'post, screening code',
        caseId: await post('text_policy_match'),
        finding: true,
      },
    ]
    await expectParity(cases)
  })

  it('the values real decisions store read no finding either', async () => {
    const staff = await admin()

    const takenDown = await fx.commentCase()
    applied(await staff.decide(takenDown.caseId, { action: 'takedown', reason: REASON }))
    await fx.commentReport(takenDown.commentId, (await fx.member('reporter')).id)

    const subject = await fx.member('subject')
    const origin = await fx.postCase({ author: subject })
    const owner = await fx.member('owner')
    const host = await fx.post({ authorId: owner.id })
    const hidden = await fx.comment({ postId: host.id, authorId: subject.id })
    const other = await fx.post({ authorId: subject.id })
    const ban = applied(
      await staff.decide(origin.caseId, {
        action: 'ban',
        reason: REASON,
        ban: { kind: 'permanent' },
      })
    )
    const stored = banMarker(ban.sanction!.sanctionId)
    expect(
      (await prisma.communityComment.findUniqueOrThrow({ where: { id: hidden.id } }))
        .screening_reason
    ).toBe(stored)
    expect(
      (await prisma.lookbookPost.findUniqueOrThrow({ where: { id: other.id } }))
        .moderation_reason
    ).toBe(stored)
    await fx.commentReport(hidden.id, (await fx.member('reporter')).id)
    await fx.postReport(other.id, (await fx.member('reporter')).id)

    expect(
      (
        await prisma.communityComment.findUniqueOrThrow({
          where: { id: takenDown.commentId },
        })
      ).screening_reason
    ).toBe('operator_takedown')
    await expectParity([
      { label: 'taken-down comment', caseId: takenDown.caseId, finding: false },
      { label: 'ban-hidden comment', caseId: `comment.${hidden.id}`, finding: false },
      { label: 'ban-hidden post', caseId: `post.${other.id}`, finding: false },
    ])
  })
})
