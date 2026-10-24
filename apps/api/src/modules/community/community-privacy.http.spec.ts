import 'reflect-metadata'
import {
  ConflictException,
  ForbiddenException,
  Module,
  NotFoundException,
  ServiceUnavailableException,
  type INestApplication,
  type Type,
} from '@nestjs/common'
import { MODULE_METADATA } from '@nestjs/common/constants'
import { HttpAdapterHost } from '@nestjs/core'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import type { Server } from 'node:http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  COMMUNITY_POST_NOT_FOUND_MESSAGE,
  COMMUNITY_AGE_GATE_DENIED_MESSAGE,
  COMMUNITY_FEED_DISABLED_MESSAGE,
  COMMUNITY_REACTION_CONFLICT_MESSAGE,
  COMMUNITY_REACTION_RATE_LIMITED_MESSAGE,
  communityFeedResponseSchema,
  communitySponsoredFeedResponseSchema,
  communitySponsoredPostResponseSchema,
  communityReactionFeedResponseSchema,
  communityReactionPostResponseSchema,
  communityPostResponseSchema,
  badRequestHttpErrorSchema,
  communityReactionConflictResponseSchema,
  forbiddenHttpErrorSchema,
  internalServerErrorHttpErrorSchema,
  notFoundHttpErrorSchema,
  serviceUnavailableHttpErrorSchema,
  tooManyRequestsHttpErrorSchema,
  unauthorizedHttpErrorSchema,
  type CommunityReactionSummary,
} from '@couture/api-client/contracts/http'
import { ApiExceptionFilter } from '../../filters/api-exception.filter.js'
import type { TelemetryService } from '../telemetry/telemetry.service.js'
import { AccessTokenIdentityService } from '../auth/access-token-identity.service.js'
import { AuthStateModule } from '../auth/auth-state.module.js'
import { GuardianConsentStateService } from '../auth/guardian-consent-state.service.js'
import { RequestAuthGuard, RolesGuard } from '../auth/security.guards.js'
import { CommunitySponsorshipService } from '../commerce/community-sponsorship.service.js'
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

// Story 6.7b: CommunityModule imports CommerceModule for this one service. The
// stub answers "no sponsorship" so these tests keep proving the privacy wiring.
const sponsorships = {
  resolveForPosts: vi.fn(() => Promise.resolve(new Map())),
}

@Module({
  providers: [{ provide: CommunitySponsorshipService, useValue: sponsorships }],
  exports: [CommunitySponsorshipService],
})
class LocalDependenciesModule {}

describe('CommunityModule HTTP privacy wiring', () => {
  let app: INestApplication | undefined
  let baseUrl: string | undefined
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
    app.useGlobalFilters(
      new ApiExceptionFilter(app.get(HttpAdapterHost), {
        captureEvent: vi.fn().mockResolvedValue(undefined),
      } as unknown as TelemetryService)
    )
    // One explicit IPv4 listener per app. Handing supertest the bare server
    // made it open an implicit listener per request, and under the full API
    // coverage run one of those requests ended in "socket hang up".
    await app.init()
    await app.listen(0, '127.0.0.1')
    const address = (app.getHttpServer() as Server).address()
    if (!address || typeof address === 'string')
      throw new Error('HTTP test app is not bound')
    baseUrl = `http://127.0.0.1:${address.port}`
  })

  afterEach(async () => {
    await app?.close()
    app = undefined
    baseUrl = undefined
    vi.restoreAllMocks()
  })

  function server(): string {
    if (!app || !baseUrl) throw new Error('Community app is not initialized')
    return baseUrl
  }

  function expectPrivate(headers: Record<string, string>) {
    expect(headers['cache-control']).toBe('private, no-store')
    expect(headers.vary?.toLowerCase().split(/\s*,\s*/)).toEqual(
      expect.arrayContaining([
        'x-couture-reactions',
        'x-couture-sponsorship',
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

  it('6.7b-UNIT-020 keeps an opted-in sponsorship block private to the requesting viewer', async () => {
    const block = {
      partnerId: 'sample-partner',
      partnerDisplayName: 'Sample Partner',
      offerId: 'offer-1',
      offerTitle: 'Trench coat',
    }
    sponsorships.resolveForPosts.mockImplementation(() =>
      Promise.resolve(new Map([[postId, block]]))
    )
    const feed = await request(server())
      .get(feedPath)
      .set('Authorization', 'Bearer viewer-a')
      .set('x-couture-platform', 'web')
      .set('x-couture-sponsorship', '1')
      .expect(200)
    expectPrivate(feed.headers)
    expect(
      communitySponsoredFeedResponseSchema.parse(feed.body).data.items[0]?.sponsorship
    ).toEqual(block)

    const detail = await request(server())
      .get(detailPath)
      .set('Authorization', 'Bearer viewer-a')
      .set('x-couture-platform', 'mobile')
      .set('x-couture-sponsorship', '1')
      .expect(200)
    expectPrivate(detail.headers)
    expect(
      communitySponsoredPostResponseSchema.parse(detail.body).data.sponsorship
    ).toEqual(block)
    sponsorships.resolveForPosts.mockImplementation(() => Promise.resolve(new Map()))
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
    for (const response of [feed, detail, reaction]) {
      expectPrivate(response.headers)
      unauthorizedHttpErrorSchema.parse(response.body)
    }
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
    expect(communityReactionConflictResponseSchema.parse(response.body)).toEqual(envelope)
  })

  it.each([
    { name: 'invalid body', platform: 'web', body: { ...intent, selection: 'laugh' } },
    { name: 'missing platform', platform: undefined, body: intent },
  ])(
    '[P1] documents a malformed reaction $name as a private 400',
    async ({ platform, body }) => {
      const pending = request(server())
        .put(reactionPath)
        .set('Authorization', 'Bearer viewer-a')
      if (platform) pending.set('x-couture-platform', platform)
      const response = await pending.send(body).expect(400)
      expectPrivate(response.headers)
      expect(badRequestHttpErrorSchema.parse(response.body)).toEqual({
        statusCode: 400,
        message: 'Invalid reaction request.',
        error: 'Bad Request',
      })
      expect(service.setReaction).not.toHaveBeenCalled()
    }
  )

  it.each([
    {
      status: 403,
      exception: new ForbiddenException(COMMUNITY_AGE_GATE_DENIED_MESSAGE),
      schema: forbiddenHttpErrorSchema,
      message: COMMUNITY_AGE_GATE_DENIED_MESSAGE,
    },
    {
      status: 404,
      exception: new NotFoundException(COMMUNITY_POST_NOT_FOUND_MESSAGE),
      schema: notFoundHttpErrorSchema,
      message: COMMUNITY_POST_NOT_FOUND_MESSAGE,
    },
    {
      status: 503,
      exception: new ServiceUnavailableException(COMMUNITY_FEED_DISABLED_MESSAGE),
      schema: serviceUnavailableHttpErrorSchema,
      message: COMMUNITY_FEED_DISABLED_MESSAGE,
    },
  ])(
    '[P1] matches the reaction $status body to its shared contract',
    async ({ status, exception, schema, message }) => {
      service.setReaction.mockRejectedValueOnce(exception)
      const response = await request(server())
        .put(reactionPath)
        .set('Authorization', 'Bearer viewer-a')
        .set('x-couture-platform', 'web')
        .send(intent)
        .expect(status)
      expectPrivate(response.headers)
      expect(schema.parse(response.body)).toMatchObject({ statusCode: status, message })
    }
  )

  it('[P1] matches an unexpected reaction failure to the shared 500 contract', async () => {
    service.setReaction.mockRejectedValueOnce(new Error('Synthetic database failure'))
    const response = await request(server())
      .put(reactionPath)
      .set('Authorization', 'Bearer viewer-a')
      .set('x-couture-platform', 'web')
      .send(intent)
      .expect(500)
    expectPrivate(response.headers)
    expect(internalServerErrorHttpErrorSchema.parse(response.body)).toEqual({
      statusCode: 500,
      message: 'Internal server error',
      error: 'Internal Server Error',
    })
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
    expect(tooManyRequestsHttpErrorSchema.parse(response.body)).toEqual({
      statusCode: 429,
      error: 'Too Many Requests',
      message: COMMUNITY_REACTION_RATE_LIMITED_MESSAGE,
    })
  })
})
