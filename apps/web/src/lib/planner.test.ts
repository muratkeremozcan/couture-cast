// Story 5.5 Task 7 owner: the web planner client.
//
// `planner-rail.test.tsx` covers what the rail renders for each state. These
// cover the one thing the rail cannot see: how a rejection is classified.
// `not_entitled` and `location_not_owned` are both a 403, `conflict` and an
// unrecognised 409 are both a 409, `disabled` and an unrecognised 503 are
// both a 503 -- only the server's own message constants tell them apart, and
// getting that wrong turns "subscribe" into "try again" or the reverse.
import { http, HttpResponse } from 'msw'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  PLANNER_DAY_CHANGED_MESSAGE,
  PREMIUM_PLANNER_DISABLED_MESSAGE,
  PREMIUM_REQUIRED_MESSAGE,
} from '@couture/api-client/contracts/http'
import { useMswHandlers } from '../test-utils/msw/runtime'
import { WEB_ACCESS_TOKEN_STORAGE_KEY } from './wardrobe'
import {
  formatPlannerDateLabel,
  formatPlannerTemperature,
  getPlannerFromWeb,
  getPlannerTemperatureUnit,
  plannerFailureReason,
  reshufflePlannerDayFromWeb,
} from './planner'

const PLANNER_PATH = '/api/v1/commerce/premium/planner'
const RESHUFFLE_PATH = `${PLANNER_PATH}/2026-09-10/reshuffle`

function signIn() {
  window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, 'test-access-token')
}

function errorBody(statusCode: number, message: string, error: string) {
  return HttpResponse.json({ statusCode, message, error }, { status: statusCode })
}

function buildOutfit(scenario: 'morning' | 'midday' | 'evening') {
  return {
    id: `2026-09-10-${scenario}`,
    scenario,
    garmentIds: [],
    reasoningBadges: [],
    comfortNotes: 'Layer up.',
    capsuleId: null,
    capsuleName: null,
    autoFilledGarmentIds: [],
    displayGarments: [],
    shopThisLook: null,
  }
}

const readyDayBody = {
  status: 'ready' as const,
  planDate: '2026-09-10',
  version: 1,
  weather: {
    confidence: 'hourly' as const,
    freshness: 'fresh' as const,
    condition: 'clear' as const,
    temperatureLow: 15,
    temperatureHigh: 22,
  },
  isStarterWardrobe: false,
  outfits: (['morning', 'midday', 'evening'] as const).map(buildOutfit),
}

describe('web planner client (Story 5.5)', () => {
  beforeEach(() => {
    window.sessionStorage.clear()
  })

  it('classifies a call with no session as signed_out without a request', async () => {
    await expect(getPlannerFromWeb()).rejects.toSatisfy(
      (error: unknown) => plannerFailureReason(error) === 'signed_out'
    )
  })

  it('classifies 401 as signed_out', async () => {
    signIn()
    useMswHandlers(http.get(PLANNER_PATH, () => errorBody(401, 'nope', 'Unauthorized')))

    await expect(getPlannerFromWeb()).rejects.toSatisfy(
      (error: unknown) => plannerFailureReason(error) === 'signed_out'
    )
  })

  /**
   * `PremiumEntitlementGuard` runs pre-handler and always sends
   * `PREMIUM_REQUIRED_MESSAGE` for a plain entitlement failure (Decision 6),
   * so any other 403 text is the location-ownership branch instead.
   */
  it('separates the entitlement 403 from an unrecognised 403', async () => {
    signIn()
    useMswHandlers(
      http.get(PLANNER_PATH, () => errorBody(403, PREMIUM_REQUIRED_MESSAGE, 'Forbidden'))
    )
    await expect(getPlannerFromWeb()).rejects.toSatisfy(
      (error: unknown) => plannerFailureReason(error) === 'not_entitled'
    )

    useMswHandlers(
      http.get(PLANNER_PATH, () => errorBody(403, 'Location not found', 'Forbidden'))
    )
    await expect(getPlannerFromWeb()).rejects.toSatisfy(
      (error: unknown) => plannerFailureReason(error) === 'location_not_owned'
    )
  })

  it('classifies 503 as disabled only when the message matches', async () => {
    signIn()
    useMswHandlers(
      http.get(PLANNER_PATH, () =>
        errorBody(503, PREMIUM_PLANNER_DISABLED_MESSAGE, 'Service Unavailable')
      )
    )
    await expect(getPlannerFromWeb()).rejects.toSatisfy(
      (error: unknown) => plannerFailureReason(error) === 'disabled'
    )

    useMswHandlers(
      http.get(PLANNER_PATH, () =>
        errorBody(503, 'Database unreachable', 'Service Unavailable')
      )
    )
    await expect(getPlannerFromWeb()).rejects.toSatisfy(
      (error: unknown) => plannerFailureReason(error) === 'unknown'
    )
  })

  it('classifies a reshuffle 409 as conflict only when the message matches', async () => {
    signIn()
    useMswHandlers(
      http.post(RESHUFFLE_PATH, () =>
        errorBody(409, PLANNER_DAY_CHANGED_MESSAGE, 'Conflict')
      )
    )
    await expect(reshufflePlannerDayFromWeb('2026-09-10', 1)).rejects.toSatisfy(
      (error: unknown) => plannerFailureReason(error) === 'conflict'
    )

    useMswHandlers(
      http.post(RESHUFFLE_PATH, () => errorBody(409, 'Unrelated conflict', 'Conflict'))
    )
    await expect(reshufflePlannerDayFromWeb('2026-09-10', 1)).rejects.toSatisfy(
      (error: unknown) => plannerFailureReason(error) === 'unknown'
    )
  })

  it('reshuffles a day and returns the live response', async () => {
    signIn()
    useMswHandlers(
      http.post(RESHUFFLE_PATH, () =>
        HttpResponse.json({ data: { day: readyDayBody, unchanged: false } })
      )
    )

    const result = await reshufflePlannerDayFromWeb('2026-09-10', 1)
    expect(result.unchanged).toBe(false)
    expect(result.day.planDate).toBe('2026-09-10')
  })

  /** A malformed (non-JSON) error body falls back to the caller's own message. */
  it('falls back to the developer-facing message on a malformed error body', async () => {
    signIn()
    useMswHandlers(
      http.get(
        PLANNER_PATH,
        () => new HttpResponse('not json', { status: 500, headers: {} })
      )
    )

    await expect(getPlannerFromWeb()).rejects.toThrow(
      'Unable to load the outfit planner.'
    )
  })

  it('reads unknown for a plain, unclassified error', () => {
    expect(plannerFailureReason(new Error('boom'))).toBe('unknown')
  })

  it('en-US sees Fahrenheit and every other locale sees Celsius', () => {
    expect(getPlannerTemperatureUnit('en-US')).toBe('F')
    expect(getPlannerTemperatureUnit('de-DE')).toBe('C')

    expect(formatPlannerTemperature(0, 'en-US')).toBe('32°F')
    expect(formatPlannerTemperature(0, 'de-DE')).toBe('0°C')
  })

  /**
   * `timeZone: 'UTC'` is the assertion subject: formatting in the reader's
   * local zone instead would roll this date back to Jan 4 for any reader west
   * of UTC.
   */
  it('formats a planDate as its own calendar date regardless of local timezone', () => {
    expect(formatPlannerDateLabel('2026-01-05', 'en-US')).toContain('Jan')
    expect(formatPlannerDateLabel('2026-01-05', 'en-US')).toContain('5')
  })
})
