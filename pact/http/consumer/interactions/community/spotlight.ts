import { PUBLISHED_POST_ID, communityHeaders, publishedItemBody } from './fixtures'
import { type PactV4, type V3MockServer } from '@pact-foundation/pact'
import { createProviderState, setJsonContent } from '@seontechnologies/pactjs-utils'
import {
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
    .uponReceiving('a spotlight card open with its rank')
    .withRequest(
      'POST',
      `/api/v1/community/posts/${PUBLISHED_POST_ID}/opened`,
      setJsonContent({
        headers: communityHeaders(platform),
        body: { surface: 'spotlight', rank: SPOTLIGHT_RANK },
      })
    )
    .willRespondWith(200, setJsonContent({ body: { tracked: like(true) } }))
    .executeTest(async (mockServer: V3MockServer) => {
      const response = await createClient(mockServer).apiV1CommunityPostsPostIdOpenedPost(
        {
          postId: PUBLISHED_POST_ID,
          xCouturePlatform: platform,
          openCommunityPostInput: { surface: 'spotlight', rank: SPOTLIGHT_RANK },
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
