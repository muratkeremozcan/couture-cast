// Story 5.5 Task 8 owner: the mobile 7-day outfit planner client.
//
// Follows `premium-theme.ts` and `palette-advisor.ts` exactly: the same
// `readAccessToken` pre-check so a signed-out reader gets `signed_out` without a wasted
// round trip, the same `.strict()` envelope parsing at the trust boundary, the same "the
// reason travels and the words do not" rule -- every message this module can produce is
// untranslated English (the server's own `PREMIUM_REQUIRED_MESSAGE`,
// `PREMIUM_PLANNER_DISABLED_MESSAGE`, `PLANNER_DAY_CHANGED_MESSAGE`, or a transport
// error's text), and `planner-screen.tsx` maps every reason onto a
// `commerce.premium.planner.*` key or onto a state change instead of rendering it.
//
// `x-couture-platform: 'mobile'` rides on every request as a required request field
// (Decision 5/6), never a client toggle: it drives the `platform` property on both
// `premium_planner_viewed` and `premium_planner_day_reshuffled` analytics events
// server-side.
import {
  plannerResponseSchema,
  plannerReshuffleResponseSchema,
  PLANNER_DAY_CHANGED_MESSAGE,
  PREMIUM_PLANNER_DISABLED_MESSAGE,
  type PlannerResponse,
  type PlannerReshuffleResponse,
  type SupportedLocale,
} from '@couture/api-client/contracts/http'
import { ResponseError } from '@couture/api-client'
import { createMobileApiClient } from './api-client'
import { withRequestTimeout } from './commerce'
import { resolveMobileAccessToken } from './mobile-auth'

/**
 * Why a call failed, in terms the screen can act on without reading English prose.
 *
 * `version_conflict` only ever comes from a reshuffle: the GET route has no version to
 * be stale against. Kept in the same union rather than a second one because every other
 * member and every caller of {@link plannerFailureReason} is shared between the two
 * requests, and a caller that never reshuffles simply never sees it.
 */
export type PlannerFailureReason =
  | 'signed_out'
  | 'not_entitled'
  | 'disabled'
  | 'version_conflict'
  | 'unknown'

/**
 * Thrown for every failure these wrappers surface, so a caller can tell an API failure
 * apart from a programming error without matching on message text.
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
 * Fallback for a call made with no session. Developer-facing, with no catalog entry:
 * the screen reads the `signed_out` reason and renders its own translated locked panel.
 */
export const PLANNER_SIGNED_OUT_MESSAGE = 'Sign in to use the 7-day planner.'

async function readAccessToken(): Promise<string> {
  const token = (await resolveMobileAccessToken())?.trim()
  if (!token) {
    throw new PlannerRequestError('signed_out', PLANNER_SIGNED_OUT_MESSAGE)
  }
  return token
}

function plannerClient(accessToken: string) {
  return createMobileApiClient({ accessToken })
}

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
 * The status codes both routes answer with, mapped onto reasons.
 *
 * 401 and 403 are separated the same way `premium-theme.ts` separates them:
 * `RequestAuthGuard` runs before `PremiumEntitlementGuard` (Decision 6), so a 403 is
 * always "signed in, not entitled" and never "not signed in". 409 only reaches
 * reshuffle callers; a message check distinguishes it from any other conflict this
 * route might one day answer with.
 */
function reasonForResponse(status: number, message: string): PlannerFailureReason {
  if (status === 401) return 'signed_out'
  if (status === 403) return 'not_entitled'
  if (status === 503) {
    return message.includes(PREMIUM_PLANNER_DISABLED_MESSAGE) ? 'disabled' : 'unknown'
  }
  if (status === 409) {
    return message.includes(PLANNER_DAY_CHANGED_MESSAGE) ? 'version_conflict' : 'unknown'
  }
  return 'unknown'
}

async function plannerError(
  error: unknown,
  fallback: string
): Promise<PlannerRequestError> {
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
  // Anything else is a transport failure, a timeout, an abort, or a contract-parse
  // failure. The message those carry is the useful one for a log; the reason stays
  // `unknown` so the screen falls back to its own translated copy.
  return new PlannerRequestError(
    'unknown',
    error instanceof Error ? error.message : fallback
  )
}

/**
 * The reason behind a rejection from this module, for UI code that has to choose a
 * translated string or a state transition.
 */
export function plannerFailureReason(error: unknown): PlannerFailureReason {
  return error instanceof PlannerRequestError ? error.reason : 'unknown'
}

export interface GetPlannerOptions {
  /** Omitted to select the user's primary or first saved location (Decision 2). */
  locationId?: string
  locale?: SupportedLocale
  signal?: AbortSignal
}

export async function getPlannerFromMobile({
  locationId,
  locale,
  signal,
}: GetPlannerOptions): Promise<PlannerResponse['data']> {
  try {
    const accessToken = await readAccessToken()
    const response = await withRequestTimeout(signal, (requestSignal) =>
      plannerClient(accessToken).apiV1CommercePremiumPlannerGet(
        { xCouturePlatform: 'mobile', locationId, locale },
        { signal: requestSignal }
      )
    )
    return plannerResponseSchema.parse(response).data
  } catch (error: unknown) {
    throw await plannerError(error, 'Unable to load your weekly planner.')
  }
}

export interface ReshufflePlannerDayOptions {
  planDate: string
  expectedVersion: number
  /**
   * Passed through unchanged from the GET response's resolved `locationId`, so the
   * reshuffle targets the exact same stored row GET did (Decision 2). Omitting it here
   * while GET resolved a non-primary location would target the wrong location's plan.
   */
  locationId?: string
  locale?: SupportedLocale
  signal?: AbortSignal
}

/**
 * `planDate` as the reader's own language writes a short weekday-and-date label.
 *
 * Built from the validated `YYYY-MM-DD` parts through `Date.UTC` and formatted with
 * `timeZone: 'UTC'` rather than `new Date(planDate)` read in the device's local zone --
 * the same rule `hourly-forecast-ribbon.tsx` follows for the contract's other date-only
 * values. Without the explicit UTC round trip, a reader west of Greenwich would see
 * every date shifted a day earlier near local midnight.
 */
export function formatPlannerDayLabel(planDate: string, locale: string): string {
  const parts = planDate.split('-').map(Number)
  const date = new Date(Date.UTC(parts[0] ?? 1970, (parts[1] ?? 1) - 1, parts[2] ?? 1))
  return new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(date)
}

export async function reshufflePlannerDayFromMobile({
  planDate,
  expectedVersion,
  locationId,
  locale,
  signal,
}: ReshufflePlannerDayOptions): Promise<PlannerReshuffleResponse['data']> {
  try {
    const accessToken = await readAccessToken()
    const response = await withRequestTimeout(signal, (requestSignal) =>
      plannerClient(accessToken).apiV1CommercePremiumPlannerPlanDateReshufflePost(
        {
          planDate,
          xCouturePlatform: 'mobile',
          plannerReshuffleInput: { expectedVersion },
          locationId,
          locale,
        },
        { signal: requestSignal }
      )
    )
    return plannerReshuffleResponseSchema.parse(response).data
  } catch (error: unknown) {
    throw await plannerError(error, 'Unable to reshuffle this day. Try again.')
  }
}
