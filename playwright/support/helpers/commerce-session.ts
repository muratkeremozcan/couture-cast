// Story 5.1 Task 9: browser and API sessions for the affiliate commerce journeys.
import type { APIRequestContext } from '@playwright/test'
import { expect, test } from '../fixtures/merged-fixtures'
import {
  authHeaders,
  buildUniqueId,
  createBirthdate,
  isNonLocalEnvironment,
  resolveApiBaseUrl,
} from './api-test'

export const WEB_ACCESS_TOKEN_STORAGE_KEY = 'couturecast.access-token'

export const COMMERCE_PREFERENCES_PATH = '/api/v1/commerce/preferences'
export const AFFILIATE_CLICKS_PATH = '/api/v1/commerce/affiliate/clicks'
export const AFFILIATE_WEBHOOK_PATH = '/api/v1/commerce/affiliate/webhook'

export type CommerceSession = {
  userId: string
  accessToken: string
  apiBaseUrl: string
}

/**
 * Signs up one throwaway account through the public API and returns its id.
 *
 * Every commerce journey mutates `CommercePreference`, which is a single row
 * per user. Sharing one seeded account across specs would mean a test that
 * toggles the opt-out off decides what a parallel worker's "renders enabled by
 * default" assertion sees. `fullyParallel` is on, so that is not hypothetical.
 * One fresh account per test removes the shared row entirely.
 */
export async function signUpCommerceUser(
  request: APIRequestContext,
  apiBaseUrl: string,
  prefix: string,
  uniqueSuffix: string
): Promise<string> {
  const response = await request.post(`${apiBaseUrl}/api/v1/auth/signup`, {
    data: {
      email: `${prefix}-${uniqueSuffix}@example.com`,
      // An adult birthdate on purpose. A teen account is gated behind active
      // guardian consent by `RequestAuthGuard`, so every commerce call would be
      // rejected with 403 before any commerce code ran. Decision 1 settled that
      // affiliate content is NOT age-suppressed, so the account's age is not
      // what these specs are exercising.
      birthdate: createBirthdate(30),
    },
  })

  expect(
    response.status(),
    `Signup failed: ${response.status()} ${await response.text()}`
  ).toBe(201)

  const body = (await response.json()) as { userId: string }
  expect(body.userId).toBeTruthy()
  return body.userId
}

/**
 * The integration bypass form the API accepts locally.
 *
 * `guardian` rather than `teen` for the reason above: the role only decides
 * which guard branch runs, and the identity is still the freshly created
 * account acting on its own preference row.
 */
export function commerceAccessToken(userId: string): string {
  return `test-token:guardian:${userId}`
}

/**
 * A signed-in browser session on a brand-new account.
 *
 * The init script goes on the context rather than the page so a reload, or a
 * second page, is still authenticated. `setExtraHTTPHeaders` covers the
 * Next.js rewrite path, where the browser talks to the web origin and the
 * server proxies through to the API.
 */
export const commerceTest = test.extend<{ commerceSession: CommerceSession }>({
  commerceSession: async ({ context, request }, use, testInfo) => {
    test.skip(
      isNonLocalEnvironment(testInfo),
      'Commerce journeys need the seeded local catalog and the local auth bypass.'
    )

    const apiBaseUrl = resolveApiBaseUrl(testInfo, { fallback: 'http://localhost:4000' })
    const userId = await signUpCommerceUser(
      request,
      apiBaseUrl,
      'commerce-e2e',
      buildUniqueId('web', testInfo)
    )
    const accessToken = commerceAccessToken(userId)

    await context.addInitScript(
      ([storageKey, token]) => {
        window.sessionStorage.setItem(storageKey as string, token as string)
      },
      [WEB_ACCESS_TOKEN_STORAGE_KEY, accessToken]
    )
    await context.setExtraHTTPHeaders({ Authorization: `Bearer ${accessToken}` })

    await use({ userId, accessToken, apiBaseUrl })

    /*
     * Cleanup through the public API. The account is disposable, so this is not
     * strictly required, but a retry of a failed test re-enters with the
     * preference already at its default rather than at whatever the failed
     * attempt left behind. There is no DELETE for a preference row; setting it
     * back to the default is the whole of the public surface.
     */
    await request.put(`${apiBaseUrl}${COMMERCE_PREFERENCES_PATH}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      data: { affiliateCtasEnabled: true },
    })
  },
})

export type CommerceApiContext = {
  userId: string
  apiBaseUrl: string
  /** Ready to spread onto any authenticated commerce or ritual request. */
  headers: Record<string, string>
}

/**
 * One throwaway account per API test, for the same reason as the browser
 * fixture above and one more: a `beforeAll`-scoped account is shared by every
 * test in the worker, so the opted-out case would decide what the eligible case
 * sees. Per-test isolation removes the ordering dependency instead of papering
 * over it with a restore step that a failed assertion can skip.
 *
 * The role is `admin` rather than `guardian` only because that is the proven
 * Playwright bypass shape for API specs in this repo
 * (`ritual-daily-outfits.spec.ts`). Commerce reads `auth.userId`; the role
 * decides nothing here.
 */
export const commerceApiTest = test.extend<{ commerceApi: CommerceApiContext }>({
  commerceApi: async ({ request }, use, testInfo) => {
    test.skip(
      isNonLocalEnvironment(testInfo),
      'Commerce API journeys need the seeded local catalog and the local auth bypass.'
    )

    const apiBaseUrl = resolveApiBaseUrl(testInfo, { fallback: 'http://localhost:4000' })
    const userId = await signUpCommerceUser(
      request,
      apiBaseUrl,
      'commerce-api-e2e',
      buildUniqueId('api', testInfo)
    )

    await use({ userId, apiBaseUrl, headers: authHeaders(userId, 'admin') })
  },
})

export { expect }
