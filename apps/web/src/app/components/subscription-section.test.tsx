// Learning path Step 34: Premium subscription lifecycle.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-34-premium-subscription-lifecycle
// Learning path Step 35: Premium theme switcher.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-35-premium-theme-switcher
// Story 5.2 Task 7 owner: the web settings Premium section.
//
// These go through MSW rather than a mocked `lib/premium`, so the request
// shape, the bearer header, and the contract parsing are all exercised by the
// same tests that cover the UI states. The one mocked seam is
// `redirectToExternalUrl`: jsdom's `location` is unforgeable, and the redirect
// to Stripe-hosted pages is the external boundary under test.
import { I18nextProvider } from 'react-i18next'
import { http, HttpResponse } from 'msw'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getI18n } from '../../i18n'
import { WEB_ACCESS_TOKEN_STORAGE_KEY } from '../../lib/wardrobe'
import { redirectToExternalUrl } from '../../lib/premium'
import type * as PremiumModule from '../../lib/premium'
import { useMswHandlers } from '../../test-utils/msw/runtime'
import { SubscriptionSection } from './subscription-section'

vi.mock('../../lib/premium', async (importOriginal) => {
  const actual = await importOriginal<typeof PremiumModule>()
  return { ...actual, redirectToExternalUrl: vi.fn() }
})

const SUBSCRIPTION_PATH = '/api/v1/commerce/subscription'
const REFRESH_PATH = '/api/v1/commerce/subscription/refresh'
const CHECKOUT_PATH = '/api/v1/commerce/subscription/checkout-session'
const PORTAL_PATH = '/api/v1/commerce/subscription/portal-session'

type SubscriptionBody = Record<string, unknown>

const NONE_SUBSCRIPTION: SubscriptionBody = {
  status: 'none',
  store: null,
  productId: null,
  willRenew: null,
  currentPeriodEnd: null,
  syncedAt: null,
  purchasesEnabled: true,
}

function entitledSubscription(overrides: SubscriptionBody = {}): SubscriptionBody {
  return {
    status: 'active',
    store: 'stripe',
    productId: 'premium_monthly',
    willRenew: true,
    currentPeriodEnd: '2026-09-12T00:00:00.000Z',
    syncedAt: '2026-08-12T08:00:00.000Z',
    purchasesEnabled: true,
    ...overrides,
  }
}

function signIn() {
  window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, 'test-access-token')
}

function setPath(path: string) {
  window.history.replaceState(null, '', path)
}

function renderSection() {
  return render(
    <I18nextProvider i18n={getI18n()}>
      <SubscriptionSection />
    </I18nextProvider>
  )
}

const redirect = vi.mocked(redirectToExternalUrl)

beforeEach(() => {
  window.sessionStorage.clear()
  setPath('/settings')
})

afterEach(() => {
  vi.useRealTimers()
  window.sessionStorage.clear()
  setPath('/')
  delete window.__enableAnalyticsTestHook
  delete window.__capturedAnalyticsEvents
})

describe('SubscriptionSection', () => {
  it('5.2-WEB-SEC-01 renders signed out: disclosure, disabled controls, hint, no request', () => {
    const seen = vi.fn()
    useMswHandlers(
      http.get(SUBSCRIPTION_PATH, () => {
        seen()
        return HttpResponse.json({ data: NONE_SUBSCRIPTION })
      })
    )

    renderSection()

    const disclosure = screen.getByTestId('premium-disclosure')
    expect(disclosure).toHaveTextContent('RevenueCat')
    expect(disclosure).toHaveTextContent('Stripe')
    expect(disclosure).toHaveTextContent('never reach CoutureCast')

    const monthly = screen.getByTestId('premium-subscribe-monthly')
    expect(monthly).toBeDisabled()
    expect(monthly).toHaveAccessibleDescription(/Sign in to subscribe or manage Premium/)
    expect(screen.getByTestId('premium-subscribe-annual')).toBeDisabled()
    expect(screen.getByTestId('premium-signed-out-hint')).toBeInTheDocument()
    expect(seen).not.toHaveBeenCalled()
  })

  it('5.2-WEB-SEC-02 loads a never-subscribed account with a bearer token', async () => {
    signIn()
    const authorization = vi.fn<(value: string | null) => void>()
    useMswHandlers(
      http.get(SUBSCRIPTION_PATH, ({ request }) => {
        authorization(request.headers.get('authorization'))
        return HttpResponse.json({ data: NONE_SUBSCRIPTION })
      })
    )

    renderSection()

    await waitFor(() =>
      expect(screen.getByTestId('premium-status-line')).toHaveTextContent(
        /You don.t have a Premium subscription yet\./
      )
    )
    expect(authorization).toHaveBeenCalledWith('Bearer test-access-token')
    expect(screen.getByTestId('premium-subscribe-monthly')).toBeEnabled()
    expect(screen.getByTestId('premium-subscribe-annual')).toBeEnabled()
    expect(screen.queryByTestId('premium-signed-out-hint')).not.toBeInTheDocument()
  })

  /** AC 5: `purchasesEnabled` is the only kill-switch signal clients read. */
  it('5.2-WEB-SEC-03 renders no subscribe control while purchasing is disabled', async () => {
    signIn()
    useMswHandlers(
      http.get(SUBSCRIPTION_PATH, () =>
        HttpResponse.json({ data: { ...NONE_SUBSCRIPTION, purchasesEnabled: false } })
      )
    )

    renderSection()

    await waitFor(() =>
      expect(screen.getByTestId('premium-status-line')).toBeInTheDocument()
    )
    expect(screen.queryByTestId('premium-subscribe-monthly')).not.toBeInTheDocument()
    expect(screen.queryByTestId('premium-subscribe-annual')).not.toBeInTheDocument()
  })

  it('5.2-WEB-SEC-04 shows plan, period end, and the portal manage entry for web-managed Premium', async () => {
    signIn()
    useMswHandlers(
      http.get(SUBSCRIPTION_PATH, () =>
        HttpResponse.json({ data: entitledSubscription() })
      ),
      http.post(PORTAL_PATH, () =>
        HttpResponse.json({ data: { url: 'https://portal.stripe.test/session' } })
      )
    )

    renderSection()

    const statusLine = await screen.findByTestId('premium-status-line')
    expect(statusLine).toHaveTextContent('Premium is active: Premium Monthly.')
    expect(screen.queryByTestId('premium-subscribe-monthly')).not.toBeInTheDocument()

    fireEvent.click(screen.getByTestId('premium-manage-button'))
    await waitFor(() =>
      expect(redirect).toHaveBeenCalledWith('https://portal.stripe.test/session')
    )
  })

  it('5.2-WEB-SEC-05 shows the store hint instead of the portal for store-managed Premium', async () => {
    signIn()
    const portalCalled = vi.fn()
    useMswHandlers(
      http.get(SUBSCRIPTION_PATH, () =>
        HttpResponse.json({ data: entitledSubscription({ store: 'app_store' }) })
      ),
      http.post(PORTAL_PATH, () => {
        portalCalled()
        return HttpResponse.json({ data: { url: 'https://portal.stripe.test/session' } })
      })
    )

    renderSection()

    const hint = await screen.findByTestId('premium-manage-in-store')
    expect(hint).toHaveTextContent('App Store or Play Store')
    expect(screen.queryByTestId('premium-manage-button')).not.toBeInTheDocument()
    expect(portalCalled).not.toHaveBeenCalled()
  })

  /** Grace period keeps access and shows the payment-issue banner. */
  it('5.2-WEB-SEC-06 renders the grace banner with the manage entry still available', async () => {
    signIn()
    useMswHandlers(
      http.get(SUBSCRIPTION_PATH, () =>
        HttpResponse.json({ data: entitledSubscription({ status: 'grace_period' }) })
      )
    )

    renderSection()

    await screen.findByTestId('premium-grace-banner')
    expect(screen.getByTestId('premium-manage-button')).toBeInTheDocument()
    expect(screen.queryByTestId('premium-subscribe-monthly')).not.toBeInTheDocument()
  })

  it('5.2-WEB-SEC-07 offers resubscription after an ended subscription', async () => {
    signIn()
    useMswHandlers(
      http.get(SUBSCRIPTION_PATH, () =>
        HttpResponse.json({
          data: entitledSubscription({ status: 'expired', willRenew: false }),
        })
      )
    )

    renderSection()

    await screen.findByTestId('premium-ended-note')
    expect(screen.getByTestId('premium-status-line')).toHaveTextContent(
      'Your Premium subscription has expired.'
    )
    expect(screen.getByTestId('premium-subscribe-monthly')).toBeEnabled()
  })

  it('5.2-WEB-SEC-08 subscribe fires the tap event, creates the session, and redirects', async () => {
    signIn()
    window.__enableAnalyticsTestHook = true
    const bodies: unknown[] = []
    useMswHandlers(
      http.get(SUBSCRIPTION_PATH, () => HttpResponse.json({ data: NONE_SUBSCRIPTION })),
      http.post(CHECKOUT_PATH, async ({ request }) => {
        bodies.push(await request.clone().json())
        return HttpResponse.json(
          { data: { url: 'https://checkout.stripe.test/session' } },
          { status: 201 }
        )
      })
    )

    renderSection()
    await screen.findByTestId('premium-subscribe-annual')

    fireEvent.click(screen.getByTestId('premium-subscribe-annual'))

    await waitFor(() =>
      expect(redirect).toHaveBeenCalledWith('https://checkout.stripe.test/session')
    )
    expect(bodies).toEqual([{ plan: 'premium_annual' }])
    expect(window.__capturedAnalyticsEvents).toEqual([
      {
        event: 'premium_subscribe_tapped',
        properties: { plan: 'premium_annual', surface: 'web_settings' },
      },
    ])
  })

  /**
   * The kill switch reaches the reader as localized copy, not as the server's
   * `COMMERCE_SUBSCRIPTION_DISABLED_MESSAGE`. That constant is untranslated English,
   * so rendering it verbatim showed English to the nine non-`en` catalogs on the one
   * path `commerce.premium.errorSubscribeDisabled` exists for. The response below
   * still carries a perfectly readable message and it is deliberately not what the
   * alert says.
   */
  it('5.2-WEB-SEC-09 renders localized copy, not the server text, when checkout is disabled', async () => {
    signIn()
    useMswHandlers(
      http.get(SUBSCRIPTION_PATH, () => HttpResponse.json({ data: NONE_SUBSCRIPTION })),
      http.post(CHECKOUT_PATH, () =>
        HttpResponse.json(
          {
            statusCode: 503,
            message: 'Premium subscriptions are temporarily unavailable.',
            error: 'Service Unavailable',
          },
          { status: 503 }
        )
      )
    )

    renderSection()
    await screen.findByTestId('premium-subscribe-monthly')

    fireEvent.click(screen.getByTestId('premium-subscribe-monthly'))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('New Premium subscriptions are paused right now.')
    expect(alert).not.toHaveTextContent(
      'Premium subscriptions are temporarily unavailable.'
    )
    expect(redirect).not.toHaveBeenCalled()
  })

  /**
   * The two 409s are the reason the status map is per-operation rather than global:
   * the same status means "you already have one" on checkout and "manage it in the
   * store" on the portal, and collapsing either into the generic `errorPurchase`
   * leaves the reader with no next step. The store-managed case reuses
   * `commerce.premium.manageInStore`, the sentence the catalogs already carry for it.
   */
  it('5.2-WEB-SEC-22 tells an already-subscribed reader so, rather than "try again"', async () => {
    signIn()
    useMswHandlers(
      http.get(SUBSCRIPTION_PATH, () => HttpResponse.json({ data: NONE_SUBSCRIPTION })),
      http.post(CHECKOUT_PATH, () =>
        HttpResponse.json(
          {
            statusCode: 409,
            message: 'This account already has an active Premium subscription.',
            error: 'Conflict',
          },
          { status: 409 }
        )
      )
    )

    renderSection()
    await screen.findByTestId('premium-subscribe-monthly')
    fireEvent.click(screen.getByTestId('premium-subscribe-monthly'))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('You already have an active Premium subscription.')
    expect(alert).not.toHaveTextContent('Unable to start checkout')
    expect(redirect).not.toHaveBeenCalled()
  })

  /**
   * The portal's half of the same 409. `manageInStore` was already translated in all
   * ten catalogs and rendered nowhere on this path, so the store-managed reader used
   * to get "Unable to start checkout. Please try again." — wrong instruction and no
   * next step, for the one failure with a completely clear answer.
   */
  it('5.2-WEB-SEC-24 points a store-managed reader at the store, not at checkout', async () => {
    signIn()
    useMswHandlers(
      http.get(SUBSCRIPTION_PATH, () =>
        HttpResponse.json({ data: entitledSubscription() })
      ),
      http.post(PORTAL_PATH, () =>
        HttpResponse.json(
          {
            statusCode: 409,
            message:
              'This subscription is managed in the app store it was purchased from.',
            error: 'Conflict',
          },
          { status: 409 }
        )
      )
    )

    renderSection()
    fireEvent.click(await screen.findByTestId('premium-manage-button'))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('App Store or Play Store')
    expect(alert).not.toHaveTextContent('Unable to start checkout')
    expect(redirect).not.toHaveBeenCalled()
  })

  it('5.2-WEB-SEC-25 says there is nothing to manage when no web subscription exists', async () => {
    signIn()
    useMswHandlers(
      http.get(SUBSCRIPTION_PATH, () =>
        HttpResponse.json({ data: entitledSubscription() })
      ),
      http.post(PORTAL_PATH, () =>
        HttpResponse.json(
          {
            statusCode: 404,
            message: 'No web subscription found for this account.',
            error: 'Not Found',
          },
          { status: 404 }
        )
      )
    )

    renderSection()
    fireEvent.click(await screen.findByTestId('premium-manage-button'))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('no web subscription on this account')
    expect(redirect).not.toHaveBeenCalled()
  })

  /**
   * Same rule on the read path. The 500 below carries its own English sentence and
   * the alert shows `commerce.premium.errorLoad` instead.
   */
  it('5.2-WEB-SEC-10 alerts and keeps controls disabled when the status read fails', async () => {
    signIn()
    useMswHandlers(
      http.get(SUBSCRIPTION_PATH, () =>
        HttpResponse.json(
          {
            statusCode: 500,
            message: 'Unable to reach subscriptions.',
            error: 'Internal Server Error',
          },
          { status: 500 }
        )
      )
    )

    renderSection()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Unable to load subscription status.')
    expect(alert).not.toHaveTextContent('Unable to reach subscriptions.')
    expect(screen.queryByTestId('premium-subscribe-monthly')).not.toBeInTheDocument()
    expect(screen.queryByTestId('premium-status-line')).not.toBeInTheDocument()
  })

  /**
   * A 401 mid-session is a state change, not an error string. Without this the write
   * surfaced PREMIUM_SIGNED_OUT_MESSAGE, a developer string with no catalog entry, so
   * English in all ten locales.
   */
  it('5.2-WEB-SEC-23 returns to the signed-out branch when the session ends mid-read', async () => {
    signIn()
    useMswHandlers(
      http.get(SUBSCRIPTION_PATH, () =>
        HttpResponse.json({ statusCode: 401, message: 'Unauthorized' }, { status: 401 })
      )
    )

    renderSection()

    const hint = await screen.findByTestId('premium-signed-out-hint')
    expect(hint).toHaveTextContent('Sign in to subscribe or manage Premium')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByText(/Sign in to manage Premium/)).not.toBeInTheDocument()
  })

  it('5.2-WEB-SEC-11 checkout=cancelled returns quietly to the idle status', async () => {
    signIn()
    setPath('/settings?checkout=cancelled')
    useMswHandlers(
      http.get(SUBSCRIPTION_PATH, () => HttpResponse.json({ data: NONE_SUBSCRIPTION }))
    )

    renderSection()

    await screen.findByTestId('premium-status-line')
    expect(screen.getByTestId('premium-status-region')).toHaveTextContent('')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  /**
   * 5.2-WEB-001 (test plan): the post-checkout poll. 5-second interval,
   * 2-minute cap, `role="status"` activating line while polling, and a
   * mid-poll `none` renders as "activating", never as a failed or unstarted
   * purchase.
   */
  it('5.2-WEB-001 polls after checkout success until the entitlement lands', async () => {
    vi.useFakeTimers()
    signIn()
    setPath('/settings?checkout=success')

    let statusCalls = 0
    const refreshCalls = vi.fn()
    useMswHandlers(
      http.post(REFRESH_PATH, () => {
        refreshCalls()
        return HttpResponse.json({ data: NONE_SUBSCRIPTION })
      }),
      http.get(SUBSCRIPTION_PATH, () => {
        statusCalls += 1
        return HttpResponse.json({
          data: statusCalls < 2 ? NONE_SUBSCRIPTION : entitledSubscription(),
        })
      })
    )

    renderSection()

    // The poll opens with one refresh (beats webhook latency).
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(refreshCalls).toHaveBeenCalledTimes(1)

    // Mid-poll `none` is "activating", never a failure or a subscribe prompt.
    const statusRegion = screen.getByTestId('premium-status-region')
    expect(statusRegion).toHaveAttribute('role', 'status')
    expect(statusRegion).toHaveTextContent(
      'Payment received. Activating your Premium subscription…'
    )
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByTestId('premium-subscribe-monthly')).not.toBeInTheDocument()
    expect(screen.queryByTestId('premium-ended-note')).not.toBeInTheDocument()

    // Tick 2 at +5s still returns `none`; the poll keeps going.
    await act(() => vi.advanceTimersByTimeAsync(5_000))
    expect(statusCalls).toBe(1)
    expect(statusRegion).toHaveTextContent('Activating')

    // Tick 3 at +10s lands the entitlement: the poll stops and status renders.
    await act(() => vi.advanceTimersByTimeAsync(5_000))
    expect(statusCalls).toBe(2)
    expect(statusRegion).toHaveTextContent('')
    expect(screen.getByTestId('premium-status-line')).toHaveTextContent(
      'Premium is active: Premium Monthly.'
    )
    expect(screen.getByTestId('premium-manage-button')).toBeInTheDocument()

    // The poll is over: more time must not produce more requests.
    await act(() => vi.advanceTimersByTimeAsync(30_000))
    expect(statusCalls).toBe(2)
    expect(refreshCalls).toHaveBeenCalledTimes(1)
  })

  it('5.2-WEB-001b caps the poll at 2 minutes with a terminal still-processing state', async () => {
    vi.useFakeTimers()
    signIn()
    setPath('/settings?checkout=success')

    let requests = 0
    useMswHandlers(
      http.post(REFRESH_PATH, () => {
        requests += 1
        return HttpResponse.json({ data: NONE_SUBSCRIPTION })
      }),
      http.get(SUBSCRIPTION_PATH, () => {
        requests += 1
        return HttpResponse.json({ data: NONE_SUBSCRIPTION })
      })
    )

    renderSection()
    await act(() => vi.advanceTimersByTimeAsync(0))

    // 23 scheduled ticks after the opening refresh = 24 attempts, inside 2:00.
    for (let tick = 0; tick < 23; tick += 1) {
      await act(() => vi.advanceTimersByTimeAsync(5_000))
    }

    expect(requests).toBe(24)
    expect(screen.getByTestId('premium-status-region')).toHaveTextContent(
      'Still processing. Your payment went through; check back shortly.'
    )
    // Terminal, not spinning: no further requests, and still no failure UI.
    await act(() => vi.advanceTimersByTimeAsync(60_000))
    expect(requests).toBe(24)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByTestId('premium-subscribe-monthly')).not.toBeInTheDocument()
  })

  it('5.2-WEB-SEC-12 portal return fires exactly one refresh and shows the lag copy', async () => {
    signIn()
    setPath('/settings?portal=return')

    const refreshCalls = vi.fn()
    useMswHandlers(
      http.post(REFRESH_PATH, () => {
        refreshCalls()
        return HttpResponse.json({
          data: entitledSubscription({ willRenew: false }),
        })
      })
    )

    renderSection()

    const hint = await screen.findByTestId('premium-portal-lag-hint')
    expect(hint).toHaveTextContent('can take a couple of hours')
    await screen.findByTestId('premium-status-line')
    expect(refreshCalls).toHaveBeenCalledTimes(1)
  })

  /** A ledger outage on portal return still shows the honest local mirror. */
  it('5.2-WEB-SEC-13 falls back to the plain read when the portal-return refresh fails', async () => {
    signIn()
    setPath('/settings?portal=return')
    useMswHandlers(
      http.post(REFRESH_PATH, () =>
        HttpResponse.json(
          {
            statusCode: 503,
            message: 'Subscription status is temporarily unavailable.',
            error: 'Service Unavailable',
          },
          { status: 503 }
        )
      ),
      http.get(SUBSCRIPTION_PATH, () =>
        HttpResponse.json({ data: entitledSubscription() })
      )
    )

    renderSection()

    await screen.findByTestId('premium-status-line')
    expect(screen.getByTestId('premium-portal-lag-hint')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
