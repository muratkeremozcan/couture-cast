// Story 5.5 Task 7 owner: the web app's premium 7-day outfit planner client.
//
// Mirrors `palette-advisor.ts` deliberately: the same `sessionStorage` bearer
// token, the same `.strict()`-envelope message reading, Zod-parsed responses
// at the trust boundary, and a classified failure reason rather than a
// server-supplied English string. Every message this module can surface
// (`PREMIUM_REQUIRED_MESSAGE`, `PREMIUM_PLANNER_DISABLED_MESSAGE`,
// `PLANNER_DAY_CHANGED_MESSAGE`, a transport error's text) is untranslated
// English, and rendering any of them would show a `tr-TR` or `de-DE` reader
// English on exactly the paths `commerce.premium.planner.*` already carries
// translated copy for. So the reason travels and the words do not:
// `planner-rail.tsx` maps each member onto a `commerce.premium.planner.*` key
// or onto a state change.
//
// No timeout wrapper, following `palette-advisor.ts` (Decision 14): the web
// app has no shared `withRequestTimeout`. Callers pass an `AbortSignal`
// instead.
'use client'

import {
  plannerResponseSchema,
  plannerReshuffleResponseSchema,
  PREMIUM_PLANNER_DISABLED_MESSAGE,
  PLANNER_DAY_CHANGED_MESSAGE,
  PREMIUM_REQUIRED_MESSAGE,
  type PlannerReadyDay,
  type PlannerResponse,
} from '@couture/api-client/contracts/http'
import { ResponseError } from '@couture/api-client'
import { createWebApiClient } from './api-client'
import { WEB_ACCESS_TOKEN_STORAGE_KEY } from './wardrobe'

// One sessionStorage truth for "is there a web session": the commerce,
// premium, premium-theme and palette-advisor helpers all read the same key,
// and a fifth copy of the check would let them drift.
export { hasWebSession } from './commerce'

/**
 * Why a call failed, in terms the rail can act on without reading English
 * prose.
 *
 * `not_entitled` and `location_not_owned` are both a 403, and they mean
 * completely different things to a reader: one is "subscribe", the other is
 * an internal-state mismatch (a saved location deleted or reassigned out from
 * under a stale request) the reader cannot fix by clicking anything on this
 * card. `reasonForResponse` reads the server's own `PREMIUM_REQUIRED_MESSAGE`
 * constant -- imported from the contract, never retyped -- to tell them
 * apart; any other 403 text falls back to `location_not_owned`, since
 * `PremiumEntitlementGuard` runs before the handler and always sends the
 * former for a plain entitlement failure.
 */
export type PlannerFailureReason =
  | 'signed_out'
  | 'not_entitled'
  | 'location_not_owned'
  | 'disabled'
  | 'conflict'
  | 'unknown'

/**
 * Thrown for every failure these wrappers surface, so a caller can tell an
 * API failure apart from a programming error without matching on message
 * text.
 *
 * `message` is developer-facing throughout: it carries the server's own text
 * when there is one so a log line or a failing test names the real cause. UI
 * code reads {@link PlannerRequestError.reason} instead.
 */
export class PlannerRequestError extends Error {
  readonly reason: PlannerFailureReason

  constructor(reason: PlannerFailureReason, message: string) {
    super(message)
    this.name = 'PlannerRequestError'
    this.reason = reason
  }
}

/**
 * Fallback for a call made with no session. The rail checks `hasWebSession()`
 * first and renders the locked panel instead, so this string is a guard
 * against a caller that skipped that check rather than user-facing copy --
 * which is why it has no catalog entry and why the rail reads the
 * `signed_out` reason rather than this text.
 */
export const PLANNER_SIGNED_OUT_MESSAGE = 'Sign in to use the outfit planner.'

function readAccessToken(): string {
  const token =
    typeof window === 'undefined'
      ? null
      : (window.sessionStorage.getItem(WEB_ACCESS_TOKEN_STORAGE_KEY)?.trim() ?? null)
  if (!token) {
    throw new PlannerRequestError('signed_out', PLANNER_SIGNED_OUT_MESSAGE)
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

/**
 * Status plus server message, mapped onto a reason.
 *
 * 401 and 403 are separated deliberately, matching the guard order Decision 6
 * fixes (`RequestAuthGuard` then `PremiumEntitlementGuard`): a caller who
 * never authenticated cannot reach the entitlement check at all, so 401 is
 * always `signed_out`.
 */
function reasonForResponse(status: number, message: string): PlannerFailureReason {
  if (status === 401) return 'signed_out'
  if (status === 403) {
    return message.includes(PREMIUM_REQUIRED_MESSAGE)
      ? 'not_entitled'
      : 'location_not_owned'
  }
  if (status === 409) {
    return message.includes(PLANNER_DAY_CHANGED_MESSAGE) ? 'conflict' : 'unknown'
  }
  if (status === 503) {
    return message.includes(PREMIUM_PLANNER_DISABLED_MESSAGE) ? 'disabled' : 'unknown'
  }
  return 'unknown'
}

async function plannerError(
  error: unknown,
  fallback: string
): Promise<PlannerRequestError> {
  // `readAccessToken` already threw a classified error; re-wrapping it would
  // lose the `signed_out` reason and re-open the untranslated-message path.
  if (error instanceof PlannerRequestError) {
    return error
  }
  if (error instanceof ResponseError) {
    const message = await readServerMessage(error.response, fallback)
    return new PlannerRequestError(
      reasonForResponse(error.response.status, message),
      message
    )
  }
  // Anything else is a transport failure, an abort, or a contract-parse
  // failure. The message those carry is the useful one for a log; the reason
  // stays `unknown` so the rail falls back to its own translated copy.
  return new PlannerRequestError(
    'unknown',
    error instanceof Error ? error.message : fallback
  )
}

/**
 * The reason behind a rejection from this module, for UI code that has to
 * choose a translated string or a state transition.
 *
 * Anything that is not one of this module's own errors reads as `unknown`,
 * which is the conservative answer: the caller shows its generic translated
 * message rather than guessing at entitlement or flag state from a failure it
 * cannot classify.
 */
export function plannerFailureReason(error: unknown): PlannerFailureReason {
  return error instanceof PlannerRequestError ? error.reason : 'unknown'
}

/**
 * Reads (or generates, on a cold or invalidated read) the seven-date planner
 * window for the caller's owned saved location.
 *
 * No `locale` is ever sent: the generated client's `Accept-Language` default
 * already carries the reader's locale, matching `palette-advisor.ts` and
 * every other web wrapper in this module family. `locationId` is omitted too
 * -- Task 7 ships no location picker, so the server always resolves the
 * caller's primary or first saved location (Decision 2).
 */
export async function getPlannerFromWeb(
  signal?: AbortSignal
): Promise<PlannerResponse['data']> {
  const accessToken = readAccessToken()
  try {
    const response = await createWebApiClient({
      accessToken,
    }).apiV1CommercePremiumPlannerGet({ xCouturePlatform: 'web' }, { signal })
    return plannerResponseSchema.parse(response).data
  } catch (error: unknown) {
    // Developer-facing. The rail renders `commerce.premium.planner.loadError`.
    throw await plannerError(error, 'Unable to load the outfit planner.')
  }
}

/**
 * Regenerates one date, preferring capsules and garments absent from the
 * currently displayed result.
 *
 * `expectedVersion` guards a stale reshuffle: a concurrent update since the
 * displayed version returns `conflict`, and the caller is expected to
 * re-fetch the whole window with {@link getPlannerFromWeb} (there is no
 * single-date `GET`).
 */
/**
 * `en-US` sees Fahrenheit, every other locale sees Celsius. Mirrors
 * `apps/mobile/src/lib/formatters.ts`'s `getTemperatureUnit`/`formatTemperature`
 * exactly, so the same reader sees the same number on both platforms. Neither
 * app shares this into `packages/utils`, following the existing per-app
 * duplication `palette-advisor.ts`'s header comment already accepts for
 * web-only helpers this small.
 */
export function getPlannerTemperatureUnit(locale: string): 'F' | 'C' {
  return locale === 'en-US' ? 'F' : 'C'
}

/** The contract's `temperatureLow`/`temperatureHigh` are always Celsius; this is the display boundary Decision 3 refers to. */
export function formatPlannerTemperature(celsius: number, locale: string): string {
  if (getPlannerTemperatureUnit(locale) === 'F') {
    return `${Math.round((celsius * 9) / 5 + 32)}°F`
  }
  return `${Math.round(celsius)}°C`
}

/**
 * A locale-aware weekday/date label for a `YYYY-MM-DD` `planDate`.
 *
 * `timeZone: 'UTC'` is load-bearing, not decorative: `planDate` is a
 * date-only calendar label (Decision 2), and formatting it in the reader's
 * local zone instead would roll it back a day for any negative UTC offset.
 * The `T00:00:00Z` suffix keeps `Date`'s parse unambiguous across engines
 * rather than relying on the date-only ISO fast path.
 */
export function formatPlannerDateLabel(planDate: string, locale: string): string {
  const date = new Date(`${planDate}T00:00:00Z`)
  return new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(date)
}

export async function reshufflePlannerDayFromWeb(
  planDate: string,
  expectedVersion: number,
  signal?: AbortSignal
): Promise<{ day: PlannerReadyDay; unchanged: boolean }> {
  const accessToken = readAccessToken()
  try {
    const response = await createWebApiClient({
      accessToken,
    }).apiV1CommercePremiumPlannerPlanDateReshufflePost(
      {
        planDate,
        xCouturePlatform: 'web',
        plannerReshuffleInput: { expectedVersion },
      },
      { signal }
    )
    return plannerReshuffleResponseSchema.parse(response).data
  } catch (error: unknown) {
    throw await plannerError(error, 'Unable to reshuffle this day.')
  }
}
