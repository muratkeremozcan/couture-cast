// Learning path Step 33: Affiliate "Shop this look" CTA.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-33-affiliate-shop-this-look-cta
//
// SETUP SHAPE. Decision 14: seeded catalog plus public-API user setup. There is no
// public catalog API and there is not supposed to be one, so the partner and its
// four wildcard offers come from `packages/db/prisma/seeds/commerce.ts` and only the
// acting user is created here. The seed constants are imported so a change to the
// partner slug or its allowed host breaks this suite instead of silently making it
// assert against a partner that no longer exists.
import { log } from '@seontechnologies/playwright-utils/log'
import {
  affiliateClickResponseSchema,
  affiliateWebhookResponseSchema,
  badRequestHttpErrorSchema,
  commercePreferenceResponseSchema,
  forbiddenHttpErrorSchema,
  notFoundHttpErrorSchema,
  ritualResponseSchema,
  shopThisLookSchema,
  unauthorizedHttpErrorSchema,
  COMMERCE_OFFER_NOT_FOUND_MESSAGE,
  COMMERCE_OPTED_OUT_MESSAGE,
  WEBHOOK_SIGNATURE_INVALID_MESSAGE,
} from '@couture/api-client/contracts/http'
import {
  buildTestOnlyPartnerWebhookSecret,
  signAffiliateWebhookPayload,
  WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS,
} from '../../../apps/api/src/modules/commerce/affiliate-webhook-signature'
import {
  SAMPLE_PARTNER_ALLOWED_HOST,
  SAMPLE_PARTNER_SLUG,
  SAMPLE_PARTNER_WEBHOOK_SECRET_REF,
} from '../../../packages/db/prisma/seeds/commerce'
import {
  AFFILIATE_CLICKS_PATH,
  AFFILIATE_WEBHOOK_PATH,
  COMMERCE_PREFERENCES_PATH,
  commerceApiTest as test,
  expect,
  type CommerceApiContext,
} from '../../support/helpers/commerce-session'
import { buildUniqueId } from '../../support/helpers/api-test'

const RITUAL_PATH = '/api/v1/ritual'

/**
 * Both processes must derive the same signing secret. The API resolves it through
 * `resolvePartnerWebhookSecret`, which falls back to this exact function when the
 * environment names no secret; calling the same export here stops the two from
 * drifting into a permanently-401 suite.
 */
const PARTNER_SECRET = buildTestOnlyPartnerWebhookSecret(
  SAMPLE_PARTNER_WEBHOOK_SECRET_REF
)

type ApiRequestFn = (params: {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'
  path: string
  baseUrl: string
  body?: unknown
  headers?: Record<string, string>
}) => Promise<{ status: number; body: unknown }>

type ShopThisLookBlock = {
  partnerId: string
  partnerDisplayName: string
  offerId: string
  offerTitle: string
  garmentCategory: string
}

type ScenarioOutfit = {
  id: string
  scenario: string
  garmentIds: string[]
  shopThisLook: ShopThisLookBlock | null
}

type RitualBody = { data?: { outfits: ScenarioOutfit[] } }

/**
 * Extracts the outfits from a ritual read. Setup that cannot proceed throws: keeping
 * `expect` out of the helpers makes a failure name the claim that broke.
 */
async function readRitual(
  apiRequest: ApiRequestFn,
  commerce: CommerceApiContext
): Promise<ScenarioOutfit[]> {
  const { status, body } = await apiRequest({
    method: 'GET',
    path: RITUAL_PATH,
    baseUrl: commerce.apiBaseUrl,
    headers: commerce.headers,
  })

  if (status !== 200) {
    throw new Error(`Ritual read returned ${status}: ${JSON.stringify(body)}`)
  }
  const outfits = (body as RitualBody).data?.outfits ?? []
  if (outfits.length === 0) {
    throw new Error('Ritual returned no outfits, so there is nothing to evaluate.')
  }
  return outfits
}

/** The first outfit the server judged eligible, with a readable failure if none is. */
function firstEligible(outfits: ScenarioOutfit[]): {
  outfit: ScenarioOutfit
  offer: ShopThisLookBlock
} {
  const outfit = outfits.find((candidate) => candidate.shopThisLook !== null)
  if (!outfit?.shopThisLook) {
    throw new Error(
      `No outfit carried a shopThisLook block. The seeded catalog is reachable only after a seed, and commerce_affiliate_enabled must be on. Outfits: ${JSON.stringify(
        outfits.map((o) => ({ id: o.id, garmentIds: o.garmentIds }))
      )}`
    )
  }

  return { outfit, offer: outfit.shopThisLook }
}

async function setPreference(
  apiRequest: ApiRequestFn,
  commerce: CommerceApiContext,
  affiliateCtasEnabled: boolean
): Promise<{ status: number; stored: boolean }> {
  const { status, body } = await apiRequest({
    method: 'PUT',
    path: COMMERCE_PREFERENCES_PATH,
    baseUrl: commerce.apiBaseUrl,
    headers: commerce.headers,
    body: { affiliateCtasEnabled },
  })

  if (status !== 200) {
    throw new Error(`Preference write returned ${status}: ${JSON.stringify(body)}`)
  }
  return {
    status,
    stored: commercePreferenceResponseSchema.parse(body).data.affiliateCtasEnabled,
  }
}

async function recordClick(
  apiRequest: ApiRequestFn,
  commerce: CommerceApiContext,
  input: { offerId: string; recommendationId: string }
): Promise<{ status: number; body: unknown }> {
  return apiRequest({
    method: 'POST',
    path: AFFILIATE_CLICKS_PATH,
    baseUrl: commerce.apiBaseUrl,
    headers: commerce.headers,
    body: { ...input, surface: 'mobile_hero' },
  })
}

type SignedWebhook = { headers: Record<string, string>; body: string }

/**
 * Signs the exact bytes that will be sent. The body is passed through as a string
 * because the signature covers the raw request bytes: re-serializing between signing
 * and sending would change key order or whitespace and invalidate a signature that
 * is semantically correct.
 */
function signWebhook(
  payload: unknown,
  overrides: {
    partnerSlug?: string
    timestampSeconds?: number
    secret?: string
  } = {}
): SignedWebhook {
  const serialized = typeof payload === 'string' ? payload : JSON.stringify(payload)
  const timestamp = String(overrides.timestampSeconds ?? Math.floor(Date.now() / 1000))

  return {
    body: serialized,
    headers: {
      'content-type': 'application/json',
      'x-couture-partner-id': overrides.partnerSlug ?? SAMPLE_PARTNER_SLUG,
      'x-couture-timestamp': timestamp,
      'x-couture-signature': signAffiliateWebhookPayload(
        timestamp,
        Buffer.from(serialized, 'utf8'),
        overrides.secret ?? PARTNER_SECRET
      ),
    },
  }
}

async function postWebhook(
  apiRequest: ApiRequestFn,
  baseUrl: string,
  signed: SignedWebhook
): Promise<{ status: number; body: unknown }> {
  // No Authorization header anywhere in this file. The controller carries no
  // `@UseGuards` and the app registers no APP_GUARD, so a future global guard
  // would turn every webhook case below into a 401 and be caught here.
  return apiRequest({
    method: 'POST',
    path: AFFILIATE_WEBHOOK_PATH,
    baseUrl,
    headers: signed.headers,
    body: signed.body,
  })
}

function buildConversionPayload(clickToken: string, eventId: string) {
  return {
    eventId,
    clickToken,
    occurredAt: new Date().toISOString(),
    status: 'confirmed' as const,
    orderValueMinorUnits: 12_900,
    currency: 'USD',
  }
}

function withoutHeader(signed: SignedWebhook, name: string): SignedWebhook {
  const headers = { ...signed.headers }
  delete headers[name]
  return { ...signed, headers }
}

function withHeader(signed: SignedWebhook, name: string, value: string): SignedWebhook {
  return { ...signed, headers: { ...signed.headers, [name]: value } }
}

test.describe('Story 5.1 affiliate commerce API', () => {
  test('[P0] 5.1-E2E-API-01 returns one disclosed, deterministic offer for an eligible user', async ({
    apiRequest,
    commerceApi,
    validateSchema,
  }) => {
    await log.step('Read the ritual for a fresh, opted-in user')
    const { status, body } = await apiRequest({
      method: 'GET',
      path: RITUAL_PATH,
      baseUrl: commerceApi.apiBaseUrl,
      headers: commerceApi.headers,
    })

    expect(status).toBe(200)
    await validateSchema(ritualResponseSchema, body)

    const outfits = (body as RitualBody).data?.outfits ?? []
    const { outfit, offer } = firstEligible(outfits)

    await log.step('Assert the block names one partner and carries no URL')
    // The schema is `.strict()`, so parsing rejects any extra field. Pinning the key
    // set states the intent that strictness enforces: no url, no deep link, no
    // product identifier ever reaches a client. The deep link is built server-side
    // at click time so a client never holds one.
    expect(shopThisLookSchema.parse(offer)).toEqual(offer)
    expect(Object.keys(offer).sort()).toEqual([
      'garmentCategory',
      'offerId',
      'offerTitle',
      'partnerDisplayName',
      'partnerId',
    ])
    expect(offer.partnerId).toBe(SAMPLE_PARTNER_SLUG)
    expect(offer.partnerDisplayName.length).toBeGreaterThan(0)
    expect(offer.offerTitle.length).toBeGreaterThan(0)

    await log.step('Assert selection is deterministic across repeated reads')
    // Without the full `(comfort_range IS NULL) ASC, priority DESC, id ASC`
    // ordering, two reads of the same outfit can resolve different offers, and
    // attribution stops being comparable between them.
    const second = await readRitual(apiRequest, commerceApi)
    const sameOutfit = second.find((candidate) => candidate.id === outfit.id)
    expect(sameOutfit?.shopThisLook?.offerId).toBe(offer.offerId)
  })

  test('[P0] 5.1-E2E-API-02 returns a null block for every scenario once the user opts out', async ({
    apiRequest,
    commerceApi,
  }) => {
    await log.step('Confirm the user is eligible before opting out')
    firstEligible(await readRitual(apiRequest, commerceApi))

    await log.step('Opt out')
    await setPreference(apiRequest, commerceApi, false)

    await log.step('Assert every scenario now reports null, not a missing key')
    const outfits = await readRitual(apiRequest, commerceApi)
    for (const outfit of outfits) {
      expect(outfit, `${outfit.scenario} must serialize the key`).toHaveProperty(
        'shopThisLook'
      )
      expect(outfit.shopThisLook, `${outfit.scenario} while opted out`).toBeNull()
    }

    await log.step('Assert opting back in restores the block')
    await setPreference(apiRequest, commerceApi, true)
    firstEligible(await readRitual(apiRequest, commerceApi))
  })

  test('[P1] 5.1-E2E-API-03 keeps the preference endpoints answering and the value round tripping', async ({
    apiRequest,
    commerceApi,
    validateSchema,
  }) => {
    await log.step('A user with no stored row reads as enabled')
    const initial = await apiRequest({
      method: 'GET',
      path: COMMERCE_PREFERENCES_PATH,
      baseUrl: commerceApi.apiBaseUrl,
      headers: commerceApi.headers,
    })
    expect(initial.status).toBe(200)
    await validateSchema(commercePreferenceResponseSchema, initial.body)
    expect(
      commercePreferenceResponseSchema.parse(initial.body).data.affiliateCtasEnabled
    ).toBe(true)

    await log.step('An unchanged write still answers 200 with the current state')
    const unchanged = await setPreference(apiRequest, commerceApi, true)
    expect(unchanged.status).toBe(200)
    expect(unchanged.stored).toBe(true)

    await log.step('A changed write persists')
    const changed = await setPreference(apiRequest, commerceApi, false)
    expect(changed.status).toBe(200)
    expect(changed.stored).toBe(false)

    const readBack = await apiRequest({
      method: 'GET',
      path: COMMERCE_PREFERENCES_PATH,
      baseUrl: commerceApi.apiBaseUrl,
      headers: commerceApi.headers,
    })
    expect(
      commercePreferenceResponseSchema.parse(readBack.body).data.affiliateCtasEnabled
    ).toBe(false)
  })

  test('[P0] 5.1-E2E-API-04 mints one attributed click on the partner host and dedupes a double tap', async ({
    apiRequest,
    commerceApi,
    validateSchema,
  }) => {
    const { outfit, offer } = firstEligible(await readRitual(apiRequest, commerceApi))

    await log.step('First activation mints a click')
    const first = await recordClick(apiRequest, commerceApi, {
      offerId: offer.offerId,
      recommendationId: outfit.id,
    })

    expect(first.status).toBe(201)
    await validateSchema(affiliateClickResponseSchema, first.body)

    const redirectUrl = affiliateClickResponseSchema.parse(first.body).data.redirectUrl
    const parsed = new URL(redirectUrl)

    await log.step('Assert the outbound URL is on the partner host and carries a token')
    expect(parsed.protocol).toBe('https:')
    expect(parsed.username).toBe('')
    expect(parsed.password).toBe('')
    const host = parsed.hostname.toLowerCase()
    expect(
      host === SAMPLE_PARTNER_ALLOWED_HOST ||
        host.endsWith(`.${SAMPLE_PARTNER_ALLOWED_HOST}`),
      `${host} is neither ${SAMPLE_PARTNER_ALLOWED_HOST} nor a dot-suffix of it`
    ).toBe(true)

    // The placeholder must be substituted, and with the HMAC token: a raw row id in
    // a third-party URL would let anyone holding a partner secret attribute revenue
    // to guessed identifiers.
    expect(redirectUrl).not.toContain('{clickToken}')
    const clickToken = parsed.searchParams.get('cc')
    expect(clickToken).toBeTruthy()
    expect(clickToken!.length).toBeGreaterThan(20)

    await log.step('An immediate second activation dedupes to the same click')
    const second = await recordClick(apiRequest, commerceApi, {
      offerId: offer.offerId,
      recommendationId: outfit.id,
    })

    expect(second.status).toBe(200)
    expect(affiliateClickResponseSchema.parse(second.body).data.redirectUrl).toBe(
      redirectUrl
    )
  })

  test('[P1] 5.1-E2E-API-05 refuses a click for an opted-out user and for an unknown offer', async ({
    apiRequest,
    commerceApi,
    validateSchema,
  }) => {
    const { outfit, offer } = firstEligible(await readRitual(apiRequest, commerceApi))

    await log.step('An offer that does not exist is a 404, not a redirect')
    const unknown = await recordClick(apiRequest, commerceApi, {
      offerId: `missing-${buildUniqueId('offer', test.info())}`.slice(0, 64),
      recommendationId: outfit.id,
    })
    expect(unknown.status).toBe(404)
    await validateSchema(notFoundHttpErrorSchema, unknown.body)
    expect((unknown.body as { message: string }).message).toBe(
      COMMERCE_OFFER_NOT_FOUND_MESSAGE
    )

    await log.step('Opting out makes the click endpoint refuse with 403')
    await setPreference(apiRequest, commerceApi, false)

    const optedOut = await recordClick(apiRequest, commerceApi, {
      offerId: offer.offerId,
      // A fresh recommendation id, so a 403 cannot be confused with the dedupe
      // path returning a previously minted redirect.
      recommendationId: `${outfit.id}-opted-out`,
    })
    expect(optedOut.status).toBe(403)
    await validateSchema(forbiddenHttpErrorSchema, optedOut.body)
    expect((optedOut.body as { message: string }).message).toBe(
      COMMERCE_OPTED_OUT_MESSAGE
    )
  })

  test('[P1] 5.1-E2E-API-06 records a signed conversion, ignores a replay, and accepts an unknown token', async ({
    apiRequest,
    commerceApi,
    validateSchema,
  }) => {
    const { outfit, offer } = firstEligible(await readRitual(apiRequest, commerceApi))
    const click = await recordClick(apiRequest, commerceApi, {
      offerId: offer.offerId,
      recommendationId: outfit.id,
    })
    expect(click.status).toBe(201)
    const clickToken = new URL(
      affiliateClickResponseSchema.parse(click.body).data.redirectUrl
    ).searchParams.get('cc')!

    const eventId = buildUniqueId('conversion', test.info())

    await log.step(
      'A correctly signed conversion is recorded with no Authorization header'
    )
    const accepted = await postWebhook(
      apiRequest,
      commerceApi.apiBaseUrl,
      signWebhook(buildConversionPayload(clickToken, eventId))
    )
    expect(accepted.status).toBe(200)
    await validateSchema(affiliateWebhookResponseSchema, accepted.body)
    expect(accepted.body).toEqual({ data: { received: true } })

    await log.step('A replay of the same event id is accepted and ignored')
    // Append-only on `(partner_id, external_event_id)`: the partner must see a
    // 200 or it retries forever. That nothing is written is asserted in
    // `apps/api/integration/commerce-affiliate-webhook.integration.spec.ts`,
    // which can read the table; this layer can only prove the status contract.
    const replay = await postWebhook(
      apiRequest,
      commerceApi.apiBaseUrl,
      signWebhook(buildConversionPayload(clickToken, eventId))
    )
    expect(replay.status).toBe(200)
    expect(replay.body).toEqual({ data: { received: true } })

    await log.step('An unknown click token is still recorded, unattributed')
    const unmatched = await postWebhook(
      apiRequest,
      commerceApi.apiBaseUrl,
      signWebhook(
        buildConversionPayload(
          'unknown-click-token-that-was-never-issued',
          buildUniqueId('conversion-unmatched', test.info())
        )
      )
    )
    expect(unmatched.status).toBe(200)
    expect(unmatched.body).toEqual({ data: { received: true } })
  })

  test('[P1] 5.1-E2E-API-07 rejects every malformed signature with one indistinguishable 401', async ({
    apiRequest,
    commerceApi,
    validateSchema,
  }) => {
    const payload = buildConversionPayload(
      'unknown-click-token-that-was-never-issued',
      buildUniqueId('conversion-401', test.info())
    )
    const valid = signWebhook(payload)
    const nowSeconds = Math.floor(Date.now() / 1000)

    const cases: { name: string; signed: SignedWebhook }[] = [
      {
        name: 'missing partner header',
        signed: withoutHeader(valid, 'x-couture-partner-id'),
      },
      {
        name: 'missing timestamp header',
        signed: withoutHeader(valid, 'x-couture-timestamp'),
      },
      {
        name: 'missing signature header',
        signed: withoutHeader(valid, 'x-couture-signature'),
      },
      {
        name: 'non-integer timestamp',
        signed: withHeader(valid, 'x-couture-timestamp', '1760000000.5'),
      },
      {
        name: 'timestamp beyond the tolerance',
        signed: signWebhook(payload, {
          timestampSeconds: nowSeconds - WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS - 5,
        }),
      },
      {
        name: 'timestamp ahead of the tolerance',
        signed: signWebhook(payload, {
          timestampSeconds: nowSeconds + WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS + 5,
        }),
      },
      {
        name: 'forged signature',
        signed: withHeader(valid, 'x-couture-signature', 'deadbeef'.repeat(8)),
      },
      {
        name: 'signature from the wrong secret',
        signed: signWebhook(payload, { secret: `${PARTNER_SECRET}-wrong` }),
      },
      {
        name: 'unknown partner slug',
        signed: signWebhook(payload, { partnerSlug: 'no-such-partner' }),
      },
      {
        // Alters the currency rather than the amount. The amount's digits could
        // appear inside a generated eventId, which would silently move the
        // mutation somewhere the signature case was not meant to probe.
        name: 'body altered after signing',
        signed: { ...valid, body: valid.body.replace('"USD"', '"EUR"') },
      },
    ]

    for (const { name, signed } of cases) {
      await log.step(`Assert 401 for: ${name}`)
      const { status, body } = await postWebhook(
        apiRequest,
        commerceApi.apiBaseUrl,
        signed
      )

      expect(status, name).toBe(401)
      await validateSchema(unauthorizedHttpErrorSchema, body)
      // Every reason collapses into one message so the endpoint cannot be used
      // to enumerate which partner slugs exist or which secrets are configured.
      expect((body as { message: string }).message, name).toBe(
        WEBHOOK_SIGNATURE_INVALID_MESSAGE
      )
    }
  })

  test('[P2] 5.1-E2E-API-08 rejects a validly signed but malformed body with 400', async ({
    apiRequest,
    commerceApi,
    validateSchema,
  }) => {
    await log.step('Sign a body that passes the signature and fails the schema')
    // Schema validation runs only after all four signature checks pass, so a
    // 400 here is also proof the signature path was fully satisfied first.
    const withoutCurrency = {
      eventId: buildUniqueId('conversion-400', test.info()),
      clickToken: 'unknown-click-token-that-was-never-issued',
      occurredAt: new Date().toISOString(),
      status: 'confirmed',
      orderValueMinorUnits: 12_900,
      // `currency` is omitted on purpose. It is required by the payload schema,
      // so this body is well-formed JSON that the contract rejects.
    }

    const { status, body } = await postWebhook(
      apiRequest,
      commerceApi.apiBaseUrl,
      signWebhook(withoutCurrency)
    )

    expect(status).toBe(400)
    await validateSchema(badRequestHttpErrorSchema, body)
  })
})

/*
 * NOT COVERED HERE, AND WHY. "shopThisLook is null while
 * commerce_affiliate_enabled is off" and the click endpoint's 503 are the part of
 * AC 6 this layer cannot reach. The flag resolves remote-first through PostHog, then
 * through the shared `FeatureFlag` row, and no public endpoint sets either. Flipping
 * the row from a spec would make the flag global mutable state shared by every other
 * test in a `fullyParallel` run.
 *
 * Both are covered where the flag is injectable:
 *   - `apps/api/src/modules/commerce/affiliate-offer.service.spec.ts` (null block)
 *   - `apps/api/src/modules/commerce/affiliate-click.service.spec.ts` (503 precedence)
 *   - `apps/api/integration/commerce-affiliate-clicks.integration.spec.ts` (over HTTP)
 */
