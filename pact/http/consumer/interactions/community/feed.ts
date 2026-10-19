import {
  FEED_PATH,
  PUBLISHED_POST_ID,
  AUTHOR_PENDING_POST_ID,
  WITHDRAWN_POST_ID,
  CONSENT_SUSPENDED_POST_ID,
  MISSING_POST_ID,
  PUBLISHED_AT,
  CREATED_AT,
  IMAGE_EXPIRES_AT,
  IMAGE_URL,
  VIEWER_BAND,
  PAGE_LIMIT,
  AUTO_MODE_CURSOR,
  FOREIGN_MODE_CURSOR,
  FOREIGN_BAND_CURSOR,
  MALFORMED_CURSOR,
  communityHeaders,
  publishedItemBody,
  activeChallengeBody,
} from './fixtures'
import { type PactV4, type V3MockServer } from '@pact-foundation/pact'
import { createProviderState, setJsonContent } from '@seontechnologies/pactjs-utils'
import {
  COMMUNITY_CONSENT_SUSPENDED_MESSAGE,
  COMMUNITY_CURSOR_INVALID_MESSAGE,
  COMMUNITY_POST_NOT_FOUND_MESSAGE,
  type CommunityPlatform,
} from '@couture/api-client/contracts/http'
import { expect } from 'vitest'
import {
  isoTimestamp,
  like,
  nullValue,
  pactEventAuth,
  string,
  type CreateClient,
} from '../shared'

// --- Feed reads ------------------------------------------------------------

/**
 * The default `auto` page: one published row from another author, the caller's
 * own pending row kept out of `items`, and a cursor for the next page.
 */
export async function verifyCommunityFeedInteraction(
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
    .uponReceiving('a request for the auto-mode community feed')
    .withRequest(
      'GET',
      FEED_PATH,
      setJsonContent({
        headers: communityHeaders(platform),
        query: { mode: 'auto', limit: String(PAGE_LIMIT) },
      })
    )
    .willRespondWith(
      200,
      setJsonContent({
        body: {
          data: {
            items: [publishedItemBody()],
            authorStates: [
              {
                id: string(AUTHOR_PENDING_POST_ID),
                caption: like('Waiting on screening.'),
                altText: like('A person in a red rain shell.'),
                climateBand: nullValue(),
                imageAccess: {
                  url: like(IMAGE_URL),
                  expiresAt: isoTimestamp(IMAGE_EXPIRES_AT),
                },
                createdAt: isoTimestamp(CREATED_AT),
                publishedAt: nullValue(),
                status: string('pending_review'),
                challengeId: nullValue(),
                moderationReason: nullValue(),
              },
            ],
            nextCursor: string(AUTO_MODE_CURSOR),
            mode: string('auto'),
            viewerBand: string(VIEWER_BAND),
            bandResolved: like(true),
            bandUnresolvedReason: nullValue(),
            experimentVariant: string('auto'),
            activeChallenge: activeChallengeBody(),
          },
        },
      })
    )
    .executeTest(async (mockServer: V3MockServer) => {
      const response = await createClient(mockServer).apiV1CommunityFeedGet({
        xCouturePlatform: platform,
        mode: 'auto',
        limit: PAGE_LIMIT,
      })

      expect(response.data.mode).toBe('auto')
      expect(response.data.viewerBand).toBe(VIEWER_BAND)
      expect(response.data.bandResolved).toBe(true)
      expect(response.data.bandUnresolvedReason).toBeNull()
      expect(response.data.items).toHaveLength(1)

      // The whole projection, key by key: a field renamed or dropped from the
      // feed envelope fails here.
      //
      // Read the limit of this honestly. These keys come off the object the
      // GENERATED SDK built, and `FromJSON` copies only the fields the model
      // declares, so an extra field the API actually served is discarded before
      // it reaches this assertion. Pact does not close that gap either:
      // response-body matching treats the expected body as a subset, so an
      // extra key verifies clean. What stops a leak is
      // `communityFeedResponseSchema.parse` in `CommunityController`, which is
      // `.strict()` and turns an unknown key into a failure, plus a raw-body
      // assertion at the Playwright API tier. This assertion pins the SHAPE. It
      // is not a proof of non-leakage, and no contract test can be one.
      expect(Object.keys(response.data).sort()).toEqual([
        'activeChallenge',
        'authorStates',
        'bandResolved',
        'bandUnresolvedReason',
        'experimentVariant',
        'items',
        'mode',
        'nextCursor',
        'viewerBand',
      ])

      // Pseudonymity: the author object is exactly two fields, neither an id,
      // and the public row carries no author identifier anywhere in it.
      const [item] = response.data.items
      expect(item).toBeDefined()
      expect(Object.keys(item!).sort()).toEqual([
        'altText',
        'author',
        'caption',
        'challengeId',
        'climateBand',
        'createdAt',
        'id',
        'imageAccess',
        'publishedAt',
        'status',
      ])
      expect(Object.keys(item!.author).sort()).toEqual(['displayName', 'isSelf'])
      expect(item!.author.isSelf).toBe(false)
      expect(JSON.stringify(item)).not.toContain(pactEventAuth.userId)
      // The signed URL has exactly one home. `imageUrl` was removed from the
      // contract and must not come back as a second copy.
      expect(item).not.toHaveProperty('imageUrl')
      expect(item).not.toHaveProperty('imageObjectPath')
      expect(item!.imageAccess.url).toBe(IMAGE_URL)

      expect(response.data.items.map((row) => row.id)).not.toContain(
        AUTHOR_PENDING_POST_ID
      )
      expect(response.data.authorStates).toHaveLength(1)
      expect(Object.keys(response.data.authorStates[0]!).sort()).toEqual([
        'altText',
        'caption',
        'challengeId',
        'climateBand',
        'createdAt',
        'id',
        'imageAccess',
        'moderationReason',
        'publishedAt',
        'status',
      ])
      expect(response.data.authorStates[0]!.status).toBe('pending_review')
      expect(response.data.authorStates[0]!.publishedAt).toBeNull()

      expect(response.data.nextCursor).toBe(AUTO_MODE_CURSOR)
    })
}

/**
 * The degraded branch the spec requires: too few usable weather days to
 * classify a band returns every region with a stated reason, so the client can
 * render a localized banner over a feed that still has content.
 */
export async function verifyCommunityFeedBandUnresolvedInteraction(
  pact: PactV4,
  createClient: CreateClient,
  platform: CommunityPlatform
) {
  await pact
    .addInteraction()
    .given(
      ...createProviderState({
        name: 'The viewer climate band cannot be resolved',
        params: { userId: pactEventAuth.userId },
      })
    )
    .uponReceiving('a request for the all-region community feed with no resolved band')
    .withRequest(
      'GET',
      FEED_PATH,
      setJsonContent({
        headers: communityHeaders(platform),
        query: { mode: 'all', limit: String(PAGE_LIMIT) },
      })
    )
    .willRespondWith(
      200,
      setJsonContent({
        body: {
          data: {
            items: [publishedItemBody()],
            authorStates: [],
            nextCursor: nullValue(),
            mode: string('all'),
            viewerBand: nullValue(),
            bandResolved: like(false),
            bandUnresolvedReason: string('insufficient_usable_days'),
            experimentVariant: string('all'),
            activeChallenge: nullValue(),
          },
        },
      })
    )
    .executeTest(async (mockServer: V3MockServer) => {
      const response = await createClient(mockServer).apiV1CommunityFeedGet({
        xCouturePlatform: platform,
        mode: 'all',
        limit: PAGE_LIMIT,
      })

      expect(response.data.mode).toBe('all')
      expect(response.data.viewerBand).toBeNull()
      expect(response.data.bandResolved).toBe(false)
      expect(response.data.bandUnresolvedReason).toBe('insufficient_usable_days')
      // An unresolved band still serves content.
      expect(response.data.items).toHaveLength(1)
      expect(response.data.nextCursor).toBeNull()
      expect(response.data.activeChallenge).toBeNull()
    })
}

/**
 * The removed-content projection: a withdrawn post and a consent-suspended post
 * are both absent from `items` and both present in the author's own
 * `authorStates` with `imageAccess: null`, because a takedown moves or deletes
 * the stored object. The client renders its localized notice from `status` plus
 * the absent image, so both must be observable on the wire.
 */
export async function verifyCommunityFeedRemovedContentInteraction(
  pact: PactV4,
  createClient: CreateClient,
  platform: CommunityPlatform
) {
  await pact
    .addInteraction()
    .given(
      ...createProviderState({
        name: 'The author has withdrawn and consent-suspended posts',
        params: { userId: pactEventAuth.userId },
      })
    )
    .uponReceiving('a request for a community feed carrying removed author content')
    .withRequest(
      'GET',
      FEED_PATH,
      setJsonContent({
        headers: communityHeaders(platform),
        query: { mode: 'auto', limit: String(PAGE_LIMIT) },
      })
    )
    .willRespondWith(
      200,
      setJsonContent({
        body: {
          data: {
            items: [],
            authorStates: [
              {
                id: string(WITHDRAWN_POST_ID),
                caption: nullValue(),
                altText: nullValue(),
                climateBand: string(VIEWER_BAND),
                imageAccess: nullValue(),
                createdAt: isoTimestamp(CREATED_AT),
                publishedAt: isoTimestamp(PUBLISHED_AT),
                status: string('withdrawn'),
                challengeId: nullValue(),
                moderationReason: nullValue(),
              },
              {
                id: string(CONSENT_SUSPENDED_POST_ID),
                caption: nullValue(),
                altText: nullValue(),
                climateBand: string(VIEWER_BAND),
                imageAccess: nullValue(),
                createdAt: isoTimestamp(CREATED_AT),
                publishedAt: isoTimestamp(PUBLISHED_AT),
                status: string('consent_suspended'),
                challengeId: nullValue(),
                moderationReason: string(COMMUNITY_CONSENT_SUSPENDED_MESSAGE),
              },
            ],
            nextCursor: nullValue(),
            mode: string('auto'),
            viewerBand: string(VIEWER_BAND),
            bandResolved: like(true),
            bandUnresolvedReason: nullValue(),
            experimentVariant: string('auto'),
            activeChallenge: nullValue(),
          },
        },
      })
    )
    .executeTest(async (mockServer: V3MockServer) => {
      const response = await createClient(mockServer).apiV1CommunityFeedGet({
        xCouturePlatform: platform,
        mode: 'auto',
        limit: PAGE_LIMIT,
      })

      // Removed content is never served publicly.
      expect(response.data.items).toHaveLength(0)
      expect(response.data.authorStates).toHaveLength(2)

      const withdrawn = response.data.authorStates.find(
        (row) => row.id === WITHDRAWN_POST_ID
      )
      const suspended = response.data.authorStates.find(
        (row) => row.id === CONSENT_SUSPENDED_POST_ID
      )
      expect(withdrawn?.status).toBe('withdrawn')
      expect(withdrawn?.imageAccess).toBeNull()
      expect(suspended?.status).toBe('consent_suspended')
      expect(suspended?.imageAccess).toBeNull()
      expect(suspended?.moderationReason).toBe(COMMUNITY_CONSENT_SUSPENDED_MESSAGE)
    })
}

/**
 * The three feed rejections that share one status and one path. An unknown
 * `mode` fails `communityFeedQuerySchema` in the controller; both cursor
 * failures come out of `safeDecodeCommunityFeedCursor`. A client sees one
 * outcome, and that is what the table records.
 *
 * `message` is pinned exactly for the cursor rows, since
 * `COMMUNITY_CURSOR_INVALID_MESSAGE` is a contract constant both clients branch
 * on. The unknown-mode row's message is Zod's own enum-rejection text joined by
 * the controller, a formatting detail of a library, so that row pins the status
 * and the error label and matches the message by type.
 */
export type CommunityFeedRejection = {
  description: string
  state: string
  query: Record<string, string>
  /** `undefined` where the message is Zod's, not the contract's. */
  message?: string
}

export const communityFeedRejections: CommunityFeedRejection[] = [
  {
    description: 'rejects a feed request for an unknown mode',
    state: 'The community feed is readable',
    query: { mode: 'blizzard', limit: String(PAGE_LIMIT) },
  },
  {
    description: 'rejects a malformed pagination cursor',
    state: 'The community feed is readable',
    query: { mode: 'auto', limit: String(PAGE_LIMIT), cursor: MALFORMED_CURSOR },
    message: COMMUNITY_CURSOR_INVALID_MESSAGE,
  },
  {
    description: 'rejects a cursor minted under a different filter mode',
    state: 'The community feed is readable',
    query: { mode: 'auto', limit: String(PAGE_LIMIT), cursor: FOREIGN_MODE_CURSOR },
    // The SAME message as the row above, and that identity is the assertion: a
    // client that changed filters cannot tell a corrupt cursor from one
    // belonging to another filter, and in either case restarts paging.
    message: COMMUNITY_CURSOR_INVALID_MESSAGE,
  },
  {
    description: 'rejects a cursor whose band no longer matches the viewer',
    state: 'The community feed is readable',
    query: { mode: 'auto', limit: String(PAGE_LIMIT), cursor: FOREIGN_BAND_CURSOR },
    // Under `auto` the band is recomputed per request from weather that is only
    // guaranteed fresh for 60 minutes. A viewer whose band moves mid-scroll must
    // restart paging rather than apply page one's keyset to a different filtered
    // set, and this is the row that proves the band half of the binding.
    message: COMMUNITY_CURSOR_INVALID_MESSAGE,
  },
]

export async function verifyCommunityFeedRejectionInteraction(
  pact: PactV4,
  rejection: CommunityFeedRejection,
  platform: CommunityPlatform
) {
  const search = new URLSearchParams(rejection.query).toString()

  await pact
    .addInteraction()
    .given(
      ...createProviderState({
        name: rejection.state,
        params: { userId: pactEventAuth.userId },
      })
    )
    .uponReceiving(`a community feed request that ${rejection.description}`)
    .withRequest(
      'GET',
      FEED_PATH,
      setJsonContent({
        headers: communityHeaders(platform),
        query: rejection.query,
      })
    )
    .willRespondWith(
      400,
      setJsonContent({
        body: {
          statusCode: like(400),
          message:
            rejection.message === undefined
              ? like('Invalid feed request.')
              : string(rejection.message),
          error: string('Bad Request'),
        },
      })
    )
    .executeTest(async (mockServer: V3MockServer) => {
      // The generated SDK throws on non-2xx, and its `mode` parameter is typed
      // to the enum, so an unknown mode cannot be expressed through it at all.
      // Error interactions drive the mock server with raw `fetch`.
      const response = await fetch(`${mockServer.url}${FEED_PATH}?${search}`, {
        method: 'GET',
        headers: communityHeaders(platform),
      })

      expect(response.status).toBe(400)

      const payload = (await response.json()) as Record<string, unknown>
      expect(payload.error).toBe('Bad Request')
      expect(typeof payload.message).toBe('string')
      if (rejection.message !== undefined) {
        expect(payload.message).toBe(rejection.message)
      }
    })
}

// --- Single post read ------------------------------------------------------

/**
 * A deep link serves the SAME projection the feed serves, so it cannot become a
 * second, looser view of a post. The route exists for the two client races the
 * spec names: a deep link that lands outside the first feed page, and polling
 * an owned post until it reaches a terminal moderation state.
 */
export async function verifyCommunityPostInteraction(
  pact: PactV4,
  createClient: CreateClient,
  platform: CommunityPlatform
) {
  await pact
    .addInteraction()
    .given(
      ...createProviderState({
        name: 'A published community post is visible to the caller',
        params: { userId: pactEventAuth.userId, postId: PUBLISHED_POST_ID },
      })
    )
    .uponReceiving('a request to resolve one visible community post directly')
    .withRequest(
      'GET',
      `/api/v1/community/posts/${PUBLISHED_POST_ID}`,
      setJsonContent({ headers: communityHeaders(platform) })
    )
    .willRespondWith(200, setJsonContent({ body: { data: publishedItemBody() } }))
    .executeTest(async (mockServer: V3MockServer) => {
      const response = await createClient(mockServer).apiV1CommunityPostsPostIdGet({
        postId: PUBLISHED_POST_ID,
        xCouturePlatform: platform,
      })

      expect(response.data.id).toBe(PUBLISHED_POST_ID)
      expect(response.data.status).toBe('published')
      expect(response.data.publishedAt).toBe(PUBLISHED_AT)
      // The deep-link projection is the feed projection, pseudonymity included.
      expect(Object.keys(response.data.author).sort()).toEqual(['displayName', 'isSelf'])
      expect(response.data).not.toHaveProperty('imageUrl')
    })
}

/**
 * 404 covers BOTH "no such post" and "exists but not visible to this caller",
 * deliberately: distinguishing them would let a caller probe for the existence
 * of another author's unpublished rows.
 */
export async function verifyCommunityPostNotFoundInteraction(
  pact: PactV4,
  platform: CommunityPlatform
) {
  await pact
    .addInteraction()
    .given(
      ...createProviderState({
        name: 'The requested community post is not visible to the caller',
        params: { userId: pactEventAuth.userId, postId: MISSING_POST_ID },
      })
    )
    .uponReceiving('a request to resolve a community post the caller cannot see')
    .withRequest(
      'GET',
      `/api/v1/community/posts/${MISSING_POST_ID}`,
      setJsonContent({ headers: communityHeaders(platform) })
    )
    .willRespondWith(
      404,
      setJsonContent({
        body: {
          statusCode: like(404),
          message: string(COMMUNITY_POST_NOT_FOUND_MESSAGE),
          error: string('Not Found'),
        },
      })
    )
    .executeTest(async (mockServer: V3MockServer) => {
      // The generated SDK throws on 404, so the request goes out directly.
      const response = await fetch(
        `${mockServer.url}/api/v1/community/posts/${MISSING_POST_ID}`,
        { method: 'GET', headers: communityHeaders(platform) }
      )

      expect(response.status).toBe(404)

      const payload = (await response.json()) as Record<string, unknown>
      expect(payload.message).toBe(COMMUNITY_POST_NOT_FOUND_MESSAGE)
      expect(payload.error).toBe('Not Found')
    })
}
