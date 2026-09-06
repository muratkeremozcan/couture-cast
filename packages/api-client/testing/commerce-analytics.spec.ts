// Learning path Step 33: Affiliate "Shop this look" CTA.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-33-affiliate-shop-this-look-cta
import { describe, expect, it } from 'vitest'

import {
  affiliateConversionRecordedPropertiesSchema,
  affiliateCtaClickedPropertiesSchema,
  affiliateCtaShownPropertiesSchema,
  trackAffiliateConversionRecorded,
  trackAffiliateCtaClicked,
  trackAffiliateCtaShown,
} from '../src/types/analytics-events'
import { DISALLOWED_ANALYTICS_PROPERTY_FIXTURES } from '../src/testing/commerce-fixtures'

/**
 * Story 5.1 commerce analytics wrappers.
 *
 * Parsing a property schema is NOT the same as exercising the wrapper that
 * feeds it. The wrappers are where distinctId is chosen, where the camelCase
 * event is mapped onto snake_case properties, and where a bad locale region is
 * rejected, and none of that is reachable by parsing the schema directly.
 */

describe('5.1 commerce analytics wrappers', () => {
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
          // The allowlists are `.strict()`, so a caller that attaches a URL, a
          // product title, a garment id, or a raw user id gets a parse failure
          // at the wrapper before anything reaches PostHog.
          expect(() =>
            schema.parse({ ...VALID_PROPERTIES[event], ...forbidden })
          ).toThrow()
        })
      }
    }
  })
})
