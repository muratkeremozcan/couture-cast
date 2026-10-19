import {
  encodeCommunityFeedCursor,
  type CommunityPlatform,
} from '@couture/api-client/contracts/http'
import { isoTimestamp, like, pactEventHeaders, string } from '../shared'

// Learning path Step 38: Community feed by climate band.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-38-community-feed-by-climate-band

/* ---------------------------------------------------------------------------
 * Story 6.1 community feed by climate band.
 *
 * Eight operations share one `/api/v1/community` controller. Three properties
 * of that surface are only observable on the wire, which is what makes them
 * contract tests:
 *
 * 1. PSEUDONYMITY. `communityFeedItemSchema` is `.strict()` and carries an
 *    `author` of exactly `{ displayName, isSelf }`: no author user id, no
 *    storage object path, and one copy of the signed URL, inside `imageAccess`.
 *    A field added back on the provider side breaks these interactions.
 * 2. CURSOR/MODE BINDING. The public cursor is `{ publishedAt, id, mode }`
 *    base64url-encoded, bound to the mode it was minted under. Three distinct
 *    400s share one message (`COMMUNITY_CURSOR_INVALID_MESSAGE`): a malformed
 *    cursor, and a well-formed cursor replayed under a different mode. A client
 *    that changes filters restarts paging and cannot tell those cases apart;
 *    that indistinguishability is itself the contract.
 * 3. THE AUTHOR'S OWN NON-PUBLISHED ROWS travel in `authorStates`, never in
 *    `items`. They have no `published_at` to keyset on, so mixing them into the
 *    paged list would perturb page boundaries and consume the page limit.
 *
 * PLATFORM IS A PARAMETER. Every community operation requires
 * `x-couture-platform`, and its value genuinely differs between the two
 * consumers: `web-api-client.pacttest.ts` passes `'web'` and
 * `mobile-api-client.pacttest.ts` passes `'mobile'`, so the mobile pact records
 * what mobile sends. It stays deterministic because each consumer file passes
 * one literal.
 *
 * ONE INTERACTION PER EXPORTED FUNCTION. PactV4's Rust FFI drops an interaction
 * non-deterministically when more than one `addInteraction()...executeTest()`
 * chain is awaited in a single test body, and `scripts/check-pact-determinism.sh`
 * runs this suite three times and compares pact hashes. Every function below is
 * called from its own `it()`.
 *
 * NO COMPUTED VALUES. Every id, date and window boundary below is a literal.
 * The two cursors are the single exception and are safe: they are
 * `encodeCommunityFeedCursor`, a pure base64url encode of the literals above
 * them, evaluated once at module load, so all three determinism runs produce
 * the same bytes. Hand-written base64 would hide which payload it encodes and
 * would not catch a change to the cursor codec.
 *
 * Cache privacy and Vary behavior are exercised through the real module in
 * apps/api/src/modules/community/community-privacy.http.spec.ts, including
 * guard refusals before controller annotations can run.
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

/**
 * Both idempotency keys are hardcoded literals so the three determinism runs
 * produce the same pact bytes; a generated uuid reports as UNSTABLE. They are
 * allowlisted in `.gitleaks.toml` for that reason. The contract types them as
 * `format: uuid`, so they are shaped like real keys.
 */
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
 *
 * The band travels separately from the mode because `auto` resolves it per
 * request: `all` binds to no band, so it carries null.
 */
const AUTO_MODE_CURSOR = encodeCommunityFeedCursor({
  publishedAt: PUBLISHED_AT,
  id: PUBLISHED_POST_ID,
  mode: 'auto',
  band: VIEWER_BAND,
})
/*
 * EACH REJECTION FIXTURE ISOLATES ONE MECHANISM, because the cursor has three
 * rejection paths that deliberately return the same message and a fixture that
 * trips two of them cannot tell you which one is still working.
 *
 * This was `mode: 'all', band: null`, which mismatches BOTH the mode and the
 * band a request for `auto` resolves. Deleting the mode comparison out of
 * `safeDecodeCommunityFeedCursor` left it green, because the band comparison
 * still rejected it — the interaction named the mode and proved the band.
 *
 * `temperate_dry` is the band literal that resolves to the SAME filter band as
 * `auto` does for this viewer (`VIEWER_BAND`), so a cursor minted under it and
 * presented under `auto` matches on band and differs only on mode.
 */
const FOREIGN_MODE_CURSOR = encodeCommunityFeedCursor({
  publishedAt: PUBLISHED_AT,
  id: PUBLISHED_POST_ID,
  mode: VIEWER_BAND,
  band: VIEWER_BAND,
})

/** The mirror: the mode matches what `auto` resolves to and only the band
 * differs, so nothing but the band comparison can reject it. */
const FOREIGN_BAND_CURSOR = encodeCommunityFeedCursor({
  publishedAt: PUBLISHED_AT,
  id: PUBLISHED_POST_ID,
  mode: 'auto',
  band: 'cold_dry',
})
const MALFORMED_CURSOR = 'not-a-base64url-cursor'

/**
 * The challenge window, chosen so UTC and the window's own zone DISAGREE about
 * the weekday. `2026-09-06T12:00Z` is a SUNDAY in UTC and a MONDAY in
 * `Pacific/Auckland`, so a window anchored there is valid only if the rule is
 * evaluated in the zone the request names. A UTC Monday would pass just as
 * happily against an implementation that ignored `timeZone` and did UTC
 * arithmetic, which is the degradation these dates exist to prevent.
 */
const CHALLENGE_TIME_ZONE = 'Pacific/Auckland' as const
const CHALLENGE_STARTS_AT = '2026-09-06T12:00:00.000Z'
const CHALLENGE_ENDS_AT = '2026-09-13T12:00:00.000Z'

/** Same Monday-in-Auckland start, an eight-day span: exactly one issue fires. */
const CHALLENGE_WRONG_SPAN_ENDS_AT = '2026-09-14T12:00:00.000Z'

/**
 * `2026-09-07T12:00Z` is a MONDAY in UTC and a TUESDAY in `Pacific/Auckland`,
 * the mirror image of the valid fixture: the span is exactly seven days, so the
 * only issue is the weekday, detectable only in the named zone.
 */
const CHALLENGE_NON_MONDAY_STARTS_AT = '2026-09-07T12:00:00.000Z'
const CHALLENGE_NON_MONDAY_ENDS_AT = '2026-09-14T12:00:00.000Z'

/**
 * A zone the host tz database does not know. This row exists because the two
 * validations take DIFFERENT paths: `ianaTimeZoneSchema`'s field-level
 * `.refine()` rejects the zone, while the Monday and seven-day rules live in the
 * object-level `superRefine`. Zod marks a failed field refine dirty rather than
 * aborted, so the object refinement still runs; that is how an unknown zone
 * reached `Intl.DateTimeFormat` and surfaced as a 500 instead of a 400. Only one
 * of the two paths was ever exercised before, so both are recorded here.
 */
const CHALLENGE_INVALID_TIME_ZONE = 'Mars/Olympus_Mons'

/**
 * The message `ianaTimeZoneSchema`'s refine carries in
 * `packages/api-client/src/contracts/http/community.ts`. It is not an exported
 * constant, so it is repeated here. The interaction matches it as a SUBSTRING,
 * because the controller joins every Zod issue with '; ' and a request that
 * trips the zone rule may legitimately report a second issue alongside it.
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
 * One published feed row as matchers. `author` is the pseudonymity assertion:
 * exactly `displayName` and `isSelf`, no user id anywhere in the object, and the
 * signed URL only under `imageAccess`.
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

export {
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
  ALLOCATE_PATH,
  PUBLISH_PATH,
  CHALLENGE_ID,
  UPLOAD_SESSION_ID,
  ALLOCATE_IDEMPOTENCY_KEY,
  PUBLISH_IDEMPOTENCY_KEY,
  UPLOAD_EXPIRES_AT,
  UPLOAD_URL,
  LOCALE,
  allocateRequestBody,
  allocateMismatchedRequestBody,
  publishRequestBody,
  REPORTED_POST_ID,
  OWN_POST_ID,
  CHALLENGES_PATH,
  CHALLENGE_TIME_ZONE,
  CHALLENGE_STARTS_AT,
  CHALLENGE_ENDS_AT,
  CHALLENGE_WRONG_SPAN_ENDS_AT,
  CHALLENGE_NON_MONDAY_STARTS_AT,
  CHALLENGE_NON_MONDAY_ENDS_AT,
  CHALLENGE_INVALID_TIME_ZONE,
  IANA_TIME_ZONE_INVALID_MESSAGE,
  CHALLENGE_SLUG,
  CHALLENGE_COPY,
}
