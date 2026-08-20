import type { PactV4, V3MockServer } from '@pact-foundation/pact'
import { createProviderState, setJsonContent } from '@seontechnologies/pactjs-utils'
import {
  COMMERCE_AUDIENCE_INELIGIBLE_MESSAGE,
  COMMERCE_DISABLED_MESSAGE,
  COMMERCE_OFFER_NOT_FOUND_MESSAGE,
  COMMERCE_OPTED_OUT_MESSAGE,
  WEBHOOK_SIGNATURE_INVALID_MESSAGE,
  affiliateClickResponseSchema,
  affiliateWebhookResponseSchema,
  commercePreferenceResponseSchema,
  updateCommercePreferenceResponseSchema,
} from '@couture/api-client/contracts/http'
import { expect } from 'vitest'
import {
  eachLike,
  equal,
  like,
  pactEventAuth,
  pactEventHeaders,
  string,
  type CreateClient,
} from './shared'

/* ---------------------------------------------------------------------------
 * Story 5.1 affiliate commerce.
 *
 * These interactions record what a client must UNDERSTAND: the shape of the
 * `shopThisLook` block on a ritual card, the preference read and write, the
 * 201-versus-200 split on a minted click, and every status the webhook can
 * answer. They deliberately do not attempt to prove the rules behind those
 * statuses. Eligibility order, the 60-second dedupe window, and the five-step
 * signature verification are asserted where a real database and a real HMAC
 * exist, in the API unit suite and in
 * `apps/api/integration/commerce-affiliate-*.integration.spec.ts`.
 *
 * Every identifier below is mirrored in `pact/http/provider/provider-helper.ts`.
 * Both sides must agree or the pinned `string()` matchers fail verification.
 * ------------------------------------------------------------------------- */

const COMMERCE_PARTNER_SLUG = 'sample-partner'
const COMMERCE_PARTNER_NAME = 'Sample Partner'
const COMMERCE_OFFER_ID = 'offer-pact-1'
const COMMERCE_OFFER_TITLE = 'Everyday Layering Tee'
const COMMERCE_RECOMMENDATION_ID = 'rec-morning-1'
const COMMERCE_REDIRECT_URL = 'https://partner.couturecast.test/shop?cc=pact-click-token'

/**
 * A syntactically valid signature, not a real HMAC. The consumer has no partner
 * secret and could not compute one; what this pins is the header FORMAT the
 * contract publishes (lowercase hex, 64 characters), which is the part a client
 * can get wrong. Whether the bytes verify is the provider's business.
 */
const COMMERCE_WEBHOOK_SIGNATURE = 'a'.repeat(64)
const COMMERCE_WEBHOOK_TIMESTAMP = '1786550400'
const COMMERCE_WEBHOOK_EVENT_ID = 'evt-pact-1'
const COMMERCE_WEBHOOK_CLICK_TOKEN = 'pact-click-token'
const COMMERCE_WEBHOOK_OCCURRED_AT = '2026-08-11T10:00:00.000Z'

const commerceWebhookHeaders = {
  'x-couture-partner-id': COMMERCE_PARTNER_SLUG,
  'x-couture-timestamp': COMMERCE_WEBHOOK_TIMESTAMP,
  'x-couture-signature': COMMERCE_WEBHOOK_SIGNATURE,
}

const commerceWebhookPayload = {
  eventId: COMMERCE_WEBHOOK_EVENT_ID,
  clickToken: COMMERCE_WEBHOOK_CLICK_TOKEN,
  occurredAt: COMMERCE_WEBHOOK_OCCURRED_AT,
  status: 'confirmed' as const,
  orderValueMinorUnits: 12_900,
  currency: 'USD',
}

const affiliateClickRequestBody = {
  offerId: COMMERCE_OFFER_ID,
  recommendationId: COMMERCE_RECOMMENDATION_ID,
  surface: 'mobile_hero' as const,
}

/**
 * A ritual card carrying a populated commerce block.
 *
 * The pre-existing ritual interaction pins `shopThisLook: null`, which is the
 * common path and proves the key is always serialized. This one proves the other
 * branch: five fields, one partner, and NO URL. The deep link is built
 * server-side on click and never reaches a client, which is what makes the
 * outbound host validation meaningful.
 *
 * This does NOT subsume `verifyRitualInteraction`. That one pins three positional
 * outfits and so carries the "exactly one card per scenario" invariant; this one
 * uses `eachLike` because what it is here to record is the block's shape, not the
 * array's arity. Deleting the sibling would silently drop that invariant from the
 * contract.
 */
export async function verifyRitualEligibleShopThisLookInteraction(
  pact: PactV4,
  createClient: CreateClient
) {
  await pact
    .addInteraction()
    .given(
      ...createProviderState({
        name: 'An eligible affiliate offer matches the outfit for user',
        params: { userId: pactEventAuth.userId },
      })
    )
    .uponReceiving('a request for a ritual whose cards carry an affiliate offer')
    .withRequest(
      'GET',
      '/api/v1/ritual',
      setJsonContent({
        headers: pactEventHeaders,
        query: { locationId: 'loc-1' },
      })
    )
    .willRespondWith(
      200,
      setJsonContent({
        body: {
          data: {
            weather: like({
              locationKey: 'chicago-il',
              latitude: 41.878,
              longitude: -87.63,
              timezone: 'America/Chicago',
              provider: 'weatherapi',
              providerUpdatedAt: '2026-07-16T12:00:00.000Z',
              fetchedAt: '2026-07-16T12:00:00.000Z',
              current: { temperature: 16, condition: 'clear' },
              hourly: [
                {
                  forecastAt: '2026-07-16T12:00:00.000Z',
                  temperature: 16,
                  feelsLike: 15,
                  precipitationProbability: 0.1,
                  precipitationAmount: 0.0,
                  windSpeed: 5.0,
                  windGust: null,
                  condition: 'clear',
                  providerWeatherCode: '1000',
                },
              ],
              alerts: [],
            }),
            outfits: eachLike({
              id: string(COMMERCE_RECOMMENDATION_ID),
              scenario: string('morning'),
              garmentIds: eachLike('g-1'),
              reasoningBadges: eachLike({
                key: string('wind_layer'),
                label: string('Wind layer'),
                bullets: eachLike('Wind is high'),
              }),
              comfortNotes: string('Chilly morning'),
              shopThisLook: {
                partnerId: string(COMMERCE_PARTNER_SLUG),
                partnerDisplayName: string(COMMERCE_PARTNER_NAME),
                offerId: string(COMMERCE_OFFER_ID),
                offerTitle: string(COMMERCE_OFFER_TITLE),
                garmentCategory: string('top'),
              },
            }),
            badges: eachLike('Wind layer'),
          },
        },
      })
    )
    .executeTest(async (mockServer: V3MockServer) => {
      const response = await createClient(mockServer).apiV1RitualGet({
        locationId: 'loc-1',
      })

      const outfit = response.data.outfits[0]!
      expect(outfit.shopThisLook).toEqual({
        partnerId: COMMERCE_PARTNER_SLUG,
        partnerDisplayName: COMMERCE_PARTNER_NAME,
        offerId: COMMERCE_OFFER_ID,
        offerTitle: COMMERCE_OFFER_TITLE,
        garmentCategory: 'top',
      })
      // The block carries no URL at any nesting level.
      expect(JSON.stringify(outfit.shopThisLook)).not.toContain('http')
    })
}

export async function verifyCommercePreferencesReadInteraction(
  pact: PactV4,
  createClient: CreateClient
) {
  await pact
    .addInteraction()
    .given(
      ...createProviderState({
        name: 'An eligible affiliate offer matches the outfit for user',
        params: { userId: pactEventAuth.userId },
      })
    )
    .uponReceiving('a request to read the affiliate CTA preference')
    .withRequest(
      'GET',
      '/api/v1/commerce/preferences',
      setJsonContent({ headers: pactEventHeaders })
    )
    .willRespondWith(
      200,
      setJsonContent({
        headers: { 'Cache-Control': string('private, no-store') },
        body: { data: { affiliateCtasEnabled: like(true) } },
      })
    )
    .executeTest(async (mockServer: V3MockServer) => {
      const response = await createClient(mockServer).apiV1CommercePreferencesGet()

      expect(
        commercePreferenceResponseSchema.parse(response).data.affiliateCtasEnabled
      ).toBe(true)
    })
}

/**
 * The write echoes the resulting state in the same shape as the read, and
 * answers 200 even when the submitted value matches the stored one. That
 * uniformity is the contract: a client never has to branch on whether its write
 * actually moved anything.
 */
export async function verifyCommercePreferencesOptOutInteraction(
  pact: PactV4,
  createClient: CreateClient
) {
  await pact
    .addInteraction()
    .given(
      ...createProviderState({
        name: 'An eligible affiliate offer matches the outfit for user',
        params: { userId: pactEventAuth.userId },
      })
    )
    .uponReceiving('a request to turn affiliate suggestions off')
    .withRequest(
      'PUT',
      '/api/v1/commerce/preferences',
      setJsonContent({
        headers: pactEventHeaders,
        body: { affiliateCtasEnabled: false },
      })
    )
    .willRespondWith(
      200,
      setJsonContent({
        headers: { 'Cache-Control': string('private, no-store') },
        body: { data: { affiliateCtasEnabled: equal(false) } },
      })
    )
    .executeTest(async (mockServer: V3MockServer) => {
      const response = await createClient(mockServer).apiV1CommercePreferencesPut({
        updateCommercePreferenceInput: { affiliateCtasEnabled: false },
      })

      expect(
        updateCommercePreferenceResponseSchema.parse(response).data.affiliateCtasEnabled
      ).toBe(false)
    })
}

/**
 * A fresh mint is 201 and a deduped replay is 200, and both carry the identical
 * body. The status is the ONLY thing that distinguishes them, so these two
 * interactions read it off the raw response rather than off the parsed body.
 */
export async function verifyAffiliateClickMintInteraction(
  pact: PactV4,
  createClient: CreateClient
) {
  await pact
    .addInteraction()
    .given(
      ...createProviderState({
        name: 'An eligible affiliate offer matches the outfit for user',
        params: { userId: pactEventAuth.userId },
      })
    )
    .uponReceiving('a first activation of the Shop this look CTA')
    .withRequest(
      'POST',
      '/api/v1/commerce/affiliate/clicks',
      setJsonContent({ headers: pactEventHeaders, body: affiliateClickRequestBody })
    )
    .willRespondWith(
      201,
      setJsonContent({
        headers: { 'Cache-Control': string('private, no-store') },
        body: { data: { redirectUrl: string(COMMERCE_REDIRECT_URL) } },
      })
    )
    .executeTest(async (mockServer: V3MockServer) => {
      const response = await createClient(mockServer).apiV1CommerceAffiliateClicksPostRaw(
        { affiliateClickRequest: affiliateClickRequestBody }
      )

      expect(response.raw.status).toBe(201)
      const body = affiliateClickResponseSchema.parse(await response.value())
      expect(new URL(body.data.redirectUrl).protocol).toBe('https:')
      expect(new URL(body.data.redirectUrl).hostname).toBe('partner.couturecast.test')
    })
}

export async function verifyAffiliateClickDedupeInteraction(
  pact: PactV4,
  createClient: CreateClient
) {
  await pact
    .addInteraction()
    .given(
      ...createProviderState({
        name: 'An affiliate click already exists inside the dedupe window',
        params: { userId: pactEventAuth.userId },
      })
    )
    .uponReceiving('a repeat activation inside the dedupe window')
    .withRequest(
      'POST',
      '/api/v1/commerce/affiliate/clicks',
      setJsonContent({ headers: pactEventHeaders, body: affiliateClickRequestBody })
    )
    .willRespondWith(
      200,
      setJsonContent({
        headers: { 'Cache-Control': string('private, no-store') },
        body: { data: { redirectUrl: string(COMMERCE_REDIRECT_URL) } },
      })
    )
    .executeTest(async (mockServer: V3MockServer) => {
      const response = await createClient(mockServer).apiV1CommerceAffiliateClicksPostRaw(
        { affiliateClickRequest: affiliateClickRequestBody }
      )

      expect(response.raw.status).toBe(200)
      expect(
        affiliateClickResponseSchema.parse(await response.value()).data.redirectUrl
      ).toBe(COMMERCE_REDIRECT_URL)
    })
}

/**
 * Decision 9: there are no `COMMERCE_*` codes on the wire. The shared error
 * envelopes are `.strict()` over exactly `{ statusCode, message, error }`, so a
 * client branches on status plus one of the exported message constants. Each row
 * drives its own `it.each` case: PactV4's Rust FFI non-deterministically drops an
 * interaction when more than one `addInteraction()...executeTest()` chain is
 * awaited inside a single test body.
 */
export type AffiliateClickErrorInteraction = {
  description: string
  state: string
  status: number
  message: string
  reason: string
}

export const affiliateClickErrorInteractions: AffiliateClickErrorInteraction[] = [
  {
    description: 'reports a disabled feature as unavailable rather than forbidden',
    state: 'Affiliate commerce is disabled',
    status: 503,
    message: COMMERCE_DISABLED_MESSAGE,
    reason: 'Service Unavailable',
  },
  {
    description: 'reports an audience-ineligible actor',
    state: 'The user is outside the affiliate audience',
    status: 403,
    message: COMMERCE_AUDIENCE_INELIGIBLE_MESSAGE,
    reason: 'Forbidden',
  },
  {
    description: 'reports an opted-out actor',
    state: 'The user has opted out of affiliate suggestions',
    status: 403,
    message: COMMERCE_OPTED_OUT_MESSAGE,
    reason: 'Forbidden',
  },
  {
    description: 'reports an unknown, inactive, or out-of-window offer',
    state: 'The affiliate offer is unknown, inactive, or out of window',
    status: 404,
    message: COMMERCE_OFFER_NOT_FOUND_MESSAGE,
    reason: 'Not Found',
  },
]

export async function verifyAffiliateClickErrorInteraction(
  pact: PactV4,
  interaction: AffiliateClickErrorInteraction
) {
  await pact
    .addInteraction()
    .given(
      ...createProviderState({
        name: interaction.state,
        params: { userId: pactEventAuth.userId },
      })
    )
    .uponReceiving(`a CTA activation that ${interaction.description}`)
    .withRequest(
      'POST',
      '/api/v1/commerce/affiliate/clicks',
      setJsonContent({ headers: pactEventHeaders, body: affiliateClickRequestBody })
    )
    .willRespondWith(
      interaction.status,
      setJsonContent({
        headers: { 'Cache-Control': string('private, no-store') },
        body: {
          statusCode: like(interaction.status),
          message: string(interaction.message),
          error: string(interaction.reason),
        },
      })
    )
    .executeTest(async (mockServer: V3MockServer) => {
      // The generated SDK throws on these statuses, so the request goes out
      // directly: what matters is the envelope the clients branch on.
      const response = await fetch(`${mockServer.url}/api/v1/commerce/affiliate/clicks`, {
        method: 'POST',
        headers: { ...pactEventHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify(affiliateClickRequestBody),
      })

      expect(response.status).toBe(interaction.status)
      expect(response.headers.get('cache-control')).toBe('private, no-store')

      const payload = (await response.json()) as Record<string, unknown>
      expect(payload.message).toBe(interaction.message)
      expect(payload.error).toBe(interaction.reason)
      // There is no machine-readable code to branch on, by design.
      expect(payload).not.toHaveProperty('code')
    })
}

/**
 * The webhook is machine-to-machine and carries NO `Authorization` header. That
 * absence is the whole point: this app wires no global guard, and the HMAC over
 * the raw bytes is what authenticates the route instead. Recording an
 * unauthenticated request here means a future global guard cannot silently break
 * every partner without failing verification.
 */
export async function verifyAffiliateWebhookInteraction(
  pact: PactV4,
  createClient: CreateClient
) {
  await pact
    .addInteraction()
    .given(
      ...createProviderState({
        name: 'An eligible affiliate offer matches the outfit for user',
        params: { userId: pactEventAuth.userId },
      })
    )
    .uponReceiving('a signed partner conversion webhook')
    .withRequest(
      'POST',
      '/api/v1/commerce/affiliate/webhook',
      setJsonContent({
        headers: commerceWebhookHeaders,
        body: commerceWebhookPayload,
      })
    )
    .willRespondWith(
      200,
      setJsonContent({
        headers: { 'Cache-Control': string('private, no-store') },
        body: { data: { received: equal(true) } },
      })
    )
    .executeTest(async (mockServer: V3MockServer) => {
      const response = await createClient(mockServer).apiV1CommerceAffiliateWebhookPost({
        xCouturePartnerId: COMMERCE_PARTNER_SLUG,
        xCoutureTimestamp: COMMERCE_WEBHOOK_TIMESTAMP,
        xCoutureSignature: COMMERCE_WEBHOOK_SIGNATURE,
        affiliateWebhookPayload: commerceWebhookPayload,
      })

      expect(affiliateWebhookResponseSchema.parse(response).data.received).toBe(true)
    })
}

export type AffiliateWebhookErrorInteraction = {
  description: string
  state: string
  body: Record<string, unknown>
  status: number
  message: string
  reason: string
}

export const affiliateWebhookErrorInteractions: AffiliateWebhookErrorInteraction[] = [
  {
    /**
     * Every rejection cause answers with this identical status and message: a
     * missing header, an unknown or inactive partner, an unresolvable secret, a
     * stale timestamp, and a forged HMAC are indistinguishable from outside, so
     * the endpoint cannot be used to enumerate which partner slugs exist.
     */
    description: 'rejects a signature that does not verify',
    state: 'The affiliate webhook signature is invalid',
    body: commerceWebhookPayload,
    status: 401,
    message: WEBHOOK_SIGNATURE_INVALID_MESSAGE,
    reason: 'Unauthorized',
  },
  {
    description: 'rejects a malformed payload only after the signature has passed',
    state: 'An eligible affiliate offer matches the outfit for user',
    body: { ...commerceWebhookPayload, currency: 'usd' },
    status: 400,
    message: 'Invalid affiliate webhook payload',
    reason: 'Bad Request',
  },
]

export async function verifyAffiliateWebhookErrorInteraction(
  pact: PactV4,
  interaction: AffiliateWebhookErrorInteraction
) {
  await pact
    .addInteraction()
    .given(
      ...createProviderState({
        name: interaction.state,
        params: { userId: pactEventAuth.userId },
      })
    )
    .uponReceiving(`a partner conversion webhook that ${interaction.description}`)
    .withRequest(
      'POST',
      '/api/v1/commerce/affiliate/webhook',
      setJsonContent({ headers: commerceWebhookHeaders, body: interaction.body })
    )
    .willRespondWith(
      interaction.status,
      setJsonContent({
        headers: { 'Cache-Control': string('private, no-store') },
        body: {
          statusCode: like(interaction.status),
          message: string(interaction.message),
          error: string(interaction.reason),
        },
      })
    )
    .executeTest(async (mockServer: V3MockServer) => {
      // The generated SDK throws on these statuses, so the request goes out
      // directly: the point is to pin the status and error envelope the
      // clients branch on, not the SDK's error-handling.
      const response = await fetch(
        `${mockServer.url}/api/v1/commerce/affiliate/webhook`,
        {
          method: 'POST',
          headers: { ...commerceWebhookHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify(interaction.body),
        }
      )

      expect(response.status).toBe(interaction.status)

      const payload = (await response.json()) as Record<string, unknown>
      expect(payload.message).toBe(interaction.message)
      expect(payload.error).toBe(interaction.reason)
      expect(payload).not.toHaveProperty('code')
    })
}
