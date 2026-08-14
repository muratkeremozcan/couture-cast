import { describe, expect, it } from 'vitest'

import {
  premiumCheckoutStartedPropertiesSchema,
  premiumEntitlementActivatedPropertiesSchema,
  premiumEntitlementDeactivatedPropertiesSchema,
  premiumSubscribeTappedPropertiesSchema,
  trackPremiumCheckoutStarted,
  trackPremiumEntitlementActivated,
  trackPremiumEntitlementDeactivated,
  trackPremiumSubscribeTapped,
} from '../src/types/analytics-events'

/**
 * Story 5.2 premium analytics wrappers, split from the contract spec on the
 * same line 5.1 drew: `*-contract.spec.ts` asserts published request/response
 * shapes, `*-analytics.spec.ts` asserts the event builders.
 *
 * The negative fixtures are the story's privacy rule made executable: no
 * price, no receipt or transaction id, no URL, no email, and no raw user id
 * may reach PostHog through any premium event.
 */

const DISALLOWED_PREMIUM_PROPERTY_FIXTURES = Object.freeze([
  { price_usd: 4.99 },
  { amount_minor_units: 499 },
  { receipt_id: 'MIIT...receipt' },
  { transaction_id: '2000000123456789' },
  { checkout_url: 'https://checkout.stripe.test/c/pay/cs_1' },
  { email: 'subscriber@example.com' },
  { user_id: 'user-fixture-1' },
  { note: 'free text' },
])

describe('5.2 premium analytics wrappers', () => {
  it('5.2-CON-001 builds premium_subscribe_tapped on the client distinct id', () => {
    // The one premium event with no server subject: the client analytics
    // identity is passed in, exactly like affiliate_cta_shown. Directional
    // volume only — this identifier space has no join to the HMAC subject, so
    // it is not a funnel leg.
    const payload = trackPremiumSubscribeTapped(
      { plan: 'premium_monthly', surface: 'mobile_settings' },
      'mobile-distinct-id'
    )

    expect(payload).toEqual({
      distinctId: 'mobile-distinct-id',
      event: 'premium_subscribe_tapped',
      properties: { plan: 'premium_monthly', surface: 'mobile_settings' },
    })
  })

  it('5.2-CON-002 builds premium_checkout_started on the HMAC subject', () => {
    const payload = trackPremiumCheckoutStarted({
      analyticsSubjectId: 'hmac-subject-1',
      plan: 'premium_annual',
    })

    expect(payload).toEqual({
      distinctId: 'hmac-subject-1',
      event: 'premium_checkout_started',
      properties: { plan: 'premium_annual' },
    })
  })

  it('5.2-CON-003 builds premium_entitlement_activated with store and product only', () => {
    // 5.2-CON-011's funnel-joinability requirement: the activation carries the
    // store and product id so store-attributed activations are computable.
    const payload = trackPremiumEntitlementActivated({
      analyticsSubjectId: 'hmac-subject-1',
      store: 'app_store',
      productId: 'premium_annual',
    })

    expect(payload).toEqual({
      distinctId: 'hmac-subject-1',
      event: 'premium_entitlement_activated',
      properties: { store: 'app_store', product_id: 'premium_annual' },
    })
  })

  it('5.2-CON-004 builds premium_entitlement_deactivated with a closed reason enum', () => {
    const payload = trackPremiumEntitlementDeactivated({
      analyticsSubjectId: 'hmac-subject-1',
      store: 'stripe',
      productId: 'premium_monthly',
      reason: 'expired',
    })

    expect(payload.properties.reason).toBe('expired')

    // grace_period entry/exit fires neither premium event, so "grace" must not
    // even be expressible as a deactivation reason.
    expect(
      premiumEntitlementDeactivatedPropertiesSchema.safeParse({
        store: 'stripe',
        product_id: 'premium_monthly',
        reason: 'grace_period',
      }).success
    ).toBe(false)
  })

  describe('5.2-CON-010 property allowlists reject forbidden values', () => {
    const validBysSchema = [
      {
        schema: premiumSubscribeTappedPropertiesSchema,
        valid: { plan: 'premium_monthly', surface: 'web_settings' },
      },
      {
        schema: premiumCheckoutStartedPropertiesSchema,
        valid: { plan: 'premium_monthly' },
      },
      {
        schema: premiumEntitlementActivatedPropertiesSchema,
        valid: { store: 'stripe', product_id: 'premium_monthly' },
      },
      {
        schema: premiumEntitlementDeactivatedPropertiesSchema,
        valid: { store: 'stripe', product_id: 'premium_monthly', reason: 'revoked' },
      },
    ] as const

    for (const [index, { schema, valid }] of validBysSchema.entries()) {
      it(`rejects every disallowed property on schema ${index + 1}`, () => {
        expect(schema.safeParse(valid).success).toBe(true)

        for (const forbidden of DISALLOWED_PREMIUM_PROPERTY_FIXTURES) {
          expect(
            schema.safeParse({ ...valid, ...forbidden }).success,
            `expected ${Object.keys(forbidden)[0]} to be rejected`
          ).toBe(false)
        }
      })
    }
  })

  it('5.2-CON-005 never accepts a raw user id in place of the pseudonymous subject', () => {
    // The wrapper requires analyticsSubjectId; there is no path that accepts a
    // userId key, so a caller holding only a raw id cannot emit at all.
    expect(() =>
      trackPremiumCheckoutStarted(
        // @ts-expect-error -- userId is not an accepted field
        { userId: 'raw-user-id', plan: 'premium_monthly' }
      )
    ).toThrow()
  })
})
