// Story 5.2 Task 9: browser and API sessions for the premium subscription journeys.
//
// Modeled on `commerce-session.ts`, with one structural difference that shapes
// every fixture below: `PremiumEntitlement` is worker-only by design (a
// client-writable entitlement row is free Premium), so the entitled, expired,
// and grace-period branches CANNOT be arranged through the public API. They are
// reached through the deterministic seed users from
// `packages/db/prisma/seeds/commerce.ts` (Story 5.2 Decision 9). The
// never-subscribed branch is the one state a fresh public-API signup provides.
import type { APIRequestContext } from '@playwright/test'
import { PREMIUM_SEED_USERS } from '../../../packages/db/prisma/seeds/commerce'
import { expect, test } from '../fixtures/merged-fixtures'
import {
  authHeaders,
  buildUniqueId,
  isNonLocalEnvironment,
  resolveApiBaseUrl,
} from './api-test'
import {
  WEB_ACCESS_TOKEN_STORAGE_KEY,
  commerceAccessToken,
  signUpCommerceUser,
} from './commerce-session'

export const SUBSCRIPTION_PATH = '/api/v1/commerce/subscription'
export const SUBSCRIPTION_REFRESH_PATH = '/api/v1/commerce/subscription/refresh'
export const CHECKOUT_SESSION_PATH = '/api/v1/commerce/subscription/checkout-session'
export const PORTAL_SESSION_PATH = '/api/v1/commerce/subscription/portal-session'
export const STRIPE_WEBHOOK_PATH = '/api/v1/commerce/subscription/webhooks/stripe'
export const REVENUECAT_WEBHOOK_PATH = '/api/v1/commerce/subscription/webhooks/revenuecat'

/**
 * The FakeStripeBillingClient's checkout URLs live on this RFC-2606 host
 * (`stripe-client.ts`, Decision 9), which never resolves in DNS. Every spec
 * that lets the browser navigate to a checkout URL must stub this host first.
 */
export const FAKE_CHECKOUT_ORIGIN = 'https://checkout.stripe.test'

export type PremiumSeedUserKey = keyof typeof PREMIUM_SEED_USERS

export type PremiumSession = {
  userId: string
  accessToken: string
  apiBaseUrl: string
}

/**
 * A signed-in browser session as one of the three seeded premium users.
 *
 * THE SEED USERS ARE SHARED ACROSS PARALLEL WORKERS. These fixtures are
 * read-only on purpose: the seeded entitlement rows have no public write path,
 * and the one authenticated endpoint that CAN rewrite them — `POST
 * /subscription/refresh`, whose ledger pull downgrades a locally-active row the
 * fake ledger knows nothing about (`applyLedgerSnapshot`'s `state: null`
 * branch) — must never be called as a seeded user. Refresh journeys belong to
 * fresh accounts. There is deliberately no cleanup step here because a
 * read-only session has nothing to restore.
 *
 * Select the user per describe block with
 * `premiumSeededTest.use({ premiumSeedUser: 'expired' })`.
 */
export const premiumSeededTest = test.extend<{
  premiumSeedUser: PremiumSeedUserKey
  premiumSession: PremiumSession
}>({
  premiumSeedUser: ['active', { option: true }],
  premiumSession: async ({ context, premiumSeedUser }, use, testInfo) => {
    test.skip(
      isNonLocalEnvironment(testInfo),
      'Premium journeys need the seeded entitlement fixtures and the local auth bypass.'
    )

    const apiBaseUrl = resolveApiBaseUrl(testInfo, { fallback: 'http://localhost:4000' })
    const userId = PREMIUM_SEED_USERS[premiumSeedUser].id
    const accessToken = commerceAccessToken(userId)

    // Context-level, not page-level, exactly like `commerceTest`: a reload or a
    // second page stays authenticated, and `setExtraHTTPHeaders` covers the
    // Next.js rewrite path where the server proxies to the API.
    await context.addInitScript(
      ([storageKey, token]) => {
        window.sessionStorage.setItem(storageKey as string, token as string)
      },
      [WEB_ACCESS_TOKEN_STORAGE_KEY, accessToken]
    )
    await context.setExtraHTTPHeaders({ Authorization: `Bearer ${accessToken}` })

    await use({ userId, accessToken, apiBaseUrl })
  },
})

/**
 * A signed-in browser session on a brand-new, never-subscribed account — the
 * one premium state the public API can arrange. Used for the `status: 'none'`
 * settings branch and the checkout hand-off, where the test drives a real
 * checkout-session creation and must not race other workers on a shared user
 * (checkout creates a per-user `BillingCustomer` row at session time).
 *
 * The account is disposable and nothing premium-related on it is restorable
 * through the public surface, so there is no cleanup step.
 */
export const premiumFreshTest = test.extend<{ premiumFreshSession: PremiumSession }>({
  premiumFreshSession: async ({ context, request }, use, testInfo) => {
    test.skip(
      isNonLocalEnvironment(testInfo),
      'Premium journeys need the local stack (fake Stripe/RevenueCat clients) and the local auth bypass.'
    )

    const apiBaseUrl = resolveApiBaseUrl(testInfo, { fallback: 'http://localhost:4000' })
    const userId = await signUpCommerceUser(
      request,
      apiBaseUrl,
      'premium-e2e',
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
  },
})

export type PremiumApiContext = {
  /** A fresh, never-subscribed account created for this one test. */
  userId: string
  apiBaseUrl: string
  /** Ready to spread onto authenticated subscription requests as the fresh user. */
  headers: Record<string, string>
}

/**
 * One throwaway account per API test, mirroring `commerceApiTest` (including
 * its role note: `admin` is the proven Playwright bypass shape for API specs;
 * the subscription endpoints read only `auth.userId`). Seeded users need no
 * fixture on the API side — `authHeaders(PREMIUM_SEED_USERS.<key>.id, 'admin')`
 * is the whole of a read-only seeded call, and keeping it explicit at the call
 * site makes the read-only discipline visible where it matters.
 */
export const premiumApiTest = test.extend<{ premiumApi: PremiumApiContext }>({
  premiumApi: async ({ request }, use, testInfo) => {
    test.skip(
      isNonLocalEnvironment(testInfo),
      'Premium API journeys need the seeded entitlement fixtures, the fake billing clients, and the local auth bypass.'
    )

    const apiBaseUrl = resolveApiBaseUrl(testInfo, { fallback: 'http://localhost:4000' })
    const userId = await signUpCommerceUser(
      request,
      apiBaseUrl,
      'premium-api-e2e',
      buildUniqueId('api', testInfo)
    )

    await use({ userId, apiBaseUrl, headers: authHeaders(userId, 'admin') })
  },
})

/**
 * Story 5.5 Task 10 owner: ensures a seeded premium account owns at least one
 * saved location, so a planner read can resolve one -- AC 1's "the user's
 * primary or first saved location". None of the seed graph
 * (`packages/db/prisma/seeds/commerce.ts`) gives `PREMIUM_SEED_USERS` a
 * `SavedLocation`, and the planner has no location picker to arrange one
 * through the UI (Task 7's Dev Notes), so this is the setup step.
 *
 * Unlike `createLocationForUser` in `commerce-session.ts` -- built for a
 * fresh, throwaway account asserted to have none yet -- this account is
 * SHARED and PERSISTENT across every spec file and worker (see the file
 * header), so this is check-then-create, not create: a location left behind
 * by an earlier run already satisfies the precondition, and a `400` from a
 * concurrent worker racing the same create is
 * `PrismaLocationPreferencesRepository`'s advisory-lock-guarded unique
 * constraint doing exactly its job, not a failure to surface.
 */
export async function ensurePremiumSeedLocation(
  request: APIRequestContext,
  apiBaseUrl: string,
  userId: string
): Promise<void> {
  const headers = { Authorization: `Bearer ${commerceAccessToken(userId)}` }

  const existing = await request.get(`${apiBaseUrl}/api/v1/locations`, { headers })
  if (existing.ok()) {
    const body = (await existing.json()) as { data?: unknown[] }
    if (Array.isArray(body.data) && body.data.length > 0) {
      return
    }
  }

  const created = await request.post(`${apiBaseUrl}/api/v1/locations`, {
    headers,
    data: {
      label: 'Chicago',
      locationKey: 'chicago-il',
      latitude: 41.878,
      longitude: -87.63,
      timezone: 'America/Chicago',
    },
  })
  if (created.status() !== 201 && created.status() !== 400) {
    throw new Error(
      `Planner seed-location setup failed: ${created.status()} ${await created.text()}`
    )
  }
}

export { PREMIUM_SEED_USERS, expect }
