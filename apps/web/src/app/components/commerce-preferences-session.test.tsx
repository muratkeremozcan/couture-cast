// Learning path Step 58: Production follow-ups after the project close.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#production-follow-ups-after-the-project-close
// Production follow-up (2026-11-19), owner on production 8b0fed06: a direct load or reload of
// /settings while signed in showed "Sign in to change this" under Shopping and partners. The section asked once, on mount,
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
import { CommercePreferencesSection } from './commerce-preferences-section'

/** The session bridge's state, driven by hand: who verification named, and its pending answer. */
const session = vi.hoisted(() => ({
  identity: null as string | null,
  stored: false,
  verify: null as null | ((token: string | undefined) => void),
}))

vi.mock('../../lib/web-session', async (importOriginal) => ({
  ...(await importOriginal<typeof WebSession>()),
  webSessionIdentity: () => session.identity,
  hasStoredWebSession: () => session.stored,
  resolveWebSessionToken: () =>
    new Promise<string | undefined>((resolve) => {
      session.verify = resolve
    }),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/settings',
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
    session.verify?.(token)
    await Promise.resolve()
  })
}

/** Every member-owned read's bearer, in order. */
let bearers: (string | null)[]

function renderSection() {
  return render(
    <I18nextProvider i18n={getI18n()}>
      <main>
        <CommercePreferencesSection />
      </main>
    </I18nextProvider>
  )
}

function resetSession() {
  bearers = []
  session.identity = null
  session.stored = false
  session.verify = null
}

/** member-1 opted out of shopping links; member-2 keeps them on. */
const PREFERENCE: Record<string, boolean> = {
  'Bearer token-1': false,
  'Bearer token-2': true,
}

const hint = () => screen.queryByTestId('commerce-signed-out-hint')
const toggle = () => screen.getByTestId<HTMLInputElement>('commerce-opt-out-toggle')

describe('CommercePreferencesSection follows the web session', () => {
  beforeEach(async () => {
    resetSession()
    useMswHandlers(
      http.get('/api/v1/commerce/preferences', ({ request }) => {
        const bearer = request.headers.get('authorization')
        bearers.push(bearer)
        return HttpResponse.json({
          data: { affiliateCtasEnabled: PREFERENCE[bearer ?? ''] ?? true },
        })
      })
    )
    await getI18n().changeLanguage('en-US')
  })

  afterEach(() => {
    window.sessionStorage.clear()
  })

  it('COMMERCE-SESSION-WEB-01 a new tab waits for verification, then reads once with the fresh bearer', async () => {
    // A new tab: a stored session, no bearer in this tab yet.
    session.stored = true
    renderSection()
    await settle()

    expect(hint()).toBeNull()
    expect(bearers).toEqual([])

    publish({ identity: 'member-1', bearer: 'token-1' })
    await waitFor(() => expect(toggle()).toBeEnabled())
    expect(toggle()).not.toBeChecked()

    // The verification answers too, and the bridge announces the same member again.
    await finishVerification('token-1')
    publish({ identity: 'member-1', bearer: 'token-1' })
    await settle()
    expect(bearers).toEqual(['Bearer token-1'])
    expect(hint()).toBeNull()
  })

  it('COMMERCE-SESSION-WEB-02 a reload with a stale bearer reads only with the fresh one', async () => {
    session.stored = true
    window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, 'stale-token')
    renderSection()
    await settle()
    expect(hint()).toBeNull()
    expect(bearers).toEqual([])

    publish({ identity: null, bearer: null })
    await settle()
    expect(hint()).toBeNull()

    publish({ identity: 'member-1', bearer: 'token-1' })
    await waitFor(() => expect(toggle()).toBeEnabled())
    await settle()
    expect(bearers).toEqual(['Bearer token-1'])
  })

  it('COMMERCE-SESSION-WEB-03 says sign in only once verification ends without a member', async () => {
    session.stored = true
    renderSection()
    await settle()
    expect(hint()).toBeNull()

    session.stored = false
    await finishVerification(undefined)
    publish({ identity: null, bearer: null })

    await waitFor(() => expect(hint()).toHaveTextContent('Sign in to change this'))
    expect(bearers).toEqual([])
  })

  it('COMMERCE-SESSION-WEB-04 the next member gets their own preference, and sign-out keeps none', async () => {
    session.stored = true
    session.identity = 'member-1'
    window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, 'token-1')
    renderSection()
    await waitFor(() => expect(toggle()).toBeEnabled())
    expect(toggle()).not.toBeChecked()

    publish({ identity: null, bearer: null })
    publish({ identity: 'member-2', bearer: 'token-2' })
    // The control starts checked and disabled; member-2's own answer is what enables it.
    await waitFor(() => {
      expect(toggle()).toBeChecked()
      expect(toggle()).toBeEnabled()
    })
    await settle()
    expect(bearers).toEqual(['Bearer token-1', 'Bearer token-2'])

    session.stored = false
    publish({ identity: null, bearer: null })
    await waitFor(() => expect(hint()).toHaveTextContent('Sign in to change this'))
    expect(toggle()).toBeDisabled()
    expect(bearers).toHaveLength(2)
  })
})
