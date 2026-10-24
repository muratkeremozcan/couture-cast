import {
  FEED_PATH,
  PAGE_LIMIT,
  PUBLISHED_POST_ID,
  VIEWER_BAND,
  communityHeaders,
  currentReactionSummary,
  publishedItemBody,
  reactionSummaryMatchers,
} from './fixtures'
import { SPOTLIGHT_LABEL, SPOTLIGHT_LIMIT, SPOTLIGHT_NEXT_CURSOR } from './spotlight'
import { MatchersV3, type PactV4, type V3MockServer } from '@pact-foundation/pact'
import { createProviderState, setJsonContent } from '@seontechnologies/pactjs-utils'
import {
  COMMUNITY_SPONSORSHIP_HEADER,
  communitySponsoredFeedResponseSchema,
  communitySponsoredPostResponseSchema,
  communitySponsoredSpotlightResponseSchema,
  type CommunityPlatform,
} from '@couture/api-client/contracts/http'
import { expect } from 'vitest'
import {
  COMMERCE_OFFER_ID,
  COMMERCE_OFFER_TITLE,
  COMMERCE_PARTNER_NAME,
  COMMERCE_PARTNER_SLUG,
} from '../commerce-affiliate'
import { like, pactEventAuth, string, type CreateClient } from '../shared'

/* ---------------------------------------------------------------------------
 * Story 6.7b sponsored community highlights: the opted-in reads.
 *
 * Both clients send `x-couture-sponsorship: 1` beside `x-couture-reactions: 1`
 * on every feed, spotlight, teaser and post read, and parse with the opted-in
 * schemas. These interactions record the request the clients actually make and
 * the `sponsorship` block a linked post carries: four fields, one partner, and
 * no URL. The deep link is built server-side on click.
 *
 * The block is the commerce fixture's partner and offer, and the sponsored post
 * is `PUBLISHED_POST_ID`. `pact/http/provider/doubles/community-sponsorship.ts`
 * links exactly that pair, and the real `CommunitySponsorshipService` builds the
 * block from it, so a renamed or dropped field fails verification.
 *
 * Absence of the block is the not-opted-in path. Pact cannot assert that a key
 * is missing, so the existing feed, spotlight and post interactions with no
 * sponsorship header do not prove it; `community-sponsorship.controller.spec.ts`
 * and the HTTP integration suite do. Which posts are eligible, the window, the
 * region and the public visibility rule are proven in the API unit suite and in
 * `apps/api/integration`.
 * ------------------------------------------------------------------------- */

/** What both clients send on every community read since Story 6.7b. */
const optedInHeaders = (platform: CommunityPlatform) => ({
  ...communityHeaders(platform),
  'x-couture-reactions': '1',
  [COMMUNITY_SPONSORSHIP_HEADER]: '1',
})

const sponsorshipMatchers = () => ({
  partnerId: string(COMMERCE_PARTNER_SLUG),
  partnerDisplayName: string(COMMERCE_PARTNER_NAME),
  offerId: string(COMMERCE_OFFER_ID),
  offerTitle: string(COMMERCE_OFFER_TITLE),
})

const expectedSponsorship = {
  partnerId: COMMERCE_PARTNER_SLUG,
  partnerDisplayName: COMMERCE_PARTNER_NAME,
  offerId: COMMERCE_OFFER_ID,
  offerTitle: COMMERCE_OFFER_TITLE,
}

/** The block carries exactly these four fields, none of them a URL. */
function expectSponsorshipBlock(item: { sponsorship?: unknown }) {
  expect(item.sponsorship).toEqual(expectedSponsorship)
}

export async function verifyCommunitySponsoredFeedInteraction(
  pact: PactV4,
  createClient: CreateClient,
  platform: CommunityPlatform
) {
  // Provider endpoint: apps/api/src/modules/community/community.controller.ts -> GET /api/v1/community/feed
  await pact
    .addInteraction()
    .given(
      ...createProviderState({
        name: 'A sponsored community post is in the viewer feed',
        params: { userId: pactEventAuth.userId, postId: PUBLISHED_POST_ID },
      })
    )
    .uponReceiving(`a ${platform} opted-in feed carrying a sponsored post`)
    .withRequest(
      'GET',
      FEED_PATH,
      setJsonContent({
        headers: optedInHeaders(platform),
        query: { mode: 'auto', limit: String(PAGE_LIMIT) },
      })
    )
    .willRespondWith(
      200,
      setJsonContent({
        body: {
          data: {
            items: [
              {
                ...publishedItemBody(),
                reactions: reactionSummaryMatchers(),
                sponsorship: sponsorshipMatchers(),
              },
            ],
            authorStates: [],
            nextCursor: null,
            mode: 'auto',
            viewerBand: VIEWER_BAND,
            bandResolved: true,
            bandUnresolvedReason: null,
            experimentVariant: 'auto',
            activeChallenge: null,
          },
        },
      })
    )
    .executeTest(async (mockServer: V3MockServer) => {
      const response = await createClient(mockServer).apiV1CommunityFeedGet({
        xCouturePlatform: platform,
        xCoutureReactions: '1',
        xCoutureSponsorship: '1',
        mode: 'auto',
        limit: PAGE_LIMIT,
      })
      const parsed = communitySponsoredFeedResponseSchema.parse(response)
      expect(parsed.data.items).toHaveLength(1)
      const item = parsed.data.items[0]!
      expect(item.id).toBe(PUBLISHED_POST_ID)
      expect(item.reactions).toEqual(currentReactionSummary)
      expectSponsorshipBlock(item)
    })
}

export async function verifyCommunitySponsoredSpotlightInteraction(
  pact: PactV4,
  createClient: CreateClient,
  platform: CommunityPlatform
) {
  // Provider endpoint: apps/api/src/modules/community/community.controller.ts -> GET /api/v1/community/spotlight
  await pact
    .addInteraction()
    .given(
      ...createProviderState({
        name: 'A sponsored community post leads the viewer city spotlight',
        params: { userId: pactEventAuth.userId, postId: PUBLISHED_POST_ID },
      })
    )
    .uponReceiving(`a ${platform} opted-in city spotlight carrying a sponsored post`)
    .withRequest(
      'GET',
      '/api/v1/community/spotlight',
      setJsonContent({
        headers: optedInHeaders(platform),
        query: { limit: String(SPOTLIGHT_LIMIT) },
      })
    )
    .willRespondWith(
      200,
      setJsonContent({
        body: {
          data: {
            level: string('city'),
            label: like(SPOTLIGHT_LABEL),
            items: [
              {
                ...publishedItemBody(),
                rank: MatchersV3.integer(1),
                reactions: reactionSummaryMatchers(),
                sponsorship: sponsorshipMatchers(),
              },
            ],
            nextCursor: like(SPOTLIGHT_NEXT_CURSOR),
          },
        },
      })
    )
    .executeTest(async (mockServer: V3MockServer) => {
      const response = await createClient(mockServer).getCommunitySpotlight({
        xCouturePlatform: platform,
        xCoutureReactions: '1',
        xCoutureSponsorship: '1',
        limit: SPOTLIGHT_LIMIT,
      })
      const parsed = communitySponsoredSpotlightResponseSchema.parse(response)
      expect(parsed.data.items.map((item) => [item.id, item.rank])).toEqual([
        [PUBLISHED_POST_ID, 1],
      ])
      expect(parsed.data.items[0]!.reactions).toEqual(currentReactionSummary)
      expectSponsorshipBlock(parsed.data.items[0]!)
    })
}

/**
 * The Home teaser read: the same ranking, `surface=home_teaser` and one entry.
 * The block on the teaser item is what renders the teaser's CTA.
 */
export async function verifyCommunitySponsoredHomeTeaserInteraction(
  pact: PactV4,
  createClient: CreateClient,
  platform: CommunityPlatform
) {
  // Provider endpoint: apps/api/src/modules/community/community.controller.ts -> GET /api/v1/community/spotlight
  await pact
    .addInteraction()
    .given(
      ...createProviderState({
        name: 'A sponsored community post leads the viewer city spotlight',
        params: { userId: pactEventAuth.userId, postId: PUBLISHED_POST_ID },
      })
    )
    .uponReceiving(`a ${platform} opted-in home teaser read of a sponsored post`)
    .withRequest(
      'GET',
      '/api/v1/community/spotlight',
      setJsonContent({
        headers: optedInHeaders(platform),
        query: { limit: '1', surface: 'home_teaser' },
      })
    )
    .willRespondWith(
      200,
      setJsonContent({
        body: {
          data: {
            // The teaser renders only a served level: `none` with an item must not verify.
            level: MatchersV3.regex('^(city|region|country)$', 'city'),
            label: like(SPOTLIGHT_LABEL),
            items: [
              {
                ...publishedItemBody(),
                rank: 1,
                reactions: reactionSummaryMatchers(),
                sponsorship: sponsorshipMatchers(),
              },
            ],
            nextCursor: like(SPOTLIGHT_NEXT_CURSOR),
          },
        },
      })
    )
    .executeTest(async (mockServer: V3MockServer) => {
      const response = await createClient(mockServer).getCommunitySpotlight({
        xCouturePlatform: platform,
        xCoutureReactions: '1',
        xCoutureSponsorship: '1',
        limit: 1,
        surface: 'home_teaser',
      })
      const parsed = communitySponsoredSpotlightResponseSchema.parse(response)
      expect(parsed.data.items.map((item) => [item.id, item.rank])).toEqual([
        [PUBLISHED_POST_ID, 1],
      ])
      expectSponsorshipBlock(parsed.data.items[0]!)
    })
}

/** The detail dialog's read: the single post carries the same block. */
export async function verifyCommunitySponsoredPostInteraction(
  pact: PactV4,
  createClient: CreateClient,
  platform: CommunityPlatform
) {
  // Provider endpoint: apps/api/src/modules/community/community.controller.ts -> GET /api/v1/community/posts/:postId
  const summary = {
    counts: { applause: 0, love: 0, inspiration: 0 },
    total: 0,
    viewerReaction: null,
    revision: 0,
    generation: 0,
  }
  await pact
    .addInteraction()
    .given(
      ...createProviderState({
        name: 'A sponsored community post is visible to the caller',
        params: { userId: pactEventAuth.userId, postId: PUBLISHED_POST_ID },
      })
    )
    .uponReceiving(`a ${platform} opted-in read of one sponsored community post`)
    .withRequest(
      'GET',
      `/api/v1/community/posts/${PUBLISHED_POST_ID}`,
      setJsonContent({ headers: optedInHeaders(platform) })
    )
    .willRespondWith(
      200,
      setJsonContent({
        body: {
          data: {
            ...publishedItemBody(),
            reactions: summary,
            sponsorship: sponsorshipMatchers(),
          },
        },
      })
    )
    .executeTest(async (mockServer: V3MockServer) => {
      const response = await createClient(mockServer).apiV1CommunityPostsPostIdGet({
        postId: PUBLISHED_POST_ID,
        xCouturePlatform: platform,
        xCoutureReactions: '1',
        xCoutureSponsorship: '1',
      })
      const parsed = communitySponsoredPostResponseSchema.parse(response)
      expect(parsed.data.id).toBe(PUBLISHED_POST_ID)
      expect(parsed.data.reactions).toEqual(summary)
      expectSponsorshipBlock(parsed.data)
    })
}
