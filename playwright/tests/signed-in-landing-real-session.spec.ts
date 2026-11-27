// Owner report 2026-11-16, iPhone Safari on couture-cast-web: Google sign-in succeeded
// (PostHog: /auth/callback, then / as a member, then /wardrobe and /settings) but the landing
// still offered Start signup, Try a sample wardrobe and Sign in, so the teen tapped Sign in and
// ran Google again: a sign-in loop from the person's side. The landing now reads the session
// before first paint. Runs in the owned real-session lane, in Chromium and in WebKit with the
// iPhone 15 descriptor (real-session.config.ts), against real GoTrue, the Google stand-in and
// the isolated database. TEA test design for fix/web-signed-in-landing, cases L-1 to L-11, H-1 to H-7 and the sign-off findings F1, F2 and F6.
import { randomUUID } from 'node:crypto'
import type { Page, Request } from '@playwright/test'
import { expect, test } from '../support/fixtures/merged-fixtures'
import {
  createRealCommunityAuthAccount,
  readGeneratedCommunityCode,
  realCommunityEmail,
  realSessionSkipReason,
  recordStandInIdentity,
  revokeRealSessions,
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

// A Google identity without an account answers 401 on the profile check (L-6), and a revoked
// refresh token answers 400 (L-8): those answers are what the cases assert on.
const EXPECTED_AUTH_ERRORS = { annotation: [{ type: 'skipNetworkMonitoring' }] }

const WEB = 'http://127.0.0.1:3077'
const SESSION_KEY = 'couturecast.auth-session'

/** Requests that would start a sign-in: Supabase's authorize endpoint or Google itself. */
const isAuthorize = (request: Request) =>
  request.url().includes('/auth/v1/authorize') ||
  request.url().includes('accounts.google.com')
const isRefreshUrl = (url: URL) =>
  url.pathname.endsWith('/auth/v1/token') &&
  url.searchParams.get('grant_type') === 'refresh_token'
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
  await expect(page.getByTestId('member-sample-outfit')).toBeVisible()
  await expect(page.getByTestId('home-set-city')).toBeVisible()
  for (const selector of GUEST_LANDING_ACTIONS)
    await expect(page.locator(selector)).toBeHidden()
  await expect(page.getByRole('link', { name: 'Sign in', exact: true })).toHaveCount(0)
  await expect(
    page.getByRole('link', { name: 'Create account', exact: true })
  ).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toHaveCount(0)
}

async function expectPendingLanding(page: Page) {
  await expect(page.locator('html')).toHaveAttribute('data-session', 'pending')
  await expect(page.getByTestId('screen-placeholder')).toBeVisible()
  for (const name of ['Sign in', 'Create account', 'Try a sample look'])
    await expect(page.getByRole('link', { name, exact: true })).toHaveCount(0)
  await expect(page.getByTestId('home-set-city')).toBeHidden()
}

/** The stored session and this tab's verified bearer, as they stand now. */
const tabSession = (page: Page) =>
  page.evaluate((key) => {
    return {
      stored: window.localStorage.getItem(key),
      bearer: window.sessionStorage.getItem('couturecast.access-token'),
    }
  }, SESSION_KEY)

/**
 * On the next load, before any page script runs, writes `snapshot` back with its expiry an
 * hour gone: a tab left open while its session expired. Writing it from the live page instead
 * lets the page's own session code act on it first (in WebKit it cleared the session before the
 * reload), so the reload would start from a different state.
 */
async function restoreExpiredOnNextLoad(
  page: Page,
  snapshot: { stored: string | null; bearer: string | null }
) {
  await page.addInitScript(
    ({ key, snapshot }) => {
      if (window.sessionStorage.getItem('landing-test-expired') !== null) return
      window.sessionStorage.setItem('landing-test-expired', '1')
      if (snapshot.stored === null) return
      const session = JSON.parse(snapshot.stored) as { expires_at: number }
      session.expires_at = Math.floor(Date.now() / 1000) - 3600
      window.localStorage.setItem(key, JSON.stringify(session))
      if (snapshot.bearer !== null)
        window.sessionStorage.setItem('couturecast.access-token', snapshot.bearer)
    },
    { key: SESSION_KEY, snapshot }
  )
}

/** The stored session, as the SDK wrote it. */
const storedSession = (page: Page) =>
  page.evaluate(
    (key) =>
      JSON.parse(window.localStorage.getItem(key) ?? 'null') as {
        access_token: string
        refresh_token: string
        expires_at: number
      } | null,
    SESSION_KEY
  )

/**
 * Page errors, and console messages about hydration, React or a content policy (TEA H-3, H-6).
 * `strict` also keeps every other console error (TEA H-2). WebKit logs a fetch that a navigation
 * cancels as an access-control error, so only the strict cases, which never navigate with
 * requests in flight, keep those.
 */
function collectPageErrors(page: Page, options: { strict: boolean }) {
  const errors: string[] = []
  page.on('console', (message) => {
    const text = message.text()
    if (
      /hydrat|Minified React error|Content Security Policy|Refused to execute/i.test(text)
    )
      errors.push(text)
    // Next.js reports a route prefetch that a navigation cancelled and then serves the page
    // itself; nothing failed.
    else if (
      /^Failed to fetch RSC payload .* Falling back to browser navigation/.test(text)
    )
      return
    else if (options.strict && message.type() === 'error') errors.push(text)
  })
  page.on('pageerror', (error) => {
    // WebKit reports a request that a reload or navigation cancelled as a page error naming
    // access control; nothing failed. The strict cases keep it.
    if (options.strict || !/due to access control checks\.$/.test(error.message))
      errors.push(error.message)
  })
  return errors
}

async function expectGuestLanding(page: Page) {
  for (const selector of GUEST_LANDING_ACTIONS)
    await expect(page.locator(selector)).toBeVisible()
  await expect(page.getByTestId('home-set-city')).toBeHidden()
  await expect(page.getByTestId('profile-sign-out')).toBeHidden()
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
  expect(await landingActionsSeen(page)).toMatchObject({
    guest: [],
    member: ['[data-testid="home-set-city"]'],
  })

  // A reload and a new tab are the same member: still no signed-out action from first paint.
  await page.reload()
  await expectMemberLanding(page)
  expect((await landingActionsSeen(page)).guest).toEqual([])
  const tab = await page.context().newPage()
  await recordLandingActions(tab)
  await tab.goto('/')
  await expectMemberLanding(tab)
  expect((await landingActionsSeen(tab)).guest).toEqual([])

  // TEA H-5: the head script writes only the state word; no token reaches the document.
  const session = await storedSession(page)
  const html = await page.content()
  expect(html).not.toContain(session!.access_token)
  expect(html).not.toContain(session!.refresh_token)

  await page.getByTestId('home-set-city').click()
  await expect(page).toHaveURL(`${WEB}/settings?addLocation=1&returnTo=%2F#locations`)
})

test('L-2: a signed-out visitor sees Create account, Try a sample look and Sign in', async ({
  page,
}) => {
  await recordLandingActions(page)
  await page.goto('/')
  await expectGuestLanding(page)
  await expect(
    page.getByRole('link', { name: 'Create account', exact: true })
  ).toBeVisible()
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
  await restoreExpiredOnNextLoad(page, await tabSession(page))

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

/**
 * CC-7.9 TEA diagnostic for L-4 and L-4b (webkit L-4 on CI fd692390: the signed-out actions
 * stayed hidden after Sign out). An init script records every change of <html data-session> and
 * every couture:session event, each with its time and whether the stored session and this tab's
 * bearer are present. Booleans only: no token or session value is read out. On failure the trace,
 * the final state and the same two booleans go on the report. The assertions are unchanged.
 */
async function traceLandingSession(page: Page) {
  await page.addInitScript(
    ([sessionKey, bearerKey]) => {
      type Entry = {
        at: number
        what: string
        value: string | null
        stored: boolean
        bearer: boolean
      }
      const trace: Entry[] = []
      ;(window as unknown as { __teaSessionTrace: Entry[] }).__teaSessionTrace = trace
      const record = (what: string, value: string | null) => {
        let stored = false
        let bearer = false
        try {
          stored = window.localStorage.getItem(sessionKey) !== null
          bearer = window.sessionStorage.getItem(bearerKey) !== null
        } catch {
          // Storage refused: both stay false.
        }
        trace.push({ at: Math.round(performance.now()), what, value, stored, bearer })
      }
      new MutationObserver((mutations) => {
        for (const mutation of mutations)
          if (mutation.target === document.documentElement)
            record('data-session', document.documentElement.getAttribute('data-session'))
      }).observe(document, {
        attributes: true,
        subtree: true,
        attributeFilter: ['data-session'],
      })
      window.addEventListener('couture:session', () => record('couture:session', null))
      // The Sign out press itself, captured before React sees it (CI 5f2043f2: the button was
      // enabled and the page stayed the member page, so whether the press arrived matters).
      document.addEventListener(
        'click',
        (event) => {
          const button = (event.target as Element | null)?.closest?.(
            '[data-testid="profile-sign-out"]'
          )
          if (button)
            record(
              'sign-out-click',
              (button as HTMLButtonElement).disabled ? 'disabled' : 'enabled'
            )
        },
        true
      )
      window.addEventListener('pageshow', (event) =>
        record('pageshow', event.persisted ? 'persisted' : 'fresh')
      )
    },
    [SESSION_KEY, 'couturecast.access-token'] as const
  )
}

/** Runs `check`; on failure attaches the session trace and the final state, then fails. */
async function withLandingSessionTrace(page: Page, check: () => Promise<void>) {
  try {
    await check()
  } catch (error) {
    const state = await page
      .evaluate(
        ([sessionKey, bearerKey]) => ({
          url: window.location.pathname,
          dataSession: document.documentElement.getAttribute('data-session'),
          storedSession: window.localStorage.getItem(sessionKey) !== null,
          bearer: window.sessionStorage.getItem(bearerKey) !== null,
          trace:
            (window as unknown as { __teaSessionTrace?: { what: string; at: number }[] })
              .__teaSessionTrace ?? [],
        }),
        [SESSION_KEY, 'couturecast.access-token'] as const
      )
      .catch((readError: unknown) => ({ unreadable: String(readError) }))
    // The real-session harness keeps no attachments, so the same evidence goes to the job log as
    // one line (booleans and state words only, no token or session value).
    const trace = 'trace' in state ? state.trace : []
    const click = trace.findIndex((entry) => entry.what === 'sign-out-click')
    const summary = {
      ...state,
      clickAt: click === -1 ? null : trace[click]!.at,
      sessionEventAfterClick:
        click !== -1 &&
        trace.slice(click + 1).some((entry) => entry.what === 'couture:session'),
    }
    console.log(`[landing-session-trace] ${JSON.stringify(summary)}`)
    await test.info().attach('landing-session-trace.json', {
      body: JSON.stringify(summary, null, 2),
      contentType: 'application/json',
    })
    throw error
  }
}

test('L-4: after Sign out, going back to the landing shows the signed-out actions', async ({
  page,
  apiRequest,
}) => {
  await traceLandingSession(page)
  const account = await member(apiRequest)
  await signInWithCode(page, account)
  await page.goto('/wardrobe')
  await page.goto('/')
  await expectMemberLanding(page)

  await withLandingSessionTrace(page, async () => {
    await page.goto('/settings')
    await page.getByTestId('profile-sign-out').click()
    await page.goto('/')
    await expectGuestLanding(page)
    // The landing turns over at the sign-out event; the stored session goes once the SDK finishes.
    await expect
      .poll(() => page.evaluate((key) => window.localStorage.getItem(key), SESSION_KEY))
      .toBeNull()
    // Back through history, Safari's back-forward cache included: the page restored from before
    // the sign-out must not show the member landing.
    await page.goBack()
    await page.goForward()
    await expect(page).toHaveURL(`${WEB}/`)
    await expectGuestLanding(page)
  })
})

// CC-7.9 TEA (burn-in, webkit, CI 40ee2f90): a Sign out before this page's session start settles
// left the landing on neither set. The sign-out event came while the stored session was still
// there and the start unsettled, so the landing read pending, and nothing read it again once the
// SDK cleared the stored session. Holding the profile check keeps the start unsettled; the
// landing must turn signed out well before that check's own 5 s timeout would settle it.
test('L-4b: Sign out while the session check is still out shows the signed-out actions', async ({
  page,
  apiRequest,
}) => {
  await traceLandingSession(page)
  const account = await member(apiRequest)
  await signInWithCode(page, account)
  await page.goto('/wardrobe')
  let releaseProfile: () => void = () => undefined
  const held = new Promise<void>((resolve) => {
    releaseProfile = resolve
  })
  let profileHeld = false
  await page.route('**/api/v1/user/profile', async (route) => {
    profileHeld = true
    await held
    await route.continue().catch(() => undefined)
  })
  await page.goto('/settings')
  await expect.poll(() => profileHeld).toBe(true)

  await withLandingSessionTrace(page, async () => {
    await page.getByTestId('profile-sign-out').click()
    await expect(page.locator('html')).toHaveAttribute('data-session', 'none', {
      timeout: 2_000,
    })
    await page.goto('/')
    await expectGuestLanding(page)
  })
  releaseProfile()
  await page.unroute('**/api/v1/user/profile')
})

// The first tab's community feed may still send one request with the token the other tab just
// signed out; the API answers 401, as it should.
test(
  'L-5: signing out in another tab turns this landing signed out',
  EXPECTED_AUTH_ERRORS,
  async ({ page, apiRequest }) => {
    const account = await member(apiRequest)
    await signInWithCode(page, account)
    await expectMemberLanding(page)

    const other = await page.context().newPage()
    await other.goto('/settings')
    await other.getByTestId('profile-sign-out').click()
    await other.goto('/')
    await expectGuestLanding(other)

    // Without a reload: the storage change reaches the first tab.
    await page.bringToFront()
    await expectGuestLanding(page)
    // And with one.
    await page.reload()
    await expectGuestLanding(page)
  }
)

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

// A member may open the doors on purpose: signing in as someone else is how a shared family
// device switches accounts (Story 6.5 N1, Story 6.17 D1). Opening one starts nothing by itself.
test('L-7: a member can still open /signin and /signup, and nothing starts a sign-in on its own', async ({
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
    await expect(page.getByTestId('google-sign-in')).toBeVisible()
    await expect(page).toHaveURL(`${WEB}${door}`)
  }
  expect(authorizes).toEqual([])
})

// TEA H-1: a stored session the server revoked. Its access token expired, so the head script
// cannot call it a member; the refresh fails and the page settles signed out. Both orders of the
// refresh answer against the first paint: at once, and held back while the page is on screen.
for (const order of ['answered at once', 'answered after first paint'] as const)
  test(
    `L-8: a revoked, expired session never paints the member landing (refresh ${order})`,
    EXPECTED_AUTH_ERRORS,
    async ({ page, apiRequest }) => {
      const account = await member(apiRequest)
      await signInWithCode(page, account)
      const snapshot = await tabSession(page)
      const session = await storedSession(page)
      await revokeRealSessions(session!.access_token)
      await restoreExpiredOnNextLoad(page, snapshot)

      let release: () => void = () => undefined
      const held = new Promise<void>((resolve) => (release = resolve))
      if (order === 'answered after first paint')
        await page.route(isRefreshUrl, async (route) => {
          await held
          await route.continue()
        })
      await recordLandingActions(page)
      await page.reload()
      if (order === 'answered after first paint') {
        await expectPendingLanding(page)
        release()
      }
      await expectGuestLanding(page)
      const seen = await landingActionsSeen(page)
      expect(seen.member).toEqual([])
      // The head script never called it a member; it waited, then settled signed out.
      expect(seen.states).not.toContain('member')
      expect(seen.states.at(-1)).toBe('none')
    }
  )

// Each variant starts in a fresh page so its RSC prefetches can finish independently.
for (const [state, stored] of [
  ['malformed JSON', '{"access_token":'],
  ['invalid token', JSON.stringify({ access_token: 'eyJ.x', refresh_token: 'r' })],
] as const) {
  test(`L-9: ${state} gives the signed-out landing without an error`, async ({
    page,
  }) => {
    const errors = collectPageErrors(page, { strict: true })
    await page.goto('/privacy')
    // CC-7.9 D6: /privacy now carries the top bar, whose Back link to / starts an RSC prefetch.
    // The strict case must leave with nothing in flight (WebKit reports a cancelled fetch as an
    // access-control error, CI 3d7af2a2), so the page settles before the next navigation.
    await page.waitForLoadState('networkidle')
    await page.evaluate(
      ([key, value]) => {
        window.localStorage.setItem(key, value)
        window.sessionStorage.setItem('couturecast.access-token', 'eyJ.x')
      },
      [SESSION_KEY, stored] as const
    )
    await recordLandingActions(page)
    await page.goto('/')
    await expect(page.locator('html')).toHaveAttribute('data-session', 'none')
    await expectGuestLanding(page)
    expect((await landingActionsSeen(page)).member).toEqual([])
    expect(errors).toEqual([])
  })
}

test('L-9b: a browser that refuses storage reads gives the signed-out landing', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => {
      throw new DOMException('The operation is insecure.', 'SecurityError')
    }
  })
  await page.goto('/')
  await expect(page.locator('html')).toHaveAttribute('data-session', 'none')
  await expectGuestLanding(page)
})

// TEA H-3, H-6: the server HTML holds both sets and CSS picks one, so a member, a pending session
// and a visitor all hydrate without a mismatch, and the inline head script runs under the
// production server's headers with no policy report.
test('L-10: the landing hydrates cleanly for a member, a pending session and a visitor', async ({
  page,
  apiRequest,
}) => {
  const errors = collectPageErrors(page, { strict: false })
  const landing = await page.request.get('/')
  const policy = landing.headers()['content-security-policy'] ?? ''
  // Should a policy ever arrive, it must allow the inline head scripts (TEA H-6). The states the
  // page reaches below come from the head script and SessionBridge alike, so this case proves the
  // hydration and policy errors are absent, not that the head script ran; L-1, L-3 and L-8 cover
  // the head script (they fail without it).
  expect(
    policy === '' || /script-src[^;]*('sha256-|'nonce-|'unsafe-inline')/.test(policy)
  ).toBe(true)

  await page.goto('/')
  await expect(page.locator('html')).toHaveAttribute('data-session', 'none')
  await expectGuestLanding(page)

  const account = await member(apiRequest)
  await signInWithCode(page, account)
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-session', 'member')
  await expectMemberLanding(page)

  // A new tab has the stored session but no verified bearer yet: pending until the profile check.
  const tab = await page.context().newPage()
  const tabErrors = collectPageErrors(tab, { strict: false })
  let release: () => void = () => undefined
  const held = new Promise<void>((resolve) => (release = resolve))
  await tab.route('**/api/v1/user/profile', async (route) => {
    await held
    await route.continue()
  })
  await tab.goto('/')
  await expectPendingLanding(tab)
  // Today holds the shell in place while its account-specific content is pending.
  const header = tab.getByTestId('app-header')
  await tab.evaluate(() => document.fonts.ready.then(() => undefined))
  const pendingHeader = await header.boundingBox()
  expect(pendingHeader).not.toBeNull()
  release()
  await expectMemberLanding(tab)
  expect(await header.boundingBox()).toEqual(pendingHeader)

  expect([...errors, ...tabErrors]).toEqual([])
})

// TEA F1: a member who returns to an open tab after the access token expired must not see
// Sign in while the SDK refreshes. The expiry is written in place, the refresh is held, and the
// tab is focused again, as a person switching back to it does.
test('L-11: a member returning to a tab after the token expired never sees Sign in', async ({
  page,
  apiRequest,
}) => {
  const account = await member(apiRequest)
  await recordLandingActions(page)
  await signInWithCode(page, account)
  await expectMemberLanding(page)

  let release: () => void = () => undefined
  const held = new Promise<void>((resolve) => (release = resolve))
  await page.route(isRefreshUrl, async (route) => {
    await held
    await route.continue()
  })
  // From here on: emptied in place, because the recorder keeps writing to the same lists.
  await page.evaluate(() => {
    const seen = window.__landingActionsSeen!
    seen.guest.length = 0
    seen.member.length = 0
    seen.states.length = 0
  })
  await page.evaluate((key) => {
    const session = JSON.parse(window.localStorage.getItem(key)!) as {
      expires_at: number
    }
    session.expires_at = Math.floor(Date.now() / 1000) - 60
    window.localStorage.setItem(key, JSON.stringify(session))
    window.dispatchEvent(new Event('focus'))
    // Bubbles to window, where the auth SDK listens for a tab becoming visible again.
    document.dispatchEvent(new Event('visibilitychange', { bubbles: true }))
  }, SESSION_KEY)
  await expect(page.locator('html')).toHaveAttribute('data-session', 'pending')
  await expect(page.getByRole('link', { name: 'Sign in', exact: true })).toHaveCount(0)

  release()
  await expectMemberLanding(page)
  const seen = await landingActionsSeen(page)
  expect(seen.guest).toEqual([])
  expect(seen.states).not.toContain('none')
})
