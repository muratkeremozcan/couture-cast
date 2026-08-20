import type { PactV4, V3MockServer } from '@pact-foundation/pact'
import { createProviderState, setJsonContent } from '@seontechnologies/pactjs-utils'
import {
  PREMIUM_REQUIRED_MESSAGE,
  PREMIUM_THEMES_DISABLED_MESSAGE,
  PREMIUM_THEME_OWNER_NOT_FOUND_MESSAGE,
  premiumThemeResponseSchema,
  updatePremiumThemeResponseSchema,
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
 * Story 5.3 premium theme switcher.
 *
 * Unlike 5.2's asymmetric subscription split, both consumers call both
 * operations here: each surface's settings section reads the resolved
 * palette on mount and writes a selection or a reset from the same gallery.
 * WHEN each field resolves the way it does -- Decision 7's
 * entitlement-wins-over-stored-row rule, the P2023 stale-enum fallback in
 * `readStoredTheme`, and the flag-vs-body-parse precedence on the PUT -- is
 * proven in `premium-theme.service.spec.ts` and
 * `premium-theme.controller.spec.ts`; these interactions record the response
 * shape and status/error envelope a client must understand.
 *
 * Every identifier below is mirrored in `pact/http/provider/provider-helper.ts`.
 * Both sides must agree or the pinned `string()` matchers fail verification.
 * ------------------------------------------------------------------------- */

const PREMIUM_THEME_STORED_KEY = 'jewel_radiance' as const
const PREMIUM_THEME_UPDATE_KEY = 'autumn_umber' as const

const updateThemeRequestBody = { theme: PREMIUM_THEME_UPDATE_KEY }
const resetThemeRequestBody = { theme: null }

/**
 * Provider endpoint: /api/v1/commerce/premium/theme -> GET PremiumThemeController.getTheme
 *
 * Provider Scrutiny Evidence:
 * - Handler: apps/api/src/modules/commerce/premium-theme.controller.ts:65-70 (getTheme)
 * - Response type: PremiumThemeResponse ({ data: { theme, isEntitled, themesEnabled } })
 * - Status codes: 200 always -- the GET carries `RequestAuthGuard` only, never
 *   entitlement- or flag-gated (controller docblock :30-34)
 * - Field names: theme (PremiumThemeKey | null), isEntitled (boolean),
 *   themesEnabled (boolean) -- premium-theme.ts premiumThemeSchema, `.strict()`
 *
 * An entitled user with a stored palette: `theme` carries the stored key,
 * `isEntitled` and `themesEnabled` both true.
 */
export async function verifyEntitledThemeReadInteraction(
  pact: PactV4,
  createClient: CreateClient
) {
  await pact
    .addInteraction()
    .given(
      ...createProviderState({
        name: 'The user has premium theme access',
        params: { userId: pactEventAuth.userId, theme: PREMIUM_THEME_STORED_KEY },
      })
    )
    .uponReceiving(
      'a request for the resolved premium theme of an entitled user with a stored palette'
    )
    .withRequest(
      'GET',
      '/api/v1/commerce/premium/theme',
      setJsonContent({ headers: pactEventHeaders })
    )
    .willRespondWith(
      200,
      setJsonContent({
        headers: { 'Cache-Control': string('private, no-store') },
        body: {
          data: {
            theme: string(PREMIUM_THEME_STORED_KEY),
            isEntitled: like(true),
            themesEnabled: like(true),
          },
        },
      })
    )
    .executeTest(async (mockServer: V3MockServer) => {
      const response = await createClient(mockServer).apiV1CommercePremiumThemeGet()

      const parsed = premiumThemeResponseSchema.parse(response)
      expect(parsed.data.theme).toBe(PREMIUM_THEME_STORED_KEY)
      expect(parsed.data.isEntitled).toBe(true)
      expect(parsed.data.themesEnabled).toBe(true)
    })
}

/**
 * Provider endpoint: /api/v1/commerce/premium/theme -> GET PremiumThemeController.getTheme
 *
 * Provider Scrutiny Evidence: same handler/response type/status codes as
 * {@link verifyEntitledThemeReadInteraction} above. `theme` is asserted with
 * `nullValue()` here, mirroring the 5.2 `never-subscribed` interaction's use
 * of `nullValue()` for a null member of a nullable union -- Decision 8: an
 * absent row and a stored NULL both resolve to Default and are
 * indistinguishable on the wire.
 *
 * An entitled user with no stored preference (the never-touched-the-gallery
 * case, and the state a reset lands on): `theme` is null (Default), both
 * flags stay true.
 */
export async function verifyEntitledThemeReadDefaultInteraction(
  pact: PactV4,
  createClient: CreateClient
) {
  await pact
    .addInteraction()
    .given(
      ...createProviderState({
        name: 'The user has premium theme access',
        params: { userId: pactEventAuth.userId },
      })
    )
    .uponReceiving(
      'a request for the resolved premium theme of an entitled user with no stored palette'
    )
    .withRequest(
      'GET',
      '/api/v1/commerce/premium/theme',
      setJsonContent({ headers: pactEventHeaders })
    )
    .willRespondWith(
      200,
      setJsonContent({
        headers: { 'Cache-Control': string('private, no-store') },
        body: {
          data: {
            theme: nullValue(),
            isEntitled: like(true),
            themesEnabled: like(true),
          },
        },
      })
    )
    .executeTest(async (mockServer: V3MockServer) => {
      const response = await createClient(mockServer).apiV1CommercePremiumThemeGet()

      const parsed = premiumThemeResponseSchema.parse(response)
      expect(parsed.data).toEqual({ theme: null, isEntitled: true, themesEnabled: true })
    })
}

/**
 * Provider endpoint: /api/v1/commerce/premium/theme -> GET PremiumThemeController.getTheme
 *
 * Provider Scrutiny Evidence: same handler/response type/status codes as
 * above. AC 6 / Decision 7 -- entitlement wins over the stored row, always:
 * a non-entitled caller's `theme` is forced null regardless of what is
 * stored (premium-theme.service.ts:93-95, `getTheme`).
 */
export async function verifyNotEntitledThemeReadInteraction(
  pact: PactV4,
  createClient: CreateClient
) {
  await pact
    .addInteraction()
    .given(
      ...createProviderState({
        name: 'The user does not have premium theme access',
        params: { userId: pactEventAuth.userId },
      })
    )
    .uponReceiving('a request for the resolved premium theme of a non-entitled user')
    .withRequest(
      'GET',
      '/api/v1/commerce/premium/theme',
      setJsonContent({ headers: pactEventHeaders })
    )
    .willRespondWith(
      200,
      setJsonContent({
        headers: { 'Cache-Control': string('private, no-store') },
        body: {
          data: {
            theme: nullValue(),
            isEntitled: like(false),
            themesEnabled: like(true),
          },
        },
      })
    )
    .executeTest(async (mockServer: V3MockServer) => {
      const response = await createClient(mockServer).apiV1CommercePremiumThemeGet()

      const parsed = premiumThemeResponseSchema.parse(response)
      expect(parsed.data).toEqual({ theme: null, isEntitled: false, themesEnabled: true })
    })
}

/**
 * Provider endpoint: /api/v1/commerce/premium/theme -> PUT PremiumThemeController.setTheme
 *
 * Provider Scrutiny Evidence:
 * - Handler: apps/api/src/modules/commerce/premium-theme.controller.ts:78-88 (setTheme)
 * - Response type: UpdatePremiumThemeResponse (same shape as PremiumThemeResponse)
 * - Status codes: 200 always, including when the submitted palette matches
 *   the stored one (controller docblock :72-76)
 * - Field names: `theme` echoes the freshly resolved, persisted value, never
 *   the raw request body directly -- premium-theme.service.ts:120-142 (setTheme)
 *
 * An entitled caller with the flag on selects a named palette.
 */
export async function verifyThemeUpdateInteraction(
  pact: PactV4,
  createClient: CreateClient
) {
  await pact
    .addInteraction()
    .given(
      ...createProviderState({
        name: 'The user has premium theme access',
        params: { userId: pactEventAuth.userId },
      })
    )
    .uponReceiving('a request to select a premium theme palette')
    .withRequest(
      'PUT',
      '/api/v1/commerce/premium/theme',
      setJsonContent({ headers: pactEventHeaders, body: updateThemeRequestBody })
    )
    .willRespondWith(
      200,
      setJsonContent({
        headers: { 'Cache-Control': string('private, no-store') },
        body: {
          data: {
            theme: string(PREMIUM_THEME_UPDATE_KEY),
            isEntitled: like(true),
            themesEnabled: like(true),
          },
        },
      })
    )
    .executeTest(async (mockServer: V3MockServer) => {
      const response = await createClient(mockServer).apiV1CommercePremiumThemePut({
        updatePremiumThemeInput: updateThemeRequestBody,
      })

      const parsed = updatePremiumThemeResponseSchema.parse(response)
      expect(parsed.data.theme).toBe(PREMIUM_THEME_UPDATE_KEY)
      expect(parsed.data.isEntitled).toBe(true)
      expect(parsed.data.themesEnabled).toBe(true)
    })
}

/**
 * Provider endpoint: /api/v1/commerce/premium/theme -> PUT PremiumThemeController.setTheme
 *
 * Provider Scrutiny Evidence: same handler/response type/status codes as
 * {@link verifyThemeUpdateInteraction} above. Decision 8: `{ theme: null }`
 * is a reset, resolved by an upsert to NULL, never a delete. This interaction
 * proves only the wire contract -- a null request resolves to a null
 * (Default) response -- not the upsert-vs-delete internal, which
 * `premium-theme.service.spec.ts` already unit-tests directly against the
 * repository call.
 */
export async function verifyThemeResetInteraction(
  pact: PactV4,
  createClient: CreateClient
) {
  await pact
    .addInteraction()
    .given(
      ...createProviderState({
        name: 'The user has premium theme access',
        params: { userId: pactEventAuth.userId, theme: PREMIUM_THEME_STORED_KEY },
      })
    )
    .uponReceiving('a request to reset the premium theme to Default')
    .withRequest(
      'PUT',
      '/api/v1/commerce/premium/theme',
      setJsonContent({ headers: pactEventHeaders, body: resetThemeRequestBody })
    )
    .willRespondWith(
      200,
      setJsonContent({
        headers: { 'Cache-Control': string('private, no-store') },
        body: {
          data: {
            theme: nullValue(),
            isEntitled: like(true),
            themesEnabled: like(true),
          },
        },
      })
    )
    .executeTest(async (mockServer: V3MockServer) => {
      const response = await createClient(mockServer).apiV1CommercePremiumThemePut({
        updatePremiumThemeInput: resetThemeRequestBody,
      })

      const parsed = updatePremiumThemeResponseSchema.parse(response)
      expect(parsed.data).toEqual({ theme: null, isEntitled: true, themesEnabled: true })
    })
}

/**
 * Decision 9's status precedence, expressed as table-driven error rows,
 * mirroring `SubscriptionErrorInteraction`/`verifySubscriptionErrorInteraction`
 * exactly. The shared error envelopes are `.strict()` over exactly
 * `{ statusCode, message, error }`, so a client branches on status plus one
 * of the exported message constants. Each row drives its own `it.each` case:
 * PactV4's Rust FFI non-deterministically drops an interaction when more than
 * one `addInteraction()...executeTest()` chain is awaited inside one test
 * body.
 *
 * All three rows are PUT-only: the GET operation is never entitlement- or
 * flag-gated (Decision 9) and never writes, so it has no error rows of its own
 * to cover here. 403 outranks 503 because `PremiumEntitlementGuard` runs
 * pre-handler while the flag check lives in the service body -- a non-entitled
 * caller can never observe the kill switch. The 404 sits behind both: it is
 * raised by the write itself, so a caller only reaches it after passing the
 * guard and the flag.
 */
export type PremiumThemeErrorInteraction = {
  description: string
  state: string
  stateParams: Record<string, string>
  status: number
  message: string
  reason: string
}

export const premiumThemeErrorInteractions: PremiumThemeErrorInteraction[] = [
  {
    description: 'rejects a theme write from a non-entitled caller',
    state: 'The user does not have premium theme access',
    stateParams: { userId: pactEventAuth.userId },
    status: 403,
    message: PREMIUM_REQUIRED_MESSAGE,
    reason: 'Forbidden',
  },
  {
    description: 'reports the disabled premium themes feature as unavailable',
    state: 'Premium themes are disabled',
    stateParams: { userId: pactEventAuth.userId },
    status: 503,
    message: PREMIUM_THEMES_DISABLED_MESSAGE,
    reason: 'Service Unavailable',
  },
  {
    // The account erased between the guard's entitlement check and the write.
    // In the provider this is Prisma `P2003` on the preference table's user
    // foreign key, remapped in `PremiumThemeService.writePreference`; before
    // that remapping the same race answered 500, which named the server as
    // broken for what is really an account that no longer exists.
    description: 'reports a write whose owning account was erased mid-request',
    state: 'The premium theme owner account no longer exists',
    stateParams: { userId: pactEventAuth.userId },
    status: 404,
    message: PREMIUM_THEME_OWNER_NOT_FOUND_MESSAGE,
    reason: 'Not Found',
  },
]

/**
 * Provider endpoint: /api/v1/commerce/premium/theme -> PUT PremiumThemeController.setTheme
 *
 * Provider Scrutiny Evidence:
 * - Handler: apps/api/src/modules/commerce/premium-theme.controller.ts:78-105
 *   (setTheme / parseThemeRequest)
 * - Response type: the shared HTTP error envelope, `.strict()` over exactly
 *   `{ statusCode, message, error }`
 * - Status codes: 403 (PremiumEntitlementGuard.canActivate,
 *   premium-entitlement.guard.ts:35-50) outranking 503
 *   (PremiumThemeService.assertThemesEnabled, premium-theme.service.ts:104-108)
 */
export async function verifyPremiumThemeErrorInteraction(
  pact: PactV4,
  interaction: PremiumThemeErrorInteraction
) {
  await pact
    .addInteraction()
    .given(
      ...createProviderState({ name: interaction.state, params: interaction.stateParams })
    )
    .uponReceiving(`a premium theme write that ${interaction.description}`)
    .withRequest(
      'PUT',
      '/api/v1/commerce/premium/theme',
      setJsonContent({ headers: pactEventHeaders, body: updateThemeRequestBody })
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
      const response = await fetch(`${mockServer.url}/api/v1/commerce/premium/theme`, {
        method: 'PUT',
        headers: { ...pactEventHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify(updateThemeRequestBody),
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
