// Story 6.11 test owner: one case per decision scenario, each with its own members.
// Decisions change the rows they touch, so every test builds its own case instead of sharing a
// grouped seed. Ids carry the run id because AuditLog is immutable and its user_id is a RESTRICT
// foreign key, so moderators and their audit rows are never deleted.
import 'reflect-metadata'
import { randomUUID } from 'node:crypto'
import { Test } from '@nestjs/testing'
import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common'
import {
  PrismaClient,
  type CommunityCommentStatus,
  type CommunityPostStatus,
  type CommunityReportReason,
} from '@prisma/client'
import request from 'supertest'
import { afterEach, beforeAll, vi } from 'vitest'
import {
  moderationCaseDetailResponseSchema,
  type ModerationBanTerms,
  type ModerationCaseDetail,
  type ModerationDecisionAction,
} from '@couture/api-client/contracts/http'
import {
  buildLookbookPostCreateInput,
  createLookbookPost,
  createTeenUser,
  createUser,
  persistUser,
} from '@couture/testing'
import {
  SEED_DAY_MS,
  newRunId,
  seedCommentReport,
  seedMember,
  seedPostReport,
} from './moderation-queue-seed.js'
import { bearer, moderationQueueTestContext } from './moderation-queue-context.js'
import { noSponsorships } from './community-sponsorship-fixtures.js'
import { AccessTokenIdentityService } from '../../src/modules/auth/access-token-identity.service.js'
import { GuardianConsentStateService } from '../../src/modules/auth/guardian-consent-state.service.js'
import { UserSessionService } from '../../src/modules/auth/user-session.service.js'
import { CommunitySponsorshipService } from '../../src/modules/commerce/community-sponsorship.service.js'
import { CommunityController } from '../../src/modules/community/community.controller.js'
import { CommunityRepository } from '../../src/modules/community/community.repository.js'
import { CommunityService } from '../../src/modules/community/community.service.js'
import { CommunityCommentsController } from '../../src/modules/community/community-comments.controller.js'
import { CommunityCommentsRepository } from '../../src/modules/community/community-comments.repository.js'
import { CommunityCommentsService } from '../../src/modules/community/community-comments.service.js'
import { CommunityModerationActionsService } from '../../src/modules/community/community-moderation.actions.js'
import { SupabaseCommunityStorageAdapter } from '../../src/modules/community/community-storage.adapter.js'
import { CommunitySpotlightService } from '../../src/modules/community/community-spotlight.service.js'
import { CommunityStreamRepository } from '../../src/modules/community/community-stream.repository.js'
import { FeatureFlagsService } from '../../src/modules/feature-flags/feature-flags.service.js'
import { GuardianService } from '../../src/modules/guardian/guardian.service.js'
import { ModerationQueueCacheHeadersMiddleware } from '../../src/modules/moderation/moderation-queue-cache-headers.middleware.js'
import { ModerationQueueController } from '../../src/modules/moderation/moderation-queue.controller.js'
import { ModerationQueueRepository } from '../../src/modules/moderation/moderation-queue.repository.js'
import {
  MODERATION_QUEUE_CLOCK,
  ModerationQueueService,
} from '../../src/modules/moderation/moderation-queue.service.js'
import { ModerationDecisionsController } from '../../src/modules/moderation/moderation-decisions.controller.js'
import { ModerationDecisionsRepository } from '../../src/modules/moderation/moderation-decisions.repository.js'
import { ModerationDecisionsService } from '../../src/modules/moderation/moderation-decisions.service.js'
import {
  ModerationAfterCommit,
  ModerationSanctionsService,
} from '../../src/modules/moderation/moderation-sanctions.service.js'
import { listenHttpApp } from '../../src/testing/loopback-http-app.js'

/** The detail body with the 6.11 fields, parsed by the shipped strict schema. */
export type DecisionDetail = ModerationCaseDetail

export type DecisionRequest = {
  action: ModerationDecisionAction
  reason: string
  ban?: ModerationBanTerms | { kind: string; durationDays?: number }
  mutationId?: string
  expectedRevision?: string
}

/**
 * The real decision, queue and community routes on one disposable database. Identity, flags,
 * storage and the clock are doubles, as in 6.10. So are spotlight and the stream assist, which the
 * cache spec replaces with the real ones. `afterCommit` sees every after-commit step.
 */
export function moderationDecisionsTestContext() {
  const base = moderationQueueTestContext()
  const { prisma, flags, flagValues, clock, storage, identities } = base
  const failingFlags = new Set<string>()
  flags.getFeatureFlag.mockImplementation((key: string) =>
    failingFlags.has(key)
      ? Promise.reject(new Error('flag read failed'))
      : Promise.resolve(flagValues.get(key) ?? true)
  )
  const afterCommit = vi.fn<(step: string) => void>()
  const spotlight = {
    invalidatePostAreas: vi.fn((_post: unknown) => {
      afterCommit('invalidatePostAreas')
      return Promise.resolve()
    }),
    invalidateAllAreas: vi.fn(() => {
      afterCommit('invalidateAllAreas')
      return Promise.resolve()
    }),
  }
  const streams = {
    assist: vi.fn(() => {
      afterCommit('assist')
      return Promise.resolve()
    }),
  }
  const sessions = {
    invalidateUserSessions: vi.fn((_userId: string) => {
      afterCommit('invalidateUserSessions')
      return Promise.resolve()
    }),
  }

  // Production runs with the privacy triggers on, so a decision must pass them here too.
  beforeAll(async () => {
    await prisma.$executeRaw`UPDATE "CommunityRuntimeCapability" SET privacy_version = 1 WHERE id = 1`
  })

  afterEach(() => {
    failingFlags.clear()
    flags.getFeatureFlag.mockClear()
    afterCommit.mockClear()
    spotlight.invalidatePostAreas.mockClear()
    spotlight.invalidateAllAreas.mockClear()
    streams.assist.mockClear()
    sessions.invalidateUserSessions.mockClear()
  })

  async function bootApp(
    overrides: {
      spotlight?: Pick<
        CommunitySpotlightService,
        'invalidatePostAreas' | 'invalidateAllAreas'
      > &
        Partial<CommunitySpotlightService>
      streams?: Pick<CommunityStreamRepository, 'assist'>
      /** Feed and post reads need these. Decision and report routes do not. */
      community?: { weather?: unknown; telemetry?: unknown; storage?: unknown }
    } = {}
  ) {
    const guardian = new GuardianService(
      { capture: vi.fn() },
      prisma,
      { markTeenAccessRevoked: vi.fn() } as never,
      { invalidateUserSessions: vi.fn().mockResolvedValue(undefined) } as never
    )
    const posts = new CommunityService(
      new CommunityRepository(prisma),
      flags as never,
      (overrides.community?.weather ?? {}) as never,
      (overrides.community?.telemetry ?? {}) as never,
      (overrides.community?.storage ?? storage) as never,
      guardian
    )
    const comments = new CommunityCommentsService(
      new CommunityCommentsRepository(prisma),
      flags as never,
      guardian
    )
    class DecisionsTestModule implements NestModule {
      configure(consumer: MiddlewareConsumer): void {
        consumer
          .apply(ModerationQueueCacheHeadersMiddleware)
          .forRoutes(ModerationQueueController, ModerationDecisionsController)
      }
    }
    Module({
      controllers: [
        ModerationQueueController,
        ModerationDecisionsController,
        CommunityController,
        CommunityCommentsController,
      ],
      providers: [
        ModerationQueueService,
        ModerationQueueRepository,
        ModerationDecisionsService,
        ModerationDecisionsRepository,
        ModerationSanctionsService,
        ModerationAfterCommit,
        CommunityModerationActionsService,
        { provide: PrismaClient, useValue: prisma },
        { provide: MODERATION_QUEUE_CLOCK, useValue: clock.now },
        { provide: SupabaseCommunityStorageAdapter, useValue: storage },
        { provide: FeatureFlagsService, useValue: flags },
        { provide: AccessTokenIdentityService, useValue: identities },
        {
          provide: GuardianConsentStateService,
          useValue: { canTeenAccess: vi.fn().mockResolvedValue(true) },
        },
        { provide: CommunityService, useValue: posts },
        { provide: CommunityCommentsService, useValue: comments },
        {
          provide: CommunitySpotlightService,
          useValue: overrides.spotlight ?? spotlight,
        },
        {
          provide: CommunityStreamRepository,
          useValue: overrides.streams ?? streams,
        },
        { provide: UserSessionService, useValue: sessions },
        { provide: CommunitySponsorshipService, useValue: noSponsorships },
      ],
    })(DecisionsTestModule)
    const module = await Test.createTestingModule({
      imports: [DecisionsTestModule],
    }).compile()
    const app = module.createNestApplication()
    app.useLogger(false)
    const server = await listenHttpApp(app)

    const client = (role: string, userId: string) => ({
      id: userId,
      get: (path: string) =>
        request(server)
          .get(path)
          .set('Authorization', bearer(role, userId))
          .set('x-couture-platform', 'web'),
      post: (path: string) =>
        request(server)
          .post(path)
          .set('Authorization', bearer(role, userId))
          .set('x-couture-platform', 'web'),
      put: (path: string) =>
        request(server)
          .put(path)
          .set('Authorization', bearer(role, userId))
          .set('x-couture-platform', 'web'),
      delete: (path: string) =>
        request(server)
          .delete(path)
          .set('Authorization', bearer(role, userId))
          .set('x-couture-platform', 'web'),
      patch: (path: string) =>
        request(server)
          .patch(path)
          .set('Authorization', bearer(role, userId))
          .set('x-couture-platform', 'web'),
    })

    /** An operator as the console uses the API: read the revision, then decide. */
    const staff = (role: string, identity: { id: string }) => {
      const http = client(role, identity.id)
      const detail = async (caseId: string): Promise<DecisionDetail> => {
        const response = await http.get(`/api/v1/moderation/cases/${caseId}`)
        if (response.status !== 200)
          throw new Error(
            `detail ${caseId} answered ${response.status}: ${JSON.stringify(response.body)}`
          )
        return moderationCaseDetailResponseSchema.parse(response.body).data
      }
      const decide = async (caseId: string, input: DecisionRequest) => {
        const expectedRevision = input.expectedRevision ?? (await detail(caseId)).revision
        return http.post(`/api/v1/moderation/cases/${caseId}/decisions`).send({
          action: input.action,
          reason: input.reason,
          ...(input.ban ? { ban: input.ban } : {}),
          mutationId: input.mutationId ?? randomUUID(),
          expectedRevision,
        })
      }
      const appeal = (
        sanctionId: string,
        input: { status: string; reason: string; mutationId?: string }
      ) =>
        http.post(`/api/v1/moderation/sanctions/${sanctionId}/appeal`).send({
          status: input.status,
          reason: input.reason,
          mutationId: input.mutationId ?? randomUUID(),
        })
      return { ...http, detail, decide, appeal }
    }

    return {
      app,
      server,
      staff,
      /** A signed-in adult member. */
      member: (userId: string) => client('guardian', userId),
      anonymous: () => request(server),
    }
  }

  return {
    ...base,
    bootApp,
    afterCommit,
    spotlight,
    streams,
    sessions,
    failFlag: (key: string) => failingFlags.add(key),
    /** Enforcement reads `new Date()`, so an expiry test moves the wall clock too. */
    pinWallClock: (at: Date) => {
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(at)
    },
    unpinWallClock: () => vi.useRealTimers(),
  }
}

export type DecisionBoot = Awaited<
  ReturnType<ReturnType<typeof moderationDecisionsTestContext>['bootApp']>
>
export type DecisionFixtures = ReturnType<typeof decisionFixtures>
export type SeededMember = { id: string; alias: string }

export const banMarker = (sanctionId: string) => `community_ban:${sanctionId}`

export function decisionFixtures(prisma: PrismaClient, now: () => Date) {
  const runId = newRunId()
  let counter = 0
  const label = () => `${++counter}`
  let sequence = 0

  const member = (name = 'member'): Promise<SeededMember> =>
    seedMember(prisma, runId, `${name}${label()}`)

  /** A staff identity with a `User` row and no alias, as a real moderator has. */
  const operator = (): Promise<SeededMember> =>
    seedMember(prisma, runId, `operator${label()}`, { alias: false })

  /** A teen with an active guardian consent, which is what lets a teen take part. */
  async function teen(): Promise<SeededMember & { guardianId: string }> {
    const user = await persistUser(
      prisma,
      createTeenUser({ profilePreferences: { compliance: { accountStatus: 'active' } } })
    )
    const guardian = await persistUser(prisma, createUser())
    const alias = `${runId}-teen${label()}`
    await prisma.communityAlias.create({ data: { user_id: user.id, alias } })
    await prisma.guardianConsent.create({
      data: {
        guardian_id: guardian.id,
        teen_id: user.id,
        consent_level: 'full_access',
        status: 'granted',
        consent_granted_at: now(),
      },
    })
    return { id: user.id, alias, guardianId: guardian.id }
  }

  /** The consent lapse a guardian revocation leaves. The privacy trigger needs the member guard. */
  const lapseConsent = (teenId: string) =>
    prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT community_privacy_guards(ARRAY[${teenId}]::text[], ARRAY[]::text[], true)`
      await tx.guardianConsent.updateMany({
        where: { teen_id: teenId },
        data: { status: 'revoked', revoked_at: now() },
      })
    })

  async function post(params: {
    authorId: string
    status?: CommunityPostStatus
    moderationReason?: string | null
    engineVersion?: string | null
    publishedAt?: Date | null
    erasureRequestedAt?: Date | null
    anonymizedAt?: Date | null
    area?: { country: string; region?: string | null; city?: string | null }
  }) {
    const status = params.status ?? 'published'
    const id = `${runId}-post-${label()}`
    const publishedAt =
      params.publishedAt === undefined
        ? status === 'published'
          ? now()
          : null
        : params.publishedAt
    const fixture = createLookbookPost(
      {
        id,
        userId: params.authorId,
        status,
        caption: `Caption ${id}`,
        altText: `Alt ${id}`,
        locale: 'en-US',
        moderationReason: params.moderationReason ?? null,
        moderationEngineVersion: params.engineVersion ?? null,
        anonymizedAt: params.anonymizedAt ?? null,
        publishedAt,
        altTextConfirmedAt: now(),
      },
      { now: now() }
    )
    const created = await prisma.lookbookPost.create({
      data: {
        ...buildLookbookPostCreateInput(fixture),
        erasure_requested_at: params.erasureRequestedAt ?? null,
      },
    })
    if (params.area)
      return prisma.lookbookPost.update({
        where: { id: created.id },
        data: {
          ...(params.area
            ? {
                area_country: params.area.country,
                area_region: params.area.region ?? null,
                area_city: params.area.city ?? null,
              }
            : {}),
        },
      })
    return created
  }

  async function comment(params: {
    postId: string
    authorId: string | null
    status?: CommunityCommentStatus
    parentId?: string | null
    body?: string | null
    screeningReason?: string | null
    screeningVersion?: string | null
    /** A comment published once and since hidden keeps its sequence. */
    wasPublished?: boolean
  }) {
    const status = params.status ?? 'published'
    const published = status === 'published' || params.wasPublished === true
    const position = published ? ++sequence : null
    if (position !== null)
      await prisma.lookbookPost.update({
        where: { id: params.postId },
        data: { comment_publication_sequence: { set: position } },
      })
    const cleared = ['author_deleted', 'consent_suspended', 'erased'].includes(status)
    return prisma.communityComment.create({
      data: {
        id: `${runId}-cmt-${label()}`,
        post_id: params.postId,
        user_id: params.authorId,
        parent_id: params.parentId ?? null,
        body: cleared
          ? null
          : params.body === undefined
            ? `Comment body ${runId}`
            : params.body,
        locale: 'en-US',
        status,
        publication_sequence: position,
        published_at: position === null ? null : now(),
        platform: 'web',
        screening_reason: params.screeningReason ?? null,
        screening_version: params.screeningVersion ?? null,
      },
    })
  }

  const postReport = (
    postId: string | null,
    reporterId: string | null,
    options: {
      reason?: CommunityReportReason
      resolvedAt?: Date | null
      origin?: 'member' | 'screening'
      subjectAlias?: string | null
    } = {}
  ) =>
    seedPostReport(prisma, {
      runId,
      label: label(),
      postId,
      reporterId,
      reason: options.reason ?? 'harassment',
      createdAt: now(),
      dueAt: new Date(now().getTime() + SEED_DAY_MS),
      resolvedAt: options.resolvedAt ?? null,
      subjectAlias: options.subjectAlias ?? null,
    }).then(async (row) =>
      options.origin === 'screening'
        ? prisma.communityPostReport.update({
            where: { id: row.id },
            data: { origin: 'screening' },
          })
        : row
    )

  const commentReport = (
    commentId: string | null,
    reporterId: string | null,
    options: { resolvedAt?: Date | null; reason?: CommunityReportReason } = {}
  ) =>
    seedCommentReport(prisma, {
      runId,
      label: label(),
      commentId,
      reporterId,
      reason: options.reason ?? 'harassment',
      acceptedAt: now(),
      resolvedAt: options.resolvedAt ?? null,
    })

  /** A post case. `reports: 0` leaves the post unreported, which is not a case. */
  async function postCase(
    params: {
      author?: SeededMember
      status?: CommunityPostStatus
      reports?: number
      moderationReason?: string | null
      engineVersion?: string | null
      publishedAt?: Date | null
      erasureRequestedAt?: Date | null
      anonymizedAt?: Date | null
      screening?: boolean
      area?: { country: string; region?: string | null; city?: string | null }
    } = {}
  ) {
    const author = params.author ?? (await member('author'))
    const row = await post({ authorId: author.id, ...params })
    const reporters: SeededMember[] = []
    const reports: { id: string }[] = []
    for (let index = 0; index < (params.reports ?? 1); index++) {
      if (params.screening) {
        reports.push(await postReport(row.id, null, { origin: 'screening' }))
        continue
      }
      const reporter = await member('reporter')
      reporters.push(reporter)
      reports.push(await postReport(row.id, reporter.id))
    }
    return {
      caseId: `post.${row.id}`,
      postId: row.id,
      post: row,
      author,
      reporters,
      reportIds: reports.map((report) => report.id),
    }
  }

  /** A comment case on someone else's post. */
  async function commentCase(
    params: {
      author?: SeededMember
      status?: CommunityCommentStatus
      reports?: number
      screeningReason?: string | null
      screeningVersion?: string | null
      wasPublished?: boolean
      postStatus?: CommunityPostStatus
    } = {}
  ) {
    const author = params.author ?? (await member('author'))
    const owner = await member('owner')
    const parent = await post({
      authorId: owner.id,
      ...(params.postStatus ? { status: params.postStatus } : {}),
    })
    const row = await comment({ postId: parent.id, authorId: author.id, ...params })
    const reporters: SeededMember[] = []
    const reports: { id: string }[] = []
    for (let index = 0; index < (params.reports ?? 1); index++) {
      const reporter = await member('reporter')
      reporters.push(reporter)
      reports.push(await commentReport(row.id, reporter.id))
    }
    return {
      caseId: `comment.${row.id}`,
      commentId: row.id,
      comment: row,
      postId: parent.id,
      post: parent,
      owner,
      author,
      reporters,
      reportIds: reports.map((report) => report.id),
    }
  }

  async function orphanPostCase() {
    const reporter = await member('reporter')
    const report = await postReport(null, reporter.id, { subjectAlias: 'Former Author' })
    return {
      caseId: `orphan-post.${report.id}`,
      reporter,
      reportId: report.id,
    }
  }

  async function orphanCommentCase() {
    const reporter = await member('reporter')
    const report = await commentReport(null, reporter.id)
    return {
      caseId: `orphan-comment.${report.id}`,
      reporter,
      reportId: report.id,
    }
  }

  /**
   * A sanction written straight to the tables, for tests of enforcement that must not depend on
   * the decision route. The decision row is the one a real ban would have written.
   */
  async function sanction(
    subject: { id: string },
    params: {
      kind?: 'temporary' | 'permanent'
      expiresAt?: Date | null
      liftedAt?: Date | null
      appealStatus?: 'not_requested' | 'requested' | 'upheld' | 'overturned'
      createdAt?: Date
      caseKey?: string
      moderatorId?: string | null
    } = {}
  ) {
    const kind = params.kind ?? 'temporary'
    const createdAt = params.createdAt ?? now()
    const expiresAt =
      params.expiresAt === undefined
        ? kind === 'temporary'
          ? new Date(createdAt.getTime() + 7 * SEED_DAY_MS)
          : null
        : params.expiresAt
    const caseKey = params.caseKey ?? `post.${runId}-seeded-${label()}`
    const decision = await prisma.moderationDecision.create({
      data: {
        case_key: caseKey,
        sequence: 1,
        source: 'post',
        report_ids: [],
        action: 'ban',
        reason: 'Seeded ban.',
        moderator_id: params.moderatorId ?? null,
        moderator_role: 'admin',
        subject_user_id: subject.id,
        mutation_id: randomUUID(),
        payload_hash: 'seeded',
        response: {},
        is_terminal: true,
        decided_at: createdAt,
      },
    })
    return prisma.communitySanction.create({
      data: {
        user_id: subject.id,
        decision_id: decision.id,
        case_key: caseKey,
        kind,
        expires_at: expiresAt,
        lifted_at: params.liftedAt ?? null,
        appeal_status: params.appealStatus ?? 'not_requested',
        created_at: createdAt,
      },
    })
  }

  return {
    runId,
    member,
    operator,
    teen,
    lapseConsent,
    post,
    comment,
    postReport,
    commentReport,
    postCase,
    commentCase,
    orphanPostCase,
    orphanCommentCase,
    sanction,
  }
}
