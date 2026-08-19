// Story 5.2 Task 7 owner: the web app's premium subscription client.
//
// Mirrors `commerce.ts` deliberately: the same `sessionStorage` bearer token,
// the same `.strict()`-envelope message reading, and Zod-parsed responses at
// the trust boundary. Checkout and the Customer Portal are Stripe-hosted
// redirects, so this file never touches a Stripe dependency — the session URLs
// come from our API and the browser navigates to them.
'use client'

import {
  checkoutSessionResponseSchema,
  portalSessionResponseSchema,
  subscriptionResponseSchema,
  type Subscription,
  type SubscriptionPlan,
} from '@couture/api-client/contracts/http'
import { ResponseError } from '@couture/api-client'
import { createWebApiClient } from './api-client'
import { WEB_ACCESS_TOKEN_STORAGE_KEY } from './wardrobe'

// One sessionStorage truth for "is there a web session": the commerce helper
// reads the same key, and duplicating the check would let the two drift.
export { hasWebSession } from './commerce'

/**
 * Why a call failed, in terms the UI can act on without reading English prose.
 *
 * Every message this module can produce is untranslated English: the server's own
 * `COMMERCE_SUBSCRIPTION_DISABLED_MESSAGE`, `SUBSCRIPTION_ALREADY_ACTIVE_MESSAGE`,
 * `SUBSCRIPTION_NOT_WEB_MANAGED_MESSAGE`, `SUBSCRIPTION_NOT_FOUND_MESSAGE` and
 * `SUBSCRIPTION_LEDGER_UNAVAILABLE_MESSAGE`, a transport error's text, and the
 * signed-out guard string below. Rendering any of them showed English to the nine
 * non-`en` catalogs on the exact paths those catalogs carry copy for, and left
 * `commerce.premium.errorLoad` and `errorPurchase` unreachable behind it. So the
 * reason travels and the words do not: `subscription-section.tsx` maps each member
 * onto a `commerce.premium.*` key.
 *
 * Collapsing everything to one generic string would have been worse than the bug.
 * Telling an App Store subscriber "Unable to start checkout. Please try again."
 * when the real answer is "manage it where you bought it" is a dead end, and the
 * catalogs already carry `manageInStore` for precisely that. The members below are
 * the distinctions the reader can act on differently, and nothing more.
 *
 * 409 appears twice and means two different things — already-subscribed on
 * checkout, store-managed on the portal — so each wrapper supplies its own status
 * map rather than sharing one global table.
 */
export type PremiumFailureReason =
  | 'signed_out'
  | 'already_subscribed'
  | 'store_managed'
  | 'no_web_subscription'
  | 'subscribe_disabled'
  | 'status_unavailable'
  | 'unknown'

/**
 * Thrown for every failure these wrappers surface, so a caller can tell an API
 * failure apart from a programming error without matching on message text.
 *
 * `message` is developer-facing throughout: it carries the server's own text when
 * there is one so a log line or a failing assertion names the real cause. UI code
 * reads {@link PremiumRequestError.reason} instead.
 */
export class PremiumRequestError extends Error {
  readonly reason: PremiumFailureReason

  constructor(reason: PremiumFailureReason, message: string) {
    super(message)
    this.name = 'PremiumRequestError'
    this.reason = reason
  }
}

/**
 * Fallback for a call made with no session. The settings UI checks
 * `hasWebSession()` first and renders a localized hint instead, so this string
 * is a guard against a caller that skipped that check rather than user-facing
 * copy — which is why it has no catalog entry, and why the section reads the
 * `signed_out` reason rather than this text.
 */
export const PREMIUM_SIGNED_OUT_MESSAGE = 'Sign in to manage Premium.'

function readAccessToken(): string {
  const token =
    typeof window === 'undefined'
      ? null
      : (window.sessionStorage.getItem(WEB_ACCESS_TOKEN_STORAGE_KEY)?.trim() ?? null)
  if (!token) {
    throw new PremiumRequestError('signed_out', PREMIUM_SIGNED_OUT_MESSAGE)
  }
  return token
}

/**
 * The shared error envelope is `.strict()` over `{ statusCode, message, error }`
 * with no `code` field, so the message is the whole of what the server tells us.
 */
async function readServerMessage(response: Response, fallback: string): Promise<string> {
  try {
    const body: unknown = await response.json()
    const message =
      typeof body === 'object' && body !== null && 'message' in body
        ? (body as { message?: unknown }).message
        : undefined
    return typeof message === 'string' && message.trim().length > 0 ? message : fallback
  } catch {
    return fallback
  }
}

/** Statuses every operation shares. 401 is a session that ended under the reader. */
const SHARED_REASONS: Readonly<Record<number, PremiumFailureReason>> = {
  401: 'signed_out',
}

async function premiumError(
  error: unknown,
  fallback: string,
  statusReasons: Readonly<Record<number, PremiumFailureReason>> = {}
): Promise<PremiumRequestError> {
  // `readAccessToken` already threw a classified error; re-wrapping it would lose
  // the `signed_out` reason and re-open the untranslated-message path.
  if (error instanceof PremiumRequestError) {
    return error
  }
  if (error instanceof ResponseError) {
    const status = error.response.status
    const reason = statusReasons[status] ?? SHARED_REASONS[status] ?? 'unknown'
    return new PremiumRequestError(
      reason,
      await readServerMessage(error.response, fallback)
    )
  }
  // Anything else is a transport failure, an abort, or a contract-parse failure.
  // The message those carry is the useful one for a log; the reason stays
  // `unknown` so the section falls back to its own translated copy.
  return new PremiumRequestError(
    'unknown',
    error instanceof Error ? error.message : fallback
  )
}

/**
 * The reason behind a rejection from this module, for UI code that has to choose
 * a translated string.
 *
 * Anything that is not one of this module's own errors reads as `unknown`, which
 * is the conservative answer: the caller shows its generic translated message
 * rather than guessing at subscription state from a failure it cannot classify.
 */
export function premiumFailureReason(error: unknown): PremiumFailureReason {
  return error instanceof PremiumRequestError ? error.reason : 'unknown'
}

/**
 * Navigation seam for the Stripe-hosted redirects. jsdom's `location` is
 * unforgeable, so tests replace this function rather than the global.
 */
export function redirectToExternalUrl(url: string): void {
  window.location.assign(url)
}

export async function getSubscriptionFromWeb(
  signal?: AbortSignal
): Promise<Subscription> {
  const accessToken = readAccessToken()
  try {
    const response = await createWebApiClient({
      accessToken,
    }).apiV1CommerceSubscriptionGet({ signal })
    return subscriptionResponseSchema.parse(response).data
  } catch (error: unknown) {
    // Developer-facing. The section renders `commerce.premium.errorLoad`.
    throw await premiumError(error, 'Unable to load subscription status.')
  }
}

/**
 * On-demand ledger pull. The server rate limits this per user and serves local
 * state inside the window, so callers may treat it as a stronger read rather
 * than a distinct operation.
 */
export async function refreshSubscriptionFromWeb(
  signal?: AbortSignal
): Promise<Subscription> {
  const accessToken = readAccessToken()
  try {
    const response = await createWebApiClient({
      accessToken,
    }).apiV1CommerceSubscriptionRefreshPost({ signal })
    return subscriptionResponseSchema.parse(response).data
  } catch (error: unknown) {
    // 503 is the ledger pull failing rather than the read being broken, and the
    // server deliberately answers it instead of serving stale-as-fresh.
    throw await premiumError(error, 'Unable to load subscription status.', {
      503: 'status_unavailable',
    })
  }
}

/** Returns the Stripe-hosted Checkout URL for the requested plan. */
export async function createCheckoutSessionFromWeb(
  plan: SubscriptionPlan,
  signal?: AbortSignal
): Promise<string> {
  const accessToken = readAccessToken()
  try {
    const response = await createWebApiClient({
      accessToken,
    }).apiV1CommerceSubscriptionCheckoutSessionPost(
      { checkoutSessionRequest: { plan } },
      { signal }
    )
    return checkoutSessionResponseSchema.parse(response).data.url
  } catch (error: unknown) {
    throw await premiumError(error, 'Unable to start checkout. Please try again.', {
      409: 'already_subscribed',
      503: 'subscribe_disabled',
    })
  }
}

/** Returns the Stripe Customer Portal URL for a web-managed subscription. */
export async function createPortalSessionFromWeb(signal?: AbortSignal): Promise<string> {
  const accessToken = readAccessToken()
  try {
    const response = await createWebApiClient({
      accessToken,
    }).apiV1CommerceSubscriptionPortalSessionPost({ signal })
    return portalSessionResponseSchema.parse(response).data.url
  } catch (error: unknown) {
    // The portal's 409 is store-managed, NOT already-subscribed: the same status
    // on checkout means the opposite thing, which is why the map is per-operation.
    throw await premiumError(error, 'Unable to open subscription management.', {
      404: 'no_web_subscription',
      409: 'store_managed',
    })
  }
}
