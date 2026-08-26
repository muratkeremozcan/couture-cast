// Story 5.1 Task 7 owner: the web app's affiliate commerce preference client.
//
// Auth here is the `sessionStorage` bearer token, matching `wardrobe.ts`. Three
// sibling libs (`user.ts`, `guardian.ts`, `signup.ts`) send `credentials:
// 'include'` instead and carry no bearer; the commerce preference endpoints are
// bearer-authenticated like the wardrobe routes, so wardrobe is the convention
// this file follows.
'use client'

import {
  affiliateClickResponseSchema,
  commercePreferenceResponseSchema,
  updateCommercePreferenceResponseSchema,
  type AffiliateClickRequest,
  type CommercePreference,
  type UpdateCommercePreferenceInput,
} from '@couture/api-client/contracts/http'
import { ResponseError } from '@couture/api-client'
import { createWebApiClient } from './api-client'
import { WEB_ACCESS_TOKEN_STORAGE_KEY } from './wardrobe'

/**
 * Thrown for every failure these wrappers surface, so a caller can tell an API
 * failure apart from a programming error without matching on message text.
 */
export class CommerceRequestError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CommerceRequestError'
  }
}

/**
 * Fallback for a call made with no session. The settings UI checks
 * `hasWebSession()` first and renders a localized hint instead, so this string
 * is a guard against a caller that skipped that check rather than user-facing
 * copy.
 */
export const COMMERCE_SIGNED_OUT_MESSAGE = 'Sign in to change shopping preferences.'

/**
 * Whether this browser holds a bearer token.
 *
 * Guarded on `window` because Next renders this page's tree on the server
 * first, where `sessionStorage` does not exist. Callers therefore read it from
 * an effect and treat the server pass as signed out, which is also the state
 * the unauthenticated accessibility audit exercises.
 */
export function hasWebSession(): boolean {
  return Boolean(readStoredToken())
}

function readStoredToken(): string | null {
  if (typeof window === 'undefined') {
    return null
  }
  return window.sessionStorage.getItem(WEB_ACCESS_TOKEN_STORAGE_KEY)?.trim() ?? null
}

function readAccessToken(): string {
  const token = readStoredToken()
  if (!token) {
    throw new CommerceRequestError(COMMERCE_SIGNED_OUT_MESSAGE)
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

async function commerceError(
  error: unknown,
  fallback: string
): Promise<CommerceRequestError> {
  if (error instanceof ResponseError) {
    return new CommerceRequestError(await readServerMessage(error.response, fallback))
  }
  // Anything else is a transport failure, an abort, or a contract-parse
  // failure; the message those carry is more useful than the generic fallback.
  return new CommerceRequestError(commerceErrorMessage(error, fallback))
}

/**
 * The message to show for a rejection from this module.
 *
 * Every wrapper below rejects with a `CommerceRequestError`, so the fallback
 * only covers a caller that re-wrapped the failure into something else. It
 * exists so UI code does not repeat the narrowing at each call site.
 */
export function commerceErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

export async function getCommercePreferenceFromWeb(
  signal?: AbortSignal
): Promise<CommercePreference> {
  const accessToken = readAccessToken()
  try {
    const response = await createWebApiClient({
      accessToken,
    }).apiV1CommercePreferencesGet({ signal })
    return commercePreferenceResponseSchema.parse(response).data
  } catch (error: unknown) {
    throw await commerceError(error, 'Unable to load shopping preferences.')
  }
}

export async function updateCommercePreferenceFromWeb(
  input: UpdateCommercePreferenceInput,
  signal?: AbortSignal
): Promise<CommercePreference> {
  const accessToken = readAccessToken()
  try {
    const response = await createWebApiClient({
      accessToken,
    }).apiV1CommercePreferencesPut({ updateCommercePreferenceInput: input }, { signal })
    return updateCommercePreferenceResponseSchema.parse(response).data
  } catch (error: unknown) {
    throw await commerceError(error, 'Unable to update shopping preferences.')
  }
}

/**
 * Story 5.4: mints the attributed click and returns the outbound partner URL.
 *
 * The web twin of `mintAffiliateClickFromMobile`. `scenario` and `localeRegion`
 * are deliberately not sent -- the API derives both server-side, so a client
 * cannot influence what the attribution record says -- and neither is any URL
 * received before this call: the outbound link exists only as the response to a
 * click that has already been recorded.
 */
export async function mintAffiliateClickFromWeb(
  input: AffiliateClickRequest,
  signal?: AbortSignal
): Promise<string> {
  const accessToken = readAccessToken()
  try {
    const response = await createWebApiClient({
      accessToken,
    }).apiV1CommerceAffiliateClicksPost({ affiliateClickRequest: input }, { signal })
    return affiliateClickResponseSchema.parse(response).data.redirectUrl
  } catch (error: unknown) {
    throw await commerceError(error, 'Unable to open this partner offer.')
  }
}

/**
 * Hands the minted URL to a new browsing context.
 *
 * `noopener,noreferrer` rather than a bare `window.open`: the partner host is
 * third-party, and without `noopener` the opened page keeps a live
 * `window.opener` handle back into this origin's tab. Returns false when the
 * browser blocked the popup, which the caller surfaces as a failed handoff
 * rather than silently doing nothing.
 */
export function openAffiliatePartnerSite(redirectUrl: string): boolean {
  if (typeof window === 'undefined') {
    return false
  }
  const opened = window.open(redirectUrl, '_blank', 'noopener,noreferrer')
  return opened !== null
}
