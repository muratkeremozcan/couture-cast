import type { PactV4, V3MockServer } from '@pact-foundation/pact'
import { createProviderState, setJsonContent } from '@seontechnologies/pactjs-utils'
import {
  ADVISOR_RULES,
  ADVISOR_RULES_VERSION,
  PALETTE_ANALYSIS_DISABLED_MESSAGE,
  PALETTE_CONSENT_REQUIRED_MESSAGE,
  PREMIUM_REQUIRED_MESSAGE,
  analyzePaletteResponseSchema,
  paletteAdvisorProfileResponseSchema,
  setPaletteConsentResponseSchema,
  updateAdvisorRecommendationResponseSchema,
} from '@couture/api-client/contracts/http'
import { expect } from 'vitest'
import {
  like,
  nullValue,
  pactEventAuth,
  pactEventHeaders,
  string,
  type CreateClient,
} from './shared'

/* ---------------------------------------------------------------------------
 * Story 5.4 colour palette & beauty/accessory advisor.
 *
 * Both consumers call all four operations: each surface reads the profile on
 * mount, grants consent, starts a wardrobe analysis and saves or dismisses a
 * recommendation from the same screen.
 *
 * The interaction set is chosen around one fact a status code cannot carry.
 * Two completely different rejections answer 403 here -- the entitlement
 * guard's `PREMIUM_REQUIRED_MESSAGE` and the service's
 * `PALETTE_CONSENT_REQUIRED_MESSAGE` -- and both clients branch on the message
 * to decide between rendering an upsell and rendering a consent gate. That
 * branch is only as good as the two messages being pinned on the wire, which
 * is what the error rows below do.
 *
 * WHY each field resolves the way it does -- Decision 10's consent-before-flag
 * precedence, the dismissed-card omission, the offer short-circuit chain -- is
 * proven in `palette-advisor.service.spec.ts` and
 * `palette-advisor.controller.spec.ts`; these interactions record the response
 * shape and status/error envelope a client must understand.
 *
 * Every identifier below is mirrored in
 * `pact/http/provider/doubles/palette-advisor.ts`. Both sides must agree or the
 * pinned `string()` matchers fail verification.
 * ------------------------------------------------------------------------- */

const PALETTE_PROFILE_ID = 'pact-palette-profile'
const PALETTE_ANALYZED_AT = '2026-08-25T10:00:00.000Z'
const PALETTE_UNDERTONE = 'warm' as const
const PALETTE_DEPTH = 'medium' as const

const READY_FOUNDATION =
  ADVISOR_RULES[PALETTE_UNDERTONE].foundation.withDepth[PALETTE_DEPTH]
const READY_JEWELRY = ADVISOR_RULES[PALETTE_UNDERTONE].jewelry

const grantConsentRequestBody = { granted: true }
const analyzeRequestBody = { source: 'wardrobe' } as const
const dismissRequestBody = {
  itemKey: READY_FOUNDATION.itemKey,
  slot: 'foundation',
  action: 'dismissed',
} as const

/**
 * The ready-palette recommendation array as it appears on the wire.
 *
 * `itemKey`, `labelKey` and `swatchHex` are pinned with `string()` rather than
 * `like()` on purpose: they come from `ADVISOR_RULES`, they are the stable
 * identity save/dismiss and offer matching key on, and a provider that started
 * publishing a translated label or an array index instead would still satisfy a
 * loose type matcher.
 */
const readyRecommendationsBody = [
  {
    slot: string('foundation'),
    itemKey: string(READY_FOUNDATION.itemKey),
    labelKey: string(READY_FOUNDATION.labelKey),
    swatchHex: string(READY_FOUNDATION.swatchHex),
    saved: like(false),
    sponsored: {
      partnerId: string('lumen-beauty'),
      partnerDisplayName: like('Lumen Beauty'),
      offerId: string('pact-advisor-offer'),
      offerTitle: like('Lumen Skin Tint'),
    },
  },
  {
    slot: string('jewelry'),
    itemKey: string(READY_JEWELRY.itemKey),
    labelKey: string(READY_JEWELRY.labelKey),
    swatchHex: string(READY_JEWELRY.swatchHex),
    saved: like(false),
    // A slot with no matching offer renders its first-party recommendation
    // alone (AC 5). `nullValue()` rather than an omitted key: the field is
    // required and nullable, never absent.
    sponsored: nullValue(),
  },
]

const readyAnalysisBody = {
  status: string('ready'),
  failureReason: nullValue(),
  source: string('selfie'),
  undertone: string(PALETTE_UNDERTONE),
  depth: string(PALETTE_DEPTH),
  confidence: like(0.82),
  analysisVersion: string(ADVISOR_RULES_VERSION),
  analyzedAt: like(PALETTE_ANALYZED_AT),
}

/**
 * Provider endpoint: /api/v1/commerce/premium/palette -> GET PaletteAdvisorController.getProfile
 *
 * Provider Scrutiny Evidence:
 * - Handler: apps/api/src/modules/commerce/palette-advisor.controller.ts (getProfile)
 * - Response type: PaletteAdvisorProfileResponse
 *   ({ data: { profileId, isEntitled, analysisEnabled, hasConsent, analysis, recommendations } })
 * - Status codes: 200 always -- the GET carries `RequestAuthGuard` only and is
 *   never entitlement- or flag-gated, because a locked or kill-switched client
 *   still needs a state to render (Decision 10)
 * - Field names: `.strict()` on `paletteAdvisorProfileSchema`, with `analysis` a
 *   discriminated union whose derived scalars exist exactly on `ready`
 * - Cache-Control: `private, no-store`, applied by
 *   `CommerceCacheHeadersMiddleware` over the whole `/api/v1/commerce` prefix.
 *   Asserted here so a later route move outside that prefix cannot silently
 *   start caching a per-user body.
 *
 * An entitled, consented user with a ready selfie-sourced palette.
 */
export async function verifyEntitledPaletteReadInteraction(
  pact: PactV4,
  createClient: CreateClient
) {
  await pact
    .addInteraction()
    .given(
      ...createProviderState({
        name: 'The user has palette advisor access',
        params: { userId: pactEventAuth.userId },
      })
    )
    .uponReceiving('a request for the palette advisor profile of an entitled user')
    .withRequest(
      'GET',
      '/api/v1/commerce/premium/palette',
      setJsonContent({ headers: pactEventHeaders })
    )
    .willRespondWith(
      200,
      setJsonContent({
        headers: { 'Cache-Control': string('private, no-store') },
        body: {
          data: {
            profileId: string(PALETTE_PROFILE_ID),
            isEntitled: like(true),
            analysisEnabled: like(true),
            hasConsent: like(true),
            analysis: readyAnalysisBody,
            recommendations: readyRecommendationsBody,
          },
        },
      })
    )
    .executeTest(async (mockServer: V3MockServer) => {
      const response = await createClient(mockServer).apiV1CommercePremiumPaletteGet()

      const parsed = paletteAdvisorProfileResponseSchema.parse(response)
      expect(parsed.data.isEntitled).toBe(true)
      expect(parsed.data.hasConsent).toBe(true)
      expect(parsed.data.analysis?.status).toBe('ready')
      // The profile id is what an advisor click sends back as its
      // `recommendationId` (Decision 7), so a client that cannot read it here
      // cannot mint a sponsored click at all.
      expect(parsed.data.profileId).toBe(PALETTE_PROFILE_ID)
      expect(parsed.data.recommendations.map((card) => card.itemKey)).toEqual([
        READY_FOUNDATION.itemKey,
        READY_JEWELRY.itemKey,
      ])
      expect(parsed.data.recommendations[1]?.sponsored).toBeNull()
    })
}

/**
 * Provider endpoint: /api/v1/commerce/premium/palette -> GET PaletteAdvisorController.getProfile
 *
 * Provider Scrutiny Evidence: same handler/response type/status code as
 * {@link verifyEntitledPaletteReadInteraction}. This is the locked state both
 * surfaces render, and the reason the GET is not entitlement-gated: `analysis`
 * is `nullValue()` and `recommendations` empty, but the call still answers 200
 * so the client knows WHICH locked state to show.
 */
export async function verifyNotEntitledPaletteReadInteraction(
  pact: PactV4,
  createClient: CreateClient
) {
  await pact
    .addInteraction()
    .given(
      ...createProviderState({
        name: 'The user does not have palette advisor access',
        params: { userId: pactEventAuth.userId },
      })
    )
    .uponReceiving('a request for the palette advisor profile of a non-entitled user')
    .withRequest(
      'GET',
      '/api/v1/commerce/premium/palette',
      setJsonContent({ headers: pactEventHeaders })
    )
    .willRespondWith(
      200,
      setJsonContent({
        headers: { 'Cache-Control': string('private, no-store') },
        body: {
          data: {
            profileId: string(PALETTE_PROFILE_ID),
            isEntitled: like(false),
            analysisEnabled: like(true),
            hasConsent: like(false),
            analysis: nullValue(),
            recommendations: [],
          },
        },
      })
    )
    .executeTest(async (mockServer: V3MockServer) => {
      const response = await createClient(mockServer).apiV1CommercePremiumPaletteGet()

      const parsed = paletteAdvisorProfileResponseSchema.parse(response)
      expect(parsed.data.isEntitled).toBe(false)
      expect(parsed.data.analysis).toBeNull()
      expect(parsed.data.recommendations).toEqual([])
    })
}

/**
 * Provider endpoint: /api/v1/commerce/premium/palette/consent -> POST PaletteAdvisorController.setConsent
 *
 * Provider Scrutiny Evidence:
 * - Handler: apps/api/src/modules/commerce/palette-advisor.controller.ts (setConsent)
 * - Response type: SetPaletteConsentResponse (the same profile shape the GET returns,
 *   so a client replaces its whole view from it rather than patching one field)
 * - Status codes: 200 on success; 403 non-entitled (guard, pre-handler);
 *   503 kill switch (service body)
 * - Field names: `{ granted: boolean }` in, `.strict()`
 */
export async function verifyPaletteConsentGrantInteraction(
  pact: PactV4,
  createClient: CreateClient
) {
  await pact
    .addInteraction()
    .given(
      ...createProviderState({
        name: 'The user has palette advisor access',
        params: { userId: pactEventAuth.userId },
      })
    )
    .uponReceiving('a request to grant palette analysis consent')
    .withRequest(
      'POST',
      '/api/v1/commerce/premium/palette/consent',
      setJsonContent({ headers: pactEventHeaders, body: grantConsentRequestBody })
    )
    .willRespondWith(
      200,
      setJsonContent({
        headers: { 'Cache-Control': string('private, no-store') },
        body: {
          data: {
            profileId: string(PALETTE_PROFILE_ID),
            isEntitled: like(true),
            analysisEnabled: like(true),
            hasConsent: like(true),
            analysis: readyAnalysisBody,
            recommendations: readyRecommendationsBody,
          },
        },
      })
    )
    .executeTest(async (mockServer: V3MockServer) => {
      const response = await createClient(
        mockServer
      ).apiV1CommercePremiumPaletteConsentPost({
        setPaletteConsentInput: grantConsentRequestBody,
      })

      const parsed = setPaletteConsentResponseSchema.parse(response)
      expect(parsed.data.hasConsent).toBe(true)
    })
}

/**
 * Provider endpoint: /api/v1/commerce/premium/palette/analyze -> POST PaletteAdvisorController.analyze
 *
 * Provider Scrutiny Evidence:
 * - Handler: apps/api/src/modules/commerce/palette-advisor.controller.ts (analyze)
 * - Response type: AnalyzePaletteResponse (the profile shape again)
 * - Status codes: **202**, not 200 -- the analysis is enqueued, not performed
 *   inline, and the body carries `status: 'processing'` rather than a result.
 *   A client that treated 202 as "done" would render a ready palette that does
 *   not exist yet, so the status is part of the contract.
 * - Field names: `{ source: 'wardrobe' }` in, a literal rather than an enum:
 *   the selfie source goes through the upload lifecycle, never through here.
 */
export async function verifyWardrobeAnalyzeInteraction(
  pact: PactV4,
  createClient: CreateClient
) {
  await pact
    .addInteraction()
    .given(
      ...createProviderState({
        name: 'The user has palette advisor access',
        params: { userId: pactEventAuth.userId },
      })
    )
    .uponReceiving('a request to derive a palette from the wardrobe')
    .withRequest(
      'POST',
      '/api/v1/commerce/premium/palette/analyze',
      setJsonContent({ headers: pactEventHeaders, body: analyzeRequestBody })
    )
    .willRespondWith(
      202,
      setJsonContent({
        headers: { 'Cache-Control': string('private, no-store') },
        body: {
          data: {
            profileId: string(PALETTE_PROFILE_ID),
            isEntitled: like(true),
            analysisEnabled: like(true),
            hasConsent: like(true),
            analysis: {
              status: string('processing'),
              failureReason: nullValue(),
              source: string('wardrobe'),
              undertone: nullValue(),
              depth: nullValue(),
              confidence: nullValue(),
              analysisVersion: nullValue(),
              analyzedAt: nullValue(),
            },
            recommendations: [],
          },
        },
      })
    )
    .executeTest(async (mockServer: V3MockServer) => {
      const response = await createClient(
        mockServer
      ).apiV1CommercePremiumPaletteAnalyzePost({
        analyzePaletteInput: analyzeRequestBody,
      })

      const parsed = analyzePaletteResponseSchema.parse(response)
      expect(parsed.data.analysis?.status).toBe('processing')
      expect(parsed.data.analysis?.source).toBe('wardrobe')
    })
}

/**
 * Provider endpoint: /api/v1/commerce/premium/palette/recommendations -> PUT PaletteAdvisorController.updateRecommendation
 *
 * Provider Scrutiny Evidence:
 * - Handler: apps/api/src/modules/commerce/palette-advisor.controller.ts
 *   (updateRecommendation)
 * - Response type: UpdateAdvisorRecommendationResponse (the profile shape)
 * - Status codes: 200; not flag-gated -- a save/dismiss is a preference write,
 *   not an analysis path
 * - Field names: `{ itemKey, slot, action }` with `action` nullable (null
 *   clears the row)
 *
 * AC 6's observable rule: a dismissed card is absent from the response
 * entirely, not flagged. This interaction is the wire proof of that.
 */
export async function verifyDismissRecommendationInteraction(
  pact: PactV4,
  createClient: CreateClient
) {
  await pact
    .addInteraction()
    .given(
      ...createProviderState({
        name: 'The user has palette advisor access',
        params: { userId: pactEventAuth.userId },
      })
    )
    .uponReceiving('a request to dismiss an advisor recommendation')
    .withRequest(
      'PUT',
      '/api/v1/commerce/premium/palette/recommendations',
      setJsonContent({ headers: pactEventHeaders, body: dismissRequestBody })
    )
    .willRespondWith(
      200,
      setJsonContent({
        headers: { 'Cache-Control': string('private, no-store') },
        body: {
          data: {
            profileId: string(PALETTE_PROFILE_ID),
            isEntitled: like(true),
            analysisEnabled: like(true),
            hasConsent: like(true),
            analysis: readyAnalysisBody,
            recommendations: [readyRecommendationsBody[1]],
          },
        },
      })
    )
    .executeTest(async (mockServer: V3MockServer) => {
      const response = await createClient(
        mockServer
      ).apiV1CommercePremiumPaletteRecommendationsPut({
        updateAdvisorRecommendationInput: dismissRequestBody,
      })

      const parsed = updateAdvisorRecommendationResponseSchema.parse(response)
      expect(parsed.data.recommendations.map((card) => card.itemKey)).toEqual([
        READY_JEWELRY.itemKey,
      ])
    })
}

/**
 * Decision 10's status precedence, as table-driven error rows, mirroring
 * `premiumThemeErrorInteractions` exactly. Each row drives its own `it.each`
 * case: PactV4's Rust FFI non-deterministically drops an interaction when more
 * than one `addInteraction()...executeTest()` chain is awaited inside one test
 * body.
 *
 * All rows are POST /analyze, the one route that mounts the guard, checks
 * consent and checks the flag, so all three outcomes are reachable from a
 * single request shape.
 *
 * The order encodes the precedence, and it is the reason all three rows exist
 * rather than one: `PremiumEntitlementGuard` runs pre-handler, so a
 * non-entitled caller ALWAYS sees `PREMIUM_REQUIRED_MESSAGE` and can never
 * observe either of the others; consent is checked before the flag inside the
 * service, so an entitled-but-unconsented caller always sees
 * `PALETTE_CONSENT_REQUIRED_MESSAGE`; and only an entitled, consented caller
 * can ever observe the kill switch's 503.
 */
export type PaletteAdvisorErrorInteraction = {
  description: string
  state: string
  stateParams: Record<string, string>
  status: number
  message: string
  reason: string
}

export const paletteAdvisorErrorInteractions: PaletteAdvisorErrorInteraction[] = [
  {
    description: 'rejects an analysis from a non-entitled caller',
    state: 'The user does not have palette advisor access',
    stateParams: { userId: pactEventAuth.userId },
    status: 403,
    message: PREMIUM_REQUIRED_MESSAGE,
    reason: 'Forbidden',
  },
  {
    // The same status as the row above and a completely different meaning.
    // Both clients decide between "subscribe" and "grant consent" by reading
    // this message, so it is pinned rather than matched loosely.
    description: 'rejects an analysis from an entitled caller who has not consented',
    state: 'The user has not granted palette analysis consent',
    stateParams: { userId: pactEventAuth.userId },
    status: 403,
    message: PALETTE_CONSENT_REQUIRED_MESSAGE,
    reason: 'Forbidden',
  },
  {
    description: 'reports the disabled color analysis feature as unavailable',
    state: 'Palette color analysis is disabled',
    stateParams: { userId: pactEventAuth.userId },
    status: 503,
    message: PALETTE_ANALYSIS_DISABLED_MESSAGE,
    reason: 'Service Unavailable',
  },
]

/**
 * Provider endpoint: /api/v1/commerce/premium/palette/analyze -> POST PaletteAdvisorController.analyze
 *
 * Provider Scrutiny Evidence:
 * - Handler: apps/api/src/modules/commerce/palette-advisor.controller.ts (analyze)
 * - Response type: the shared HTTP error envelope, `.strict()` over exactly
 *   `{ statusCode, message, error }`
 * - Status codes: 403 (PremiumEntitlementGuard.canActivate) outranking the
 *   service body's own 403/503 pair (PaletteAdvisorService.assertConsent, then
 *   assertAnalysisEnabled)
 */
export async function verifyPaletteAdvisorErrorInteraction(
  pact: PactV4,
  interaction: PaletteAdvisorErrorInteraction
) {
  await pact
    .addInteraction()
    .given(
      ...createProviderState({ name: interaction.state, params: interaction.stateParams })
    )
    .uponReceiving(`a palette analysis request that ${interaction.description}`)
    .withRequest(
      'POST',
      '/api/v1/commerce/premium/palette/analyze',
      setJsonContent({ headers: pactEventHeaders, body: analyzeRequestBody })
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
      const response = await fetch(
        `${mockServer.url}/api/v1/commerce/premium/palette/analyze`,
        {
          method: 'POST',
          headers: { ...pactEventHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify(analyzeRequestBody),
        }
      )

      expect(response.status).toBe(interaction.status)
      expect(response.headers.get('cache-control')).toBe('private, no-store')

      const payload = (await response.json()) as Record<string, unknown>
      expect(payload.message).toBe(interaction.message)
      expect(payload.error).toBe(interaction.reason)
      // There is no machine-readable code to branch on, by design.
      expect(payload).not.toHaveProperty('code')
    })
}
