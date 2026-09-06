// Learning path Step 38: Community feed by climate band.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-38-community-feed-by-climate-band
// Story 6.1 community feed by climate band.
import type { PactV4, V3MockServer } from '@pact-foundation/pact'
import { createProviderState, setJsonContent } from '@seontechnologies/pactjs-utils'
import {
  COMMUNITY_CHALLENGE_OVERLAP_MESSAGE,
  COMMUNITY_CHALLENGE_WINDOW_INVALID_MESSAGE,
  COMMUNITY_CONSENT_SUSPENDED_MESSAGE,
  COMMUNITY_CURSOR_INVALID_MESSAGE,
  COMMUNITY_IDEMPOTENCY_MISMATCH_MESSAGE,
  COMMUNITY_POST_NOT_FOUND_MESSAGE,
  COMMUNITY_POST_RATE_LIMITED_MESSAGE,
  COMMUNITY_REPORT_REASON_CHANGED_MESSAGE,
  COMMUNITY_SELF_REPORT_MESSAGE,
  COMMUNITY_UPLOAD_SESSION_MISMATCH_MESSAGE,
  encodeCommunityFeedCursor,
  type CommunityPlatform,
} from '@couture/api-client/contracts/http'
import { expect } from 'vitest'
import {
  isoTimestamp,
  like,
  nullValue,
  pactAdminAuth,
  pactAdminHeaders,
  pactEventAuth,
  pactEventHeaders,
  regex,
  string,
  type CreateClient,
} from './shared'

/* ---------------------------------------------------------------------------
 * Story 6.1 community feed by climate band.
 *
 * WHAT THIS MODULE PINS. Eight operations share one `/api/v1/community`
 * controller, and three properties of that surface are only observable on the
 * wire, which is what makes them contract tests rather than service tests:
 *
 * 1. PSEUDONYMITY. `communityFeedItemSchema` is `.strict()` and carries an
 *    `author` of exactly `{ displayName, isSelf }`. There is no author user id,
 *    no storage object path, and -- since the contract dropped `imageUrl` --
 *    exactly one copy of the signed URL, inside `imageAccess`. A field added
 *    back on the provider side breaks these interactions rather than leaking
 *    quietly, which is the whole point of writing them here.
 * 2. CURSOR/MODE BINDING. The public cursor is `{ publishedAt, id, mode }`
 *    base64url-encoded, and it is bound to the mode it was minted under.
 *    Three distinct 400s therefore share one message
 *    (`COMMUNITY_CURSOR_INVALID_MESSAGE`): a malformed cursor, and a
 *    well-formed cursor replayed under a different mode. A client that changes
 *    filters simply restarts paging, and cannot tell those cases apart -- that
 *    indistinguishability is itself the contract.
 * 3. THE AUTHOR'S OWN NON-PUBLISHED ROWS travel in `authorStates`, never in
 *    `items`. They have no `published_at` to keyset on, so mixing them into the
 *    paged list would perturb page boundaries and consume the page limit.
 *
 * PLATFORM IS A PARAMETER, NOT A CONSTANT. Every community operation requires
 * `x-couture-platform`, and it is the one header whose value genuinely differs
 * between the two consumers. `interactions/planner.ts` hardcoded `'web'` into
 * both pacts; here `web-api-client.pacttest.ts` passes `'web'` and
 * `mobile-api-client.pacttest.ts` passes `'mobile'`, so the mobile pact records
 * what mobile actually sends. It stays deterministic because each consumer file
 * passes one literal.
 *
 * ONE INTERACTION PER EXPORTED FUNCTION. PactV4's Rust FFI drops an interaction
 * non-deterministically when more than one `addInteraction()...executeTest()`
 * chain is awaited in a single test body, and `scripts/check-pact-determinism.sh`
 * runs this suite three times and compares pact hashes. Every function below is
 * called from its own `it()`.
 *
 * NO COMPUTED VALUES. Every id, date and window boundary below is a literal.
 * The two cursors are the single exception and are safe: they are
 * `encodeCommunityFeedCursor` -- a pure base64url encode of the literals above
 * them, evaluated once at module load -- so all three determinism runs produce
 * the same bytes. Writing the base64 by hand would have hidden which payload it
 * encodes, and would not have caught a change to the cursor codec.
 *
 * NO CACHE-CONTROL ASSERTIONS, unlike `interactions/planner.ts`.
 * `CommerceCacheHeadersMiddleware` is applied by `CommerceModule.configure`
 * over the `/api/v1/commerce` prefix only; `CommunityModule` applies no
 * middleware, so there is no cache header on this surface to pin.
 *
 * Every identifier, date and message below is mirrored in
 * `pact/http/provider/doubles/community.ts`. Both sides must agree or the
 * pinned `string()` matchers fail verification.
 * ------------------------------------------------------------------------- */

// --- Fixtures, all literal -------------------------------------------------

const FEED_PATH = '/api/v1/community/feed'
const ALLOCATE_PATH = '/api/v1/community/posts/allocate'
const PUBLISH_PATH = '/api/v1/community/posts/publish'
const CHALLENGES_PATH = '/api/v1/community/challenges'

const PUBLISHED_POST_ID = 'post-6100-published-0001'
const AUTHOR_PENDING_POST_ID = 'post-6100-pending-0002'
const WITHDRAWN_POST_ID = 'post-6100-withdrawn-0003'
const CONSENT_SUSPENDED_POST_ID = 'post-6100-suspended-0004'
const MISSING_POST_ID = 'post-6100-missing-0005'
const REPORTED_POST_ID = 'post-6100-reported-0006'
const OWN_POST_ID = 'post-6100-own-0007'

const CHALLENGE_ID = 'challenge-6100-0001'
const UPLOAD_SESSION_ID = 'upload-session-6100-0001'

/** Fixed uuids: the contract types both idempotency keys as `format: uuid`. */
const ALLOCATE_IDEMPOTENCY_KEY = '8c1f2a6d-3b45-4e7a-9c02-1d5e6f708a91'
const PUBLISH_IDEMPOTENCY_KEY = 'b47ac10b-58cc-4372-a567-0e02b2c3d479'

const PUBLISHED_AT = '2026-09-01T12:00:00.000Z'
const CREATED_AT = '2026-09-01T11:30:00.000Z'
const IMAGE_EXPIRES_AT = '2026-09-01T13:00:00.000Z'
const UPLOAD_EXPIRES_AT = '2026-09-01T11:45:00.000Z'
const IMAGE_URL =
  'https://storage.couturecast.test/community/posts/6100/published-0001.jpg'
const UPLOAD_URL = 'https://storage.couturecast.test/community/uploads/6100/session-0001'

const VIEWER_BAND = 'temperate_dry' as const
const LOCALE = 'en-US' as const
const PAGE_LIMIT = 12

/**
 * The public cursor for the last item of page one under `mode=auto`, and the
 * same keyset minted under `mode=all`. Presenting the second one while asking
 * for `mode=auto` is the "cursor bound to its filter" rejection.
 */
const AUTO_MODE_CURSOR = encodeCommunityFeedCursor({
  publishedAt: PUBLISHED_AT,
  id: PUBLISHED_POST_ID,
  mode: 'auto',
})
const ALL_MODE_CURSOR = encodeCommunityFeedCursor({
  publishedAt: PUBLISHED_AT,
  id: PUBLISHED_POST_ID,
  mode: 'all',
})
const MALFORMED_CURSOR = 'not-a-base64url-cursor'

/**
 * The challenge window, deliberately chosen so UTC and the window's own zone
 * DISAGREE about the weekday.
 *
 * `2026-09-06T12:00Z` is a SUNDAY in UTC and a MONDAY in `Pacific/Auckland`, so
 * a window anchored there is valid only if the rule is evaluated in the zone the
 * request names. A fixture that used a UTC Monday would pass just as happily
 * against an implementation that ignored `timeZone` entirely and did UTC
 * arithmetic, which is the exact degradation these dates exist to prevent.
 */
const CHALLENGE_TIME_ZONE = 'Pacific/Auckland' as const
const CHALLENGE_STARTS_AT = '2026-09-06T12:00:00.000Z'
const CHALLENGE_ENDS_AT = '2026-09-13T12:00:00.000Z'

/** Same Monday-in-Auckland start, an eight-day span: exactly one issue fires. */
const CHALLENGE_WRONG_SPAN_ENDS_AT = '2026-09-14T12:00:00.000Z'

/**
 * `2026-09-07T12:00Z` is a MONDAY in UTC and a TUESDAY in `Pacific/Auckland`,
 * the mirror image of the valid fixture: the span is exactly seven days, so the
 * only issue is the weekday, and it can only be detected in the named zone.
 */
const CHALLENGE_NON_MONDAY_STARTS_AT = '2026-09-07T12:00:00.000Z'
const CHALLENGE_NON_MONDAY_ENDS_AT = '2026-09-14T12:00:00.000Z'

/**
 * A zone the host tz database does not know. This row exists because the two
 * validations take DIFFERENT paths: `ianaTimeZoneSchema`'s field-level
 * `.refine()` rejects the zone, while the Monday and seven-day rules live in the
 * object-level `superRefine`. Zod marks a failed field refine dirty rather than
 * aborted, so the object refinement still runs -- which is how an unknown zone
 * reached `Intl.DateTimeFormat` and surfaced as a 500 instead of a 400. Only one
 * of these two paths was ever exercised before, so both are recorded here.
 */
const CHALLENGE_INVALID_TIME_ZONE = 'Mars/Olympus_Mons'

/**
 * The message `ianaTimeZoneSchema`'s refine carries in
 * `packages/api-client/src/contracts/http/community.ts`. Unlike the window
 * message it is not an exported constant, so it is repeated here rather than
 * imported; the interaction matches it as a SUBSTRING, because the controller
 * joins every Zod issue with '; ' and a request that trips the zone rule may
 * legitimately report a second issue alongside it.
 */
const IANA_TIME_ZONE_INVALID_MESSAGE = 'Time zone must be a valid IANA zone identifier.'

const CHALLENGE_SLUG = 'layered-mondays'

/** Not `as const`: `CommunityChallengeCopy` is a mutable record, and readonly
 * properties are not assignable to it. */
const CHALLENGE_COPY = {
  'en-US': {
    title: 'Layered Mondays',
    body: 'Show the layers that got you through a temperate, dry week.',
  },
}

// --- Shared body builders --------------------------------------------------

function communityHeaders(platform: CommunityPlatform) {
  return { ...pactEventHeaders, 'x-couture-platform': platform }
}

/**
 * One published feed row as matchers.
 *
 * `author` is the pseudonymity assertion: exactly `displayName` and `isSelf`,
 * with no user id anywhere in the object, and the signed URL present only
 * under `imageAccess`.
 */
function publishedItemBody() {
  return {
    id: string(PUBLISHED_POST_ID),
    caption: like('Three layers and a windproof shell.'),
    altText: like('A person in a grey wool coat over a cream knit.'),
    climateBand: string(VIEWER_BAND),
    imageAccess: {
      url: like(IMAGE_URL),
      expiresAt: isoTimestamp(IMAGE_EXPIRES_AT),
    },
    publishedAt: isoTimestamp(PUBLISHED_AT),
    createdAt: isoTimestamp(CREATED_AT),
    status: string('published'),
    challengeId: string(CHALLENGE_ID),
    author: {
      displayName: like('Cobalt Marten'),
      isSelf: like(false),
    },
  }
}

function activeChallengeBody() {
  return {
    id: string(CHALLENGE_ID),
    slug: string(CHALLENGE_SLUG),
    climateBand: string(VIEWER_BAND),
    title: like(CHALLENGE_COPY['en-US'].title),
    body: like(CHALLENGE_COPY['en-US'].body),
    startsAt: isoTimestamp(CHALLENGE_STARTS_AT),
    endsAt: isoTimestamp(CHALLENGE_ENDS_AT),
    timeZone: string(CHALLENGE_TIME_ZONE),
  }
}

const allocateRequestBody = {
  locale: LOCALE,
  contentType: 'image/jpeg' as const,
  byteSize: 482_119,
  sha256: 'd2c8a3f16b0e47a95c3d81f0b6e27a4c9d5e0f3a1b7c8d9e0f1a2b3c4d5e6f70',
  widthPx: 1080,
  heightPx: 1350,
}

/** Same key, different bytes: the mismatched-replay 409. */
const allocateMismatchedRequestBody = {
  ...allocateRequestBody,
  byteSize: 999_001,
  sha256: 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90',
}

const publishRequestBody = {
  postId: AUTHOR_PENDING_POST_ID,
  uploadSessionId: UPLOAD_SESSION_ID,
  altText: 'A person in a grey wool coat over a cream knit.',
  altTextConfirmed: true as const,
  caption: 'Three layers and a windproof shell.',
  locale: LOCALE,
  challengeId: CHALLENGE_ID,
}

// --- Feed reads ------------------------------------------------------------

/**
 * Provider endpoint: /api/v1/community/feed -> GET CommunityController.getFeed
 *
 * Provider Scrutiny Evidence:
 * - Handler: apps/api/src/modules/community/community.controller.ts (getFeed)
 * - Response type: CommunityFeedResponse ({ data: { items, authorStates,
 *   nextCursor, mode, viewerBand, bandResolved, bandUnresolvedReason,
 *   experimentVariant, activeChallenge } })
 * - Status codes: 200
 * - Field names: `.strict()` on every object in `communityFeedResponseSchema`;
 *   `communityFeedItemSchema` carries no `imageUrl` and no author user id
 * - Ordering: `published_at desc, id desc`, and `nextCursor` encodes that
 *   keyset together with the mode it was minted under
 *
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

      // THE WHOLE PROJECTION, KEY BY KEY, not a spot check. A field renamed or
      // dropped from the feed envelope fails here instead of being missed
      // because no assertion happened to name it.
      //
      // Read the limit of this honestly: these keys come off the object the
      // GENERATED SDK built, and `FromJSON` copies only the fields the model
      // declares, so an extra field the API actually served would be discarded
      // before it reached this assertion. Pact does not close that gap either --
      // response-body matching treats the expected body as a subset, so an
      // extra key verifies clean. What DOES stop a leak is
      // `communityFeedResponseSchema.parse` in `CommunityController`, which is
      // `.strict()` and turns an unknown key into a failure rather than a leak,
      // plus a raw-body assertion at the Playwright API tier. This assertion
      // pins the shape; it is not a proof of non-leakage, and no contract test
      // can be one.
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

      // Pseudonymity: the author object is exactly two fields and neither is an
      // id, and the public row carries no author identifier anywhere in it.
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
      // The signed URL has exactly one home; `imageUrl` was removed from the
      // contract and must not come back as a second copy.
      expect(item).not.toHaveProperty('imageUrl')
      expect(item).not.toHaveProperty('imageObjectPath')
      expect(item!.imageAccess.url).toBe(IMAGE_URL)

      // The author's own non-published row travels beside the page, never in it.
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

      // The cursor the client will send back is the one minted for this mode.
      expect(response.data.nextCursor).toBe(AUTO_MODE_CURSOR)
    })
}

/**
 * Provider endpoint: /api/v1/community/feed -> GET CommunityController.getFeed
 *
 * Provider Scrutiny Evidence: same handler and response type as
 * {@link verifyCommunityFeedInteraction}. What this row records instead is the
 * degraded branch the spec requires: too few usable weather days to classify a
 * band returns every region with a stated reason rather than an error, so the
 * client can render a localized banner over a feed that still has content.
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
      // Unresolved is a degraded read, not an empty one.
      expect(response.data.items).toHaveLength(1)
      expect(response.data.nextCursor).toBeNull()
      expect(response.data.activeChallenge).toBeNull()
    })
}

/**
 * Provider endpoint: /api/v1/community/feed -> GET CommunityController.getFeed
 *
 * Provider Scrutiny Evidence: same handler and response type as
 * {@link verifyCommunityFeedInteraction}. This is the removed-content
 * projection: a withdrawn post and a consent-suspended post are both absent
 * from `items` and both present in the author's own `authorStates` with
 * `imageAccess: null`, because a takedown moves or deletes the stored object.
 * The client renders its localized notice from `status` plus the absent image,
 * which is why both must be observable on the wire.
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

      // Removed content is never served publicly, in either direction.
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
 * The three feed rejections that share one status and one path.
 *
 * `mode` and `cursor` are validated in different places -- an unknown `mode`
 * fails `communityFeedQuerySchema` in the controller, while both cursor
 * failures come out of `safeDecodeCommunityFeedCursor` -- but a client sees one
 * outcome, and that is what the table records. The two cursor rows carry the
 * SAME message on purpose: a client that changed filters must not be able to
 * distinguish "your cursor is corrupt" from "your cursor belongs to another
 * filter", because in both cases its only correct move is to restart paging.
 *
 * `message` is pinned exactly for the cursor rows, since
 * `COMMUNITY_CURSOR_INVALID_MESSAGE` is a contract constant both clients branch
 * on. The unknown-mode row's message is Zod's own enum-rejection text joined by
 * the controller, which is a formatting detail of a library rather than
 * anything this contract promises, so that row pins the status and the error
 * label and matches the message by type.
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
    query: { mode: 'auto', limit: String(PAGE_LIMIT), cursor: ALL_MODE_CURSOR },
    // The SAME message as the row above, and that identity is the assertion:
    // a client that changed filters must not be able to tell a corrupt cursor
    // from one belonging to another filter, because its only correct move in
    // either case is to restart paging.
    message: COMMUNITY_CURSOR_INVALID_MESSAGE,
  },
]

/**
 * Provider endpoint: /api/v1/community/feed -> GET CommunityController.getFeed
 *
 * Provider Scrutiny Evidence:
 * - Handler: apps/api/src/modules/community/community.controller.ts (getFeed)
 * - Response type: the shared HTTP error envelope, `.strict()` over exactly
 *   `{ statusCode, message, error }`
 * - Status codes: 400 from `communityFeedQuerySchema` (unknown mode) and from
 *   `safeDecodeCommunityFeedCursor` (malformed cursor, or a cursor whose
 *   embedded `mode` differs from the requested one)
 */
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
      // The generated SDK throws on 400, and its `mode` parameter is typed to
      // the enum, so an unknown mode cannot be expressed through it at all.
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
 * Provider endpoint: /api/v1/community/posts/{postId} ->
 * GET CommunityController.getPost
 *
 * Provider Scrutiny Evidence:
 * - Handler: apps/api/src/modules/community/community.controller.ts (getPost)
 * - Response type: CommunityPostResponse ({ data: CommunityFeedItem }) -- the
 *   SAME projection the feed serves, so a deep link cannot become a second,
 *   looser view of a post
 * - Status codes: 200
 *
 * This route exists for the two client races the spec names: a deep link that
 * lands outside the first feed page, and polling an owned post until it reaches
 * a terminal moderation state.
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
 * Provider endpoint: /api/v1/community/posts/{postId} ->
 * GET CommunityController.getPost
 *
 * Provider Scrutiny Evidence: same handler as
 * {@link verifyCommunityPostInteraction}; response type is the shared error
 * envelope. Status 404 covers BOTH "no such post" and "exists but not visible
 * to this caller", deliberately: distinguishing them would let a caller probe
 * for the existence of another author's unpublished rows.
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

// --- Upload allocation -----------------------------------------------------

/**
 * Provider endpoint: /api/v1/community/posts/allocate ->
 * POST CommunityController.allocatePost
 *
 * Provider Scrutiny Evidence:
 * - Handler: apps/api/src/modules/community/community.controller.ts (allocatePost)
 * - Response type: AllocateCommunityPostResponse
 *   ({ data: AllocateCommunityPostSession })
 * - Status codes: 200 (`@HttpCode(200)`, not the Nest POST default 201)
 * - Field names: `.strict()`; `altTextSuggestion` and `altTextSuggestionLocale`
 *   come back with the session, in the locale the caller asked for
 *
 * The suggestion is a starting point and never a default: publishing rejects
 * unconfirmed alt text, so the pair of fields here is what the author edits and
 * then confirms.
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
      // never asked to confirm alt text written in a language they did not ask
      // for. No user id appears in the upload URL or token.
      expect(response.data.altTextSuggestionLocale).toBe(LOCALE)
      expect(response.data.altTextSuggestion.length).toBeGreaterThan(0)
      expect(response.data.uploadUrl).not.toContain(pactEventAuth.userId)
      expect(response.data.uploadToken).not.toContain(pactEventAuth.userId)
    })
}

/**
 * Provider endpoint: /api/v1/community/posts/allocate ->
 * POST CommunityController.allocatePost
 *
 * Provider Scrutiny Evidence: same handler and response type as
 * {@link verifyAllocateCommunityPostInteraction}. What this row records is that
 * a retried allocate with the SAME key and the SAME payload replays the
 * original session rather than stranding a second upload -- so a client that
 * lost the response to a network drop recovers by repeating the call.
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

      // A replay is the ORIGINAL session, not a new one: same post, same
      // session id. A second row would strand the first upload.
      expect(response.data.postId).toBe(AUTHOR_PENDING_POST_ID)
      expect(response.data.uploadSessionId).toBe(UPLOAD_SESSION_ID)
    })
}

/**
 * Provider endpoint: /api/v1/community/posts/allocate ->
 * POST CommunityController.allocatePost
 *
 * Provider Scrutiny Evidence: same handler as
 * {@link verifyAllocateCommunityPostInteraction}; response type is the shared
 * error envelope. Status 409 with
 * `COMMUNITY_IDEMPOTENCY_MISMATCH_MESSAGE`: the key is a promise about a
 * payload, so reusing it for different bytes is a client bug the server must
 * name rather than silently serve the first session for.
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
 * Provider endpoint: /api/v1/community/posts/publish ->
 * POST CommunityController.publishPost
 *
 * Provider Scrutiny Evidence:
 * - Handler: apps/api/src/modules/community/community.controller.ts (publishPost)
 * - Response type: PublishCommunityPostResponse ({ data: CommunityFeedItem })
 * - Status codes: 200 (`@HttpCode(200)`)
 * - Field names: `altTextConfirmed` is `z.literal(true)`, so an unconfirmed
 *   publish is rejected by the contract itself rather than by a server check a
 *   direct caller could omit
 *
 * Publishing does NOT publish: it hands the post to moderation, so the returned
 * row is `pending_review` with a null `publishedAt`. A client that renders it as
 * live would be showing unscreened content, which is why the status and the null
 * timestamp are pinned here rather than matched loosely.
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
 * Provider endpoint: /api/v1/community/posts/publish ->
 * POST CommunityController.publishPost
 *
 * Provider Scrutiny Evidence: same handler as
 * {@link verifyPublishCommunityPostInteraction}; response type is the shared
 * error envelope. Status 409 with `COMMUNITY_UPLOAD_SESSION_MISMATCH_MESSAGE`:
 * the publish names both a post and the upload session that filled it, and a
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
 * The write path that answers 429, and the one thing that makes a 429 actionable
 * rather than merely refusing: `Retry-After`.
 *
 * PUBLISH ONLY, AND ALLOCATE DELIBERATELY NOT. The daily cap is enforced inside
 * `CommunityService.publishPost`, through the repository's `publishWithinQuota`,
 * because allocation produces DRAFTS and a draft is free by design -- a
 * submission is what counts against the ten. `allocatePost` never constructs a
 * `CommunityRateLimitException` at all (the only two throw sites in the service
 * are in `publishPost` and `reportPost`), so an allocate 429 interaction would
 * have pinned a path that cannot exist, and provider verification would have
 * failed forever on a header the handler has no reason to stamp. It is recorded
 * here as a table with one row rather than inlined, because the report abuse
 * limit is a second 429 with a different budget and this is where a reader will
 * look for the pair.
 *
 * The header is matched by REGEX rather than by an exact value on purpose. The
 * contract types it as `integer, minimum: 1` seconds until the rolling 24-hour
 * window admits another submission, so the honest assertion is "a positive
 * integer count of seconds" -- pinning `3600` exactly would demand the provider
 * return a constant it has no reason to return, and dropping the header
 * entirely would let a 429 ship with no recovery time at all.
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
 * Provider endpoint: /api/v1/community/posts/publish ->
 * POST CommunityController.publishPost
 *
 * Provider Scrutiny Evidence:
 * - Handler: apps/api/src/modules/community/community.controller.ts
 *   (publishPost), wrapped in `withRetryAfterHeader` so the exception's
 *   `retryAfterSeconds` reaches the response
 * - Response type: the shared HTTP error envelope, plus a `Retry-After`
 *   response header the OpenAPI document declares on both 429s
 * - Status codes: 429 once the atomic count of accepted submissions in
 *   `(now-24h, now]` has reached ten
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
      // asserted as a positive integer rather than merely as present.
      const retryAfter = response.headers.get('retry-after')
      expect(retryAfter).toMatch(/^[1-9][0-9]*$/)
      expect(Number(retryAfter)).toBeGreaterThan(0)

      const payload = (await response.json()) as Record<string, unknown>
      expect(payload.message).toBe(COMMUNITY_POST_RATE_LIMITED_MESSAGE)
      expect(payload.error).toBe('Too Many Requests')
    })
}

// --- Reporting -------------------------------------------------------------

/**
 * Provider endpoint: /api/v1/community/posts/{postId}/report ->
 * POST CommunityController.reportPost
 *
 * Provider Scrutiny Evidence:
 * - Handler: apps/api/src/modules/community/community.controller.ts (reportPost)
 * - Response type: `trackedResponseSchema`, `.strict()` over exactly
 *   `{ tracked: true }` -- a report tells the reporter nothing about the
 *   moderation outcome, deliberately
 * - Status codes: 200 (`@HttpCode(200)`)
 */
export async function verifyReportCommunityPostInteraction(
  pact: PactV4,
  createClient: CreateClient,
  platform: CommunityPlatform
) {
  await pact
    .addInteraction()
    .given(
      ...createProviderState({
        name: 'A visible community post can be reported by the caller',
        params: { userId: pactEventAuth.userId, postId: REPORTED_POST_ID },
      })
    )
    .uponReceiving('a request to report a visible community post')
    .withRequest(
      'POST',
      `/api/v1/community/posts/${REPORTED_POST_ID}/report`,
      setJsonContent({
        headers: communityHeaders(platform),
        body: { reason: 'harassment', details: 'Targeted comments about the author.' },
      })
    )
    .willRespondWith(200, setJsonContent({ body: { tracked: like(true) } }))
    .executeTest(async (mockServer: V3MockServer) => {
      const response = await createClient(mockServer).apiV1CommunityPostsPostIdReportPost(
        {
          postId: REPORTED_POST_ID,
          xCouturePlatform: platform,
          reportCommunityPostInput: {
            reason: 'harassment',
            details: 'Targeted comments about the author.',
          },
        }
      )

      // The whole response, so an added field that leaked moderation state
      // would fail here rather than pass unnoticed.
      expect(response).toEqual({ tracked: true })
    })
}

/**
 * The three ways a report is refused.
 *
 * A same-reason replay is deliberately NOT here: it is a 200 with the identical
 * `{ tracked: true }` body {@link verifyReportCommunityPostInteraction} already
 * pins, because a reporter who taps twice has not done anything wrong. Only a
 * CHANGED reason is a conflict, since the stored report is the record a
 * moderator acts on and silently rewriting it would rewrite that record.
 */
export type CommunityReportRejection = {
  description: string
  state: string
  postId: string
  body: { reason: string; details?: string }
  status: number
  message: string
  error: string
}

export const communityReportRejections: CommunityReportRejection[] = [
  {
    description: 'rejects a report against a post the caller cannot see',
    state: 'The reported community post is not visible to the caller',
    postId: MISSING_POST_ID,
    body: { reason: 'spam' },
    status: 404,
    message: COMMUNITY_POST_NOT_FOUND_MESSAGE,
    error: 'Not Found',
  },
  {
    description: 'rejects a second report that changes the reason',
    state: 'The caller already reported this community post for another reason',
    postId: REPORTED_POST_ID,
    body: { reason: 'spam' },
    status: 409,
    message: COMMUNITY_REPORT_REASON_CHANGED_MESSAGE,
    error: 'Conflict',
  },
  {
    description: 'rejects a report the caller filed against their own post',
    state: 'The reported community post belongs to the caller',
    postId: OWN_POST_ID,
    body: { reason: 'other' },
    status: 403,
    message: COMMUNITY_SELF_REPORT_MESSAGE,
    error: 'Forbidden',
  },
]

/**
 * Provider endpoint: /api/v1/community/posts/{postId}/report ->
 * POST CommunityController.reportPost
 *
 * Provider Scrutiny Evidence:
 * - Handler: apps/api/src/modules/community/community.controller.ts (reportPost)
 * - Response type: the shared HTTP error envelope, `.strict()` over exactly
 *   `{ statusCode, message, error }`
 * - Status codes: 404 (invisible row), 409 (changed reason on an existing
 *   reporter/post record), 403 (self-report)
 */
export async function verifyReportCommunityPostRejectionInteraction(
  pact: PactV4,
  rejection: CommunityReportRejection,
  platform: CommunityPlatform
) {
  const path = `/api/v1/community/posts/${rejection.postId}/report`

  await pact
    .addInteraction()
    .given(
      ...createProviderState({
        name: rejection.state,
        params: { userId: pactEventAuth.userId, postId: rejection.postId },
      })
    )
    .uponReceiving(`a community report that ${rejection.description}`)
    .withRequest(
      'POST',
      path,
      setJsonContent({
        headers: communityHeaders(platform),
        body: rejection.body,
      })
    )
    .willRespondWith(
      rejection.status,
      setJsonContent({
        body: {
          statusCode: like(rejection.status),
          message: string(rejection.message),
          error: string(rejection.error),
        },
      })
    )
    .executeTest(async (mockServer: V3MockServer) => {
      // The generated SDK throws on these statuses, so the request goes out
      // directly: what matters is the envelope the clients branch on.
      const response = await fetch(`${mockServer.url}${path}`, {
        method: 'POST',
        headers: {
          ...communityHeaders(platform),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(rejection.body),
      })

      expect(response.status).toBe(rejection.status)

      const payload = (await response.json()) as Record<string, unknown>
      expect(payload.message).toBe(rejection.message)
      expect(payload.error).toBe(rejection.error)
    })
}

/**
 * Provider endpoint: /api/v1/community/posts/{postId}/report ->
 * POST CommunityController.reportPost
 *
 * Provider Scrutiny Evidence: same handler as
 * {@link verifyReportCommunityPostRejectionInteraction}; response type is the
 * shared error envelope plus the declared `Retry-After` header. Status 429 is
 * the reporting ABUSE limit, which is a different budget from the posting limit
 * and therefore its own interaction rather than a row in
 * {@link communityRateLimitInteractions}.
 */
export async function verifyReportCommunityPostRateLimitInteraction(
  pact: PactV4,
  platform: CommunityPlatform
) {
  const path = `/api/v1/community/posts/${REPORTED_POST_ID}/report`
  const body = { reason: 'spam' as const }

  await pact
    .addInteraction()
    .given(
      ...createProviderState({
        name: 'The caller has reached the community reporting abuse limit',
        params: { userId: pactEventAuth.userId, postId: REPORTED_POST_ID },
      })
    )
    .uponReceiving('a community report that exceeds the reporting abuse limit')
    .withRequest(
      'POST',
      path,
      setJsonContent({ headers: communityHeaders(platform), body })
    )
    .willRespondWith(
      429,
      setJsonContent({
        headers: { 'Retry-After': regex(/^[1-9][0-9]*$/, '900') },
        body: {
          statusCode: like(429),
          message: like('Too many reports. Please try again later.'),
          error: string('Too Many Requests'),
        },
      })
    )
    .executeTest(async (mockServer: V3MockServer) => {
      // The generated SDK throws on 429, so the request goes out directly.
      const response = await fetch(`${mockServer.url}${path}`, {
        method: 'POST',
        headers: {
          ...communityHeaders(platform),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      })

      expect(response.status).toBe(429)

      const retryAfter = response.headers.get('retry-after')
      expect(retryAfter).toMatch(/^[1-9][0-9]*$/)
      expect(Number(retryAfter)).toBeGreaterThan(0)

      const payload = (await response.json()) as Record<string, unknown>
      expect(payload.error).toBe('Too Many Requests')
    })
}

// --- Challenges (admin) ----------------------------------------------------

const createChallengeRequestBody = {
  slug: CHALLENGE_SLUG,
  climateBand: VIEWER_BAND,
  startsAt: CHALLENGE_STARTS_AT,
  endsAt: CHALLENGE_ENDS_AT,
  timeZone: CHALLENGE_TIME_ZONE,
  copy: CHALLENGE_COPY,
  isActive: true,
}

/**
 * Provider endpoint: /api/v1/community/challenges ->
 * POST CommunityController.createChallenge
 *
 * Provider Scrutiny Evidence:
 * - Handler: apps/api/src/modules/community/community.controller.ts
 *   (createChallenge), behind `RolesGuard` with `@Roles('admin')`
 * - Response type: CommunityChallengeResponse ({ data: CommunityChallenge })
 * - Status codes: 200 (`@HttpCode(200)`)
 * - Field names: `.strict()`, and `timeZone` is part of the projection -- the
 *   Monday boundary and the seven-day span are only meaningful in a zone, so a
 *   response that omitted it would leave every client guessing
 *
 * This is the only interaction that uses the admin identity
 * (`pactAdminAuth`), which exists so `RolesGuard` runs for real here rather
 * than being stubbed away.
 *
 * IT DRIVES THE GENERATED SDK, AND THAT IS THE POINT. The generated
 * `CommunityChallengeCopy` model used to project
 * `z.record(supportedLocaleSchema, ...)` as a fixed object with camelCased
 * locale tags -- `enUS?`, `enCA?`, `es419?`, every one optional -- while the
 * SDK passed the body through without a `ToJSON` mapping. A client that
 * followed that type therefore sent `{ enUS: ... }`, which the API rejects
 * because `enUS` is not a supported locale tag, and the `en-US` fallback the
 * schema requires could not be expressed at all. The projection is now a
 * free-form map keyed by the real hyphenated tag. Calling
 * `apiV1CommunityChallengesPost` here rather than reaching for raw fetch is
 * what turns this into a regression test for that defect: revert the
 * projection and this stops compiling.
 */
export async function verifyCreateCommunityChallengeInteraction(
  pact: PactV4,
  createClient: CreateClient
) {
  await pact
    .addInteraction()
    .given(
      ...createProviderState({
        name: 'An administrator may create a community challenge',
        params: { userId: pactAdminAuth.userId },
      })
    )
    .uponReceiving('a request to create a Monday-anchored community challenge')
    .withRequest(
      'POST',
      CHALLENGES_PATH,
      setJsonContent({
        headers: pactAdminHeaders,
        body: createChallengeRequestBody,
      })
    )
    .willRespondWith(
      200,
      setJsonContent({
        body: {
          data: {
            id: string(CHALLENGE_ID),
            slug: string(CHALLENGE_SLUG),
            climateBand: string(VIEWER_BAND),
            startsAt: isoTimestamp(CHALLENGE_STARTS_AT),
            endsAt: isoTimestamp(CHALLENGE_ENDS_AT),
            timeZone: string(CHALLENGE_TIME_ZONE),
            copy: {
              'en-US': {
                title: like(CHALLENGE_COPY['en-US'].title),
                body: like(CHALLENGE_COPY['en-US'].body),
              },
            },
            isActive: like(true),
            createdAt: isoTimestamp(CREATED_AT),
            updatedAt: isoTimestamp(CREATED_AT),
          },
        },
      })
    )
    .executeTest(async (mockServer: V3MockServer) => {
      const response = await createClient(mockServer).apiV1CommunityChallengesPost({
        createCommunityChallengeInput: createChallengeRequestBody,
      })

      expect(response.data.id).toBe(CHALLENGE_ID)
      // The window is only interpretable with its zone, so the zone is part of
      // the response and not merely part of the request. A response that
      // dropped it would leave every client re-deriving the Monday boundary in
      // whatever zone it happened to be running in.
      expect(response.data.timeZone).toBe(CHALLENGE_TIME_ZONE)
      expect(response.data.startsAt).toBe(CHALLENGE_STARTS_AT)
      expect(response.data.endsAt).toBe(CHALLENGE_ENDS_AT)
      // The locale keys are the real hyphenated tags on the wire, never the
      // camelCased ones the old fixed-property projection produced.
      expect(response.data.copy).toHaveProperty('en-US')
      expect(response.data.copy).not.toHaveProperty('enUS')
    })
}

/**
 * The two ways a challenge write is refused.
 *
 * The 400 fixture is a Monday start with an EIGHT day span, chosen so exactly
 * one issue fires in `refineChallengeWindow` and the controller's
 * `issues.join('; ')` therefore equals
 * `COMMUNITY_CHALLENGE_WINDOW_INVALID_MESSAGE` exactly. A fixture that broke
 * two rules at once would produce a joined string that no constant matches, and
 * the assertion would have had to be loosened to survive it.
 */
export type CommunityChallengeRejection = {
  description: string
  state: string
  body: unknown
  status: number
  message: string
  /**
   * Present where the controller may join a SECOND Zod issue onto the one this
   * row is about, so the message is matched as a substring rather than
   * verbatim. Absent means the fixture provokes exactly one issue and the
   * message is pinned whole.
   */
  messagePattern?: RegExp
  error: string
}

export const communityChallengeRejections: CommunityChallengeRejection[] = [
  {
    description: 'rejects a challenge window that is not exactly seven days',
    state: 'An administrator may create a community challenge',
    body: { ...createChallengeRequestBody, endsAt: CHALLENGE_WRONG_SPAN_ENDS_AT },
    status: 400,
    message: COMMUNITY_CHALLENGE_WINDOW_INVALID_MESSAGE,
    error: 'Bad Request',
  },
  {
    description:
      'rejects a challenge that starts on a Monday in UTC but not in its own zone',
    state: 'An administrator may create a community challenge',
    body: {
      ...createChallengeRequestBody,
      startsAt: CHALLENGE_NON_MONDAY_STARTS_AT,
      endsAt: CHALLENGE_NON_MONDAY_ENDS_AT,
    },
    status: 400,
    message: COMMUNITY_CHALLENGE_WINDOW_INVALID_MESSAGE,
    error: 'Bad Request',
  },
  {
    description: 'rejects a challenge naming a time zone the tz database does not know',
    state: 'An administrator may create a community challenge',
    body: { ...createChallengeRequestBody, timeZone: CHALLENGE_INVALID_TIME_ZONE },
    status: 400,
    message: IANA_TIME_ZONE_INVALID_MESSAGE,
    messagePattern: /Time zone must be a valid IANA zone identifier\./,
    error: 'Bad Request',
  },
  {
    description: 'rejects a challenge overlapping an active one in the same band',
    state: 'An active community challenge already covers this band and window',
    body: createChallengeRequestBody,
    status: 409,
    message: COMMUNITY_CHALLENGE_OVERLAP_MESSAGE,
    error: 'Conflict',
  },
]

/**
 * Provider endpoint: /api/v1/community/challenges ->
 * POST CommunityController.createChallenge
 *
 * Provider Scrutiny Evidence:
 * - Handler: apps/api/src/modules/community/community.controller.ts
 *   (createChallenge), behind `RolesGuard` with `@Roles('admin')`
 * - Response type: the shared HTTP error envelope, `.strict()` over exactly
 *   `{ statusCode, message, error }`
 * - Status codes: 400 from `createCommunityChallengeInputSchema`'s
 *   `superRefine`, which runs in the controller before the service is reached;
 *   409 from the overlap check, which must consider global (null-band) rows as
 *   well as rows in the same band
 */
export async function verifyCreateCommunityChallengeRejectionInteraction(
  pact: PactV4,
  rejection: CommunityChallengeRejection
) {
  await pact
    .addInteraction()
    .given(
      ...createProviderState({
        name: rejection.state,
        params: { userId: pactAdminAuth.userId },
      })
    )
    .uponReceiving(`a community challenge write that ${rejection.description}`)
    .withRequest(
      'POST',
      CHALLENGES_PATH,
      setJsonContent({ headers: pactAdminHeaders, body: rejection.body })
    )
    .willRespondWith(
      rejection.status,
      setJsonContent({
        body: {
          statusCode: like(rejection.status),
          message:
            rejection.messagePattern === undefined
              ? string(rejection.message)
              : regex(rejection.messagePattern, rejection.message),
          error: string(rejection.error),
        },
      })
    )
    .executeTest(async (mockServer: V3MockServer) => {
      // The generated SDK throws on these statuses, so the request goes out
      // directly: what matters is the envelope the admin client branches on.
      const response = await fetch(`${mockServer.url}${CHALLENGES_PATH}`, {
        method: 'POST',
        headers: { ...pactAdminHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify(rejection.body),
      })

      expect(response.status).toBe(rejection.status)

      const payload = (await response.json()) as Record<string, unknown>
      if (rejection.messagePattern === undefined) {
        expect(payload.message).toBe(rejection.message)
      } else {
        expect(String(payload.message)).toContain(rejection.message)
      }
      expect(payload.error).toBe(rejection.error)
    })
}
