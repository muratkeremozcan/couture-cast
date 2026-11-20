// Production follow-up after the project close (2026-11-19). Jade reported "Profile is missing"
// and "City search unavailable"; PostHog shows three failed web city searches from /settings in
// that window (outcome provider_unconfigured). Reproducing on production with a signed-in member,
// a reload of /settings (or opening it in a new tab) showed "Sign in to manage your locations"
// under Locations while the same page showed Premium access: a second way to lose Locations, found
// by the reproduction, not reported by Jade.
//
// The Locations section asked once, on mount, whether this tab holds the verified bearer. A real
// session writes that bearer only after the profile check, and a fresh tab or a reload starts
// without it, so the section settled on signed out and never looked again. The local lane never
// saw it: its fixture bearer is in session storage before the first render, and the session
// bridge skips verification for it. This spec signs in through the product email-code UI against
// real GoTrue (scripts/e2e-real-session/run.mjs) and opens /settings the ways a member does.
import type { Page, Request } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { createNetworkErrorMonitorFixture } from '@seontechnologies/playwright-utils/network-error-monitor/fixtures'
import { sentinelPlace } from '../../scripts/lib/weather-provider-double-data.mjs'
import { expect, test } from '../support/fixtures/merged-fixtures'
import {
  classifyGuardedErrors,
  guardExpectedError,
} from '../support/helpers/expected-error-guard'
import {
  createRealCommunityAuthAccount,
  readGeneratedCommunityCode,
  realCommunityEmail,
  realSessionSkipReason,
  signInRealCommunityWeb,
  signupRealCommunityAppUser,
  type RealCommunityAccount,
} from '../support/helpers/community-real-session'

const skipReason = realSessionSkipReason()
test.skip(Boolean(skipReason), skipReason ?? '')
test.use({ authSessionEnabled: false, trace: 'off', video: 'off', screenshot: 'off' })

const LOCATIONS_LIST = /\/api\/v1\/locations(\?|$)/

async function member(
  apiRequest: Parameters<typeof signupRealCommunityAppUser>[0]
): Promise<RealCommunityAccount> {
  const email = realCommunityEmail()
  const appUserId = await signupRealCommunityAppUser(apiRequest, email)
  return createRealCommunityAuthAccount({
    email,
    appUserId,
    mapping: 'email',
    label: 'settings-locations-member',
  })
}

async function signIn(page: Page, account: RealCommunityAccount) {
  await signInRealCommunityWeb(page, account, () =>
    Promise.resolve(readGeneratedCommunityCode(account))
  )
}

const PROFILE_CHECK = '**/api/v1/user/profile'

/**
 * Records every state the Locations section shows on this page from first paint, and whether the
 * signed-out hint was ever in the DOM, so a flash that is gone by the time the test looks still
 * counts. Installed once per page; it re-arms on every navigation.
 */
async function watchSectionStates(page: Page) {
  await page.addInitScript(() => {
    const seen: string[] = []
    const target = window as unknown as { __locationsStates: string[] }
    target.__locationsStates = seen
    const note = () => {
      const section = document.querySelector('[data-testid="locations-section"]')
      const state = section?.getAttribute('data-state')
      if (state && seen[seen.length - 1] !== state) seen.push(state)
      if (
        document.querySelector('[data-testid="locations-signed-out"]') &&
        !seen.includes('hint')
      )
        seen.push('hint')
    }
    new MutationObserver(note).observe(document, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['data-state'],
    })
  })
}

const sectionStates = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { __locationsStates: string[] }).__locationsStates
  )

/**
 * A completion boundary for a `couture:session` event: two animation frames and a task let React
 * commit what the event changed and run its effects (where a list request would start), then
 * every list request started so far has answered.
 */
async function settledAfterSessionEvent(page: Page, listRequests: Request[]) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 0)))
      )
  )
  await Promise.all(listRequests.map((request) => request.response()))
}

/**
 * Counts the `couture:session` publications the app itself makes on this document, from now on.
 * Arm it before releasing a held profile check, so the app's own announcement of the answer is
 * what the test waits for, not an event the test dispatches.
 */
async function observeSessionPublications(page: Page) {
  await page.evaluate(() => {
    const target = window as unknown as { __sessionPublications: number }
    target.__sessionPublications = 0
    window.addEventListener('couture:session', () => {
      target.__sessionPublications += 1
    })
  })
}

const sessionPublications = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { __sessionPublications: number }).__sessionPublications
  )

/** The bearer and verified principal a tab keeps in session storage (web-session.ts). */
const BEARER_KEY = 'couturecast.access-token'
const PRINCIPAL_KEY = 'couturecast.access-principal'

const storedBearer = (page: Page) =>
  page.evaluate((key) => window.sessionStorage.getItem(key), BEARER_KEY)

const storedKeys = (page: Page) =>
  page.evaluate(
    ([bearer, principal]) => [
      window.sessionStorage.getItem(bearer),
      window.sessionStorage.getItem(principal),
    ],
    [BEARER_KEY, PRINCIPAL_KEY] as const
  )

/**
 * Opens /settings while holding the session's profile check, and expects the member's Locations.
 * What shows while verification is pending depends on what the tab already holds:
 *
 * - `checking` (a new tab: no stored bearer): the section waits, with no Sign in hint and no list
 *   request, and turns ready once verification answers;
 * - `ready` (a reload of a tab that holds the verified bearer of the same user, Step 58
 *   follow-up): the tab restores that bearer at once, so the section is ready and its one list
 *   request goes out with the stored bearer while verification is still held.
 *
 * Either way: from first paint to the end it never showed signed out or the hint, and exactly one
 * list GET was sent for the load, counted from before navigation through the end of verification
 * and a same-owner `couture:session` event (a cancelled duplicate still counts).
 */
async function expectMemberLocations(
  page: Page,
  open: () => Promise<unknown>,
  whileVerifying: 'checking' | 'ready'
) {
  const listRequests: Request[] = []
  const recordList = (request: Request) => {
    if (
      LOCATIONS_LIST.test(new URL(request.url()).pathname) &&
      request.method() === 'GET'
    )
      listRequests.push(request)
  }
  const profileChecks: Request[] = []
  let release!: () => void
  const verificationHeld = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route(PROFILE_CHECK, async (route) => {
    profileChecks.push(route.request())
    await verificationHeld
    await route.continue()
  })
  page.on('request', recordList)
  try {
    // A new tab is still about:blank here and holds nothing; only a reload has a stored bearer.
    const bearerBefore = whileVerifying === 'ready' ? await storedBearer(page) : null
    await open()
    const section = page.getByTestId('locations-section')

    await expect.poll(() => profileChecks.length).toBeGreaterThan(0)
    await expect(section).toHaveAttribute('data-state', whileVerifying)
    await expect(section.getByTestId('locations-signed-out')).toHaveCount(0)
    if (whileVerifying === 'checking') {
      expect(listRequests).toHaveLength(0)
    } else {
      // The reload kept this tab's verified bearer: the list goes out with it, unverified yet.
      expect(bearerBefore, 'stored bearer before the reload').not.toBeNull()
      await expect.poll(() => listRequests.length).toBe(1)
      expect(listRequests[0]!.headers()['authorization']).toBe(`Bearer ${bearerBefore}`)
      expect((await listRequests[0]!.response())?.status()).toBe(200)
    }

    // The app's own announcement of the verified answer is what ends the wait.
    await observeSessionPublications(page)
    release()
    await expect(section).toHaveAttribute('data-state', 'ready')
    await expect(
      section.getByRole('combobox', { name: 'Search for a city' })
    ).toBeVisible()
    // Every profile check answered 200, and the app published the verified member.
    for (const check of profileChecks)
      expect((await check.response())?.status(), 'profile check').toBe(200)
    await expect.poll(() => sessionPublications(page)).toBeGreaterThan(0)
    // Whatever the app did with the answer has reached the screen and the network.
    await settledAfterSessionEvent(page, listRequests)
    expect(listRequests, 'list requests after the verified answer').toHaveLength(1)
    expect(await sectionStates(page)).not.toContain('signed_out')
    expect(await sectionStates(page)).not.toContain('hint')

    // The bridge announces the same member again (a token refresh does): no second list.
    await page.evaluate(() => window.dispatchEvent(new Event('couture:session')))
    await settledAfterSessionEvent(page, listRequests)
    expect(listRequests).toHaveLength(1)
    expect((await listRequests[0]!.response())?.status()).toBe(200)
    const states = await sectionStates(page)
    expect(states).not.toContain('signed_out')
    expect(states).not.toContain('hint')
    expect(states.at(-1)).toBe('ready')
    return section
  } finally {
    page.off('request', recordList)
    await page.unroute(PROFILE_CHECK)
  }
}

test('PL-1: a signed-in member who opens Settings in a new tab manages Locations, never Sign in', async ({
  page,
  apiRequest,
}) => {
  const account = await member(apiRequest)
  await signIn(page, account)

  // A new tab starts with empty session storage: the bearer exists only after verification.
  const tab = await page.context().newPage()
  await watchSectionStates(tab)
  const section = await expectMemberLocations(
    tab,
    () => tab.goto('/settings'),
    'checking'
  )
  await expect(section.getByTestId('locations-empty')).toBeVisible()
})

test('PL-2: a member saves a city from Settings after a reload, and it is still there after another', async ({
  page,
  apiRequest,
}) => {
  const account = await member(apiRequest)
  await signIn(page, account)
  await watchSectionStates(page)
  await page.goto('/settings')
  await expect(page.getByTestId('locations-section')).toHaveAttribute(
    'data-state',
    'ready'
  )

  // Jade's path: reload Settings while signed in, then search for a city and save it.
  const section = await expectMemberLocations(page, () => page.reload(), 'ready')
  const nonce = randomUUID()
  const place = sentinelPlace(nonce)
  const search = section.getByRole('combobox', { name: 'Search for a city' })
  await search.fill(`Sentinel ${nonce}`)
  await expect(section.getByRole('option')).toHaveCount(1)
  await expect(section.getByRole('option')).toContainText(place.name)
  await search.press('ArrowDown')
  await search.press('Enter')
  const label = section.getByLabel('Name this place')
  await expect(label).toBeFocused()
  await label.fill('Home')
  await label.press('Enter')
  await expect(section.getByTestId('location-item')).toHaveCount(1)
  await expect(section.getByTestId('location-item-label')).toHaveText('Home')
  await expect(section.getByTestId('location-primary-badge')).toBeVisible()

  const reloaded = await expectMemberLocations(page, () => page.reload(), 'ready')
  await expect(reloaded.getByTestId('location-item')).toHaveCount(1)
  await expect(reloaded.getByTestId('location-item-label')).toHaveText('Home')
  await expect(reloaded.getByTestId('location-item-place')).toContainText(place.name)
})

/**
 * For PL-2b, whose held profile checks answer 401 by design. The network-error monitor takes URL
 * patterns only, so it stands aside for the profile URL alone; a companion guard covers that URL
 * for the whole test on every page and method. It requires a GET 401 Unauthorized for every
 * profile check the page sent (the test records how many; a reload sends several, one per
 * consumer of the session) and no other error there. Every other URL stays under the monitor.
 */
const PROFILE_URL = /\/api\/v1\/user\/profile(\?|$)/
const deniedTest = test
  .extend(createNetworkErrorMonitorFixture({ excludePatterns: [PROFILE_URL] }))
  .extend<{ profileDenials: { sent: number }; profileDenialGuard: void }>({
    profileDenials: async ({}, use) => {
      await use({ sent: 0 })
    },
    profileDenialGuard: [
      async ({ context, profileDenials }, use, testInfo) => {
        const guard = guardExpectedError(context, PROFILE_URL)
        await use()
        if (testInfo.status === 'skipped') return
        const outcome = classifyGuardedErrors(await guard.settle(), {
          method: 'GET',
          status: 401,
          code: 'Unauthorized',
        })
        expect(profileDenials.sent, 'profile checks the page sent').toBeGreaterThan(0)
        expect(outcome, 'errors on the profile URL').toEqual({
          allowedCount: profileDenials.sent,
          unexpected: [],
        })
      },
      { auto: true },
    ],
  })

deniedTest(
  'PL-2b: when verification of a reloaded tab is denied, Locations ends signed out and the stored bearer is gone',
  async ({ page, apiRequest, profileDenials }) => {
    const account = await member(apiRequest)
    await signIn(page, account)
    await watchSectionStates(page)
    await page.goto('/settings')
    const section = page.getByTestId('locations-section')
    await expect(section).toHaveAttribute('data-state', 'ready')
    const bearerBefore = await storedBearer(page)
    expect(bearerBefore, 'stored bearer before the reload').not.toBeNull()

    // The reload keeps the verified bearer while the profile check is held; the API then
    // refuses the identity (401), as it does for an account that no longer exists.
    const profileChecks: Request[] = []
    let deny!: () => void
    const denied = new Promise<void>((resolve) => {
      deny = resolve
    })
    await page.route(PROFILE_CHECK, async (route) => {
      profileChecks.push(route.request())
      await denied
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ statusCode: 401, message: 'Unauthorized' }),
      })
    })
    const listRequests: Request[] = []
    page.on('request', (request) => {
      if (
        LOCATIONS_LIST.test(new URL(request.url()).pathname) &&
        request.method() === 'GET'
      )
        listRequests.push(request)
    })

    await page.reload()
    await expect.poll(() => profileChecks.length).toBeGreaterThan(0)
    await expect(section).toHaveAttribute('data-state', 'ready')
    await expect.poll(() => listRequests.length).toBe(1)
    expect(listRequests[0]!.headers()['authorization']).toBe(`Bearer ${bearerBefore}`)
    // Before the denial the tab still holds both the bearer and the verified principal.
    expect(
      await storedKeys(page),
      'stored bearer and principal before the denial'
    ).toEqual([bearerBefore, expect.any(String)])

    await observeSessionPublications(page)
    deny()
    // The app's own announcement of the denial, then the screen and the storage it left.
    await expect.poll(() => sessionPublications(page)).toBeGreaterThan(0)
    await expect(section).toHaveAttribute('data-state', 'signed_out')
    await expect(section.getByTestId('locations-signed-out')).toBeVisible()
    for (const check of profileChecks) {
      const response = await check.response()
      expect(response?.status(), 'profile check').toBe(401)
      expect(await response?.json()).toMatchObject({ message: 'Unauthorized' })
    }
    await settledAfterSessionEvent(page, listRequests)
    profileDenials.sent = profileChecks.length
    expect(
      await storedKeys(page),
      'stored bearer and principal after the denial'
    ).toEqual([null, null])
    // Nothing listed again after the denial.
    expect(listRequests).toHaveLength(1)
    await page.unroute(PROFILE_CHECK)
  }
)

test(
  'PL-3: when the session check fails, a signed-in member sees a retry, never Sign in, and one retry lists once',
  { annotation: [{ type: 'skipNetworkMonitoring' }] },
  async ({ page, apiRequest }) => {
    const account = await member(apiRequest)
    await signIn(page, account)

    // A new tab whose profile check answers 503 until the outage ends.
    const tab = await page.context().newPage()
    await watchSectionStates(tab)
    let outage = true
    await tab.route(PROFILE_CHECK, (route) =>
      outage
        ? route.fulfill({
            status: 503,
            contentType: 'application/json',
            body: JSON.stringify({
              statusCode: 503,
              message: 'Service Unavailable',
              error: 'Service Unavailable',
            }),
          })
        : route.continue()
    )
    const listRequests: Request[] = []
    tab.on('request', (request) => {
      if (
        LOCATIONS_LIST.test(new URL(request.url()).pathname) &&
        request.method() === 'GET'
      )
        listRequests.push(request)
    })

    await tab.goto('/settings')
    const section = tab.getByTestId('locations-section')
    await expect(section).toHaveAttribute('data-state', 'load_failed')
    await expect(section.getByTestId('locations-load-error')).toHaveText(
      'Unable to load your locations.'
    )
    const retry = section.getByTestId('locations-load-retry')
    await expect(retry).toHaveText('Try again')
    expect(listRequests).toHaveLength(0)

    outage = false
    await retry.click()
    await expect(section).toHaveAttribute('data-state', 'ready')
    await expect(
      section.getByRole('combobox', { name: 'Search for a city' })
    ).toBeVisible()
    await settledAfterSessionEvent(tab, listRequests)
    expect(listRequests).toHaveLength(1)
    expect((await listRequests[0]!.response())?.status()).toBe(200)
    const states = await sectionStates(tab)
    expect(states).not.toContain('signed_out')
    expect(states).not.toContain('hint')
    await tab.unroute(PROFILE_CHECK)
  }
)
