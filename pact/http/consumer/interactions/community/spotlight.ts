import {
  PUBLISHED_POST_ID,
  communityHeaders,
  currentReactionSummary,
  publishedItemBody,
  reactionSummaryMatchers,
} from './fixtures'
import { MatchersV3, type PactV4, type V3MockServer } from '@pact-foundation/pact'
import { createProviderState, setJsonContent } from '@seontechnologies/pactjs-utils'
import { ResponseError } from '@couture/api-client'
import {
  COMMUNITY_CURSOR_INVALID_MESSAGE,
  COMMUNITY_FEED_DISABLED_MESSAGE,
  communityReactionSpotlightResponseSchema,
  communitySpotlightDeniedResponseSchema,
  communitySpotlightInvalidCursorResponseSchema,
  communitySpotlightResponseSchema,
  type CommunityPlatform,
} from '@couture/api-client/contracts/http'
import { expect } from 'vitest'
import { like, nullValue, pactEventAuth, string, type CreateClient } from '../shared'

// Story 6.6 owner: City Spotlight read and the two opened-endpoint branches.

const SPOTLIGHT_PATH = '/api/v1/community/spotlight'
export const SPOTLIGHT_LIMIT = 6
export const SPOTLIGHT_LABEL = 'Lisbon'
export const SPOTLIGHT_NEXT_CURSOR = 'spotlight-cursor-6600-page-two'
export const SPOTLIGHT_RANK = 3
/** The first rank on page two at the default limit of six. */
export const SPOTLIGHT_PAGE_TWO_RANK = 7
export const SPOTLIGHT_INVALID_CURSOR = 'spotlight-cursor-6600-forged'

/** What both clients send on every spotlight read: live reaction summaries. */
const negotiatedHeaders = (platform: CommunityPlatform) => ({
  ...communityHeaders(platform),
  'x-couture-reactions': '1',
})

/**
 * A ranked city page. The level enum and the viewer's own label are the
 * contract; the response never carries a cohort size or any author location.
 */
export async function verifyCommunitySpotlightInteraction(
  pact: PactV4,
  createClient: CreateClient,
  platform: CommunityPlatform
) {
  await pact
    .addInteraction()
    .given(
      ...createProviderState({
        name: 'A city spotlight page exists for the viewer area',
        params: { userId: pactEventAuth.userId },
      })
    )
    .uponReceiving('a request for the city spotlight')
    .withRequest(
      'GET',
      SPOTLIGHT_PATH,
      setJsonContent({
        headers: communityHeaders(platform),
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
            items: [{ ...publishedItemBody(), rank: like(1) }],
            nextCursor: like(SPOTLIGHT_NEXT_CURSOR),
          },
        },
      })
    )
    .executeTest(async (mockServer: V3MockServer) => {
      const response = await createClient(mockServer).getCommunitySpotlight({
        xCouturePlatform: platform,
        limit: SPOTLIGHT_LIMIT,
      })
      const parsed = communitySpotlightResponseSchema.parse(response)
      expect(parsed.data.level).toBe('city')
      expect(parsed.data.label).toBe(SPOTLIGHT_LABEL)
      expect(parsed.data.items.map((item) => [item.id, item.rank])).toEqual([
        [PUBLISHED_POST_ID, 1],
      ])
    })
}

/** No level met the privacy cohort: level none, a null label and no items. */
export async function verifyCommunitySpotlightNoneInteraction(
  pact: PactV4,
  createClient: CreateClient,
  platform: CommunityPlatform
) {
  await pact
    .addInteraction()
    .given(
      ...createProviderState({
        name: 'No spotlight cohort exists for the viewer area',
        params: { userId: pactEventAuth.userId },
      })
    )
    .uponReceiving('a request for a spotlight with no eligible cohort')
    .withRequest(
      'GET',
      SPOTLIGHT_PATH,
      setJsonContent({
        headers: communityHeaders(platform),
        query: { limit: String(SPOTLIGHT_LIMIT) },
      })
    )
    .willRespondWith(
      200,
      setJsonContent({
        body: {
          data: {
            level: string('none'),
            label: nullValue(),
            items: [],
            nextCursor: nullValue(),
          },
        },
      })
    )
    .executeTest(async (mockServer: V3MockServer) => {
      const response = await createClient(mockServer).getCommunitySpotlight({
        xCouturePlatform: platform,
        limit: SPOTLIGHT_LIMIT,
      })
      expect(communitySpotlightResponseSchema.parse(response)).toEqual({
        data: { level: 'none', label: null, items: [], nextCursor: null },
      })
    })
}

/** The spotlight branch: a rank and a surface, never an experiment arm. */
export async function verifyOpenCommunitySpotlightPostInteraction(
  pact: PactV4,
  createClient: CreateClient,
  platform: CommunityPlatform
) {
  await pact
    .addInteraction()
    .given(
      ...createProviderState({
        name: 'A city spotlight page exists for the viewer area',
        params: { userId: pactEventAuth.userId },
      })
    )
    .uponReceiving('a spotlight card open with its rank and served level')
    .withRequest(
      'POST',
      `/api/v1/community/posts/${PUBLISHED_POST_ID}/opened`,
      setJsonContent({
        headers: communityHeaders(platform),
        body: { surface: 'spotlight', rank: SPOTLIGHT_RANK, level: 'city' },
      })
    )
    .willRespondWith(200, setJsonContent({ body: { tracked: like(true) } }))
    .executeTest(async (mockServer: V3MockServer) => {
      const response = await createClient(mockServer).apiV1CommunityPostsPostIdOpenedPost(
        {
          postId: PUBLISHED_POST_ID,
          xCouturePlatform: platform,
          openCommunityPostInput: {
            surface: 'spotlight',
            rank: SPOTLIGHT_RANK,
            level: 'city',
          },
        }
      )
      expect(response).toEqual({ tracked: true })
    })
}

/**
 * Story 6.7: the Home teaser read. One rank-1 entry from the same ranking the
 * Community module serves; `surface=home_teaser` changes only analytics.
 */
export async function verifyCommunitySpotlightHomeTeaserInteraction(
  pact: PactV4,
  createClient: CreateClient,
  platform: CommunityPlatform
) {
  // Provider endpoint: apps/api/src/modules/community/community.controller.ts -> GET /api/v1/community/spotlight
  await pact
    .addInteraction()
    .given(
      ...createProviderState({
        name: 'A city spotlight page exists for the viewer area',
        params: { userId: pactEventAuth.userId },
      })
    )
    .uponReceiving(`a ${platform} home teaser read of the top city spotlight entry`)
    .withRequest(
      'GET',
      SPOTLIGHT_PATH,
      setJsonContent({
        headers: negotiatedHeaders(platform),
        query: { limit: '1', surface: 'home_teaser' },
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
                rank: 1,
                reactions: reactionSummaryMatchers(),
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
        limit: 1,
        surface: 'home_teaser',
      })
      const parsed = communityReactionSpotlightResponseSchema.parse(response)
      expect(parsed.data.label).toBe(SPOTLIGHT_LABEL)
      expect(parsed.data.items.map((item) => [item.id, item.rank])).toEqual([
        [PUBLISHED_POST_ID, 1],
      ])
      expect(parsed.data.items[0]!.reactions).toEqual(currentReactionSummary)
    })
}

/** Story 6.7: a Home teaser activation, the spotlight branch with its own surface. */
export async function verifyOpenCommunityHomeTeaserPostInteraction(
  pact: PactV4,
  createClient: CreateClient,
  platform: CommunityPlatform
) {
  await pact
    .addInteraction()
    .given(
      ...createProviderState({
        name: 'A city spotlight page exists for the viewer area',
        params: { userId: pactEventAuth.userId },
      })
    )
    .uponReceiving('a home teaser open with rank one and its served level')
    .withRequest(
      'POST',
      `/api/v1/community/posts/${PUBLISHED_POST_ID}/opened`,
      setJsonContent({
        headers: communityHeaders(platform),
        body: { surface: 'home_teaser', rank: 1, level: 'city' },
      })
    )
    .willRespondWith(200, setJsonContent({ body: { tracked: like(true) } }))
    .executeTest(async (mockServer: V3MockServer) => {
      const response = await createClient(mockServer).apiV1CommunityPostsPostIdOpenedPost(
        {
          postId: PUBLISHED_POST_ID,
          xCouturePlatform: platform,
          openCommunityPostInput: { surface: 'home_teaser', rank: 1, level: 'city' },
        }
      )
      expect(response).toEqual({ tracked: true })
    })
}

/** The installed clients' feed open, unchanged: only the served experiment arm. */
export async function verifyOpenCommunityFeedPostInteraction(
  pact: PactV4,
  createClient: CreateClient,
  platform: CommunityPlatform
) {
  await pact
    .addInteraction()
    .given(
      ...createProviderState({
        name: 'A resolved climate band feed page exists for user',
        params: { userId: pactEventAuth.userId },
      })
    )
    .uponReceiving('a feed card open with the served experiment arm')
    .withRequest(
      'POST',
      `/api/v1/community/posts/${PUBLISHED_POST_ID}/opened`,
      setJsonContent({
        headers: communityHeaders(platform),
        body: { experimentVariant: 'auto' },
      })
    )
    .willRespondWith(200, setJsonContent({ body: { tracked: like(true) } }))
    .executeTest(async (mockServer: V3MockServer) => {
      const response = await createClient(mockServer).apiV1CommunityPostsPostIdOpenedPost(
        {
          postId: PUBLISHED_POST_ID,
          xCouturePlatform: platform,
          openCommunityPostInput: { experimentVariant: 'auto' },
        }
      )
      expect(response).toEqual({ tracked: true })
    })
}

/**
 * The read both clients actually make: `x-couture-reactions: 1` on every page,
 * parsed with the strict negotiated schema, so each card carries its live
 * reaction summary exactly like the feed.
 */
export async function verifyCommunityReactionSpotlightInteraction(
  pact: PactV4,
  createClient: CreateClient,
  platform: CommunityPlatform
) {
  // Provider endpoint: apps/api/src/modules/community/community.controller.ts -> GET /api/v1/community/spotlight
  await pact
    .addInteraction()
    .given(
      ...createProviderState({
        name: 'A city spotlight page exists for the viewer area',
        params: { userId: pactEventAuth.userId },
      })
    )
    .uponReceiving(`a ${platform} negotiated city spotlight with populated reactions`)
    .withRequest(
      'GET',
      SPOTLIGHT_PATH,
      setJsonContent({
        headers: negotiatedHeaders(platform),
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
        limit: SPOTLIGHT_LIMIT,
      })
      const parsed = communityReactionSpotlightResponseSchema.parse(response)
      expect(parsed.data.items.map((item) => [item.id, item.rank])).toEqual([
        [PUBLISHED_POST_ID, 1],
      ])
      expect(parsed.data.items[0]!.reactions).toEqual(currentReactionSummary)
      expect(parsed.data.nextCursor).toBe(SPOTLIGHT_NEXT_CURSOR)
    })
}

/**
 * Page two: the first page's cursor comes back verbatim and the ranks continue
 * where page one stopped. A null cursor is the end of the ranked snapshot.
 */
export async function verifyCommunitySpotlightPageTwoInteraction(
  pact: PactV4,
  createClient: CreateClient,
  platform: CommunityPlatform
) {
  // Provider endpoint: apps/api/src/modules/community/community.controller.ts -> GET /api/v1/community/spotlight
  await pact
    .addInteraction()
    .given(
      ...createProviderState({
        name: 'A second city spotlight page follows the first-page cursor',
        params: { userId: pactEventAuth.userId },
      })
    )
    .uponReceiving(`a ${platform} city spotlight page two read with the page-one cursor`)
    .withRequest(
      'GET',
      SPOTLIGHT_PATH,
      setJsonContent({
        headers: negotiatedHeaders(platform),
        query: { cursor: SPOTLIGHT_NEXT_CURSOR, limit: String(SPOTLIGHT_LIMIT) },
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
                rank: SPOTLIGHT_PAGE_TWO_RANK,
                reactions: reactionSummaryMatchers(),
              },
            ],
            nextCursor: nullValue(),
          },
        },
      })
    )
    .executeTest(async (mockServer: V3MockServer) => {
      const response = await createClient(mockServer).getCommunitySpotlight({
        xCouturePlatform: platform,
        xCoutureReactions: '1',
        cursor: SPOTLIGHT_NEXT_CURSOR,
        limit: SPOTLIGHT_LIMIT,
      })
      const parsed = communityReactionSpotlightResponseSchema.parse(response)
      expect(parsed.data.items.map((item) => item.rank)).toEqual([
        SPOTLIGHT_PAGE_TWO_RANK,
      ])
      expect(parsed.data.nextCursor).toBeNull()
    })
}

/**
 * A forged, malformed, foreign or stale cursor is one stable refusal: 400 with
 * `code: invalid_cursor` and the shared cursor message. Both clients restart
 * paging from page one on exactly this envelope.
 */
export async function verifyCommunitySpotlightInvalidCursorInteraction(
  pact: PactV4,
  createClient: CreateClient,
  platform: CommunityPlatform
) {
  // Provider endpoint: apps/api/src/modules/community/community.controller.ts -> GET /api/v1/community/spotlight
  const envelope = {
    statusCode: 400,
    code: 'invalid_cursor',
    message: COMMUNITY_CURSOR_INVALID_MESSAGE,
  }
  await pact
    .addInteraction()
    .given(
      ...createProviderState({
        name: 'A city spotlight page exists for the viewer area',
        params: { userId: pactEventAuth.userId },
      })
    )
    .uponReceiving(`a ${platform} city spotlight read with a forged cursor`)
    .withRequest(
      'GET',
      SPOTLIGHT_PATH,
      setJsonContent({
        headers: negotiatedHeaders(platform),
        query: { cursor: SPOTLIGHT_INVALID_CURSOR, limit: String(SPOTLIGHT_LIMIT) },
      })
    )
    .willRespondWith(400, setJsonContent({ body: envelope }))
    .executeTest(async (mockServer: V3MockServer) => {
      const error: unknown = await createClient(mockServer)
        .getCommunitySpotlight({
          xCouturePlatform: platform,
          xCoutureReactions: '1',
          cursor: SPOTLIGHT_INVALID_CURSOR,
          limit: SPOTLIGHT_LIMIT,
        })
        .catch((failure: unknown) => failure)
      expect(error).toBeInstanceOf(ResponseError)
      if (!(error instanceof ResponseError))
        throw new Error('Expected generated-client ResponseError')
      expect(error.response.status).toBe(400)
      expect(
        communitySpotlightInvalidCursorResponseSchema.parse(await error.response.json())
      ).toEqual(envelope)
    })
}

/**
 * The read rollout is off for the member: the shared community read gate's 403
 * with `code: denied`, identical to the feed's, which both clients render as
 * the disabled state.
 */
export async function verifyCommunitySpotlightDisabledInteraction(
  pact: PactV4,
  createClient: CreateClient,
  platform: CommunityPlatform
) {
  // Provider endpoint: apps/api/src/modules/community/community.controller.ts -> GET /api/v1/community/spotlight
  const envelope = {
    statusCode: 403,
    code: 'denied',
    message: COMMUNITY_FEED_DISABLED_MESSAGE,
  }
  await pact
    .addInteraction()
    .given(
      ...createProviderState({
        name: 'The community read rollout is off for the viewer',
        params: { userId: pactEventAuth.userId },
      })
    )
    .uponReceiving(`a ${platform} city spotlight read while the read rollout is off`)
    .withRequest(
      'GET',
      SPOTLIGHT_PATH,
      setJsonContent({
        headers: negotiatedHeaders(platform),
        query: { limit: String(SPOTLIGHT_LIMIT) },
      })
    )
    .willRespondWith(403, setJsonContent({ body: envelope }))
    .executeTest(async (mockServer: V3MockServer) => {
      const error: unknown = await createClient(mockServer)
        .getCommunitySpotlight({
          xCouturePlatform: platform,
          xCoutureReactions: '1',
          limit: SPOTLIGHT_LIMIT,
        })
        .catch((failure: unknown) => failure)
      expect(error).toBeInstanceOf(ResponseError)
      if (!(error instanceof ResponseError))
        throw new Error('Expected generated-client ResponseError')
      expect(error.response.status).toBe(403)
      expect(
        communitySpotlightDeniedResponseSchema.parse(await error.response.json())
      ).toEqual(envelope)
    })
}
