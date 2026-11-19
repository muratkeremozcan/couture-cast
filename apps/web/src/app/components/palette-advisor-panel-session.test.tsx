// Learning path Step 58: Production follow-ups after the project close.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#production-follow-ups-after-the-project-close
// Production follow-up (2026-11-19), same root cause as the owner's /settings report on
// production 8b0fed06: the Palette advisor (/palette) asked once, on mount, whether this tab held
// the verified bearer. A new tab or a reload gets it only after the session bridge verifies the
// stored session, so an entitled member saw "Sign in and subscribe to Premium" and the panel never
// looked again. It now follows the session: no sign-in wording and no read while verification is
// pending, one read per member with that member's bearer, and nothing of one member kept for the
// next. The /settings browser proof is playwright/tests/settings-sections-real-session.spec.ts.
import { http, HttpResponse } from 'msw'
import { act, render, screen, waitFor } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getI18n } from '../../i18n'
import { WEB_ACCESS_TOKEN_STORAGE_KEY } from '../../lib/wardrobe'
import { useMswHandlers } from '../../test-utils/msw/runtime'
import type * as WebSession from '../../lib/web-session'
import { ADVISOR_RULES } from '@couture/api-client/contracts/http'
import {
  PALETTE_PATH,
  card,
  profile,
  readyAnalysis,
} from '../../test-utils/palette-advisor-panel'
import { stubPartnerTab } from '../../test-utils/partner-tab'
import { PaletteAdvisorPanel } from './palette-advisor-panel'

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

/** Lets every pending read answer and React apply it, without a timer. */
async function settle() {
  for (let round = 0; round < 3; round += 1)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
}

/** Every member-owned read's bearer, in order. */
let bearers: (string | null)[]

function renderSection() {
  return render(
    <I18nextProvider i18n={getI18n()}>
      <main>
        <PaletteAdvisorPanel />
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

/** member-1 is entitled; member-2 is signed in without Premium. */
const ENTITLED: Record<string, boolean> = {
  'Bearer token-1': true,
  'Bearer token-2': false,
}

const SIGNED_OUT = /Sign in and subscribe to Premium/
const SIGNED_IN_LOCKED = /Subscribe to Premium from Profile/
const locked = () => screen.queryByTestId('palette-advisor-locked')
const consent = () => screen.queryByTestId('palette-advisor-consent')

describe('PaletteAdvisorPanel follows the web session', () => {
  beforeEach(async () => {
    resetSession()
    useMswHandlers(
      http.get(PALETTE_PATH, ({ request }) => {
        const bearer = request.headers.get('authorization')
        bearers.push(bearer)
        return HttpResponse.json({
          data: profile({ isEntitled: ENTITLED[bearer ?? ''] ?? false }),
        })
      })
    )
    await getI18n().changeLanguage('en-US')
  })

  afterEach(() => {
    window.sessionStorage.clear()
  })

  it('PALETTE-SESSION-WEB-01 a new tab waits for verification, then reads once with the fresh bearer', async () => {
    session.stored = true
    renderSection()
    await settle()

    expect(locked()?.textContent ?? '').not.toMatch(SIGNED_OUT)
    expect(bearers).toEqual([])

    publish({ identity: 'member-1', bearer: 'token-1' })
    expect(await screen.findByTestId('palette-advisor-consent')).toBeInTheDocument()
    expect(locked()).toBeNull()

    await finishVerification('token-1')
    publish({ identity: 'member-1', bearer: 'token-1' })
    await settle()
    expect(bearers).toEqual(['Bearer token-1'])
  })

  it('PALETTE-SESSION-WEB-02 a reload with a stale bearer reads only with the fresh one', async () => {
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

  it('PALETTE-SESSION-WEB-03 says sign in only once verification ends without a member', async () => {
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

  it("PALETTE-SESSION-WEB-04 the next member never sees the last member's advisor, and sign-out keeps none", async () => {
    session.stored = true
    session.identity = 'member-1'
    window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, 'token-1')
    renderSection()
    expect(await screen.findByTestId('palette-advisor-consent')).toBeInTheDocument()

    publish({ identity: null, bearer: null })
    publish({ identity: 'member-2', bearer: 'token-2' })
    await waitFor(() => expect(locked()).toHaveTextContent(SIGNED_IN_LOCKED))
    expect(consent()).toBeNull()
    await settle()
    expect(bearers).toEqual(['Bearer token-1', 'Bearer token-2'])

    session.stored = false
    publish({ identity: null, bearer: null })
    await waitFor(() => expect(locked()).toHaveTextContent(SIGNED_OUT))
    expect(consent()).toBeNull()
    expect(bearers).toHaveLength(2)
  })

  // Settings Codex review 1, findings 2, 4 and 5.
  describe('sponsored handoff and denials belong to the member and the page that made them', () => {
    const FOUNDATION = ADVISOR_RULES.warm.foundation.withDepth.medium
    const CTA = `palette-advisor-sponsored-cta-${FOUNDATION.itemKey}`
    const CLICKS_PATH = '/api/v1/commerce/affiliate/clicks'
    const sponsoredProfile = profile({
      isEntitled: true,
      hasConsent: true,
      analysis: readyAnalysis('medium'),
      recommendations: [
        card(FOUNDATION, {
          sponsored: {
            partnerId: 'lumen-beauty',
            partnerDisplayName: 'Lumen Beauty',
            offerId: 'offer-foundation-1',
            offerTitle: 'Lumen Skin Tint',
          },
        }),
      ],
    })
    let clickBearers: (string | null)[]
    let releaseClick: () => void

    beforeEach(() => {
      clickBearers = []
      let release!: () => void
      const held = new Promise<void>((resolve) => {
        release = resolve
      })
      releaseClick = release
      useMswHandlers(
        http.get(PALETTE_PATH, ({ request }) => {
          bearers.push(request.headers.get('authorization'))
          return HttpResponse.json({ data: sponsoredProfile })
        }),
        http.post(CLICKS_PATH, async ({ request }) => {
          clickBearers.push(request.headers.get('authorization'))
          await held
          return HttpResponse.json({
            data: { redirectUrl: 'https://partner.example/offer?click=abc' },
          })
        })
      )
    })

    function signInMemberOne() {
      session.stored = true
      session.identity = 'member-1'
      window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, 'token-1')
    }

    // Finding 2: the bridge already names member-2; member-1's card is still on screen.
    it('PALETTE-SESSION-WEB-05 a sponsored press after the session moved on mints nothing and opens no tab', async () => {
      const partner = stubPartnerTab()
      signInMemberOne()
      renderSection()
      const cta = await screen.findByTestId(CTA)

      // The bridge moved to member-2 and React has not heard yet.
      session.identity = 'member-2'
      window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, 'token-2')
      act(() => {
        cta.click()
      })
      releaseClick()
      await settle()

      expect(clickBearers).toEqual([])
      expect(partner.openSpy).not.toHaveBeenCalled()
      expect(partner.navigations).toEqual([])
    })

    // Finding 5: the press was member-1's and the mint answers after the panel closed.
    it('PALETTE-SESSION-WEB-06 a sponsored mint answering after the panel closed never navigates its tab', async () => {
      const partner = stubPartnerTab()
      signInMemberOne()
      const view = renderSection()
      const cta = await screen.findByTestId(CTA)
      act(() => {
        cta.click()
      })
      await waitFor(() => expect(clickBearers).toEqual(['Bearer token-1']))

      view.unmount()
      await act(async () => {
        releaseClick()
        await Promise.resolve()
      })
      await settle()

      expect(partner.navigations).toEqual([])
      expect(partner.tab.close).toHaveBeenCalledTimes(1)
    })
  })

  // Finding 4: a denial of member-1's superseded token is not a sign-out.
  it('PALETTE-SESSION-WEB-07 a late 401 for the old token after a same-member rotation reads again with the fresh one', async () => {
    let releaseOld!: () => void
    const old = new Promise<void>((resolve) => {
      releaseOld = resolve
    })
    useMswHandlers(
      http.get(PALETTE_PATH, async ({ request }) => {
        const bearer = request.headers.get('authorization')
        bearers.push(bearer)
        if (bearer === 'Bearer token-1a') {
          await old
          return HttpResponse.json(
            { statusCode: 401, message: 'Unauthorized', error: 'Unauthorized' },
            { status: 401 }
          )
        }
        return HttpResponse.json({ data: profile({ isEntitled: true }) })
      })
    )
    session.stored = true
    session.identity = 'member-1'
    window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, 'token-1a')
    renderSection()
    await waitFor(() => expect(bearers).toEqual(['Bearer token-1a']))

    publish({ identity: 'member-1', bearer: 'token-1b' })
    await act(async () => {
      releaseOld()
      await Promise.resolve()
    })

    expect(await screen.findByTestId('palette-advisor-consent')).toBeInTheDocument()
    expect(locked()).toBeNull()
    expect(bearers).toEqual(['Bearer token-1a', 'Bearer token-1b'])
  })
})
