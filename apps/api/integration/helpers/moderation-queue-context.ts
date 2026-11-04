// Learning path Step 50: Moderator queue and case detail.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-50-moderator-queue-and-case-detail
// Story 6.10 test owner: one disposable database, the real queue routes behind the real auth guards.
// Identity, flags, storage and the clock are the only doubles. Repository, service and controller are real.
import 'reflect-metadata'
import { randomUUID } from 'node:crypto'
import { Test } from '@nestjs/testing'
import {
  Module,
  UnauthorizedException,
  type INestApplication,
  type MiddlewareConsumer,
  type NestModule,
} from '@nestjs/common'
import { PrismaClient } from '@prisma/client'
import request from 'supertest'
import { afterAll, beforeAll, vi } from 'vitest'
import { AccessTokenIdentityService } from '../../src/modules/auth/access-token-identity.service.js'
import { GuardianConsentStateService } from '../../src/modules/auth/guardian-consent-state.service.js'
import { CommunityController } from '../../src/modules/community/community.controller.js'
import { CommunityRepository } from '../../src/modules/community/community.repository.js'
import { CommunityService } from '../../src/modules/community/community.service.js'
import { CommunityCommentsController } from '../../src/modules/community/community-comments.controller.js'
import { CommunityCommentsRepository } from '../../src/modules/community/community-comments.repository.js'
import { CommunityCommentsService } from '../../src/modules/community/community-comments.service.js'
import { CommunitySpotlightService } from '../../src/modules/community/community-spotlight.service.js'
import { CommunitySponsorshipService } from '../../src/modules/commerce/community-sponsorship.service.js'
import { SupabaseCommunityStorageAdapter } from '../../src/modules/community/community-storage.adapter.js'
import { FeatureFlagsService } from '../../src/modules/feature-flags/feature-flags.service.js'
import { GuardianService } from '../../src/modules/guardian/guardian.service.js'
import { ModerationQueueCacheHeadersMiddleware } from '../../src/modules/moderation/moderation-queue-cache-headers.middleware.js'
import { ModerationQueueController } from '../../src/modules/moderation/moderation-queue.controller.js'
import { ModerationQueueRepository } from '../../src/modules/moderation/moderation-queue.repository.js'
import {
  MODERATION_QUEUE_CLOCK,
  ModerationQueueService,
} from '../../src/modules/moderation/moderation-queue.service.js'
import { listenHttpApp } from '../../src/testing/loopback-http-app.js'
import { noSponsorships } from './community-sponsorship-fixtures.js'
import { isolatedCommunityDatabase } from './isolated-community-database.js'

export type TestRole = 'moderator' | 'admin' | 'guardian' | 'teen'

/** `Bearer test-token:<role>:<userId>` resolves to that identity. Anything else is a 401. */
export const bearer = (role: string, userId: string) =>
  `Bearer test-token:${role}:${userId}`

export function moderationQueueTestContext() {
  const database = isolatedCommunityDatabase()
  const prisma = new PrismaClient({ datasourceUrl: database.url })

  const flagValues = new Map<string, boolean>()
  const flags = {
    getFeatureFlag: vi.fn(
      (key: string, _member: string): Promise<boolean> =>
        Promise.resolve(flagValues.get(key) ?? true)
    ),
    communityReadEvaluation: async (member: string) => ({
      value: await flags.getFeatureFlag('community_read_enabled', member),
      expiresAt: new Date(Date.now() + 60_000),
      validUntil: performance.now() + 60_000,
    }),
  }
  const storage = {
    signReadUrl: vi.fn((path: string, seconds: number) =>
      Promise.resolve(
        `https://storage.test/object/sign/${path}?token=SIGNED-${randomUUID()}&ttl=${seconds}`
      )
    ),
  }

  /** `null` reads the real clock. Tests that pin the instant call `clock.at(date)`. */
  const clock: {
    fixed: Date | null
    now: () => Date
    at: (date: Date) => void
    real: () => void
  } = {
    fixed: null,
    now: () => (clock.fixed ? new Date(clock.fixed) : new Date()),
    at: (date) => {
      clock.fixed = date
    },
    real: () => {
      clock.fixed = null
    },
  }

  const identities = {
    resolveIdentity: vi.fn((token: string) => {
      const match = /^test-token:([a-z]+):(.+)$/.exec(token)
      if (!match) return Promise.reject(new UnauthorizedException('Invalid access token'))
      return Promise.resolve({ userId: match[2]!, role: match[1]! })
    }),
  }

  const guardian = new GuardianService(
    { capture: vi.fn() },
    prisma,
    { markTeenAccessRevoked: vi.fn() } as never,
    { invalidateUserSessions: vi.fn().mockResolvedValue(undefined) } as never
  )

  async function bootApp(options: { withReportRoutes?: boolean } = {}) {
    const reportControllers = options.withReportRoutes
      ? [CommunityController, CommunityCommentsController]
      : []
    const posts = new CommunityService(
      new CommunityRepository(prisma),
      flags as never,
      {} as never,
      {} as never,
      {} as never,
      guardian
    )
    const comments = new CommunityCommentsService(
      new CommunityCommentsRepository(prisma),
      flags as never,
      guardian
    )
    // Mirrors ModerationModule: the cache-header middleware wraps the queue controller.
    class QueueTestModule implements NestModule {
      configure(consumer: MiddlewareConsumer): void {
        consumer
          .apply(ModerationQueueCacheHeadersMiddleware)
          .forRoutes(ModerationQueueController)
      }
    }
    Module({
      controllers: [ModerationQueueController, ...reportControllers],
      providers: [
        ModerationQueueService,
        ModerationQueueRepository,
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
        { provide: CommunitySpotlightService, useValue: {} },
        { provide: CommunitySponsorshipService, useValue: noSponsorships },
      ],
    })(QueueTestModule)
    const module = await Test.createTestingModule({
      imports: [QueueTestModule],
    }).compile()
    const app: INestApplication = module.createNestApplication()
    app.useLogger(false)
    const server = await listenHttpApp(app)
    const as = (role: string, userId: string) => ({
      get: (path: string) =>
        request(server).get(path).set('Authorization', bearer(role, userId)),
      post: (path: string) =>
        request(server)
          .post(path)
          .set('Authorization', bearer(role, userId))
          .set('x-couture-platform', 'web'),
    })
    return { app, server, as, anonymous: () => request(server) }
  }

  beforeAll(async () => {
    await database.migrate()
  }, 60_000)
  afterAll(async () => {
    try {
      await prisma.$disconnect()
    } finally {
      await database.drop()
    }
  })

  return { database, prisma, flags, flagValues, storage, clock, identities, bootApp }
}

/** Row counts and a content checksum of every table a moderation read must leave alone. */
export async function checksumTables(
  prisma: PrismaClient
): Promise<Record<string, string>> {
  const tables = [
    'CommunityPostReport',
    'CommunityCommentReport',
    'CommunityCommentAudit',
    'LookbookPost',
    'CommunityComment',
    'CommunityAlias',
    'ModerationEvent',
    'User',
    'UserProfile',
    'GuardianConsent',
  ]
  const result: Record<string, string> = {}
  for (const table of tables) {
    const rows = await prisma.$queryRawUnsafe<{ count: bigint; digest: string | null }[]>(
      `SELECT count(*)::bigint AS count, md5(coalesce(string_agg(t::text, '|' ORDER BY t::text), '')) AS digest FROM "${table}" t`
    )
    result[table] = `${rows[0]!.count}:${rows[0]!.digest}`
  }
  return result
}
