// Learning path Step 47: Sponsored community highlights.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-47-sponsored-community-highlights
// Story 6.7b: the community click branch of POST /api/v1/commerce/affiliate/clicks
// over real HTTP, through the real CommerceModule, against a database this file
// owns. Every community click re-runs the full eligibility rule before the
// 60-second dedupe, so an ended link is a 404 even for a replay.
import 'reflect-metadata'
import { PrismaClient } from '@prisma/client'
import { UnauthorizedException, type INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  COMMERCE_DISABLED_MESSAGE,
  COMMERCE_OPTED_OUT_MESSAGE,
  COMMERCE_SPONSORSHIP_NOT_FOUND_MESSAGE,
} from '../src/contracts/http.js'
import type { AnalyticsCaptureEvent } from '../src/analytics/analytics.service.js'
import { CommerceModule } from '../src/modules/commerce/commerce.module.js'
import { COMMUNITY_SCENARIO } from '../src/modules/commerce/community-sponsorship.constants.js'
import { RequestAuthGuard } from '../src/modules/auth/security.guards.js'
import type { AuthenticatedRequest } from '../src/modules/auth/security.types.js'
import { FeatureFlagsService } from '../src/modules/feature-flags/feature-flags.service.js'
import { FeatureFlagsWarmup } from '../src/modules/feature-flags/feature-flags.warmup.js'
import { TelemetryService } from '../src/modules/telemetry/telemetry.service.js'
import { isolatedCommunityDatabase } from './helpers/isolated-community-database.js'
import { listenHttpApp } from '../src/testing/loopback-http-app.js'
import {
  HOUR,
  SPONSOR_ALLOWED_HOST,
  databaseNow,
  endLink,
  insertLink,
  seedAdmin,
  seedAuthor,
  seedOffer,
  seedPartner,
  seedPost,
  shift,
} from './helpers/community-sponsorship-fixtures.js'

const database = isolatedCommunityDatabase()
const prisma = new PrismaClient({ datasources: { db: { url: database.url } } })
const featureFlags = { getFeatureFlag: vi.fn() }
const analytics: AnalyticsCaptureEvent[] = []

const COMMUNITY_SURFACES = [
  'community_feed',
  'community_spotlight',
  'home_teaser',
] as const

let app: INestApplication
let url: string
let adminId: string
let author: string
let viewer: string
let partner: Awaited<ReturnType<typeof seedPartner>>
let usOffer: Awaited<ReturnType<typeof seedOffer>>

beforeAll(async () => {
  await database.migrate()
  // Schema probe: this suite fails when the migration is absent.
  await prisma.$queryRaw`SELECT 1 FROM "CommunityPostSponsorship" LIMIT 1`
  adminId = (await seedAdmin(prisma)).userId
  author = await seedAuthor(prisma)
  viewer = await seedAuthor(prisma)
  partner = await seedPartner(prisma)
  usOffer = await seedOffer(prisma, partner.id, { localeRegion: 'US' })

  const moduleFixture = await Test.createTestingModule({ imports: [CommerceModule] })
    .overrideProvider(PrismaClient)
    .useValue(prisma)
    .overrideProvider(FeatureFlagsService)
    .useValue(featureFlags)
    .overrideProvider(FeatureFlagsWarmup)
    .useValue({ onModuleInit: () => Promise.resolve() })
    .overrideProvider(TelemetryService)
    .useValue(
      new TelemetryService(prisma, {
        capture: (event: AnalyticsCaptureEvent) => analytics.push(event),
      })
    )
    .overrideGuard(RequestAuthGuard)
    .useValue({
      canActivate: (context: {
        switchToHttp: () => { getRequest: () => AuthenticatedRequest }
      }) => {
        const req = context.switchToHttp().getRequest()
        const token = req.headers.authorization?.replace(/^Bearer /, '')
        if (!token) throw new UnauthorizedException('Missing or invalid bearer token')
        // Story 5.1 Decision 1: no age or role suppression on commerce.
        req.auth = { token, userId: token, role: 'teen' }
        return true
      },
    })
    .compile()
  app = moduleFixture.createNestApplication()
  app.useLogger(false)
  url = await listenHttpApp(app)
}, 60_000)

beforeEach(() => {
  featureFlags.getFeatureFlag.mockReset().mockResolvedValue(true)
  analytics.splice(0)
})

afterAll(async () => {
  try {
    await app?.close()
    await prisma.$disconnect()
  } finally {
    await database.drop()
  }
})

/** A public post by the adult author, sponsored live by `offerId`. */
async function sponsoredPost(
  offerId = usOffer.id,
  postOverrides: Parameters<typeof seedPost>[2] = {}
): Promise<{ postId: string; linkId: string }> {
  const postId = await seedPost(prisma, author, postOverrides)
  const linkId = await insertLink(prisma, {
    postId,
    offerId,
    createdById: adminId,
    startsAt: shift(await databaseNow(prisma), -HOUR),
  })
  return { postId, linkId }
}

function click(
  body: { offerId: string; recommendationId: string; surface: string },
  userId = viewer
) {
  return request(url)
    .post('/api/v1/commerce/affiliate/clicks')
    .set({ authorization: `Bearer ${userId}`, 'accept-language': 'en-US,en;q=0.9' })
    .send(body)
}

const clicksFor = (postId: string) =>
  prisma.affiliateClick.findMany({ where: { recommendation_id: postId } })

describe('6.7b community click re-check over real HTTP', () => {
  // One concern per test, per surface: a failed analytics assertion cannot
  // hide the replay or the ended-link branch-order proof.
  for (const [index, surface] of COMMUNITY_SURFACES.entries()) {
    const id = `6.7b-INT-30${index + 1}`

    it(`${id}a ${surface}: mints one row with scenario 'community' and the post id as recommendation_id`, async () => {
      const { postId } = await sponsoredPost()

      const minted = await click({
        offerId: usOffer.id,
        recommendationId: postId,
        surface,
      })
      expect(minted.status).toBe(201)
      const redirectUrl = (minted.body as { data: { redirectUrl: string } }).data
        .redirectUrl
      expect(new URL(redirectUrl).hostname).toBe(SPONSOR_ALLOWED_HOST)
      const rows = await clicksFor(postId)
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({
        user_id: viewer,
        offer_id: usOffer.id,
        partner_id: partner.id,
        recommendation_id: postId,
        scenario: COMMUNITY_SCENARIO,
        surface,
        locale_region: 'US',
      })
      expect(COMMUNITY_SCENARIO).toBe('community')
      expect(redirectUrl).toContain(rows[0]!.token)
    })

    it(`${id}b ${surface}: the clicked event and its persisted row carry only partner, offer, surface and region`, async () => {
      const { postId } = await sponsoredPost()

      expect(
        (await click({ offerId: usOffer.id, recommendationId: postId, surface })).status
      ).toBe(201)
      const clicked = analytics.filter((event) => event.event === 'affiliate_cta_clicked')
      expect(clicked).toHaveLength(1)
      expect(clicked[0]!.properties).toEqual({
        partner_id: partner.slug,
        offer_id: usOffer.id,
        surface,
        locale_region: 'US',
        $ip: null,
      })
      const persisted = await prisma.telemetryEvent.findMany({
        where: { event_type: 'affiliate_cta_clicked' },
        orderBy: { created_at: 'desc' },
        take: 1,
      })
      expect(persisted[0]?.user_id).toBeNull()
      expect(persisted[0]?.properties).toEqual({
        partner_id: partner.slug,
        offer_id: usOffer.id,
        surface,
        locale_region: 'US',
      })
      const serialized = JSON.stringify([clicked, persisted])
      for (const identifier of [postId, viewer, author]) {
        expect(serialized).not.toContain(identifier)
      }
    })

    it(`${id}c ${surface}: a replay inside 60 s answers the same redirect with one row and no second event`, async () => {
      const { postId } = await sponsoredPost()
      const body = { offerId: usOffer.id, recommendationId: postId, surface }
      const clickedEvents = () =>
        analytics.filter((event) => event.event === 'affiliate_cta_clicked').length
      const minted = await click(body)
      expect(minted.status).toBe(201)
      // The event's own shape is 30Xb's concern; this test only counts.
      const afterMint = clickedEvents()

      const replay = await click(body)
      expect(replay.status).toBe(200)
      expect((replay.body as { data: { redirectUrl: string } }).data.redirectUrl).toBe(
        (minted.body as { data: { redirectUrl: string } }).data.redirectUrl
      )
      expect(await clicksFor(postId)).toHaveLength(1)
      expect(clickedEvents()).toBe(afterMint)
    })

    it(`${id}d ${surface}: once the link ends, a replay inside 60 s is a 404 with no redirect and no new row`, async () => {
      const { postId, linkId } = await sponsoredPost()
      const body = { offerId: usOffer.id, recommendationId: postId, surface }
      expect((await click(body)).status).toBe(201)
      const [mintedRow] = await clicksFor(postId)

      // The minted row is inside the 60 s dedupe window, so only the
      // eligibility re-check running first can turn this replay into a 404.
      await endLink(prisma, linkId, adminId)
      const afterEnd = await click(body)
      expect(afterEnd.status).toBe(404)
      expect(afterEnd.body).toMatchObject({
        message: COMMERCE_SPONSORSHIP_NOT_FOUND_MESSAGE,
      })
      expect(JSON.stringify(afterEnd.body)).not.toContain(SPONSOR_ALLOWED_HOST)
      expect(await clicksFor(postId)).toEqual([mintedRow])
    })
  }

  const notFound: {
    name: string
    seed: () => Promise<{ offerId: string; postId: string }>
  }[] = [
    {
      name: 'an advisor offer linked behind a community surface',
      seed: async () => {
        const advisor = await seedOffer(prisma, partner.id, {
          advisor: true,
          localeRegion: 'US',
        })
        return { offerId: advisor.id, postId: (await sponsoredPost(advisor.id)).postId }
      },
    },
    {
      name: 'an inactive offer',
      seed: async () => {
        const offer = await seedOffer(prisma, partner.id, {
          status: 'inactive',
          localeRegion: 'US',
        })
        return { offerId: offer.id, postId: (await sponsoredPost(offer.id)).postId }
      },
    },
    {
      name: 'an offer whose window has closed',
      seed: async () => {
        const offer = await seedOffer(prisma, partner.id, {
          localeRegion: 'US',
          effectiveTo: await databaseNow(prisma),
        })
        return { offerId: offer.id, postId: (await sponsoredPost(offer.id)).postId }
      },
    },
    {
      name: 'an inactive partner',
      seed: async () => {
        const inactive = await seedPartner(prisma, { status: 'inactive' })
        const offer = await seedOffer(prisma, inactive.id, { localeRegion: 'US' })
        return { offerId: offer.id, postId: (await sponsoredPost(offer.id)).postId }
      },
    },
    {
      name: "an offer for another region than the viewer's",
      seed: async () => {
        const offer = await seedOffer(prisma, partner.id, { localeRegion: 'FR' })
        return { offerId: offer.id, postId: (await sponsoredPost(offer.id)).postId }
      },
    },
    {
      name: 'a withdrawn post',
      seed: async () => ({
        offerId: usOffer.id,
        postId: (await sponsoredPost(usOffer.id, { status: 'withdrawn' })).postId,
      }),
    },
    {
      name: 'a live garment offer that is not the one linked to the post',
      seed: async () => {
        const other = await seedOffer(prisma, partner.id, { localeRegion: 'US' })
        return { offerId: other.id, postId: (await sponsoredPost()).postId }
      },
    },
    {
      name: 'a post with no link at all',
      seed: async () => ({ offerId: usOffer.id, postId: await seedPost(prisma, author) }),
    },
  ]

  for (const [index, { name, seed }] of notFound.entries()) {
    it(`6.7b-INT-31${index} answers 404 with no redirect and no row for ${name}`, async () => {
      const { offerId, postId } = await seed()
      const response = await click({
        offerId,
        recommendationId: postId,
        surface: 'community_feed',
      })
      expect(response.status).toBe(404)
      expect(response.body).toMatchObject({
        message: COMMERCE_SPONSORSHIP_NOT_FOUND_MESSAGE,
      })
      expect(JSON.stringify(response.body)).not.toContain(SPONSOR_ALLOWED_HOST)
      expect(await clicksFor(postId)).toHaveLength(0)
      expect(analytics).toEqual([])
    })
  }

  for (const [index, status] of (['withdrawn', 'flagged'] as const).entries()) {
    it(`6.7b-INT-321.${index + 1} the author clicking their own ${status} sponsored post gets 404 with no row`, async () => {
      // The author can still read their own non-public post (6.7b-INT-210), but
      // the click re-check admits public posts only, whoever taps.
      const { postId } = await sponsoredPost(usOffer.id, { status })
      const response = await click(
        { offerId: usOffer.id, recommendationId: postId, surface: 'community_feed' },
        author
      )
      expect(response.status).toBe(404)
      expect(response.body).toMatchObject({
        message: COMMERCE_SPONSORSHIP_NOT_FOUND_MESSAGE,
      })
      expect(JSON.stringify(response.body)).not.toContain(SPONSOR_ALLOWED_HOST)
      expect(await clicksFor(postId)).toHaveLength(0)
      expect(analytics).toEqual([])
    })
  }

  it('6.7b-INT-320 the kill switch (503) and an opt-out (403) keep precedence over the sponsorship re-check', async () => {
    const live = await sponsoredPost()
    const ended = await sponsoredPost()
    await endLink(prisma, ended.linkId, adminId)
    const optedOut = await seedAuthor(prisma)
    await prisma.commercePreference.create({
      data: { user_id: optedOut, affiliate_ctas_enabled: false },
    })

    for (const target of [live, ended]) {
      const body = {
        offerId: usOffer.id,
        recommendationId: target.postId,
        surface: 'home_teaser',
      }
      featureFlags.getFeatureFlag.mockResolvedValue(false)
      const disabled = await click(body)
      expect(disabled.status).toBe(503)
      expect(disabled.body).toMatchObject({ message: COMMERCE_DISABLED_MESSAGE })
      featureFlags.getFeatureFlag.mockResolvedValue(true)
      const refused = await click(body, optedOut)
      expect(refused.status).toBe(403)
      expect(refused.body).toMatchObject({ message: COMMERCE_OPTED_OUT_MESSAGE })
      expect(await clicksFor(target.postId)).toHaveLength(0)
    }
    // Not vacuous: the same live click is accepted once both gates pass.
    expect(
      (
        await click({
          offerId: usOffer.id,
          recommendationId: live.postId,
          surface: 'home_teaser',
        })
      ).status
    ).toBe(201)
  })
})
