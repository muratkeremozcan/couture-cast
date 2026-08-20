/**
 * The identifiers the provider doubles pin, in one module so the consumer file
 * and the doubles cannot drift apart silently. Both sides must agree or the
 * pinned `string()` matchers fail verification.
 *
 * These sat at the top of `provider-helper.ts`. They are here so `doubles/` can
 * import them without importing `provider-helper.ts`, which would be a cycle:
 * that module imports the doubles.
 */

/**
 * Mirrors the identifiers the consumer contract pins in
 * `pact/http/consumer/api-contract-interactions.ts`. Both sides must agree or
 * the pinned `string()` matchers fail verification.
 */
export const PACT_CAPSULE_OWNER_ID = 'guardian-1'
export const PACT_CAPSULE_ID = '00000000-0000-4000-8000-0000000000c1'
export const PACT_CAPSULE_GARMENT_A = '00000000-0000-4000-8000-0000000000a1'
export const PACT_CAPSULE_TIMESTAMP = '2026-08-07T10:00:00.000Z'
export const PACT_SILHOUETTE_TEEN_ID = 'teen-1'
export const PACT_ONBOARDING_STARTED_AT = '2026-08-09T09:00:00.000Z'
export const PACT_SILHOUETTE_UPDATED_AT = '2026-08-09T09:05:00.000Z'
export const PACT_SILHOUETTE_COMMITTED_AT = '2026-08-09T09:10:00.000Z'
export const PACT_SILHOUETTE_IMAGE_EXPIRY = '2026-08-09T09:25:00.000Z'
export const PACT_SILHOUETTE_UPLOAD_SESSION_ID = '85b4dde2-3df2-4e81-8c18-d51ae3408ca0'
export const PACT_SILHOUETTE_UPLOAD_EXPIRY = '2026-08-09T09:15:00.000Z'
/**
 * Mirrors `SILHOUETTE_UPLOAD_IDEMPOTENCY_KEY`/`SILHOUETTE_COMMIT_IDEMPOTENCY_KEY`
 * in the consumer file exactly: the replay interactions send these same
 * header values, and the doubles below compare the incoming header against
 * them to decide `replayed`/unchanged-row behavior, mirroring
 * `WardrobeSilhouetteService`'s real `*_idempotency_key === idempotencyKey`
 * checks.
 */
export const PACT_SILHOUETTE_UPLOAD_IDEMPOTENCY_KEY =
  '6eae27b8-8335-476e-a3bf-371e9fa5fd26'
export const PACT_SILHOUETTE_COMMIT_IDEMPOTENCY_KEY =
  '760490a0-5049-4cdd-afcf-ac8e7ba0b436'
/**
 * Fixed stand-in for the onboarding-complete double's `completedAt`, kept
 * deterministic like every other timestamp in this file rather than reading
 * the wall clock. Currently unreachable: `requireOnboardingScenario()` only
 * ever returns `currentStep: 'permission'` or `'capture'`, and
 * `ONBOARDING_FORWARD_TRANSITIONS` never allows `'complete'` from either, so
 * no interaction exercises this branch today. Kept fixed anyway so this
 * double stays fully deterministic the moment a completion-success
 * interaction is added.
 */
export const PACT_ONBOARDING_COMPLETED_AT = '2026-08-09T09:20:00.000Z'
/**
 * Story 5.1 affiliate commerce. Mirrors the identifiers the consumer pins in
 * `pact/http/consumer/api-contract-interactions.ts`; both sides must agree or
 * the `string()` matchers fail verification.
 *
 * The host is under `.test`, reserved by RFC 2606, so a redirect recorded in a
 * pact file can never resolve on the public internet.
 */
export const PACT_COMMERCE_PARTNER_SLUG = 'sample-partner'
export const PACT_COMMERCE_PARTNER_NAME = 'Sample Partner'
export const PACT_COMMERCE_OFFER_ID = 'offer-pact-1'
export const PACT_COMMERCE_OFFER_TITLE = 'Everyday Layering Tee'
export const PACT_COMMERCE_REDIRECT_URL =
  'https://partner.couturecast.test/shop?cc=pact-click-token'
/**
 * Story 5.2 premium subscription. Mirrors the identifiers the consumer pins in
 * `pact/http/consumer/api-contract-interactions.ts`; both sides must agree or
 * the `string()` matchers fail verification. Hosts are RFC-2606 `.test`,
 * matching Decision 9's fake Stripe client, so nothing recorded in a pact file
 * can resolve on the public internet.
 */
export const PACT_SUBSCRIPTION_PRODUCT_ID = 'premium_monthly'
export const PACT_SUBSCRIPTION_PERIOD_END = '2026-09-11T10:00:00.000Z'
export const PACT_SUBSCRIPTION_SYNCED_AT = '2026-08-11T10:00:00.000Z'
export const PACT_SUBSCRIPTION_CHECKOUT_URL =
  'https://checkout.stripe.test/c/pay/cs-pact-1'
export const PACT_SUBSCRIPTION_PORTAL_URL = 'https://billing.stripe.test/p/session/pact-1'
