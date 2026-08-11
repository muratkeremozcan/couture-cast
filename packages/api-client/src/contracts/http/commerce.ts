// Story 5.1 Task 2 owner: affiliate commerce HTTP contracts.
//
// Two design decisions in this file are load-bearing and easy to undo by
// accident, so they are stated here rather than only in the story.
//
// 1. There are no `COMMERCE_*` codes on the wire. Every shared error envelope in
//    `common.ts` is `.strict()` over exactly `{ statusCode, message, error }`,
//    so adding a `code` field would be rejected by the schema itself. The only
//    error-code concept in this repo feeds telemetry, never a response body.
//    Callers therefore assert on status plus one of the exported message
//    constants below, which exist so controllers and tests cannot drift apart.
//
// 2. `shopThisLookSchema` carries no URL. The deep link is built server-side at
//    click time and never reaches a client, which is what makes the outbound
//    host validation meaningful: a URL the client already held could be used
//    without ever minting an attributed click.
import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi'
import { z } from 'zod'
import { nonEmptyStringSchema, type RegisteredCommonHttpSchemas } from './common'
import { garmentCategoryEnum } from './wardrobe'

/**
 * A closed enum with one member today. Keeping it an enum rather than a string
 * means a new surface has to be added to the contract deliberately, and stops
 * the analytics `surface` property from silently becoming free text.
 */
export const affiliateSurfaceSchema = z.enum(['mobile_hero'])

export const affiliateConversionStatusSchema = z.enum([
  'pending',
  'confirmed',
  'reversed',
])

export const shopThisLookSchema = z
  .object({
    partnerId: nonEmptyStringSchema.describe(
      'CommercePartner.slug. Stable, safe to log.'
    ),
    partnerDisplayName: nonEmptyStringSchema.describe('Rendered next to the CTA.'),
    offerId: nonEmptyStringSchema.describe(
      'Pass back to POST /api/v1/commerce/affiliate/clicks.'
    ),
    offerTitle: nonEmptyStringSchema.describe(
      'Partner-authored, already localized by the catalog row.'
    ),
    garmentCategory: garmentCategoryEnum.describe('The outfit slot this offer matched.'),
  })
  .strict()

export type ShopThisLook = z.infer<typeof shopThisLookSchema>

// --- Preferences -----------------------------------------------------------

export const commercePreferenceSchema = z
  .object({
    affiliateCtasEnabled: z
      .boolean()
      .describe(
        'False hides every affiliate CTA. Defaults true; a user with no stored row reads as true.'
      ),
  })
  .strict()

export const commercePreferenceResponseSchema = z.object({
  data: commercePreferenceSchema,
})

export const updateCommercePreferenceInputSchema = commercePreferenceSchema

export const updateCommercePreferenceResponseSchema = z.object({
  data: commercePreferenceSchema,
})

export type CommercePreference = z.infer<typeof commercePreferenceSchema>
export type CommercePreferenceResponse = z.infer<typeof commercePreferenceResponseSchema>
export type UpdateCommercePreferenceInput = z.infer<
  typeof updateCommercePreferenceInputSchema
>
export type UpdateCommercePreferenceResponse = z.infer<
  typeof updateCommercePreferenceResponseSchema
>

// --- Attributed click ------------------------------------------------------

export const affiliateClickRequestSchema = z
  .object({
    offerId: nonEmptyStringSchema
      .max(64)
      .describe('The offerId returned in the ritual response shopThisLook block.'),
    recommendationId: nonEmptyStringSchema
      .max(128)
      .describe('The ScenarioOutfit.id the CTA was rendered on.'),
    surface: affiliateSurfaceSchema.describe('Where the CTA was activated.'),
  })
  // `scenario` and `localeRegion` are deliberately absent: both are derived
  // server-side from the recommendation and the resolved locale, never trusted
  // from the client, so accepting them here would create a spoofable path into
  // the attribution record.
  .strict()

export const affiliateClickResponseSchema = z.object({
  data: z
    .object({
      redirectUrl: z
        .string()
        .url()
        .describe(
          'Absolute https URL on the partner host, with the click token substituted. Built server-side; never cached by the client.'
        ),
    })
    .strict(),
})

export type AffiliateClickRequest = z.infer<typeof affiliateClickRequestSchema>
export type AffiliateClickResponse = z.infer<typeof affiliateClickResponseSchema>

// --- Inbound conversion webhook -------------------------------------------

export const affiliateWebhookHeadersSchema = z
  .object({
    'x-couture-partner-id': nonEmptyStringSchema.describe('The CommercePartner slug.'),
    'x-couture-timestamp': z
      .string()
      // Structural rather than a `.refine()`: a regex reaches the published
      // OpenAPI document as `pattern`, where a refinement would vanish from the
      // spec and only exist at runtime.
      .regex(/^\d{1,15}$/)
      .describe('Unix seconds, integer. Must be within 300 seconds of server time.'),
    'x-couture-signature': z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .describe('Lowercase hex HMAC-SHA256 over `${timestamp}.${rawBody}`.'),
  })
  .strict()

export const affiliateWebhookPayloadSchema = z
  .object({
    eventId: nonEmptyStringSchema
      .max(128)
      .describe('Partner-side unique event id. Replays of the same id write nothing.'),
    clickToken: nonEmptyStringSchema
      .max(255)
      .describe(
        'The token issued at click time. An unknown token is still recorded, unattributed.'
      ),
    occurredAt: z
      .string()
      .datetime()
      .describe('ISO 8601 UTC instant the conversion happened partner-side.'),
    status: affiliateConversionStatusSchema,
    orderValueMinorUnits: z
      .number()
      .int()
      .min(0)
      .describe('Integer minor units. Floating-point money is prohibited.'),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .describe('ISO 4217 alpha-3, uppercase.'),
  })
  .strict()

export const affiliateWebhookResponseSchema = z.object({
  data: z.object({ received: z.literal(true) }).strict(),
})

export type AffiliateWebhookHeaders = z.infer<typeof affiliateWebhookHeadersSchema>
export type AffiliateWebhookPayload = z.infer<typeof affiliateWebhookPayloadSchema>
export type AffiliateWebhookResponse = z.infer<typeof affiliateWebhookResponseSchema>

// --- Error messages --------------------------------------------------------

/**
 * Every failure mode of the webhook returns this one message, so the endpoint
 * cannot be used to enumerate which partner slugs exist or which secrets are
 * configured. An unknown partner and a bad signature are indistinguishable.
 */
export const WEBHOOK_SIGNATURE_INVALID_MESSAGE = 'Invalid webhook signature.'

export const COMMERCE_OPTED_OUT_MESSAGE =
  'Affiliate suggestions are turned off for this account.'

export const COMMERCE_AUDIENCE_INELIGIBLE_MESSAGE =
  'Affiliate suggestions are unavailable for this account.'

export const COMMERCE_OFFER_NOT_FOUND_MESSAGE = 'Affiliate offer not found.'

/**
 * Operator error surfaced as a user-visible failure: a catalog row whose
 * resolved URL does not parse, is not https, carries userinfo, points off the
 * partner's allowed host, or lacks the {clickToken} placeholder. No click row is
 * created and nothing is redirected.
 */
export const COMMERCE_OFFER_INVALID_MESSAGE =
  'Affiliate offer is not configured correctly.'

export const COMMERCE_DISABLED_MESSAGE =
  'Affiliate suggestions are temporarily unavailable.'

// --- OpenAPI registration --------------------------------------------------

export function registerCommerceContracts(
  registry: OpenAPIRegistry,
  commonSchemas: RegisteredCommonHttpSchemas
) {
  registry.register('AffiliateSurface', affiliateSurfaceSchema)
  registry.register('AffiliateConversionStatus', affiliateConversionStatusSchema)
  registry.register('ShopThisLook', shopThisLookSchema)
  registry.register('CommercePreference', commercePreferenceSchema)

  const registeredCommercePreferenceResponseSchema = registry.register(
    'CommercePreferenceResponse',
    commercePreferenceResponseSchema
  )
  const registeredUpdateCommercePreferenceInputSchema = registry.register(
    'UpdateCommercePreferenceInput',
    updateCommercePreferenceInputSchema
  )
  const registeredUpdateCommercePreferenceResponseSchema = registry.register(
    'UpdateCommercePreferenceResponse',
    updateCommercePreferenceResponseSchema
  )
  const registeredAffiliateClickRequestSchema = registry.register(
    'AffiliateClickRequest',
    affiliateClickRequestSchema
  )
  const registeredAffiliateClickResponseSchema = registry.register(
    'AffiliateClickResponse',
    affiliateClickResponseSchema
  )
  const registeredAffiliateWebhookPayloadSchema = registry.register(
    'AffiliateWebhookPayload',
    affiliateWebhookPayloadSchema
  )
  const registeredAffiliateWebhookResponseSchema = registry.register(
    'AffiliateWebhookResponse',
    affiliateWebhookResponseSchema
  )

  registry.registerPath({
    method: 'get',
    path: '/api/v1/commerce/preferences',
    tags: ['commerce'],
    summary: 'Read the affiliate CTA preference',
    description:
      'Returns the affiliate CTA preference for the acting user. A user with no stored row reads as enabled. Deliberately NOT gated by commerce_affiliate_enabled: a user must always be able to read and set their own preference, including while affiliate commerce is switched off.',
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description: 'Preference retrieved successfully',
        content: {
          'application/json': { schema: registeredCommercePreferenceResponseSchema },
        },
      },
      401: {
        description: 'Missing or invalid authentication headers',
        content: {
          'application/json': { schema: commonSchemas.unauthorizedHttpErrorSchema },
        },
      },
      500: {
        description: 'Internal server error occurred',
        content: {
          'application/json': {
            schema: commonSchemas.internalServerErrorHttpErrorSchema,
          },
        },
      },
    },
  })

  registry.registerPath({
    method: 'put',
    path: '/api/v1/commerce/preferences',
    tags: ['commerce'],
    summary: 'Set the affiliate CTA preference',
    description:
      'Sets the affiliate CTA preference for the acting user and writes an audit row in the same transaction. An unchanged value returns 200 with the current state and writes no audit row, so the response stays uniform.',
    security: [{ bearerAuth: [] }],
    request: {
      body: {
        required: true,
        content: {
          'application/json': { schema: registeredUpdateCommercePreferenceInputSchema },
        },
      },
    },
    responses: {
      200: {
        description: 'Preference stored, including when the value was unchanged',
        content: {
          'application/json': {
            schema: registeredUpdateCommercePreferenceResponseSchema,
          },
        },
      },
      400: {
        description: 'Invalid input payload',
        content: {
          'application/json': { schema: commonSchemas.badRequestHttpErrorSchema },
        },
      },
      401: {
        description: 'Missing or invalid authentication headers',
        content: {
          'application/json': { schema: commonSchemas.unauthorizedHttpErrorSchema },
        },
      },
      500: {
        description: 'Internal server error occurred',
        content: {
          'application/json': {
            schema: commonSchemas.internalServerErrorHttpErrorSchema,
          },
        },
      },
    },
  })

  registry.registerPath({
    method: 'post',
    path: '/api/v1/commerce/affiliate/clicks',
    tags: ['commerce'],
    summary: 'Mint an attributed affiliate click',
    description:
      'Creates one AffiliateClick and returns the outbound partner URL. 201 on a fresh mint, 200 when an identical activation inside 60 seconds is deduped to the existing row. Status precedence is fixed so assertions are deterministic: 503 (feature disabled) outranks 403 (audience), which outranks 403 (opted out), which outranks 404 (unknown, inactive, or out-of-window offer), which outranks 500 (invalid resolved URL).',
    security: [{ bearerAuth: [] }],
    request: {
      body: {
        required: true,
        content: {
          'application/json': { schema: registeredAffiliateClickRequestSchema },
        },
      },
    },
    responses: {
      201: {
        description: 'A new click was minted',
        content: {
          'application/json': { schema: registeredAffiliateClickResponseSchema },
        },
      },
      200: {
        description:
          'A click for the same user, offer, and recommendation already existed within 60 seconds; the same redirect URL is returned and no new row is created',
        content: {
          'application/json': { schema: registeredAffiliateClickResponseSchema },
        },
      },
      400: {
        description: 'Invalid input payload',
        content: {
          'application/json': { schema: commonSchemas.badRequestHttpErrorSchema },
        },
      },
      401: {
        description: 'Missing or invalid authentication headers',
        content: {
          'application/json': { schema: commonSchemas.unauthorizedHttpErrorSchema },
        },
      },
      403: {
        description: `Audience ineligible ("${COMMERCE_AUDIENCE_INELIGIBLE_MESSAGE}") or opted out ("${COMMERCE_OPTED_OUT_MESSAGE}")`,
        content: {
          'application/json': { schema: commonSchemas.forbiddenHttpErrorSchema },
        },
      },
      404: {
        description: `Unknown, inactive, or out-of-window offer ("${COMMERCE_OFFER_NOT_FOUND_MESSAGE}")`,
        content: {
          'application/json': { schema: commonSchemas.notFoundHttpErrorSchema },
        },
      },
      500: {
        description: `The offer's resolved URL failed validation ("${COMMERCE_OFFER_INVALID_MESSAGE}")`,
        content: {
          'application/json': {
            schema: commonSchemas.internalServerErrorHttpErrorSchema,
          },
        },
      },
      503: {
        description: `commerce_affiliate_enabled resolved false ("${COMMERCE_DISABLED_MESSAGE}")`,
        content: {
          'application/json': {
            schema: commonSchemas.serviceUnavailableHttpErrorSchema,
          },
        },
      },
    },
  })

  registry.registerPath({
    method: 'post',
    path: '/api/v1/commerce/affiliate/webhook',
    tags: ['commerce'],
    summary: 'Record an affiliate conversion',
    description:
      'Machine-to-machine, authenticated by HMAC signature rather than a bearer token. Append-only and idempotent on (partner, eventId): a replay returns 200 and writes nothing. An unknown clickToken is still persisted, unattributed, because rejecting it would trigger unbounded partner retries for a fact we cannot change. The commerce kill switch deliberately does NOT apply here: returning 503 to a retrying partner would drop conversion facts for purchases that already happened.',
    request: {
      headers: affiliateWebhookHeadersSchema,
      body: {
        required: true,
        content: {
          'application/json': { schema: registeredAffiliateWebhookPayloadSchema },
        },
      },
    },
    responses: {
      200: {
        description: 'Conversion recorded, or recognised as a replay and ignored',
        content: {
          'application/json': { schema: registeredAffiliateWebhookResponseSchema },
        },
      },
      400: {
        description:
          'Signature verified but the body failed schema validation. Reached only after all four signature checks pass.',
        content: {
          'application/json': { schema: commonSchemas.badRequestHttpErrorSchema },
        },
      },
      401: {
        description: `Any signature failure. Missing header, non-integer timestamp, unknown or inactive partner, unresolvable or too-short secret, timestamp outside ±300 seconds, and HMAC mismatch all return this identical message ("${WEBHOOK_SIGNATURE_INVALID_MESSAGE}") so the endpoint is not a partner-enumeration oracle.`,
        content: {
          'application/json': { schema: commonSchemas.unauthorizedHttpErrorSchema },
        },
      },
    },
  })
}
