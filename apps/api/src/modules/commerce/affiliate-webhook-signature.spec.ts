// Learning path Step 33: Affiliate "Shop this look" CTA.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-33-affiliate-shop-this-look-cta
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildTestOnlyPartnerWebhookSecret,
  isWebhookTimestampFresh,
  resolvePartnerWebhookSecret,
  signAffiliateWebhookPayload,
  verifyAffiliateWebhookSignature,
  WEBHOOK_SECRET_REF_PATTERN,
  WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS,
} from './affiliate-webhook-signature.js'

const VALID_REF = 'COMMERCE_PARTNER_SAMPLE_PARTNER_WEBHOOK_SECRET'
const STRONG_SECRET = 'a-configured-partner-secret-of-at-least-32-characters'

describe('affiliate webhook signature protocol', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  describe('resolvePartnerWebhookSecret', () => {
    it('returns a configured secret that meets the length floor', () => {
      vi.stubEnv(VALID_REF, STRONG_SECRET)

      expect(resolvePartnerWebhookSecret(VALID_REF)).toBe(STRONG_SECRET)
    })

    it('trims surrounding whitespace from a configured secret', () => {
      vi.stubEnv(VALID_REF, `  ${STRONG_SECRET}  `)

      expect(resolvePartnerWebhookSecret(VALID_REF)).toBe(STRONG_SECRET)
    })

    it('rejects a configured secret under the length floor even under test', () => {
      // The divergence from `requireUploadTokenSecret` that makes this guard
      // observable: falling back to the test-only value here would mean no
      // environment ever exercises the length check.
      vi.stubEnv(VALID_REF, 'too-short')

      expect(resolvePartnerWebhookSecret(VALID_REF)).toBeNull()
    })

    it('falls back to the deterministic test-only secret when the variable is unset', () => {
      vi.stubEnv(VALID_REF, undefined)

      expect(resolvePartnerWebhookSecret(VALID_REF)).toBe(
        buildTestOnlyPartnerWebhookSecret(VALID_REF)
      )
    })

    it('produces a test-only secret that itself clears the length floor', () => {
      expect(buildTestOnlyPartnerWebhookSecret(VALID_REF).length).toBeGreaterThanOrEqual(
        32
      )
    })

    it('refuses to fall back outside test and local environments', () => {
      vi.stubEnv(VALID_REF, undefined)
      vi.stubEnv('NODE_ENV', 'production')
      vi.stubEnv('TEST_ENV', '')

      expect(resolvePartnerWebhookSecret(VALID_REF)).toBeNull()
    })

    it.each([
      { name: 'an unrelated variable', ref: 'DATABASE_URL' },
      { name: 'a lowercase name', ref: 'commerce_partner_x_webhook_secret' },
      { name: 'a name with the wrong suffix', ref: 'COMMERCE_PARTNER_X_SECRET' },
      { name: 'a name with punctuation', ref: 'COMMERCE_PARTNER_X-Y_WEBHOOK_SECRET' },
      {
        name: 'a name whose middle exceeds 40 characters',
        ref: `COMMERCE_PARTNER_${'A'.repeat(41)}_WEBHOOK_SECRET`,
      },
    ])('refuses to read $name from the environment', ({ ref }) => {
      // `process.env[<value from a database row>]` is an unbounded read without
      // this guard, so a bad catalog row must never reach the lookup at all.
      vi.stubEnv(ref, STRONG_SECRET)

      expect(WEBHOOK_SECRET_REF_PATTERN.test(ref)).toBe(false)
      expect(resolvePartnerWebhookSecret(ref)).toBeNull()
    })
  })

  describe('signAffiliateWebhookPayload and verifyAffiliateWebhookSignature', () => {
    const rawBody = Buffer.from('{"eventId":"evt-1","status":"confirmed"}', 'utf8')

    it('produces lowercase hex that verifies against the same bytes', () => {
      const signature = signAffiliateWebhookPayload('1760000000', rawBody, STRONG_SECRET)

      expect(signature).toMatch(/^[0-9a-f]{64}$/)
      expect(
        verifyAffiliateWebhookSignature(signature, '1760000000', rawBody, STRONG_SECRET)
      ).toBe(true)
    })

    it('binds the signature to the timestamp, the bytes, and the secret', () => {
      const signature = signAffiliateWebhookPayload('1760000000', rawBody, STRONG_SECRET)

      expect(
        verifyAffiliateWebhookSignature(signature, '1760000001', rawBody, STRONG_SECRET)
      ).toBe(false)
      expect(
        verifyAffiliateWebhookSignature(
          signature,
          '1760000000',
          Buffer.from('{"eventId":"evt-2"}', 'utf8'),
          STRONG_SECRET
        )
      ).toBe(false)
      expect(
        verifyAffiliateWebhookSignature(
          signature,
          '1760000000',
          rawBody,
          'a-different-partner-secret-of-at-least-32-chars'
        )
      ).toBe(false)
    })

    it('distinguishes byte sequences that differ only in key order', () => {
      // The property the whole raw-body design exists for: two bodies that parse
      // to the same object are different signed inputs.
      const reordered = Buffer.from('{"status":"confirmed","eventId":"evt-1"}', 'utf8')

      expect(signAffiliateWebhookPayload('1760000000', rawBody, STRONG_SECRET)).not.toBe(
        signAffiliateWebhookPayload('1760000000', reordered, STRONG_SECRET)
      )
    })

    it.each([
      {
        name: 'a candidate whose byte length differs from the digest',
        candidate: 'deadbeef',
      },
      {
        // Thirty-two two-byte characters occupy the same 64 bytes as the digest,
        // so the length guard passes and `timingSafeEqual` runs for real. The
        // string-length comparison this replaced would have short-circuited here
        // and hidden the case entirely.
        name: 'a multi-byte candidate that matches the digest in bytes only',
        candidate: 'é'.repeat(32),
      },
    ])('returns false rather than throwing on $name', ({ candidate }) => {
      // `timingSafeEqual` throws a RangeError on unequal buffer lengths, which
      // would turn a forged signature into a 500 instead of a 401.
      let result: boolean | undefined
      expect(() => {
        result = verifyAffiliateWebhookSignature(
          candidate,
          '1760000000',
          rawBody,
          STRONG_SECRET
        )
      }).not.toThrow()
      expect(result).toBe(false)
    })
  })

  describe('isWebhookTimestampFresh', () => {
    const nowMs = 1_760_000_000_500
    const nowSeconds = 1_760_000_000

    it.each([
      { name: 'the current second', offset: 0, expected: true },
      {
        name: 'exactly the tolerance in the past',
        offset: -WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS,
        expected: true,
      },
      {
        name: 'exactly the tolerance in the future',
        offset: WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS,
        expected: true,
      },
      {
        name: 'one second beyond the tolerance in the past',
        offset: -(WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS + 1),
        expected: false,
      },
      {
        name: 'one second beyond the tolerance in the future',
        offset: WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS + 1,
        expected: false,
      },
    ])('treats $name as fresh=$expected', ({ offset, expected }) => {
      expect(isWebhookTimestampFresh(nowSeconds + offset, nowMs)).toBe(expected)
    })

    it('defaults to the process clock when no reference time is supplied', () => {
      expect(isWebhookTimestampFresh(Math.floor(Date.now() / 1000))).toBe(true)
    })
  })
})
