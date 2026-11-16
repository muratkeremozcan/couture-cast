// Owner report 2026-11-16, iPhone Safari on couture-cast-web: Google sign-in succeeded
// (PostHog: /auth/callback, then / as a member, then /wardrobe and /settings) but the landing
// still offered Start signup, Try a sample wardrobe and Sign in, so the teen tapped Sign in and
// ran Google again: a sign-in loop from the person's side. The landing now reads the session
// before first paint. Runs in the owned real-session lane, in Chromium and in WebKit with the
// iPhone 15 descriptor (real-session.config.ts), against real GoTrue, the Google stand-in and
// the isolated database. TEA test design for fix/web-signed-in-landing, cases L-1 to L-8.
import { randomUUID } from 'node:crypto'
import type { Page, Request } from '@playwright/test'
import { expect, test } from '../support/fixtures/merged-fixtures'
import {
  createRealCommunityAuthAccount,
  readGeneratedCommunityCode,
  realCommunityEmail,
  realSessionSkipReason,
  recordStandInIdentity,
  signupRealCommunityAppUser,
  type RealCommunityAccount,
} from '../support/helpers/community-real-session'
import { armGoogleStandIn } from '../support/helpers/google-stand-in'
import {
  GUEST_LANDING_ACTIONS,
  landingActionsSeen,
  recordLandingActions,
} from '../support/helpers/landing-cta-observer'

const skipReason = realSessionSkipReason()
test.skip(Boolean(skipReason), skipReason ?? '')
test.use({ authSessionEnabled: false, trace: 'off', video: 'off', screenshot: 'off' })

// A Google identity without an account answers 401 on the profile check (L-8).
const EXPECTED_AUTH_ERRORS = { annotation: [{ type: 'skipNetworkMonitoring' }] }

const WEB = 'http://127.0.0.1:3077'
const SESSION_KEY = 'couturecast.auth-session'

/** Requests that would start a sign-in: Supabase's authorize endpoint or Google itself. */
const isAuthorize = (request: Request) =>
  request.url().includes('/auth/v1/authorize') ||
  request.url().includes('accounts.google.com')
const isRefresh = (request: Request) =>
  request.url().includes('/auth/v1/token') &&
  request.url().includes('grant_type=refresh_token')

async function member(apiRequest: Parameters<typeof signupRealCommunityAppUser>[0]) {
  const email = realCommunityEmail()
  const appUserId = await signupRealCommunityAppUser(apiRequest, email)
  return createRealCommunityAuthAccount({
    email,
    appUserId,
    mapping: 'email',
    label: 'landing-member',
  })
}

/** The product email-code sign-in, ending wherever the app sends a member. */
async function signInWithCode(page: Page, account: RealCommunityAccount) {
  await page.goto('/signin')
  await page.locator('input[name="email"]').fill(account.email)
  await page.locator('button[type="submit"]').click()
  await page.locator('input[name="code"]').waitFor({ state: 'visible' })
  await page.locator('input[name="code"]').fill(readGeneratedCommunityCode(account))
  await page.locator('button[type="submit"]').click()
  await expect(page).toHaveURL(`${WEB}/`)
}

async function expectMemberLanding(page: Page) {
  await expect(page.getByTestId('landing-open-wardrobe')).toBeVisible()
  await expect(page.getByTestId('landing-sign-out')).toBeVisible()
  for (const selector of GUEST_LANDING_ACTIONS)
    await expect(page.locator(selector)).toBeHidden()
}

async function expectGuestLanding(page: Page) {
  for (const selector of GUEST_LANDING_ACTIONS)
    await expect(page.locator(selector)).toBeVisible()
  await expect(page.getByTestId('landing-open-wardrobe')).toBeHidden()
  await expect(page.getByTestId('landing-sign-out')).toBeHidden()
}

test('L-1: a member who signs in with Google lands on the member landing, never on a signed-out action', async ({
  page,
  apiRequest,
}) => {
  const account = await member(apiRequest)
  await armGoogleStandIn(page, {
    sub: `stand-in-${randomUUID()}`,
    email: account.email,
    email_verified: true,
    name: 'Landing Member',
  })
  await page.goto('/signin')
  await recordLandingActions(page)
  await page.getByTestId('google-sign-in').click()
  await expect(page).toHaveURL(`${WEB}/`)
  await expectMemberLanding(page)
  expect(await landingActionsSeen(page)).toEqual({
    guest: [],
    member: ['[data-testid="landing-open-wardrobe"]', '[data-testid="landing-sign-out"]'],
  })

  // A reload and a new tab are the same member: still no signed-out action from first paint.
  await page.reload()
  await expectMemberLanding(page)
  expect((await landingActionsSeen(page)).guest).toEqual([])
  const tab = await page.context().newPage()
  await tab.goto('/')
  await expectMemberLanding(tab)
  expect((await landingActionsSeen(tab)).guest).toEqual([])

  // The member action goes where it says.
  await page.getByTestId('landing-open-wardrobe').click()
  await expect(page).toHaveURL(`${WEB}/wardrobe`)
})

test('L-2: a signed-out visitor sees exactly Start signup, Try a sample wardrobe and Sign in', async ({
  page,
}) => {
  await recordLandingActions(page)
  await page.goto('/')
  await expectGuestLanding(page)
  await expect(page.getByTestId('landing-sign-in')).toHaveText(/sign in/i)
  const seen = await landingActionsSeen(page)
  expect(seen.member).toEqual([])
  expect(seen.guest).toEqual([...GUEST_LANDING_ACTIONS])
})

test('L-3: an expired access token with a valid refresh token still opens on the member landing', async ({
  page,
  apiRequest,
}) => {
  const account = await member(apiRequest)
  await signInWithCode(page, account)
  await expectMemberLanding(page)
  await page.evaluate((key) => {
    const session = JSON.parse(window.localStorage.getItem(key)!) as {
      expires_at: number
    }
    session.expires_at = Math.floor(Date.now() / 1000) - 60
    window.localStorage.setItem(key, JSON.stringify(session))
  }, SESSION_KEY)

  const refreshes: string[] = []
  page.on('request', (request) => {
    if (isRefresh(request)) refreshes.push(request.url())
  })
  await recordLandingActions(page)
  await page.reload()
  await expectMemberLanding(page)
  await expect.poll(() => refreshes.length).toBe(1)
  expect((await landingActionsSeen(page)).guest).toEqual([])
})

test('L-4: after Sign out, going back to the landing shows the signed-out actions', async ({
  page,
  apiRequest,
}) => {
  const account = await member(apiRequest)
  await signInWithCode(page, account)
  await page.goto('/wardrobe')
  await page.goto('/')
  await expectMemberLanding(page)

  await page.getByTestId('landing-sign-out').click()
  await expectGuestLanding(page)
  expect(
    await page.evaluate((key) => window.localStorage.getItem(key), SESSION_KEY)
  ).toBe(null)
  // Back through history, Safari's back-forward cache included: the page restored from before
  // the sign-out must not show the member landing.
  await page.goBack()
  await page.goForward()
  await expect(page).toHaveURL(`${WEB}/`)
  await expectGuestLanding(page)
})

test('L-5: signing out in another tab turns this landing signed out', async ({
  page,
  apiRequest,
}) => {
  const account = await member(apiRequest)
  await signInWithCode(page, account)
  await expectMemberLanding(page)

  const other = await page.context().newPage()
  await other.goto('/')
  await expectMemberLanding(other)
  await other.getByTestId('landing-sign-out').click()
  await expectGuestLanding(other)

  // Without a reload: the storage change reaches the first tab.
  await page.bringToFront()
  await expectGuestLanding(page)
  // And with one.
  await page.reload()
  await expectGuestLanding(page)
})

test(
  'L-6: a Google identity without an account goes to the finish step, never the member landing',
  EXPECTED_AUTH_ERRORS,
  async ({ page }) => {
    const email = realCommunityEmail()
    recordStandInIdentity(email, 'landing-no-account')
    await armGoogleStandIn(page, {
      sub: `stand-in-${randomUUID()}`,
      email,
      email_verified: true,
      name: 'No Account',
    })
    await page.goto('/signin')
    await page.getByTestId('google-sign-in').click()
    await expect(page).toHaveURL(`${WEB}/signup/finish`)

    await recordLandingActions(page)
    await page.goto('/')
    await expect(page).toHaveURL(`${WEB}/signup/finish`)
    expect((await landingActionsSeen(page)).member).toEqual([])
  }
)

test('L-7: a member opening /signin or /signup is sent on without starting a sign-in', async ({
  page,
  apiRequest,
}) => {
  const account = await member(apiRequest)
  await signInWithCode(page, account)
  const authorizes: string[] = []
  page.on('request', (request) => {
    if (isAuthorize(request)) authorizes.push(request.url())
  })

  for (const door of ['/signin', '/signup']) {
    await page.goto(door)
    await expect(page).toHaveURL(`${WEB}/`)
    await expectMemberLanding(page)
  }
  await page.goto('/signin?next=/wardrobe')
  await expect(page).toHaveURL(`${WEB}/wardrobe`)
  expect(authorizes).toEqual([])
})

test('L-8: a member is never sent off-site by next', async ({ page, apiRequest }) => {
  const account = await member(apiRequest)
  await signInWithCode(page, account)
  for (const next of [
    'https://evil.example/',
    '//evil.example/',
    '/\\evil.example/',
    'javascript:alert(1)',
  ]) {
    await page.goto(`/signin?next=${encodeURIComponent(next)}`)
    await expect(page).toHaveURL(`${WEB}/`)
  }
})
