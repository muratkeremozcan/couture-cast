// Story 5.1 Task 5: the signing protocol for the inbound conversion webhook.
//
// The endpoint is new; the crypto is not. This module deliberately mirrors the
// structure of `wardrobe-upload-token.ts`: a secret resolver with a
// >=32-character guard and an `allowsTestOnlySecrets()` fallback,
// `createHmac('sha256', ...)`, and a byte-length check before `timingSafeEqual`.
// `guardian.service.ts` verifies its invitation tokens the same way. Keeping the
// crypto in its own module rather than inside the service is what makes it
// directly unit-testable and reusable by the operator runbook.
import { createHmac, timingSafeEqual } from 'node:crypto'
import { allowsTestOnlySecrets } from '../../config/runtime-environment.js'

/**
 * A signed request whose timestamp is further than this from server time in
 * either direction is rejected, which bounds how long a captured request stays
 * replayable. Exactly at the boundary is accepted; one second beyond is not.
 */
export const WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS = 300

/** Matches `requireUploadTokenSecret`, so every signing secret in this API has one floor. */
export const WEBHOOK_SECRET_MIN_LENGTH = 32

/**
 * The migration pins `CommercePartner.webhook_secret_ref` to this exact pattern.
 * It is repeated here as a runtime guard rather than trusted, because
 * `process.env[<value read from a database row>]` is otherwise an unbounded read
 * of any variable in the process: a single bad catalog row would be enough to
 * turn this endpoint into a signature oracle over `DATABASE_URL`.
 */
export const WEBHOOK_SECRET_REF_PATTERN =
  /^COMMERCE_PARTNER_[A-Z0-9_]{1,40}_WEBHOOK_SECRET$/

/**
 * A deterministic per-partner stand-in so the seeded `sample-partner` catalog row
 * is signable locally and in test runs without an operator exporting anything.
 * Unreachable outside `NODE_ENV === 'test'` and `TEST_ENV === 'local'`.
 *
 * Exported because the integration suite and the Playwright API suite have to
 * produce the same value to sign with; deriving it in two places is how the two
 * drift apart.
 */
export function buildTestOnlyPartnerWebhookSecret(secretRef: string): string {
  return `test-only-${secretRef.toLowerCase()}-webhook-signing-secret`
}

/**
 * Resolves a partner's signing secret from the environment variable its catalog
 * row names, or `null` when no usable secret exists. `null` is the caller's
 * signal to reject, and every rejection reason collapses into one response.
 *
 * Secret values are returned and never logged, stored, or echoed.
 */
export function resolvePartnerWebhookSecret(secretRef: string): string | null {
  if (!WEBHOOK_SECRET_REF_PATTERN.test(secretRef)) {
    return null
  }

  const configured = process.env[secretRef]?.trim()
  if (configured !== undefined && configured.length > 0) {
    // A configured-but-too-short secret is rejected outright, where
    // `requireUploadTokenSecret` would fall through to its test-only value. That
    // divergence is deliberate: falling back here would make the length guard
    // unobservable in the only environment that exercises it, and it would let a
    // preview deployment happily sign traffic with a value an operator already
    // got wrong.
    return configured.length >= WEBHOOK_SECRET_MIN_LENGTH ? configured : null
  }

  if (allowsTestOnlySecrets()) {
    return buildTestOnlyPartnerWebhookSecret(secretRef)
  }

  return null
}

/**
 * Signs `${timestamp}.${rawBody}` and returns lowercase hex.
 *
 * The second half of that input is the raw request bytes, never a
 * re-serialization. JSON key order and insignificant whitespace both change the
 * bytes without changing the parsed value, so signing a re-serialized body would
 * reject every partner whose serializer disagrees with ours about either.
 */
export function signAffiliateWebhookPayload(
  timestamp: string,
  rawBody: Buffer,
  secret: string
): string {
  return createHmac('sha256', secret)
    .update(`${timestamp}.`)
    .update(rawBody)
    .digest('hex')
}

export function verifyAffiliateWebhookSignature(
  candidateSignature: string,
  timestamp: string,
  rawBody: Buffer,
  secret: string
): boolean {
  const expected = signAffiliateWebhookPayload(timestamp, rawBody, secret)
  // Compare buffer byte lengths, not string lengths: a caller-supplied signature
  // containing multi-byte characters can match `expected` in code points while
  // differing in bytes, and `timingSafeEqual` throws a RangeError on unequal
  // buffer lengths -- turning a forged signature into a 500 instead of a 401.
  const candidateBytes = Buffer.from(candidateSignature, 'utf8')
  const expectedBytes = Buffer.from(expected, 'utf8')
  if (candidateBytes.length !== expectedBytes.length) {
    return false
  }
  return timingSafeEqual(candidateBytes, expectedBytes)
}

/**
 * Server time is truncated to whole seconds before comparing, because the header
 * carries integer Unix seconds. Comparing in milliseconds would make a request
 * signed at exactly the tolerance boundary pass or fail depending on the
 * sub-second remainder of the clock, which is a flaky test waiting to happen.
 */
export function isWebhookTimestampFresh(
  timestampSeconds: number,
  nowMs: number = Date.now()
): boolean {
  const skewSeconds = Math.abs(Math.floor(nowMs / 1000) - timestampSeconds)
  return skewSeconds <= WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS
}
