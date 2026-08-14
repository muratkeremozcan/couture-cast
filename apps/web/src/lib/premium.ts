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
 * Thrown for every failure these wrappers surface, so a caller can tell an API
 * failure apart from a programming error without matching on message text.
 */
export class PremiumRequestError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PremiumRequestError'
  }
}

/**
 * Fallback for a call made with no session. The settings UI checks
 * `hasWebSession()` first and renders a localized hint instead, so this string
 * is a guard against a caller that skipped that check rather than user-facing
 * copy.
 */
export const PREMIUM_SIGNED_OUT_MESSAGE = 'Sign in to manage Premium.'

function readAccessToken(): string {
  const token =
    typeof window === 'undefined'
      ? null
      : (window.sessionStorage.getItem(WEB_ACCESS_TOKEN_STORAGE_KEY)?.trim() ?? null)
  if (!token) {
    throw new PremiumRequestError(PREMIUM_SIGNED_OUT_MESSAGE)
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

async function premiumError(
  error: unknown,
  fallback: string
): Promise<PremiumRequestError> {
  if (error instanceof ResponseError) {
    return new PremiumRequestError(await readServerMessage(error.response, fallback))
  }
  // Anything else is a transport failure, an abort, or a contract-parse
  // failure; the message those carry is more useful than the generic fallback.
  return new PremiumRequestError(premiumErrorMessage(error, fallback))
}

/**
 * The message to show for a rejection from this module.
 *
 * Every wrapper below rejects with a `PremiumRequestError`, so the fallback
 * only covers a caller that re-wrapped the failure into something else. It
 * exists so UI code does not repeat the narrowing at each call site.
 */
export function premiumErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
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
    throw await premiumError(error, 'Unable to load subscription status.')
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
    throw await premiumError(error, 'Unable to start checkout. Please try again.')
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
    throw await premiumError(error, 'Unable to open subscription management.')
  }
}
