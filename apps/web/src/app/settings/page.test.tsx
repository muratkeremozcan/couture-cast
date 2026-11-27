// Learning path Step 33: Affiliate "Shop this look" CTA.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-33-affiliate-shop-this-look-cta
// Learning path Step 35: Premium theme switcher.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-35-premium-theme-switcher
// Learning path Step 45: Client location capture.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-45-client-location-capture
// Learning path Step 58: Production follow-ups after the project close.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#production-follow-ups-after-the-project-close
// Learning path Step 65: Signed-in shell without flashes.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-65-signed-in-shell-without-flashes
// Learning path Step 68: Five-tab navigation and back pattern.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-68-five-tab-navigation-and-back-pattern
// Story CC-7.11 test owner (TEA): 7.11-CMP-PROFILE-STYLE-01 and 02 (D7: one Style row below the
// account header), 7.11-CMP-PROFILE-NOTIF-01 (Codex 7.11 #9: the Notifications row).
// Test design: _bmad-output/test-artifacts/test-design-7-11-five-tab-navigation-back-pattern.md
// Story 5.1 Task 7 owner: Web settings page and commerce opt-out section.
// Story CC-7.7 (Codex review of 8327b4fb): 7.7-CMP-010 pins the prerendered Locations chrome
// (P2-3) and 7.7-CMP-011 the Profile return from its snapshot (P1-2). CodeRabbit round 1 on PR
// 292: 7.7-CMP-033 a theme save outranks a return's refresh (#12), 7.7-CMP-034 a preference save
// outranks it (#13), 7.7-CMP-035 the snapshot keeps the confirmed preference (#27). CI real-session
// on 61d7156e: 7.7-CMP-036 the gate never waits on the account read (PS-2), 7.7-CMP-037 no Sign
// in hint is ever in a member's document (PS-1, PL-1 to PL-3). CodeRabbit round 2 on PR 292:
// 7.7-CMP-046 a preference read overlapping a save never lands (#4), 7.7-CMP-047 a theme read
// overlapping a save never lands and never leaves the gallery loading (#8, r3), 7.7-CMP-048 the account header keeps its footprint after a failed read (#9).
//
// These go through MSW rather than a mocked `lib/commerce`, so the request
// shape, the bearer header, and the contract parsing are all exercised by the
// same tests that cover the UI states.
import axe from 'axe-core'
import { http, HttpResponse } from 'msw'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { activateBrowserLocale, getI18n } from '../../i18n'
import deDE from '../../i18n/locales/de-DE.json'
import { WEB_ACCESS_TOKEN_STORAGE_KEY } from '../../lib/wardrobe'
import { screenSnapshot } from '../../lib/screen-snapshot'
import { currentWebSessionScope } from '../../lib/use-web-session'
import { useMswHandlers } from '../../test-utils/msw/runtime'
import { settle } from '../../test-utils/request-barrier'
import SettingsPage from './page'
import AccountPage from './account/page'
import AboutPage from './about/page'
import PlacesPage from './places/page'
import PremiumPage from './premium/page'

const navigation = vi.hoisted(() => ({ prerendering: false }))

vi.mock('next/navigation', async () => {
  const { use } = await import('react')
  const unanswered = new Promise<never>(() => undefined)
  return {
    usePathname: () => '/settings',
    useRouter: () => ({ push: vi.fn() }),
    useSearchParams: () => {
      // A statically rendered page bails out of search params during prerender: the reader
      // suspends until the client renders it.
      if (navigation.prerendering) use(unanswered)
      return new URLSearchParams()
    },
  }
})
vi.mock('posthog-js', () => ({
  default: { capture: vi.fn() },
}))

const PREFERENCES_PATH = '/api/v1/commerce/preferences'
const SUBSCRIPTION_PATH = '/api/v1/commerce/subscription'
const THEME_PATH = '/api/v1/commerce/premium/theme'

/**
 * Story 5.2 mounts `SubscriptionSection` on this page, so every signed-in
 * render also reads the subscription status. The default here is the
 * never-subscribed body; section-specific states live in
 * `subscription-section.test.tsx`.
 */
function subscriptionHandler() {
  return http.get(SUBSCRIPTION_PATH, () =>
    HttpResponse.json({
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
  )
}

/**
 * Story 5.3 mounts `PremiumThemeSection` on this page, so every signed-in render also
 * reads the resolved theme. `vitest.setup.ts` throws on any unhandled `/api/` request,
 * which is why this sits beside `subscriptionHandler()` in every signed-in case rather
 * than only in the tests that look at palettes. The default is a non-entitled reader
 * (the locked panel); section-specific states live in `premium-theme-section.test.tsx`.
 */
function themeHandler() {
  return http.get(THEME_PATH, () =>
    HttpResponse.json({
      data: { theme: null, isEntitled: false, themesEnabled: true },
    })
  )
}

/**
 * Story 1.2b mounts `LocationsSection` first on this page, so every signed-in
 * render also lists saved locations. Its own states live in
 * `components/locations/locations-section.test.tsx`.
 */
function locationsHandler() {
  return http.get('/api/v1/locations', () => HttpResponse.json({ data: [] }))
}

function profileSummaryHandlers() {
  return [
    locationsHandler(),
    http.get('/api/v1/wardrobe/onboarding', () =>
      HttpResponse.json({
        data: {
          status: 'not_started',
          currentStep: 'permission',
          usedStarterWardrobe: false,
          garmentsCapturedCount: 0,
          startedAt: null,
          completedAt: null,
          revision: 0,
        },
      })
    ),
    http.get('/api/v1/commerce/premium/access', () =>
      HttpResponse.json({ data: { premium: false, source: 'none' } })
    ),
    http.get('/api/v1/community/notification-preferences', () =>
      HttpResponse.json({
        data: {
          enabled: true,
          pushEnabled: true,
          quietHoursEnabled: false,
          quietHoursStart: '22:00',
          quietHoursEnd: '07:00',
          timezone: 'America/Chicago',
          revision: 'fixture',
        },
      })
    ),
  ]
}

const PROFILE_PATH = '/api/v1/user/profile'

/**
 * Since 2026-11-19 the page is the Profile and names the signed-in account
 * above its sections, so every signed-in render also reads the profile.
 */
function profileHandler(
  user: { displayName: string | null; email: string } = {
    displayName: 'Jade Rivers',
    email: 'jade@example.test',
  },
  onRequest?: (request: Request) => void
) {
  return http.get(PROFILE_PATH, ({ request }) => {
    onRequest?.(request)
    return HttpResponse.json({
      user: { id: 'member-1', birthdate: null, role: 'guardian', ...user },
      linkedGuardians: [],
      linkedTeens: [],
    })
  })
}

function signIn() {
  // Only the e2e fixture bearer counts without a verified member.
  vi.stubEnv('NEXT_PUBLIC_E2E_AUTH', 'true')
  window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, 'test-token-member')
}

/** A promise the test resolves by hand, so a pending request needs no timer. */
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

function preferenceHandlers(options: {
  initial?: boolean
  onPut?: (body: unknown, request: Request) => void
  putGate?: Promise<void>
  putStatus?: number
  getStatus?: number
}) {
  const initial = options.initial ?? true
  return [
    subscriptionHandler(),
    themeHandler(),
    locationsHandler(),
    profileHandler(),
    http.get(PREFERENCES_PATH, () => {
      if (options.getStatus) {
        return HttpResponse.json(
          {
            statusCode: options.getStatus,
            message: 'Unable to reach shopping preferences.',
            error: 'Internal Server Error',
          },
          { status: options.getStatus }
        )
      }
      return HttpResponse.json({ data: { affiliateCtasEnabled: initial } })
    }),
    http.put(PREFERENCES_PATH, async ({ request }) => {
      const body: unknown = await request.clone().json()
      options.onPut?.(body, request)
      if (options.putGate) {
        await options.putGate
      }
      if (options.putStatus) {
        return HttpResponse.json(
          {
            statusCode: options.putStatus,
            message: 'Unable to store shopping preferences right now.',
            error: 'Internal Server Error',
          },
          { status: options.putStatus }
        )
      }
      const parsed = body as { affiliateCtasEnabled: boolean }
      return HttpResponse.json({
        data: { affiliateCtasEnabled: parsed.affiliateCtasEnabled },
      })
    }),
  ]
}

function toggle() {
  return screen.getByTestId('commerce-opt-out-toggle')
}

/**
 * A jsdom axe pass over the rendered tree.
 *
 * This does not replace `playwright/tests/accessibility-hardening.spec.ts`:
 * jsdom has no layout, so axe cannot evaluate `color-contrast` or target size
 * here. It does catch the failures this section is most likely to introduce
 * (an unlabelled control, a broken `aria-describedby`, content outside a
 * landmark) on every unit run instead of only in a browser run.
 */
async function expectNoAxeViolations(container: HTMLElement) {
  const results = await axe.run(container, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
    // Turned off rather than left to report "incomplete": jsdom paints nothing,
    // so this rule can only probe a canvas it does not implement. The browser
    // suite is where contrast is actually judged.
    rules: { 'color-contrast': { enabled: false } },
  })
  expect(
    results.violations,
    `Accessibility violations found:\n${JSON.stringify(results.violations, null, 2)}`
  ).toEqual([])
}

describe('Web settings page', () => {
  beforeEach(() => {
    window.sessionStorage.clear()
  })

  afterEach(async () => {
    vi.unstubAllEnvs()
    window.sessionStorage.clear()
    // Story CC-7.7: Profile's snapshot lives in module memory; each test starts without one.
    screenSnapshot.clear()
    await getI18n().changeLanguage('en-US')
  })

  /**
   * `playwright/tests/accessibility-hardening.spec.ts` asserts this contract on
   * the real route. Pinning it here too means a redesign of this page fails in
   * the unit suite in seconds rather than in a browser run.
   */
  it('5.1-WEB-SETTINGS-01 keeps the skip-link landmark contract and the bottom nav', () => {
    render(<SettingsPage />)

    const landmarks = document.querySelectorAll('main#main-content')
    expect(landmarks).toHaveLength(1)
    expect(landmarks[0]).toHaveAttribute('tabindex', '-1')
    // Story CC-7.9 D3, D7: the page surface replaced the always-dark page and its
    // `data-focus-surface="dark"` switch; the focus ring tokens follow the scheme instead.
    expect(landmarks[0]?.closest('[data-surface="page"]')).not.toBeNull()
    expect(document.querySelector('[data-focus-surface]')).toBeNull()
    expect(screen.getByTestId('sticky-bottom-nav')).toBeInTheDocument()
  })

  it('5.1-WEB-SETTINGS-02 renders the disclosure above the toggle, signed out, with no request', async () => {
    const seen = vi.fn()
    useMswHandlers(
      http.get(PREFERENCES_PATH, () => {
        seen()
        return HttpResponse.json({ data: { affiliateCtasEnabled: true } })
      })
    )

    render(<AboutPage />)

    expect(
      screen.getByRole('heading', { name: 'Shopping and partners' })
    ).toBeInTheDocument()
    const disclosure = await screen.findByTestId('commerce-disclosure')
    expect(disclosure).toHaveTextContent('CoutureCast may earn a commission.')
    expect(disclosure).toHaveTextContent('No wardrobe photos or personal details')

    const hint = await screen.findByTestId('commerce-signed-out-hint')
    expect(hint).toHaveTextContent('Sign in to change this')
    expect(toggle()).toBeDisabled()
    expect(toggle()).toHaveAccessibleDescription(/Sign in to change this/)

    // Reading order: the disclosure precedes the control it describes.
    expect(
      disclosure.compareDocumentPosition(toggle()) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(seen).not.toHaveBeenCalled()
  })

  it('5.1-WEB-SETTINGS-03 loads the stored preference with a bearer token', async () => {
    signIn()
    const authorization = vi.fn<(value: string | null) => void>()
    useMswHandlers(
      subscriptionHandler(),
      themeHandler(),
      locationsHandler(),
      http.get(PREFERENCES_PATH, ({ request }) => {
        authorization(request.headers.get('authorization'))
        return HttpResponse.json({ data: { affiliateCtasEnabled: true } })
      })
    )

    render(<AboutPage />)

    await waitFor(() => expect(toggle()).toBeEnabled())
    expect(toggle()).toBeChecked()
    expect(authorization).toHaveBeenCalledWith('Bearer test-token-member')
    expect(screen.queryByTestId('commerce-signed-out-hint')).not.toBeInTheDocument()
  })

  it('5.1-WEB-SETTINGS-04 reflects an opted-out account as unchecked', async () => {
    signIn()
    useMswHandlers(...preferenceHandlers({ initial: false }))

    render(<AboutPage />)

    await waitFor(() => expect(toggle()).toBeEnabled())
    expect(toggle()).not.toBeChecked()
  })

  it('5.1-WEB-SETTINGS-05 turns the opt-out off optimistically and confirms on success', async () => {
    signIn()
    const gate = deferred<void>()
    const bodies: unknown[] = []
    useMswHandlers(
      ...preferenceHandlers({
        initial: true,
        putGate: gate.promise,
        onPut: (body) => bodies.push(body),
      })
    )

    render(<AboutPage />)
    await waitFor(() => expect(toggle()).toBeEnabled())

    fireEvent.click(toggle())

    // Optimistic: the new value shows before the request has answered.
    expect(toggle()).not.toBeChecked()
    // Busy, not disabled. Disabling mid-save drops the element out of the focus
    // order and the browser moves focus to `<body>`, which loses a keyboard
    // user's place in the page. The end-to-end keyboard journey caught that, so
    // this pins the shape of the fix.
    expect(toggle()).toBeEnabled()
    expect(toggle()).toHaveAttribute('aria-busy', 'true')

    // Re-entrancy is still refused: a second activation while the first is in
    // flight must not produce a second request.
    fireEvent.click(toggle())
    expect(toggle()).not.toBeChecked()

    gate.resolve()

    await waitFor(() =>
      expect(screen.getByTestId('commerce-status-region')).toHaveTextContent(
        'Shopping preferences updated'
      )
    )
    expect(toggle()).not.toBeChecked()
    expect(toggle()).toBeEnabled()
    expect(bodies).toEqual([{ affiliateCtasEnabled: false }])
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('5.1-WEB-SETTINGS-06 turns the opt-out back on and sends the true value', async () => {
    signIn()
    const bodies: unknown[] = []
    useMswHandlers(
      ...preferenceHandlers({ initial: false, onPut: (body) => bodies.push(body) })
    )

    render(<AboutPage />)
    await waitFor(() => expect(toggle()).toBeEnabled())

    fireEvent.click(toggle())

    await waitFor(() =>
      expect(screen.getByTestId('commerce-status-region')).toHaveTextContent(
        'Shopping preferences updated'
      )
    )
    expect(toggle()).toBeChecked()
    expect(bodies).toEqual([{ affiliateCtasEnabled: true }])
  })

  it('5.1-WEB-SETTINGS-07 reverts the optimistic value and alerts when the save fails', async () => {
    signIn()
    useMswHandlers(...preferenceHandlers({ initial: true, putStatus: 500 }))

    render(<AboutPage />)
    await waitFor(() => expect(toggle()).toBeEnabled())

    fireEvent.click(toggle())
    expect(toggle()).not.toBeChecked()

    const alert = await screen.findByRole('alert')
    // Catalog copy, not the server's English: the API error body is English on
    // every locale, and this section serves ten.
    expect(alert).toHaveTextContent('Unable to update shopping preferences.')
    // Reverted: the control must not keep claiming a state the server rejected.
    expect(toggle()).toBeChecked()
    expect(toggle()).toBeEnabled()
    expect(screen.getByTestId('commerce-status-region')).toHaveTextContent('')
  })

  it('5.1-WEB-SETTINGS-08 recovers on a retry after a failed save', async () => {
    signIn()
    let putStatus: number | undefined = 500
    useMswHandlers(
      subscriptionHandler(),
      themeHandler(),
      locationsHandler(),
      http.get(PREFERENCES_PATH, () =>
        HttpResponse.json({ data: { affiliateCtasEnabled: true } })
      ),
      http.put(PREFERENCES_PATH, async ({ request }) => {
        const body = (await request.json()) as { affiliateCtasEnabled: boolean }
        if (putStatus) {
          const status = putStatus
          putStatus = undefined
          return HttpResponse.json(
            { statusCode: status, message: 'Temporary failure.', error: 'Server Error' },
            { status }
          )
        }
        return HttpResponse.json({ data: body })
      })
    )

    render(<AboutPage />)
    await waitFor(() => expect(toggle()).toBeEnabled())

    fireEvent.click(toggle())
    await screen.findByRole('alert')
    await waitFor(() => expect(toggle()).toBeEnabled())

    fireEvent.click(toggle())

    await waitFor(() =>
      expect(screen.getByTestId('commerce-status-region')).toHaveTextContent(
        'Shopping preferences updated'
      )
    )
    // The stale error clears once the retry succeeds.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(toggle()).not.toBeChecked()
  })

  it('5.1-WEB-SETTINGS-09 leaves the control disabled when the preference cannot be read', async () => {
    signIn()
    useMswHandlers(...preferenceHandlers({ getStatus: 500 }))

    render(<AboutPage />)

    const alert = await screen.findByRole('alert')
    // A failed read says so. It used to reuse the save string ("Unable to
    // update..."), which names an action the reader never took, and before that
    // it echoed the server's English whatever locale was selected.
    expect(alert).toHaveTextContent('Unable to load shopping preferences.')
    // Showing the `true` default would render an opted-out account as opted in.
    expect(toggle()).toBeDisabled()
    expect(screen.queryByTestId('commerce-signed-out-hint')).not.toBeInTheDocument()
  })

  it('5.1-WEB-SETTINGS-A11Y-01 passes axe signed out and after a failed save', async () => {
    const view = render(<AboutPage />)
    await screen.findByTestId('commerce-signed-out-hint')
    await expectNoAxeViolations(view.container)
    view.unmount()

    signIn()
    useMswHandlers(...preferenceHandlers({ initial: true, putStatus: 500 }))
    const signedIn = render(<AboutPage />)
    await waitFor(() => expect(toggle()).toBeEnabled())
    fireEvent.click(toggle())
    await screen.findByRole('alert')

    await expectNoAxeViolations(signedIn.container)
  })

  /**
   * Leaving the route mid-request must not land an error banner on a tree that
   * is already gone, and must not leave the fetch running.
   */
  it('5.1-WEB-SETTINGS-10 abandons an in-flight read when the page unmounts', async () => {
    signIn()
    const gate = deferred<void>()
    const aborted = deferred<void>()
    const started = deferred<void>()
    useMswHandlers(
      subscriptionHandler(),
      themeHandler(),
      locationsHandler(),
      http.get(PREFERENCES_PATH, async ({ request }) => {
        request.signal.addEventListener('abort', () => aborted.resolve())
        started.resolve()
        await gate.promise
        return HttpResponse.json({ data: { affiliateCtasEnabled: true } })
      })
    )

    const view = render(<AboutPage />)
    await waitFor(() => expect(toggle()).toBeDisabled())
    // Unmounting before the request reaches the handler would abort it unseen.
    await started.promise

    view.unmount()
    await aborted.promise
    gate.resolve()

    expect(screen.queryByTestId('commerce-preferences-section')).not.toBeInTheDocument()
  })

  it('5.2 and 5.3 keep the processor disclosure and subscribe controls before the palette gallery', async () => {
    render(<PremiumPage />)
    const premium = screen.getByTestId('premium-subscription-section')
    const theme = screen.getByTestId('premium-theme-section')
    expect(
      premium.compareDocumentPosition(theme) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    const disclosure = screen.getByTestId('premium-disclosure')
    expect(disclosure).toHaveTextContent('RevenueCat')
    expect(disclosure).toHaveTextContent('Stripe')
    expect(screen.getByTestId('premium-theme-disclosure')).toHaveTextContent(
      'A palette changes colors only'
    )
    expect(await screen.findByTestId('premium-theme-locked')).toBeVisible()
  })

  it('5.1-WEB-SETTINGS-11 labels the toggle and describes it with the help text', async () => {
    signIn()
    useMswHandlers(...preferenceHandlers({}))

    render(<AboutPage />)

    const labelled = await screen.findByRole('checkbox', {
      name: 'Show "Shop this look" suggestions',
    })
    expect(labelled).toBe(toggle())
    expect(labelled).toHaveAccessibleDescription(
      /Turn this off to hide all partner and affiliate suggestions\./
    )
  })

  // Story 1.2b: the page heading was English on every locale before the
  // Locations section moved in; it now reads the catalog.
  it("1.2b-WEB-SETTINGS-01 titles the page in the reader's language after hydration", () => {
    vi.spyOn(window.navigator, 'languages', 'get').mockReturnValue(['de-DE'])

    render(<SettingsPage />)
    act(() => {
      activateBrowserLocale()
    })

    expect(
      screen.getByRole('heading', { level: 1, name: deDE.settings.title })
    ).toBeInTheDocument()
    expect(deDE.settings.title).not.toBe('Settings')
  })

  it('PROFILE-WEB-01 shows the member display name in the compact Profile', async () => {
    signIn()
    const bearers: (string | null)[] = []
    useMswHandlers(
      profileHandler(undefined, (request) =>
        bearers.push(request.headers.get('authorization'))
      ),
      ...profileSummaryHandlers()
    )
    render(<SettingsPage />)

    const account = await screen.findByTestId('profile-account-row')
    await waitFor(() => expect(account).toHaveTextContent('Jade Rivers'))
    expect(account).toHaveAttribute('href', '/settings/account')
    expect(account).not.toHaveTextContent('jade@example.test')
    expect(bearers).toEqual(['Bearer test-token-member'])
  })

  it('PROFILE-WEB-02 shows the email alone on Account when the member has no display name', async () => {
    signIn()
    useMswHandlers(profileHandler({ displayName: null, email: 'jade@example.test' }))
    render(<AccountPage />)

    expect(await screen.findByTestId('profile-account')).toHaveTextContent(
      'jade@example.test'
    )
    expect(screen.queryByTestId('profile-account-name')).toBeNull()
  })

  it('7.16 distinguishes an unset name and primary place from a failed read', async () => {
    signIn()
    useMswHandlers(
      profileHandler({ displayName: null, email: 'jade@example.test' }),
      ...profileSummaryHandlers()
    )
    render(<SettingsPage />)

    await waitFor(() =>
      expect(screen.getByTestId('profile-account-row')).toHaveTextContent('Not set')
    )
    expect(screen.getByTestId('profile-places-row')).toHaveTextContent('Not set')
  })

  it('PROFILE-WEB-03 offers Profile destinations to a visitor without requesting member data', async () => {
    const asked = vi.fn()
    useMswHandlers(profileHandler(undefined, asked))
    render(<SettingsPage />)

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Profile')
    expect(await screen.findByTestId('profile-places-row')).toHaveAttribute(
      'href',
      '/settings/places'
    )
    expect(screen.getByTestId('profile-style-row')).toHaveAttribute(
      'href',
      '/settings/style'
    )
    expect(screen.getByTestId('profile-notifications-row')).toHaveAttribute(
      'href',
      '/notification-settings'
    )
    expect(asked).not.toHaveBeenCalled()
  })
})

describe('7.7 Profile without flashes', () => {
  afterEach(async () => {
    navigation.prerendering = false
    vi.unstubAllEnvs()
    window.sessionStorage.clear()
    document.documentElement.removeAttribute('data-session')
    screenSnapshot.clear()
    vi.restoreAllMocks()
    // A case that switched languages (7.7-CMP-046, 7.7-CMP-047) and failed midway leaves none
    // behind for the next.
    await getI18n().changeLanguage('en-US')
  })

  it('7.7-CMP-010 first paint on Places includes the signed-out section chrome', () => {
    navigation.prerendering = true
    const html = renderToString(<PlacesPage />)
    expect(html).toContain('data-testid="locations-section"')
    expect(html).toContain('data-guest-text="Sign in to manage your locations."')
  })

  it('7.7-CMP-011 a warm Profile returns with its last summary before new reads answer', async () => {
    signIn()
    document.documentElement.setAttribute('data-session', 'member')
    useMswHandlers(profileHandler(), ...profileSummaryHandlers())
    const firstVisit = render(<SettingsPage />)
    const account = await screen.findByTestId('profile-account-row')
    await waitFor(() => expect(account).toHaveTextContent('Jade Rivers'))
    firstVisit.unmount()

    const accountRead = deferred<void>()
    onTestFinished(() => accountRead.resolve(undefined))
    const refresh = vi.fn()
    useMswHandlers(
      http.get(PROFILE_PATH, async () => {
        refresh()
        await accountRead.promise
        return HttpResponse.json({
          user: {
            id: 'member-1',
            email: 'jade@example.test',
            displayName: 'Jade Rivers',
            birthdate: null,
            role: 'guardian',
          },
          linkedGuardians: [],
          linkedTeens: [],
        })
      })
    )
    render(<SettingsPage />)

    expect(screen.getByTestId('screen-gate')).toHaveAttribute('data-ready', 'true')
    expect(screen.getByTestId('profile-account-row')).toHaveTextContent('Jade Rivers')
    await waitFor(() => expect(refresh).toHaveBeenCalled())
  })

  function memberProfileReads(theme: { theme: string | null; isEntitled: boolean }) {
    return [
      profileHandler(),
      subscriptionHandler(),
      http.get('/api/v1/commerce/premium/access', () => HttpResponse.error()),
      http.get(THEME_PATH, () =>
        HttpResponse.json({ data: { ...theme, themesEnabled: true } })
      ),
      http.get(PREFERENCES_PATH, () =>
        HttpResponse.json({ data: { affiliateCtasEnabled: true } })
      ),
    ]
  }

  async function firstVisitSettles(topic: 'about' | 'premium' = 'about') {
    const view = render(topic === 'about' ? <AboutPage /> : <PremiumPage />)
    await waitFor(() =>
      expect(screen.getByTestId('screen-gate')).toHaveAttribute('data-ready', 'true')
    )
    if (topic === 'about') await waitFor(() => expect(toggle()).toBeEnabled())
    return view
  }

  const kept = <T,>(part: string) =>
    screenSnapshot.recall<T>(
      currentWebSessionScope(),
      part === 'theme' ? 'settings-premium' : 'settings-about',
      part
    )

  it('7.7-CMP-033 a palette saved while a return refreshes the theme keeps the saved palette when the older read answers (CodeRabbit r1 #12)', async () => {
    signIn()
    document.documentElement.setAttribute('data-session', 'member')
    onTestFinished(() => document.documentElement.removeAttribute('data-theme'))
    const refresh = deferred<void>()
    let returning = false
    useMswHandlers(
      http.get(THEME_PATH, async () => {
        if (returning) await refresh.promise
        return HttpResponse.json({
          data: { theme: null, isEntitled: true, themesEnabled: true },
        })
      }),
      http.put(THEME_PATH, () =>
        HttpResponse.json({
          data: { theme: 'jewel_radiance', isEntitled: true, themesEnabled: true },
        })
      ),
      ...memberProfileReads({ theme: null, isEntitled: true })
    )
    ;(await firstVisitSettles('premium')).unmount()
    expect(kept<{ theme: string | null }>('theme')?.theme).toBeNull()

    // The return shows the remembered gallery; its refresh is still out when the member saves.
    returning = true
    render(<PremiumPage />)
    fireEvent.click(screen.getByTestId('premium-theme-option-jewel_radiance'))
    await waitFor(() =>
      expect(document.documentElement.getAttribute('data-theme')).toBe('jewel_radiance')
    )

    // The refresh sent before the save answers with the palette the save replaced.
    await act(async () => {
      refresh.resolve()
      await refresh.promise
    })
    await settle()
    expect(document.documentElement.getAttribute('data-theme')).toBe('jewel_radiance')
    expect(screen.getByTestId('premium-theme-option-jewel_radiance')).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    expect(kept<{ theme: string | null }>('theme')?.theme).toBe('jewel_radiance')
  })

  it('7.7-CMP-034 a preference saved while a return refreshes it keeps the saved value when the older read answers (CodeRabbit r1 #13)', async () => {
    signIn()
    document.documentElement.setAttribute('data-session', 'member')
    const refresh = deferred<void>()
    let returning = false
    useMswHandlers(
      http.get(PREFERENCES_PATH, async () => {
        if (returning) await refresh.promise
        return HttpResponse.json({ data: { affiliateCtasEnabled: true } })
      }),
      http.put(PREFERENCES_PATH, async ({ request }) => {
        const body = (await request.json()) as { affiliateCtasEnabled: boolean }
        return HttpResponse.json({
          data: { affiliateCtasEnabled: body.affiliateCtasEnabled },
        })
      }),
      ...memberProfileReads({ theme: null, isEntitled: false })
    )
    ;(await firstVisitSettles()).unmount()

    // The return shows the remembered opt-in at once, with no loading state, while it refreshes.
    returning = true
    render(<AboutPage />)
    expect(toggle()).toBeEnabled()
    expect(toggle()).toBeChecked()
    fireEvent.click(toggle())
    expect(await screen.findByText('Shopping preferences updated')).toBeInTheDocument()
    expect(toggle()).not.toBeChecked()

    await act(async () => {
      refresh.resolve()
      await refresh.promise
    })
    await settle()
    expect(toggle()).not.toBeChecked()
    expect(kept<{ enabled: boolean }>('commerce')).toEqual({ enabled: false })
  })

  it('7.7-CMP-035 a save in flight never reaches the snapshot: a return starts from the value the server confirmed (CodeRabbit r1 #27)', async () => {
    signIn()
    document.documentElement.setAttribute('data-session', 'member')
    const putGate = deferred<void>()
    useMswHandlers(
      ...preferenceHandlers({ initial: true, putGate: putGate.promise }),
      http.get('/api/v1/commerce/premium/access', () => HttpResponse.error())
    )
    await firstVisitSettles()
    await waitFor(() => expect(kept('commerce')).toEqual({ enabled: true }))

    fireEvent.click(toggle())
    // The checkbox shows the requested value at once; the snapshot keeps the confirmed one.
    expect(toggle()).not.toBeChecked()
    await settle()
    expect(kept('commerce')).toEqual({ enabled: true })

    await act(async () => {
      putGate.resolve()
      await putGate.promise
    })
    expect(await screen.findByText('Shopping preferences updated')).toBeInTheDocument()
    await waitFor(() => expect(kept('commerce')).toEqual({ enabled: false }))
  })

  it('7.7-CMP-036 waits for the cold Summary without mounting management reads', async () => {
    signIn()
    document.documentElement.setAttribute('data-session', 'member')
    const account = deferred<void>()
    onTestFinished(() => account.resolve(undefined))
    const management = vi.fn()
    useMswHandlers(
      http.get(PROFILE_PATH, async () => {
        await account.promise
        return HttpResponse.json({
          user: {
            id: 'member-1',
            displayName: 'Jade Rivers',
            email: 'jade@example.test',
            birthdate: null,
            role: 'guardian',
          },
          linkedGuardians: [],
          linkedTeens: [],
        })
      }),
      ...profileSummaryHandlers(),
      http.get(PREFERENCES_PATH, management),
      http.get(THEME_PATH, management),
      http.get(SUBSCRIPTION_PATH, management)
    )
    render(<SettingsPage />)
    expect(screen.getByTestId('screen-placeholder')).toBeVisible()
    expect(screen.getByTestId('profile-account-row')).not.toBeVisible()

    await act(async () => {
      account.resolve(undefined)
      await account.promise
    })
    await waitFor(() =>
      expect(screen.getByTestId('profile-account-row')).toHaveTextContent('Jade Rivers')
    )
    expect(screen.getByTestId('profile-places-row')).toBeVisible()
    expect(management).not.toHaveBeenCalled()
  })

  it('7.7-CMP-046 a preference read sent while a save is out never replaces the saved value, and a read sent after the save does (CodeRabbit r2 #4)', async () => {
    signIn()
    document.documentElement.setAttribute('data-session', 'member')
    let stored = true
    let reads = 0
    const overlapping = deferred<void>()
    const putGate = deferred<void>()
    useMswHandlers(
      http.get(PREFERENCES_PATH, async () => {
        reads += 1
        // The value the server holds when the read is served, before any later save commits.
        const answer = stored
        if (reads === 2) await overlapping.promise
        return HttpResponse.json({ data: { affiliateCtasEnabled: answer } })
      }),
      http.put(PREFERENCES_PATH, async ({ request }) => {
        const body = (await request.json()) as { affiliateCtasEnabled: boolean }
        await putGate.promise
        stored = body.affiliateCtasEnabled
        return HttpResponse.json({ data: body })
      }),
      ...memberProfileReads({ theme: null, isEntitled: false })
    )
    await firstVisitSettles()
    expect(toggle()).toBeChecked()

    // The member opts out; while that save is out, a language switch reads the setting again.
    fireEvent.click(toggle())
    await act(async () => {
      await getI18n().changeLanguage('de-DE')
    })
    await waitFor(() => expect(reads).toBe(2))

    await act(async () => {
      putGate.resolve()
      await putGate.promise
    })
    await waitFor(() => expect(kept('commerce')).toEqual({ enabled: false }))

    // The read sent during the save answers with the value the save replaced.
    await act(async () => {
      overlapping.resolve()
      await overlapping.promise
    })
    await settle()
    expect(toggle()).not.toBeChecked()
    expect(kept('commerce')).toEqual({ enabled: false })

    // Another device opts back in; a read sent after the save settled is current and lands.
    stored = true
    await act(async () => {
      await getI18n().changeLanguage('en-US')
    })
    await waitFor(() => expect(toggle()).toBeChecked())
    expect(reads).toBe(3)
    await waitFor(() => expect(kept('commerce')).toEqual({ enabled: true }))
  })

  it('7.7-CMP-047 a palette read sent while a save is out never replaces the saved palette, and a read sent after the save does (CodeRabbit r2 #8)', async () => {
    signIn()
    document.documentElement.setAttribute('data-session', 'member')
    onTestFinished(() => document.documentElement.removeAttribute('data-theme'))
    let stored: string | null = null
    let reads = 0
    const overlapping = deferred<void>()
    const putGate = deferred<void>()
    useMswHandlers(
      http.get(THEME_PATH, async () => {
        reads += 1
        const answer = stored
        if (reads === 2) await overlapping.promise
        return HttpResponse.json({
          data: { theme: answer, isEntitled: true, themesEnabled: true },
        })
      }),
      http.put(THEME_PATH, async () => {
        await putGate.promise
        stored = 'jewel_radiance'
        return HttpResponse.json({
          data: { theme: 'jewel_radiance', isEntitled: true, themesEnabled: true },
        })
      }),
      ...memberProfileReads({ theme: null, isEntitled: true })
    )
    await firstVisitSettles('premium')

    // The member picks a palette; while that save is out, a language switch reads the theme again.
    // This Profile mounted without a theme snapshot, so that read is not an in-place refresh, and
    // the save supersedes it: the gallery never goes to loading (CodeRabbit r3 on #8).
    fireEvent.click(await screen.findByTestId('premium-theme-option-jewel_radiance'))
    await act(async () => {
      await getI18n().changeLanguage('de-DE')
    })
    await waitFor(() => expect(reads).toBe(2))
    expect(screen.getByTestId('premium-theme-gallery')).toBeVisible()
    expect(screen.getByTestId('premium-theme-section')).toHaveAttribute(
      'aria-busy',
      'false'
    )

    await act(async () => {
      putGate.resolve()
      await putGate.promise
    })
    await waitFor(() =>
      expect(document.documentElement.getAttribute('data-theme')).toBe('jewel_radiance')
    )

    // The read sent during the save answers with the palette the save replaced.
    await act(async () => {
      overlapping.resolve()
      await overlapping.promise
    })
    await settle()
    expect(document.documentElement.getAttribute('data-theme')).toBe('jewel_radiance')
    // The dropped read leaves the gallery ready, never stuck hidden behind loading.
    expect(screen.getByTestId('premium-theme-gallery')).toBeVisible()
    expect(screen.getByTestId('premium-theme-section')).toHaveAttribute(
      'aria-busy',
      'false'
    )
    expect(screen.getByTestId('premium-theme-option-jewel_radiance')).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    expect(kept<{ theme: string | null }>('theme')?.theme).toBe('jewel_radiance')

    // Another device picks a different palette; a read sent after the save settled lands.
    stored = 'autumn_umber'
    await act(async () => {
      await getI18n().changeLanguage('en-US')
    })
    await waitFor(() =>
      expect(document.documentElement.getAttribute('data-theme')).toBe('autumn_umber')
    )
    expect(reads).toBe(3)
  })

  it('7.7-CMP-048 settles Profile when the account summary is unavailable', async () => {
    signIn()
    document.documentElement.setAttribute('data-session', 'member')
    useMswHandlers(
      http.get(PROFILE_PATH, () => HttpResponse.error()),
      ...profileSummaryHandlers()
    )
    render(<SettingsPage />)
    await waitFor(() => expect(screen.getByTestId('profile-account-row')).toBeVisible())
    expect(screen.getByTestId('profile-places-row')).toBeVisible()
    expect(screen.queryByText('jade@example.test')).toBeNull()
  })

  const SIGN_IN_HINTS = [
    'Sign in to manage your locations.',
    'Sign in to change this',
    'Sign in to subscribe or manage Premium',
    'Sign in and subscribe to Premium',
  ]
  const SIGNED_OUT_TEST_IDS = [
    'locations-signed-out',
    'commerce-signed-out-hint',
    'premium-signed-out-hint',
  ]

  it('7.7-CMP-037 the first HTML paints the signed-out hints from CSS only: no Sign in words or hint ids in the document (real-session PS-1, PL-1)', () => {
    const html = renderToString(
      <>
        <PlacesPage />
        <AboutPage />
        <PremiumPage />
      </>
    )
    const firstHtml = new DOMParser().parseFromString(html, 'text/html')

    // A member's page hides this first paint, but its text and ids were still in the document,
    // so a member's page held a Sign in hint and Locations passed through its hint id.
    for (const hint of SIGN_IN_HINTS)
      expect(firstHtml.body.textContent ?? '', hint).not.toContain(hint)
    for (const id of SIGNED_OUT_TEST_IDS)
      expect(firstHtml.querySelector(`[data-testid="${id}"]`), id).toBeNull()
    // A plain attribute read: jest-dom's matchers refuse a node from a DOMParser document, which
    // is not this window's HTMLElement (CI, 3d4b5c96).
    expect(
      firstHtml
        .querySelector('[data-testid="locations-section"]')
        ?.getAttribute('data-state')
    ).toBe('checking')
    // A signed-out page still paints every hint where it will stay, out of the accessibility tree.
    const standIns = [...firstHtml.querySelectorAll('[data-guest-text]')]
    const standInWords = standIns.map(
      (node) => node.getAttribute('data-guest-text') ?? ''
    )
    expect(standInWords).toHaveLength(SIGN_IN_HINTS.length)
    SIGN_IN_HINTS.forEach((hint, index) => expect(standInWords[index]).toContain(hint))
    for (const node of standIns) {
      expect(node.getAttribute('aria-hidden')).toBe('true')
      expect(node.getAttribute('data-landing')).toBe('guest')
      expect(node.textContent).toBe('')
    }
  })

  it('7.7-CMP-037 after hydration a member page holds no guest stand-in while the session is checked, and the signed-out hints come only for a signed-out reader', async () => {
    signIn()
    document.documentElement.setAttribute('data-session', 'pending')
    const never = new Promise<never>(() => undefined)
    useMswHandlers(
      http.get(PROFILE_PATH, () => never),
      http.get('/api/v1/locations', () => never),
      http.get(PREFERENCES_PATH, () => never),
      http.get(SUBSCRIPTION_PATH, () => never),
      http.get('/api/v1/commerce/premium/access', () => never),
      http.get(THEME_PATH, () => never)
    )
    const { container, unmount } = render(
      <>
        <PlacesPage />
        <AboutPage />
        <PremiumPage />
      </>
    )

    expect(container.querySelector('[data-landing="guest"]')).toBeNull()
    expect(container.querySelector('[data-guest-text]')).toBeNull()
    for (const hint of SIGN_IN_HINTS) expect(container.textContent).not.toContain(hint)
    unmount()

    // A signed-out reader gets the real hints, with their ids, once the check ends signed out.
    vi.unstubAllEnvs()
    window.sessionStorage.clear()
    document.documentElement.setAttribute('data-session', 'none')
    render(
      <>
        <PlacesPage />
        <AboutPage />
        <PremiumPage />
      </>
    )
    for (const id of SIGNED_OUT_TEST_IDS)
      expect(await screen.findByTestId(id)).toBeVisible()
    expect(document.querySelector('[data-guest-text]')).toBeNull()
  })
})
