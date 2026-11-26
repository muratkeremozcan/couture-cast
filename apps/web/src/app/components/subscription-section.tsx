// Story 5.2 Task 7 owner: the "Premium" section of Web settings.
// Story 5.2 Task 7 step 1 owner: own the web subscription surface in `apps/web/src/app/components/subscription-section.tsx`
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
//
// The section follows the session (`MemberScope`): while a stored session is still being
// verified it stays `checking`, and it reads once per member. A one-shot check on mount once told
// a signed-in member to sign in on every direct load of /settings (owner, 2026-11-19).
'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import {
  subscriptionManageEntry,
  type EntitlementStore,
  type PremiumAccess,
  type Subscription,
  type SubscriptionPlan,
} from '@couture/api-client/contracts/http'
import { trackPremiumSubscribeTapped } from '@couture/api-client'
import { browserAnalytics } from '../../analytics/browser-analytics'
import {
  createCheckoutSessionFromWeb,
  createPortalSessionFromWeb,
  getPremiumAccessFromWeb,
  getSubscriptionFromWeb,
  premiumFailureReason,
  type PremiumFailureReason,
  redirectToExternalUrl,
  refreshSubscriptionFromWeb,
} from '../../lib/premium'
import {
  isLiveOwner,
  MemberScope,
  readAsMember,
  useMountSignal,
  useWebSessionOwner,
  type MemberSession,
} from '../../lib/use-web-session'
import { SessionRetryButton } from './session-retry-button'
import {
  GuestText,
  useGuestFirstPaint,
  useScreenGateRead,
  useSectionSnapshot,
} from './screen-gate'

const SIGNED_OUT_HINT_ID = 'premium-signed-out-hint'

/** The bounded activation poll: 24 ticks x 5 seconds = the AC's 2-minute cap. */
const ACTIVATION_POLL_INTERVAL_MS = 5_000
const ACTIVATION_POLL_MAX_ATTEMPTS = 24

/** Story 6.14: how long the section waits for the premium access source before ignoring it. */
const ACCESS_READ_TIMEOUT_MS = 5_000

/**
 * `checking` is the server render, the first client tick, and every moment a
 * stored session is still being verified, so hydration never reconciles two
 * trees and a signed-in member never sees the sign-in hint.
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

function statusLineFor(
  t: TFunction,
  subscription: Subscription | null,
  complimentary: boolean
): string {
  // Story 6.14 D6: an unpaid complimentary member reads the grant as their status.
  if (complimentary && !entitles(subscription)) {
    return t('commerce.premium.status.complimentary')
  }
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
        className="mt-2 rounded-md border border-notice-line bg-notice-surface p-3 text-sm text-notice-ink"
        data-testid="premium-grace-banner"
      >
        {t('commerce.premium.graceBanner')}
      </p>
    )
  }
  if (subscription.status === 'expired' || subscription.status === 'revoked') {
    return (
      <p className="mt-2 text-sm text-ink-soft" data-testid="premium-ended-note">
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
  landing,
}: {
  isSignedOut: boolean
  isRedirecting: boolean
  onSubscribe: (plan: SubscriptionPlan) => void
  /** `guest` while a signed-out first paint stands in for the session check (CC-7.7). */
  landing?: 'guest'
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
    <div data-landing={landing} className="mt-6 flex flex-wrap items-center gap-3">
      {plans.map(({ plan, label, testId }) => (
        <button
          key={plan}
          type="button"
          disabled={isSignedOut}
          aria-busy={isRedirecting}
          aria-describedby={isSignedOut ? SIGNED_OUT_HINT_ID : undefined}
          onClick={() => onSubscribe(plan)}
          className="rounded-lg border border-line-strong bg-page px-4 py-2 text-sm font-semibold text-ink hover:bg-card disabled:opacity-60"
          data-testid={testId}
        >
          {t('commerce.premium.subscribe')}: {label}
        </button>
      ))}
    </div>
  )
}

function ManageControls({
  store,
  isRedirecting,
  onManage,
}: {
  store: EntitlementStore
  isRedirecting: boolean
  onManage: () => void
}) {
  const { t } = useTranslation()
  const entry = subscriptionManageEntry(store)
  if (entry === 'none') return null
  if (entry === 'store') {
    return (
      <p className="mt-6 text-sm text-ink-soft" data-testid="premium-manage-in-store">
        {t('commerce.premium.manageInStore')}
      </p>
    )
  }
  return (
    <button
      type="button"
      aria-busy={isRedirecting}
      onClick={onManage}
      className="mt-6 rounded-lg border border-line-strong px-4 py-2 text-sm font-semibold text-ink hover:border-inverse"
      data-testid="premium-manage-button"
    >
      {t('commerce.premium.manage')}
    </button>
  )
}

interface SectionView {
  /**
   * Story 6.14: the processor disclosure, withheld from an unpaid complimentary member, who
   * shares nothing with RevenueCat or Stripe and is offered nothing to buy. It waits for the
   * reads, so a grantee never sees it appear and vanish.
   */
  showDisclosure: boolean
  showStatusLine: boolean
  /** A paying member who also holds a complimentary grant. */
  showComplimentaryNote: boolean
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
/**
 * Story 6.14: the processor disclosure waits for the reads, so a grantee never sees it appear
 * and vanish, and is withheld from an unpaid complimentary member, who shares nothing with
 * RevenueCat or Stripe and is offered nothing to buy.
 */
function showsDisclosure(
  sectionState: SectionState,
  entitled: boolean,
  complimentary: boolean
): boolean {
  if (sectionState === 'checking' || sectionState === 'loading') return false
  return entitled || !complimentary
}

/** Story 6.14 D6, TEA-07: a complimentary member is never offered a purchase. */
function offersPurchase(
  subscription: Subscription,
  entitled: boolean,
  complimentary: boolean
): boolean {
  return !entitled && !complimentary && subscription.purchasesEnabled
}

function resolveSectionView(
  sectionState: SectionState,
  activationState: ActivationState,
  subscription: Subscription | null,
  complimentary: boolean
): SectionView {
  const isIdle = activationState === 'idle'
  const entitled = entitles(subscription)
  const readyBody = isIdle && sectionState === 'ready' ? subscription : null

  return {
    showDisclosure: showsDisclosure(sectionState, entitled, complimentary),
    // The status line waits for the reads, like the disclosure: until both the subscription and
    // the access read have settled, "no subscription yet" would be a guess, and an active
    // subscriber or a complimentary member would see it flash. Signed out it is today's line.
    showStatusLine: isIdle && (sectionState === 'ready' || sectionState === 'signed_out'),
    showComplimentaryNote: readyBody !== null && entitled && complimentary,
    // The grace banner still warns a paying grantee about their payment method; only the
    // ended note ("subscribe again") is withheld from a member whose grant keeps Premium on.
    notesSubscription: entitled || !complimentary ? readyBody : null,
    showSubscribeControls:
      (isIdle && sectionState === 'signed_out') ||
      (readyBody !== null && offersPurchase(readyBody, entitled, complimentary)),
    manageStore: readyBody !== null && entitled ? readyBody.store : null,
  }
}

/**
 * Which `commerce.premium.*` key each failure reason renders.
 *
 * `null` means the call site's own fallback wins, which is already a translated
 * string picked per operation (`errorLoad` for reads, `errorPurchase` for the two
 * redirects). Everything else is a distinction the reader can act on differently,
 * which is the whole reason the reasons exist: an App Store subscriber told
 * "Unable to start checkout. Please try again." has no next step, and
 * `manageInStore` is the sentence that gives them one.
 *
 * `signed_out` carries no key. A session that ended under the reader is a state
 * change, not an error string, so the handlers move the section to its signed-out
 * branch and let the localized hint there do the talking.
 */
const FAILURE_MESSAGE_KEYS: Readonly<Record<PremiumFailureReason, string | null>> = {
  signed_out: null,
  already_subscribed: 'commerce.premium.errorAlreadySubscribed',
  complimentary_access: 'commerce.premium.errorComplimentary',
  store_managed: 'commerce.premium.manageInStore',
  no_web_subscription: 'commerce.premium.errorNoWebSubscription',
  subscribe_disabled: 'commerce.premium.errorSubscribeDisabled',
  status_unavailable: null,
  unknown: null,
}

/**
 * Everything in the section belongs to the member the session bridge names right now: it is
 * keyed by that owner, so a change of member (or sign-out) discards the last member's
 * subscription, access, activation poll, redirect and messages in the same render.
 */
/** What a Stripe return marker on this page's URL asks the section to do. */
type BillingReturn = 'checkout' | 'portal' | null

/** The marker and its query key, read from the URL as the page holds it now. */
function readBillingReturn(params: URLSearchParams): {
  kind: BillingReturn
  key?: string
} {
  if (params.get('checkout') === 'success') return { kind: 'checkout', key: 'checkout' }
  if (params.get('portal') === 'return') return { kind: 'portal', key: 'portal' }
  return { kind: null }
}

/**
 * The page's billing return belongs to the first member the bridge verifies on it: that
 * member's section runs the activation poll or the portal refresh, the marker leaves the URL,
 * and any later member on the same page loads normally (Settings Codex review 1, finding 3).
 */
function useBillingReturn(): (owner: string) => BillingReturn {
  const router = useRouter()
  const routerRef = useRef(router)
  routerRef.current = router
  const boundRef = useRef<
    { kind: BillingReturn; owner: string; spent: boolean } | undefined
  >(undefined)
  // The return lives as long as the member scope that took it: once the bridge names anyone
  // else, it is spent, so that member signing in again on this page loads normally.
  const liveOwner = useWebSessionOwner()
  useLayoutEffect(() => {
    const bound = boundRef.current
    if (bound && bound.owner !== liveOwner) bound.spent = true
  }, [liveOwner])
  return useCallback((owner: string) => {
    if (boundRef.current === undefined) {
      const url = new URL(window.location.href)
      const { kind, key } = readBillingReturn(url.searchParams)
      boundRef.current = { kind, owner, spent: false }
      if (key) {
        url.searchParams.delete(key)
        routerRef.current.replace(`${url.pathname}${url.search}${url.hash}`, {
          scroll: false,
        })
      }
    }
    const bound = boundRef.current
    return bound.owner === owner && !bound.spent ? bound.kind : null
  }, [])
}

/**
 * Story CC-7.7: reports this read to Profile's screen gate, and while the session is checked on
 * a signed-out page, shows the signed-out section it will keep, each piece marked
 * `data-landing="guest"` (hidden by globals.css on a page painted for a stored session), so
 * nothing lands late and pushes the page.
 */
function useSignedOutStandIn(sectionState: SectionState): {
  landing: 'guest' | undefined
  shownState: SectionState
} {
  useScreenGateRead(
    'subscription',
    sectionState !== 'checking' && sectionState !== 'loading'
  )
  const guestFirstPaint = useGuestFirstPaint()
  const standIn = sectionState === 'checking' && guestFirstPaint
  return standIn
    ? { landing: 'guest', shownState: 'signed_out' }
    : { landing: undefined, shownState: sectionState }
}

export function SubscriptionSection() {
  const claimBillingReturn = useBillingReturn()
  return (
    <MemberScope>
      {(session) => (
        <MemberSubscriptionSection
          session={session}
          claimBillingReturn={claimBillingReturn}
        />
      )}
    </MemberScope>
  )
}

function MemberSubscriptionSection({
  session,
  claimBillingReturn,
}: {
  session: MemberSession
  claimBillingReturn: (owner: string) => BillingReturn
}) {
  const { t } = useTranslation()
  const { status, owner } = session
  // Story CC-7.7 D5 (Codex review P1-2): a return to Profile shows this member's plan at once and
  // reads it again in place; a failed refresh keeps it.
  const snapshot = useSectionSnapshot<{
    subscription: Subscription
    access: PremiumAccess | null
  }>('subscription', owner)
  const { beginRead, remember, restoredFor } = snapshot
  const [sectionState, setSectionState] = useState<SectionState>(snapshot.startState)
  const sectionStateRef = useRef(sectionState)
  sectionStateRef.current = sectionState
  const [subscription, setSubscription] = useState<Subscription | null>(
    () => snapshot.restored?.subscription ?? null
  )
  const [access, setAccess] = useState<PremiumAccess | null>(
    () => snapshot.restored?.access ?? null
  )
  const [activationState, setActivationState] = useState<ActivationState>('idle')
  const [showPortalLagHint, setShowPortalLagHint] = useState(false)
  const [isRedirecting, setIsRedirecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** This mount's lifetime: a checkout or portal answer after it ends navigates nowhere. */
  const mountSignal = useMountSignal()

  /*
   * Resolved outside the effect and depended on by value, mirroring
   * `CommercePreferencesSection`: depending on `t` itself would tie the effect
   * to a function identity and risk a request loop.
   */
  const loadErrorMessage = t('commerce.premium.errorLoad')

  // One read (or one activation poll) per member: a session event that names the same member
  // again (a token refresh, the end of a verification already answered) asks nothing.
  useEffect(() => {
    if (status === 'checking') {
      setError(null)
      setSectionState('checking')
      return
    }
    if (status === 'unavailable') {
      // Verification failed: an outage the member can retry, never the sign-in hint.
      setError(loadErrorMessage)
      setSectionState('load_failed')
      return
    }
    if (owner === null) {
      setError(null)
      setSectionState('signed_out')
      return
    }
    // The bridge publishes again once it names this member; until then nothing is asked.
    if (!isLiveOwner(owner)) return

    const billingReturn = claimBillingReturn(owner)
    const controller = new AbortController()
    const current = () => !controller.signal.aborted && isLiveOwner(owner)
    let timer: number | undefined
    setError(null)

    if (billingReturn === 'checkout') {
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
        // A timer that fires after the member changed sends nothing.
        if (!current()) return
        try {
          const next = viaRefresh
            ? await refreshSubscriptionFromWeb(controller.signal)
            : await getSubscriptionFromWeb(controller.signal)
          if (!current()) {
            return
          }
          setSubscription(next)
          if (next.status === 'active' || next.status === 'grace_period') {
            setActivationState('idle')
            return
          }
        } catch {
          if (!current()) {
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

    const isPortalReturn = billingReturn === 'portal'
    const isDenial = (error: unknown) => premiumFailureReason(error) === 'signed_out'
    const inPlace = restoredFor === owner && sectionStateRef.current === 'ready'
    beginRead()
    if (!inPlace) setSectionState('loading')
    setShowPortalLagHint(isPortalReturn)

    void (async () => {
      try {
        /*
         * Portal return fires exactly ONE refresh (no poll — the state is
         * lagging, not wrong). If the ledger is unreachable the local mirror
         * is still an honest answer, so fall back to the plain read before
         * declaring the load failed.
         */
        /*
         * Story 6.14 D6: the access source rides beside the subscription. Its failure
         * renders the section exactly as before (TEA-14), so it can never break the read.
         */
        const accessRead = Promise.race([
          // A denial of a superseded token is read again once, before the null fallback.
          readAsMember(
            owner,
            () => getPremiumAccessFromWeb(controller.signal),
            isDenial
          ).catch(() => null),
          // A hung access read never holds the section: it renders as it did before 6.14.
          new Promise<null>((resolve) => {
            window.setTimeout(() => resolve(null), ACCESS_READ_TIMEOUT_MS)
          }),
        ])
        // A denial of a token the bridge has since rotated for this member is read again once.
        const read = () =>
          readAsMember(owner, () => getSubscriptionFromWeb(controller.signal), isDenial)
        // The portal refresh runs once; only its fallback read is retried, and that read is
        // checked before it is sent, like every follow-up request.
        const fallback = () => {
          if (!current()) throw new DOMException('Aborted', 'AbortError')
          return read()
        }
        const next = isPortalReturn
          ? await refreshSubscriptionFromWeb(controller.signal).catch(fallback)
          : await read()
        const nextAccess = await accessRead
        if (!current()) {
          return
        }
        setAccess(nextAccess)
        setSubscription(next)
        setSectionState('ready')
      } catch (loadError: unknown) {
        if (!current()) {
          return
        }
        if (premiumFailureReason(loadError) === 'signed_out') {
          // A token that expired mid-session is not a broken read. Fall back to
          // the signed-out branch and its localized hint rather than surfacing
          // PREMIUM_SIGNED_OUT_MESSAGE, which has no catalog entry.
          setSectionState('signed_out')
          return
        }
        // A restored plan stays on screen when its refresh fails.
        if (inPlace) return
        // `status_unavailable` (the 503 ledger pull) and `unknown` both render
        // `errorLoad`, so no reason lookup is needed here — which is what keeps
        // `t` out of this effect and the dependency array down to one value.
        setError(loadErrorMessage)
        setSectionState('load_failed')
      }
    })()

    return () => controller.abort()
  }, [status, owner, loadErrorMessage, claimBillingReturn, restoredFor, beginRead])

  // What a return to Profile shows first: the plan once read, nothing after a failure.
  useEffect(() => {
    if (sectionState === 'ready' && subscription !== null)
      remember({ subscription, access })
    else if (sectionState === 'load_failed' || sectionState === 'signed_out')
      remember(undefined)
  }, [access, remember, sectionState, subscription])

  /**
   * Turns a rejection into localized copy, or into the signed-out state.
   *
   * `fallbackKey` is the operation's own generic string, used whenever the failure
   * carries no distinction worth a sentence of its own. Nothing here ever renders
   * the server's `message`: every one of those constants is untranslated English.
   */
  function applyFailure(failure: unknown, fallbackKey: string): void {
    const reason = premiumFailureReason(failure)
    if (reason === 'signed_out') {
      setSubscription(null)
      setError(null)
      setSectionState('signed_out')
      return
    }
    setError(t(FAILURE_MESSAGE_KEYS[reason] ?? fallbackKey))
  }

  async function handleSubscribe(plan: SubscriptionPlan): Promise<void> {
    if (isRedirecting || !isLiveOwner(owner)) {
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

    const signal = mountSignal()
    const current = () => !signal.aborted && isLiveOwner(owner)
    try {
      const url = await createCheckoutSessionFromWeb(plan, signal)
      if (!current()) return
      redirectToExternalUrl(url)
    } catch (checkoutError: unknown) {
      if (!current()) return
      applyFailure(checkoutError, 'commerce.premium.errorPurchase')
      setIsRedirecting(false)
    }
  }

  async function handleManage(): Promise<void> {
    if (isRedirecting || !isLiveOwner(owner)) {
      return
    }
    setIsRedirecting(true)
    setError(null)
    const signal = mountSignal()
    const current = () => !signal.aborted && isLiveOwner(owner)
    try {
      const url = await createPortalSessionFromWeb(signal)
      if (!current()) return
      redirectToExternalUrl(url)
    } catch (portalError: unknown) {
      if (!current()) return
      applyFailure(portalError, 'commerce.premium.errorPurchase')
      setIsRedirecting(false)
    }
  }

  const { landing, shownState } = useSignedOutStandIn(sectionState)
  const isSignedOut = shownState === 'signed_out'
  const complimentary = access?.source === 'complimentary'
  const view = resolveSectionView(
    shownState,
    activationState,
    subscription,
    complimentary
  )

  return (
    <section
      aria-labelledby="premium-subscription-title"
      data-testid="premium-subscription-section"
      aria-busy={sectionState === 'checking' || sectionState === 'loading'}
      className="mt-10 max-w-2xl border-t border-line pt-8"
    >
      <h2
        id="premium-subscription-title"
        className="text-xl font-semibold text-ink"
        data-testid="premium-subscription-title"
      >
        {t('commerce.premium.sectionTitle')}
      </h2>

      {/*
        AC 7: the processor disclosure names RevenueCat and Stripe and what is
        shared. A sibling text node in reading order before the controls, never
        a tooltip and never only an accessible name.
      */}
      {view.showDisclosure && (
        <p
          data-landing={landing}
          className="mt-3 text-sm leading-relaxed text-ink-soft"
          data-testid="premium-disclosure"
        >
          {t('commerce.premium.disclosure')}
        </p>
      )}

      {view.showStatusLine && (
        <p
          data-landing={landing}
          className="mt-6 text-base text-ink"
          data-testid="premium-status-line"
        >
          {statusLineFor(t, subscription, complimentary)}
        </p>
      )}

      {view.showComplimentaryNote && (
        <p
          className="mt-2 text-sm text-ink-soft"
          data-testid="premium-complimentary-note"
        >
          {t('commerce.premium.complimentaryNote')}
        </p>
      )}

      {view.notesSubscription && (
        <SubscriptionStatusNotes subscription={view.notesSubscription} />
      )}

      {view.showSubscribeControls && (
        <SubscribeControls
          landing={landing}
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

      {isSignedOut &&
        (landing ? (
          <GuestText
            id={SIGNED_OUT_HINT_ID}
            text={t('commerce.premium.signedOutHint')}
            className="mt-2 text-sm text-ink-soft"
          />
        ) : (
          <p
            id={SIGNED_OUT_HINT_ID}
            className="mt-2 text-sm text-ink-soft"
            data-testid="premium-signed-out-hint"
          >
            {t('commerce.premium.signedOutHint')}
          </p>
        ))}

      {showPortalLagHint && (
        <p className="mt-4 text-sm text-ink-soft" data-testid="premium-portal-lag-hint">
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
        className="mt-4 min-h-[1.25rem] text-sm text-success-ink"
        data-testid="premium-status-region"
      >
        {activationState === 'activating' && t('commerce.premium.activating')}
        {activationState === 'still_processing' && t('commerce.premium.stillProcessing')}
      </p>

      {error && (
        <p
          role="alert"
          className="mt-1 text-sm text-danger-ink"
          data-testid="premium-error"
        >
          {error}
        </p>
      )}

      <SessionRetryButton session={session} testId="premium-session-retry" />
    </section>
  )
}
