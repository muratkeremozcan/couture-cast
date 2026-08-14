import { allowsTestOnlySecrets } from '../../config/runtime-environment.js'

/**
 * Story 5.2: billing webhook credential resolution, kept in a PURE module for
 * the same reason `affiliate-webhook-signature.ts` is one.
 *
 * These helpers are imported by suites that run outside the Nest runtime — the
 * Playwright API spec signs its fixtures with the exact value the server
 * verifies with, and deriving that value in two places is precisely how the two
 * drift. Importing them from `billing-webhook.service.ts` would drag the whole
 * decorated, dependency-injected service into a Playwright worker, which fails
 * to load there. Nothing in this file may import from Nest.
 *
 * Resolution rule for both providers, matching `resolvePartnerWebhookSecret`:
 * a configured value that meets the length floor wins; a configured value that
 * does NOT meet it is rejected outright rather than falling through, so an
 * operator's mistake is loud instead of silently downgraded to a test value;
 * and only an unset value falls back, and only in a test-only environment.
 */

/** Matches the repo-wide signing-secret floor (`WEBHOOK_SECRET_MIN_LENGTH`). */
export const BILLING_SECRET_MIN_LENGTH = 32

/**
 * Deterministic test-only Stripe webhook signing secret. Exported because the
 * suites must sign their `generateTestHeaderString` fixtures with the exact
 * value the server verifies with; deriving it in two places is how they drift.
 */
export function buildTestOnlyStripeWebhookSecret(): string {
  return 'whsec_test-only-stripe-webhook-signing-secret'
}

/** Deterministic test-only RevenueCat Authorization header value. */
export function buildTestOnlyRevenueCatWebhookAuth(): string {
  return 'test-only-revenuecat-webhook-authorization-value'
}

export function resolveStripeWebhookSecret(): string | null {
  const configured = process.env.STRIPE_WEBHOOK_SECRET?.trim()
  if (configured !== undefined && configured.length > 0) {
    return configured.length >= BILLING_SECRET_MIN_LENGTH ? configured : null
  }
  return allowsTestOnlySecrets() ? buildTestOnlyStripeWebhookSecret() : null
}

export function resolveRevenueCatWebhookAuth(): string | null {
  const configured = process.env.REVENUECAT_WEBHOOK_AUTH?.trim()
  if (configured !== undefined && configured.length > 0) {
    return configured.length >= BILLING_SECRET_MIN_LENGTH ? configured : null
  }
  return allowsTestOnlySecrets() ? buildTestOnlyRevenueCatWebhookAuth() : null
}
