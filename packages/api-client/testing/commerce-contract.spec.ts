import { describe, expect, it } from 'vitest'

import {
  affiliateClickRequestSchema,
  affiliateClickResponseSchema,
  affiliateWebhookHeadersSchema,
  affiliateWebhookPayloadSchema,
  affiliateWebhookResponseSchema,
  commercePreferenceResponseSchema,
  shopThisLookSchema,
  updateCommercePreferenceInputSchema,
  updateCommercePreferenceResponseSchema,
  COMMERCE_AUDIENCE_INELIGIBLE_MESSAGE,
  COMMERCE_DISABLED_MESSAGE,
  COMMERCE_OFFER_INVALID_MESSAGE,
  COMMERCE_OFFER_NOT_FOUND_MESSAGE,
  COMMERCE_OPTED_OUT_MESSAGE,
  WEBHOOK_SIGNATURE_INVALID_MESSAGE,
} from '../src/contracts/http/commerce'
import { scenarioOutfitSchema } from '../src/contracts/http/ritual'
import {
  affiliateConversionRecordedPropertiesSchema,
  affiliateCtaClickedPropertiesSchema,
  affiliateCtaShownPropertiesSchema,
  trackAffiliateConversionRecorded,
  trackAffiliateCtaClicked,
  trackAffiliateCtaShown,
} from '../src/types/analytics-events'
import {
  DISALLOWED_ANALYTICS_PROPERTY_FIXTURES,
  createAffiliateClickRequestFixture,
  createAffiliateWebhookPayloadFixture,
  createCommercePreferenceFixture,
  createShopThisLookFixture,
} from '../src/testing/commerce-fixtures'

/**
 * Story 5.1 Task 8: the published commerce contract, asserted at the schema
 * boundary rather than through a running server.
 *
 * Two properties carry most of the weight here. First, `shopThisLook` is
 * nullable and NOT optional, so a client never has to tell "absent" from "not
 * eligible". Second, every analytics property allowlist is `.strict()`, which is
 * the actual enforcement point for the story's privacy rule: no URL, product
 * title, garment id, or raw user id may reach PostHog. Types are not a trust
 * boundary; these parses are.
 */

const OUTFIT_BASE = {
  id: 'morning-outfit-id',
  scenario: 'morning' as const,
  garmentIds: ['classic-trench-coat'],
  reasoningBadges: [],
  comfortNotes: 'Mild morning with gentle winds.',
}

describe('5.1 commerce contract', () => {
  describe('shopThisLook on a scenario outfit', () => {
    it('5.1-CONTRACT-01 accepts a populated block and carries no URL', () => {
      const parsed = scenarioOutfitSchema.parse({
        ...OUTFIT_BASE,
        shopThisLook: createShopThisLookFixture(),
      })

      expect(parsed.shopThisLook).toEqual({
        partnerId: 'sample-partner',
        partnerDisplayName: 'Sample Partner',
        offerId: 'offer-fixture-1',
        offerTitle: 'Everyday Layering Tee',
        garmentCategory: 'top',
      })
      // The deep link is built server-side at click time. A URL here would let a
      // client navigate without ever minting an attributed click.
      expect(Object.keys(parsed.shopThisLook ?? {})).not.toContain('redirectUrl')
    })

    it('5.1-CONTRACT-02 accepts null for an ineligible card', () => {
      const parsed = scenarioOutfitSchema.parse({ ...OUTFIT_BASE, shopThisLook: null })

      expect(parsed.shopThisLook).toBeNull()
    })

    it('5.1-CONTRACT-03 rejects an absent shopThisLook key', () => {
      // Nullable, not optional. An earlier draft used `.nullable().optional()`,
      // which recreates the absent-versus-null ambiguity the design removes.
      expect(() => scenarioOutfitSchema.parse(OUTFIT_BASE)).toThrow()
    })

    it('5.1-CONTRACT-04 rejects an unknown field inside the block', () => {
      expect(() =>
        shopThisLookSchema.parse({
          ...createShopThisLookFixture(),
          redirectUrl: 'https://partner.couturecast.test/go',
        })
      ).toThrow()
    })
  })

  describe('preferences', () => {
    it('5.1-CONTRACT-05 round-trips the read and write shapes', () => {
      const preference = createCommercePreferenceFixture()

      expect(commercePreferenceResponseSchema.parse({ data: preference })).toEqual({
        data: { affiliateCtasEnabled: true },
      })
      expect(
        updateCommercePreferenceInputSchema.parse({ affiliateCtasEnabled: false })
      ).toEqual({ affiliateCtasEnabled: false })
      expect(
        updateCommercePreferenceResponseSchema.parse({
          data: createCommercePreferenceFixture({ affiliateCtasEnabled: false }),
        })
      ).toEqual({ data: { affiliateCtasEnabled: false } })
    })

    it('5.1-CONTRACT-06 rejects a non-boolean preference', () => {
      expect(() =>
        updateCommercePreferenceInputSchema.parse({ affiliateCtasEnabled: 'yes' })
      ).toThrow()
    })
  })

  describe('affiliate click', () => {
    it('5.1-CONTRACT-07 accepts exactly the three client-owned fields', () => {
      expect(
        affiliateClickRequestSchema.parse(createAffiliateClickRequestFixture())
      ).toEqual({
        offerId: 'offer-fixture-1',
        recommendationId: 'recommendation-fixture-1',
        surface: 'mobile_hero',
      })
    })

    it('5.1-CONTRACT-08 rejects client-supplied scenario or localeRegion', () => {
      // Both are derived server-side. Accepting them would create a spoofable
      // path into the attribution record.
      for (const smuggled of [{ scenario: 'evening' }, { localeRegion: 'US' }]) {
        expect(() =>
          affiliateClickRequestSchema.parse({
            ...createAffiliateClickRequestFixture(),
            ...smuggled,
          })
        ).toThrow()
      }
    })

    it('5.1-CONTRACT-09 rejects a surface outside the closed enum', () => {
      expect(() =>
        affiliateClickRequestSchema.parse(
          createAffiliateClickRequestFixture({
            surface: 'web_hero' as never,
          })
        )
      ).toThrow()
    })

    it('5.1-CONTRACT-10 requires an absolute URL in the response, which both 201 and 200 share', () => {
      const body = {
        data: { redirectUrl: 'https://partner.couturecast.test/go?token=abc' },
      }

      // The dedupe replay returns the same body shape as a fresh mint, so one
      // schema covers both status codes.
      expect(affiliateClickResponseSchema.parse(body)).toEqual(body)
      expect(() =>
        affiliateClickResponseSchema.parse({ data: { redirectUrl: 'not-a-url' } })
      ).toThrow()
    })
  })

  describe('conversion webhook', () => {
    it('5.1-CONTRACT-11 accepts the canonical payload and response', () => {
      expect(
        affiliateWebhookPayloadSchema.parse(createAffiliateWebhookPayloadFixture())
      ).toMatchObject({ status: 'confirmed', orderValueMinorUnits: 12_900 })
      expect(affiliateWebhookResponseSchema.parse({ data: { received: true } })).toEqual({
        data: { received: true },
      })
    })

    it('5.1-CONTRACT-12 rejects floating-point money and a negative order value', () => {
      // Money is integer minor units. Floating-point money is prohibited.
      expect(() =>
        affiliateWebhookPayloadSchema.parse(
          createAffiliateWebhookPayloadFixture({ orderValueMinorUnits: 129.5 })
        )
      ).toThrow()
      expect(() =>
        affiliateWebhookPayloadSchema.parse(
          createAffiliateWebhookPayloadFixture({ orderValueMinorUnits: -1 })
        )
      ).toThrow()
    })

    it('5.1-CONTRACT-13 rejects a currency that is not ISO 4217 alpha-3 uppercase', () => {
      for (const currency of ['usd', 'US', 'USDD', '123']) {
        expect(() =>
          affiliateWebhookPayloadSchema.parse(
            createAffiliateWebhookPayloadFixture({ currency })
          )
        ).toThrow()
      }
    })

    it('5.1-CONTRACT-14 constrains the signature headers structurally', () => {
      const headers = {
        'x-couture-partner-id': 'sample-partner',
        'x-couture-timestamp': '1786445661',
        'x-couture-signature': 'a'.repeat(64),
      }
      expect(affiliateWebhookHeadersSchema.parse(headers)).toEqual(headers)

      // A regex reaches the published OpenAPI document as `pattern`, where a
      // refinement would vanish from the spec and only exist at runtime.
      expect(() =>
        affiliateWebhookHeadersSchema.parse({ ...headers, 'x-couture-timestamp': '12.5' })
      ).toThrow()
      expect(() =>
        affiliateWebhookHeadersSchema.parse({
          ...headers,
          'x-couture-signature': 'A'.repeat(64),
        })
      ).toThrow()
      expect(() =>
        affiliateWebhookHeadersSchema.parse({ ...headers, 'x-couture-signature': 'abc' })
      ).toThrow()
    })
  })

  describe('error messages', () => {
    it('5.1-CONTRACT-15 exports the six message constants controllers and tests share', () => {
      // Declared as constants precisely so a controller and its assertion cannot
      // drift. There are no COMMERCE_* codes on the wire: the shared error
      // envelopes are strict over exactly { statusCode, message, error }.
      expect({
        WEBHOOK_SIGNATURE_INVALID_MESSAGE,
        COMMERCE_OPTED_OUT_MESSAGE,
        COMMERCE_AUDIENCE_INELIGIBLE_MESSAGE,
        COMMERCE_OFFER_NOT_FOUND_MESSAGE,
        COMMERCE_OFFER_INVALID_MESSAGE,
        COMMERCE_DISABLED_MESSAGE,
      }).toEqual({
        WEBHOOK_SIGNATURE_INVALID_MESSAGE: 'Invalid webhook signature.',
        COMMERCE_OPTED_OUT_MESSAGE:
          'Affiliate suggestions are turned off for this account.',
        COMMERCE_AUDIENCE_INELIGIBLE_MESSAGE:
          'Affiliate suggestions are unavailable for this account.',
        COMMERCE_OFFER_NOT_FOUND_MESSAGE: 'Affiliate offer not found.',
        COMMERCE_OFFER_INVALID_MESSAGE: 'Affiliate offer is not configured correctly.',
        COMMERCE_DISABLED_MESSAGE: 'Affiliate suggestions are temporarily unavailable.',
      })
    })
  })

  describe('analytics wrappers', () => {
    it('5.1-CONTRACT-16 builds affiliate_cta_shown on the client distinct id', () => {
      // The one commerce event with no server subject: the mobile analytics
      // client owns its own identity here, so distinctId is passed in rather
      // than read off the event.
      const payload = trackAffiliateCtaShown(
        {
          partnerId: 'sample-partner',
          scenario: 'morning',
          surface: 'mobile_hero',
          localeRegion: 'US',
          recommendationId: 'morning-outfit-id',
        },
        'mobile-distinct-id'
      )

      expect(payload).toEqual({
        distinctId: 'mobile-distinct-id',
        event: 'affiliate_cta_shown',
        properties: {
          partner_id: 'sample-partner',
          scenario: 'morning',
          surface: 'mobile_hero',
          locale_region: 'US',
          recommendation_id: 'morning-outfit-id',
        },
      })
    })

    it('5.1-CONTRACT-17 builds affiliate_cta_clicked on the HMAC subject, never a raw user id', () => {
      const payload = trackAffiliateCtaClicked({
        analyticsSubjectId: 'hmac-subject-1',
        partnerId: 'sample-partner',
        offerId: 'offer-fixture-1',
        scenario: 'evening',
        surface: 'mobile_hero',
        localeRegion: '419',
        recommendationId: 'evening-outfit-id',
      })

      expect(payload.distinctId).toBe('hmac-subject-1')
      expect(payload.event).toBe('affiliate_cta_clicked')
      expect(payload.properties).toEqual({
        partner_id: 'sample-partner',
        offer_id: 'offer-fixture-1',
        scenario: 'evening',
        surface: 'mobile_hero',
        // A UN M.49 macro-region, not a country code.
        locale_region: '419',
        recommendation_id: 'evening-outfit-id',
      })
    })

    it('5.1-CONTRACT-18 falls back to the partner slug when a conversion matches no click', () => {
      const matched = trackAffiliateConversionRecorded({
        analyticsSubjectId: 'hmac-subject-1',
        partnerId: 'sample-partner',
        status: 'confirmed',
        currency: 'USD',
        orderValueMinorUnits: 12_900,
        matched: true,
      })
      const unmatched = trackAffiliateConversionRecorded({
        analyticsSubjectId: 'sample-partner',
        partnerId: 'sample-partner',
        status: 'pending',
        currency: 'EUR',
        orderValueMinorUnits: 0,
        matched: false,
      })

      expect(matched.distinctId).toBe('hmac-subject-1')
      expect(matched.properties).toMatchObject({ matched: true, currency: 'USD' })
      // An unmatched conversion has no user subject at all, so the partner slug
      // stands in and `matched` records why.
      expect(unmatched.distinctId).toBe('sample-partner')
      expect(unmatched.properties).toMatchObject({
        matched: false,
        order_value_minor_units: 0,
      })
    })

    it('5.1-CONTRACT-19 rejects a locale region outside the sentinel or subtag shape', () => {
      for (const localeRegion of ['us', 'UNITED', '', 'U']) {
        expect(() =>
          trackAffiliateCtaShown(
            {
              partnerId: 'sample-partner',
              scenario: 'morning',
              surface: 'mobile_hero',
              localeRegion,
              recommendationId: 'morning-outfit-id',
            },
            'mobile-distinct-id'
          )
        ).toThrow()
      }

      // The '*' sentinel means "published globally" and must stay valid.
      expect(
        trackAffiliateCtaShown(
          {
            partnerId: 'sample-partner',
            scenario: 'morning',
            surface: 'mobile_hero',
            localeRegion: '*',
            recommendationId: 'morning-outfit-id',
          },
          'mobile-distinct-id'
        ).properties.locale_region
      ).toBe('*')
    })
  })

  describe('privacy allowlists', () => {
    const ALLOWLISTS = [
      ['affiliate_cta_shown', affiliateCtaShownPropertiesSchema] as const,
      ['affiliate_cta_clicked', affiliateCtaClickedPropertiesSchema] as const,
      [
        'affiliate_conversion_recorded',
        affiliateConversionRecordedPropertiesSchema,
      ] as const,
    ]

    const VALID_PROPERTIES: Record<string, Record<string, unknown>> = {
      affiliate_cta_shown: {
        partner_id: 'sample-partner',
        scenario: 'morning',
        surface: 'mobile_hero',
        locale_region: 'US',
        recommendation_id: 'morning-outfit-id',
      },
      affiliate_cta_clicked: {
        partner_id: 'sample-partner',
        offer_id: 'offer-fixture-1',
        scenario: 'morning',
        surface: 'mobile_hero',
        locale_region: 'US',
        recommendation_id: 'morning-outfit-id',
      },
      affiliate_conversion_recorded: {
        partner_id: 'sample-partner',
        status: 'confirmed',
        currency: 'USD',
        order_value_minor_units: 12_900,
        matched: true,
      },
    }

    for (const [event, schema] of ALLOWLISTS) {
      it(`5.1-CONTRACT-20 ${event} accepts its own allowlist`, () => {
        expect(schema.parse(VALID_PROPERTIES[event])).toEqual(VALID_PROPERTIES[event])
      })

      for (const forbidden of DISALLOWED_ANALYTICS_PROPERTY_FIXTURES) {
        const field = Object.keys(forbidden)[0] ?? 'unknown'
        it(`5.1-CONTRACT-21 ${event} rejects ${field}`, () => {
          // The allowlists are `.strict()`, so this is real enforcement rather
          // than a convention: a caller that attaches a URL, a product title, a
          // garment id, or a raw user id gets a parse failure at the wrapper
          // instead of a silent leak into PostHog.
          expect(() =>
            schema.parse({ ...VALID_PROPERTIES[event], ...forbidden })
          ).toThrow()
        })
      }
    }
  })
})
