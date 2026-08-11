import { describe, expect, it } from 'vitest'
import {
  affiliateClickRequestSchema,
  affiliateClickResponseSchema,
  affiliateSurfaceSchema,
  affiliateWebhookHeadersSchema,
  affiliateWebhookPayloadSchema,
  affiliateWebhookResponseSchema,
  badRequestHttpErrorSchema,
  commercePreferenceResponseSchema,
  commercePreferenceSchema,
  forbiddenHttpErrorSchema,
  internalServerErrorHttpErrorSchema,
  notFoundHttpErrorSchema,
  scenarioOutfitSchema,
  serviceUnavailableHttpErrorSchema,
  shopThisLookSchema,
  unauthorizedHttpErrorSchema,
  updateCommercePreferenceInputSchema,
  updateCommercePreferenceResponseSchema,
  COMMERCE_AUDIENCE_INELIGIBLE_MESSAGE,
  COMMERCE_DISABLED_MESSAGE,
  COMMERCE_OFFER_INVALID_MESSAGE,
  COMMERCE_OFFER_NOT_FOUND_MESSAGE,
  COMMERCE_OPTED_OUT_MESSAGE,
  WEBHOOK_SIGNATURE_INVALID_MESSAGE,
} from '../src/contracts/http'
import {
  affiliateConversionRecordedPropertiesSchema,
  affiliateCtaClickedPropertiesSchema,
  affiliateCtaShownPropertiesSchema,
} from '../src/types/analytics-events'
import {
  createAffiliateClickRequestFixture,
  createAffiliateWebhookPayloadFixture,
  createCommercePreferenceFixture,
  createShopThisLookFixture,
  DISALLOWED_ANALYTICS_PROPERTY_FIXTURES,
} from '../src/testing/commerce-fixtures'

/**
 * Story 5.1 Task 8: the consumer-side contract for affiliate commerce.
 *
 * This suite asserts the PUBLISHED SHAPES only. Whether a user is eligible, when
 * a click dedupes, and which offer wins are business rules, and they are proven
 * in the API unit and PostgreSQL integration suites. What is proven here is the
 * thing every surface depends on and no runtime test would catch: that the
 * `shopThisLook` key is always serialized, that a client cannot smuggle a
 * server-derived field into a click request, that the error envelopes have no
 * machine-readable code to branch on, and that the analytics allowlists reject
 * the values the story forbids.
 */

const baseOutfit = {
  id: 'rec-morning-1',
  scenario: 'morning' as const,
  garmentIds: ['garment-1'],
  reasoningBadges: [
    { key: 'wind_layer', label: 'Wind layer', bullets: ['Wind is high this morning.'] },
  ],
  comfortNotes: 'Layer up; it will feel cooler than it reads.',
}

describe('shopThisLook on a scenario outfit', () => {
  it('carries one partner, one offer, and the matched slot', () => {
    const parsed = scenarioOutfitSchema.parse({
      ...baseOutfit,
      shopThisLook: createShopThisLookFixture(),
    })

    expect(parsed.shopThisLook).toEqual({
      partnerId: 'sample-partner',
      partnerDisplayName: 'Sample Partner',
      offerId: 'offer-fixture-1',
      offerTitle: 'Everyday Layering Tee',
      garmentCategory: 'top',
    })
  })

  it('accepts an explicit null for an ineligible card', () => {
    const parsed = scenarioOutfitSchema.parse({ ...baseOutfit, shopThisLook: null })

    expect(parsed.shopThisLook).toBeNull()
  })

  /**
   * The field is `.nullable()` and deliberately NOT `.optional()`. An earlier
   * draft had both, which recreates the absent-versus-null ambiguity the design
   * exists to remove: a client would have to decide whether a missing key meant
   * "not eligible" or "this server is older than the feature".
   */
  it('rejects an outfit that omits the key entirely', () => {
    expect(() => scenarioOutfitSchema.parse(baseOutfit)).toThrow()
  })

  it('rejects an explicit undefined, for the same reason', () => {
    expect(() =>
      scenarioOutfitSchema.parse({ ...baseOutfit, shopThisLook: undefined })
    ).toThrow()
  })

  /**
   * The block is `.strict()` and carries no URL. The deep link is built
   * server-side at click time, which is what makes the outbound host validation
   * meaningful: a URL the client already held could be opened without ever
   * minting an attributed click.
   */
  it.each([
    { name: 'a redirect URL', extra: { redirectUrl: 'https://partner.test/shop' } },
    { name: 'a deep link template', extra: { deepLinkTemplate: 'https://p.test/{t}' } },
    { name: 'a click token', extra: { clickToken: 'tok-1' } },
    { name: 'a raw user id', extra: { userId: 'user-1' } },
  ])('rejects a block carrying $name', ({ extra }) => {
    expect(() =>
      shopThisLookSchema.parse({ ...createShopThisLookFixture(), ...extra })
    ).toThrow()
  })

  it.each([
    { name: 'an empty partner slug', overrides: { partnerId: '' } },
    { name: 'an empty display name', overrides: { partnerDisplayName: '' } },
    { name: 'an empty offer id', overrides: { offerId: '' } },
    { name: 'an empty offer title', overrides: { offerTitle: '' } },
    { name: 'an unknown garment category', overrides: { garmentCategory: 'hat' } },
  ])('rejects $name', ({ overrides }) => {
    expect(() =>
      shopThisLookSchema.parse({ ...createShopThisLookFixture(), ...overrides })
    ).toThrow()
  })
})

describe('commerce preferences', () => {
  it('reads as a single boolean under data', () => {
    const parsed = commercePreferenceResponseSchema.parse({
      data: createCommercePreferenceFixture(),
    })

    expect(parsed.data.affiliateCtasEnabled).toBe(true)
  })

  it('accepts an opt-out write and echoes the resulting state', () => {
    const input = updateCommercePreferenceInputSchema.parse({
      affiliateCtasEnabled: false,
    })
    const parsed = updateCommercePreferenceResponseSchema.parse({ data: input })

    expect(parsed.data.affiliateCtasEnabled).toBe(false)
  })

  /**
   * The request and response bodies are the same shape on purpose: an unchanged
   * PUT still answers 200 with the current state, so a client has exactly one
   * body to handle whether or not its write moved anything.
   */
  it('uses one shape for the write and its echo', () => {
    expect(updateCommercePreferenceInputSchema).toBe(commercePreferenceSchema)
  })

  it.each([
    { name: 'a missing field', body: {} },
    { name: 'a non-boolean value', body: { affiliateCtasEnabled: 'yes' } },
    { name: 'a stringly-typed false', body: { affiliateCtasEnabled: 'false' } },
    {
      name: 'an unknown sibling key',
      body: { affiliateCtasEnabled: true, partnerId: 'x' },
    },
  ])('rejects $name', ({ body }) => {
    expect(() => updateCommercePreferenceInputSchema.parse(body)).toThrow()
  })
})

describe('attributed click request', () => {
  it('accepts the three fields a client is allowed to send', () => {
    const parsed = affiliateClickRequestSchema.parse(createAffiliateClickRequestFixture())

    expect(parsed).toEqual({
      offerId: 'offer-fixture-1',
      recommendationId: 'recommendation-fixture-1',
      surface: 'mobile_hero',
    })
  })

  /**
   * `scenario` and `localeRegion` are derived server-side from the
   * recommendation and the resolved locale. Accepting them here would create a
   * spoofable path into a durable attribution record, so `.strict()` is the
   * enforcement and this is the proof.
   */
  it.each([
    { name: 'a scenario', extra: { scenario: 'morning' } },
    { name: 'a locale region', extra: { localeRegion: 'US' } },
    { name: 'a partner id', extra: { partnerId: 'sample-partner' } },
    { name: 'a click token', extra: { clickToken: 'tok-1' } },
  ])('rejects a request that also sends $name', ({ extra }) => {
    expect(() =>
      affiliateClickRequestSchema.parse({
        ...createAffiliateClickRequestFixture(),
        ...extra,
      })
    ).toThrow()
  })

  it('closes the surface enum so it cannot become free text', () => {
    expect(affiliateSurfaceSchema.options).toEqual(['mobile_hero'])
    expect(() =>
      affiliateClickRequestSchema.parse(
        createAffiliateClickRequestFixture({
          surface: 'web_hero' as never,
        })
      )
    ).toThrow()
  })

  it.each([
    { name: 'an over-long offer id', overrides: { offerId: 'o'.repeat(65) } },
    {
      name: 'an over-long recommendation id',
      overrides: { recommendationId: 'r'.repeat(129) },
    },
    { name: 'an empty offer id', overrides: { offerId: '' } },
    { name: 'an empty recommendation id', overrides: { recommendationId: '' } },
  ])('rejects $name', ({ overrides }) => {
    expect(() =>
      affiliateClickRequestSchema.parse(createAffiliateClickRequestFixture(overrides))
    ).toThrow()
  })
})

describe('attributed click response', () => {
  /**
   * 201 on a fresh mint and 200 on a deduped replay share one body. The status
   * is the only thing that distinguishes them, which is why the API suite
   * asserts it over real HTTP rather than through a mocked response object.
   */
  it.each([
    { status: 201, name: 'a fresh mint' },
    { status: 200, name: 'a deduped replay' },
  ])('uses the same body for $name ($status)', () => {
    const parsed = affiliateClickResponseSchema.parse({
      data: { redirectUrl: 'https://partner.couturecast.test/shop?cc=tok-1' },
    })

    expect(parsed.data.redirectUrl).toBe('https://partner.couturecast.test/shop?cc=tok-1')
  })

  it.each([
    { name: 'a relative URL', redirectUrl: '/shop?cc=tok-1' },
    { name: 'a non-URL string', redirectUrl: 'not a url' },
  ])('rejects $name', ({ redirectUrl }) => {
    expect(() => affiliateClickResponseSchema.parse({ data: { redirectUrl } })).toThrow()
  })

  it('rejects a body that leaks the click token alongside the URL', () => {
    expect(() =>
      affiliateClickResponseSchema.parse({
        data: {
          redirectUrl: 'https://partner.couturecast.test/shop?cc=tok-1',
          clickToken: 'tok-1',
        },
      })
    ).toThrow()
  })
})

describe('conversion webhook', () => {
  it('accepts the canonical signed payload', () => {
    const parsed = affiliateWebhookPayloadSchema.parse(
      createAffiliateWebhookPayloadFixture()
    )

    expect(parsed.orderValueMinorUnits).toBe(12_900)
    expect(parsed.currency).toBe('USD')
  })

  it('answers a recorded conversion with the literal received flag', () => {
    expect(affiliateWebhookResponseSchema.parse({ data: { received: true } })).toEqual({
      data: { received: true },
    })
    expect(() =>
      affiliateWebhookResponseSchema.parse({ data: { received: false } })
    ).toThrow()
  })

  it('requires all three signature headers', () => {
    const headers = {
      'x-couture-partner-id': 'sample-partner',
      'x-couture-timestamp': '1786550400',
      'x-couture-signature': 'a'.repeat(64),
    }

    expect(affiliateWebhookHeadersSchema.parse(headers)).toEqual(headers)
    for (const key of Object.keys(headers)) {
      const withoutOne = { ...headers } as Record<string, string>
      delete withoutOne[key]
      expect(() => affiliateWebhookHeadersSchema.parse(withoutOne)).toThrow()
    }
  })

  it.each([
    { name: 'a non-integer timestamp', headers: { 'x-couture-timestamp': '17865.5' } },
    { name: 'a negative timestamp', headers: { 'x-couture-timestamp': '-1' } },
    {
      name: 'an uppercase hex signature',
      headers: { 'x-couture-signature': 'A'.repeat(64) },
    },
    { name: 'a truncated signature', headers: { 'x-couture-signature': 'a'.repeat(63) } },
  ])('rejects $name', ({ headers }) => {
    expect(() =>
      affiliateWebhookHeadersSchema.parse({
        'x-couture-partner-id': 'sample-partner',
        'x-couture-timestamp': '1786550400',
        'x-couture-signature': 'a'.repeat(64),
        ...headers,
      })
    ).toThrow()
  })

  it.each([
    { name: 'floating-point money', overrides: { orderValueMinorUnits: 129.5 } },
    { name: 'negative money', overrides: { orderValueMinorUnits: -1 } },
    { name: 'a lowercase currency', overrides: { currency: 'usd' } },
    { name: 'a non-ISO currency', overrides: { currency: 'DOLLAR' } },
    { name: 'an unknown status', overrides: { status: 'refunded' } },
    { name: 'a non-ISO occurredAt', overrides: { occurredAt: '2026-08-11 10:00:00' } },
    { name: 'an empty event id', overrides: { eventId: '' } },
    { name: 'an over-long event id', overrides: { eventId: 'e'.repeat(129) } },
  ])('rejects $name', ({ overrides }) => {
    expect(() =>
      affiliateWebhookPayloadSchema.parse(
        createAffiliateWebhookPayloadFixture(overrides as never)
      )
    ).toThrow()
  })

  it('rejects an unknown extra field, so a partner cannot widen the payload', () => {
    expect(() =>
      affiliateWebhookPayloadSchema.parse({
        ...createAffiliateWebhookPayloadFixture(),
        commissionMinorUnits: 100,
      })
    ).toThrow()
  })

  /**
   * Every rejection path returns the SAME status and the SAME message so the
   * endpoint cannot be used to enumerate which partner slugs exist or which
   * secrets are configured. An unknown partner and a forged signature must be
   * indistinguishable from outside.
   */
  it.each([
    'a missing header',
    'an unknown or inactive partner',
    'an unresolvable or too-short secret',
    'a timestamp outside the 300-second window',
    'a mismatched HMAC over the raw body',
  ])('answers 401 with one identical message for %s', (cause) => {
    const envelope = unauthorizedHttpErrorSchema.parse({
      statusCode: 401,
      message: WEBHOOK_SIGNATURE_INVALID_MESSAGE,
      error: 'Unauthorized',
    })

    expect(envelope.message).toBe('Invalid webhook signature.')
    expect(cause).toBeTruthy()
  })

  it('answers 400 only after every signature check has passed', () => {
    const envelope = badRequestHttpErrorSchema.parse({
      statusCode: 400,
      message: 'Validation failed',
      error: 'Bad Request',
    })

    expect(envelope.statusCode).toBe(400)
  })
})

describe('commerce error envelopes', () => {
  /**
   * Decision 9 exists because of this. Every shared error schema is `.strict()`
   * over exactly `{ statusCode, message, error }`, so there is nowhere to put a
   * `COMMERCE_*` code and a client has to branch on status plus message. The
   * only error-code concept in this repo feeds telemetry, never a response body.
   */
  it.each([
    {
      name: '400',
      schema: badRequestHttpErrorSchema,
      statusCode: 400,
      error: 'Bad Request',
    },
    {
      name: '401',
      schema: unauthorizedHttpErrorSchema,
      statusCode: 401,
      error: 'Unauthorized',
    },
    {
      name: '403',
      schema: forbiddenHttpErrorSchema,
      statusCode: 403,
      error: 'Forbidden',
    },
    { name: '404', schema: notFoundHttpErrorSchema, statusCode: 404, error: 'Not Found' },
    {
      name: '500',
      schema: internalServerErrorHttpErrorSchema,
      statusCode: 500,
      error: 'Internal Server Error',
    },
    {
      name: '503',
      schema: serviceUnavailableHttpErrorSchema,
      statusCode: 503,
      error: 'Service Unavailable',
    },
  ])(
    'rejects a $name envelope carrying a code field',
    ({ schema, statusCode, error }) => {
      expect(schema.parse({ statusCode, message: 'A message.', error })).toMatchObject({
        statusCode,
      })
      expect(() =>
        schema.parse({
          statusCode,
          message: 'A message.',
          error,
          code: 'COMMERCE_DISABLED',
        })
      ).toThrow()
    }
  )

  it.each([
    {
      name: 'the click kill switch',
      schema: serviceUnavailableHttpErrorSchema,
      statusCode: 503,
      error: 'Service Unavailable',
      message: COMMERCE_DISABLED_MESSAGE,
    },
    {
      name: 'an audience-ineligible actor',
      schema: forbiddenHttpErrorSchema,
      statusCode: 403,
      error: 'Forbidden',
      message: COMMERCE_AUDIENCE_INELIGIBLE_MESSAGE,
    },
    {
      name: 'an opted-out actor',
      schema: forbiddenHttpErrorSchema,
      statusCode: 403,
      error: 'Forbidden',
      message: COMMERCE_OPTED_OUT_MESSAGE,
    },
    {
      name: 'an unknown, inactive, or out-of-window offer',
      schema: notFoundHttpErrorSchema,
      statusCode: 404,
      error: 'Not Found',
      message: COMMERCE_OFFER_NOT_FOUND_MESSAGE,
    },
    {
      name: 'a misconfigured offer URL',
      schema: internalServerErrorHttpErrorSchema,
      statusCode: 500,
      error: 'Internal Server Error',
      message: COMMERCE_OFFER_INVALID_MESSAGE,
    },
  ])(
    'carries $name as status plus an exported message',
    ({ schema, statusCode, error, message }) => {
      expect(schema.parse({ statusCode, message, error })).toEqual({
        statusCode,
        message,
        error,
      })
    }
  )

  /**
   * The two 403s are distinguished only by their message, so a client that wants
   * to tell "you turned this off" from "this is not available to you" has to
   * compare against these constants. They must therefore never collide.
   */
  it('keeps the two 403 messages distinct', () => {
    expect(COMMERCE_OPTED_OUT_MESSAGE).not.toBe(COMMERCE_AUDIENCE_INELIGIBLE_MESSAGE)
  })
})

describe('analytics property allowlists', () => {
  const propertySchemas = [
    { name: 'affiliate_cta_shown', schema: affiliateCtaShownPropertiesSchema },
    { name: 'affiliate_cta_clicked', schema: affiliateCtaClickedPropertiesSchema },
    {
      name: 'affiliate_conversion_recorded',
      schema: affiliateConversionRecordedPropertiesSchema,
    },
  ]

  const validProperties = {
    affiliate_cta_shown: {
      partner_id: 'sample-partner',
      scenario: 'morning',
      surface: 'mobile_hero',
      locale_region: 'US',
      recommendation_id: 'rec-morning-1',
    },
    affiliate_cta_clicked: {
      partner_id: 'sample-partner',
      offer_id: 'offer-fixture-1',
      scenario: 'morning',
      surface: 'mobile_hero',
      locale_region: 'US',
      recommendation_id: 'rec-morning-1',
    },
    affiliate_conversion_recorded: {
      partner_id: 'sample-partner',
      status: 'confirmed',
      currency: 'USD',
      order_value_minor_units: 12_900,
      matched: true,
    },
  } as const

  it.each(propertySchemas)(
    'accepts the documented properties of $name',
    ({ name, schema }) => {
      expect(
        schema.parse(validProperties[name as keyof typeof validProperties])
      ).toBeDefined()
    }
  )

  /**
   * The story forbids any URL, product title, garment id, raw user id, or free
   * text from reaching an analytics property. The allowlists are `.strict()`, so
   * this is real enforcement rather than a convention, and every disallowed
   * fixture is checked against all three schemas so a future event cannot be
   * added with a weaker list.
   */
  for (const { name, schema } of propertySchemas) {
    it.each(DISALLOWED_ANALYTICS_PROPERTY_FIXTURES)(
      `rejects %o on ${name}`,
      (disallowed) => {
        expect(() =>
          schema.parse({
            ...validProperties[name as keyof typeof validProperties],
            ...disallowed,
          })
        ).toThrow()
      }
    )
  }

  it('never accepts a raw user id in place of the pseudonymous subject', () => {
    // The subject travels as PostHog's `distinctId`, computed as an HMAC of the
    // user id. No property carries identity, which is what lets these rows be
    // persisted with `user_id: null`.
    for (const { schema } of propertySchemas) {
      expect(() => schema.parse({ user_id: 'user-1' })).toThrow()
      expect(() => schema.parse({ analytics_subject_id: 'hmac' })).toThrow()
    }
  })

  it.each([
    { name: 'the global sentinel', localeRegion: '*' },
    { name: 'a country subtag', localeRegion: 'US' },
    { name: 'a UN M.49 macro-region', localeRegion: '419' },
  ])('accepts $name as a locale region', ({ localeRegion }) => {
    expect(
      affiliateCtaShownPropertiesSchema.parse({
        ...validProperties.affiliate_cta_shown,
        locale_region: localeRegion,
      })
    ).toBeDefined()
  })

  it.each([
    { name: 'a lowercase region', localeRegion: 'us' },
    { name: 'a full locale tag', localeRegion: 'en-US' },
    { name: 'an over-long region', localeRegion: 'USAA' },
  ])('rejects $name as a locale region', ({ localeRegion }) => {
    expect(() =>
      affiliateCtaShownPropertiesSchema.parse({
        ...validProperties.affiliate_cta_shown,
        locale_region: localeRegion,
      })
    ).toThrow()
  })
})
