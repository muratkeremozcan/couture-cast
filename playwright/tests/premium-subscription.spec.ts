// Story 5.2 Task 9: the web Premium settings section and the planner-rail gate
// against a real API (5.2-E2E-010, 5.2-E2E-011).
//
// ARRANGEMENT RULE (Decision 9): `PremiumEntitlement` is worker-only by design, so
// entitlement state cannot be arranged through the public API. The entitled,
// expired and grace branches run as the seeded premium users and are strictly
// READ-ONLY on them, since those accounts are shared across parallel workers. The
// never-subscribed branch is a fresh public-API signup, and it is the only account
// allowed to drive a real checkout-session creation.
//
// CHECKOUT HAND-OFF WITHOUT LEAVING THE APP: the fake Stripe client's session URLs
// live on `checkout.stripe.test`, an RFC-2606 host that never resolves in DNS. The
// spec stubs that host with `page.route` BEFORE clicking subscribe, so the browser
// proves the app initiated the navigation without touching an unresolvable origin.
import type { Locator, Page } from '@playwright/test'
import { log } from '@seontechnologies/playwright-utils/log'
import type { InterceptNetworkCallFn } from '@seontechnologies/playwright-utils/intercept-network-call'
import { waitForAccessibilityReady } from '../support/helpers/accessibility'
import { isNonLocalEnvironment, resolveApiBaseUrl } from '../support/helpers/api-test'
import {
  CHECKOUT_SESSION_PATH,
  FAKE_CHECKOUT_ORIGIN,
  PREMIUM_SEED_USERS,
  SUBSCRIPTION_PATH,
  ensurePremiumSeedLocation,
  expect,
  premiumFreshTest,
  premiumSeededTest,
} from '../support/helpers/premium-session'
import { test as anonymousTest } from '../support/fixtures/merged-fixtures'

const SUBSCRIPTION_URL = `**${SUBSCRIPTION_PATH}`
// Story 5.5 Decision 7: the planner rail's entitlement gate is the planner GET
// itself (401/403/503); see `apps/web/src/lib/planner.ts`. The four `5.2-E2E-011`
// tests below watch this, matching `planner.spec.ts`'s constant.
const PLANNER_PATH = '/api/v1/commerce/premium/planner'
const PLANNER_URL = `**${PLANNER_PATH}`

/** The rail renders at every width but is only displayed ultrawide (>=1440). */
const ULTRAWIDE_VIEWPORT = { width: 1440, height: 900 }

type SubscriptionData = {
  status: string
  store: string | null
  productId: string | null
  purchasesEnabled: boolean
}

type SubscriptionExchange = {
  status: number
  responseJson: { data: SubscriptionData } | null
}

function watchSubscriptionRead(
  interceptNetworkCall: InterceptNetworkCallFn
): Promise<SubscriptionExchange> {
  return interceptNetworkCall({ method: 'GET', url: SUBSCRIPTION_URL }).then(
    (result) => ({
      status: result.status,
      responseJson: result.responseJson as { data: SubscriptionData } | null,
    })
  )
}

/**
 * Network-first: the status read is registered before the navigation that triggers
 * it, so the spec never races the page. It returns the exchange and asserts
 * nothing, so a failure names the claim that broke.
 */
async function openSettings(
  page: Page,
  interceptNetworkCall: InterceptNetworkCallFn
): Promise<SubscriptionExchange> {
  const load = watchSubscriptionRead(interceptNetworkCall)

  await page.goto('/settings')

  const exchange = await load
  await waitForAccessibilityReady(page)

  return exchange
}

/**
 * The lookbook home at the one viewport where the planner rail renders inline
 * (>=1440px, Decision 7's third-column form), with the "Plan week" control already
 * clicked open: the rail defaults closed, so a caller that only navigated here
 * would see nothing. The realtime poll is stubbed so the page settles without a
 * live events dependency. Register any network watch (e.g. on `PLANNER_URL`) before
 * calling this, since the open click happens inside it.
 */
async function openLookbookUltrawide(
  page: Page,
  interceptNetworkCall: InterceptNetworkCallFn
): Promise<void> {
  void interceptNetworkCall({
    url: '**/api/v1/events/poll*',
    fulfillResponse: { status: 200, body: { events: [], nextSince: null } },
  })
  await page.setViewportSize(ULTRAWIDE_VIEWPORT)
  await page.goto('/')
  await page.getByTestId('planner-open-control').click()
}

function subscribeButton(page: Page, plan: 'monthly' | 'annual'): Locator {
  return page.getByTestId(`premium-subscribe-${plan}`)
}

function plannerRail(page: Page): Locator {
  // The `aria-label` is identical in locked and unlocked states on purpose
  // (the a11y suite's landmark contract); the testids below tell them apart.
  return page.getByRole('complementary', { name: 'Planner Rail' })
}

premiumSeededTest.describe('Story 5.2 web settings, seeded active subscriber', () => {
  premiumSeededTest.use({ premiumSeedUser: 'active' })

  // Story 5.5: AC 1 needs an owned saved location to resolve a planner window
  // against, and nothing in the seed graph gives this account one. See
  // `ensurePremiumSeedLocation`'s own docblock.
  premiumSeededTest.beforeAll(async ({ request }, testInfo) => {
    if (isNonLocalEnvironment(testInfo)) return
    const apiBaseUrl = resolveApiBaseUrl(testInfo, { fallback: 'http://localhost:4000' })
    await ensurePremiumSeedLocation(request, apiBaseUrl, PREMIUM_SEED_USERS.active.id)
  })

  premiumSeededTest(
    '[P0] 5.2-E2E-WEB-01 shows the active status line and the portal manage entry',
    async ({ premiumSession: _premiumSession, page, interceptNetworkCall }) => {
      await log.step('Load settings and capture the subscription read')
      const loaded = await openSettings(page, interceptNetworkCall)

      expect(loaded.status).toBe(200)
      expect(loaded.responseJson?.data.status).toBe('active')
      expect(loaded.responseJson?.data.store).toBe('stripe')
      expect(loaded.responseJson?.data.productId).toBe('premium_monthly')
      // The kill switch is seeded ON locally; with it off no subscribe control
      // could ever render and half of this suite would be untestable.
      expect(loaded.responseJson?.data.purchasesEnabled).toBe(true)

      await log.step('Assert the section frame: title and processor disclosure')
      await expect(page.getByRole('heading', { name: 'Premium' })).toBeVisible()
      const disclosure = page.getByTestId('premium-disclosure')
      await expect(disclosure).toContainText('RevenueCat')
      await expect(disclosure).toContainText('Stripe')
      await expect(disclosure).toContainText('never reach CoutureCast')

      await log.step('Assert the per-status body: status line plus manage, no CTAs')
      await expect(page.getByTestId('premium-status-line')).toContainText(
        'Premium is active: Premium Monthly'
      )
      await expect(page.getByTestId('premium-manage-button')).toBeVisible()
      await expect(page.getByTestId('premium-manage-in-store')).toHaveCount(0)
      // Already entitled: rendering a subscribe control would sell a second
      // subscription the server answers with 409.
      await expect(subscribeButton(page, 'monthly')).toHaveCount(0)
      await expect(subscribeButton(page, 'annual')).toHaveCount(0)
      await expect(page.getByTestId('premium-grace-banner')).toHaveCount(0)
      await expect(page.getByTestId('premium-ended-note')).toHaveCount(0)
    }
  )

  premiumSeededTest(
    '[P0] 5.2-E2E-011 renders the unlocked planner shell for the entitled user',
    async ({ premiumSession: _premiumSession, page, interceptNetworkCall }) => {
      await log.step('Open the lookbook ultrawide and capture the planner read')
      const load = interceptNetworkCall({ method: 'GET', url: PLANNER_URL })
      await openLookbookUltrawide(page, interceptNetworkCall)

      const loaded = await load
      expect(loaded.status).toBe(200)

      await log.step('Assert the rail shows the live week, not the upsell')
      await expect(plannerRail(page)).toBeVisible()
      await expect(page.getByTestId('planner-rail-locked')).toHaveCount(0)
      await expect(page.getByTestId('planner-rail-get-premium')).toHaveCount(0)
      // Story 5.5: the live seven-day week is the "unlocked" proof, replacing the
      // Story 3.5 static shell text. `planner.spec.ts` owns the deep per-day
      // content assertions.
      await expect(page.getByTestId('planner-days')).toBeVisible()
    }
  )
})

premiumSeededTest.describe('Story 5.2 web settings, seeded expired subscriber', () => {
  premiumSeededTest.use({ premiumSeedUser: 'expired' })

  premiumSeededTest(
    '[P1] 5.2-E2E-WEB-02 offers re-subscription with the ended note',
    async ({ premiumSession: _premiumSession, page, interceptNetworkCall }) => {
      const loaded = await openSettings(page, interceptNetworkCall)

      expect(loaded.status).toBe(200)
      expect(loaded.responseJson?.data.status).toBe('expired')

      await log.step('Assert the ended state: status line, note, enabled CTAs')
      await expect(page.getByTestId('premium-status-line')).toHaveText(
        'Your Premium subscription has expired.'
      )
      await expect(page.getByTestId('premium-ended-note')).toContainText(
        'You can subscribe again at any time.'
      )
      await expect(subscribeButton(page, 'monthly')).toBeEnabled()
      await expect(subscribeButton(page, 'annual')).toBeEnabled()
      await expect(page.getByTestId('premium-manage-button')).toHaveCount(0)
      await expect(page.getByTestId('premium-manage-in-store')).toHaveCount(0)
    }
  )

  premiumSeededTest(
    '[P1] 5.2-E2E-011 keeps the planner rail locked for the expired user',
    // The 403 below is the subject of the test, so the network monitor is off.
    { annotation: [{ type: 'skipNetworkMonitoring' }] },
    async ({ premiumSession: _premiumSession, page, interceptNetworkCall }) => {
      // Expired means `PremiumEntitlementGuard` rejects the planner GET itself with
      // 403 (PREMIUM_REQUIRED_MESSAGE). No separate subscription-status payload
      // carries `status: 'expired'` any more.
      const load = interceptNetworkCall({ method: 'GET', url: PLANNER_URL })
      await openLookbookUltrawide(page, interceptNetworkCall)

      const loaded = await load
      expect(loaded.status).toBe(403)

      await expect(plannerRail(page)).toBeVisible()
      await expect(page.getByTestId('planner-rail-locked')).toBeVisible()
      await expect(page.getByTestId('planner-rail-get-premium')).toHaveAttribute(
        'href',
        '/settings'
      )
    }
  )
})

premiumSeededTest.describe(
  'Story 5.2 web settings, seeded grace-period subscriber',
  () => {
    premiumSeededTest.use({ premiumSeedUser: 'grace' })

    premiumSeededTest(
      '[P1] 5.2-E2E-WEB-03 shows the payment-issue banner and the store-managed hint',
      async ({ premiumSession: _premiumSession, page, interceptNetworkCall }) => {
        const loaded = await openSettings(page, interceptNetworkCall)

        expect(loaded.status).toBe(200)
        expect(loaded.responseJson?.data.status).toBe('grace_period')
        expect(loaded.responseJson?.data.store).toBe('app_store')

        await log.step('Assert grace keeps the entitled framing plus the banner')
        await expect(page.getByTestId('premium-status-line')).toHaveText(
          'Premium is active, but there is a payment issue.'
        )
        await expect(page.getByTestId('premium-grace-banner')).toContainText(
          'problem with your payment method'
        )

        await log.step('Assert the manage entry is the store hint, not the portal')
        // An `app_store` subscription answered with a portal button would send the
        // user to a 409, so the client renders the store hint.
        await expect(page.getByTestId('premium-manage-in-store')).toContainText(
          'App Store or Play Store'
        )
        await expect(page.getByTestId('premium-manage-button')).toHaveCount(0)
        // Grace still entitles, so no subscribe controls either.
        await expect(subscribeButton(page, 'monthly')).toHaveCount(0)
      }
    )
  }
)

premiumFreshTest.describe('Story 5.2 web settings, never-subscribed user', () => {
  premiumFreshTest(
    '[P0] 5.2-E2E-WEB-04 offers both plans to a fresh account when purchasing is on',
    async ({ premiumFreshSession: _premiumFreshSession, page, interceptNetworkCall }) => {
      const loaded = await openSettings(page, interceptNetworkCall)

      expect(loaded.status).toBe(200)
      // The wire contract for "never subscribed": status none with the entitlement
      // keys serialized as nulls, never omitted.
      expect(loaded.responseJson).toEqual({
        data: {
          status: 'none',
          store: null,
          productId: null,
          willRenew: null,
          currentPeriodEnd: null,
          syncedAt: null,
          purchasesEnabled: true,
        },
      })

      // A substring that omits the apostrophe: the `quotes` rule wants single
      // quotes and prettier wants double for an escaped one, and the two cannot
      // both be satisfied on this literal.
      await expect(page.getByTestId('premium-status-line')).toContainText(
        'have a Premium subscription yet'
      )
      await expect(subscribeButton(page, 'monthly')).toBeEnabled()
      await expect(subscribeButton(page, 'annual')).toBeEnabled()
      await expect(page.getByTestId('premium-manage-button')).toHaveCount(0)
      await expect(page.getByTestId('premium-signed-out-hint')).toHaveCount(0)
    }
  )

  premiumFreshTest(
    '[P0] 5.2-E2E-010 hands off to Stripe checkout without leaving the app',
    async ({ premiumFreshSession: _premiumFreshSession, page, interceptNetworkCall }) => {
      expect((await openSettings(page, interceptNetworkCall)).status).toBe(200)

      await log.step('Stub the unresolvable checkout host BEFORE anything navigates')
      await page.route(`${FAKE_CHECKOUT_ORIGIN}/**`, (route) =>
        route.fulfill({
          status: 200,
          contentType: 'text/html',
          body: '<!doctype html><html><body><h1 data-testid="stubbed-checkout">Stubbed Stripe Checkout</h1></body></html>',
        })
      )

      await log.step('Subscribe monthly and capture the session-creation exchange')
      const checkout = interceptNetworkCall({
        method: 'POST',
        url: `**${CHECKOUT_SESSION_PATH}`,
      })
      await subscribeButton(page, 'monthly').click()

      const exchange = await checkout
      expect(exchange.status).toBe(201)
      expect(exchange.requestJson).toEqual({ plan: 'premium_monthly' })

      await log.step('Assert the app initiated navigation to the session URL')
      // The landed URL is the assertion subject. `redirectToExternalUrl` calls
      // `window.location.assign` the moment the response resolves, so reading
      // `exchange.responseJson` races that navigation and returns null whenever the
      // browser wins, which flakes. The app can only navigate to the URL this
      // exchange returned, so asserting where it landed proves the same hand-off
      // deterministically, and the stub answering at all proves the browser never
      // touched an unresolvable `.test` host.
      await page.waitForURL(`${FAKE_CHECKOUT_ORIGIN}/**`)
      // The fake Stripe client's URL shape (Decision 9): https, RFC-2606 host.
      expect(page.url()).toMatch(/^https:\/\/checkout\.stripe\.test\//)
      await expect(page.getByTestId('stubbed-checkout')).toBeVisible()
    }
  )

  premiumFreshTest(
    '[P1] 5.2-E2E-011 keeps the planner rail locked for a never-subscribed user',
    // Same 403-is-the-subject reason as the expired test above.
    { annotation: [{ type: 'skipNetworkMonitoring' }] },
    async ({ premiumFreshSession: _premiumFreshSession, page, interceptNetworkCall }) => {
      // Never-subscribed draws the same 403 from `PremiumEntitlementGuard` as the
      // expired case above.
      const load = interceptNetworkCall({ method: 'GET', url: PLANNER_URL })
      await openLookbookUltrawide(page, interceptNetworkCall)

      const loaded = await load
      expect(loaded.status).toBe(403)

      await expect(plannerRail(page)).toBeVisible()
      const locked = page.getByTestId('planner-rail-locked')
      await expect(locked).toBeVisible()
      // Decision 2's no-dark-patterns guardrail: the locked state says plainly
      // what it is and links to settings, nothing more.
      await expect(locked).toContainText('The 7-Day Planner is a Premium feature')
      await expect(page.getByTestId('planner-rail-get-premium')).toHaveAttribute(
        'href',
        '/settings'
      )
    }
  )
})

anonymousTest.describe('Story 5.2 web settings and planner rail signed out', () => {
  anonymousTest(
    '[P1] 5.2-E2E-WEB-05 hints at signing in, disables the controls, and issues no request',
    async ({ page }) => {
      let subscriptionRequests = 0
      await page.route(SUBSCRIPTION_URL, async (route) => {
        subscriptionRequests += 1
        await route.fallback()
      })

      await page.goto('/settings')
      await waitForAccessibilityReady(page)

      await expect(page.getByRole('heading', { name: 'Premium' })).toBeVisible()
      await expect(page.getByTestId('premium-disclosure')).toBeVisible()
      await expect(page.getByTestId('premium-signed-out-hint')).toHaveText(
        'Sign in to subscribe or manage Premium'
      )
      // The controls render disabled with the hint, so the page communicates what
      // exists without offering an action that cannot succeed.
      await expect(subscribeButton(page, 'monthly')).toBeDisabled()
      await expect(subscribeButton(page, 'annual')).toBeDisabled()
      await expect(page.getByTestId('premium-manage-button')).toHaveCount(0)

      // No credential, no request: the unauthenticated a11y gate loads this
      // same route and must not depend on the network.
      expect(subscriptionRequests).toBe(0)
    }
  )

  anonymousTest(
    '[P0] 5.2-E2E-011 shows the locked upsell signed out without an entitlement read',
    async ({ page, interceptNetworkCall }) => {
      let plannerRequests = 0
      await page.route(PLANNER_URL, async (route) => {
        plannerRequests += 1
        await route.fallback()
      })

      await openLookbookUltrawide(page, interceptNetworkCall)

      await expect(plannerRail(page)).toBeVisible()
      await expect(page.getByTestId('planner-rail-locked')).toBeVisible()
      await expect(page.getByTestId('planner-rail-get-premium')).toHaveAttribute(
        'href',
        '/settings'
      )
      // Signed out means no session to spend on a read the gate cannot use: an
      // entitlement the client cannot verify is one it does not have, so the rail is
      // locked by construction. `PlannerRail` checks `hasWebSession()` before
      // calling `getPlannerFromWeb` (Decision 7), so this counts requests to the
      // planner endpoint specifically.
      expect(plannerRequests).toBe(0)
    }
  )
})
