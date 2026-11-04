// Story 6.11 test owner: community bans and appeals against a real, migrated Postgres.
// I-B-ROUTES, -BODY, -CONTENT-TEMP, -CONTENT-PERM, -PENDING, -EXPIRY, -UPGRADE, -SECOND, -ERASED,
// -REALTIME, -SEND-GUARD, -RETRACT, -NONCOMMUNITY, -TEEN, -FLAG-OFF, -REPLIES, -SHARE-CARD,
// -ERASURE-CASCADE, -RACE-ENGAGE, -SCALE.
// I-A-HAPPY, -OVERTURN, -OVERTURN-CONSENT, -BAD-STEP, -SELF, -IDEMPOTENT, -RACE, -FIRST-UNMOVED.
//
// Two apps run on the one disposable database.
// `boot` is the shared decision harness, used for every operator request.
// `wire` is built here for member requests, because the harness has no sync, share-card or
// non-community controller and no global exception filter.
// `wire` composes the real controllers and services with the real ApiExceptionFilter.
// Its doubles are identity, flags, analytics, object storage and the ritual's weather and Redis.
// Direct calls instead of HTTP: the send guard, both processors and the realtime server have no
// HTTP route, so each runs through its own real class.
import 'reflect-metadata'
import { createHash, randomUUID } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { HttpAdapterHost } from '@nestjs/core'
import type { INestApplication } from '@nestjs/common'
import { Test as NestTest } from '@nestjs/testing'
import { Client } from 'pg'
import sharp from 'sharp'
import { io, type Socket } from 'socket.io-client'
import request, { type Response, type Test } from 'supertest'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  communityBannedErrorSchema,
  moderationAppealResponseSchema,
  moderationDecisionResponseSchema,
  prepareShareCardResponseSchema,
} from '@couture/api-client/contracts/http'
import { bearer, checksumTables } from './helpers/moderation-queue-context.js'
import {
  banMarker,
  decisionFixtures,
  moderationDecisionsTestContext,
  type DecisionBoot,
  type SeededMember,
} from './helpers/moderation-decisions-seed.js'
import { prepareNotificationPass } from './helpers/community-notification-preparation.js'
import { ApiExceptionFilter } from '../src/filters/api-exception.filter.js'
import { bindRequestContext } from '../src/logger/request-context.js'
import { AlertsController } from '../src/modules/alerts/alerts.controller.js'
import { PrismaAlertsRepository } from '../src/modules/alerts/alerts.repository.js'
import { AlertsService } from '../src/modules/alerts/alerts.service.js'
import { AccessTokenIdentityService } from '../src/modules/auth/access-token-identity.service.js'
import { GuardianConsentStateService } from '../src/modules/auth/guardian-consent-state.service.js'
import { CommercePreferencesController } from '../src/modules/commerce/commerce-preferences.controller.js'
import { CommercePreferencesService } from '../src/modules/commerce/commerce-preferences.service.js'
import { CommerceRepository } from '../src/modules/commerce/commerce.repository.js'
import { AffiliateOfferService } from '../src/modules/commerce/affiliate-offer.service.js'
import { CommunitySponsorshipService } from '../src/modules/commerce/community-sponsorship.service.js'
import { CommunityAccessService } from '../src/modules/community/community-access.service.js'
import { CommunityCommentsController } from '../src/modules/community/community-comments.controller.js'
import { CommunityCommentsOutbox } from '../src/modules/community/community-comments.outbox.js'
import { CommunityCommentsProcessor } from '../src/modules/community/community-comments.processor.js'
import { CommunityCommentsRepository } from '../src/modules/community/community-comments.repository.js'
import { CommunityCommentsService } from '../src/modules/community/community-comments.service.js'
import { CommunityController } from '../src/modules/community/community.controller.js'
import { FixtureCommunityModerationEngine } from '../src/modules/community/community-moderation.engine.js'
import { CommunityModerationOutboxDispatcher } from '../src/modules/community/community-moderation.outbox.js'
import { CommunityModerationProcessor } from '../src/modules/community/community-moderation.processor.js'
import { CommunityNotificationsWorker } from '../src/modules/community/community-notifications.worker.js'
import { CommunityPreferencesService } from '../src/modules/community/community-preferences.service.js'
import {
  communityPrivacyTransaction,
  guardCommunityPost,
  guardCommunitySubject,
} from '../src/modules/community/community-privacy.js'
import { CommunityPushProvider } from '../src/modules/community/community-push-provider.js'
import { CommunityRepository } from '../src/modules/community/community.repository.js'
import { CommunitySendGuard } from '../src/modules/community/community-send-guard.js'
import { CommunityService } from '../src/modules/community/community.service.js'
import { CommunitySpotlightRepository } from '../src/modules/community/community-spotlight.repository.js'
import { CommunitySpotlightService } from '../src/modules/community/community-spotlight.service.js'
import type { SpotlightRedis } from '../src/modules/community/community-spotlight-cache.js'
import { InMemoryCommunityStorage } from '../src/modules/community/community-storage.fake.js'
import type { SupabaseCommunityStorageAdapter } from '../src/modules/community/community-storage.adapter.js'
import { CommunityStreamRepository } from '../src/modules/community/community-stream.repository.js'
import { CommunitySyncController } from '../src/modules/community/community-sync.controller.js'
import { CommunitySyncService } from '../src/modules/community/community-sync.service.js'
import { CommunityTargetsService } from '../src/modules/community/community-targets.service.js'
import { CommunityFlagEvaluationService } from '../src/modules/feature-flags/community-flag-evaluation.service.js'
import { FeatureFlagsService } from '../src/modules/feature-flags/feature-flags.service.js'
import { assertWardrobeParticipationAllowed } from '../src/modules/guardian/guardian-participation.js'
import { GuardianService } from '../src/modules/guardian/guardian.service.js'
import { LocationPreferencesService } from '../src/modules/location-preferences/location-preferences.service.js'
import { PrismaLocationPreferencesRepository } from '../src/modules/location-preferences/location-preferences.repository.js'
import { PushRegistrationController } from '../src/modules/notifications/push-registration.controller.js'
import { PushRegistrationService } from '../src/modules/notifications/push-registration.service.js'
import { RitualController } from '../src/modules/personalization/ritual.controller.js'
import { RitualService } from '../src/modules/personalization/ritual.service.js'
import { ShareCardRenderer } from '../src/modules/share-cards/share-card-renderer.js'
import { ShareCardSourceRepository } from '../src/modules/share-cards/share-card-source.repository.js'
import { ShareCardsController } from '../src/modules/share-cards/share-cards.controller.js'
import { ShareCardsService } from '../src/modules/share-cards/share-cards.service.js'
import { UserController } from '../src/modules/user/user.controller.js'
import { UserService } from '../src/modules/user/user.service.js'
import { WardrobeController } from '../src/modules/wardrobe/wardrobe.controller.js'
import { WardrobeRetentionService } from '../src/modules/wardrobe/wardrobe-retention.service.js'
import { WardrobeService } from '../src/modules/wardrobe/wardrobe.service.js'
import { WeatherQueryService } from '../src/modules/weather/weather-query.service.js'
import { WeatherRepository } from '../src/modules/weather/weather.repository.js'
import { createCommunityRealtimeServer } from '../src/realtime/community-realtime.server.js'
import { listenHttpApp } from '../src/testing/loopback-http-app.js'

/** The real clock at load, so a seven day ban stays active against the wall clock on any date. */
const NOW = new Date(Math.floor(Date.now() / 1000) * 1000)
const DAY_MS = 86_400_000
const REASON = 'Breaks the community rules.'
const ctx = moderationDecisionsTestContext()
const { prisma, clock, flags, flagValues, identities, database } = ctx
const fx = decisionFixtures(prisma, clock.now)

type Kind = 'temporary' | 'permanent'
const KINDS: Kind[] = ['temporary', 'permanent']

const repository = new CommunityRepository(prisma)
const guardian = new GuardianService(
  { capture: vi.fn() },
  prisma,
  { markTeenAccessRevoked: vi.fn(), markTeenAccessGranted: vi.fn() } as never,
  { invalidateUserSessions: vi.fn().mockResolvedValue(undefined) } as never
)

let boot: DecisionBoot
let wire: Awaited<ReturnType<typeof bootWire>>

/** Every Redis command refused: a member with no saved location never reaches the cache. */
const spotlightRedis: SpotlightRedis = {
  get: () => Promise.reject(new Error('Connection is closed.')),
  set: () => Promise.reject(new Error('Connection is closed.')),
  eval: () => Promise.reject(new Error('Connection is closed.')),
}

async function bootWire() {
  const storage = new InMemoryCommunityStorage()
  const telemetry = { captureEvent: vi.fn().mockResolvedValue(undefined) }
  const community = new CommunityService(
    repository,
    flags as never,
    {} as never,
    telemetry as never,
    storage,
    guardian
  )
  const access = new CommunityAccessService(prisma, flags as never)
  const streams = new CommunityStreamRepository(prisma)
  const spotlight = new CommunitySpotlightService(
    new CommunitySpotlightRepository(prisma),
    community,
    telemetry as never,
    spotlightRedis,
    { now: clock.now },
    `cc611-test:${randomUUID()}`
  )
  const weatherRepository = new WeatherRepository(prisma)
  const locations = new LocationPreferencesService(
    new PrismaLocationPreferencesRepository(prisma),
    telemetry as never,
    weatherRepository,
    {} as never,
    { now: clock.now }
  )
  const ritual = new RitualService(
    prisma,
    new WeatherQueryService(weatherRepository),
    locations,
    {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue('OK'),
      quit: vi.fn().mockResolvedValue('OK'),
    } as never,
    { capture: vi.fn() } as never
  )
  const shareCards = new ShareCardsService(
    prisma,
    new ShareCardSourceRepository(prisma, community),
    new ShareCardRenderer(),
    storage as unknown as SupabaseCommunityStorageAdapter,
    flags as never
  )
  const module = await NestTest.createTestingModule({
    controllers: [
      CommunityController,
      CommunityCommentsController,
      CommunitySyncController,
      ShareCardsController,
      UserController,
      PushRegistrationController,
      AlertsController,
      CommercePreferencesController,
      WardrobeController,
      RitualController,
    ],
    providers: [
      { provide: CommunityService, useValue: community },
      { provide: CommunitySpotlightService, useValue: spotlight },
      {
        provide: CommunitySponsorshipService,
        useValue: { resolveForPosts: () => Promise.resolve(new Map()) },
      },
      {
        provide: CommunityCommentsService,
        useValue: new CommunityCommentsService(
          new CommunityCommentsRepository(prisma),
          flags as never,
          guardian
        ),
      },
      {
        provide: CommunityPreferencesService,
        useValue: new CommunityPreferencesService(prisma, access),
      },
      {
        provide: CommunitySyncService,
        useValue: new CommunitySyncService(prisma, access, community, streams),
      },
      {
        provide: CommunityTargetsService,
        useValue: new CommunityTargetsService(prisma, access, repository, community),
      },
      { provide: ShareCardsService, useValue: shareCards },
      { provide: UserService, useValue: new UserService(prisma) },
      { provide: PushRegistrationService, useValue: new PushRegistrationService(prisma) },
      {
        provide: AlertsService,
        useValue: new AlertsService(new PrismaAlertsRepository(prisma)),
      },
      {
        provide: CommercePreferencesService,
        useValue: new CommercePreferencesService(new CommerceRepository(prisma)),
      },
      { provide: GuardianService, useValue: guardian },
      {
        provide: WardrobeService,
        useValue: new WardrobeService(
          prisma,
          telemetry as never,
          guardian,
          {} as never,
          {} as never,
          ritual
        ),
      },
      { provide: WardrobeRetentionService, useValue: {} },
      { provide: RitualService, useValue: ritual },
      { provide: AffiliateOfferService, useValue: {} },
      { provide: FeatureFlagsService, useValue: flags },
      { provide: AccessTokenIdentityService, useValue: identities },
      {
        provide: GuardianConsentStateService,
        useValue: { canTeenAccess: vi.fn().mockResolvedValue(true) },
      },
    ],
  }).compile()
  const app: INestApplication = module.createNestApplication()
  app.useLogger(false)
  app.use(bindRequestContext)
  app.useGlobalFilters(
    new ApiExceptionFilter(app.get(HttpAdapterHost), telemetry as never)
  )
  const url = await listenHttpApp(app)
  return { app, url, storage, access, streams }
}

beforeAll(async () => {
  clock.at(NOW)
  // Production runs with the privacy triggers on, so every ban here has to pass them.
  await prisma.$executeRaw`UPDATE "CommunityRuntimeCapability" SET privacy_version = 1 WHERE id = 1`
  boot = await ctx.bootApp()
  wire = await bootWire()
}, 120_000)

afterAll(async () => {
  await wire?.app.close()
  await boot?.app.close()
})

afterEach(() => {
  clock.at(NOW)
  flagValues.clear()
})

/** A signed-in member on the wire app. */
function member(userId: string, role = 'guardian') {
  const signed = (test: Test) =>
    test.set('Authorization', bearer(role, userId)).set('x-couture-platform', 'web')
  return {
    id: userId,
    get: (path: string) => signed(request(wire.url).get(path)),
    post: (path: string) => signed(request(wire.url).post(path)),
    put: (path: string) => signed(request(wire.url).put(path)),
    patch: (path: string) => signed(request(wire.url).patch(path)),
    delete: (path: string) => signed(request(wire.url).delete(path)),
  }
}
type Member = ReturnType<typeof member>

const moderator = async () => boot.staff('moderator', await fx.operator())
const admin = async () => boot.staff('admin', await fx.operator())
type Staff = Awaited<ReturnType<typeof admin>>

const decisionData = (response: Response) =>
  moderationDecisionResponseSchema.parse(response.body).data
const appealData = (response: Response) =>
  moderationAppealResponseSchema.parse(response.body).data
const codeOf = (response: Response) => (response.body as { code?: unknown }).code
const dump = (response: Response) => `${response.status} ${JSON.stringify(response.body)}`

const banTerms = (kind: Kind) =>
  kind === 'temporary' ? { kind, durationDays: 7 } : { kind }

/** Bans the case's subject through the real route and returns the applied decision. */
async function ban(caseId: string, kind: Kind, staff?: Staff) {
  const actor = staff ?? (await admin())
  const response = await actor.decide(caseId, {
    action: 'ban',
    reason: REASON,
    ban: banTerms(kind),
  })
  expect(response.status, dump(response)).toBe(200)
  const data = decisionData(response)
  return { ...data, sanctionId: data.sanction!.sanctionId, staff: actor }
}

/** The exact refusal, with no field beyond the schema's. */
function expectBanned(
  response: Response,
  sanction: {
    kind: Kind
    expiresAt: string | null
    appealStatus: 'not_requested' | 'requested' | 'upheld' | 'overturned'
  }
) {
  expect(response.status, dump(response)).toBe(403)
  const body = communityBannedErrorSchema.parse(response.body)
  expect(response.body).toEqual(body)
  expect(body.sanction).toEqual(sanction)
}

const sanctionOf = (id: string) =>
  prisma.communitySanction.findUniqueOrThrow({ where: { id } })
const postOf = (id: string) => prisma.lookbookPost.findUniqueOrThrow({ where: { id } })
const commentOf = (id: string) =>
  prisma.communityComment.findUniqueOrThrow({ where: { id } })
const reactionOf = (userId: string, postId: string) =>
  prisma.communityReaction.findUniqueOrThrow({
    where: { user_id_post_id: { user_id: userId, post_id: postId } },
  })

/** A live reaction written by the real repository path. */
async function react(userId: string, postId: string) {
  await repository.setReaction({
    userId,
    postId,
    platform: 'web',
    input: { selection: 'love', baseRevision: 0, mutationId: randomUUID() },
    assertEligible: () => Promise.resolve(),
  })
}

/** Row digest for a table's rows of one member, which proves a byte-for-byte unchanged state. */
async function digest(table: string, column: string, userId: string) {
  const rows = await prisma.$queryRawUnsafe<{ count: bigint; digest: string }[]>(
    `SELECT count(*)::bigint AS count, md5(coalesce(string_agg(t::text, '|' ORDER BY t::text), '')) AS digest
     FROM "${table}" t WHERE "${column}" = $1`,
    userId
  )
  return `${rows[0]!.count}:${rows[0]!.digest}`
}

const subjectGeneration = async (userId: string) =>
  (await prisma.communitySubject.findUniqueOrThrow({ where: { member_id: userId } }))
    .generation

/** Runs with both clocks at `at`, because enforcement reads `new Date()`. */
async function atInstant<T>(at: Date, work: () => Promise<T>): Promise<T> {
  clock.at(at)
  ctx.pinWallClock(at)
  try {
    return await work()
  } finally {
    ctx.unpinWallClock()
  }
}

/** An exclusive row or advisory lock held open on its own connection until released. */
async function holdLock(statement: string, values: string[]) {
  const client = new Client({ connectionString: database.url })
  await client.connect()
  await client.query('BEGIN')
  await client.query(statement, values)
  return async () => {
    await client.query('COMMIT')
    await client.end()
  }
}

const holdPostRow = (postId: string) =>
  holdLock('SELECT id FROM "LookbookPost" WHERE id = $1 FOR UPDATE', [postId])
const holdCaseLock = (caseKey: string) =>
  holdLock("SELECT pg_advisory_xact_lock(hashtext('moderation_case:' || $1::text))", [
    caseKey,
  ])

/** Backends in this database that are waiting on a lock. */
async function lockWaiters(): Promise<number> {
  const rows = await prisma.$queryRaw<{ count: bigint }[]>`
    SELECT count(*)::bigint AS count FROM pg_stat_activity
    WHERE datname = current_database() AND wait_event_type = 'Lock'`
  return Number(rows[0]!.count)
}

const untilWaiters = (count: number) =>
  vi.waitFor(async () => expect(await lockWaiters()).toBeGreaterThanOrEqual(count), {
    timeout: 5000,
    interval: 10,
  })

/** Starts a supertest request now, since a `Test` only sends when it is awaited. */
const start = (test: Test): Promise<Response> =>
  new Promise((resolve, reject) => {
    test.then(resolve, reject)
  })

// --- The route matrix ---------------------------------------------------------------------------

type RouteIds = {
  postId: string
  rootId: string
  freshReactionPostId: string
  reactedPostId: string
  clearedPostId: string
  setReplay: { selection: 'love'; baseRevision: number; mutationId: string }
  clearReplay: { selection: null; baseRevision: number; mutationId: string }
  commentReplay: {
    mutationId: string
    body: string
    locale: string
    parentId: string | null
  }
  allocation: { key: string; body: object }
  draft: { postId: string; uploadSessionId: string }
  submitted: object
}

const allocationBody = (seed: string) => ({
  locale: 'en-US',
  contentType: 'image/jpeg',
  byteSize: 1024,
  sha256: createHash('sha256').update(seed).digest('hex'),
  widthPx: 1024,
  heightPx: 1024,
})
const publishBody = (draft: { postId: string; uploadSessionId: string }) => ({
  postId: draft.postId,
  uploadSessionId: draft.uploadSessionId,
  altText: 'A person in a long coat.',
  altTextConfirmed: true,
  caption: null,
  locale: 'en-US',
})

/** One allocated draft with its bytes in storage, written through the real allocate route. */
async function allocateDraft(client: Member, key: string, seed: string) {
  const response = await client
    .post('/api/v1/community/posts/allocate')
    .set('Idempotency-Key', key)
    .send(allocationBody(seed))
  expect(response.status, dump(response)).toBe(200)
  const data = (response.body as { data: { postId: string; uploadSessionId: string } })
    .data
  const row = await postOf(data.postId)
  wire.storage.put(row.image_object_path!, Buffer.from('uploaded'))
  return { postId: data.postId, uploadSessionId: data.uploadSessionId }
}

/** Everything the matrix needs, including the receipts a replay row reads. */
async function seedRoutes(client: Member): Promise<RouteIds> {
  const owner = await fx.member('owner')
  const post = await fx.post({ authorId: owner.id })
  const root = await fx.comment({ postId: post.id, authorId: owner.id })
  const freshReaction = await fx.post({ authorId: owner.id })
  const reacted = await fx.post({ authorId: owner.id })
  const cleared = await fx.post({ authorId: owner.id })
  const commentPost = await fx.post({ authorId: owner.id })

  const setReplay = {
    selection: 'love' as const,
    baseRevision: 0,
    mutationId: randomUUID(),
  }
  const set = await client
    .put(`/api/v1/community/posts/${reacted.id}/reaction`)
    .send(setReplay)
  expect(set.status, dump(set)).toBe(200)
  const setFirst = await client
    .put(`/api/v1/community/posts/${cleared.id}/reaction`)
    .send({ selection: 'love', baseRevision: 0, mutationId: randomUUID() })
  expect(setFirst.status, dump(setFirst)).toBe(200)
  const clearReplay = {
    selection: null,
    baseRevision: 1,
    mutationId: randomUUID(),
  }
  const clear = await client
    .put(`/api/v1/community/posts/${cleared.id}/reaction`)
    .send(clearReplay)
  expect(clear.status, dump(clear)).toBe(200)

  const commentReplay = {
    mutationId: randomUUID(),
    body: 'Lovely layers.',
    locale: 'en-US',
    parentId: null,
  }
  const comment = await client
    .post(`/api/v1/community/posts/${commentPost.id}/comments`)
    .send(commentReplay)
  expect(comment.status, dump(comment)).toBe(200)

  const key = randomUUID()
  const draft = await allocateDraft(client, key, `${client.id}-draft`)
  const submittedDraft = await allocateDraft(
    client,
    randomUUID(),
    `${client.id}-submitted`
  )
  const submitted = publishBody(submittedDraft)
  const published = await client
    .post('/api/v1/community/posts/publish')
    .set('Idempotency-Key', randomUUID())
    .send(submitted)
  expect(published.status, dump(published)).toBe(200)

  return {
    postId: post.id,
    rootId: root.id,
    freshReactionPostId: freshReaction.id,
    reactedPostId: reacted.id,
    clearedPostId: cleared.id,
    setReplay,
    clearReplay,
    commentReplay: { ...commentReplay, parentId: null },
    allocation: { key, body: allocationBody(`${client.id}-draft`) },
    draft,
    submitted,
  }
}

type RouteCall = (client: Member, ids: RouteIds) => Test
/** Name, request, and the status an unbanned member gets from that request. */
const ROUTES: [string, RouteCall, number][] = [
  ['GET feed', (c) => c.get('/api/v1/community/feed'), 200],
  ['GET post', (c, i) => c.get(`/api/v1/community/posts/${i.postId}`), 200],
  ['GET spotlight community', (c) => c.get('/api/v1/community/spotlight'), 200],
  [
    'GET spotlight home_teaser',
    (c) => c.get('/api/v1/community/spotlight?surface=home_teaser'),
    200,
  ],
  ['GET comments', (c, i) => c.get(`/api/v1/community/posts/${i.postId}/comments`), 200],
  [
    'GET replies',
    (c, i) => c.get(`/api/v1/community/posts/${i.postId}/comments/${i.rootId}/replies`),
    200,
  ],
  [
    'GET comment-submissions',
    (c, i) => c.get(`/api/v1/community/posts/${i.postId}/comment-submissions`),
    200,
  ],
  ['GET events', (c) => c.get('/api/v1/community/events'), 200],
  [
    'POST targets/resolve',
    (c, i) =>
      c
        .post('/api/v1/community/targets/resolve')
        .send({ targets: [{ key: 'a', postId: i.postId }] }),
    200,
  ],
  ['GET preferences', (c) => c.get('/api/v1/community/notification-preferences'), 200],
  [
    'PATCH preferences',
    (c) =>
      c
        .patch('/api/v1/community/notification-preferences')
        .send({ baseRevision: 'stale-revision', enabled: true }),
    409,
  ],
  [
    'POST allocate',
    (c) =>
      c
        .post('/api/v1/community/posts/allocate')
        .set('Idempotency-Key', randomUUID())
        .send(allocationBody(`${c.id}-fresh`)),
    200,
  ],
  [
    'POST allocate replay',
    (c, i) =>
      c
        .post('/api/v1/community/posts/allocate')
        .set('Idempotency-Key', i.allocation.key)
        .send(i.allocation.body),
    200,
  ],
  [
    'POST publish',
    (c, i) =>
      c
        .post('/api/v1/community/posts/publish')
        .set('Idempotency-Key', randomUUID())
        .send(publishBody(i.draft)),
    200,
  ],
  [
    'POST publish replay',
    (c, i) =>
      c
        .post('/api/v1/community/posts/publish')
        .set('Idempotency-Key', randomUUID())
        .send(i.submitted),
    200,
  ],
  [
    'POST comment',
    (c, i) =>
      c.post(`/api/v1/community/posts/${i.postId}/comments`).send({
        mutationId: randomUUID(),
        body: 'Lovely layers.',
        locale: 'en-US',
        parentId: null,
      }),
    200,
  ],
  [
    'POST comment with a receipt',
    (c, i) =>
      c
        .post(`/api/v1/community/posts/${i.postId}/comments`)
        .send({ ...i.commentReplay, body: 'A second thought.' }),
    409,
  ],
  [
    'PUT reaction set without a receipt',
    (c, i) =>
      c
        .put(`/api/v1/community/posts/${i.freshReactionPostId}/reaction`)
        .send({ selection: 'love', baseRevision: 0, mutationId: randomUUID() }),
    200,
  ],
  [
    'PUT reaction set with a receipt',
    (c, i) =>
      c.put(`/api/v1/community/posts/${i.reactedPostId}/reaction`).send(i.setReplay),
    200,
  ],
  [
    'PUT reaction remove without a receipt',
    (c, i) =>
      c
        .put(`/api/v1/community/posts/${i.reactedPostId}/reaction`)
        .send({ selection: null, baseRevision: 1, mutationId: randomUUID() }),
    200,
  ],
  [
    'PUT reaction remove with a receipt',
    (c, i) =>
      c.put(`/api/v1/community/posts/${i.clearedPostId}/reaction`).send(i.clearReplay),
    200,
  ],
  [
    'POST post report',
    (c, i) =>
      c.post(`/api/v1/community/posts/${i.postId}/report`).send({ reason: 'harassment' }),
    200,
  ],
  [
    'POST comment report',
    (c, i) =>
      c
        .post(`/api/v1/community/posts/${i.postId}/comments/${i.rootId}/report`)
        .send({ reason: 'harassment' }),
    200,
  ],
  [
    'POST opened from the feed',
    (c, i) =>
      c
        .post(`/api/v1/community/posts/${i.postId}/opened`)
        .send({ experimentVariant: 'auto' }),
    200,
  ],
  [
    'POST opened from the spotlight',
    (c, i) =>
      c
        .post(`/api/v1/community/posts/${i.postId}/opened`)
        .send({ surface: 'spotlight', rank: 1, level: 'city' }),
    200,
  ],
  [
    'POST opened from the home teaser',
    (c, i) =>
      c
        .post(`/api/v1/community/posts/${i.postId}/opened`)
        .send({ surface: 'home_teaser', rank: 1, level: 'city' }),
    200,
  ],
]

describe('I-B-ROUTES: every community route refuses a banned member and only a banned member', () => {
  describe.each(KINDS)('%s ban', (kind) => {
    let client: Member
    let ids: RouteIds
    let sanction: Awaited<ReturnType<typeof fx.sanction>>

    beforeAll(async () => {
      const subject = await fx.member('banned')
      client = member(subject.id)
      ids = await seedRoutes(client)
      sanction = await fx.sanction(subject, { kind })
    }, 60_000)

    it.each(ROUTES)('%s answers 403 community_banned', async (_name, call) => {
      expectBanned(await call(client, ids), {
        kind,
        expiresAt: sanction.expires_at?.toISOString() ?? null,
        appealStatus: 'not_requested',
      })
    })
  })

  describe('an unbanned member on the same routes', () => {
    let client: Member
    let ids: RouteIds

    beforeAll(async () => {
      client = member((await fx.member('control')).id)
      ids = await seedRoutes(client)
    }, 60_000)

    it.each(ROUTES)('%s is not refused', async (_name, call, status) => {
      const response = await call(client, ids)
      expect(codeOf(response), dump(response)).not.toBe('community_banned')
      expect(response.status, dump(response)).toBe(status)
    })
  })
})

describe('I-B-BODY: the refusal on the wire', () => {
  it.each(KINDS)(
    'the %s body survives the global filter and names nothing private',
    async (kind) => {
      const seeded = await fx.postCase()
      const applied = await ban(seeded.caseId, kind)
      const row = await sanctionOf(applied.sanctionId)
      const response = await member(seeded.author.id).get('/api/v1/community/feed')
      expectBanned(response, {
        kind,
        expiresAt: row.expires_at?.toISOString() ?? null,
        appealStatus: 'not_requested',
      })
      expect(Object.keys(response.body as object).sort()).toEqual([
        'code',
        'message',
        'sanction',
        'statusCode',
      ])
      for (const secret of [
        REASON,
        'community_ban:',
        applied.staff.id,
        seeded.caseId,
        seeded.postId,
        applied.sanctionId,
        applied.decisionId,
      ])
        expect(response.text).not.toContain(secret)
    }
  )
})

describe('I-B-CONTENT-TEMP: a temporary ban takes down the case target only', () => {
  it('on a post case, keeps other content and reactions and stamps the reports', async () => {
    const author = await fx.member('author')
    const seeded = await fx.postCase({ author, reports: 2 })
    const otherPost = await fx.post({ authorId: author.id })
    const parent = await fx.post({ authorId: (await fx.member('owner')).id })
    const otherComment = await fx.comment({ postId: parent.id, authorId: author.id })
    await react(author.id, parent.id)
    const reactionBefore = await reactionOf(author.id, parent.id)

    const staff = await moderator()
    const applied = await ban(seeded.caseId, 'temporary', staff)

    expect(applied.targetStatus).toBe('flagged')
    expect(await postOf(seeded.postId)).toMatchObject({
      status: 'flagged',
      moderation_reason: REASON,
    })
    expect(await postOf(otherPost.id)).toMatchObject({
      status: 'published',
      moderation_reason: null,
    })
    expect(await commentOf(otherComment.id)).toMatchObject({
      status: 'published',
      screening_reason: null,
    })
    const reactionAfter = await reactionOf(author.id, parent.id)
    expect(reactionAfter.selection).toBe('love')
    expect(reactionAfter.revision).toBe(reactionBefore.revision)
    const reports = await prisma.communityPostReport.findMany({
      where: { post_id: seeded.postId },
    })
    expect(reports.map((report) => report.resolved_at)).toEqual([NOW, NOW])
    expect(await sanctionOf(applied.sanctionId)).toMatchObject({
      user_id: author.id,
      kind: 'temporary',
      expires_at: new Date(NOW.getTime() + 7 * DAY_MS),
      lifted_at: null,
      appeal_status: 'not_requested',
      case_key: seeded.caseId,
    })
  })

  it('on a comment case, keeps the body as evidence and leaves other posts up', async () => {
    const author = await fx.member('author')
    const seeded = await fx.commentCase({ author })
    const otherPost = await fx.post({ authorId: author.id })
    const staff = await moderator()
    const applied = await ban(seeded.caseId, 'temporary', staff)
    expect(applied.targetStatus).toBe('blocked')
    const comment = await commentOf(seeded.commentId)
    expect(comment.status).toBe('blocked')
    expect(comment.body).toBe(seeded.comment.body)
    expect(comment.screening_reason).toBe('operator_takedown')
    expect(comment.publication_sequence).toBe(seeded.comment.publication_sequence)
    expect((await postOf(otherPost.id)).status).toBe('published')
    const report = await prisma.communityCommentReport.findUniqueOrThrow({
      where: { id: seeded.reportIds[0] },
    })
    expect(report.resolved_at).toEqual(NOW)
  })
})

describe('I-B-CONTENT-PERM: a permanent ban hides everything public or about to be', () => {
  it('moves each row per TEA-05, keeps bodies and positions, and withdraws reactions', async () => {
    const author = await fx.member('author')
    const seeded = await fx.postCase({ author })
    const published = await fx.post({ authorId: author.id })
    const pending = await fx.post({ authorId: author.id, status: 'pending_review' })
    const draft = await fx.post({ authorId: author.id, status: 'draft' })
    const screened = await fx.post({
      authorId: author.id,
      status: 'flagged',
      moderationReason: 'unsafe_class',
      publishedAt: NOW,
    })
    const thirdParty = await fx.post({ authorId: (await fx.member('owner')).id })
    const publicComment = await fx.comment({ postId: thirdParty.id, authorId: author.id })
    const pendingComment = await fx.comment({
      postId: thirdParty.id,
      authorId: author.id,
      status: 'pending_screening',
    })
    const heldComment = await fx.comment({
      postId: thirdParty.id,
      authorId: author.id,
      status: 'held_for_review',
      screeningReason: 'text_policy_match',
    })
    await react(author.id, thirdParty.id)
    const reactionBefore = await reactionOf(author.id, thirdParty.id)

    const applied = await ban(seeded.caseId, 'permanent')
    const marker = banMarker(applied.sanctionId)

    expect(await postOf(seeded.postId)).toMatchObject({
      status: 'flagged',
      moderation_reason: REASON,
    })
    expect(await postOf(published.id)).toMatchObject({
      status: 'flagged',
      moderation_reason: marker,
      published_at: published.published_at,
    })
    expect(await postOf(pending.id)).toMatchObject({
      status: 'flagged',
      moderation_reason: marker,
      published_at: null,
    })
    expect(await postOf(draft.id)).toMatchObject({
      status: 'draft',
      moderation_reason: null,
    })
    expect(await postOf(screened.id)).toMatchObject({
      status: 'flagged',
      moderation_reason: 'unsafe_class',
    })
    expect(await commentOf(publicComment.id)).toMatchObject({
      status: 'blocked',
      screening_reason: marker,
      body: publicComment.body,
      publication_sequence: publicComment.publication_sequence,
      published_at: publicComment.published_at,
    })
    expect(await commentOf(pendingComment.id)).toMatchObject({
      status: 'held_for_review',
      screening_reason: marker,
      body: pendingComment.body,
      publication_sequence: null,
    })
    expect(await commentOf(heldComment.id)).toMatchObject({
      status: 'held_for_review',
      screening_reason: 'text_policy_match',
    })
    const reactionAfter = await reactionOf(author.id, thirdParty.id)
    expect(reactionAfter.selection).toBeNull()
    expect(reactionAfter.revision).toBe(reactionBefore.revision + 1)
    expect((await sanctionOf(applied.sanctionId)).expires_at).toBeNull()
  })

  it('hides a public comment on a third party post from a comment case', async () => {
    const author = await fx.member('author')
    const seeded = await fx.commentCase({ author })
    const thirdParty = await fx.post({ authorId: (await fx.member('owner')).id })
    const elsewhere = await fx.comment({ postId: thirdParty.id, authorId: author.id })
    const applied = await ban(seeded.caseId, 'permanent')
    expect(await commentOf(seeded.commentId)).toMatchObject({
      status: 'blocked',
      screening_reason: 'operator_takedown',
    })
    expect(await commentOf(elsewhere.id)).toMatchObject({
      status: 'blocked',
      screening_reason: banMarker(applied.sanctionId),
    })
  })
})

// --- Processors ---------------------------------------------------------------------------------

const passingEngine = () =>
  new FixtureCommunityModerationEngine({
    textOutcome: { passed: true, reasons: [] },
    imageOutcome: { passed: true, reasons: [] },
  })
const rolloutOpen = { getFeatureFlag: () => Promise.resolve(true) }
const moderationTelemetry = { captureEvent: () => Promise.resolve() } as never

/** A pending post with real image bytes, so a processor can screen it to the publish step. */
async function pendingPostWithImage(authorId: string) {
  const row = await fx.post({ authorId, status: 'pending_review' })
  const bytes = await sharp({
    create: { width: 512, height: 640, channels: 3, background: '#112233' },
  })
    .jpeg({ quality: 100 })
    .toBuffer()
  const post = await prisma.lookbookPost.update({
    where: { id: row.id },
    data: {
      image_checksum: createHash('sha256').update(bytes).digest('hex'),
      image_byte_size: bytes.length,
      image_content_type: 'image/jpeg',
    },
  })
  await prisma.communityModerationOutbox.create({ data: { post_id: post.id } })
  const storage = new InMemoryCommunityStorage()
  storage.put(post.image_object_path!, bytes)
  return { post, storage }
}

async function pendingComment(authorId: string) {
  const parent = await fx.post({ authorId: (await fx.member('owner')).id })
  const comment = await fx.comment({
    postId: parent.id,
    authorId,
    status: 'pending_screening',
    body: 'Keep this body.',
  })
  await prisma.communityCommentScreeningOutbox.create({
    data: { comment_id: comment.id },
  })
  return comment
}

describe('I-B-PENDING: held content never publishes (D8, D9)', () => {
  it.each(KINDS)(
    'a %s ban then dispatch and both processors publish nothing and keep the marker',
    async (kind) => {
      const author = await fx.member('author')
      const seeded = await fx.postCase({ author })
      const { post, storage } = await pendingPostWithImage(author.id)
      const comment = await pendingComment(author.id)

      const applied = await ban(seeded.caseId, kind)
      const marker = banMarker(applied.sanctionId)
      const commentBefore = await commentOf(comment.id)

      const jobs: string[] = []
      await new CommunityModerationOutboxDispatcher(prisma, {
        enqueue: (postId: string) => {
          jobs.push(postId)
          return Promise.resolve()
        },
      }).dispatchPending()
      // A held post costs one job that finds nothing to do.
      expect(jobs).toContain(post.id)
      const screening = vi.fn()
      const engine = passingEngine()
      const screened = {
        moderatePost: (input: Parameters<typeof engine.moderatePost>[0]) => {
          screening()
          return engine.moderatePost(input)
        },
        screenText: (input: Parameters<typeof engine.screenText>[0]) => {
          screening()
          return engine.screenText(input)
        },
      }
      await new CommunityModerationProcessor(
        prisma,
        storage,
        moderationTelemetry,
        screened as never,
        undefined,
        rolloutOpen
      ).process({ postId: post.id, uploadSessionId: post.id })

      const commentJobs: string[] = []
      const processor = new CommunityCommentsProcessor(
        prisma,
        screened as never,
        rolloutOpen
      )
      await new CommunityCommentsOutbox(
        prisma,
        {
          enqueueComment: (id: string) => {
            commentJobs.push(id)
            return Promise.resolve()
          },
        } as never,
        { captureCommentEvent: vi.fn() } as never,
        processor
      ).dispatchPending()
      expect(commentJobs).not.toContain(comment.id)
      await processor.process(comment.id)
      await processor.markFailed(comment.id)

      expect(screening).not.toHaveBeenCalled()
      expect(await postOf(post.id)).toMatchObject({
        status: 'flagged',
        moderation_reason: marker,
        published_at: null,
      })
      expect(await commentOf(comment.id)).toEqual(commentBefore)
      expect(commentBefore).toMatchObject({
        status: 'held_for_review',
        screening_reason: marker,
        body: 'Keep this body.',
        publication_sequence: null,
      })
      expect(
        await prisma.communityPostReport.count({
          where: { post_id: post.id },
        })
      ).toBe(0)
    }
  )

  it('a ban that lands while the post screens leaves the publish step with no row to move', async () => {
    const author = await fx.member('author')
    const seeded = await fx.postCase({ author })
    const { post, storage } = await pendingPostWithImage(author.id)
    let sanctionId = ''
    const engine = passingEngine()
    const processor = new CommunityModerationProcessor(
      prisma,
      storage,
      moderationTelemetry,
      {
        moderatePost: async (input: Parameters<typeof engine.moderatePost>[0]) => {
          sanctionId = (await ban(seeded.caseId, 'temporary')).sanctionId
          return engine.moderatePost(input)
        },
        screenText: (input: Parameters<typeof engine.screenText>[0]) =>
          engine.screenText(input),
      } as never,
      undefined,
      rolloutOpen
    )
    await processor.process({ postId: post.id, uploadSessionId: post.id })
    expect(await postOf(post.id)).toMatchObject({
      status: 'flagged',
      moderation_reason: banMarker(sanctionId),
      published_at: null,
    })
  })

  it('a ban that lands while the comment screens never converts it to consent_suspended', async () => {
    const author = await fx.member('author')
    const seeded = await fx.postCase({ author })
    const comment = await pendingComment(author.id)
    let sanctionId = ''
    const engine = passingEngine()
    const processor = new CommunityCommentsProcessor(
      prisma,
      {
        screenText: async (input: Parameters<typeof engine.screenText>[0]) => {
          sanctionId = (await ban(seeded.caseId, 'temporary')).sanctionId
          return engine.screenText(input)
        },
      } as never,
      rolloutOpen
    )
    await processor.process(comment.id)
    expect(await commentOf(comment.id)).toMatchObject({
      status: 'held_for_review',
      screening_reason: banMarker(sanctionId),
      body: 'Keep this body.',
      publication_sequence: null,
    })
  })
})

describe('I-B-EXPIRY: a temporary ban ends by itself at expires_at', () => {
  it('refuses at the boundary minus 1 ms, admits at the boundary with no write, and holds content', async () => {
    const author = await fx.member('author')
    const seeded = await fx.postCase({ author })
    const other = await fx.post({ authorId: (await fx.member('owner')).id })
    const pending = await fx.post({ authorId: author.id, status: 'pending_review' })
    const applied = await ban(seeded.caseId, 'temporary')
    const row = await sanctionOf(applied.sanctionId)
    const expiresAt = row.expires_at!
    const client = member(author.id)

    await atInstant(new Date(expiresAt.getTime() - 1), async () => {
      expectBanned(await client.get(`/api/v1/community/posts/${other.id}`), {
        kind: 'temporary',
        expiresAt: expiresAt.toISOString(),
        appealStatus: 'not_requested',
      })
    })

    await atInstant(expiresAt, async () => {
      const before = await checksumTables(prisma)
      const sanctionBefore = await digest('CommunitySanction', 'user_id', author.id)
      const response = await client.get(`/api/v1/community/posts/${other.id}`)
      expect(response.status, dump(response)).toBe(200)
      expect(await checksumTables(prisma)).toEqual(before)
      expect(await digest('CommunitySanction', 'user_id', author.id)).toBe(sanctionBefore)

      expect(await postOf(seeded.postId)).toMatchObject({
        status: 'flagged',
        moderation_reason: REASON,
      })
      expect(await postOf(pending.id)).toMatchObject({
        status: 'flagged',
        moderation_reason: banMarker(applied.sanctionId),
      })

      const staff = await admin()
      const appeal = await staff.appeal(applied.sanctionId, {
        status: 'requested',
        reason: REASON,
      })
      expect(appeal.status, dump(appeal)).toBe(409)
      expect(codeOf(appeal)).toBe('appeal_transition_invalid')
    })
  })
})

describe('I-B-UPGRADE: an admin upgrades an active temporary ban', () => {
  it('lifts the old row, hides everything, bumps the epoch, and overturn restores only its own marker', async () => {
    const author = await fx.member('author')
    const first = await fx.postCase({ author })
    const heldByTemporary = await fx.post({
      authorId: author.id,
      status: 'pending_review',
    })
    const temporary = await ban(first.caseId, 'temporary', await moderator())
    const temporaryMarker = banMarker(temporary.sanctionId)
    // A row that carries the old marker and has been public, so only the marker match keeps it out.
    const olderMarked = await fx.post({
      authorId: author.id,
      status: 'flagged',
      moderationReason: temporaryMarker,
      publishedAt: NOW,
    })
    const second = await fx.postCase({ author })
    const published = await fx.post({ authorId: author.id })

    ctx.spotlight.invalidateAllAreas.mockClear()
    const staff = await admin()
    const later = new Date(NOW.getTime() + 1000)
    clock.at(later)
    const upgraded = await ban(second.caseId, 'permanent', staff)
    const permanentMarker = banMarker(upgraded.sanctionId)

    expect(await sanctionOf(temporary.sanctionId)).toMatchObject({
      kind: 'temporary',
      lifted_at: later,
    })
    expect(await sanctionOf(upgraded.sanctionId)).toMatchObject({
      kind: 'permanent',
      lifted_at: null,
      expires_at: null,
    })
    expect(
      await prisma.communitySanction.count({
        where: { user_id: author.id, lifted_at: null },
      })
    ).toBe(1)
    expect(ctx.spotlight.invalidateAllAreas).toHaveBeenCalledTimes(1)
    expect(await postOf(published.id)).toMatchObject({
      status: 'flagged',
      moderation_reason: permanentMarker,
    })
    expect(await postOf(heldByTemporary.id)).toMatchObject({
      status: 'flagged',
      moderation_reason: temporaryMarker,
    })
    const standing = (await staff.detail(second.caseId)).subjectStanding
    expect(standing).toMatchObject({ active: true, priorBanCount: 1 })
    expect(standing?.sanction?.kind).toBe('permanent')

    const requested = await staff.appeal(upgraded.sanctionId, {
      status: 'requested',
      reason: REASON,
    })
    expect(requested.status, dump(requested)).toBe(200)
    const overturned = await staff.appeal(upgraded.sanctionId, {
      status: 'overturned',
      reason: REASON,
    })
    expect(overturned.status, dump(overturned)).toBe(200)
    expect(appealData(overturned).restoredCount).toBe(1)
    expect(await postOf(published.id)).toMatchObject({
      status: 'published',
      moderation_reason: null,
    })
    expect(await postOf(olderMarked.id)).toMatchObject({
      status: 'flagged',
      moderation_reason: temporaryMarker,
    })
    expect(await postOf(heldByTemporary.id)).toMatchObject({
      status: 'flagged',
      moderation_reason: temporaryMarker,
    })
  })
})

describe('I-B-SECOND: a second ban', () => {
  const refused = async (caseId: string, kind: Kind, staff: Staff) => {
    const response = await staff.decide(caseId, {
      action: 'ban',
      reason: REASON,
      ban: banTerms(kind),
    })
    expect(response.status, dump(response)).toBe(409)
    expect(response.body).toMatchObject({
      code: 'action_not_applicable',
      detail: 'already_banned',
    })
  }

  it('is already_banned over an active permanent, for either kind', async () => {
    const author = await fx.member('author')
    await ban((await fx.postCase({ author })).caseId, 'permanent')
    const next = await fx.postCase({ author })
    const staff = await admin()
    await refused(next.caseId, 'temporary', staff)
    await refused(next.caseId, 'permanent', staff)
  })

  it('is already_banned for a temporary over an active temporary', async () => {
    const author = await fx.member('author')
    await ban((await fx.postCase({ author })).caseId, 'temporary')
    await refused((await fx.postCase({ author })).caseId, 'temporary', await admin())
  })

  it('passes after an expired temporary, which stays on the record', async () => {
    const author = await fx.member('author')
    const expired = await fx.sanction(author, {
      createdAt: new Date(NOW.getTime() - 10 * DAY_MS),
      expiresAt: new Date(NOW.getTime() - 3 * DAY_MS),
    })
    const staff = await moderator()
    const seeded = await fx.postCase({ author })
    const applied = await ban(seeded.caseId, 'temporary', staff)
    expect(applied.sanction?.kind).toBe('temporary')
    expect((await sanctionOf(expired.id)).lifted_at).toBeNull()
    expect((await staff.detail(seeded.caseId)).subjectStanding?.priorBanCount).toBe(1)
  })

  it('answers admin_required to a moderator asking for permanent', async () => {
    const seeded = await fx.postCase()
    const staff = await moderator()
    const response = await staff.decide(seeded.caseId, {
      action: 'ban',
      reason: REASON,
      ban: { kind: 'permanent' },
    })
    expect(response.status, dump(response)).toBe(403)
    expect(codeOf(response)).toBe('admin_required')
    expect(
      await prisma.communitySanction.count({ where: { user_id: seeded.author.id } })
    ).toBe(0)
  })

  it('bans an operator account, audits it, and closes community access only', async () => {
    const subject = await fx.member('operator')
    const seeded = await fx.postCase({ author: subject })
    const applied = await ban(seeded.caseId, 'temporary')
    expect(
      await prisma.auditLog.count({
        where: {
          user_id: applied.staff.id,
          event_type: 'moderation_decision_applied',
          event_data: { path: ['action'], equals: 'ban' },
        },
      })
    ).toBe(1)

    const client = member(subject.id, 'moderator')
    expect(codeOf(await client.get('/api/v1/community/feed'))).toBe('community_banned')
    expect((await client.get('/api/v1/user/profile')).status).toBe(200)

    const asOperator = boot.staff('moderator', subject)
    const other = await fx.postCase()
    const detail = await asOperator.detail(other.caseId)
    expect(detail.allowedActions).toEqual([])
    const decision = await asOperator.decide(other.caseId, {
      action: 'resolve',
      reason: REASON,
      expectedRevision: detail.revision,
    })
    expect(decision.status, dump(decision)).toBe(403)
    expect(codeOf(decision)).toBe('operator_sanctioned')
  })
})

describe('I-B-ERASED: bans on gone or retracted targets (TEA-09, TEA-10)', () => {
  it.each([
    ['an orphan post report', () => fx.orphanPostCase()],
    ['an anonymized post', () => fx.postCase({ anonymizedAt: NOW, status: 'withdrawn' })],
    ['an erased comment', () => fx.commentCase({ status: 'erased', wasPublished: true })],
  ] as const)('%s answers target_erased and writes nothing', async (_name, seed) => {
    const seeded = await seed()
    const staff = await admin()
    const before = await prisma.communitySanction.count()
    const response = await staff.decide(seeded.caseId, {
      action: 'ban',
      reason: REASON,
      ban: { kind: 'temporary', durationDays: 7 },
    })
    expect(response.status, dump(response)).toBe(409)
    expect(response.body).toMatchObject({
      code: 'action_not_applicable',
      detail: 'target_erased',
    })
    expect(await prisma.communitySanction.count()).toBe(before)
    expect(
      await prisma.moderationDecision.count({ where: { case_key: seeded.caseId } })
    ).toBe(0)
  })

  it('a withdrawn post still allows a ban, with no effect on the target', async () => {
    const seeded = await fx.postCase({ status: 'withdrawn', publishedAt: NOW })
    const applied = await ban(seeded.caseId, 'temporary')
    expect(applied.targetStatus).toBe('withdrawn')
    expect((await postOf(seeded.postId)).status).toBe('withdrawn')
    expect((await sanctionOf(applied.sanctionId)).user_id).toBe(seeded.author.id)
  })

  it('an author_deleted comment still allows a ban, with no effect on the target', async () => {
    const seeded = await fx.commentCase({ status: 'author_deleted', wasPublished: true })
    const applied = await ban(seeded.caseId, 'temporary')
    expect(applied.targetStatus).toBe('author_deleted')
    expect((await commentOf(seeded.commentId)).status).toBe('author_deleted')
    expect((await sanctionOf(applied.sanctionId)).user_id).toBe(seeded.author.id)
  })
})

// --- Realtime -----------------------------------------------------------------------------------

function fixtureToken(memberId: string, expires = Date.now() + 60_000) {
  // The explicit local fixture-auth lane of the real identity service.
  return `e30.${Buffer.from(
    JSON.stringify({
      sub: memberId,
      role: 'guardian',
      exp: Math.floor(expires / 1000),
      e2e: 'couturecast-mobile-e2e',
    })
  ).toString('base64url')}.couturecast-mobile-e2e`
}

describe('I-B-REALTIME: the real socket server with the real access path', () => {
  const sockets: Socket[] = []
  let runtime: ReturnType<typeof createCommunityRealtimeServer>
  let base: string

  beforeAll(async () => {
    vi.stubEnv('TEST_ENV', 'local')
    runtime = createCommunityRealtimeServer(() =>
      Promise.resolve({
        prisma,
        access: wire.access,
        streams: wire.streams,
        identity: new AccessTokenIdentityService(prisma),
        origins: ['https://story611.synthetic.test'],
      })
    )
    await new Promise<void>((resolve) => runtime.server.listen(0, '127.0.0.1', resolve))
    base = `http://127.0.0.1:${(runtime.server.address() as AddressInfo).port}`
  })

  afterEach(() => {
    sockets.splice(0).forEach((socket) => socket.disconnect())
  })

  afterAll(async () => {
    vi.unstubAllEnvs()
    await runtime?.close()
  })

  const socketFor = (token: string) => {
    const socket = io(`${base}/community`, {
      path: '/api/realtime',
      addTrailingSlash: false,
      transports: ['websocket'],
      auth: { token },
      reconnection: false,
      forceNew: true,
      autoConnect: false,
    })
    sockets.push(socket)
    return socket
  }
  const connect = (socket: Socket) =>
    new Promise<void>((resolve, reject) => {
      socket.once('connect', resolve)
      socket.once('connect_error', reject)
      socket.connect()
    })
  const refusal = (socket: Socket) =>
    new Promise<unknown>((resolve, reject) => {
      socket.once('connect', () => reject(new Error('the handshake was admitted')))
      socket.once('connect_error', (error: Error & { data?: unknown }) =>
        resolve(error.data)
      )
      socket.connect()
    })

  it('denies a live socket within 8 s, refuses a reconnect, and admits one after expiry', async () => {
    const author = await fx.member('author')
    const seeded = await fx.postCase({ author })
    const socket = socketFor(fixtureToken(author.id))
    await connect(socket)
    const control = new Promise<unknown>((resolve) =>
      socket.once('community:availability', resolve)
    )
    const disconnected = new Promise<void>((resolve) =>
      socket.once('disconnect', () => resolve())
    )

    const applied = await ban(seeded.caseId, 'temporary')
    const started = performance.now()
    expect(await control).toEqual({ version: 1, status: 'denied' })
    expect(performance.now() - started).toBeLessThanOrEqual(8000)
    await disconnected

    expect(await refusal(socketFor(fixtureToken(author.id)))).toEqual({
      version: 1,
      status: 'denied',
    })

    const { expires_at: expiresAt } = await sanctionOf(applied.sanctionId)
    await atInstant(expiresAt!, async () => {
      const fresh = socketFor(fixtureToken(author.id, expiresAt!.getTime() + 60_000))
      await connect(fresh)
      expect(fresh.connected).toBe(true)
    })
  }, 20_000)

  it('refuses a handshake during a permanent ban', async () => {
    const author = await fx.member('author')
    await ban((await fx.postCase({ author })).caseId, 'permanent')
    expect(await refusal(socketFor(fixtureToken(author.id)))).toEqual({
      version: 1,
      status: 'denied',
    })
  })
})

// --- The send guard -----------------------------------------------------------------------------

describe('I-B-SEND-GUARD: pushes stop for a banned member (direct, the guard has no route)', () => {
  const requests: unknown[] = []
  let server: Server
  let endpoint: string
  const evaluation = new CommunityFlagEvaluationService(prisma, {
    getFeatureFlagValue: () => Promise.resolve(true),
  })
  const sender = () =>
    new CommunitySendGuard(prisma, evaluation, new CommunityPushProvider(fetch, endpoint))
  const worker = () => new CommunityNotificationsWorker(prisma, sender())

  beforeAll(async () => {
    server = createServer((incoming, response) => {
      let body = ''
      incoming.on('data', (chunk: Buffer) => {
        body += chunk.toString()
      })
      incoming.on('end', () => {
        requests.push(JSON.parse(body))
        response.writeHead(200, { 'Content-Type': 'application/json' })
        response.end(
          JSON.stringify({ data: { status: 'ok', id: `ticket-${requests.length}` } })
        )
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/push`
  })

  afterEach(() => {
    requests.length = 0
  })

  afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    )
  })

  /** One recipient with a token, and one delivery that groups the actors' reactions. */
  async function deliveryFor(actors: SeededMember[]) {
    const recipient = await fx.member('recipient')
    const post = await fx.post({ authorId: recipient.id })
    await communityPrivacyTransaction(prisma, async (tx) => {
      await guardCommunitySubject(tx, recipient.id)
      await tx.notificationPreference.create({ data: { user_id: recipient.id } })
      await tx.communityNotificationPreference.create({
        data: { user_id: recipient.id, enabled: true },
      })
    })
    await new PushRegistrationService(prisma).register(recipient.id, {
      token: `ExpoPushToken[synthetic_${randomUUID().replaceAll('-', '')}]`,
      installationId: randomUUID(),
      platform: 'ios',
      permission: 'granted',
    })
    for (const actor of actors) await react(actor.id, post.id)
    await prepareNotificationPass(() => worker().group())
    await prepareNotificationPass(() => worker().fanout())
    const delivery = await prisma.communityTokenDelivery.findFirstOrThrow({
      where: { group: { post_id: post.id } },
    })
    return { recipient, post, delivery }
  }

  it('suppresses a pending delivery to a banned recipient and leaves the token alone', async () => {
    const { recipient, delivery } = await deliveryFor([await fx.member('actor')])
    const tokens = await digest('PushToken', 'user_id', recipient.id)
    await fx.sanction(recipient, { kind: 'temporary' })
    await sender().dispatch(delivery.id)
    expect(requests).toEqual([])
    expect(
      await prisma.communityTokenDelivery.findUniqueOrThrow({
        where: { id: delivery.id },
      })
    ).toMatchObject({ status: 'suppressed' })
    expect(await digest('PushToken', 'user_id', recipient.id)).toBe(tokens)
  })

  it('drops a banned actor from a group while another actor still notifies', async () => {
    const bannedActor = await fx.member('actor')
    const otherActor = await fx.member('actor')
    const { recipient, post, delivery } = await deliveryFor([bannedActor, otherActor])
    const tokens = await digest('PushToken', 'user_id', recipient.id)
    await fx.sanction(bannedActor, { kind: 'temporary' })
    await sender().dispatch(delivery.id)
    const attempts = await prisma.communityDeliveryAttempt.findMany({
      where: { delivery_id: delivery.id },
      select: { status: true, reason: true },
    })
    expect(requests, JSON.stringify(attempts)).toHaveLength(1)
    expect(JSON.stringify(requests[0])).toContain(post.id)
    expect(
      await prisma.communityTokenDelivery.findUniqueOrThrow({
        where: { id: delivery.id },
      })
    ).toMatchObject({ status: 'accepted' })
    expect(await digest('PushToken', 'user_id', recipient.id)).toBe(tokens)
  })

  it('suppresses a group whose only actor is banned', async () => {
    const actor = await fx.member('actor')
    const { delivery } = await deliveryFor([actor])
    await fx.sanction(actor, { kind: 'permanent' })
    await sender().dispatch(delivery.id)
    expect(requests).toEqual([])
    expect(
      await prisma.communityTokenDelivery.findUniqueOrThrow({
        where: { id: delivery.id },
      })
    ).toMatchObject({ status: 'suppressed' })
  })
})

describe('I-B-RETRACT: retraction stays open during a ban (D8, TEA-18)', () => {
  it.each(KINDS)(
    'during a %s ban the author withdraws posts and deletes comments, and nothing else',
    async (kind) => {
      const author = await fx.member('author')
      const seeded = await fx.postCase({ author })
      const own = await fx.post({ authorId: author.id })
      const owner = await fx.member('owner')
      const thirdParty = await fx.post({ authorId: owner.id })
      const ownComment = await fx.comment({ postId: thirdParty.id, authorId: author.id })
      const theirs = await fx.comment({ postId: thirdParty.id, authorId: owner.id })
      await ban(seeded.caseId, kind)
      const client = member(author.id)

      // The case target the ban took down.
      const hidden = await client.post(
        `/api/v1/community/posts/${seeded.postId}/withdraw`
      )
      expect(hidden.status, dump(hidden)).toBe(200)
      expect((await postOf(seeded.postId)).status).toBe('withdrawn')

      const withdrawn = await client.post(`/api/v1/community/posts/${own.id}/withdraw`)
      expect(withdrawn.status, dump(withdrawn)).toBe(200)
      expect((await postOf(own.id)).status).toBe('withdrawn')

      const deleted = await client.delete(
        `/api/v1/community/posts/${thirdParty.id}/comments/${ownComment.id}`
      )
      expect(deleted.status, dump(deleted)).toBe(200)
      expect(await commentOf(ownComment.id)).toMatchObject({
        status: 'author_deleted',
        body: null,
        screening_reason: null,
      })

      const otherWithdraw = await client.post(
        `/api/v1/community/posts/${thirdParty.id}/withdraw`
      )
      expect(otherWithdraw.status, dump(otherWithdraw)).toBe(403)
      expect((await postOf(thirdParty.id)).status).toBe('published')
      const otherDelete = await client.delete(
        `/api/v1/community/posts/${thirdParty.id}/comments/${theirs.id}`
      )
      expect(otherDelete.status, dump(otherDelete)).toBe(403)
      expect((await commentOf(theirs.id)).status).toBe('published')
    }
  )

  it('a deleted marked comment and a withdrawn marked post stay gone after an overturn', async () => {
    const author = await fx.member('author')
    const seeded = await fx.postCase({ author })
    const markedPost = await fx.post({ authorId: author.id })
    const keptPost = await fx.post({ authorId: author.id })
    const thirdParty = await fx.post({ authorId: (await fx.member('owner')).id })
    const markedComment = await fx.comment({ postId: thirdParty.id, authorId: author.id })
    const applied = await ban(seeded.caseId, 'permanent')
    expect((await commentOf(markedComment.id)).screening_reason).toBe(
      banMarker(applied.sanctionId)
    )

    const client = member(author.id)
    const deleted = await client.delete(
      `/api/v1/community/posts/${thirdParty.id}/comments/${markedComment.id}`
    )
    expect(deleted.status, dump(deleted)).toBe(200)
    expect(await commentOf(markedComment.id)).toMatchObject({
      status: 'author_deleted',
      body: null,
      screening_reason: null,
    })
    const withdrawn = await client.post(
      `/api/v1/community/posts/${markedPost.id}/withdraw`
    )
    expect(withdrawn.status, dump(withdrawn)).toBe(200)

    const staff = await admin()
    await staff.appeal(applied.sanctionId, { status: 'requested', reason: REASON })
    const overturned = await staff.appeal(applied.sanctionId, {
      status: 'overturned',
      reason: REASON,
    })
    expect(overturned.status, dump(overturned)).toBe(200)
    expect(appealData(overturned).restoredCount).toBe(1)
    expect((await commentOf(markedComment.id)).status).toBe('author_deleted')
    expect((await postOf(markedPost.id)).status).toBe('withdrawn')
    expect((await postOf(keptPost.id)).status).toBe('published')
  })
})

describe('I-B-NONCOMMUNITY: a ban closes community access only (D8)', () => {
  // No account-deletion or privacy-export route exists at this commit, and a billing route needs
  // a provider, so those are out of this row.
  const reads = (client: Member) =>
    [
      ['wardrobe garments', client.get('/api/v1/wardrobe/garments')],
      ['ritual', client.get('/api/v1/ritual')],
      ['alert settings', client.get('/api/v1/alerts/preferences')],
      ['user profile', client.get('/api/v1/user/profile')],
      ['commerce preferences', client.get('/api/v1/commerce/preferences')],
      ['push registrations', client.get('/api/v1/notifications/push-tokens')],
    ] as const

  const answers = async (client: Member) => {
    const result: Record<string, { status: number; body: unknown }> = {}
    for (const [name, call] of reads(client)) {
      const response = await call
      result[name] = { status: response.status, body: response.body }
    }
    return result
  }

  it('leaves tokens, preferences, consent and the subject generation byte-identical, and every route answers as before', async () => {
    const teen = await fx.teen()
    const seeded = await fx.postCase({ author: teen })
    const client = member(teen.id)
    const registered = await client.post('/api/v1/notifications/push-tokens').send({
      token: `ExpoPushToken[synthetic_${randomUUID().replaceAll('-', '')}]`,
      installationId: randomUUID(),
      platform: 'ios',
      permission: 'granted',
    })
    expect(registered.status, dump(registered)).toBeLessThan(300)
    const before = await answers(client)
    for (const [name, answer] of Object.entries(before))
      expect((answer.body as { code?: unknown }).code, name).not.toBe('community_banned')
    expect(
      Object.fromEntries(
        Object.entries(before).map(([name, answer]) => [name, answer.status])
      )
    ).toEqual({
      'wardrobe garments': 200,
      // The real ritual path refuses a member with no saved location, the same before and after.
      ritual: 400,
      'alert settings': 200,
      'user profile': 200,
      'commerce preferences': 200,
      'push registrations': 200,
    })

    const state = async () => ({
      tokens: await digest('PushToken', 'user_id', teen.id),
      profile: await digest('UserProfile', 'user_id', teen.id),
      consent: await digest('GuardianConsent', 'teen_id', teen.id),
      generation: await subjectGeneration(teen.id),
    })
    const stateBefore = await state()
    expect(stateBefore.tokens).toMatch(/^1:/)
    expect(stateBefore.consent).toMatch(/^1:/)

    await ban(seeded.caseId, 'permanent')

    expect(await state()).toEqual(stateBefore)
    await expect(
      prisma.$transaction((tx) => assertWardrobeParticipationAllowed(tx, teen.id))
    ).resolves.toBeUndefined()
    expect(codeOf(await client.get('/api/v1/community/feed'))).toBe('community_banned')
    expect(await answers(client)).toEqual(before)

    // Writes stay open too.
    const preference = await client
      .put('/api/v1/commerce/preferences')
      .send({ affiliateCtasEnabled: false })
    expect(preference.status, dump(preference)).toBe(200)
    const secondToken = await client.post('/api/v1/notifications/push-tokens').send({
      token: `ExpoPushToken[synthetic_${randomUUID().replaceAll('-', '')}]`,
      installationId: randomUUID(),
      platform: 'ios',
      permission: 'granted',
    })
    expect(secondToken.status, dump(secondToken)).toBeLessThan(300)
    expect(await subjectGeneration(teen.id)).toBe(stateBefore.generation)
  })
})

describe('I-B-TEEN: a ban and guardian consent never touch each other', () => {
  it('leaves consent alone, and survives a revoke and a fresh grant', async () => {
    const teen = await fx.teen()
    const seeded = await fx.postCase({ author: teen })
    const consentBefore = await digest('GuardianConsent', 'teen_id', teen.id)
    const profileBefore = await digest('UserProfile', 'user_id', teen.id)
    const applied = await ban(seeded.caseId, 'permanent')
    expect(await digest('GuardianConsent', 'teen_id', teen.id)).toBe(consentBefore)
    expect(await digest('UserProfile', 'user_id', teen.id)).toBe(profileBefore)
    const sanctionBefore = await sanctionOf(applied.sanctionId)
    const client = member(teen.id)
    const refusal = {
      kind: 'permanent' as const,
      expiresAt: null,
      appealStatus: 'not_requested' as const,
    }
    expectBanned(await client.get('/api/v1/community/feed'), refusal)

    await guardian.revokeConsent(teen.guardianId, teen.id)
    expect(await sanctionOf(applied.sanctionId)).toEqual(sanctionBefore)
    expectBanned(await client.get('/api/v1/community/feed'), refusal)

    const invitation = await guardian.inviteGuardian(
      teen.id,
      `${randomUUID()}@cc611.test`,
      'full_access'
    )
    const token = new URL(invitation.invitationLink).searchParams.get('token')
    await guardian.acceptInvitation(token!)
    expect(
      await prisma.guardianConsent.count({
        where: { teen_id: teen.id, status: 'granted' },
      })
    ).toBe(1)
    expect(await sanctionOf(applied.sanctionId)).toEqual(sanctionBefore)
    expectBanned(await client.get('/api/v1/community/feed'), refusal)
  })
})

describe('I-B-FLAG-OFF: enforcement has no flag (D3, D9)', () => {
  const closeDecisionFlags = () => {
    flagValues.set('moderation_decisions_enabled', false)
    flagValues.set('moderation_console_enabled', false)
  }

  describe('a permanent ban keeps refusing every route', () => {
    let client: Member
    let ids: RouteIds

    beforeAll(async () => {
      const subject = await fx.member('banned')
      client = member(subject.id)
      ids = await seedRoutes(client)
      await fx.sanction(subject, { kind: 'permanent' })
    }, 60_000)

    it.each(ROUTES)('%s with both decision flags off', async (_name, call) => {
      closeDecisionFlags()
      expectBanned(await call(client, ids), {
        kind: 'permanent',
        expiresAt: null,
        appealStatus: 'not_requested',
      })
    })
  })

  it('a temporary ban still expires with both decision flags off', async () => {
    const subject = await fx.member('banned')
    const other = await fx.post({ authorId: (await fx.member('owner')).id })
    const sanction = await fx.sanction(subject, { kind: 'temporary' })
    closeDecisionFlags()
    const client = member(subject.id)
    expect(codeOf(await client.get(`/api/v1/community/posts/${other.id}`))).toBe(
      'community_banned'
    )
    await atInstant(sanction.expires_at!, async () => {
      const response = await client.get(`/api/v1/community/posts/${other.id}`)
      expect(response.status, dump(response)).toBe(200)
    })
  })
})

describe('I-B-REPLIES: a hidden root hides its replies, and they keep their status (D8)', () => {
  const targetsBody = (postId: string, rootId: string, replyId: string) => ({
    targets: [{ key: 'reply', postId, commentId: replyId, parentId: rootId }],
  })

  async function thread(author: SeededMember) {
    const seeded = await fx.commentCase({ author })
    const replier = await fx.member('replier')
    const reply = await fx.comment({
      postId: seeded.postId,
      authorId: replier.id,
      parentId: seeded.commentId,
    })
    return { seeded, reply, reader: member((await fx.member('reader')).id) }
  }

  const repliesOf = (reader: Member, postId: string, rootId: string) =>
    reader.get(`/api/v1/community/posts/${postId}/comments/${rootId}/replies`)
  // The comment a deep link lands on.
  // The post stays available when a comment is hidden.
  const resolvedComment = async (
    reader: Member,
    postId: string,
    rootId: string,
    id: string
  ) => {
    const response = await reader
      .post('/api/v1/community/targets/resolve')
      .send(targetsBody(postId, rootId, id))
    expect(response.status, dump(response)).toBe(200)
    const { data } = response.body as {
      data: { targets: { comment: { id: string } | null; parent: unknown }[] }
    }
    return {
      comment: data.targets[0]?.comment?.id ?? null,
      parent: data.targets[0]?.parent,
    }
  }

  it('after a takedown, by thread and by target, until a release returns them', async () => {
    const { seeded, reply, reader } = await thread(await fx.member('author'))
    const staff = await moderator()
    const takedown = await staff.decide(seeded.caseId, {
      action: 'takedown',
      reason: REASON,
    })
    expect(takedown.status, dump(takedown)).toBe(200)

    const hidden = await repliesOf(reader, seeded.postId, seeded.commentId)
    expect(hidden.status, dump(hidden)).toBe(400)
    expect(
      await resolvedComment(reader, seeded.postId, seeded.commentId, reply.id)
    ).toEqual({ comment: null, parent: null })
    expect((await commentOf(reply.id)).status).toBe('published')

    const release = await staff.decide(seeded.caseId, {
      action: 'release',
      reason: REASON,
    })
    expect(release.status, dump(release)).toBe(200)
    const back = await repliesOf(reader, seeded.postId, seeded.commentId)
    expect(back.status, dump(back)).toBe(200)
    expect(
      (back.body as { data: { items: { id: string }[] } }).data.items.map((c) => c.id)
    ).toEqual([reply.id])
    expect(
      (await resolvedComment(reader, seeded.postId, seeded.commentId, reply.id)).comment
    ).toBe(reply.id)
  })

  it('after a permanent ban on the root author, until an overturn returns the root', async () => {
    const author = await fx.member('author')
    const target = await fx.postCase({ author })
    const { seeded, reply, reader } = await thread(author)
    const applied = await ban(target.caseId, 'permanent')
    expect(await commentOf(seeded.commentId)).toMatchObject({
      status: 'blocked',
      screening_reason: banMarker(applied.sanctionId),
    })
    const hidden = await repliesOf(reader, seeded.postId, seeded.commentId)
    expect(hidden.status, dump(hidden)).toBe(400)
    expect(
      await resolvedComment(reader, seeded.postId, seeded.commentId, reply.id)
    ).toEqual({ comment: null, parent: null })
    expect((await commentOf(reply.id)).status).toBe('published')

    const staff = await admin()
    await staff.appeal(applied.sanctionId, { status: 'requested', reason: REASON })
    const overturned = await staff.appeal(applied.sanctionId, {
      status: 'overturned',
      reason: REASON,
    })
    expect(overturned.status, dump(overturned)).toBe(200)
    const back = await repliesOf(reader, seeded.postId, seeded.commentId)
    expect(back.status, dump(back)).toBe(200)
    expect(
      (back.body as { data: { items: { id: string }[] } }).data.items.map((c) => c.id)
    ).toEqual([reply.id])
  })
})

describe('I-B-SHARE-CARD: export refused for both sources (TEA-17)', () => {
  const prepare = (client: Member, source: Record<string, string>) =>
    client.post('/api/v1/share-cards/prepare').send({
      source,
      locale: 'en-US',
      watermark: true,
      purpose: 'preview',
    })
  const outfit = (userId: string) =>
    prisma.outfitRecommendation.create({
      data: {
        user_id: userId,
        scenario: 'morning',
        garment_ids: ['default-top', 'default-bottom'],
      },
    })

  it.each(KINDS)('a %s ban refuses a community post and an outfit', async (kind) => {
    const subject = await fx.member('banned')
    const client = member(subject.id)
    const ownOutfit = await outfit(subject.id)
    const post = await fx.post({ authorId: subject.id })
    const sanction = await fx.sanction(subject, { kind })
    const refusal = {
      kind,
      expiresAt: sanction.expires_at?.toISOString() ?? null,
      appealStatus: 'not_requested' as const,
    }
    expectBanned(
      await prepare(client, { kind: 'community_post', postId: post.id }),
      refusal
    )
    expectBanned(
      await prepare(client, { kind: 'outfit', recommendationId: ownOutfit.id }),
      refusal
    )
  })

  it('an unbanned member still exports an outfit', async () => {
    const subject = await fx.member('control')
    const client = member(subject.id)
    const ownOutfit = await outfit(subject.id)
    const response = await prepare(client, {
      kind: 'outfit',
      recommendationId: ownOutfit.id,
    })
    expect(response.status, dump(response)).toBe(200)
    expect(prepareShareCardResponseSchema.parse(response.body).data.sha256).toMatch(
      /^[a-f0-9]{64}$/
    )
  }, 20_000)
})

describe('I-B-ERASURE-CASCADE: member erasure while banned', () => {
  it('removes the sanction, keeps the decision with its alias, and keeps the moderator', async () => {
    const subject = await fx.member('banned')
    const seeded = await fx.postCase({ author: subject })
    const applied = await ban(seeded.caseId, 'temporary')

    await repository.requestErasureForUser(subject.id, new Date())
    await communityPrivacyTransaction(prisma, async (tx) => {
      await guardCommunitySubject(tx, subject.id)
      await tx.userProfile.delete({ where: { user_id: subject.id } })
      await tx.comfortPreferences.deleteMany({ where: { user_id: subject.id } })
      await tx.user.delete({ where: { id: subject.id } })
    })

    expect(
      await prisma.communitySanction.count({ where: { id: applied.sanctionId } })
    ).toBe(0)
    const decision = await prisma.moderationDecision.findUniqueOrThrow({
      where: { id: applied.decisionId },
    })
    expect(decision).toMatchObject({
      subject_user_id: null,
      subject_alias: subject.alias,
      moderator_id: applied.staff.id,
      action: 'ban',
      reason: REASON,
    })
    expect(
      await prisma.auditLog.count({
        where: { user_id: applied.staff.id, event_type: 'moderation_decision_applied' },
      })
    ).toBe(1)
  })
})

describe('I-B-RACE-ENGAGE: engagement racing the ban transaction', () => {
  /** The race's rule: the row committed first and the ban holds it, or the request got 403. */
  async function expectNoPublishedComment(
    response: Response,
    postId: string,
    authorId: string,
    sanctionId: string
  ) {
    const rows = await prisma.communityComment.findMany({
      where: { post_id: postId, user_id: authorId },
    })
    expect(rows.filter((row) => row.status === 'published')).toEqual([])
    if (response.status === 200) {
      expect(rows.map((row) => row.status)).toEqual(['held_for_review'])
      expect(rows[0]?.screening_reason).toBe(banMarker(sanctionId))
      expect(rows[0]?.body).toBe('Racing the ban.')
    } else {
      expect(codeOf(response), dump(response)).toBe('community_banned')
      expect(rows).toEqual([])
    }
  }
  const commentBody = () => ({
    mutationId: randomUUID(),
    body: 'Racing the ban.',
    locale: 'en-US',
    parentId: null,
  })

  it('a comment already waiting commits first and the ban holds it', async () => {
    const author = await fx.member('author')
    const seeded = await fx.postCase({ author })
    const target = await fx.post({ authorId: (await fx.member('owner')).id })
    const release = await holdPostRow(target.id)
    let pending: Promise<Response> | undefined
    let banning: Promise<Response> | undefined
    try {
      const baseline = await lockWaiters()
      pending = start(
        member(author.id)
          .post(`/api/v1/community/posts/${target.id}/comments`)
          .send(commentBody())
      )
      await untilWaiters(baseline + 1)
      banning = startBan(seeded.caseId)
      await untilWaiters(baseline + 2)
    } finally {
      await release()
    }
    const [comment, decided] = await Promise.all([pending, banning])
    expect(decided.status, dump(decided)).toBe(200)
    expect(comment.status, dump(comment)).toBe(200)
    await expectNoPublishedComment(
      comment,
      target.id,
      author.id,
      decisionData(decided).sanction!.sanctionId
    )
  }, 20_000)

  it('a comment arriving after the ban holds the member is refused', async () => {
    const author = await fx.member('author')
    const seeded = await fx.postCase({ author })
    const target = await fx.post({ authorId: (await fx.member('owner')).id })
    const release = await holdPostRow(seeded.postId)
    let pending: Promise<Response> | undefined
    let banning: Promise<Response> | undefined
    try {
      const baseline = await lockWaiters()
      banning = startBan(seeded.caseId)
      await untilWaiters(baseline + 1)
      pending = start(
        member(author.id)
          .post(`/api/v1/community/posts/${target.id}/comments`)
          .send(commentBody())
      )
      await untilWaiters(baseline + 2)
    } finally {
      await release()
    }
    const [comment, decided] = await Promise.all([pending, banning])
    expect(decided.status, dump(decided)).toBe(200)
    expect(comment.status, dump(comment)).toBe(403)
    await expectNoPublishedComment(
      comment,
      target.id,
      author.id,
      decisionData(decided).sanction!.sanctionId
    )
  }, 20_000)

  /** A ban on the case, which queues behind the held lock as a real request does. */
  async function startBan(caseId: string) {
    const staff = await admin()
    const revision = (await staff.detail(caseId)).revision
    return Promise.resolve(
      staff.decide(caseId, {
        action: 'ban',
        reason: REASON,
        ban: { kind: 'temporary', durationDays: 7 },
        expectedRevision: revision,
      })
    )
  }

  it('a report already waiting for its post commits first, and the ban stands', async () => {
    const author = await fx.member('author')
    const seeded = await fx.postCase({ author })
    const owner = await fx.member('owner')
    const target = await fx.post({ authorId: owner.id })
    const root = await fx.comment({ postId: target.id, authorId: owner.id })
    const release = await holdPostRow(target.id)
    let pending: Promise<Response> | undefined
    let banning: Promise<Response> | undefined
    try {
      const baseline = await lockWaiters()
      pending = start(
        member(author.id)
          .post(`/api/v1/community/posts/${target.id}/comments/${root.id}/report`)
          .send({ reason: 'harassment' })
      )
      await untilWaiters(baseline + 1)
      banning = startBan(seeded.caseId)
      await untilWaiters(baseline + 2)
    } finally {
      await release()
    }
    const [report, decided] = await Promise.all([pending, banning])
    expect(decided.status, dump(decided)).toBe(200)
    expect(report.status, dump(report)).toBe(200)
    expect(
      await prisma.communityCommentReport.count({
        where: { comment_id: root.id, reporter_id: author.id },
      })
    ).toBe(1)
    expect(codeOf(await member(author.id).get('/api/v1/community/feed'))).toBe(
      'community_banned'
    )
  }, 20_000)

  it('a report arriving after the ban holds the member is refused', async () => {
    const author = await fx.member('author')
    const seeded = await fx.postCase({ author })
    const owner = await fx.member('owner')
    const target = await fx.post({ authorId: owner.id })
    const root = await fx.comment({ postId: target.id, authorId: owner.id })
    const release = await holdPostRow(seeded.postId)
    let pending: Promise<Response> | undefined
    let banning: Promise<Response> | undefined
    try {
      const baseline = await lockWaiters()
      banning = startBan(seeded.caseId)
      await untilWaiters(baseline + 1)
      pending = start(
        member(author.id)
          .post(`/api/v1/community/posts/${target.id}/comments/${root.id}/report`)
          .send({ reason: 'harassment' })
      )
      await untilWaiters(baseline + 2)
    } finally {
      await release()
    }
    const [report, decided] = await Promise.all([pending, banning])
    expect(decided.status, dump(decided)).toBe(200)
    expect(codeOf(report), dump(report)).toBe('community_banned')
    expect(
      await prisma.communityCommentReport.count({
        where: { comment_id: root.id, reporter_id: author.id },
      })
    ).toBe(0)
  }, 20_000)
})

describe('I-B-SCALE: a permanent ban on a heavy member (R-021)', () => {
  const RELATED_POSTS = 2000

  it(`finishes inside the 7 s timeout with ${RELATED_POSTS} related posts`, async () => {
    const author = await fx.member('heavy')
    const seeded = await fx.postCase({ author })
    const owner = await fx.member('owner')
    const postIds = Array.from(
      { length: RELATED_POSTS },
      (_, index) => `${fx.runId}-scale-${index}-${randomUUID()}`
    )
    await prisma.$executeRaw`
      INSERT INTO "LookbookPost" (id, user_id, status, published_at, submitted_at, alt_text,
        alt_text_confirmed_at, caption, locale, updated_at)
      SELECT unnest(${postIds}::text[]), ${owner.id}, 'published', ${NOW}, ${NOW}, 'Alt',
        ${NOW}, 'Caption', 'en-US', ${NOW}`
    await prisma.$executeRaw`
      INSERT INTO "CommunityReaction" (user_id, post_id, selection, revision, updated_at)
      SELECT ${author.id}, unnest(${postIds}::text[]), 'love', 1, ${NOW}`

    const staff = await admin()
    const revision = (await staff.detail(seeded.caseId)).revision
    let finished = false
    let peakLocks = 0
    const sampling = (async () => {
      while (!finished) {
        const rows = await prisma.$queryRaw<{ count: bigint }[]>`
          SELECT count(*)::bigint AS count FROM pg_locks
          WHERE locktype = 'advisory' AND database =
            (SELECT oid FROM pg_database WHERE datname = current_database())`
        peakLocks = Math.max(peakLocks, Number(rows[0]!.count))
      }
    })()
    const started = performance.now()
    const response = await staff
      .decide(seeded.caseId, {
        action: 'ban',
        reason: REASON,
        ban: { kind: 'permanent' },
        expectedRevision: revision,
      })
      .finally(() => {
        finished = true
      })
    const elapsedMs = Math.round(performance.now() - started)
    await sampling

    expect(response.status, dump(response)).toBe(200)
    expect(elapsedMs).toBeLessThan(7000)
    expect(peakLocks).toBeGreaterThanOrEqual(RELATED_POSTS)
    expect(
      await prisma.communityReaction.count({
        where: { user_id: author.id, selection: null, post_id: { in: postIds } },
      })
    ).toBe(RELATED_POSTS)
    console.log(
      JSON.stringify({
        evidence: 'cc611-ban-scale',
        relatedPosts: RELATED_POSTS,
        elapsedMs,
        peakAdvisoryLocks: peakLocks,
      })
    )
  }, 20_000)
})

// --- Appeals ------------------------------------------------------------------------------------

describe('I-A-HAPPY: requested by a moderator, upheld by an admin', () => {
  it('records each step, shows the member the status, and changes nothing else on upheld', async () => {
    const author = await fx.member('author')
    const seeded = await fx.postCase({ author })
    const other = await fx.post({ authorId: author.id })
    const banningStaff = await moderator()
    const applied = await ban(seeded.caseId, 'temporary', banningStaff)
    const row = await sanctionOf(applied.sanctionId)
    const expiresAt = row.expires_at!.toISOString()
    const client = member(author.id)

    const staff = await moderator()
    const requested = await staff.appeal(applied.sanctionId, {
      status: 'requested',
      reason: 'Member wrote to support.',
    })
    expect(requested.status, dump(requested)).toBe(200)
    expect(appealData(requested)).toMatchObject({
      sanction: { sanctionId: applied.sanctionId, appealStatus: 'requested' },
      active: true,
      restoredCount: 0,
      replayed: false,
    })
    expectBanned(await client.get('/api/v1/community/feed'), {
      kind: 'temporary',
      expiresAt,
      appealStatus: 'requested',
    })

    const chief = await admin()
    const contentBefore = await checksumTables(prisma)
    const upheld = await chief.appeal(applied.sanctionId, {
      status: 'upheld',
      reason: 'The ban stands.',
    })
    expect(upheld.status, dump(upheld)).toBe(200)
    expect(appealData(upheld)).toMatchObject({
      sanction: { appealStatus: 'upheld' },
      active: true,
      restoredCount: 0,
    })
    expectBanned(await client.get('/api/v1/community/feed'), {
      kind: 'temporary',
      expiresAt,
      appealStatus: 'upheld',
    })
    expect(await checksumTables(prisma)).toEqual(contentBefore)
    expect(await sanctionOf(applied.sanctionId)).toEqual({
      ...row,
      appeal_status: 'upheld',
    })
    expect((await postOf(other.id)).status).toBe('published')

    const steps = await prisma.moderationDecision.findMany({
      where: { case_key: seeded.caseId },
      orderBy: { sequence: 'asc' },
    })
    expect(
      steps.map((step) => ({
        action: step.action,
        moderator: step.moderator_id,
        role: step.moderator_role,
        terminal: step.is_terminal,
        reason: step.reason,
        subject: step.subject_user_id,
      }))
    ).toEqual([
      {
        action: 'ban',
        moderator: banningStaff.id,
        role: 'moderator',
        terminal: true,
        reason: REASON,
        subject: author.id,
      },
      {
        action: 'appeal_requested',
        moderator: staff.id,
        role: 'moderator',
        terminal: false,
        reason: 'Member wrote to support.',
        subject: author.id,
      },
      {
        action: 'appeal_upheld',
        moderator: chief.id,
        role: 'admin',
        terminal: false,
        reason: 'The ban stands.',
        subject: author.id,
      },
    ])
    for (const [operatorId, action] of [
      [staff.id, 'appeal_requested'],
      [chief.id, 'appeal_upheld'],
    ] as const) {
      const audit = await prisma.auditLog.findMany({
        where: { user_id: operatorId, event_type: 'moderation_appeal_recorded' },
      })
      expect(audit).toHaveLength(1)
      expect(audit[0]!.event_data).toMatchObject({ action, caseId: seeded.caseId })
      const text = JSON.stringify(audit[0]!.event_data)
      expect(text).not.toContain('support')
      expect(text).not.toContain('stands')
      expect(text).not.toContain(author.id)
    }
  })
})

describe('I-A-OVERTURN: an admin overturns a ban (D10)', () => {
  it('returns access and public content, and leaves the rest where the ban left it', async () => {
    const author = await fx.member('author')
    const seeded = await fx.postCase({ author })
    const published = await fx.post({ authorId: author.id })
    const neverPublished = await fx.post({
      authorId: author.id,
      status: 'pending_review',
    })
    const toWithdraw = await fx.post({ authorId: author.id })
    const toErase = await fx.post({ authorId: author.id })
    const thirdParty = await fx.post({ authorId: (await fx.member('owner')).id })
    const publicComment = await fx.comment({ postId: thirdParty.id, authorId: author.id })
    const pendingBody = await fx.comment({
      postId: thirdParty.id,
      authorId: author.id,
      status: 'pending_screening',
    })
    await react(author.id, thirdParty.id)

    const applied = await ban(seeded.caseId, 'permanent')
    const marker = banMarker(applied.sanctionId)
    const client = member(author.id)
    const withdrawn = await client.post(
      `/api/v1/community/posts/${toWithdraw.id}/withdraw`
    )
    expect(withdrawn.status, dump(withdrawn)).toBe(200)
    await communityPrivacyTransaction(prisma, async (tx) => {
      await guardCommunityPost(tx, toErase.id)
      await tx.lookbookPost.update({
        where: { id: toErase.id },
        data: { erasure_requested_at: NOW },
      })
    })
    const reactionBefore = await reactionOf(author.id, thirdParty.id)

    const chief = await admin()
    const requested = await chief.appeal(applied.sanctionId, {
      status: 'requested',
      reason: REASON,
    })
    expect(requested.status, dump(requested)).toBe(200)
    ctx.spotlight.invalidateAllAreas.mockClear()
    ctx.streams.assist.mockClear()
    const later = new Date(NOW.getTime() + 2000)
    clock.at(later)
    const overturned = await chief.appeal(applied.sanctionId, {
      status: 'overturned',
      reason: 'The ban was wrong.',
    })
    expect(overturned.status, dump(overturned)).toBe(200)
    expect(appealData(overturned)).toMatchObject({
      active: false,
      restoredCount: 2,
      sanction: { appealStatus: 'overturned' },
    })
    expect(ctx.spotlight.invalidateAllAreas).toHaveBeenCalledTimes(1)
    expect(ctx.streams.assist).toHaveBeenCalledTimes(1)
    expect(await sanctionOf(applied.sanctionId)).toMatchObject({
      lifted_at: later,
      appeal_status: 'overturned',
    })

    const next = await client.get(`/api/v1/community/posts/${thirdParty.id}`)
    expect(next.status, dump(next)).toBe(200)

    expect(await postOf(published.id)).toMatchObject({
      status: 'published',
      moderation_reason: null,
      published_at: published.published_at,
    })
    expect(await commentOf(publicComment.id)).toMatchObject({
      status: 'published',
      screening_reason: null,
      body: publicComment.body,
      publication_sequence: publicComment.publication_sequence,
    })
    expect(await postOf(neverPublished.id)).toMatchObject({
      status: 'flagged',
      moderation_reason: marker,
      published_at: null,
    })
    expect(await commentOf(pendingBody.id)).toMatchObject({
      status: 'held_for_review',
      screening_reason: marker,
      body: pendingBody.body,
    })
    expect(await postOf(seeded.postId)).toMatchObject({
      status: 'flagged',
      moderation_reason: REASON,
    })
    expect((await postOf(toWithdraw.id)).status).toBe('withdrawn')
    expect(await postOf(toErase.id)).toMatchObject({
      status: 'flagged',
      moderation_reason: marker,
    })
    const reactionAfter = await reactionOf(author.id, thirdParty.id)
    expect(reactionAfter).toEqual(reactionBefore)
    expect(reactionAfter.selection).toBeNull()

    const staff = await moderator()
    const release = await staff.decide(seeded.caseId, {
      action: 'release',
      reason: 'Released after the overturn.',
    })
    expect(release.status, dump(release)).toBe(200)
    expect((await postOf(seeded.postId)).status).toBe('published')
  })

  it('a temporary ban overturned restores nothing but ends now', async () => {
    const author = await fx.member('author')
    const seeded = await fx.postCase({ author })
    const held = await fx.post({ authorId: author.id, status: 'pending_review' })
    const other = await fx.post({ authorId: (await fx.member('owner')).id })
    const applied = await ban(seeded.caseId, 'temporary')
    const chief = await admin()
    await chief.appeal(applied.sanctionId, { status: 'requested', reason: REASON })
    const overturned = await chief.appeal(applied.sanctionId, {
      status: 'overturned',
      reason: REASON,
    })
    expect(overturned.status, dump(overturned)).toBe(200)
    expect(appealData(overturned)).toMatchObject({ active: false, restoredCount: 0 })
    expect((await postOf(held.id)).status).toBe('flagged')
    const next = await member(author.id).get(`/api/v1/community/posts/${other.id}`)
    expect(next.status, dump(next)).toBe(200)
  })
})

describe('I-A-OVERTURN-CONSENT: an overturn never republishes what consent would hide (TEA-02)', () => {
  async function contentOf(authorId: string, parentOwner: SeededMember) {
    const post = await fx.post({ authorId })
    const thirdParty = await fx.post({ authorId: parentOwner.id })
    const comment = await fx.comment({ postId: thirdParty.id, authorId })
    return { post, comment }
  }

  async function overturn(sanctionId: string) {
    const chief = await admin()
    const requested = await chief.appeal(sanctionId, {
      status: 'requested',
      reason: REASON,
    })
    expect(requested.status, dump(requested)).toBe(200)
    const overturned = await chief.appeal(sanctionId, {
      status: 'overturned',
      reason: REASON,
    })
    expect(overturned.status, dump(overturned)).toBe(200)
    return appealData(overturned)
  }

  async function expectNothingReturned(
    authorId: string,
    sanctionId: string,
    result: Awaited<ReturnType<typeof overturn>>,
    content: Awaited<ReturnType<typeof contentOf>>
  ) {
    const marker = banMarker(sanctionId)
    expect(result).toMatchObject({ active: false, restoredCount: 0 })
    expect((await sanctionOf(sanctionId)).lifted_at).not.toBeNull()
    expect(
      await prisma.lookbookPost.count({
        where: { user_id: authorId, status: 'published' },
      })
    ).toBe(0)
    expect(
      await prisma.communityComment.count({
        where: { user_id: authorId, status: 'published' },
      })
    ).toBe(0)
    expect(await postOf(content.post.id)).toMatchObject({
      status: 'flagged',
      moderation_reason: marker,
    })
    expect(await commentOf(content.comment.id)).toMatchObject({
      status: 'blocked',
      screening_reason: marker,
    })
  }

  it('a teen whose guardian revoked consent during the ban stays hidden', async () => {
    const teen = await fx.teen()
    const seeded = await fx.postCase({ author: teen })
    const content = await contentOf(teen.id, await fx.member('owner'))
    const applied = await ban(seeded.caseId, 'permanent')

    await guardian.revokeConsent(teen.guardianId, teen.id)
    expect(
      await prisma.guardianConsent.count({
        where: { teen_id: teen.id, status: 'revoked' },
      })
    ).toBe(1)

    const result = await overturn(applied.sanctionId)
    await expectNothingReturned(teen.id, applied.sanctionId, result, content)
    expect(codeOf(await member(teen.id).get('/api/v1/community/feed'))).not.toBe(
      'community_banned'
    )
  })

  it('a member now under the age floor stays hidden', async () => {
    const subject = await fx.member('underage')
    const seeded = await fx.postCase({ author: subject })
    const content = await contentOf(subject.id, await fx.member('owner'))
    const applied = await ban(seeded.caseId, 'permanent')
    const birthdate = new Date(NOW.getTime() - 12 * 365 * DAY_MS)
    await prisma.userProfile.update({
      where: { user_id: subject.id },
      data: { birthdate },
    })
    const result = await overturn(applied.sanctionId)
    await expectNothingReturned(subject.id, applied.sanctionId, result, content)
  })
})

describe('I-A-BAD-STEP: illegal appeal steps', () => {
  const refused = async (
    sanctionId: string,
    status: string,
    expected: { http: number; code: string },
    staff?: Staff
  ) => {
    const actor = staff ?? (await admin())
    const before = await prisma.moderationDecision.count()
    const row = await prisma.communitySanction.findUnique({ where: { id: sanctionId } })
    const response = await actor.appeal(sanctionId, { status, reason: REASON })
    expect(response.status, dump(response)).toBe(expected.http)
    expect(codeOf(response)).toBe(expected.code)
    expect(await prisma.moderationDecision.count()).toBe(before)
    expect(
      await prisma.communitySanction.findUnique({ where: { id: sanctionId } })
    ).toEqual(row)
  }
  const invalid = { http: 409, code: 'appeal_transition_invalid' }

  it('an outcome from not_requested is invalid', async () => {
    const sanction = await fx.sanction(await fx.member('banned'))
    await refused(sanction.id, 'upheld', invalid)
    await refused(sanction.id, 'overturned', invalid)
  })

  it.each(['upheld', 'overturned'] as const)(
    'any step after %s is invalid',
    async (appealStatus) => {
      const sanction = await fx.sanction(await fx.member('banned'), {
        appealStatus,
        ...(appealStatus === 'overturned' ? { liftedAt: NOW } : {}),
      })
      await refused(sanction.id, 'requested', invalid)
      await refused(sanction.id, 'upheld', invalid)
      await refused(sanction.id, 'overturned', invalid)
    }
  )

  it('a second requested is invalid', async () => {
    const sanction = await fx.sanction(await fx.member('banned'), {
      appealStatus: 'requested',
    })
    await refused(sanction.id, 'requested', invalid)
  })

  it('a step on an expired ban is invalid', async () => {
    const sanction = await fx.sanction(await fx.member('banned'), {
      createdAt: new Date(NOW.getTime() - 10 * DAY_MS),
      expiresAt: new Date(NOW.getTime() - DAY_MS),
    })
    await refused(sanction.id, 'requested', invalid)
  })

  it('a step on a lifted ban is invalid', async () => {
    const sanction = await fx.sanction(await fx.member('banned'), { liftedAt: NOW })
    await refused(sanction.id, 'requested', invalid)
  })

  it('an unknown id is sanction_not_found, ahead of admin_required', async () => {
    const unknown = randomUUID()
    const staff = await moderator()
    const response = await staff.appeal(unknown, { status: 'overturned', reason: REASON })
    expect(response.status, dump(response)).toBe(404)
    expect(codeOf(response)).toBe('sanction_not_found')
    const asAdmin = await (
      await admin()
    ).appeal(unknown, {
      status: 'requested',
      reason: REASON,
    })
    expect(asAdmin.status, dump(asAdmin)).toBe(404)
    expect(codeOf(asAdmin)).toBe('sanction_not_found')
  })

  it.each(['upheld', 'overturned'] as const)(
    'a moderator recording %s gets admin_required',
    async (status) => {
      const sanction = await fx.sanction(await fx.member('banned'), {
        appealStatus: 'requested',
      })
      await refused(
        sanction.id,
        status,
        { http: 403, code: 'admin_required' },
        await moderator()
      )
    }
  )
})

describe('I-A-SELF: no admin rules on a ban they are party to (TEA-07, TEA-08)', () => {
  const asRefused = async (actor: SeededMember, sanctionId: string, code: string) => {
    const staff = boot.staff('admin', actor)
    const before = await prisma.moderationDecision.count()
    const response = await staff.appeal(sanctionId, {
      status: 'requested',
      reason: REASON,
    })
    expect(response.status, dump(response)).toBe(403)
    expect(codeOf(response)).toBe(code)
    expect(await prisma.moderationDecision.count()).toBe(before)
  }

  it('the subject, who is also the case author, is operator_sanctioned while banned', async () => {
    const author = await fx.member('author')
    const seeded = await fx.postCase({ author })
    const applied = await ban(seeded.caseId, 'temporary')
    await asRefused(author, applied.sanctionId, 'operator_sanctioned')
  })

  it('the subject, who is also the case author, is self_review_refused once no longer sanctioned', async () => {
    const author = await fx.member('author')
    const seeded = await fx.postCase({ author })
    const applied = await ban(seeded.caseId, 'temporary')
    const { expires_at: expiresAt } = await sanctionOf(applied.sanctionId)
    await atInstant(expiresAt!, () =>
      asRefused(author, applied.sanctionId, 'self_review_refused')
    )
  })

  it('a reporter of the originating case is self_review_refused', async () => {
    const seeded = await fx.postCase({ reports: 2 })
    const applied = await ban(seeded.caseId, 'temporary')
    await asRefused(seeded.reporters[0]!, applied.sanctionId, 'self_review_refused')
    await asRefused(seeded.reporters[1]!, applied.sanctionId, 'self_review_refused')
  })

  it('a reporter of a comment case is self_review_refused', async () => {
    const seeded = await fx.commentCase()
    const applied = await ban(seeded.caseId, 'temporary')
    await asRefused(seeded.reporters[0]!, applied.sanctionId, 'self_review_refused')
  })

  it('a member who reported the case after the ban is self_review_refused', async () => {
    const seeded = await fx.postCase()
    const applied = await ban(seeded.caseId, 'temporary')
    const late = await fx.member('reporter')
    await fx.postReport(seeded.postId, late.id)
    await asRefused(late, applied.sanctionId, 'self_review_refused')
  })

  it('a reporter who is banned too is operator_sanctioned, the earlier refusal', async () => {
    const seeded = await fx.postCase()
    const applied = await ban(seeded.caseId, 'temporary')
    const reporter = seeded.reporters[0]!
    await fx.sanction(reporter)
    await asRefused(reporter, applied.sanctionId, 'operator_sanctioned')
  })

  it('an unrelated admin passes the same check', async () => {
    const seeded = await fx.postCase()
    const applied = await ban(seeded.caseId, 'temporary')
    const response = await (
      await admin()
    ).appeal(applied.sanctionId, {
      status: 'requested',
      reason: REASON,
    })
    expect(response.status, dump(response)).toBe(200)
  })
})

describe('I-A-IDEMPOTENT: appeal retries (D6)', () => {
  it('a retry returns the stored step and writes nothing', async () => {
    const seeded = await fx.postCase()
    const applied = await ban(seeded.caseId, 'temporary')
    const staff = await moderator()
    const mutationId = randomUUID()
    const input = { status: 'requested', reason: REASON, mutationId }
    const first = await staff.appeal(applied.sanctionId, input)
    expect(first.status, dump(first)).toBe(200)
    const before = await prisma.moderationDecision.count()
    const audit = await prisma.auditLog.count({
      where: { user_id: staff.id, event_type: 'moderation_appeal_recorded' },
    })
    const retry = await staff.appeal(applied.sanctionId, input)
    expect(retry.status, dump(retry)).toBe(200)
    const { replayed: firstReplayed, ...firstStored } = appealData(first)
    const { replayed: retryReplayed, ...retryStored } = appealData(retry)
    expect(firstReplayed).toBe(false)
    expect(retryReplayed).toBe(true)
    expect(retryStored).toEqual(firstStored)
    expect(await prisma.moderationDecision.count()).toBe(before)
    expect(
      await prisma.auditLog.count({
        where: { user_id: staff.id, event_type: 'moderation_appeal_recorded' },
      })
    ).toBe(audit)
  })

  it('a retry after the sanction moved on still replays', async () => {
    const seeded = await fx.postCase()
    const applied = await ban(seeded.caseId, 'temporary')
    const chief = await admin()
    const mutationId = randomUUID()
    const input = { status: 'requested', reason: REASON, mutationId }
    expect((await chief.appeal(applied.sanctionId, input)).status).toBe(200)
    expect(
      (await chief.appeal(applied.sanctionId, { status: 'upheld', reason: REASON }))
        .status
    ).toBe(200)
    const retry = await chief.appeal(applied.sanctionId, input)
    expect(retry.status, dump(retry)).toBe(200)
    expect(appealData(retry)).toMatchObject({
      replayed: true,
      sanction: { appealStatus: 'requested' },
    })
  })

  it('a different step or reason with the same key is idempotency_mismatch', async () => {
    const seeded = await fx.postCase()
    const applied = await ban(seeded.caseId, 'temporary')
    const chief = await admin()
    const mutationId = randomUUID()
    expect(
      (
        await chief.appeal(applied.sanctionId, {
          status: 'requested',
          reason: REASON,
          mutationId,
        })
      ).status
    ).toBe(200)
    for (const change of [
      { status: 'upheld', reason: REASON },
      { status: 'requested', reason: 'Another reason.' },
    ]) {
      const response = await chief.appeal(applied.sanctionId, { ...change, mutationId })
      expect(response.status, dump(response)).toBe(409)
      expect(codeOf(response)).toBe('idempotency_mismatch')
    }
  })

  it('a key used on the decisions route is a mismatch here, and the reverse', async () => {
    const seeded = await fx.postCase()
    const chief = await admin()
    const banKey = randomUUID()
    const banned = await chief.decide(seeded.caseId, {
      action: 'ban',
      reason: REASON,
      ban: { kind: 'temporary', durationDays: 7 },
      mutationId: banKey,
    })
    expect(banned.status, dump(banned)).toBe(200)
    const sanctionId = decisionData(banned).sanction!.sanctionId

    const onAppeal = await chief.appeal(sanctionId, {
      status: 'requested',
      reason: REASON,
      mutationId: banKey,
    })
    expect(onAppeal.status, dump(onAppeal)).toBe(409)
    expect(codeOf(onAppeal)).toBe('idempotency_mismatch')

    const appealKey = randomUUID()
    expect(
      (
        await chief.appeal(sanctionId, {
          status: 'requested',
          reason: REASON,
          mutationId: appealKey,
        })
      ).status
    ).toBe(200)
    const onDecision = await chief.decide(seeded.caseId, {
      action: 'resolve',
      reason: REASON,
      mutationId: appealKey,
    })
    expect(onDecision.status, dump(onDecision)).toBe(409)
    expect(codeOf(onDecision)).toBe('idempotency_mismatch')
  })
})

describe('I-A-RACE: two admins rule on one appeal (forced by a held case lock)', () => {
  it.each([
    ['upheld', 'overturned'],
    ['overturned', 'upheld'],
  ] as const)(
    '%s arriving first wins, and the other is appeal_transition_invalid',
    async (firstStep, secondStep) => {
      const author = await fx.member('author')
      const seeded = await fx.postCase({ author })
      const hidden = await fx.post({ authorId: author.id })
      const applied = await ban(seeded.caseId, 'permanent')
      const starter = await admin()
      const requested = await starter.appeal(applied.sanctionId, {
        status: 'requested',
        reason: REASON,
      })
      expect(requested.status, dump(requested)).toBe(200)
      const firstAdmin = await admin()
      const secondAdmin = await admin()

      const release = await holdCaseLock(seeded.caseId)
      let firstCall: Promise<Response> | undefined
      let secondCall: Promise<Response> | undefined
      try {
        const baseline = await lockWaiters()
        firstCall = start(
          firstAdmin.appeal(applied.sanctionId, { status: firstStep, reason: REASON })
        )
        await untilWaiters(baseline + 1)
        secondCall = start(
          secondAdmin.appeal(applied.sanctionId, { status: secondStep, reason: REASON })
        )
        await untilWaiters(baseline + 2)
      } finally {
        await release()
      }
      const [first, second] = await Promise.all([firstCall, secondCall])
      expect(first.status, dump(first)).toBe(200)
      expect(second.status, dump(second)).toBe(409)
      expect(codeOf(second)).toBe('appeal_transition_invalid')

      const overturnFirst = firstStep === 'overturned'
      expect(appealData(first).restoredCount).toBe(overturnFirst ? 1 : 0)
      expect(await sanctionOf(applied.sanctionId)).toMatchObject({
        appeal_status: firstStep,
        ...(overturnFirst ? {} : { lifted_at: null }),
      })
      expect((await postOf(hidden.id)).status).toBe(
        overturnFirst ? 'published' : 'flagged'
      )
      expect(
        await prisma.moderationDecision.count({
          where: { case_key: seeded.caseId, action: `appeal_${firstStep}` },
        })
      ).toBe(1)
      expect(
        await prisma.moderationDecision.count({
          where: { case_key: seeded.caseId, action: `appeal_${secondStep}` },
        })
      ).toBe(0)
    },
    20_000
  )
})

describe('I-A-FIRST-UNMOVED: an appeal step moves the revision and nothing the SLA reads', () => {
  it('leaves firstDecisionAt and escalated alone', async () => {
    const seeded = await fx.postCase()
    const applied = await ban(seeded.caseId, 'temporary')
    const staff = await admin()
    const before = await staff.detail(seeded.caseId)
    expect(before.firstDecisionAt).toBe(NOW.toISOString())
    expect(before.escalated).toBe(false)

    clock.at(new Date(NOW.getTime() + 60_000))
    const step = await staff.appeal(applied.sanctionId, {
      status: 'requested',
      reason: REASON,
    })
    expect(step.status, dump(step)).toBe(200)
    const after = await staff.detail(seeded.caseId)
    expect(after.revision).not.toBe(before.revision)
    expect(after.firstDecisionAt).toBe(before.firstDecisionAt)
    expect(after.escalated).toBe(false)
  })

  it('leaves an escalated case escalated', async () => {
    const seeded = await fx.postCase()
    const applied = await ban(seeded.caseId, 'temporary')
    const chief = await admin()
    const laterReporter = await fx.member('reporter')
    await fx.postReport(seeded.postId, laterReporter.id)
    clock.at(new Date(NOW.getTime() + 1000))
    const escalated = await chief.decide(seeded.caseId, {
      action: 'escalate',
      reason: REASON,
    })
    expect(escalated.status, dump(escalated)).toBe(200)
    const before = await chief.detail(seeded.caseId)
    expect(before.escalated).toBe(true)

    clock.at(new Date(NOW.getTime() + 2000))
    const step = await chief.appeal(applied.sanctionId, {
      status: 'requested',
      reason: REASON,
    })
    expect(step.status, dump(step)).toBe(200)
    const after = await chief.detail(seeded.caseId)
    expect(after.escalated).toBe(true)
    expect(after.revision).not.toBe(before.revision)
    expect(after.firstDecisionAt).toBe(before.firstDecisionAt)
  })
})
