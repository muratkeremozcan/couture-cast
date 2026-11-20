// Learning path Step 58: Production follow-ups after the project close.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#production-follow-ups-after-the-project-close
// Production follow-up (2026-11-19), owner on production 8b0fed06: a direct load or reload of
// /settings while signed in showed "You do not have a Premium subscription yet" with "Sign in to subscribe or manage Premium" under Premium. The section asked once, on mount,
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
import { requestsStarted, settle } from '../../test-utils/request-barrier'
import type * as WebSession from '../../lib/web-session'
import type * as Premium from '../../lib/premium'
import { redirectToExternalUrl } from '../../lib/premium'
import { SubscriptionSection } from './subscription-section'

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

// jsdom's location cannot be assigned, so the external redirect is recorded instead.
/** Every checkout and portal session the section asked for, kept until it settles. */
const billing = vi.hoisted(() => ({
  promises: [] as Promise<unknown>[],
  /**
   * When set, a session request answers with this URL once `gate` opens, whatever the caller's
   * cancellation: a client that ignores the abort, so only the section's own checks stand
   * between the late answer and a redirect.
   */
  late: null as { gate: Promise<void>; url: string } | null,
}))
vi.mock('../../lib/premium', async (importOriginal) => {
  const actual = await importOriginal<typeof Premium>()
  return {
    ...actual,
    redirectToExternalUrl: vi.fn(),
    createCheckoutSessionFromWeb: (
      ...args: Parameters<typeof actual.createCheckoutSessionFromWeb>
    ) => {
      const late = billing.late
      const pending = late
        ? late.gate.then(() => late.url)
        : actual.createCheckoutSessionFromWeb(...args)
      billing.promises.push(pending)
      return pending
    },
    createPortalSessionFromWeb: (
      ...args: Parameters<typeof actual.createPortalSessionFromWeb>
    ) => {
      const late = billing.late
      const pending = late
        ? late.gate.then(() => late.url)
        : actual.createPortalSessionFromWeb(...args)
      billing.promises.push(pending)
      return pending
    },
  }
})

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
    for (const verify of session.verifiers.splice(0)) verify(token)
    await Promise.resolve()
  })
}

/** Every member-owned read's bearer, in order. */
let bearers: (string | null)[]
/** The premium access read's bearers: it rides beside the subscription read. */
let accessBearers: (string | null)[]

function renderSection() {
  return render(
    <I18nextProvider i18n={getI18n()}>
      <main>
        <SubscriptionSection />
      </main>
    </I18nextProvider>
  )
}

function resetSession() {
  bearers = []
  accessBearers = []
  session.identity = null
  session.stored = false
  session.verifiers = []
}

const NONE = {
  status: 'none',
  store: null,
  productId: null,
  willRenew: null,
  currentPeriodEnd: null,
  syncedAt: null,
  purchasesEnabled: true,
}
/** member-1 holds an active web subscription; member-2 has none. */
const SUBSCRIPTION: Record<string, Record<string, unknown>> = {
  'Bearer token-1': {
    status: 'active',
    store: 'stripe',
    productId: 'premium_monthly',
    willRenew: true,
    currentPeriodEnd: '2026-12-19T00:00:00.000Z',
    syncedAt: '2026-11-19T08:00:00.000Z',
    purchasesEnabled: true,
  },
}

const hint = () => screen.queryByTestId('premium-signed-out-hint')
const subscribe = () => screen.queryByTestId('premium-subscribe-monthly')
const manage = () => screen.queryByTestId('premium-manage-button')

describe('SubscriptionSection follows the web session', () => {
  beforeEach(async () => {
    resetSession()
    useMswHandlers(
      http.get('/api/v1/commerce/subscription', ({ request }) => {
        const bearer = request.headers.get('authorization')
        bearers.push(bearer)
        return HttpResponse.json({ data: SUBSCRIPTION[bearer ?? ''] ?? NONE })
      }),
      // The access source rides beside the subscription; its failure renders as before.
      http.get('/api/v1/commerce/premium/access', ({ request }) => {
        accessBearers.push(request.headers.get('authorization'))
        return HttpResponse.json({ statusCode: 500, message: 'down' }, { status: 500 })
      })
    )
    await getI18n().changeLanguage('en-US')
  })

  afterEach(() => {
    window.sessionStorage.clear()
  })

  it('SUBSCRIPTION-SESSION-WEB-01 a new tab waits for verification, then reads once with the fresh bearer', async () => {
    session.stored = true
    renderSection()
    await settle()

    expect(hint()).toBeNull()
    // Verification is pending: neither read of the section has started.
    expect(requestsStarted()).toBe(0)
    expect(bearers).toEqual([])
    expect(accessBearers).toEqual([])

    publish({ identity: 'member-2', bearer: 'token-2' })
    expect(await screen.findByTestId('premium-subscribe-monthly')).toBeEnabled()

    await finishVerification('token-2')
    publish({ identity: 'member-2', bearer: 'token-2' })
    await settle()
    expect(bearers).toEqual(['Bearer token-2'])
    expect(accessBearers).toEqual(['Bearer token-2'])
    expect(hint()).toBeNull()
  })

  it('SUBSCRIPTION-SESSION-WEB-02 a reload with a stale bearer reads only with the fresh one', async () => {
    session.stored = true
    window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, 'stale-token')
    renderSection()
    await settle()
    expect(hint()).toBeNull()
    expect(requestsStarted()).toBe(0)
    expect(bearers).toEqual([])
    expect(accessBearers).toEqual([])

    publish({ identity: null, bearer: null })
    await settle()
    expect(hint()).toBeNull()
    expect(requestsStarted()).toBe(0)

    publish({ identity: 'member-1', bearer: 'token-1' })
    expect(await screen.findByTestId('premium-manage-button')).toBeInTheDocument()
    await settle()
    expect(bearers).toEqual(['Bearer token-1'])
    expect(accessBearers).toEqual(['Bearer token-1'])
  })

  it('SUBSCRIPTION-SESSION-WEB-03 says sign in only once verification ends without a member', async () => {
    session.stored = true
    renderSection()
    await settle()
    expect(hint()).toBeNull()

    session.stored = false
    await finishVerification(undefined)
    publish({ identity: null, bearer: null })

    await waitFor(() =>
      expect(hint()).toHaveTextContent('Sign in to subscribe or manage Premium')
    )
    expect(bearers).toEqual([])
  })

  it("SUBSCRIPTION-SESSION-WEB-04 the next member never sees the last member's subscription, and sign-out keeps none", async () => {
    session.stored = true
    session.identity = 'member-1'
    window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, 'token-1')
    renderSection()
    expect(await screen.findByTestId('premium-manage-button')).toBeInTheDocument()
    expect(screen.getByTestId('premium-status-line')).toHaveTextContent(
      /Premium is active/
    )

    publish({ identity: null, bearer: null })
    expect(manage()).toBeNull()
    publish({ identity: 'member-2', bearer: 'token-2' })
    expect(await screen.findByTestId('premium-subscribe-monthly')).toBeEnabled()
    expect(manage()).toBeNull()
    await settle()
    expect(bearers).toEqual(['Bearer token-1', 'Bearer token-2'])

    session.stored = false
    publish({ identity: null, bearer: null })
    await waitFor(() =>
      expect(hint()).toHaveTextContent('Sign in to subscribe or manage Premium')
    )
    // Nothing of a member's subscription survives (no manage control), and the controls are the
    // signed-out ones 5.2-WEB-SEC-01 pins: present, disabled, described by the sign-in hint.
    expect(manage()).toBeNull()
    expect(subscribe()).toBeDisabled()
    expect(screen.getByTestId('premium-subscribe-annual')).toBeDisabled()
    expect(screen.queryByTestId('premium-status-line')?.textContent ?? '').not.toMatch(
      /Premium is active/
    )
    expect(bearers).toHaveLength(2)
  })

  // Codex review 20: the switch case signs out from a member with no subscription, so a section
  // that kept the last status would pass it. Here the member who signs out is the active one.
  it('SUBSCRIPTION-SESSION-WEB-05 an active member who signs out leaves no trace of the subscription', async () => {
    session.stored = true
    session.identity = 'member-1'
    window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, 'token-1')
    renderSection()
    expect(await screen.findByTestId('premium-manage-button')).toBeInTheDocument()
    expect(screen.getByTestId('premium-status-line')).toHaveTextContent(
      /Premium is active/
    )

    const statusText = () =>
      screen.queryByTestId('premium-status-line')?.textContent ?? ''

    // The owner is gone while the bridge still verifies: nothing of member-1 stays on screen.
    publish({ identity: null, bearer: null })
    expect(statusText()).not.toMatch(/Premium is active/)
    expect(manage()).toBeNull()

    // Verification ends without a member: the signed-out section, still nothing of member-1.
    session.stored = false
    await finishVerification(undefined)
    publish({ identity: null, bearer: null })
    await waitFor(() =>
      expect(hint()).toHaveTextContent('Sign in to subscribe or manage Premium')
    )
    expect(statusText()).not.toMatch(/Premium is active/)
    expect(manage()).toBeNull()
    expect(subscribe()).toBeDisabled()
    expect(bearers).toEqual(['Bearer token-1'])
  })

  // The owner saw "You do not have a Premium subscription yet" on /settings although Premium is
  // theirs (complimentary). Beyond the sign-in race, the line spoke while the reads were still out:
  // a status line is a claim about this member, so it waits for the answer that decides it.
  describe('the status line never claims "no subscription" before the reads answer', () => {
    const NO_SUBSCRIPTION = "You don't have a Premium subscription yet."

    /** The status line's text each time the observer delivers, from first paint on, in order. */
    function recordStatusLine() {
      const seen: string[] = []
      const note = () => {
        const text = screen.queryByTestId('premium-status-line')?.textContent ?? ''
        if (text && seen.at(-1) !== text) seen.push(text)
      }
      const observer = new MutationObserver(note)
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true,
      })
      return { seen, stop: () => observer.disconnect() }
    }

    function hold() {
      let release!: () => void
      const gate = new Promise<void>((resolve) => {
        release = resolve
      })
      return { gate, release }
    }

    it('SUBSCRIPTION-SESSION-WEB-06 a complimentary member never reads "no subscription" while access is pending', async () => {
      const access = hold()
      useMswHandlers(
        http.get('/api/v1/commerce/subscription', ({ request }) => {
          bearers.push(request.headers.get('authorization'))
          return HttpResponse.json({ data: NONE })
        }),
        http.get('/api/v1/commerce/premium/access', async () => {
          await access.gate
          return HttpResponse.json({ data: { premium: true, source: 'complimentary' } })
        })
      )
      session.stored = true
      session.identity = 'member-1'
      window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, 'token-1')
      const { seen, stop } = recordStatusLine()
      try {
        renderSection()
        // The subscription read has answered "none"; only the access read is still out.
        await waitFor(() => expect(bearers).toEqual(['Bearer token-1']))
        await settle()
        expect(seen).not.toContain(NO_SUBSCRIPTION)

        act(() => access.release())
        // The same recording holds the member's own status, so a silent recorder fails here.
        await waitFor(() =>
          expect(seen).toContain(
            'You have complimentary Premium access from CoutureCast.'
          )
        )
        await settle()
        expect(screen.getByTestId('premium-status-line')).toHaveTextContent(
          'You have complimentary Premium access from CoutureCast.'
        )
      } finally {
        stop()
      }
      expect(seen).not.toContain(NO_SUBSCRIPTION)
    })

    it('SUBSCRIPTION-SESSION-WEB-07 an active subscriber never reads "no subscription" while the read is pending', async () => {
      const subscription = hold()
      useMswHandlers(
        http.get('/api/v1/commerce/subscription', async ({ request }) => {
          bearers.push(request.headers.get('authorization'))
          await subscription.gate
          return HttpResponse.json({ data: SUBSCRIPTION['Bearer token-1'] })
        })
      )
      session.stored = true
      session.identity = 'member-1'
      window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, 'token-1')
      const { seen, stop } = recordStatusLine()
      try {
        renderSection()
        await waitFor(() => expect(bearers).toEqual(['Bearer token-1']))
        await settle()
        expect(seen).not.toContain(NO_SUBSCRIPTION)

        act(() => subscription.release())
        await waitFor(() =>
          expect(seen.some((text) => /Premium is active/.test(text))).toBe(true)
        )
        await settle()
        expect(screen.getByTestId('premium-status-line')).toHaveTextContent(
          /Premium is active/
        )
      } finally {
        stop()
      }
      expect(seen).not.toContain(NO_SUBSCRIPTION)
    })
  })

  // Settings Codex review 1, findings 3 to 5.
  describe('billing work belongs to the member and the page that started it', () => {
    const REFRESH_PATH = '/api/v1/commerce/subscription/refresh'
    const PORTAL_PATH = '/api/v1/commerce/subscription/portal-session'
    const CHECKOUT_PATH = '/api/v1/commerce/subscription/checkout-session'
    const ACTIVATING = 'Payment received. Activating your Premium subscription…'
    const PORTAL_LAG = /billing portal, especially cancellations/
    let refreshBearers: (string | null)[]

    function hold() {
      let release!: () => void
      const gate = new Promise<void>((resolve) => {
        release = resolve
      })
      return { gate, release }
    }

    /** Every billing session request the section started has settled (or been cancelled). */
    async function settleBilling() {
      await act(async () => {
        await Promise.allSettled(billing.promises)
      })
      await settle()
    }

    beforeEach(() => {
      refreshBearers = []
      billing.promises = []
      billing.late = null
      vi.mocked(redirectToExternalUrl).mockClear()
      useMswHandlers(
        http.post(REFRESH_PATH, ({ request }) => {
          const bearer = request.headers.get('authorization')
          refreshBearers.push(bearer)
          return HttpResponse.json({ data: SUBSCRIPTION[bearer ?? ''] ?? NONE })
        })
      )
    })

    afterEach(() => {
      billing.late = null
      window.history.replaceState({}, '', '/')
    })

    // Finding 3: a return marker on the open page is member-1's, not the next member's.
    it.each([
      ['checkout', '/settings?checkout=success'],
      ['portal', '/settings?portal=return'],
    ])(
      'SUBSCRIPTION-SESSION-WEB-08 a %s return is not replayed for the next member on the same page',
      async (_kind, url) => {
        const memberTwoRead = hold()
        useMswHandlers(
          http.get('/api/v1/commerce/subscription', async ({ request }) => {
            const bearer = request.headers.get('authorization')
            bearers.push(bearer)
            if (bearer === 'Bearer token-2') await memberTwoRead.gate
            return HttpResponse.json({ data: SUBSCRIPTION[bearer ?? ''] ?? NONE })
          })
        )
        window.history.replaceState({}, '', url)
        session.stored = true
        session.identity = 'member-1'
        window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, 'token-1')
        renderSection()
        await waitFor(() => expect(refreshBearers).toEqual(['Bearer token-1']))

        publish({ identity: null, bearer: null })
        publish({ identity: 'member-2', bearer: 'token-2' })
        await waitFor(() =>
          expect(bearers.filter((bearer) => bearer === 'Bearer token-2')).toEqual([
            'Bearer token-2',
          ])
        )
        await settle()
        // While member-2's own read is still out, nothing of member-1's return shows.
        expect(screen.queryByText(ACTIVATING)).toBeNull()
        expect(screen.queryByTestId('premium-portal-lag-hint')).toBeNull()
        expect(document.body.textContent).not.toMatch(PORTAL_LAG)

        act(() => memberTwoRead.release())
        expect(await screen.findByTestId('premium-subscribe-monthly')).toBeEnabled()
        await settle()

        // member-2 loads normally: one plain read, no refresh, no return messages.
        expect(refreshBearers).toEqual(['Bearer token-1'])
        expect(bearers.filter((bearer) => bearer === 'Bearer token-2')).toEqual([
          'Bearer token-2',
        ])
        expect(screen.queryByText(ACTIVATING)).toBeNull()
        expect(screen.queryByTestId('premium-portal-lag-hint')).toBeNull()
        expect(document.body.textContent).not.toMatch(PORTAL_LAG)
      }
    )

    // Finding 4: a denial of member-1's superseded token is not a sign-out. The old read stays
    // held through the rotation, so a section that simply refetches on every token change is
    // told apart from one that retries the denied read.
    describe('a same-member token rotation', () => {
      function useOldRead(old: { gate: Promise<void> }, status: 200 | 401) {
        useMswHandlers(
          http.get('/api/v1/commerce/subscription', async ({ request }) => {
            const bearer = request.headers.get('authorization')
            bearers.push(bearer)
            if (bearer === 'Bearer token-1a') {
              await old.gate
              if (status === 401)
                return HttpResponse.json(
                  { statusCode: 401, message: 'Unauthorized', error: 'Unauthorized' },
                  { status: 401 }
                )
            }
            return HttpResponse.json({ data: SUBSCRIPTION['Bearer token-1'] })
          })
        )
      }

      async function rotateWhileOldReadIsOut() {
        session.stored = true
        session.identity = 'member-1'
        window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, 'token-1a')
        renderSection()
        await waitFor(() => expect(bearers).toEqual(['Bearer token-1a']))
        publish({ identity: 'member-1', bearer: 'token-1b' })
        await settle()
        // The rotation alone starts no second read.
        expect(bearers).toEqual(['Bearer token-1a'])
      }

      it('SUBSCRIPTION-SESSION-WEB-09 a late 401 for the old token reads again, once, with the fresh one', async () => {
        const old = hold()
        useOldRead(old, 401)
        await rotateWhileOldReadIsOut()

        await act(async () => {
          old.release()
          await Promise.resolve()
        })

        expect(await screen.findByTestId('premium-manage-button')).toBeInTheDocument()
        await settle()
        expect(hint()).toBeNull()
        expect(bearers).toEqual(['Bearer token-1a', 'Bearer token-1b'])
      })

      it('SUBSCRIPTION-SESSION-WEB-09b control: an old read that succeeds is kept, with no second read', async () => {
        const old = hold()
        useOldRead(old, 200)
        await rotateWhileOldReadIsOut()

        act(() => old.release())

        expect(await screen.findByTestId('premium-manage-button')).toBeInTheDocument()
        await settle()
        expect(bearers).toEqual(['Bearer token-1a'])
      })
    })

    // Finding 5: a checkout or portal session that answers after its page or member is gone
    // sends nobody anywhere. The section's own request promise is settled before asserting.
    it.each([
      ['portal', 'Settings closes', 'unmount'],
      ['portal', 'member-1 leaves and comes back', 'a-b-a'],
      ['checkout', 'Settings closes', 'unmount'],
      ['checkout', 'member-2 leaves and comes back', 'a-b-a'],
    ])(
      'SUBSCRIPTION-SESSION-WEB-10 a %s session answering after %s does not redirect',
      async (kind, _case, how) => {
        const answer = hold()
        let posts = 0
        useMswHandlers(
          http.post(kind === 'portal' ? PORTAL_PATH : CHECKOUT_PATH, async () => {
            posts += 1
            await answer.gate
            return HttpResponse.json({
              data: {
                url:
                  kind === 'portal'
                    ? 'https://portal.stripe.test/session'
                    : 'https://checkout.stripe.test/session',
              },
            })
          })
        )
        // The portal belongs to an active subscriber, checkout to a member without Premium.
        const [member, token, other, otherToken] =
          kind === 'portal'
            ? ['member-1', 'token-1', 'member-2', 'token-2']
            : ['member-2', 'token-2', 'member-1', 'token-1']
        session.stored = true
        session.identity = member
        window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, token)
        const view = renderSection()
        const control = await screen.findByTestId(
          kind === 'portal' ? 'premium-manage-button' : 'premium-subscribe-monthly'
        )
        await waitFor(() => expect(control).toBeEnabled())
        control.click()
        await waitFor(() => expect(posts).toBe(1))
        expect(billing.promises).toHaveLength(1)

        if (how === 'unmount') view.unmount()
        else {
          publish({ identity: other, bearer: otherToken })
          publish({ identity: member, bearer: token })
          await settle()
        }
        act(() => answer.release())
        await settleBilling()

        expect(vi.mocked(redirectToExternalUrl)).not.toHaveBeenCalled()
      }
    )

    // CodeRabbit PR 259 round 2: the cases above answer through a request the abort cancels, so
    // they cannot tell a section that checks its mount from one that relies on the cancellation.
    // Here the billing call fulfills anyway, after the page or member is gone.
    describe('a session request that fulfills despite cancellation', () => {
      const LATE_URL = {
        portal: 'https://portal.stripe.test/late',
        checkout: 'https://checkout.stripe.test/late',
      } as const

      /** Starts a session request that answers only when `answer.release` runs. */
      async function startLateBilling(kind: 'portal' | 'checkout') {
        const answer = hold()
        billing.late = { gate: answer.gate, url: LATE_URL[kind] }
        // The portal belongs to an active subscriber, checkout to a member without Premium.
        const [member, token, other, otherToken] =
          kind === 'portal'
            ? ['member-1', 'token-1', 'member-2', 'token-2']
            : ['member-2', 'token-2', 'member-1', 'token-1']
        session.stored = true
        session.identity = member
        window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, token)
        const view = renderSection()
        const control = await screen.findByTestId(
          kind === 'portal' ? 'premium-manage-button' : 'premium-subscribe-monthly'
        )
        await waitFor(() => expect(control).toBeEnabled())
        control.click()
        await waitFor(() => expect(billing.promises).toHaveLength(1))
        return { answer, view, member, token, other, otherToken }
      }

      it.each([
        ['portal', 'unmount'],
        ['portal', 'a-b-a'],
        ['checkout', 'unmount'],
        ['checkout', 'a-b-a'],
      ] as const)(
        'SUBSCRIPTION-SESSION-WEB-11 a %s answer that arrives after %s is not followed',
        async (kind, how) => {
          const { answer, view, member, token, other, otherToken } =
            await startLateBilling(kind)

          if (how === 'unmount') view.unmount()
          else {
            publish({ identity: other, bearer: otherToken })
            publish({ identity: member, bearer: token })
            await settle()
          }
          act(() => answer.release())
          await settleBilling()

          expect(vi.mocked(redirectToExternalUrl)).not.toHaveBeenCalled()
        }
      )

      it.each(['portal', 'checkout'] as const)(
        'SUBSCRIPTION-SESSION-WEB-11c control: the same %s answer redirects while the mount is active',
        async (kind) => {
          const { answer } = await startLateBilling(kind)

          act(() => answer.release())
          await settleBilling()

          expect(vi.mocked(redirectToExternalUrl)).toHaveBeenCalledTimes(1)
          expect(vi.mocked(redirectToExternalUrl)).toHaveBeenCalledWith(LATE_URL[kind])
        }
      )
    })

    // Settings Codex review 2, finding 5: the return belongs to the first member scope on the
    // page. Once member-1 leaves, it is spent, so member-1 signing in again loads normally.
    it.each([
      ['checkout', '/settings?checkout=success'],
      ['portal', '/settings?portal=return'],
    ])(
      'SUBSCRIPTION-SESSION-WEB-13 a %s return spent by member-1 is not replayed when member-1 signs in again',
      async (_kind, url) => {
        useMswHandlers(
          http.get('/api/v1/commerce/subscription', ({ request }) => {
            const bearer = request.headers.get('authorization')
            bearers.push(bearer)
            return HttpResponse.json({ data: SUBSCRIPTION[bearer ?? ''] ?? NONE })
          })
        )
        window.history.replaceState({}, '', url)
        session.stored = true
        session.identity = 'member-1'
        window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, 'token-1')
        renderSection()
        await waitFor(() => expect(refreshBearers).toEqual(['Bearer token-1']))
        expect(await screen.findByTestId('premium-manage-button')).toBeInTheDocument()
        await settle()

        publish({ identity: null, bearer: null })
        publish({ identity: 'member-2', bearer: 'token-2' })
        expect(await screen.findByTestId('premium-subscribe-monthly')).toBeEnabled()
        await settle()

        publish({ identity: null, bearer: null })
        publish({ identity: 'member-1', bearer: 'token-1' })
        expect(await screen.findByTestId('premium-manage-button')).toBeInTheDocument()
        await settle()

        // member-1's second scope reads once, plainly: no second refresh, no return messages.
        expect(refreshBearers).toEqual(['Bearer token-1'])
        expect(bearers.filter((bearer) => bearer === 'Bearer token-1')).toEqual([
          'Bearer token-1',
        ])
        expect(screen.queryByText(ACTIVATING)).toBeNull()
        expect(screen.queryByTestId('premium-portal-lag-hint')).toBeNull()
        expect(document.body.textContent).not.toMatch(PORTAL_LAG)
      }
    )

    // Settings Codex review 2, finding 6: the portal return sends one refresh. When it fails, the
    // fallback read is the only part retried after a superseded-token denial.
    it('SUBSCRIPTION-SESSION-WEB-14 a portal return whose fallback read is denied after a rotation refreshes once', async () => {
      const old = hold()
      useMswHandlers(
        http.post(REFRESH_PATH, ({ request }) => {
          refreshBearers.push(request.headers.get('authorization'))
          return HttpResponse.json(
            { statusCode: 503, message: 'ledger unavailable' },
            { status: 503 }
          )
        }),
        http.get('/api/v1/commerce/subscription', async ({ request }) => {
          const bearer = request.headers.get('authorization')
          bearers.push(bearer)
          if (bearer === 'Bearer token-1a') {
            await old.gate
            return HttpResponse.json(
              { statusCode: 401, message: 'Unauthorized', error: 'Unauthorized' },
              { status: 401 }
            )
          }
          return HttpResponse.json({ data: SUBSCRIPTION['Bearer token-1'] })
        })
      )
      window.history.replaceState({}, '', '/settings?portal=return')
      session.stored = true
      session.identity = 'member-1'
      window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, 'token-1a')
      renderSection()
      // The refresh failed and the fallback read went out with the old token.
      await waitFor(() => expect(bearers).toEqual(['Bearer token-1a']))
      expect(refreshBearers).toEqual(['Bearer token-1a'])

      publish({ identity: 'member-1', bearer: 'token-1b' })
      await settle()
      // The rotation alone sends nothing: any second read below answers the denial.
      expect(bearers).toEqual(['Bearer token-1a'])
      expect(refreshBearers).toEqual(['Bearer token-1a'])
      await act(async () => {
        old.release()
        await Promise.resolve()
      })

      expect(await screen.findByTestId('premium-manage-button')).toBeInTheDocument()
      await settle()
      expect(hint()).toBeNull()
      expect(refreshBearers).toEqual(['Bearer token-1a'])
      expect(bearers).toEqual(['Bearer token-1a', 'Bearer token-1b'])
    })
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

  it('SUBSCRIPTION-SESSION-WEB-12 waits for the verification, then reads once with the fresh token', async () => {
    let releaseOld!: () => void
    const old = new Promise<void>((resolve) => {
      releaseOld = resolve
    })
    useMswHandlers(
      http.get('/api/v1/commerce/subscription', async ({ request }) => {
        const bearer = request.headers.get('authorization')
        bearers.push(bearer)
        if (bearer === 'Bearer token-1a') {
          await old
          return HttpResponse.json(
            { statusCode: 401, message: 'Unauthorized', error: 'Unauthorized' },
            { status: 401 }
          )
        }
        return HttpResponse.json({ data: SUBSCRIPTION['Bearer token-1'] })
      }),
      // The recovered subscription is active, and the access source says so.
      http.get('/api/v1/commerce/premium/access', () =>
        HttpResponse.json({ data: { premium: true, source: 'subscription' } })
      )
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
    expect(hint()).toBeNull()
    expect(bearers).toEqual(['Bearer token-1a'])

    // The denial joined the bridge's verification while the old token is still installed.
    await waitFor(() => expect(session.verifiers.length).toBeGreaterThan(0))
    expect(window.sessionStorage.getItem(WEB_ACCESS_TOKEN_STORAGE_KEY)).toBe('token-1a')
    expect(hint()).toBeNull()
    expect(bearers).toEqual(['Bearer token-1a'])

    // As the bridge does: install and publish member-1's fresh token, then answer the
    // verification. Publication alone starts no read; the retry waits for the verification.
    publish({ identity: 'member-1', bearer: 'token-1b' })
    await settle()
    expect(bearers).toEqual(['Bearer token-1a'])
    expect(hint()).toBeNull()
    await finishVerification('token-1b')

    expect(await screen.findByTestId('premium-manage-button')).toBeInTheDocument()
    expect(hint()).toBeNull()
    await settle()
    expect(bearers).toEqual(['Bearer token-1a', 'Bearer token-1b'])
  })

  // Settings Codex review 2, finding 3: the access read rides beside the subscription read. A
  // denial of member-1's superseded token is read again, so a complimentary member whose
  // subscription is "none" is never offered a purchase.
  it.each(['after', 'before'])(
    'SUBSCRIPTION-SESSION-WEB-15 a complimentary member whose access read is denied %s the fresh token publishes keeps complimentary access',
    async (timing) => {
      const COMPLIMENTARY = 'You have complimentary Premium access from CoutureCast.'
      const NO_SUBSCRIPTION = "You don't have a Premium subscription yet."
      const accessBearers: (string | null)[] = []
      let releaseOld!: () => void
      const old = new Promise<void>((resolve) => {
        releaseOld = resolve
      })
      let releaseFresh!: () => void
      const fresh = new Promise<void>((resolve) => {
        releaseFresh = resolve
      })
      useMswHandlers(
        http.get('/api/v1/commerce/subscription', ({ request }) => {
          bearers.push(request.headers.get('authorization'))
          return HttpResponse.json({ data: NONE })
        }),
        http.get('/api/v1/commerce/premium/access', async ({ request }) => {
          const bearer = request.headers.get('authorization')
          accessBearers.push(bearer)
          if (bearer === 'Bearer token-1a') {
            await old
            return HttpResponse.json(
              { statusCode: 401, message: 'Unauthorized', error: 'Unauthorized' },
              { status: 401 }
            )
          }
          await fresh
          return HttpResponse.json({ data: { premium: true, source: 'complimentary' } })
        })
      )
      session.stored = true
      session.identity = 'member-1'
      window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, 'token-1a')
      renderSection()
      await waitFor(() => expect(accessBearers).toEqual(['Bearer token-1a']))
      await waitFor(() => expect(bearers).toEqual(['Bearer token-1a']))
      expect(session.verifiers).toHaveLength(0)

      const deny = async () => {
        await act(async () => {
          releaseOld()
          await Promise.resolve()
        })
        await settle()
      }
      if (timing === 'after') {
        publish({ identity: 'member-1', bearer: 'token-1b' })
        await settle()
        // The rotation alone sends nothing: any second access read answers the denial.
        expect(accessBearers).toEqual(['Bearer token-1a'])
        expect(bearers).toEqual(['Bearer token-1a'])
        await deny()
      } else {
        await deny()
        // The denial joined the bridge's verification while the old token is still installed.
        await waitFor(() => expect(session.verifiers.length).toBeGreaterThan(0))
        expect(window.sessionStorage.getItem(WEB_ACCESS_TOKEN_STORAGE_KEY)).toBe(
          'token-1a'
        )
        expect(accessBearers).toEqual(['Bearer token-1a'])
        // As the bridge does: install and publish the fresh token, then answer. Publication
        // alone starts no read; the retry waits for the verification it joined.
        publish({ identity: 'member-1', bearer: 'token-1b' })
        await settle()
        expect(accessBearers).toEqual(['Bearer token-1a'])
        await finishVerification('token-1b')
      }

      // While the fresh access read is out, nothing offers a purchase or says "no subscription".
      await waitFor(() =>
        expect(accessBearers).toEqual(['Bearer token-1a', 'Bearer token-1b'])
      )
      await settle()
      expect(subscribe()).toBeNull()
      expect(screen.queryByTestId('premium-subscribe-annual')).toBeNull()
      expect(document.body.textContent).not.toContain(NO_SUBSCRIPTION)

      act(() => releaseFresh())
      await waitFor(() =>
        expect(screen.getByTestId('premium-status-line')).toHaveTextContent(COMPLIMENTARY)
      )
      await settle()
      expect(screen.getByTestId('premium-status-line')).toHaveTextContent(COMPLIMENTARY)
      expect(subscribe()).toBeNull()
      expect(screen.queryByTestId('premium-subscribe-annual')).toBeNull()
      expect(hint()).toBeNull()
      expect(accessBearers).toEqual(['Bearer token-1a', 'Bearer token-1b'])
      expect(bearers).toEqual(['Bearer token-1a'])
    }
  )
})
