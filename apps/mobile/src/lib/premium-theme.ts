// Story 5.3 Task 6 owner: the mobile app's premium theme client.
//
// The mobile counterpart of `apps/web/src/lib/premium-theme.ts`, and deliberately the
// same shape: the same failure-reason taxonomy, the same `resolvePremiumThemeKey`
// fallback, the same `.strict()` envelope parsing at the trust boundary. What differs is
// only what always differs between the two surfaces — the bearer token comes from
// `resolveMobileAccessToken` rather than `sessionStorage`, and every request goes through
// `withRequestTimeout`, the 15-second helper `commerce.ts` exports and every mobile
// network call in this app already uses.
//
// Why the reason travels and the words do not: every message this module can produce —
// the server's own `PREMIUM_THEMES_DISABLED_MESSAGE` and `PREMIUM_REQUIRED_MESSAGE`, a
// transport error's text — is untranslated English, and rendering any of them would show
// a `tr-TR` or `de-DE` reader English on exactly the paths the ten catalogs already carry
// translated copy for (AC 7). The settings section maps each reason onto a
// `commerce.premium.theme.*` key or onto a state change that is already localized.
import {
  premiumThemeKeySchema,
  premiumThemeResponseSchema,
  updatePremiumThemeResponseSchema,
  type PremiumTheme,
  type PremiumThemeKey,
} from '@couture/api-client/contracts/http'
import { ResponseError } from '@couture/api-client'
import { createMobileApiClient } from './api-client'
import { withRequestTimeout } from './commerce'
import { resolveMobileAccessToken } from './mobile-auth'

/**
 * The palettes this build knows how to render, in gallery order.
 *
 * Derived from the contract enum rather than retyped, so a palette added or removed in
 * `packages/api-client/src/contracts/http/premium-theme.ts` cannot leave the mobile
 * gallery behind.
 *
 * Copied rather than aliased, for the same reason the web copy is: `ZodEnum.options`
 * hands out the schema's own live array, and this repository already contains code that
 * mutates exactly that array by reference (`preserveNullableEnumValues` in
 * `contracts/http/openapi.ts` pushes `null` into `_def.values`). A `readonly` annotation
 * is erased at runtime, so aliasing would let an unrelated module grow the gallery a
 * fourth card with no palette and no label behind it.
 */
export const PREMIUM_THEME_KEYS: readonly PremiumThemeKey[] = Object.freeze([
  ...premiumThemeKeySchema.options,
])

/**
 * Why a call failed, in terms the UI can act on without reading English prose.
 *
 * The two entitlement/flag members are what let a rejected save re-resolve the section
 * instead of leaving a live gallery that fails on every press: a 403 means entitlement
 * lapsed under the reader and a 503 means the kill switch flipped, and both are states
 * the section already knows how to render.
 */
export type PremiumThemeFailureReason =
  | 'signed_out'
  | 'not_entitled'
  | 'themes_disabled'
  | 'unknown'

/**
 * Thrown for every failure these wrappers surface, so a caller can tell an API failure
 * apart from a programming error without matching on message text.
 *
 * `message` is developer-facing throughout: it carries the server's own text when there
 * is one so a log line or a test failure names the real cause. UI code reads
 * {@link PremiumThemeRequestError.reason} instead.
 */
export class PremiumThemeRequestError extends Error {
  readonly reason: PremiumThemeFailureReason

  constructor(reason: PremiumThemeFailureReason, message: string) {
    super(message)
    this.name = 'PremiumThemeRequestError'
    this.reason = reason
  }
}

/**
 * Fallback for a call made with no session. Developer-facing, with no catalog entry: the
 * section reads the `signed_out` reason and renders its own translated locked copy.
 */
export const PREMIUM_THEME_SIGNED_OUT_MESSAGE = 'Sign in to choose an interface palette.'

async function readAccessToken(): Promise<string> {
  const token = (await resolveMobileAccessToken())?.trim()
  if (!token) {
    throw new PremiumThemeRequestError('signed_out', PREMIUM_THEME_SIGNED_OUT_MESSAGE)
  }
  return token
}

function themeClient(accessToken: string) {
  return createMobileApiClient({ accessToken })
}

/**
 * The shared error envelope is `.strict()` over `{ statusCode, message, error }` with no
 * `code` field, so the message is the whole of what the server tells us. It is the only
 * place the kill switch's `PREMIUM_THEMES_DISABLED_MESSAGE` and the entitlement guard's
 * `PREMIUM_REQUIRED_MESSAGE` reach the client, which is why the server's own text is
 * preferred over the local fallback for the developer-facing message.
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

/**
 * The status codes the two routes answer with, mapped onto reasons.
 *
 * 401 and 403 are separated deliberately. The guard order in
 * `premium-theme.controller.ts` means a 403 is always "signed in, not entitled" and never
 * "not signed in", so the section can move straight to the locked panel on 403 and back
 * to its signed-out branch on 401 without a second request to tell them apart.
 */
function reasonForStatus(status: number): PremiumThemeFailureReason {
  if (status === 401) return 'signed_out'
  if (status === 403) return 'not_entitled'
  if (status === 503) return 'themes_disabled'
  return 'unknown'
}

async function themeError(
  error: unknown,
  fallback: string
): Promise<PremiumThemeRequestError> {
  // `readAccessToken` already threw a classified error; re-wrapping it would lose the
  // `signed_out` reason and re-open the untranslated-message path.
  if (error instanceof PremiumThemeRequestError) {
    return error
  }
  if (error instanceof ResponseError) {
    return new PremiumThemeRequestError(
      reasonForStatus(error.response.status),
      await readServerMessage(error.response, fallback)
    )
  }
  // Anything else is a transport failure, a timeout, an abort, or a contract-parse
  // failure. The message those carry is the useful one for a log; the reason stays
  // `unknown` so the section falls back to its own translated copy.
  return new PremiumThemeRequestError(
    'unknown',
    error instanceof Error ? error.message : fallback
  )
}

/**
 * The reason behind a rejection from this module, for UI code that has to choose a
 * translated string or a state transition.
 *
 * Anything that is not one of this module's own errors reads as `unknown`, which is the
 * conservative answer: the caller shows its generic translated message rather than
 * guessing at entitlement or flag state from a failure it cannot classify.
 */
export function premiumThemeFailureReason(error: unknown): PremiumThemeFailureReason {
  return error instanceof PremiumThemeRequestError ? error.reason : 'unknown'
}

/**
 * Narrows an arbitrary stored value to a palette this build can render, or Default.
 *
 * AC 6's first failure mode is a key from a palette that no longer exists — a cached
 * response, a seeded row, or a server that publishes a palette this build predates. The
 * server resolves stale keys to null too, so this is belt-and-braces rather than the only
 * guard, and it is the reason a stale value renders Default cleanly instead of failing
 * the strict envelope parse and landing the whole section in its error state.
 */
export function resolvePremiumThemeKey(value: unknown): PremiumThemeKey | null {
  const parsed = premiumThemeKeySchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

/**
 * Applies `resolvePremiumThemeKey` to `data.theme` before the envelope is parsed.
 *
 * Only that one field is touched. Everything else still goes through `.strict()`
 * unchanged, so an extra property or a missing `isEntitled` is still a hard failure.
 */
function withResolvedTheme(response: unknown): unknown {
  if (typeof response !== 'object' || response === null || !('data' in response)) {
    return response
  }
  const { data } = response as { data: unknown }
  if (typeof data !== 'object' || data === null || !('theme' in data)) {
    return response
  }
  const record = data as Record<string, unknown>
  return {
    ...(response as Record<string, unknown>),
    data: { ...record, theme: resolvePremiumThemeKey(record.theme) },
  }
}

/**
 * Reads the palette the server resolved for this user, together with the entitlement and
 * flag state that produced it. One round trip, so no caller has to combine this with
 * `/api/v1/commerce/subscription` and none has two moments in time to disagree about.
 */
export async function getThemeFromMobile(signal?: AbortSignal): Promise<PremiumTheme> {
  try {
    const accessToken = await readAccessToken()
    const response = await withRequestTimeout(signal, (requestSignal) =>
      themeClient(accessToken).apiV1CommercePremiumThemeGet({ signal: requestSignal })
    )
    return premiumThemeResponseSchema.parse(withResolvedTheme(response)).data
  } catch (error: unknown) {
    // Developer-facing. The section renders `commerce.premium.theme.loadError`.
    throw await themeError(error, 'Unable to load your interface palette.')
  }
}

/**
 * Stores a palette choice, or resets to Default with `null`.
 *
 * `null` upserts the stored row to null and never deletes it, so "reset" and "never
 * chose" stay distinguishable server-side (Decision 8). The response is the freshly
 * resolved state, the same shape the GET returns, so callers replace their whole view
 * from it rather than patching one field.
 */
export async function setThemeFromMobile(
  theme: PremiumThemeKey | null,
  signal?: AbortSignal
): Promise<PremiumTheme> {
  try {
    const accessToken = await readAccessToken()
    const response = await withRequestTimeout(signal, (requestSignal) =>
      themeClient(accessToken).apiV1CommercePremiumThemePut(
        { updatePremiumThemeInput: { theme } },
        { signal: requestSignal }
      )
    )
    return updatePremiumThemeResponseSchema.parse(withResolvedTheme(response)).data
  } catch (error: unknown) {
    // Developer-facing. The section renders `commerce.premium.theme.saveError`.
    throw await themeError(error, 'Unable to save your interface palette.')
  }
}
