import 'reflect-metadata'
import {
  ConflictException,
  Module,
  NotFoundException,
  type INestApplication,
  type Type,
} from '@nestjs/common'
import { MODULE_METADATA } from '@nestjs/common/constants'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  COMMUNITY_POST_NOT_FOUND_MESSAGE,
  COMMUNITY_REACTION_CONFLICT_MESSAGE,
  COMMUNITY_REACTION_RATE_LIMITED_MESSAGE,
  communityFeedResponseSchema,
  communityReactionFeedResponseSchema,
  communityReactionPostResponseSchema,
  communityPostResponseSchema,
  type CommunityReactionSummary,
} from '@couture/api-client/contracts/http'
import { AccessTokenIdentityService } from '../auth/access-token-identity.service.js'
import { AuthStateModule } from '../auth/auth-state.module.js'
import { GuardianConsentStateService } from '../auth/guardian-consent-state.service.js'
import { RequestAuthGuard, RolesGuard } from '../auth/security.guards.js'
import { CommunityModule } from './community.module.js'
import { CommunityRateLimitException } from './community-rate-limit.exception.js'
import { CommunityService } from './community.service.js'

const postId = 'privacy-post-6300'
const feedPath = '/api/v1/community/feed'
const detailPath = `/api/v1/community/posts/${postId}`
const reactionPath = `${detailPath}/reaction`
const intent = {
  selection: 'applause',
  mutationId: '63100000-0000-4000-8000-000000000001',
  baseRevision: 0,
}
const summaryFor = (userId: string): CommunityReactionSummary => ({
  counts: { applause: 2, love: 1, inspiration: 3 },
  total: 6,
  viewerReaction: userId === 'viewer-a' ? 'applause' : 'love',
  revision: userId === 'viewer-a' ? 2 : 4,
  generation: 7,
})
const publishedPost = {
  id: postId,
  caption: 'A local privacy fixture.',
  altText: 'A wool coat.',
  climateBand: 'temperate_dry',
  imageAccess: {
    url: 'https://storage.couturecast.test/privacy.jpg',
    expiresAt: '2026-10-19T14:00:00.000Z',
  },
  publishedAt: '2026-10-19T12:00:00.000Z',
  createdAt: '2026-10-19T11:00:00.000Z',
  status: 'published',
  challengeId: null,
  author: { displayName: 'Local Marten', isSelf: false },
}

// Keep the real guard and its refusal path; identity and consent are local seams.
@Module({
  providers: [
    {
      provide: AccessTokenIdentityService,
      useValue: {
        resolveIdentity: (token: string) =>
          Promise.resolve({
            userId: token,
            role: token === 'teen-without-consent' ? 'teen' : 'guardian',
          }),
      },
    },
    {
      provide: GuardianConsentStateService,
      useValue: { canTeenAccess: () => Promise.resolve(false) },
    },
  ],
  exports: [AccessTokenIdentityService, GuardianConsentStateService],
})
class LocalAuthModule {}

@Module({})
class LocalDependenciesModule {}

describe('CommunityModule HTTP privacy wiring', () => {
  let app: INestApplication | undefined
  const service = {
    getFeed: vi.fn(({ userId, reactions }: { userId: string; reactions?: boolean }) =>
      Promise.resolve({
        items: [
          { ...publishedPost, ...(reactions ? { reactions: summaryFor(userId) } : {}) },
        ],
        authorStates: [],
        nextCursor: null,
        mode: 'auto',
        viewerBand: 'temperate_dry',
        bandResolved: true,
        bandUnresolvedReason: null,
        experimentVariant: 'auto',
        activeChallenge: null,
      })
    ),
    getPost: vi.fn(({ userId, reactions }: { userId: string; reactions?: boolean }) =>
      Promise.resolve({
        ...publishedPost,
        ...(reactions ? { reactions: summaryFor(userId) } : {}),
      })
    ),
    setReaction: vi.fn(() => Promise.resolve(summaryFor('viewer-a'))),
  }

  beforeEach(async () => {
    vi.clearAllMocks()
    const builder = Test.createTestingModule({ imports: [CommunityModule] })
    // Import CommunityModule unchanged. Only outbound collaborators are replaced;
    // configure(), controller routing, middleware and both guards remain real.
    const imports = Reflect.getMetadata(
      MODULE_METADATA.IMPORTS,
      CommunityModule
    ) as Type[]
    for (const dependency of imports) {
      builder
        .overrideModule(dependency)
        .useModule(
          dependency === AuthStateModule ? LocalAuthModule : LocalDependenciesModule
        )
    }
    const providers = Reflect.getMetadata(
      MODULE_METADATA.PROVIDERS,
      CommunityModule
    ) as Type[]
    for (const provider of providers) {
      if (provider === RequestAuthGuard || provider === RolesGuard) continue
      builder
        .overrideProvider(provider)
        .useValue(provider === CommunityService ? service : {})
    }
    const module = await builder.compile()
    app = module.createNestApplication()
    await app.init()
  })

  afterEach(async () => {
    await app?.close()
    app = undefined
    vi.restoreAllMocks()
  })

  function server(): Parameters<typeof request>[0] {
    if (!app) throw new Error('Community app is not initialized')
    return app.getHttpServer() as Parameters<typeof request>[0]
  }

  function expectPrivate(headers: Record<string, string>) {
    expect(headers['cache-control']).toBe('private, no-store')
    expect(headers.vary?.toLowerCase().split(/\s*,\s*/)).toEqual(
      expect.arrayContaining([
        'x-couture-reactions',
        'x-couture-platform',
        'authorization',
      ])
    )
  }

  it('[P0] keeps negotiated feed summaries private and specific to each viewer', async () => {
    for (const viewer of ['viewer-a', 'viewer-b']) {
      const response = await request(server())
        .get(feedPath)
        .set('Authorization', `Bearer ${viewer}`)
        .set('x-couture-platform', 'web')
        .set('x-couture-reactions', '1')
        .expect(200)
      expectPrivate(response.headers)
      expect(
        communityReactionFeedResponseSchema.parse(response.body).data.items[0]?.reactions
      ).toEqual(summaryFor(viewer))
      expect(service.getFeed).toHaveBeenCalledWith(
        expect.objectContaining({ userId: viewer, reactions: true })
      )
    }
  })

  it('[P0] keeps negotiated detail summaries private and specific to each viewer', async () => {
    for (const viewer of ['viewer-a', 'viewer-b']) {
      const response = await request(server())
        .get(detailPath)
        .set('Authorization', `Bearer ${viewer}`)
        .set('x-couture-platform', 'mobile')
        .set('x-couture-reactions', '1')
        .expect(200)
      expectPrivate(response.headers)
      expect(
        communityReactionPostResponseSchema.parse(response.body).data.reactions
      ).toEqual(summaryFor(viewer))
      expect(service.getPost).toHaveBeenCalledWith({
        userId: viewer,
        postId,
        reactions: true,
      })
    }
  })

  it('[P1] preserves the strict legacy feed projection with privacy headers', async () => {
    const response = await request(server())
      .get(feedPath)
      .set('Authorization', 'Bearer viewer-a')
      .set('x-couture-platform', 'web')
      .expect(200)
    expectPrivate(response.headers)
    expect(communityFeedResponseSchema.parse(response.body).data.items[0]).toEqual(
      publishedPost
    )
    expect(
      communityFeedResponseSchema.parse(response.body).data.items[0]
    ).not.toHaveProperty('reactions')
  })

  it('[P1] preserves the strict legacy detail projection with privacy headers', async () => {
    const response = await request(server())
      .get(detailPath)
      .set('Authorization', 'Bearer viewer-a')
      .set('x-couture-platform', 'mobile')
      .expect(200)
    expectPrivate(response.headers)
    expect(communityPostResponseSchema.parse(response.body).data).toEqual(publishedPost)
    expect(communityPostResponseSchema.parse(response.body).data).not.toHaveProperty(
      'reactions'
    )
  })

  it('[P0] marks unauthenticated feed detail and reaction refusals private before guards run', async () => {
    const feed = await request(server())
      .get(feedPath)
      .set('x-couture-platform', 'web')
      .expect(401)
    const detail = await request(server())
      .get(detailPath)
      .set('x-couture-platform', 'mobile')
      .expect(401)
    const reaction = await request(server())
      .put(reactionPath)
      .set('x-couture-platform', 'web')
      .send(intent)
      .expect(401)
    for (const response of [feed, detail, reaction]) expectPrivate(response.headers)
    expect(service.getFeed).not.toHaveBeenCalled()
    expect(service.getPost).not.toHaveBeenCalled()
    expect(service.setReaction).not.toHaveBeenCalled()
  })

  it('[P0] marks the real consent guard 403 refusal private', async () => {
    const response = await request(server())
      .get(feedPath)
      .set('Authorization', 'Bearer teen-without-consent')
      .set('x-couture-platform', 'web')
      .expect(403)
    expectPrivate(response.headers)
    expect((response.body as { message: unknown }).message).toBe(
      'Guardian consent required before continuing'
    )
    expect(service.getFeed).not.toHaveBeenCalled()
  })

  it('[P0] marks an invisible post 404 refusal private', async () => {
    service.getPost.mockRejectedValueOnce(
      new NotFoundException(COMMUNITY_POST_NOT_FOUND_MESSAGE)
    )
    const response = await request(server())
      .get(detailPath)
      .set('Authorization', 'Bearer viewer-a')
      .set('x-couture-platform', 'mobile')
      .expect(404)
    expectPrivate(response.headers)
    expect((response.body as { message: unknown }).message).toBe(
      COMMUNITY_POST_NOT_FOUND_MESSAGE
    )
  })

  it('[P0] keeps the stale revision 409 envelope and summary private', async () => {
    const envelope = {
      statusCode: 409,
      error: 'Conflict',
      message: COMMUNITY_REACTION_CONFLICT_MESSAGE,
      data: summaryFor('viewer-a'),
    }
    service.setReaction.mockRejectedValueOnce(new ConflictException(envelope))
    const response = await request(server())
      .put(reactionPath)
      .set('Authorization', 'Bearer viewer-a')
      .set('x-couture-platform', 'web')
      .send(intent)
      .expect(409)
    expectPrivate(response.headers)
    expect(response.body).toEqual(envelope)
  })

  it('[P0] keeps the 429 envelope private and carries the exact Retry-After header', async () => {
    service.setReaction.mockRejectedValueOnce(
      new CommunityRateLimitException(COMMUNITY_REACTION_RATE_LIMITED_MESSAGE, 37)
    )
    const response = await request(server())
      .put(reactionPath)
      .set('Authorization', 'Bearer viewer-a')
      .set('x-couture-platform', 'mobile')
      .send(intent)
      .expect(429)
    expectPrivate(response.headers)
    expect(response.headers['retry-after']).toBe('37')
    expect(response.body).toEqual({
      statusCode: 429,
      error: 'Too Many Requests',
      message: COMMUNITY_REACTION_RATE_LIMITED_MESSAGE,
    })
  })
})
