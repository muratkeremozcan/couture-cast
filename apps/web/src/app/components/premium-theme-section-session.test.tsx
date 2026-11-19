// Learning path Step 58: Production follow-ups after the project close.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#production-follow-ups-after-the-project-close
// Production follow-up (2026-11-19), owner on production 8b0fed06: a direct load or reload of
// /settings while signed in showed "Sign in and subscribe to Premium" (the owner has complimentary Premium) under Interface palettes. The section asked once, on mount,
// whether this tab held the verified bearer; a new tab or a reload gets it only after the session
// bridge verifies the stored session, so the section settled on signed out and never looked again.
// It now follows the session as Locations does: a stored session under verification shows no
// sign-in hint and sends nothing, each member's read goes out once with that member's bearer, and
// nothing of one member stays for the next. The browser proof is PS-1 and PS-2 in
// playwright/tests/settings-sections-real-session.spec.ts; these pin each transition.
import { http, HttpResponse } from 'msw'
import { act, render, screen, waitFor } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getI18n } from '../../i18n'
import { WEB_ACCESS_TOKEN_STORAGE_KEY } from '../../lib/wardrobe'
import { useMswHandlers } from '../../test-utils/msw/runtime'
import { settle } from '../../test-utils/request-barrier'
import type * as WebSession from '../../lib/web-session'
import { PremiumThemeSection } from './premium-theme-section'
import { SessionBridge } from './session-bridge'

/** The session bridge's state, driven by hand: who verification named, and its pending answer. */
const session = vi.hoisted(() => ({
  identity: null as string | null,
  stored: false,
  /** Every verification asked for and not yet answered: a section may join one in flight. */
  verifiers: [] as ((token: string | undefined) => void)[],
}))

vi.mock('../../lib/web-session', async (importOriginal) => ({
  ...(await importOriginal<typeof WebSession>()),
  webSessionIdentity: () => session.identity,
  hasStoredWebSession: () => session.stored,
  resolveWebSessionToken: () =>
    new Promise<string | undefined>((resolve) => {
      session.verifiers.push(resolve)
    }),
}))

/** The pathname the app is on; a client-side link changes it. */
const route = vi.hoisted(() => ({ pathname: '/settings' }))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => route.pathname,
}))

/** What the session bridge does when verification names (or clears) the member. */
function publish(change: { identity: string | null; bearer: string | null }) {
  act(() => {
    session.identity = change.identity
    if (change.bearer === null)
      window.sessionStorage.removeItem(WEB_ACCESS_TOKEN_STORAGE_KEY)
    else window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, change.bearer)
    window.dispatchEvent(new Event('couture:session'))
  })
}

async function finishVerification(token: string | undefined) {
  await act(async () => {
    for (const verify of session.verifiers.splice(0)) verify(token)
    await Promise.resolve()
  })
}

/** Every member-owned read's bearer, in order. */
let bearers: (string | null)[]

function renderSection() {
  return render(
    <I18nextProvider i18n={getI18n()}>
      <main>
        <PremiumThemeSection />
      </main>
    </I18nextProvider>
  )
}

function resetSession() {
  bearers = []
  session.identity = null
  session.stored = false
  session.verifiers = []
}

/** member-1 is entitled and picked Autumn Umber; member-2 is not entitled. */
const THEME: Record<string, Record<string, unknown>> = {
  'Bearer token-1': { theme: 'autumn_umber', isEntitled: true, themesEnabled: true },
  'Bearer token-2': { theme: null, isEntitled: false, themesEnabled: true },
}

const SIGNED_OUT = /Sign in and subscribe to Premium/
const SIGNED_IN_LOCKED = /Subscribe to Premium with the controls above/
const locked = () => screen.queryByTestId('premium-theme-locked')
const gallery = () => screen.queryByTestId('premium-theme-gallery')
const appliedTheme = () => document.documentElement.dataset.theme ?? ''

describe('PremiumThemeSection follows the web session', () => {
  beforeEach(async () => {
    resetSession()
    route.pathname = '/settings'
    document.documentElement.dataset.theme = ''
    useMswHandlers(
      http.get('/api/v1/commerce/premium/theme', ({ request }) => {
        const bearer = request.headers.get('authorization')
        bearers.push(bearer)
        return HttpResponse.json({ data: THEME[bearer ?? ''] ?? THEME['Bearer token-2'] })
      })
    )
    await getI18n().changeLanguage('en-US')
  })

  afterEach(() => {
    window.sessionStorage.clear()
    document.documentElement.dataset.theme = ''
  })

  it('THEME-SESSION-WEB-01 a new tab waits for verification, then reads once and applies the palette', async () => {
    session.stored = true
    renderSection()
    await settle()

    expect(locked()?.textContent ?? '').not.toMatch(SIGNED_OUT)
    expect(bearers).toEqual([])

    publish({ identity: 'member-1', bearer: 'token-1' })
    expect(await screen.findByTestId('premium-theme-gallery')).toBeInTheDocument()
    expect(appliedTheme()).not.toBe('')

    await finishVerification('token-1')
    publish({ identity: 'member-1', bearer: 'token-1' })
    await settle()
    expect(bearers).toEqual(['Bearer token-1'])
  })

  it('THEME-SESSION-WEB-02 a reload with a stale bearer reads only with the fresh one', async () => {
    session.stored = true
    window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, 'stale-token')
    renderSection()
    await settle()
    expect(locked()?.textContent ?? '').not.toMatch(SIGNED_OUT)
    expect(bearers).toEqual([])

    publish({ identity: null, bearer: null })
    await settle()
    expect(locked()?.textContent ?? '').not.toMatch(SIGNED_OUT)

    publish({ identity: 'member-2', bearer: 'token-2' })
    await waitFor(() => expect(locked()).toHaveTextContent(SIGNED_IN_LOCKED))
    await settle()
    expect(bearers).toEqual(['Bearer token-2'])
  })

  it('THEME-SESSION-WEB-03 says sign in only once verification ends without a member', async () => {
    session.stored = true
    renderSection()
    await settle()
    expect(locked()?.textContent ?? '').not.toMatch(SIGNED_OUT)

    session.stored = false
    await finishVerification(undefined)
    publish({ identity: null, bearer: null })

    await waitFor(() => expect(locked()).toHaveTextContent(SIGNED_OUT))
    expect(bearers).toEqual([])
  })

  it("THEME-SESSION-WEB-04 the next member never keeps the last member's palette, and sign-out keeps none", async () => {
    session.stored = true
    session.identity = 'member-1'
    window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, 'token-1')
    renderSection()
    expect(await screen.findByTestId('premium-theme-gallery')).toBeInTheDocument()
    const memberOnePalette = appliedTheme()
    expect(memberOnePalette).not.toBe('')

    publish({ identity: null, bearer: null })
    publish({ identity: 'member-2', bearer: 'token-2' })
    await waitFor(() => expect(locked()).toHaveTextContent(SIGNED_IN_LOCKED))
    expect(gallery()).toBeNull()
    expect(appliedTheme()).toBe('')
    await settle()
    expect(bearers).toEqual(['Bearer token-1', 'Bearer token-2'])

    session.stored = false
    publish({ identity: null, bearer: null })
    await waitFor(() => expect(locked()).toHaveTextContent(SIGNED_OUT))
    expect(appliedTheme()).toBe('')
    expect(bearers).toHaveLength(2)
  })

  // Settings Codex review 1, finding 4: a denial of member-1's superseded token is not a sign-out.
  it('THEME-SESSION-WEB-05 a late 401 for the old token after a same-member rotation reads again with the fresh one', async () => {
    let releaseOld!: () => void
    const old = new Promise<void>((resolve) => {
      releaseOld = resolve
    })
    useMswHandlers(
      http.get('/api/v1/commerce/premium/theme', async ({ request }) => {
        const bearer = request.headers.get('authorization')
        bearers.push(bearer)
        if (bearer === 'Bearer token-1a') {
          await old
          return HttpResponse.json(
            { statusCode: 401, message: 'Unauthorized', error: 'Unauthorized' },
            { status: 401 }
          )
        }
        return HttpResponse.json({ data: THEME['Bearer token-1'] })
      })
    )
    session.stored = true
    session.identity = 'member-1'
    window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, 'token-1a')
    renderSection()
    await waitFor(() => expect(bearers).toEqual(['Bearer token-1a']))

    publish({ identity: 'member-1', bearer: 'token-1b' })
    await settle()
    // The rotation alone starts no second read; only the denial of the old token does.
    expect(bearers).toEqual(['Bearer token-1a'])
    await act(async () => {
      releaseOld()
      await Promise.resolve()
    })

    expect(await screen.findByTestId('premium-theme-gallery')).toBeInTheDocument()
    expect(locked()?.textContent ?? '').not.toMatch(SIGNED_OUT)
    expect(bearers).toEqual(['Bearer token-1a', 'Bearer token-1b'])
  })

  it('THEME-SESSION-WEB-05b control: an old read that succeeds after a same-member rotation is kept, with no second read', async () => {
    let releaseOld!: () => void
    const old = new Promise<void>((resolve) => {
      releaseOld = resolve
    })
    useMswHandlers(
      http.get('/api/v1/commerce/premium/theme', async ({ request }) => {
        const bearer = request.headers.get('authorization')
        bearers.push(bearer)
        if (bearer === 'Bearer token-1a') {
          await old
          // Answers as member-1's fresh read would.
        }
        return HttpResponse.json({ data: THEME['Bearer token-1'] })
      })
    )
    session.stored = true
    session.identity = 'member-1'
    window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, 'token-1a')
    renderSection()
    await waitFor(() => expect(bearers).toEqual(['Bearer token-1a']))

    publish({ identity: 'member-1', bearer: 'token-1b' })
    await settle()
    // The rotation alone starts no second read; only the denial of the old token does.
    expect(bearers).toEqual(['Bearer token-1a'])
    await act(async () => {
      releaseOld()
      await Promise.resolve()
    })

    expect(await screen.findByTestId('premium-theme-gallery')).toBeInTheDocument()
    expect(locked()?.textContent ?? '').not.toMatch(SIGNED_OUT)
    await settle()
    expect(bearers).toEqual(['Bearer token-1a'])
  })

  // Settings Codex review 1, finding 7: the palette is applied to the whole document, which
  // outlives Settings. Member-1 picks it, follows a link away, and signs out elsewhere.
  it("THEME-SESSION-WEB-06 member-1's palette leaves the document when member-1 signs out after leaving Settings", async () => {
    session.stored = true
    session.identity = 'member-1'
    window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, 'token-1')
    const shell = (settings: boolean) => (
      <I18nextProvider i18n={getI18n()}>
        <SessionBridge />
        <main>{settings && <PremiumThemeSection />}</main>
      </I18nextProvider>
    )
    const view = render(shell(true))
    expect(await screen.findByTestId('premium-theme-gallery')).toBeInTheDocument()
    const memberOnePalette = appliedTheme()
    expect(memberOnePalette).not.toBe('')

    // A client-side link away from Settings: the root shell stays, the section goes.
    route.pathname = '/wardrobe'
    view.rerender(shell(false))
    expect(screen.queryByTestId('premium-theme-section')).toBeNull()
    expect(appliedTheme()).toBe(memberOnePalette)

    session.stored = false
    publish({ identity: null, bearer: null })
    await settle()

    expect(appliedTheme()).toBe('')
  })
})

// Settings Codex review 2, finding 2: the bridge keeps member-1's old bearer installed until the
// replacement verifies, so the old read's 401 can arrive first. It is not a sign-out: the
// section waits for that verification and reads once with the fresh token. (The 401 arriving
// after the fresh token was published is the rotation case above.)
describe('a 401 while the bridge still verifies a replacement token', () => {
  beforeEach(async () => {
    resetSession()
    await getI18n().changeLanguage('en-US')
  })

  afterEach(() => {
    window.sessionStorage.clear()
  })

  it('THEME-SESSION-WEB-07 waits for the verification, then reads once with the fresh token', async () => {
    let releaseOld!: () => void
    const old = new Promise<void>((resolve) => {
      releaseOld = resolve
    })
    useMswHandlers(
      http.get('/api/v1/commerce/premium/theme', async ({ request }) => {
        const bearer = request.headers.get('authorization')
        bearers.push(bearer)
        if (bearer === 'Bearer token-1a') {
          await old
          return HttpResponse.json(
            { statusCode: 401, message: 'Unauthorized', error: 'Unauthorized' },
            { status: 401 }
          )
        }
        return HttpResponse.json({ data: THEME['Bearer token-1'] })
      })
    )
    session.stored = true
    session.identity = 'member-1'
    window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, 'token-1a')
    renderSection()
    await waitFor(() => expect(bearers).toEqual(['Bearer token-1a']))

    // The old token is denied while it is still the installed one.
    expect(session.verifiers).toHaveLength(0)
    await act(async () => {
      releaseOld()
      await Promise.resolve()
    })
    await settle()
    expect(locked()?.textContent ?? '').not.toMatch(SIGNED_OUT)
    expect(bearers).toEqual(['Bearer token-1a'])

    // The denial joined the bridge's verification while the old token is still installed.
    await waitFor(() => expect(session.verifiers.length).toBeGreaterThan(0))
    expect(window.sessionStorage.getItem(WEB_ACCESS_TOKEN_STORAGE_KEY)).toBe('token-1a')
    expect(locked()?.textContent ?? '').not.toMatch(SIGNED_OUT)
    expect(bearers).toEqual(['Bearer token-1a'])

    // As the bridge does: install and publish member-1's fresh token, then answer the
    // verification. Publication alone starts no read; the retry waits for the verification.
    publish({ identity: 'member-1', bearer: 'token-1b' })
    await settle()
    expect(bearers).toEqual(['Bearer token-1a'])
    expect(locked()?.textContent ?? '').not.toMatch(SIGNED_OUT)
    await finishVerification('token-1b')

    expect(await screen.findByTestId('premium-theme-gallery')).toBeInTheDocument()
    expect(locked()?.textContent ?? '').not.toMatch(SIGNED_OUT)
    await settle()
    expect(bearers).toEqual(['Bearer token-1a', 'Bearer token-1b'])
  })
})
