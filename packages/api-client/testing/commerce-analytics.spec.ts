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
 * Two things are under test, and the second is the one that matters.
 *
 * The mapping: each wrapper converts a camelCase event into the snake_case
 * property names PostHog receives, and picks the right `distinctId`.
 *
 * The privacy rule: every property schema is `.strict()`, which is the
 * enforcement point for "no URL, no product title, no garment id, no raw user
 * id, no free text ever reaches an analytics property". A `.strict()` schema
 * only actually enforces that if something exercises the rejection, which is
 * what the negative fixtures below do.
 */

const SUBJECT = 'hmac-pseudonym-subject'

describe('trackAffiliateCtaShown', () => {
  const event = {
    partnerId: 'sample-partner',
    scenario: 'morning' as const,
    surface: 'mobile_hero' as const,
    localeRegion: 'US',
    recommendationId: 'outfit-1',
  }

  it('takes its distinctId from the caller, because the client owns its own identity', () => {
    // This is the one commerce event with no server subject: a mobile client
    // cannot compute the server-side HMAC, so the analytics client's own
    // distinctId is passed in rather than read off the event.
    const payload = trackAffiliateCtaShown(event, 'mobile-device-distinct-id')

    expect(payload.distinctId).toBe('mobile-device-distinct-id')
    expect(payload.event).toBe('affiliate_cta_shown')
    expect(payload.properties).toEqual({
      partner_id: 'sample-partner',
      scenario: 'morning',
      surface: 'mobile_hero',
      locale_region: 'US',
      recommendation_id: 'outfit-1',
    })
  })

  it('accepts the global publication sentinel as a locale region', () => {
    const payload = trackAffiliateCtaShown({ ...event, localeRegion: '*' }, 'device-1')

    expect(payload.properties.locale_region).toBe('*')
  })

  it('accepts a UN M.49 macro-region subtag', () => {
    // `es-419` resolves to '419', which is three characters and not a country.
    const payload = trackAffiliateCtaShown({ ...event, localeRegion: '419' }, 'device-1')

    expect(payload.properties.locale_region).toBe('419')
  })

  it.each([
    { name: 'an unknown scenario', patch: { scenario: 'afternoon' } },
    { name: 'an unknown surface', patch: { surface: 'web_hero' } },
    { name: 'a lowercase locale region', patch: { localeRegion: 'us' } },
    { name: 'an over-long locale region', patch: { localeRegion: 'USAA' } },
    { name: 'an empty partner id', patch: { partnerId: '' } },
  ])('rejects $name', ({ patch }) => {
    expect(() =>
      trackAffiliateCtaShown({ ...event, ...patch } as typeof event, 'device-1')
    ).toThrow()
  })
})

describe('trackAffiliateCtaClicked', () => {
  const event = {
    analyticsSubjectId: SUBJECT,
    partnerId: 'sample-partner',
    offerId: 'offer-1',
    scenario: 'midday' as const,
    surface: 'mobile_hero' as const,
    localeRegion: 'CA',
    recommendationId: 'outfit-2',
  }

  it('publishes under the HMAC pseudonym and never a raw user id', () => {
    const payload = trackAffiliateCtaClicked(event)

    expect(payload.distinctId).toBe(SUBJECT)
    expect(payload.event).toBe('affiliate_cta_clicked')
    expect(payload.properties).toEqual({
      partner_id: 'sample-partner',
      offer_id: 'offer-1',
      scenario: 'midday',
      surface: 'mobile_hero',
      locale_region: 'CA',
      recommendation_id: 'outfit-2',
    })
    // The subject is the only identity in the payload, and it is not a user id.
    expect(JSON.stringify(payload.properties)).not.toContain(SUBJECT)
  })

  it('rejects an empty analytics subject', () => {
    expect(() => trackAffiliateCtaClicked({ ...event, analyticsSubjectId: '' })).toThrow()
  })
})

describe('trackAffiliateConversionRecorded', () => {
  const matched = {
    analyticsSubjectId: SUBJECT,
    partnerId: 'sample-partner',
    status: 'confirmed' as const,
    currency: 'USD',
    orderValueMinorUnits: 12_900,
    matched: true,
  }

  it('publishes a matched conversion under the click owner pseudonym', () => {
    const payload = trackAffiliateConversionRecorded(matched)

    expect(payload.distinctId).toBe(SUBJECT)
    expect(payload.event).toBe('affiliate_conversion_recorded')
    expect(payload.properties).toEqual({
      partner_id: 'sample-partner',
      status: 'confirmed',
      currency: 'USD',
      order_value_minor_units: 12_900,
      matched: true,
    })
  })

  it('publishes an unmatched conversion under the partner slug', () => {
    // An unknown click token leaves no user subject at all, so the caller passes
    // the partner slug as the subject. It is operator-controlled and carries no
    // personal data.
    const payload = trackAffiliateConversionRecorded({
      ...matched,
      analyticsSubjectId: 'sample-partner',
      matched: false,
    })

    expect(payload.distinctId).toBe('sample-partner')
    expect(payload.properties.matched).toBe(false)
  })

  it.each(['pending', 'confirmed', 'reversed'] as const)(
    'accepts the %s status',
    (status) => {
      expect(
        trackAffiliateConversionRecorded({ ...matched, status }).properties.status
      ).toBe(status)
    }
  )

  it('accepts a zero order value', () => {
    const payload = trackAffiliateConversionRecorded({
      ...matched,
      orderValueMinorUnits: 0,
    })

    expect(payload.properties.order_value_minor_units).toBe(0)
  })

  it.each([
    { name: 'a negative order value', patch: { orderValueMinorUnits: -1 } },
    { name: 'a fractional order value', patch: { orderValueMinorUnits: 129.5 } },
    { name: 'a lowercase currency', patch: { currency: 'usd' } },
    { name: 'a non ISO 4217 currency', patch: { currency: 'DOLLAR' } },
    { name: 'an unknown status', patch: { status: 'refunded' } },
  ])('rejects $name', ({ patch }) => {
    // Floating-point money is prohibited repo-wide, and the schema is where that
    // rule is actually enforced rather than merely documented.
    expect(() =>
      trackAffiliateConversionRecorded({ ...matched, ...patch } as typeof matched)
    ).toThrow()
  })
})

describe('the privacy allowlist on every commerce property schema', () => {
  const schemas = [
    {
      name: 'affiliate_cta_shown',
      schema: affiliateCtaShownPropertiesSchema,
      valid: {
        partner_id: 'sample-partner',
        scenario: 'morning',
        surface: 'mobile_hero',
        locale_region: 'US',
        recommendation_id: 'outfit-1',
      },
    },
    {
      name: 'affiliate_cta_clicked',
      schema: affiliateCtaClickedPropertiesSchema,
      valid: {
        partner_id: 'sample-partner',
        offer_id: 'offer-1',
        scenario: 'morning',
        surface: 'mobile_hero',
        locale_region: 'US',
        recommendation_id: 'outfit-1',
      },
    },
    {
      name: 'affiliate_conversion_recorded',
      schema: affiliateConversionRecordedPropertiesSchema,
      valid: {
        partner_id: 'sample-partner',
        status: 'confirmed',
        currency: 'USD',
        order_value_minor_units: 12_900,
        matched: true,
      },
    },
  ]

  it.each(schemas)(
    '$name accepts exactly its allowlisted properties',
    ({ schema, valid }) => {
      expect(schema.parse(valid)).toEqual(valid)
    }
  )

  for (const { name, schema, valid } of schemas) {
    it.each(DISALLOWED_ANALYTICS_PROPERTY_FIXTURES)(
      `${name} rejects %o`,
      (disallowed: Record<string, unknown>) => {
        // `.strict()` is what makes this fail rather than silently forwarding the
        // extra field to PostHog. Without a test that exercises it, the rule is a
        // comment.
        expect(() => schema.parse({ ...valid, ...disallowed })).toThrow()
      }
    )
  }
})
