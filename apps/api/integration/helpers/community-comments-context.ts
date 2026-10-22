// Story 6.4 owner: one disposable database, service graph and HTTP boot per comment spec file.
import 'reflect-metadata'
import { randomUUID } from 'node:crypto'
import type { Request, Response, NextFunction } from 'express'
import request from 'supertest'
import { Test } from '@nestjs/testing'
import type { INestApplication } from '@nestjs/common'
import { PrismaClient, type Prisma } from '@prisma/client'
import { afterAll, afterEach, beforeAll, vi } from 'vitest'
import {
  buildLookbookPostCreateInput,
  createLookbookPost,
  createTeenUser,
  createUser,
  persistUser,
} from '@couture/testing'
import { createCommunityCommentInputSchema } from '@couture/api-client/contracts/http'
import { AccessTokenIdentityService } from '../../src/modules/auth/access-token-identity.service.js'
import { GuardianConsentStateService } from '../../src/modules/auth/guardian-consent-state.service.js'
import { CommunityCommentsController } from '../../src/modules/community/community-comments.controller.js'
import { CommunityCacheHeadersMiddleware } from '../../src/modules/community/community-cache-headers.middleware.js'
import { CommunityController } from '../../src/modules/community/community.controller.js'
import { CommunitySpotlightService } from '../../src/modules/community/community-spotlight.service.js'
import { CommunityService } from '../../src/modules/community/community.service.js'
import { CommunityRepository } from '../../src/modules/community/community.repository.js'
import { CommunityCommentsRepository } from '../../src/modules/community/community-comments.repository.js'
import { CommunityCommentsProcessor } from '../../src/modules/community/community-comments.processor.js'
import { CommunityCommentsService } from '../../src/modules/community/community-comments.service.js'
import { DefaultCommunityModerationEngine } from '../../src/modules/community/community-moderation.engine.js'
import { GuardianService } from '../../src/modules/guardian/guardian.service.js'
import { listenHttpApp } from './loopback-http-app.js'
import { isolatedCommunityDatabase } from './isolated-community-database.js'

export const SECOND_MS = 1000
export const MINUTE_MS = 60 * SECOND_MS
export const HOUR_MS = 60 * MINUTE_MS
export const DAY_MS = 24 * HOUR_MS

/** Fake only Date so Prisma, supertest and BullMQ keep their real timers. */
export function pinClock(at: Date): void {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(at)
}

export type MemberKind = 'adult' | 'teen' | 'child'

/** Shared request defaults for the service, worker and delivery integration suites. */
export const commentInput = (
  body = 'Beautiful layers.',
  parentId: string | null = null
) =>
  createCommunityCommentInputSchema.parse({
    body,
    parentId,
    locale: 'en-US',
    mutationId: randomUUID(),
  })

/** A persisted member and published post, with no test lifecycle hooks attached. */
export async function persistCommentFixture(
  prisma: PrismaClient,
  kind: MemberKind = 'adult',
  postId?: string
) {
  const profilePreferences = { compliance: { accountStatus: 'active' } }
  const user = await persistUser(
    prisma,
    kind === 'teen'
      ? createTeenUser({ profilePreferences })
      : createUser({ profilePreferences, ...(kind === 'child' ? { age: 10 } : {}) })
  )
  const post = await prisma.lookbookPost.create({
    data: buildLookbookPostCreateInput(
      createLookbookPost({
        ...(postId ? { id: postId } : {}),
        userId: user.id,
        status: 'published',
        publishedAt: new Date(),
        altTextConfirmedAt: new Date(),
      })
    ),
  })
  return { user, post }
}

type CommentRowOverrides = Partial<Prisma.CommunityCommentCreateManyInput> &
  Pick<Prisma.CommunityCommentCreateManyInput, 'post_id' | 'user_id'>

/** A direct CommunityComment row for quota and paging fixtures; HTTP payloads use `input`. */
export function commentRow(
  overrides: CommentRowOverrides
): Prisma.CommunityCommentCreateManyInput {
  return {
    body: 'Synthetic queued comment',
    locale: 'en-US',
    platform: 'web',
    ...overrides,
  }
}

export function commentsTestContext() {
  const database = isolatedCommunityDatabase()
  const prisma = new PrismaClient({ datasourceUrl: database.url })
  const repository = new CommunityCommentsRepository(prisma)
  const engine = new DefaultCommunityModerationEngine()
  const getFeatureFlag = vi
    .fn<(key: string, member: string) => Promise<boolean>>()
    .mockResolvedValue(true)
  const flags = {
    getFeatureFlag,
    communityReadEvaluation: async (member: string) => ({
      value: await getFeatureFlag('community_read_enabled', member),
      expiresAt: new Date(Date.now() + 60000),
      validUntil: performance.now() + 60000,
    }),
  }
  const processor = new CommunityCommentsProcessor(prisma, engine, flags)
  const namespace = `comments-${randomUUID()}`
  const guardian = new GuardianService(
    { capture: vi.fn() },
    prisma,
    { markTeenAccessRevoked: vi.fn() } as never,
    { invalidateUserSessions: vi.fn().mockResolvedValue(undefined) } as never
  )
  const service = new CommunityCommentsService(repository, flags as never, guardian)
  const input = commentInput

  /** A member with an active compliance profile and one published post of their own. */
  async function fixture(kind: MemberKind = 'adult') {
    const { user, post } = await persistCommentFixture(
      prisma,
      kind,
      `${namespace}-${randomUUID()}`
    )
    return { userId: user.id, postId: post.id }
  }
  async function create(userId: string, postId: string, request = input()) {
    return service.create({ userId, postId, input: request, platform: 'web' })
  }
  const roots = (userId: string, postId: string, cursor?: string, limit = 20) =>
    service.list({ userId, postId, parentId: null, cursor, limit })
  async function publish(userId: string, postId: string, request = input()) {
    const pending = await create(userId, postId, request)
    await processor.process(pending.id)
    return pending
  }
  async function enableCommunityFlags() {
    for (const key of ['community_read_enabled', 'community_write_enabled'])
      await prisma.featureFlag.upsert({
        where: { key },
        update: { value: true },
        create: { key, value: true },
      })
  }

  /** Boot the real comment routes behind the real auth guard with a stubbed token resolver. */
  async function bootApp(options: {
    userId: string
    role?: string
    canTeenAccess?: boolean
    cacheHeaders?: boolean
    withPostRoutes?: boolean
  }) {
    const identities = {
      resolveIdentity: vi
        .fn()
        .mockResolvedValue({ userId: options.userId, role: options.role ?? 'adult' }),
    }
    const posts = new CommunityService(
      new CommunityRepository(prisma),
      flags as never,
      {} as never,
      {} as never,
      {} as never,
      guardian
    )
    const module = await Test.createTestingModule({
      controllers: options.withPostRoutes
        ? [CommunityCommentsController, CommunityController]
        : [CommunityCommentsController],
      providers: [
        { provide: CommunityCommentsService, useValue: service },
        { provide: CommunityService, useValue: posts },
        { provide: CommunitySpotlightService, useValue: {} },
        {
          provide: GuardianConsentStateService,
          useValue: {
            canTeenAccess: vi.fn().mockResolvedValue(options.canTeenAccess ?? true),
          },
        },
        { provide: AccessTokenIdentityService, useValue: identities },
      ],
    }).compile()
    const app: INestApplication = module.createNestApplication()
    app.useLogger(false)
    if (options.cacheHeaders)
      app.use((req: Request, res: Response, next: NextFunction) =>
        new CommunityCacheHeadersMiddleware().use(req, res, next)
      )
    const server = await listenHttpApp(app)
    const authorized = (method: 'get' | 'post' | 'delete', path: string) =>
      request(server)
        [method](path)
        .set('Authorization', 'Bearer synthetic-token')
        .set('x-couture-platform', 'web')
    return { app, server, identities, authorized }
  }

  beforeAll(async () => {
    await database.migrate()
    await enableCommunityFlags()
  }, 30_000)
  afterEach(async () => {
    // No test may leak a frozen rollout, a fake clock or a one-off flag answer.
    vi.useRealTimers()
    flags.getFeatureFlag.mockReset().mockResolvedValue(true)
    await enableCommunityFlags()
  })
  afterAll(async () => {
    try {
      await prisma.$disconnect()
    } finally {
      await database.drop()
    }
  })

  return {
    database,
    prisma,
    repository,
    engine,
    flags,
    processor,
    namespace,
    guardian,
    service,
    input,
    fixture,
    create,
    roots,
    publish,
    bootApp,
  }
}
