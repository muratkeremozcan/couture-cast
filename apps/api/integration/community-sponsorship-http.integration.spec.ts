// Story 6.7b HTTP boundary: the real CommunityController with a real
// CommunitySponsorshipService over an owned database, so the opt-in header, the
// strict response variants, Vary and the fail-closed projection are proven on
// the wire.
import 'reflect-metadata'
import { Test } from '@nestjs/testing'
import type { INestApplication } from '@nestjs/common'
import type { NextFunction, Request, Response } from 'express'
import request from 'supertest'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  communityFeedResponseSchema,
  communityPostResponseSchema,
  communityReactionFeedResponseSchema,
  communityReactionSpotlightResponseSchema,
  communitySponsoredFeedResponseSchema,
  communitySponsoredPostResponseSchema,
  communitySponsoredSpotlightResponseSchema,
  communitySpotlightResponseSchema,
  type CommunitySponsoredFeedItem,
} from '@couture/api-client/contracts/http'
import { AccessTokenIdentityService } from '../src/modules/auth/access-token-identity.service.js'
import { GuardianConsentStateService } from '../src/modules/auth/guardian-consent-state.service.js'
import { CommerceRepository } from '../src/modules/commerce/commerce.repository.js'
import { CommunitySponsorshipOperatorService } from '../src/modules/commerce/community-sponsorship-operator.service.js'
import { CommunitySponsorshipService } from '../src/modules/commerce/community-sponsorship.service.js'
import { CommunityCacheHeadersMiddleware } from '../src/modules/community/community-cache-headers.middleware.js'
import { CommunityController } from '../src/modules/community/community.controller.js'
import { CommunityService } from '../src/modules/community/community.service.js'
import { CommunitySpotlightService } from '../src/modules/community/community-spotlight.service.js'
import { InMemoryCommunityStorage } from '../src/modules/community/community-storage.fake.js'
import type { FeatureFlagsService } from '../src/modules/feature-flags/feature-flags.service.js'
import { listenHttpApp } from './helpers/loopback-http-app.js'
import { spotlightTestContext } from './helpers/community-spotlight-context.js'
import {
  HOUR,
  agreementReference,
  databaseNow,
  insertLink,
  installAuthUsers,
  seedAdmin,
  seedOffer,
  seedPartner,
  shift,
} from './helpers/community-sponsorship-fixtures.js'

const ctx = spotlightTestContext('sponsorship-http')
const commerceFlags = { getFeatureFlag: vi.fn(() => Promise.resolve(true)) }
const commerceRepository = new CommerceRepository(ctx.prisma)
const sponsorships = new CommunitySponsorshipService(
  commerceFlags as unknown as FeatureFlagsService,
  commerceRepository
)
/**
 * The feed and post routes resolve the viewer's climate band through weather.
 * No weather is ingested here, so every lookup answers unavailable and the
 * feed falls back to every region, exactly as it does in production.
 */
const community = new CommunityService(
  ctx.repository,
  ctx.flags as never,
  { getLatestWeather: () => Promise.resolve({ status: 'unavailable' }) } as never,
  ctx.telemetry,
  new InMemoryCommunityStorage(),
  {} as never
)

let app: INestApplication
let url: string
let admin: { email: string; userId: string }
let partner: Awaited<ReturnType<typeof seedPartner>>
let offer: Awaited<ReturnType<typeof seedOffer>>

const identity = {
  resolveIdentity: (token: string) => Promise.resolve({ userId: token, role: 'adult' }),
}
const guardianConsent = { canTeenAccess: () => Promise.resolve(true) }

async function buildApp(withCacheMiddleware: boolean): Promise<INestApplication> {
  const module = await Test.createTestingModule({
    controllers: [CommunityController],
    providers: [
      { provide: CommunityService, useValue: community },
      { provide: CommunitySpotlightService, useValue: ctx.service },
      { provide: CommunitySponsorshipService, useValue: sponsorships },
      { provide: GuardianConsentStateService, useValue: guardianConsent },
      { provide: AccessTokenIdentityService, useValue: identity },
    ],
  }).compile()
  const built = module.createNestApplication()
  built.useLogger(false)
  if (withCacheMiddleware)
    built.use((req: Request, res: Response, next: NextFunction) =>
      new CommunityCacheHeadersMiddleware().use(req, res, next)
    )
  await listenHttpApp(built)
  return built
}

beforeAll(async () => {
  // Schema probe: this suite fails when the migration is absent.
  await ctx.prisma.$queryRaw`SELECT 1 FROM "CommunityPostSponsorship" LIMIT 1`
  await installAuthUsers(ctx.prisma)
  admin = await seedAdmin(ctx.prisma)
  partner = await seedPartner(ctx.prisma, { displayName: 'Atelier Partner' })
  offer = await seedOffer(ctx.prisma, partner.id)
  app = await buildApp(false)
  url = await listenHttpApp(app)
}, 60_000)

afterEach(async () => {
  // Every test owns its links; none may leave a block on another test's page.
  await ctx.prisma.communityPostSponsorship.deleteMany({})
  commerceFlags.getFeatureFlag.mockReset().mockResolvedValue(true)
})

afterAll(async () => {
  await app?.close()
})

const as = (userId: string, headers: Record<string, string> = {}) => ({
  authorization: `Bearer ${userId}`,
  'x-couture-platform': 'web',
  ...headers,
})
const SPONSORED = { 'x-couture-sponsorship': '1' }
const REACTIONS = { 'x-couture-reactions': '1' }

async function seeded(label: string, authors = 6) {
  const area = ctx.area(label)
  const cohort = await ctx.cohort(area, authors)
  const viewer = await ctx.member(area)
  return { area, cohort, viewer }
}

async function link(postId: string, offerId = offer.id): Promise<string> {
  return insertLink(ctx.prisma, {
    postId,
    offerId,
    createdById: admin.userId,
    startsAt: shift(await databaseNow(ctx.prisma), -HOUR),
  })
}

const expectedBlock = () => ({
  partnerId: partner.slug,
  partnerDisplayName: 'Atelier Partner',
  offerId: offer.id,
  offerTitle: offer.title,
})

/** Pages the `all` feed until `postId` appears, returning every item read. */
async function feedThrough(
  viewer: string,
  postId: string,
  headers: Record<string, string>
): Promise<{ items: CommunitySponsoredFeedItem[]; vary: string[] }> {
  const items: CommunitySponsoredFeedItem[] = []
  const vary: string[] = []
  let cursor: string | null = null
  for (let page = 0; page < 20; page += 1) {
    const query: string = cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''
    const response = await request(url)
      .get(`/api/v1/community/feed?mode=all&limit=30${query}`)
      .set(as(viewer, headers))
      .expect(200)
    vary.push(String(response.headers.vary))
    const body = communitySponsoredFeedResponseSchema.parse(response.body)
    items.push(...body.data.items)
    if (items.some((item) => item.id === postId) || !body.data.nextCursor) break
    cursor = body.data.nextCursor
  }
  return { items, vary }
}

describe('6.7b opted-in reads carry the block on the sponsored item only', () => {
  it('6.7b-INT-201 feed, post, spotlight and Home teaser, with and without reactions', async () => {
    const { cohort, viewer } = await seeded('opted-in')
    const sponsoredId = cohort.expectedOrder[0]!
    await link(sponsoredId)

    for (const extra of [{}, REACTIONS]) {
      const feed = await feedThrough(viewer, sponsoredId, { ...SPONSORED, ...extra })
      const feedItem = feed.items.find((item) => item.id === sponsoredId)
      expect(feedItem?.sponsorship).toEqual(expectedBlock())
      expect(
        feed.items.filter((item) => item.id !== sponsoredId && 'sponsorship' in item)
      ).toEqual([])
      if ('x-couture-reactions' in extra) {
        expect(feedItem?.reactions).toBeDefined()
      } else {
        expect(feedItem && 'reactions' in feedItem).toBe(false)
      }

      const post = communitySponsoredPostResponseSchema.parse(
        (
          await request(url)
            .get(`/api/v1/community/posts/${sponsoredId}`)
            .set(as(viewer, { ...SPONSORED, ...extra }))
            .expect(200)
        ).body
      )
      expect(post.data.sponsorship).toEqual(expectedBlock())
      const unsponsoredPost = communitySponsoredPostResponseSchema.parse(
        (
          await request(url)
            .get(`/api/v1/community/posts/${cohort.expectedOrder[1]!}`)
            .set(as(viewer, { ...SPONSORED, ...extra }))
            .expect(200)
        ).body
      )
      expect('sponsorship' in unsponsoredPost.data).toBe(false)

      for (const query of ['limit=12', 'limit=1&surface=home_teaser']) {
        const spotlight = communitySponsoredSpotlightResponseSchema.parse(
          (
            await request(url)
              .get(`/api/v1/community/spotlight?${query}`)
              .set(as(viewer, { ...SPONSORED, ...extra }))
              .expect(200)
          ).body
        )
        expect(spotlight.data.items[0]).toMatchObject({
          id: sponsoredId,
          rank: 1,
          sponsorship: expectedBlock(),
        })
        expect(
          spotlight.data.items.slice(1).filter((item) => 'sponsorship' in item)
        ).toEqual([])
        if ('x-couture-reactions' in extra) {
          expect(spotlight.data.items[0]!.reactions).toBeDefined()
        }
      }
    }
  })

  it("6.7b-INT-202 without the header every route parses today's strict schemas and carries no sponsorship", async () => {
    const { cohort, viewer } = await seeded('not-opted-in')
    const sponsoredId = cohort.expectedOrder[0]!
    await link(sponsoredId)

    const feed = await request(url)
      .get('/api/v1/community/feed?mode=all&limit=30')
      .set(as(viewer))
      .expect(200)
    expect(communityFeedResponseSchema.safeParse(feed.body).success).toBe(true)
    expect(JSON.stringify(feed.body)).not.toContain('sponsorship')
    const reactionFeed = await request(url)
      .get('/api/v1/community/feed?mode=all&limit=30')
      .set(as(viewer, REACTIONS))
      .expect(200)
    expect(communityReactionFeedResponseSchema.safeParse(reactionFeed.body).success).toBe(
      true
    )
    expect(JSON.stringify(reactionFeed.body)).not.toContain('sponsorship')

    const post = await request(url)
      .get(`/api/v1/community/posts/${sponsoredId}`)
      .set(as(viewer))
      .expect(200)
    expect(communityPostResponseSchema.safeParse(post.body).success).toBe(true)
    expect('sponsorship' in (post.body as { data: object }).data).toBe(false)

    for (const query of ['limit=12', 'limit=1&surface=home_teaser']) {
      const spotlight = await request(url)
        .get(`/api/v1/community/spotlight?${query}`)
        .set(as(viewer))
        .expect(200)
      expect(communitySpotlightResponseSchema.safeParse(spotlight.body).success).toBe(
        true
      )
      expect(JSON.stringify(spotlight.body)).not.toContain('sponsorship')
      const reactions = await request(url)
        .get(`/api/v1/community/spotlight?${query}`)
        .set(as(viewer, REACTIONS))
        .expect(200)
      expect(
        communityReactionSpotlightResponseSchema.safeParse(reactions.body).success
      ).toBe(true)
      expect(JSON.stringify(reactions.body)).not.toContain('sponsorship')
    }
    // Not vacuous: the same post opted in does carry the block.
    const opted = communitySponsoredPostResponseSchema.parse(
      (
        await request(url)
          .get(`/api/v1/community/posts/${sponsoredId}`)
          .set(as(viewer, SPONSORED))
          .expect(200)
      ).body
    )
    expect(opted.data.sponsorship).toEqual(expectedBlock())
  })

  it('6.7b-INT-203 Vary names x-couture-sponsorship on feed, post and spotlight, and on a refusal through the middleware', async () => {
    const { cohort, viewer } = await seeded('vary')
    const routes = [
      '/api/v1/community/feed?mode=all',
      `/api/v1/community/posts/${cohort.expectedOrder[0]!}`,
      '/api/v1/community/spotlight',
      '/api/v1/community/spotlight?limit=1&surface=home_teaser',
    ]
    for (const route of routes) {
      for (const headers of [{}, SPONSORED]) {
        const response = await request(url)
          .get(route)
          .set(as(viewer, headers))
          .expect(200)
        const vary = String(response.headers.vary)
          .split(',')
          .map((part) => part.trim().toLowerCase())
        expect(vary).toEqual(
          expect.arrayContaining([
            'x-couture-sponsorship',
            'x-couture-reactions',
            'x-couture-platform',
            'authorization',
          ])
        )
      }
    }

    const withMiddleware = await buildApp(true)
    try {
      const middlewareUrl = await listenHttpApp(withMiddleware)
      for (const route of [
        '/api/v1/community/spotlight?limit=0',
        '/api/v1/community/feed?limit=0',
      ]) {
        const refused = await request(middlewareUrl)
          .get(route)
          .set(as(viewer, SPONSORED))
          .expect(400)
        expect(String(refused.headers.vary).toLowerCase()).toContain(
          'x-couture-sponsorship'
        )
        expect(refused.headers['cache-control']).toBe('private, no-store')
      }
      // The guard refuses before the route runs, so only the middleware can
      // have set Vary on this 401; the app without it sends none.
      const unauthenticated = await request(middlewareUrl)
        .get('/api/v1/community/feed')
        .set(SPONSORED)
        .expect(401)
      expect(String(unauthenticated.headers.vary).toLowerCase()).toContain(
        'x-couture-sponsorship'
      )
      const bare = await request(url)
        .get('/api/v1/community/feed')
        .set(SPONSORED)
        .expect(401)
      expect(bare.headers.vary).toBeUndefined()
    } finally {
      await withMiddleware.close()
    }
  })
})

describe('6.7b visibility and freshness of the block', () => {
  for (const [index, status] of (['withdrawn', 'flagged'] as const).entries()) {
    it(`6.7b-INT-210.${index + 1} the author of a ${status} sponsored post keeps the author read with no block; another member gets 404`, async () => {
      const { cohort, viewer } = await seeded(`author-${status}`)
      const author = cohort.authorIds[0]!
      const postId = cohort.expectedOrder[0]!
      await link(postId)
      await ctx.prisma.lookbookPost.update({ where: { id: postId }, data: { status } })

      const own = communitySponsoredPostResponseSchema.parse(
        (
          await request(url)
            .get(`/api/v1/community/posts/${postId}`)
            .set(as(author, SPONSORED))
            .expect(200)
        ).body
      )
      expect(own.data.id).toBe(postId)
      expect('sponsorship' in own.data).toBe(false)
      const legacy = communityPostResponseSchema.parse(
        (
          await request(url)
            .get(`/api/v1/community/posts/${postId}`)
            .set(as(author))
            .expect(200)
        ).body
      )
      // The opted-in author read is the legacy author read, field for field;
      // only the signed image expiry moves between the two requests.
      const withoutExpiry = (data: typeof legacy.data) => ({
        ...data,
        imageAccess: { ...data.imageAccess, expiresAt: null },
      })
      expect(withoutExpiry(own.data)).toEqual(withoutExpiry(legacy.data))
      expect(own.data.status).toBe(status)

      await request(url)
        .get(`/api/v1/community/posts/${postId}`)
        .set(as(viewer, SPONSORED))
        .expect(404)
    })
  }

  it('6.7b-INT-211 linking and ending apply on the next spotlight read while the read model stays warm', async () => {
    const { cohort, viewer } = await seeded('warm')
    const postId = cohort.expectedOrder[0]!
    const operator = new CommunitySponsorshipOperatorService(ctx.prisma)
    const read = async () =>
      communitySponsoredSpotlightResponseSchema
        .parse(
          (
            await request(url)
              .get('/api/v1/community/spotlight?limit=12')
              .set(as(viewer, SPONSORED))
              .expect(200)
          ).body
        )
        .data.items.find((item) => item.id === postId)

    expect((await read())?.sponsorship).toBeUndefined()
    const cachedKeys = await ctx.redis.keys(`${ctx.prefix}:*`)
    expect(cachedKeys.length).toBeGreaterThan(0)
    const rank = vi.spyOn(ctx.spotlightRepository, 'rank')
    try {
      await operator.link({
        actorEmail: admin.email,
        postId,
        offerId: offer.id,
        reason: 'partner_campaign',
        authorAgreement: agreementReference(),
        dryRun: false,
      })
      expect((await read())?.sponsorship).toEqual(expectedBlock())

      await operator.end({
        actorEmail: admin.email,
        postId,
        reason: 'campaign_ended',
        dryRun: false,
      })
      expect((await read())?.sponsorship).toBeUndefined()

      // Both changes were served from the same warm snapshot: no re-rank, and
      // the cached keys are the ones the first read wrote.
      expect(rank).not.toHaveBeenCalled()
      expect((await ctx.redis.keys(`${ctx.prefix}:*`)).sort()).toEqual(cachedKeys.sort())
    } finally {
      rank.mockRestore()
    }
  })

  it('6.7b-INT-212 with no saved locale, Accept-Language decides a region-specific offer identically on feed, spotlight and teaser', async () => {
    const { cohort, viewer } = await seeded('region')
    const postId = cohort.expectedOrder[0]!
    const frOffer = await seedOffer(ctx.prisma, partner.id, { localeRegion: 'FR' })
    await link(postId, frOffer.id)
    const profile = await ctx.prisma.userProfile.findUniqueOrThrow({
      where: { user_id: viewer },
    })
    expect(JSON.stringify(profile.preferences)).not.toContain('locale')

    const surfaces = async (acceptLanguage: string) => {
      const headers = { ...SPONSORED, 'accept-language': acceptLanguage }
      const feed = await feedThrough(viewer, postId, headers)
      const spotlight = communitySponsoredSpotlightResponseSchema.parse(
        (
          await request(url)
            .get('/api/v1/community/spotlight?limit=12')
            .set(as(viewer, headers))
            .expect(200)
        ).body
      )
      const teaser = communitySponsoredSpotlightResponseSchema.parse(
        (
          await request(url)
            .get('/api/v1/community/spotlight?limit=1&surface=home_teaser')
            .set(as(viewer, headers))
            .expect(200)
        ).body
      )
      return [
        feed.items.find((item) => item.id === postId)?.sponsorship,
        spotlight.data.items.find((item) => item.id === postId)?.sponsorship,
        teaser.data.items.find((item) => item.id === postId)?.sponsorship,
      ]
    }

    const french = await surfaces('fr-FR,fr;q=0.9')
    expect(french).toHaveLength(3)
    for (const block of french) expect(block).toMatchObject({ offerId: frOffer.id })
    expect(await surfaces('en-US,en;q=0.9')).toEqual([undefined, undefined, undefined])
  })

  it('6.7b-INT-213 a sponsorship query failure still answers 200 with no blocks on every route', async () => {
    const { cohort, viewer } = await seeded('fault')
    const postId = cohort.expectedOrder[0]!
    await link(postId)
    await ctx.prisma.$executeRawUnsafe(
      'ALTER TABLE "CommunityPostSponsorship" RENAME TO "CommunityPostSponsorship_cc67b_hidden"'
    )
    try {
      for (const route of [
        '/api/v1/community/feed?mode=all&limit=30',
        `/api/v1/community/posts/${postId}`,
        '/api/v1/community/spotlight?limit=12',
        '/api/v1/community/spotlight?limit=1&surface=home_teaser',
      ]) {
        const response = await request(url).get(route).set(as(viewer, SPONSORED))
        expect(response.status).toBe(200)
        expect(JSON.stringify(response.body)).not.toContain('sponsorship')
      }
    } finally {
      await ctx.prisma.$executeRawUnsafe(
        'ALTER TABLE "CommunityPostSponsorship_cc67b_hidden" RENAME TO "CommunityPostSponsorship"'
      )
    }
    // The same request with the table back carries the block again.
    const restored = communitySponsoredPostResponseSchema.parse(
      (
        await request(url)
          .get(`/api/v1/community/posts/${postId}`)
          .set(as(viewer, SPONSORED))
          .expect(200)
      ).body
    )
    expect(restored.data.sponsorship).toEqual(expectedBlock())
  })

  it('6.7b-INT-214 the commerce flag off and an opted-out viewer read with no blocks', async () => {
    const { cohort, viewer } = await seeded('chain')
    const postId = cohort.expectedOrder[0]!
    await link(postId)
    const readPost = async () =>
      communitySponsoredPostResponseSchema.parse(
        (
          await request(url)
            .get(`/api/v1/community/posts/${postId}`)
            .set(as(viewer, SPONSORED))
            .expect(200)
        ).body
      ).data

    expect((await readPost()).sponsorship).toEqual(expectedBlock())
    commerceFlags.getFeatureFlag.mockResolvedValue(false)
    expect('sponsorship' in (await readPost())).toBe(false)
    commerceFlags.getFeatureFlag.mockResolvedValue(true)
    await ctx.prisma.commercePreference.create({
      data: { user_id: viewer, affiliate_ctas_enabled: false },
    })
    expect('sponsorship' in (await readPost())).toBe(false)
  })
})
