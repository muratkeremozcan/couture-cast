// Story 5.2 Task 6 owner: mobile premium subscription boundary.
//
// Everything the settings Premium section needs from the network and from the
// RevenueCat SDK lives here so the screen stays presentational. The
// load-bearing rules:
//
// 1. `Purchases.configure` runs lazily, on first entry to the settings Premium
//    section, never at app launch: the morning ritual path must not pay for a
//    billing SDK it does not use. Configuration is memoized so the section can
//    be revisited without re-configuring (the SDK warns on double configure).
// 2. The SDK is imported lazily and every native call is wrapped: under Expo
//    Go and in web bundles the native module is absent, and that state must
//    surface as the graceful "purchases unavailable in this build" fallback,
//    never as a crash or a misleading purchase error.
// 3. A purchase resolves to exactly one of FIVE outcomes — success,
//    user-cancelled, sdk-unavailable, deferred (StoreKit Ask to Buy: the store
//    returns neither success nor cancel and the entitlement arrives hours
//    later via webhook), and error. `deferred` must never start the
//    post-purchase poll; there is nothing to poll for yet.
// 4. The post-purchase poll is bounded: a fixed interval with a hard stop,
//    after which the caller renders a terminal "still processing" state
//    instead of spinning forever. The bound is the AC's 2-minute sync clock
//    made visible.
import {
  subscriptionResponseSchema,
  type Subscription,
  type SubscriptionPlan,
} from '@couture/api-client/contracts/http'
import { Platform } from 'react-native'
import { createMobileApiClient } from './api-client'
import { withRequestTimeout } from './commerce'
import { resolveMobileAccessToken } from './mobile-auth'
import { getUserProfileFromMobile } from './user'

export const PREMIUM_ENTITLEMENT_POLL_INTERVAL_MS = 5_000
export const PREMIUM_ENTITLEMENT_POLL_CAP_MS = 120_000

function premiumClient() {
  return createMobileApiClient({
    accessToken: async () => (await resolveMobileAccessToken()) || '',
  })
}

export async function getSubscriptionFromMobile(
  signal?: AbortSignal
): Promise<Subscription> {
  const response = await withRequestTimeout(signal, (requestSignal) =>
    premiumClient().apiV1CommerceSubscriptionGet({ signal: requestSignal })
  )
  return subscriptionResponseSchema.parse(response).data
}

/**
 * On-demand ledger pull. Beats webhook latency right after a purchase; the
 * server rate-limits it per user and serves local state inside the window, so
 * calling it eagerly is safe.
 */
export async function refreshSubscriptionFromMobile(
  signal?: AbortSignal
): Promise<Subscription> {
  const response = await withRequestTimeout(signal, (requestSignal) =>
    premiumClient().apiV1CommerceSubscriptionRefreshPost({ signal: requestSignal })
  )
  return subscriptionResponseSchema.parse(response).data
}

/** The guard's access rule, mirrored client-side: grace period keeps access. */
export function isEntitledSubscription(subscription: Subscription): boolean {
  return subscription.status === 'active' || subscription.status === 'grace_period'
}

// --- Render-state resolver ---------------------------------------------------

/**
 * One state per rendering rule in the story's Decision 11. The section renders
 * from this and nothing else, so "what does the section show" has a single
 * answer that the screen and its tests share.
 */
export type PremiumSectionRenderState =
  | { kind: 'loading' }
  | { kind: 'load-error' }
  | { kind: 'subscribe'; ended: boolean; purchasesEnabled: boolean }
  | {
      kind: 'entitled'
      plan: SubscriptionPlan | null
      productId: string
      currentPeriodEnd: string
      showGraceBanner: boolean
      manageEntry: 'store' | 'web' | 'none'
    }

export function resolvePremiumSectionState(
  subscription: Subscription | null,
  didLoadFail: boolean
): PremiumSectionRenderState {
  if (didLoadFail) {
    return { kind: 'load-error' }
  }
  if (!subscription) {
    return { kind: 'loading' }
  }
  switch (subscription.status) {
    case 'none':
      return {
        kind: 'subscribe',
        ended: false,
        purchasesEnabled: subscription.purchasesEnabled,
      }
    case 'expired':
    case 'revoked':
      // "Your subscription ended" note plus the subscribe CTA: the user can
      // come back, and the note explains why Premium features stopped.
      return {
        kind: 'subscribe',
        ended: true,
        purchasesEnabled: subscription.purchasesEnabled,
      }
    case 'active':
    case 'grace_period':
      return {
        kind: 'entitled',
        plan:
          subscription.productId === 'premium_monthly' ||
          subscription.productId === 'premium_annual'
            ? subscription.productId
            : null,
        productId: subscription.productId,
        currentPeriodEnd: subscription.currentPeriodEnd,
        showGraceBanner: subscription.status === 'grace_period',
        // Manage entry by store: store-billed subscriptions open the native
        // manage flow; Stripe-billed ones are managed on the web (the portal
        // is the web surface's); promotional grants have nothing to manage.
        manageEntry:
          subscription.store === 'stripe'
            ? 'web'
            : subscription.store === 'promotional'
              ? 'none'
              : 'store',
      }
  }
}

// --- RevenueCat SDK boundary -------------------------------------------------

/**
 * The slice of `react-native-purchases` this module calls. Typed structurally
 * rather than from the SDK's types so the vitest mock (which replaces the
 * module via a resolve alias — the native module cannot exist under vitest)
 * only has to honor what is actually used.
 */
type PurchasesPackageLike = {
  identifier: string
  product: { identifier: string }
}

type PurchasesStatic = {
  configure: (options: { apiKey: string; appUserID: string }) => void | Promise<void>
  getOfferings: () => Promise<{
    current: { availablePackages: PurchasesPackageLike[] } | null
  }>
  purchasePackage: (pkg: PurchasesPackageLike) => Promise<unknown>
  restorePurchases: () => Promise<unknown>
  showManageSubscriptions: () => Promise<void>
}

type PurchasesModule = {
  default: PurchasesStatic
  PURCHASES_ERROR_CODE: Record<string, unknown>
}

export type PurchasesAvailability = 'ready' | 'unavailable' | 'error'

export type PurchaseOutcome =
  | { kind: 'success' }
  | { kind: 'user-cancelled' }
  | { kind: 'sdk-unavailable' }
  | { kind: 'deferred' }
  | { kind: 'error' }

export type RestoreOutcome =
  | { kind: 'success' }
  | { kind: 'sdk-unavailable' }
  | { kind: 'error' }

let configuredAvailability: PurchasesAvailability | null = null
/**
 * The in-flight configure, memoized separately from its result. Memoizing only
 * the settled result leaves a window: two callers arriving while the profile
 * read is still awaiting both pass the `configuredAvailability === null` guard
 * and both reach `Purchases.configure`, which the SDK rejects. Not reachable
 * from the settings section today (its CTAs render only after availability
 * resolves), but this function is exported and CC-5.3+ premium surfaces are
 * documented consumers that would call it from their own mounts.
 */
let configureInFlight: Promise<PurchasesAvailability> | null = null

/** Test-only: clears the memoized configure result between tests. */
export function resetPremiumPurchasesForTests() {
  configuredAvailability = null
  configureInFlight = null
}

async function loadPurchasesModule(): Promise<PurchasesModule | null> {
  try {
    // Lazy, following the `expo-web-browser` precedent in `commerce.ts`: the
    // SDK reaches native module registries that cannot be evaluated in a web
    // bundle, so a static import would break every module reaching this file.
    return (await import('react-native-purchases')) as unknown as PurchasesModule
  } catch {
    return null
  }
}

function resolveRevenueCatApiKey(): string | undefined {
  if (Platform.OS === 'ios') {
    return process.env.EXPO_PUBLIC_REVENUECAT_APPLE_API_KEY
  }
  if (Platform.OS === 'android') {
    return process.env.EXPO_PUBLIC_REVENUECAT_GOOGLE_API_KEY
  }
  return undefined
}

/**
 * Lazily configures the RevenueCat SDK for the signed-in user.
 *
 * `unavailable` is the build-level fact (Expo Go, web, missing public SDK
 * key): the section renders the informational fallback and no purchase can
 * start. `error` is transient (the profile read failed) and is deliberately
 * not memoized, so a retry — the next section entry or purchase tap — can
 * succeed.
 */
export async function ensurePurchasesConfigured(
  loadProfile: typeof getUserProfileFromMobile = getUserProfileFromMobile
): Promise<PurchasesAvailability> {
  if (configuredAvailability !== null) {
    return configuredAvailability
  }
  if (configureInFlight) {
    return configureInFlight
  }

  configureInFlight = configurePurchases(loadProfile)
  try {
    return await configureInFlight
  } finally {
    // Cleared either way: a 'ready'/'unavailable' result is already memoized in
    // `configuredAvailability`, and the deliberately-unmemoized 'error' path
    // must stay retryable.
    configureInFlight = null
  }
}

async function configurePurchases(
  loadProfile: typeof getUserProfileFromMobile
): Promise<PurchasesAvailability> {
  const purchasesModule = await loadPurchasesModule()
  const apiKey = resolveRevenueCatApiKey()
  if (!purchasesModule || !apiKey) {
    configuredAvailability = 'unavailable'
    return configuredAvailability
  }

  try {
    const profile = await loadProfile()
    await purchasesModule.default.configure({
      apiKey,
      // Our User.id is RevenueCat's app_user_id: the webhook maps entitlement
      // events back to a user by exactly this value.
      appUserID: profile.user.id,
    })
    configuredAvailability = 'ready'
    return configuredAvailability
  } catch {
    // The native module answered but configuration failed (most likely the
    // profile read): transient, so the next attempt may succeed.
    return 'error'
  }
}

function readPurchaseErrorFacts(error: unknown): {
  code: unknown
  userCancelled: boolean
} {
  if (typeof error === 'object' && error !== null) {
    const record = error as Record<string, unknown>
    return { code: record.code, userCancelled: record.userCancelled === true }
  }
  return { code: undefined, userCancelled: false }
}

function mapPurchaseError(
  purchasesModule: PurchasesModule,
  error: unknown
): PurchaseOutcome {
  const { code, userCancelled } = readPurchaseErrorFacts(error)
  const errorCodes = purchasesModule.PURCHASES_ERROR_CODE
  if (userCancelled || code === errorCodes.PURCHASE_CANCELLED_ERROR) {
    return { kind: 'user-cancelled' }
  }
  if (code === errorCodes.PAYMENT_PENDING_ERROR) {
    // StoreKit "Ask to Buy": a guardian has to approve the purchase, the store
    // returns neither success nor cancel, and the entitlement arrives later
    // via webhook. The caller shows the pending-approval state and must NOT
    // start the post-purchase poll.
    return { kind: 'deferred' }
  }
  return { kind: 'error' }
}

/**
 * Runs the store purchase for a plan and maps the result onto the five-outcome
 * machine. Never throws: every failure mode is a named outcome the section
 * renders deliberately.
 */
export async function purchasePremiumPlan(
  plan: SubscriptionPlan
): Promise<PurchaseOutcome> {
  const availability = await ensurePurchasesConfigured()
  if (availability === 'unavailable') {
    return { kind: 'sdk-unavailable' }
  }
  if (availability === 'error') {
    return { kind: 'error' }
  }

  const purchasesModule = await loadPurchasesModule()
  if (!purchasesModule) {
    return { kind: 'sdk-unavailable' }
  }

  try {
    const offerings = await purchasesModule.default.getOfferings()
    const availablePackages = offerings.current?.availablePackages ?? []
    const target = availablePackages.find(
      (candidate) => candidate.product.identifier === plan
    )
    if (!target) {
      return { kind: 'error' }
    }
    await purchasesModule.default.purchasePackage(target)
    return { kind: 'success' }
  } catch (error) {
    return mapPurchaseError(purchasesModule, error)
  }
}

/**
 * Restore purchases (reinstall / new device). Success only means the store
 * sync ran; the caller refreshes the server subscription to learn the result.
 */
export async function restorePremiumPurchases(): Promise<RestoreOutcome> {
  const availability = await ensurePurchasesConfigured()
  if (availability === 'unavailable') {
    return { kind: 'sdk-unavailable' }
  }
  if (availability === 'error') {
    return { kind: 'error' }
  }

  const purchasesModule = await loadPurchasesModule()
  if (!purchasesModule) {
    return { kind: 'sdk-unavailable' }
  }

  try {
    await purchasesModule.default.restorePurchases()
    return { kind: 'success' }
  } catch {
    return { kind: 'error' }
  }
}

/**
 * Opens the native manage-subscription flow for store-billed subscriptions.
 * Returns false when the flow could not open so the caller can surface it.
 */
export async function showManageSubscriptionsInStore(): Promise<boolean> {
  const purchasesModule = await loadPurchasesModule()
  if (!purchasesModule || configuredAvailability !== 'ready') {
    return false
  }
  try {
    await purchasesModule.default.showManageSubscriptions()
    return true
  } catch {
    return false
  }
}

// --- Bounded post-purchase poll ----------------------------------------------

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve()
      return
    }
    const onAbort = () => {
      clearTimeout(timer)
      resolve()
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * Polls the subscription until it turns entitled, on a fixed interval with a
 * hard cap (5 seconds / 2 minutes by default — 24 polls). Returns the entitled
 * subscription, or null when the cap elapsed (the caller renders the terminal
 * "still processing" state) or the caller aborted. A failed or still-`none`
 * poll is not a failure — the webhook may simply not have landed yet — so the
 * loop keeps going until the cap says stop.
 */
export async function pollSubscriptionUntilEntitled(
  options: {
    intervalMs?: number
    capMs?: number
    signal?: AbortSignal
    fetchSubscription?: typeof getSubscriptionFromMobile
  } = {}
): Promise<Subscription | null> {
  const intervalMs = options.intervalMs ?? PREMIUM_ENTITLEMENT_POLL_INTERVAL_MS
  const capMs = options.capMs ?? PREMIUM_ENTITLEMENT_POLL_CAP_MS
  const fetchSubscription = options.fetchSubscription ?? getSubscriptionFromMobile
  const attempts = Math.max(1, Math.floor(capMs / intervalMs))

  for (let attempt = 0; attempt < attempts; attempt++) {
    await delay(intervalMs, options.signal)
    if (options.signal?.aborted) {
      return null
    }
    try {
      const subscription = await fetchSubscription(options.signal)
      if (isEntitledSubscription(subscription)) {
        return subscription
      }
    } catch {
      // Transient read failures do not end the watch; the cap does.
    }
  }
  return null
}
