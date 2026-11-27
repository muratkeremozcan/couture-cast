// Learning path Step 58: Production follow-ups after the project close.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#production-follow-ups-after-the-project-close
// Production follow-up (2026-11-19), found by the owner on production 8b0fed06 right after the
// Locations fix: a direct load of /settings while signed in showed "Sign in to change this" under
// Shopping and partners, "Sign in to subscribe or manage Premium" under Premium, and "Sign in and
// subscribe to Premium" under Interface palettes, while Locations on the same page was signed in.
//
// The three sections asked once, on mount, whether this tab held the verified bearer (the
// check settings-locations-real-session.spec.ts already pins for Locations). A real session writes
// that bearer only after the profile check, and a new tab starts without it, so each section
// settled on signed out and never looked again. A reload now restores the verified member and the
// bearer from the tab's session storage (lib/web-session.ts restoreVerifiedPrincipal), so its
// sections read once while verification still runs; PS-1 pins the empty new tab, PS-2 the restored
// reload. This spec signs in through the product
// email-code UI against real GoTrue (scripts/e2e-real-session/run.mjs) and opens the
// About and privacy and Premium destinations the ways a member does. The member has no Premium, so each section's signed-in state is the one a
// signed-in non-subscriber sees: the opt-out toggle, the subscribe controls, and the locked
// palette gallery that points at those controls.
import type { Page, Request } from '@playwright/test'
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

/** The member-owned read each section makes once it knows the member. */
const READS = {
  preferences: '/api/v1/commerce/preferences',
  subscription: '/api/v1/commerce/subscription',
  theme: '/api/v1/commerce/premium/theme',
} as const
type ReadName = keyof typeof READS

const DESTINATIONS = [
  {
    name: 'About and privacy',
    path: '/settings/about',
    reads: ['preferences'],
    sections: ['commerce-preferences-section'],
  },
  {
    name: 'Premium',
    path: '/settings/premium',
    reads: ['subscription', 'theme'],
    sections: ['premium-subscription-section', 'premium-theme-section'],
  },
] as const
type Destination = (typeof DESTINATIONS)[number]

/** The signed-out wording of each section, as the owner saw it on production. */
const SIGN_IN_HINTS = {
  commerce: 'Sign in to change this',
  premium: 'Sign in to subscribe or manage Premium',
  palettes: 'Sign in and subscribe to Premium',
} as const

const PROFILE_CHECK = '**/api/v1/user/profile'
const BEARER_KEY = 'couturecast.access-token'

async function member(
  apiRequest: Parameters<typeof signupRealCommunityAppUser>[0]
): Promise<RealCommunityAccount> {
  const email = realCommunityEmail()
  const appUserId = await signupRealCommunityAppUser(apiRequest, email)
  return createRealCommunityAuthAccount({
    email,
    appUserId,
    mapping: 'email',
    label: 'settings-sections-member',
  })
}

async function signIn(page: Page, account: RealCommunityAccount) {
  await signInRealCommunityWeb(page, account, () =>
    Promise.resolve(readGeneratedCommunityCode(account))
  )
}

/**
 * Records, from first paint and across every render, which sign-in hints were ever in the DOM, so
 * a hint that flashes and is gone by the time the test looks still counts. Re-arms on navigation.
 */
async function watchSignInHints(page: Page) {
  await page.addInitScript((hints: Record<string, string>) => {
    const seen: string[] = []
    const target = window as unknown as { __signInHints: string[] }
    target.__signInHints = seen
    const note = () => {
      const text = document.body?.textContent ?? ''
      for (const [section, hint] of Object.entries(hints))
        if (text.includes(hint) && !seen.includes(section)) seen.push(section)
    }
    new MutationObserver(note).observe(document, {
      subtree: true,
      childList: true,
      characterData: true,
    })
    // Story CC-7.7 (Codex review of the PS-1 change): a section's signed-out first paint draws
    // its hint from `data-guest-text` through CSS, so the words never enter the text the
    // observer reads. Every frame, from before the first paint on, a guest stand-in that
    // actually shows (a box, not display:none or hidden) on a page painted for a stored session
    // counts as a seen hint. The hidden prerender stand-ins pass.
    const frame = () => {
      const session = document.documentElement?.getAttribute('data-session')
      if (session === 'member' || session === 'pending') {
        for (const node of Array.from(document.querySelectorAll('[data-guest-text]'))) {
          const box = node.getBoundingClientRect()
          const shows = node.checkVisibility({ visibilityProperty: true })
          const label = `guest-text:${node.getAttribute('data-guest-text') ?? ''}`
          if (shows && box.width > 0 && box.height > 0 && !seen.includes(label))
            seen.push(label)
        }
      }
      requestAnimationFrame(frame)
    }
    requestAnimationFrame(frame)
  }, SIGN_IN_HINTS)
}

const signInHintsSeen = (page: Page) =>
  page.evaluate(() => (window as unknown as { __signInHints: string[] }).__signInHints)

/**
 * A completion boundary for a `couture:session` event: two animation frames and a task let React
 * commit what the event changed and run its effects (where a read would start), then every read
 * started so far has answered.
 */
async function settledAfterSessionEvent(page: Page, reads: Request[]) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 0)))
      )
  )
  await Promise.all(reads.map((request) => request.response()))
}

/**
 * Opens one settings destination while holding the session profile check, and expects its sections to
 * reach the member's signed-in state. From first paint to the end no sign-in hint is ever on
 * the page, and each read goes out exactly once, counted from before navigation through the end
 * of verification and a same-owner `couture:session` event (a cancelled duplicate still counts).
 *
 * What the page knows while verification is pending depends on the tab:
 *
 * - a new tab has nothing stored, so none of the sections sends its read until verification
 *   answers (`restored: false`);
 * - a reload restores the verified member and the bearer from the tab's own session storage
 *   (`restoreVerifiedPrincipal` in lib/web-session.ts, as Locations does), so each section
 *   reads once, with that stored bearer, while verification still runs, and shows the member's
 *   state before it answers (`restored: true`).
 *
 * Once verification answers, Shopping and partners shows the opt-out toggle, Premium the
 * subscribe controls, and Interface palettes the gallery locked behind those controls.
 */
async function expectSignedInSettings(
  page: Page,
  open: () => Promise<unknown>,
  destination: Destination,
  { restored }: { restored: boolean }
) {
  const expectedReads: readonly ReadName[] = destination.reads
  const reads: Record<ReadName, Request[]> = {
    preferences: [],
    subscription: [],
    theme: [],
  }
  const all: Request[] = []
  const record = (request: Request) => {
    if (request.method() !== 'GET') return
    const pathname = new URL(request.url()).pathname
    for (const [name, path] of Object.entries(READS) as [ReadName, string][])
      if (pathname === path) {
        reads[name].push(request)
        all.push(request)
      }
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
  page.on('request', record)
  try {
    // A reload keeps the tab's bearer; read it now, before the page goes away.
    const storedBearer = restored
      ? await page.evaluate((key) => window.sessionStorage.getItem(key), BEARER_KEY)
      : null
    if (restored) expect(storedBearer).toBeTruthy()
    await open()
    const sections = destination.sections.map((id) => page.getByTestId(id))

    await expect.poll(() => profileChecks.length).toBeGreaterThan(0)
    if (restored) {
      for (const section of sections) await expect(section).toBeVisible()
    }
    // Verification is pending: nobody is signed out yet.
    expect(await signInHintsSeen(page)).toEqual([])
    if (restored) {
      // The tab holds the member and the bearer already: every section reads once with it.
      await expect.poll(() => all.length).toBe(expectedReads.length)
      for (const name of expectedReads) {
        expect(reads[name], `${name} reads while verifying`).toHaveLength(1)
        expect(await reads[name][0]!.headerValue('authorization')).toBe(
          `Bearer ${storedBearer}`
        )
      }
    } else {
      // Nothing is stored: nothing member-owned is asked.
      expect(all).toHaveLength(0)
    }

    release()
    for (const section of sections) await expect(section).toBeVisible()
    if (destination.path === '/settings/about') {
      await expect(page.getByTestId('commerce-opt-out-toggle')).toBeVisible()
    } else {
      await expect(page.getByTestId('premium-subscribe-monthly')).toBeVisible()
      await expect(page.getByTestId('premium-subscribe-annual')).toBeVisible()
      await expect(page.getByTestId('premium-theme-locked')).toBeVisible()
    }
    await Promise.all(profileChecks.map((request) => request.response()))

    // The bridge announces the same member again (a token refresh does): no second read.
    await page.evaluate(() => window.dispatchEvent(new Event('couture:session')))
    await settledAfterSessionEvent(page, all)
    for (const name of expectedReads) {
      expect(reads[name], `${name} reads`).toHaveLength(1)
      expect((await reads[name][0]!.response())?.status(), `${name} status`).toBe(200)
    }
    expect(await signInHintsSeen(page)).toEqual([])
    expect(all, 'only reads owned by this destination').toHaveLength(expectedReads.length)
    await expect(page.getByTestId('commerce-signed-out-hint')).toHaveCount(0)
    await expect(page.getByTestId('premium-signed-out-hint')).toHaveCount(0)
  } finally {
    page.off('request', record)
    await page.unroute(PROFILE_CHECK)
  }
}

for (const destination of DESTINATIONS) {
  test(`PS-1: a new tab opens ${destination.name} with the verified session and no sign-in flash`, async ({
    page,
    apiRequest,
  }) => {
    const account = await member(apiRequest)
    await signIn(page, account)

    const tab = await page.context().newPage()
    await watchSignInHints(tab)
    await expectSignedInSettings(tab, () => tab.goto(destination.path), destination, {
      restored: false,
    })
  })

  test(`PS-2: reloading ${destination.name} restores the known bearer without a sign-in flash`, async ({
    page,
    apiRequest,
  }) => {
    const account = await member(apiRequest)
    await signIn(page, account)
    await watchSignInHints(page)
    await page.goto(destination.path)
    await expect(page.getByTestId(destination.sections[0])).toBeVisible()

    await expectSignedInSettings(page, () => page.reload(), destination, {
      restored: true,
    })
  })
}
