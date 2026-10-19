import {
  FEED_PATH,
  PUBLISHED_POST_ID,
  VIEWER_BAND,
  PAGE_LIMIT,
  communityHeaders,
  publishedItemBody,
} from './fixtures'
import { MatchersV3, type PactV4, type V3MockServer } from '@pact-foundation/pact'
import { createProviderState, setJsonContent } from '@seontechnologies/pactjs-utils'
import { ResponseError } from '@couture/api-client'
import {
  COMMUNITY_REACTION_CONFLICT_MESSAGE,
  COMMUNITY_REACTION_RATE_LIMITED_MESSAGE,
  communityReactionConflictResponseSchema,
  communityReactionSummarySchema,
  type CommunityPlatform,
} from '@couture/api-client/contracts/http'
import { expect } from 'vitest'
import { pactEventAuth, string, type CreateClient } from '../shared'

// Story 6.3 owner: desired-state add, replacement and retraction wire contracts.
export const communityReactionInteractions = [
  { selection: 'applause', baseRevision: 0 },
  { selection: 'love', baseRevision: 1 },
  { selection: null, baseRevision: 2 },
] as const
export async function verifyCommunityReactionInteraction(
  pact: PactV4,
  createClient: CreateClient,
  platform: CommunityPlatform,
  interaction: (typeof communityReactionInteractions)[number]
) {
  // Provider endpoint: apps/api/src/modules/community/community.controller.ts -> PUT /api/v1/community/posts/:postId/reaction
  const intent = { ...interaction, mutationId: '63100000-0000-4000-8000-000000000001' }
  const summary = {
    counts: {
      applause: interaction.selection === 'applause' ? 1 : 0,
      love: interaction.selection === 'love' ? 1 : 0,
      inspiration: 0,
    },
    total: interaction.selection === null ? 0 : 1,
    viewerReaction: interaction.selection,
    revision: interaction.baseRevision + 1,
    generation: interaction.baseRevision + 1,
  }
  await pact
    .addInteraction()
    .given(
      ...createProviderState({
        name: 'A resolved climate band feed page exists for user',
        params: { userId: pactEventAuth.userId },
      })
    )
    .uponReceiving(
      `a ${platform} desired-state reaction ${String(interaction.selection)}`
    )
    .withRequest(
      'PUT',
      `/api/v1/community/posts/${PUBLISHED_POST_ID}/reaction`,
      setJsonContent({ headers: communityHeaders(platform), body: intent })
    )
    .willRespondWith(200, setJsonContent({ body: { data: summary } }))
    .executeTest(async (mockServer: V3MockServer) => {
      const response = await createClient(
        mockServer
      ).apiV1CommunityPostsPostIdReactionPut({
        postId: PUBLISHED_POST_ID,
        xCouturePlatform: platform,
        setCommunityReactionInput: intent,
      })
      expect(response.data).toEqual(summary)
    })
}

export async function verifyCommunityReactionPostInteraction(
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
        name: 'A published community post is visible to the caller',
        params: { userId: pactEventAuth.userId, postId: PUBLISHED_POST_ID },
      })
    )
    .uponReceiving(`a ${platform} negotiated reaction detail request`)
    .withRequest(
      'GET',
      `/api/v1/community/posts/${PUBLISHED_POST_ID}`,
      setJsonContent({
        headers: { ...communityHeaders(platform), 'x-couture-reactions': '1' },
      })
    )
    .willRespondWith(
      200,
      setJsonContent({ body: { data: { ...publishedItemBody(), reactions: summary } } })
    )
    .executeTest(async (mockServer: V3MockServer) => {
      const response = await createClient(mockServer).apiV1CommunityPostsPostIdGet({
        postId: PUBLISHED_POST_ID,
        xCouturePlatform: platform,
        xCoutureReactions: '1',
      })
      expect('reactions' in response.data ? response.data.reactions : undefined).toEqual(
        summary
      )
    })
}

/*
 * Provider Scrutiny Evidence, Story 6.3 expansion:
 * - CommunityController.getFeed selects the strict negotiated schema only for
 *   x-couture-reactions: 1; platform is required and feed mode defaults to auto.
 * - CommunityRepository.setReaction returns 409 { statusCode, error, message,
 *   data: currentSummary } for stale revisions and changed receipt payloads.
 * - CommunityService.setReaction / CommunityRateLimitException return 429
 *   { statusCode, message, error }; controller withRetryAfterHeader stamps the
 *   integer retry duration in Retry-After before rethrowing.
 * - packages/api-client/src/contracts/http/community.ts defines palette enum,
 *   integer counts/revision/generation, nullable viewerReaction and total sum.
 * - Broker unreachable: provider source supplies these shapes and state names.
 */
const currentReactionSummary = {
  counts: { applause: 2, love: 1, inspiration: 3 },
  total: 6,
  viewerReaction: 'applause' as const,
  revision: 3,
  generation: 7,
}
// pactjs-utils 1.1.0 reads Zod 3 .int() checks as decimals. Provider verification
// rejects valid integer JSON with those matchers. Use Pact's integer matcher;
// the real consumer still validates the entire response with the refined schema.
const reactionSummaryMatchers = () => ({
  counts: {
    applause: MatchersV3.integer(currentReactionSummary.counts.applause),
    love: MatchersV3.integer(currentReactionSummary.counts.love),
    inspiration: MatchersV3.integer(currentReactionSummary.counts.inspiration),
  },
  total: MatchersV3.integer(currentReactionSummary.total),
  viewerReaction: string(currentReactionSummary.viewerReaction),
  revision: MatchersV3.integer(currentReactionSummary.revision),
  generation: MatchersV3.integer(currentReactionSummary.generation),
})

export const communityReactionConflictInteractions = [
  {
    description: 'a stale reaction revision',
    input: {
      selection: 'love',
      baseRevision: 0,
      mutationId: '63100000-0000-4000-8000-000000000002',
    },
  },
  {
    description: 'a mutation receipt reused with a changed payload',
    input: {
      selection: 'love',
      baseRevision: 3,
      mutationId: '63100000-0000-4000-8000-000000000001',
    },
  },
] as const

export async function verifyCommunityReactionConflictInteraction(
  pact: PactV4,
  createClient: CreateClient,
  platform: CommunityPlatform,
  interaction: (typeof communityReactionConflictInteractions)[number]
) {
  // Provider endpoint: apps/api/src/modules/community/community.controller.ts -> PUT /api/v1/community/posts/:postId/reaction
  await pact
    .addInteraction()
    .given(
      ...createProviderState({
        name: 'A community reaction revision and receipt exist for user',
        params: { userId: pactEventAuth.userId, postId: PUBLISHED_POST_ID },
      })
    )
    .uponReceiving(`a ${platform} reaction refused for ${interaction.description}`)
    .withRequest(
      'PUT',
      `/api/v1/community/posts/${PUBLISHED_POST_ID}/reaction`,
      setJsonContent({ headers: communityHeaders(platform), body: interaction.input })
    )
    .willRespondWith(
      409,
      setJsonContent({
        body: {
          statusCode: 409,
          error: 'Conflict',
          message: COMMUNITY_REACTION_CONFLICT_MESSAGE,
          data: reactionSummaryMatchers(),
        },
      })
    )
    .executeTest(async (mockServer: V3MockServer) => {
      const error: unknown = await createClient(mockServer)
        .apiV1CommunityPostsPostIdReactionPut({
          postId: PUBLISHED_POST_ID,
          xCouturePlatform: platform,
          setCommunityReactionInput: interaction.input,
        })
        .catch((failure: unknown) => failure)
      expect(error).toBeInstanceOf(ResponseError)
      if (!(error instanceof ResponseError))
        throw new Error('Expected generated-client ResponseError')
      expect(error.response.status).toBe(409)
      const payload = communityReactionConflictResponseSchema.parse(
        await error.response.json()
      )
      expect(payload).toEqual({
        statusCode: 409,
        error: 'Conflict',
        message: COMMUNITY_REACTION_CONFLICT_MESSAGE,
        data: currentReactionSummary,
      })
    })
}

export async function verifyCommunityReactionRateLimitInteraction(
  pact: PactV4,
  createClient: CreateClient,
  platform: CommunityPlatform
) {
  // Provider endpoint: apps/api/src/modules/community/community.controller.ts -> PUT /api/v1/community/posts/:postId/reaction
  const input = {
    selection: 'love' as const,
    baseRevision: 3,
    mutationId: '63100000-0000-4000-8000-000000000002',
  }
  const envelope = {
    statusCode: 429,
    error: 'Too Many Requests',
    message: COMMUNITY_REACTION_RATE_LIMITED_MESSAGE,
  }
  await pact
    .addInteraction()
    .given(
      ...createProviderState({
        name: 'The member has exhausted the community reaction rolling window',
        params: { userId: pactEventAuth.userId, postId: PUBLISHED_POST_ID },
      })
    )
    .uponReceiving(`a ${platform} reaction beyond the rolling window`)
    .withRequest(
      'PUT',
      `/api/v1/community/posts/${PUBLISHED_POST_ID}/reaction`,
      setJsonContent({ headers: communityHeaders(platform), body: input })
    )
    .willRespondWith(
      429,
      setJsonContent({ headers: { 'Retry-After': '37' }, body: envelope })
    )
    .executeTest(async (mockServer: V3MockServer) => {
      const error: unknown = await createClient(mockServer)
        .apiV1CommunityPostsPostIdReactionPut({
          postId: PUBLISHED_POST_ID,
          xCouturePlatform: platform,
          setCommunityReactionInput: input,
        })
        .catch((failure: unknown) => failure)
      expect(error).toBeInstanceOf(ResponseError)
      if (!(error instanceof ResponseError))
        throw new Error('Expected generated-client ResponseError')
      expect(error.response.status).toBe(429)
      expect(error.response.headers.get('Retry-After')).toBe('37')
      expect(await error.response.json()).toEqual(envelope)
    })
}

export async function verifyCommunityReactionFeedInteraction(
  pact: PactV4,
  createClient: CreateClient,
  platform: CommunityPlatform
) {
  // Provider endpoint: apps/api/src/modules/community/community.controller.ts -> GET /api/v1/community/feed
  await pact
    .addInteraction()
    .given(
      ...createProviderState({
        name: 'A community feed with populated viewer reactions exists for user',
        params: { userId: pactEventAuth.userId },
      })
    )
    .uponReceiving(`a ${platform} negotiated feed with populated reactions`)
    .withRequest(
      'GET',
      FEED_PATH,
      setJsonContent({
        headers: { ...communityHeaders(platform), 'x-couture-reactions': '1' },
        query: { mode: 'auto', limit: String(PAGE_LIMIT) },
      })
    )
    .willRespondWith(
      200,
      setJsonContent({
        body: {
          data: {
            items: [{ ...publishedItemBody(), reactions: reactionSummaryMatchers() }],
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
        mode: 'auto',
        limit: PAGE_LIMIT,
      })
      expect(response.data.items).toHaveLength(1)
      const item = response.data.items[0]!
      expect(item.id).toBe(PUBLISHED_POST_ID)
      expect(
        'reactions' in item
          ? communityReactionSummarySchema.parse(item.reactions)
          : undefined
      ).toEqual(currentReactionSummary)
    })
}
