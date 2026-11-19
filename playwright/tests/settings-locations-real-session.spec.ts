// Production follow-up after the project close (2026-11-19). Jade signed in on the production web
// app, opened /settings and saw "Sign in to manage your locations" under Locations while the same
// page showed her Premium access, so she could neither find nor set a location ("Profile is
// missing", "City search unavailable"). PostHog showed her searches failing from /settings.
//
// The Locations section asked once, on mount, whether this tab holds the verified bearer. A real
// session writes that bearer only after the profile check, and a fresh tab or a reload starts
// without it, so the section settled on signed out and never looked again. The local lane never
// saw it: its fixture bearer is in session storage before the first render, and the session
// bridge skips verification for it. This spec signs in through the product email-code UI against
// real GoTrue (scripts/e2e-real-session/run.mjs) and opens /settings the ways a member does.
import type { Page, Request } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { sentinelPlace } from '../../scripts/lib/weather-provider-double-data.mjs'
import { expect, test } from '../support/fixtures/merged-fixtures'
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
 * Opens /settings while holding the session's profile check, and expects the member's Locations:
 *
 * - while verification is pending the section is `checking`: no Sign in hint, no list request;
 * - once it answers, the section is ready with the city search on screen;
 * - from first paint to the end it never showed signed out or the hint;
 * - exactly one list GET was sent for the load, counted from before navigation through the end of
 *   verification and a same-owner `couture:session` event (a cancelled duplicate still counts).
 */
async function expectMemberLocations(page: Page, open: () => Promise<unknown>) {
  const listRequests: Request[] = []
  const recordList = (request: Request) => {
    if (
      LOCATIONS_LIST.test(new URL(request.url()).pathname) &&
      request.method() === 'GET'
    )
      listRequests.push(request)
  }
  const profileChecks: Promise<unknown>[] = []
  let release!: () => void
  const verificationHeld = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route(PROFILE_CHECK, async (route) => {
    const answered = verificationHeld.then(() => route.continue())
    profileChecks.push(answered)
    await answered
  })
  page.on('request', recordList)
  try {
    await open()
    const section = page.getByTestId('locations-section')

    await expect.poll(() => profileChecks.length).toBeGreaterThan(0)
    await expect(section).toHaveAttribute('data-state', 'checking')
    await expect(section.getByTestId('locations-signed-out')).toHaveCount(0)
    expect(listRequests).toHaveLength(0)

    release()
    await expect(section).toHaveAttribute('data-state', 'ready')
    await expect(
      section.getByRole('combobox', { name: 'Search for a city' })
    ).toBeVisible()
    await Promise.all(profileChecks)

    // The bridge announces the same member again (a token refresh does): no second list.
    await page.evaluate(() => window.dispatchEvent(new Event('couture:session')))
    await page.waitForLoadState('networkidle')
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
  const section = await expectMemberLocations(tab, () => tab.goto('/settings'))
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
  const section = await expectMemberLocations(page, () => page.reload())
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

  const reloaded = await expectMemberLocations(page, () => page.reload())
  await expect(reloaded.getByTestId('location-item')).toHaveCount(1)
  await expect(reloaded.getByTestId('location-item-label')).toHaveText('Home')
  await expect(reloaded.getByTestId('location-item-place')).toContainText(place.name)
})

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
    await tab.waitForLoadState('networkidle')
    expect(listRequests).toHaveLength(1)
    expect((await listRequests[0]!.response())?.status()).toBe(200)
    const states = await sectionStates(tab)
    expect(states).not.toContain('signed_out')
    expect(states).not.toContain('hint')
    await tab.unroute(PROFILE_CHECK)
  }
)
