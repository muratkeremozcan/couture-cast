import type {
  AffiliateClickRequest,
  AffiliateWebhookPayload,
  CommercePreference,
  ShopThisLook,
} from '../contracts/http/commerce'

/**
 * Story 5.1: contract-shaped fixtures for affiliate commerce.
 *
 * These describe the WIRE shapes, not database rows. Database fixtures live in
 * `@couture/testing`'s `commerce.factory.ts`; keeping the two separate is what
 * lets a contract test assert the published shape without needing a database,
 * and lets a repository test build rows without importing a contract.
 *
 * Every timestamp is a fixed literal rather than `new Date()`. A fixture whose
 * value moves with the clock cannot be asserted on exactly, and the whole point
 * of the click-dedupe and webhook-window tests is exact boundary behaviour.
 */

const FIXED_OCCURRED_AT = '2026-08-11T10:00:00.000Z'

export function createShopThisLookFixture(
  overrides: Partial<ShopThisLook> = {}
): ShopThisLook {
  return {
    partnerId: 'sample-partner',
    partnerDisplayName: 'Sample Partner',
    offerId: 'offer-fixture-1',
    offerTitle: 'Everyday Layering Tee',
    garmentCategory: 'top',
    ...overrides,
  }
}

export function createCommercePreferenceFixture(
  overrides: Partial<CommercePreference> = {}
): CommercePreference {
  return {
    // Matches the column default and the "missing row reads as enabled" rule, so
    // an explicit fixture and an absent row are indistinguishable to a caller.
    affiliateCtasEnabled: true,
    ...overrides,
  }
}

export function createAffiliateClickRequestFixture(
  overrides: Partial<AffiliateClickRequest> = {}
): AffiliateClickRequest {
  return {
    offerId: 'offer-fixture-1',
    recommendationId: 'recommendation-fixture-1',
    surface: 'mobile_hero',
    ...overrides,
  }
}

export function createAffiliateWebhookPayloadFixture(
  overrides: Partial<AffiliateWebhookPayload> = {}
): AffiliateWebhookPayload {
  return {
    eventId: 'evt-fixture-1',
    clickToken: 'click-token-fixture-1',
    occurredAt: FIXED_OCCURRED_AT,
    status: 'confirmed',
    orderValueMinorUnits: 12_900,
    currency: 'USD',
    ...overrides,
  }
}

/**
 * Values that must be REJECTED by the strict analytics property allowlists.
 *
 * Story 5.1 forbids any URL, product title, garment id, or raw user id from
 * reaching an analytics property. The allowlists are `.strict()`, so the
 * enforcement is real; these fixtures are what proves it, and they are exported
 * so the API, web, and mobile suites all assert against the same list rather
 * than each inventing a weaker one.
 */
export const DISALLOWED_ANALYTICS_PROPERTY_FIXTURES = Object.freeze([
  { redirect_url: 'https://partner.couturecast.test/shop?cc=abc' },
  { deep_link_template: 'https://partner.couturecast.test/shop?cc={clickToken}' },
  { offer_title: 'Everyday Layering Tee' },
  { garment_id: 'garment-fixture-1' },
  { user_id: 'user-fixture-1' },
  { email: 'teen@example.com' },
  { note: 'free text' },
])
