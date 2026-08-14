// Story 5.2 Task 7 owner: the "Premium" section of Web settings.
//
// The second child section on `/settings`, after `CommercePreferencesSection`,
// following its state shape deliberately. Purchasing and lifecycle UI are
// Stripe-hosted (Checkout for purchase, Customer Portal for cancel and plan
// switches); this section's job is status, hand-off, and honest interim states:
//
// - `?checkout=success` runs a bounded activation poll (5-second interval,
//   2-minute cap) because a refresh can legitimately return `none` before the
//   Stripe → RevenueCat forward completes. A mid-poll `none` renders as
//   "activating", never as a failure, and the cap lands on a terminal "still
//   processing" state instead of spinning forever.
// - `?portal=return` fires exactly one refresh and shows lag copy: RevenueCat
//   documents Stripe-sourced cancellations taking up to ~2 hours to sync, so
//   the state is lagging, not wrong, and the copy says so.
'use client'

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import type { Subscription, SubscriptionPlan } from '@couture/api-client/contracts/http'
import { trackPremiumSubscribeTapped } from '@couture/api-client'
import { browserAnalytics } from '../../analytics/browser-analytics'
import {
  createCheckoutSessionFromWeb,
  createPortalSessionFromWeb,
  getSubscriptionFromWeb,
  hasWebSession,
  premiumErrorMessage,
  redirectToExternalUrl,
  refreshSubscriptionFromWeb,
} from '../../lib/premium'

const SIGNED_OUT_HINT_ID = 'premium-signed-out-hint'

/** The bounded activation poll: 24 ticks x 5 seconds = the AC's 2-minute cap. */
const ACTIVATION_POLL_INTERVAL_MS = 5_000
const ACTIVATION_POLL_MAX_ATTEMPTS = 24

/**
 * `checking` is the server render and the first client tick, before
 * `sessionStorage` can be read, so hydration never reconciles two trees.
 */
type SectionState = 'checking' | 'signed_out' | 'loading' | 'ready' | 'load_failed'

/**
 * `activating` while the post-checkout poll runs; `still_processing` is its
 * terminal cap state. Both suppress the per-status body so a not-yet-synced
 * `none` can never render as a failed or unstarted purchase.
 */
type ActivationState = 'idle' | 'activating' | 'still_processing'

function entitles(subscription: Subscription | null): boolean {
  return subscription?.status === 'active' || subscription?.status === 'grace_period'
}

function planLabelFor(t: TFunction, productId: string | null): string {
  if (productId === 'premium_monthly') return t('commerce.premium.planMonthly')
  if (productId === 'premium_annual') return t('commerce.premium.planAnnual')
  return productId ?? ''
}

function statusLineFor(t: TFunction, subscription: Subscription | null): string {
  if (!subscription || subscription.status === 'none') {
    return t('commerce.premium.status.none')
  }
  switch (subscription.status) {
    case 'active':
      return t('commerce.premium.status.active', {
        plan: planLabelFor(t, subscription.productId),
        date: new Date(subscription.currentPeriodEnd).toLocaleDateString(),
      })
    case 'grace_period':
      return t('commerce.premium.status.gracePeriod')
    case 'expired':
      return t('commerce.premium.status.expired')
    default:
      return t('commerce.premium.status.revoked')
  }
}

/** Grace banner and ended note: the per-status side copy of a ready section. */
function SubscriptionStatusNotes({ subscription }: { subscription: Subscription }) {
  const { t } = useTranslation()
  if (subscription.status === 'grace_period') {
    return (
      <p
        className="mt-2 rounded-md border border-amber-500/60 bg-amber-950/40 p-3 text-sm text-amber-200"
        data-testid="premium-grace-banner"
      >
        {t('commerce.premium.graceBanner')}
      </p>
    )
  }
  if (subscription.status === 'expired' || subscription.status === 'revoked') {
    return (
      <p className="mt-2 text-sm text-neutral-300" data-testid="premium-ended-note">
        {t('commerce.premium.endedNote')}
      </p>
    )
  }
  return null
}

function SubscribeControls({
  isSignedOut,
  isRedirecting,
  onSubscribe,
}: {
  isSignedOut: boolean
  isRedirecting: boolean
  onSubscribe: (plan: SubscriptionPlan) => void
}) {
  const { t } = useTranslation()
  const plans: { plan: SubscriptionPlan; label: string; testId: string }[] = [
    {
      plan: 'premium_monthly',
      label: t('commerce.premium.planMonthly'),
      testId: 'premium-subscribe-monthly',
    },
    {
      plan: 'premium_annual',
      label: t('commerce.premium.planAnnual'),
      testId: 'premium-subscribe-annual',
    },
  ]

  return (
    <div className="mt-6 flex flex-wrap items-center gap-3">
      {plans.map(({ plan, label, testId }) => (
        <button
          key={plan}
          type="button"
          disabled={isSignedOut}
          aria-busy={isRedirecting}
          aria-describedby={isSignedOut ? SIGNED_OUT_HINT_ID : undefined}
          onClick={() => onSubscribe(plan)}
          className="rounded-lg bg-[#c9a14a] px-4 py-2 text-sm font-semibold text-neutral-950 hover:bg-[#b58e3c] disabled:opacity-60"
          data-testid={testId}
        >
          {t('commerce.premium.subscribe')}: {label}
        </button>
      ))}
    </div>
  )
}

/**
 * The manage entry for an entitled subscription: the Customer Portal when the
 * subscription is web-managed, otherwise the store hint — the server would
 * answer that call with a 409, so the client does not make it.
 */
function ManageControls({
  store,
  isRedirecting,
  onManage,
}: {
  store: string
  isRedirecting: boolean
  onManage: () => void
}) {
  const { t } = useTranslation()
  if (store !== 'stripe') {
    return (
      <p className="mt-6 text-sm text-neutral-300" data-testid="premium-manage-in-store">
        {t('commerce.premium.manageInStore')}
      </p>
    )
  }
  return (
    <button
      type="button"
      aria-busy={isRedirecting}
      onClick={onManage}
      className="mt-6 rounded-lg border border-neutral-600 px-4 py-2 text-sm font-semibold text-white hover:border-neutral-400"
      data-testid="premium-manage-button"
    >
      {t('commerce.premium.manage')}
    </button>
  )
}

interface SectionView {
  showStatusLine: boolean
  /** Non-null exactly when the grace/ended side copy should render. */
  notesSubscription: Subscription | null
  showSubscribeControls: boolean
  /** Non-null exactly when the manage entry should render. */
  manageStore: Subscription['store']
}

/**
 * What the body renders, in one place. The kill switch reaches this section
 * only as the server-evaluated `purchasesEnabled` on the status response
 * (AC 5): with it false, or with no response yet, no subscribe control
 * renders. The signed-out state is the exception — there is no server data,
 * so it renders the disabled controls with the sign-in hint, exactly like the
 * commerce section's toggle. A non-idle activation state suppresses the whole
 * per-status body so a not-yet-synced `none` can never look like a failure.
 */
function resolveSectionView(
  sectionState: SectionState,
  activationState: ActivationState,
  subscription: Subscription | null
): SectionView {
  const isIdle = activationState === 'idle'
  const isReadyBody = isIdle && sectionState === 'ready' && subscription !== null
  const entitled = entitles(subscription)

  return {
    showStatusLine: isIdle && sectionState !== 'load_failed',
    notesSubscription: isReadyBody ? subscription : null,
    showSubscribeControls:
      (isIdle && sectionState === 'signed_out') ||
      (isReadyBody && !entitled && subscription.purchasesEnabled),
    manageStore: isReadyBody && entitled ? subscription.store : null,
  }
}

export function SubscriptionSection() {
  const { t } = useTranslation()
  const [sectionState, setSectionState] = useState<SectionState>('checking')
  const [subscription, setSubscription] = useState<Subscription | null>(null)
  const [activationState, setActivationState] = useState<ActivationState>('idle')
  const [showPortalLagHint, setShowPortalLagHint] = useState(false)
  const [isRedirecting, setIsRedirecting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /*
   * Resolved outside the effect and depended on by value, mirroring
   * `CommercePreferencesSection`: depending on `t` itself would tie the effect
   * to a function identity and risk a request loop.
   */
  const loadErrorMessage = t('commerce.premium.errorLoad')

  useEffect(() => {
    if (!hasWebSession()) {
      setSectionState('signed_out')
      return
    }

    const params = new URLSearchParams(window.location.search)
    const controller = new AbortController()
    let timer: number | undefined

    if (params.get('checkout') === 'success') {
      /*
       * The poll starts with a refresh (beats webhook latency), then reads
       * status. A failed tick is treated as transient and the poll simply
       * continues: the payment already happened, so bailing out to an error
       * state would contradict what the user just saw Stripe confirm.
       */
      setSectionState('ready')
      setActivationState('activating')
      let attempts = 0

      const tick = async (viaRefresh: boolean): Promise<void> => {
        try {
          const next = viaRefresh
            ? await refreshSubscriptionFromWeb(controller.signal)
            : await getSubscriptionFromWeb(controller.signal)
          if (controller.signal.aborted) {
            return
          }
          setSubscription(next)
          if (next.status === 'active' || next.status === 'grace_period') {
            setActivationState('idle')
            return
          }
        } catch {
          if (controller.signal.aborted) {
            return
          }
        }
        attempts += 1
        if (attempts >= ACTIVATION_POLL_MAX_ATTEMPTS) {
          setActivationState('still_processing')
          return
        }
        timer = window.setTimeout(() => {
          void tick(false)
        }, ACTIVATION_POLL_INTERVAL_MS)
      }

      void tick(true)
      return () => {
        controller.abort()
        if (timer !== undefined) {
          window.clearTimeout(timer)
        }
      }
    }

    const isPortalReturn = params.get('portal') === 'return'
    setSectionState('loading')
    setShowPortalLagHint(isPortalReturn)

    void (async () => {
      try {
        /*
         * Portal return fires exactly ONE refresh (no poll — the state is
         * lagging, not wrong). If the ledger is unreachable the local mirror
         * is still an honest answer, so fall back to the plain read before
         * declaring the load failed.
         */
        const next = isPortalReturn
          ? await refreshSubscriptionFromWeb(controller.signal).catch(() =>
              getSubscriptionFromWeb(controller.signal)
            )
          : await getSubscriptionFromWeb(controller.signal)
        if (controller.signal.aborted) {
          return
        }
        setSubscription(next)
        setSectionState('ready')
      } catch (loadError: unknown) {
        if (controller.signal.aborted) {
          return
        }
        setError(premiumErrorMessage(loadError, loadErrorMessage))
        setSectionState('load_failed')
      }
    })()

    return () => controller.abort()
  }, [loadErrorMessage])

  async function handleSubscribe(plan: SubscriptionPlan): Promise<void> {
    if (isRedirecting) {
      return
    }
    setIsRedirecting(true)
    setError(null)

    // Client-side directional volume only (disjoint from the server funnel);
    // fail-open so a degraded analytics stack can never block a purchase.
    try {
      const payload = trackPremiumSubscribeTapped(
        { plan, surface: 'web_settings' },
        browserAnalytics.getDistinctId() || 'web-anonymous-user'
      )
      browserAnalytics.capture(payload.event, payload.properties)
    } catch {
      // Analytics must never stop checkout.
    }

    try {
      const url = await createCheckoutSessionFromWeb(plan)
      redirectToExternalUrl(url)
    } catch (checkoutError: unknown) {
      setError(premiumErrorMessage(checkoutError, t('commerce.premium.errorPurchase')))
      setIsRedirecting(false)
    }
  }

  async function handleManage(): Promise<void> {
    if (isRedirecting) {
      return
    }
    setIsRedirecting(true)
    setError(null)
    try {
      const url = await createPortalSessionFromWeb()
      redirectToExternalUrl(url)
    } catch (portalError: unknown) {
      setError(premiumErrorMessage(portalError, t('commerce.premium.errorPurchase')))
      setIsRedirecting(false)
    }
  }

  const isSignedOut = sectionState === 'signed_out'
  const view = resolveSectionView(sectionState, activationState, subscription)

  return (
    <section
      aria-labelledby="premium-subscription-title"
      data-testid="premium-subscription-section"
      className="mt-10 max-w-2xl border-t border-neutral-800 pt-8"
    >
      <h2
        id="premium-subscription-title"
        className="text-xl font-semibold text-white"
        data-testid="premium-subscription-title"
      >
        {t('commerce.premium.sectionTitle')}
      </h2>

      {/*
        AC 7: the processor disclosure names RevenueCat and Stripe and what is
        shared. A sibling text node in reading order before the controls, never
        a tooltip and never only an accessible name.
      */}
      <p
        className="mt-3 text-sm leading-relaxed text-neutral-200"
        data-testid="premium-disclosure"
      >
        {t('commerce.premium.disclosure')}
      </p>

      {view.showStatusLine && (
        <p className="mt-6 text-base text-white" data-testid="premium-status-line">
          {statusLineFor(t, subscription)}
        </p>
      )}

      {view.notesSubscription && (
        <SubscriptionStatusNotes subscription={view.notesSubscription} />
      )}

      {view.showSubscribeControls && (
        <SubscribeControls
          isSignedOut={isSignedOut}
          isRedirecting={isRedirecting}
          onSubscribe={(plan) => {
            void handleSubscribe(plan)
          }}
        />
      )}

      {view.manageStore !== null && (
        <ManageControls
          store={view.manageStore}
          isRedirecting={isRedirecting}
          onManage={() => {
            void handleManage()
          }}
        />
      )}

      {isSignedOut && (
        <p
          id={SIGNED_OUT_HINT_ID}
          className="mt-2 text-sm text-neutral-300"
          data-testid="premium-signed-out-hint"
        >
          {t('commerce.premium.signedOutHint')}
        </p>
      )}

      {showPortalLagHint && (
        <p
          className="mt-4 text-sm text-neutral-300"
          data-testid="premium-portal-lag-hint"
        >
          {t('commerce.premium.portalLagHint')}
        </p>
      )}

      {/*
        Mounted unconditionally so assistive technology is already observing
        the region when the activation copy arrives; a live region added at the
        same moment as its text is routinely missed.
      */}
      <p
        role="status"
        className="mt-4 min-h-[1.25rem] text-sm text-emerald-300"
        data-testid="premium-status-region"
      >
        {activationState === 'activating' && t('commerce.premium.activating')}
        {activationState === 'still_processing' && t('commerce.premium.stillProcessing')}
      </p>

      {error && (
        <p role="alert" className="mt-1 text-sm text-red-300" data-testid="premium-error">
          {error}
        </p>
      )}
    </section>
  )
}
