import {
  ALLOCATE_PATH,
  PUBLISH_PATH,
  AUTHOR_PENDING_POST_ID,
  CHALLENGE_ID,
  UPLOAD_SESSION_ID,
  ALLOCATE_IDEMPOTENCY_KEY,
  PUBLISH_IDEMPOTENCY_KEY,
  CREATED_AT,
  IMAGE_EXPIRES_AT,
  UPLOAD_EXPIRES_AT,
  IMAGE_URL,
  UPLOAD_URL,
  LOCALE,
  communityHeaders,
  allocateRequestBody,
  allocateMismatchedRequestBody,
  publishRequestBody,
} from './fixtures'
import { type PactV4, type V3MockServer } from '@pact-foundation/pact'
import { createProviderState, setJsonContent } from '@seontechnologies/pactjs-utils'
import {
  COMMUNITY_IDEMPOTENCY_MISMATCH_MESSAGE,
  COMMUNITY_POST_RATE_LIMITED_MESSAGE,
  COMMUNITY_UPLOAD_SESSION_MISMATCH_MESSAGE,
  type CommunityPlatform,
} from '@couture/api-client/contracts/http'
import { expect } from 'vitest'
import {
  isoTimestamp,
  like,
  nullValue,
  pactEventAuth,
  regex,
  string,
  type CreateClient,
} from '../shared'

// --- Upload allocation -----------------------------------------------------

/**
 * Every community POST carries `@HttpCode(200)`; the Nest default would be 201.
 *
 * `altTextSuggestion` is a starting point: publishing rejects unconfirmed alt
 * text, so the suggestion and its locale are what the author edits and then
 * confirms.
 */
export async function verifyAllocateCommunityPostInteraction(
  pact: PactV4,
  createClient: CreateClient,
  platform: CommunityPlatform
) {
  await pact
    .addInteraction()
    .given(
      ...createProviderState({
        name: 'The caller may allocate a community upload session',
        params: { userId: pactEventAuth.userId },
      })
    )
    .uponReceiving('a request to allocate a community post upload session')
    .withRequest(
      'POST',
      ALLOCATE_PATH,
      setJsonContent({
        headers: {
          ...communityHeaders(platform),
          'Idempotency-Key': ALLOCATE_IDEMPOTENCY_KEY,
        },
        body: allocateRequestBody,
      })
    )
    .willRespondWith(
      200,
      setJsonContent({
        body: {
          data: {
            postId: string(AUTHOR_PENDING_POST_ID),
            uploadSessionId: string(UPLOAD_SESSION_ID),
            uploadUrl: like(UPLOAD_URL),
            uploadToken: like('upload-token-6100-0001'),
            requiredHeaders: { 'content-type': string('image/jpeg') },
            expiresAt: isoTimestamp(UPLOAD_EXPIRES_AT),
            altTextSuggestion: like('A person in a grey wool coat over a cream knit.'),
            altTextSuggestionLocale: string(LOCALE),
          },
        },
      })
    )
    .executeTest(async (mockServer: V3MockServer) => {
      const response = await createClient(mockServer).apiV1CommunityPostsAllocatePost({
        idempotencyKey: ALLOCATE_IDEMPOTENCY_KEY,
        xCouturePlatform: platform,
        allocateCommunityPostInput: allocateRequestBody,
      })

      expect(response.data.postId).toBe(AUTHOR_PENDING_POST_ID)
      expect(response.data.uploadSessionId).toBe(UPLOAD_SESSION_ID)
      expect(response.data.requiredHeaders['content-type']).toBe('image/jpeg')
      // The suggestion comes back in the requested locale, so the author is
      // never asked to confirm alt text in a language they did not ask for. No
      // user id appears in the upload URL or token.
      expect(response.data.altTextSuggestionLocale).toBe(LOCALE)
      expect(response.data.altTextSuggestion.length).toBeGreaterThan(0)
      expect(response.data.uploadUrl).not.toContain(pactEventAuth.userId)
      expect(response.data.uploadToken).not.toContain(pactEventAuth.userId)
    })
}

/**
 * A retried allocate with the SAME key and the SAME payload replays the
 * original session, so a client that lost the response to a network drop
 * recovers by repeating the call.
 */
export async function verifyAllocateCommunityPostReplayInteraction(
  pact: PactV4,
  createClient: CreateClient,
  platform: CommunityPlatform
) {
  await pact
    .addInteraction()
    .given(
      ...createProviderState({
        name: 'A community upload session already exists for the idempotency key',
        params: { userId: pactEventAuth.userId, postId: AUTHOR_PENDING_POST_ID },
      })
    )
    .uponReceiving('a replayed community upload allocation with the same payload')
    .withRequest(
      'POST',
      ALLOCATE_PATH,
      setJsonContent({
        headers: {
          ...communityHeaders(platform),
          'Idempotency-Key': ALLOCATE_IDEMPOTENCY_KEY,
        },
        body: allocateRequestBody,
      })
    )
    .willRespondWith(
      200,
      setJsonContent({
        body: {
          data: {
            postId: string(AUTHOR_PENDING_POST_ID),
            uploadSessionId: string(UPLOAD_SESSION_ID),
            uploadUrl: like(UPLOAD_URL),
            uploadToken: like('upload-token-6100-0001'),
            requiredHeaders: { 'content-type': string('image/jpeg') },
            expiresAt: isoTimestamp(UPLOAD_EXPIRES_AT),
            altTextSuggestion: like('A person in a grey wool coat over a cream knit.'),
            altTextSuggestionLocale: string(LOCALE),
          },
        },
      })
    )
    .executeTest(async (mockServer: V3MockServer) => {
      const response = await createClient(mockServer).apiV1CommunityPostsAllocatePost({
        idempotencyKey: ALLOCATE_IDEMPOTENCY_KEY,
        xCouturePlatform: platform,
        allocateCommunityPostInput: allocateRequestBody,
      })

      // A replay returns the ORIGINAL session: same post, same session id. A
      // second row would strand the first upload.
      expect(response.data.postId).toBe(AUTHOR_PENDING_POST_ID)
      expect(response.data.uploadSessionId).toBe(UPLOAD_SESSION_ID)
    })
}

/**
 * The idempotency key is a promise about a payload, so reusing it for different
 * bytes is a client bug the server names with a 409.
 */
export async function verifyAllocateCommunityPostMismatchInteraction(
  pact: PactV4,
  platform: CommunityPlatform
) {
  await pact
    .addInteraction()
    .given(
      ...createProviderState({
        name: 'A community upload session already exists for the idempotency key',
        params: { userId: pactEventAuth.userId, postId: AUTHOR_PENDING_POST_ID },
      })
    )
    .uponReceiving('a replayed community upload allocation with a different payload')
    .withRequest(
      'POST',
      ALLOCATE_PATH,
      setJsonContent({
        headers: {
          ...communityHeaders(platform),
          'Idempotency-Key': ALLOCATE_IDEMPOTENCY_KEY,
        },
        body: allocateMismatchedRequestBody,
      })
    )
    .willRespondWith(
      409,
      setJsonContent({
        body: {
          statusCode: like(409),
          message: string(COMMUNITY_IDEMPOTENCY_MISMATCH_MESSAGE),
          error: string('Conflict'),
        },
      })
    )
    .executeTest(async (mockServer: V3MockServer) => {
      // The generated SDK throws on 409, so the request goes out directly.
      const response = await fetch(`${mockServer.url}${ALLOCATE_PATH}`, {
        method: 'POST',
        headers: {
          ...communityHeaders(platform),
          'Idempotency-Key': ALLOCATE_IDEMPOTENCY_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(allocateMismatchedRequestBody),
      })

      expect(response.status).toBe(409)

      const payload = (await response.json()) as Record<string, unknown>
      expect(payload.message).toBe(COMMUNITY_IDEMPOTENCY_MISMATCH_MESSAGE)
      expect(payload.error).toBe('Conflict')
    })
}

// --- Publish ---------------------------------------------------------------

/**
 * `altTextConfirmed` is `z.literal(true)`, so the contract itself rejects an
 * unconfirmed publish.
 *
 * Publishing does NOT publish: it hands the post to moderation, so the returned
 * row is `pending_review` with a null `publishedAt`. A client that rendered it
 * as live would be showing unscreened content, so the status and the null
 * timestamp are both pinned exactly.
 */
export async function verifyPublishCommunityPostInteraction(
  pact: PactV4,
  createClient: CreateClient,
  platform: CommunityPlatform
) {
  await pact
    .addInteraction()
    .given(
      ...createProviderState({
        name: 'A completed community upload is ready to publish',
        params: { userId: pactEventAuth.userId, postId: AUTHOR_PENDING_POST_ID },
      })
    )
    .uponReceiving('a request to publish a community post into moderation')
    .withRequest(
      'POST',
      PUBLISH_PATH,
      setJsonContent({
        headers: {
          ...communityHeaders(platform),
          'Idempotency-Key': PUBLISH_IDEMPOTENCY_KEY,
        },
        body: publishRequestBody,
      })
    )
    .willRespondWith(
      200,
      setJsonContent({
        body: {
          data: {
            id: string(AUTHOR_PENDING_POST_ID),
            caption: like('Three layers and a windproof shell.'),
            altText: like('A person in a grey wool coat over a cream knit.'),
            climateBand: nullValue(),
            imageAccess: {
              url: like(IMAGE_URL),
              expiresAt: isoTimestamp(IMAGE_EXPIRES_AT),
            },
            publishedAt: nullValue(),
            createdAt: isoTimestamp(CREATED_AT),
            status: string('pending_review'),
            challengeId: string(CHALLENGE_ID),
            author: {
              displayName: like('Cobalt Marten'),
              isSelf: like(true),
            },
          },
        },
      })
    )
    .executeTest(async (mockServer: V3MockServer) => {
      const response = await createClient(mockServer).apiV1CommunityPostsPublishPost({
        idempotencyKey: PUBLISH_IDEMPOTENCY_KEY,
        xCouturePlatform: platform,
        publishCommunityPostInput: publishRequestBody,
      })

      // Screening has not run yet, so this row is not live and says so.
      expect(response.data.id).toBe(AUTHOR_PENDING_POST_ID)
      expect(response.data.status).toBe('pending_review')
      expect(response.data.publishedAt).toBeNull()
      // The challenge association is recorded at submission time.
      expect(response.data.challengeId).toBe(CHALLENGE_ID)
      expect(response.data.author.isSelf).toBe(true)
    })
}

/**
 * The publish names both a post and the upload session that filled it. A
 * session belonging to a different post must not be able to finalize this one.
 */
export async function verifyPublishCommunityPostConflictInteraction(
  pact: PactV4,
  platform: CommunityPlatform
) {
  const mismatchedBody = {
    ...publishRequestBody,
    uploadSessionId: 'upload-session-6100-9999',
  }

  await pact
    .addInteraction()
    .given(
      ...createProviderState({
        name: 'The publish upload session does not match the post',
        params: { userId: pactEventAuth.userId, postId: AUTHOR_PENDING_POST_ID },
      })
    )
    .uponReceiving(
      'a request to publish a community post with a mismatched upload session'
    )
    .withRequest(
      'POST',
      PUBLISH_PATH,
      setJsonContent({
        headers: {
          ...communityHeaders(platform),
          'Idempotency-Key': PUBLISH_IDEMPOTENCY_KEY,
        },
        body: mismatchedBody,
      })
    )
    .willRespondWith(
      409,
      setJsonContent({
        body: {
          statusCode: like(409),
          message: string(COMMUNITY_UPLOAD_SESSION_MISMATCH_MESSAGE),
          error: string('Conflict'),
        },
      })
    )
    .executeTest(async (mockServer: V3MockServer) => {
      // The generated SDK throws on 409, so the request goes out directly.
      const response = await fetch(`${mockServer.url}${PUBLISH_PATH}`, {
        method: 'POST',
        headers: {
          ...communityHeaders(platform),
          'Idempotency-Key': PUBLISH_IDEMPOTENCY_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(mismatchedBody),
      })

      expect(response.status).toBe(409)

      const payload = (await response.json()) as Record<string, unknown>
      expect(payload.message).toBe(COMMUNITY_UPLOAD_SESSION_MISMATCH_MESSAGE)
      expect(payload.error).toBe('Conflict')
    })
}

// --- Rate limits -----------------------------------------------------------

/**
 * The write path that answers 429, and the one thing that makes a 429
 * actionable: `Retry-After`.
 *
 * PUBLISH ONLY, AND ALLOCATE DELIBERATELY NOT. The daily cap is enforced inside
 * `CommunityService.publishPost`, through the repository's `publishWithinQuota`,
 * because allocation produces DRAFTS and a draft is free by design: a
 * submission is what counts against the ten. `allocatePost` never constructs a
 * `CommunityRateLimitException` at all (the only two throw sites in the service
 * are `publishPost` and `reportPost`), so an allocate 429 interaction would pin
 * a path that cannot exist, and provider verification would fail forever on a
 * header the handler has no reason to stamp. It is a table with one row because
 * the report abuse limit is a second 429 with a different budget, and this is
 * where a reader will look for the pair.
 *
 * The header is matched by REGEX. The contract types it as `integer,
 * minimum: 1` seconds until the rolling 24-hour window admits another
 * submission, so the honest assertion is "a positive integer count of seconds".
 * Pinning `3600` would demand a constant the provider has no reason to return,
 * and dropping the header would let a 429 ship with no recovery time.
 */
export type CommunityRateLimitInteraction = {
  description: string
  state: string
  path: string
  idempotencyKey: string
  body: unknown
}

export const communityRateLimitInteractions: CommunityRateLimitInteraction[] = [
  {
    description: 'refuses an eleventh publish in the rolling window',
    state: 'The caller has reached the daily community post limit',
    path: PUBLISH_PATH,
    idempotencyKey: PUBLISH_IDEMPOTENCY_KEY,
    body: publishRequestBody,
  },
]

/**
 * `publishPost` is wrapped in `withRetryAfterHeader` so the exception's
 * `retryAfterSeconds` reaches the response.
 */
export async function verifyCommunityRateLimitInteraction(
  pact: PactV4,
  interaction: CommunityRateLimitInteraction,
  platform: CommunityPlatform
) {
  await pact
    .addInteraction()
    .given(
      ...createProviderState({
        name: interaction.state,
        params: { userId: pactEventAuth.userId },
      })
    )
    .uponReceiving(`a community write that ${interaction.description}`)
    .withRequest(
      'POST',
      interaction.path,
      setJsonContent({
        headers: {
          ...communityHeaders(platform),
          'Idempotency-Key': interaction.idempotencyKey,
        },
        body: interaction.body,
      })
    )
    .willRespondWith(
      429,
      setJsonContent({
        headers: { 'Retry-After': regex(/^[1-9][0-9]*$/, '3600') },
        body: {
          statusCode: like(429),
          message: string(COMMUNITY_POST_RATE_LIMITED_MESSAGE),
          error: string('Too Many Requests'),
        },
      })
    )
    .executeTest(async (mockServer: V3MockServer) => {
      // The generated SDK throws on 429, so the request goes out directly.
      const response = await fetch(`${mockServer.url}${interaction.path}`, {
        method: 'POST',
        headers: {
          ...communityHeaders(platform),
          'Idempotency-Key': interaction.idempotencyKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(interaction.body),
      })

      expect(response.status).toBe(429)

      // A refusal with no recovery time is not actionable, so the header is
      // asserted as a positive integer.
      const retryAfter = response.headers.get('retry-after')
      expect(retryAfter).toMatch(/^[1-9][0-9]*$/)
      expect(Number(retryAfter)).toBeGreaterThan(0)

      const payload = (await response.json()) as Record<string, unknown>
      expect(payload.message).toBe(COMMUNITY_POST_RATE_LIMITED_MESSAGE)
      expect(payload.error).toBe('Too Many Requests')
    })
}
