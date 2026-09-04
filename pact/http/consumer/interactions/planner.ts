// Story 5.5 premium 7-day outfit planner.
import type { PactV4, V3MockServer } from '@pact-foundation/pact'
import { createProviderState, setJsonContent } from '@seontechnologies/pactjs-utils'
import {
  PLANNER_DAY_CHANGED_MESSAGE,
  PREMIUM_PLANNER_DISABLED_MESSAGE,
  PREMIUM_REQUIRED_MESSAGE,
} from '@couture/api-client/contracts/http'
import { expect } from 'vitest'
import {
  isoTimestamp,
  like,
  nullValue,
  pactEventAuth,
  pactEventHeaders,
  string,
  type CreateClient,
} from './shared'

/* ---------------------------------------------------------------------------
 * Story 5.5 premium 7-day outfit planner.
 *
 * `GET /api/v1/commerce/premium/planner` and
 * `POST /api/v1/commerce/premium/planner/:planDate/reshuffle` both mount
 * `RequestAuthGuard` then `PremiumEntitlementGuard`, then call
 * `PlannerService.assertPlannerEnabled` before anything else -- so the
 * same 401 -> 403 -> 503 ordering `commerce-premium-theme.ts` and
 * `commerce-palette-advisor.ts` already record applies here too. What is
 * new to this contract, and what these interactions exist to pin, is the
 * required `x-couture-platform` header (mirrored below onto every request)
 * and the GET response's discriminated per-day union: a failed date reports
 * its own `status: 'error'` rather than shrinking the seven-item array,
 * which is why the partial-week interaction exists as its own case rather
 * than as a variant assertion on the ready-week one.
 *
 * Every identifier and date below is mirrored in
 * `pact/http/provider/doubles/planner.ts`. Both sides must agree or the
 * pinned `string()` matchers fail verification.
 *
 * PactV4's Rust FFI non-deterministically drops an interaction when more
 * than one `addInteraction()...executeTest()` chain is awaited inside one
 * test body (see `commerce-palette-advisor.ts`), which is why this module
 * exports one function per interaction plus a table for the two GET error
 * rows, rather than a single function that awaits all seven -- each
 * exported function is called from its own `it()`/`it.each()` case in
 * `web-api-client.pacttest.ts` and `mobile-api-client.pacttest.ts`.
 * ------------------------------------------------------------------------- */

const LOCATION_ID = 'loc-1'
const TIMEZONE = 'America/Chicago'
const ANCHOR_DATE = '2026-07-16'

/** The seven consecutive local dates AC 1 requires, hardcoded rather than
 * computed: this suite runs three times for determinism
 * (`scripts/check-pact-determinism.sh`), and literal dates carry no risk of
 * a timezone- or `Date`-arithmetic-sourced flake the way computing them at
 * import time would. */
const PLANNER_WINDOW = [
  '2026-07-16',
  '2026-07-17',
  '2026-07-18',
  '2026-07-19',
  '2026-07-20',
  '2026-07-21',
  '2026-07-22',
] as const

const PARTIAL_FAILURE_DATE = PLANNER_WINDOW[3]

type PlannerScenarioName = 'morning' | 'midday' | 'evening'
const SCENARIOS: readonly PlannerScenarioName[] = ['morning', 'midday', 'evening']

/**
 * One ready day's wire body, as Pact matchers. `dayIndex` 0 (the anchor
 * date) carries a non-empty `displayGarments` entry and a capsule, proving
 * that richer shape once; the other six days stay lean (empty
 * `displayGarments`/`autoFilledGarmentIds`, no capsule) since the shape is
 * already covered.
 */
function readyDayBody(planDate: string, dayIndex: number) {
  return {
    status: string('ready'),
    planDate: string(planDate),
    version: like(1),
    weather: {
      confidence: string('hourly'),
      freshness: string('fresh'),
      condition: string('clear'),
      temperatureLow: like(15),
      temperatureHigh: like(22),
    },
    isStarterWardrobe: like(false),
    outfits: SCENARIOS.map((scenario) => ({
      id: string(`${planDate}-${scenario}`),
      scenario: string(scenario),
      garmentIds: [string(`garment-${dayIndex}-${scenario}`)],
      reasoningBadges: [
        {
          key: string('wind_layer'),
          label: like('Wind layer'),
          bullets: like(['Wind is high']),
        },
      ],
      comfortNotes: like('Comfortable for the forecast.'),
      capsuleId: dayIndex === 0 ? string('capsule-1') : nullValue(),
      capsuleName: dayIndex === 0 ? like('Weekend Casual') : nullValue(),
      autoFilledGarmentIds: [],
      displayGarments:
        dayIndex === 0
          ? [
              {
                id: string(`garment-${dayIndex}-${scenario}`),
                category: string('top'),
                imageAccess: {
                  url: like('https://storage.couturecast.test/garment.jpg'),
                  expiresAt: isoTimestamp('2026-07-16T12:15:00.000Z'),
                },
              },
            ]
          : [],
      shopThisLook: nullValue(),
    })),
  }
}

function errorDayBody(planDate: string) {
  return {
    status: string('error'),
    planDate: string(planDate),
    errorCode: string('generation_failed'),
    retryable: like(true),
  }
}

/**
 * Provider endpoint: /api/v1/commerce/premium/planner -> GET PlannerController.getPlannerWindow
 *
 * Provider Scrutiny Evidence:
 * - Handler: apps/api/src/modules/personalization/planner.controller.ts (getPlannerWindow)
 * - Response type: PlannerResponse ({ data: { locationId, timezone, anchorDate, daysReady, days } })
 * - Status codes: 200 -- exactly seven unique, consecutive local dates
 *   (AC 1), every ready date carrying exactly three distinct scenario
 *   outfits (morning, midday, evening)
 * - Field names: `.strict()` on every object in `plannerResponseSchema`;
 *   `shopThisLook` is always `null` (Decision 4/5 -- planner affiliate
 *   behavior is out of scope)
 * - Cache-Control: `private, no-store`, inherited from
 *   `CommerceCacheHeadersMiddleware` over the whole `/api/v1/commerce`
 *   prefix even though the controller lives in `PersonalizationModule`
 *   (Decision 6)
 *
 * A fully ready seven-day window for an entitled user.
 */
export async function verifyPlannerReadyWeekInteraction(
  pact: PactV4,
  createClient: CreateClient
) {
  await pact
    .addInteraction()
    .given(
      ...createProviderState({
        name: 'A ready seven-day planner exists for user',
        params: { userId: pactEventAuth.userId },
      })
    )
    .uponReceiving('a request for a fully ready seven-day outfit planner')
    .withRequest(
      'GET',
      '/api/v1/commerce/premium/planner',
      setJsonContent({
        headers: { ...pactEventHeaders, 'x-couture-platform': 'web' },
        query: { locationId: LOCATION_ID },
      })
    )
    .willRespondWith(
      200,
      setJsonContent({
        headers: { 'Cache-Control': string('private, no-store') },
        body: {
          data: {
            locationId: string(LOCATION_ID),
            timezone: string(TIMEZONE),
            anchorDate: string(ANCHOR_DATE),
            daysReady: like(7),
            days: PLANNER_WINDOW.map((planDate, index) => readyDayBody(planDate, index)),
          },
        },
      })
    )
    .executeTest(async (mockServer: V3MockServer) => {
      const response = await createClient(mockServer).apiV1CommercePremiumPlannerGet({
        xCouturePlatform: 'web',
        locationId: LOCATION_ID,
      })

      expect(response.data.days).toHaveLength(7)
      expect(response.data.daysReady).toBe(7)
      expect(response.data.days.every((day) => day.status === 'ready')).toBe(true)
      expect(response.data.days.map((day) => day.planDate)).toEqual([...PLANNER_WINDOW])
      for (const day of response.data.days) {
        if (day.status !== 'ready') continue
        expect(day.outfits).toHaveLength(3)
        expect(new Set(day.outfits.map((outfit) => outfit.scenario)).size).toBe(3)
        expect(day.outfits.every((outfit) => outfit.shopThisLook === null)).toBe(true)
      }
    })
}

/**
 * Provider endpoint: /api/v1/commerce/premium/planner -> GET PlannerController.getPlannerWindow
 *
 * Provider Scrutiny Evidence: same handler/response type/status code as
 * {@link verifyPlannerReadyWeekInteraction}. AC 3's isolation rule is what
 * this interaction records: one date's generation failure degrades to that
 * date's own `error` result rather than failing (or shrinking) the whole
 * seven-day response, so the six other dates stay `ready` and visible.
 */
export async function verifyPlannerPartialWeekInteraction(
  pact: PactV4,
  createClient: CreateClient
) {
  await pact
    .addInteraction()
    .given(
      ...createProviderState({
        name: 'A seven-day planner with one failed day exists for user',
        params: { userId: pactEventAuth.userId },
      })
    )
    .uponReceiving(
      'a request for a seven-day outfit planner with one isolated day failure'
    )
    .withRequest(
      'GET',
      '/api/v1/commerce/premium/planner',
      setJsonContent({
        headers: { ...pactEventHeaders, 'x-couture-platform': 'web' },
        query: { locationId: LOCATION_ID },
      })
    )
    .willRespondWith(
      200,
      setJsonContent({
        headers: { 'Cache-Control': string('private, no-store') },
        body: {
          data: {
            locationId: string(LOCATION_ID),
            timezone: string(TIMEZONE),
            anchorDate: string(ANCHOR_DATE),
            daysReady: like(6),
            days: PLANNER_WINDOW.map((planDate, index) =>
              planDate === PARTIAL_FAILURE_DATE
                ? errorDayBody(planDate)
                : readyDayBody(planDate, index)
            ),
          },
        },
      })
    )
    .executeTest(async (mockServer: V3MockServer) => {
      const response = await createClient(mockServer).apiV1CommercePremiumPlannerGet({
        xCouturePlatform: 'web',
        locationId: LOCATION_ID,
      })

      expect(response.data.days).toHaveLength(7)
      expect(response.data.daysReady).toBe(6)
      const failedDay = response.data.days.find(
        (day) => day.planDate === PARTIAL_FAILURE_DATE
      )
      expect(failedDay).toEqual({
        status: 'error',
        planDate: PARTIAL_FAILURE_DATE,
        errorCode: 'generation_failed',
        retryable: true,
      })
      const readyDays = response.data.days.filter(
        (day) => day.planDate !== PARTIAL_FAILURE_DATE
      )
      expect(readyDays).toHaveLength(6)
      expect(readyDays.every((day) => day.status === 'ready')).toBe(true)
    })
}

/**
 * Decision 5/AC 5's ordered access gates, as table-driven error rows,
 * mirroring `paletteAdvisorErrorInteractions` exactly: `PremiumEntitlementGuard`
 * runs pre-handler, so a non-entitled caller always sees
 * `PREMIUM_REQUIRED_MESSAGE`; `PlannerService.assertPlannerEnabled` is the
 * first thing the service does once the guard passes, so only an entitled
 * caller can ever observe `PREMIUM_PLANNER_DISABLED_MESSAGE`.
 */
export type PlannerAccessErrorInteraction = {
  description: string
  state: string
  stateParams: Record<string, string>
  status: number
  message: string
  reason: string
}

export const plannerAccessErrorInteractions: PlannerAccessErrorInteraction[] = [
  {
    description: 'rejects a planner request from a non-entitled caller',
    state: 'The user does not have premium planner access',
    stateParams: { userId: pactEventAuth.userId },
    status: 403,
    message: PREMIUM_REQUIRED_MESSAGE,
    reason: 'Forbidden',
  },
  {
    description: 'reports the disabled premium planner as unavailable',
    state: 'The premium planner is disabled',
    stateParams: { userId: pactEventAuth.userId },
    status: 503,
    message: PREMIUM_PLANNER_DISABLED_MESSAGE,
    reason: 'Service Unavailable',
  },
]

/**
 * Provider endpoint: /api/v1/commerce/premium/planner -> GET PlannerController.getPlannerWindow
 *
 * Provider Scrutiny Evidence:
 * - Handler: apps/api/src/modules/personalization/planner.controller.ts (getPlannerWindow)
 * - Response type: the shared HTTP error envelope, `.strict()` over exactly
 *   `{ statusCode, message, error }`
 * - Status codes: 403 (`PremiumEntitlementGuard.canActivate`) outranking the
 *   service's own 503 (`PlannerService.assertPlannerEnabled`) -- the guard
 *   never lets a non-entitled caller reach the flag check at all
 */
export async function verifyPlannerAccessErrorInteraction(
  pact: PactV4,
  interaction: PlannerAccessErrorInteraction
) {
  await pact
    .addInteraction()
    .given(
      ...createProviderState({ name: interaction.state, params: interaction.stateParams })
    )
    .uponReceiving(`a planner request that ${interaction.description}`)
    .withRequest(
      'GET',
      '/api/v1/commerce/premium/planner',
      setJsonContent({
        headers: { ...pactEventHeaders, 'x-couture-platform': 'web' },
        query: { locationId: LOCATION_ID },
      })
    )
    .willRespondWith(
      interaction.status,
      setJsonContent({
        headers: { 'Cache-Control': string('private, no-store') },
        body: {
          statusCode: like(interaction.status),
          message: string(interaction.message),
          error: string(interaction.reason),
        },
      })
    )
    .executeTest(async (mockServer: V3MockServer) => {
      // The generated SDK throws on these statuses, so the request goes out
      // directly: what matters is the envelope the clients branch on.
      const response = await fetch(
        `${mockServer.url}/api/v1/commerce/premium/planner?locationId=${LOCATION_ID}`,
        {
          method: 'GET',
          headers: { ...pactEventHeaders, 'x-couture-platform': 'web' },
        }
      )

      expect(response.status).toBe(interaction.status)
      expect(response.headers.get('cache-control')).toBe('private, no-store')

      const payload = (await response.json()) as Record<string, unknown>
      expect(payload.message).toBe(interaction.message)
      expect(payload.error).toBe(interaction.reason)
    })
}

/**
 * Provider endpoint: /api/v1/commerce/premium/planner/{planDate}/reshuffle ->
 * POST PlannerController.reshuffleDay
 *
 * Provider Scrutiny Evidence:
 * - Handler: apps/api/src/modules/personalization/planner.controller.ts (reshuffleDay)
 * - Response type: PlannerReshuffleResponse ({ data: { day, unchanged } })
 * - Status codes: 200 (the route is `@HttpCode(200)`, not the Nest POST default 201)
 * - Field names: `{ expectedVersion }` in, `.strict()`; `day.version` moves
 *   forward from the request's `expectedVersion` (AC 4: version, source, and
 *   reshuffle count change atomically with the three scenarios)
 *
 * A successful reshuffle: the day changed, so `unchanged` is `false` and the
 * displayed version advances.
 */
export async function verifyPlannerReshuffleInteraction(
  pact: PactV4,
  createClient: CreateClient
) {
  const planDate = PLANNER_WINDOW[0]

  await pact
    .addInteraction()
    .given(
      ...createProviderState({
        name: 'A reshuffleable planner day exists for user',
        params: { userId: pactEventAuth.userId, planDate },
      })
    )
    .uponReceiving('a request to reshuffle one planner day')
    .withRequest(
      'POST',
      `/api/v1/commerce/premium/planner/${planDate}/reshuffle`,
      setJsonContent({
        headers: { ...pactEventHeaders, 'x-couture-platform': 'web' },
        query: { locationId: LOCATION_ID },
        body: { expectedVersion: 1 },
      })
    )
    .willRespondWith(
      200,
      setJsonContent({
        headers: { 'Cache-Control': string('private, no-store') },
        body: {
          data: {
            day: readyDayBody(planDate, 0),
            unchanged: like(false),
          },
        },
      })
    )
    .executeTest(async (mockServer: V3MockServer) => {
      const response = await createClient(
        mockServer
      ).apiV1CommercePremiumPlannerPlanDateReshufflePost({
        planDate,
        xCouturePlatform: 'web',
        locationId: LOCATION_ID,
        plannerReshuffleInput: { expectedVersion: 1 },
      })

      expect(response.data.unchanged).toBe(false)
      expect(response.data.day.status).toBe('ready')
      expect(response.data.day.planDate).toBe(planDate)
      expect(response.data.day.outfits).toHaveLength(3)
    })
}

/**
 * Provider endpoint: /api/v1/commerce/premium/planner/{planDate}/reshuffle ->
 * POST PlannerController.reshuffleDay
 *
 * Provider Scrutiny Evidence: same handler/response type/status code as
 * {@link verifyPlannerReshuffleInteraction}. AC 4's exact rule: `unchanged`
 * is `true` only when no disjoint result was available and every scenario
 * garment set and capsule choice comes back identical to the displayed
 * result -- distinct from a version conflict, which is a 409 rather than a
 * 200 with `unchanged: true`.
 */
export async function verifyPlannerReshuffleUnchangedInteraction(
  pact: PactV4,
  createClient: CreateClient
) {
  const planDate = PLANNER_WINDOW[0]

  await pact
    .addInteraction()
    .given(
      ...createProviderState({
        name: 'A reshuffle with no disjoint result exists for user',
        params: { userId: pactEventAuth.userId, planDate },
      })
    )
    .uponReceiving(
      'a request to reshuffle a planner day with no disjoint result available'
    )
    .withRequest(
      'POST',
      `/api/v1/commerce/premium/planner/${planDate}/reshuffle`,
      setJsonContent({
        headers: { ...pactEventHeaders, 'x-couture-platform': 'web' },
        query: { locationId: LOCATION_ID },
        body: { expectedVersion: 1 },
      })
    )
    .willRespondWith(
      200,
      setJsonContent({
        headers: { 'Cache-Control': string('private, no-store') },
        body: {
          data: {
            day: readyDayBody(planDate, 0),
            unchanged: like(true),
          },
        },
      })
    )
    .executeTest(async (mockServer: V3MockServer) => {
      const response = await createClient(
        mockServer
      ).apiV1CommercePremiumPlannerPlanDateReshufflePost({
        planDate,
        xCouturePlatform: 'web',
        locationId: LOCATION_ID,
        plannerReshuffleInput: { expectedVersion: 1 },
      })

      expect(response.data.unchanged).toBe(true)
      expect(response.data.day.status).toBe('ready')
    })
}

/**
 * Provider endpoint: /api/v1/commerce/premium/planner/{planDate}/reshuffle ->
 * POST PlannerController.reshuffleDay
 *
 * Provider Scrutiny Evidence:
 * - Handler: apps/api/src/modules/personalization/planner.controller.ts (reshuffleDay)
 * - Response type: the shared HTTP error envelope, `.strict()` over exactly
 *   `{ statusCode, message, error }`
 * - Status codes: 409 -- `PlannerService.reshuffleDay`'s `updateMany` with a
 *   `version` predicate matched zero rows, meaning the displayed
 *   `expectedVersion` is stale (AC 4). The client's documented recovery is
 *   to refetch that date rather than retry the reshuffle blindly.
 */
export async function verifyPlannerReshuffleConflictInteraction(pact: PactV4) {
  const planDate = PLANNER_WINDOW[0]

  await pact
    .addInteraction()
    .given(
      ...createProviderState({
        name: 'A planner day changed since the client last viewed it',
        params: { userId: pactEventAuth.userId, planDate },
      })
    )
    .uponReceiving('a request to reshuffle a planner day at a stale version')
    .withRequest(
      'POST',
      `/api/v1/commerce/premium/planner/${planDate}/reshuffle`,
      setJsonContent({
        headers: { ...pactEventHeaders, 'x-couture-platform': 'web' },
        query: { locationId: LOCATION_ID },
        body: { expectedVersion: 1 },
      })
    )
    .willRespondWith(
      409,
      setJsonContent({
        headers: { 'Cache-Control': string('private, no-store') },
        body: {
          statusCode: like(409),
          message: string(PLANNER_DAY_CHANGED_MESSAGE),
          error: string('Conflict'),
        },
      })
    )
    .executeTest(async (mockServer: V3MockServer) => {
      // The generated SDK throws on 409, so the request goes out directly.
      const response = await fetch(
        `${mockServer.url}/api/v1/commerce/premium/planner/${planDate}/reshuffle?locationId=${LOCATION_ID}`,
        {
          method: 'POST',
          headers: {
            ...pactEventHeaders,
            'x-couture-platform': 'web',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ expectedVersion: 1 }),
        }
      )

      expect(response.status).toBe(409)
      expect(response.headers.get('cache-control')).toBe('private, no-store')

      const payload = (await response.json()) as Record<string, unknown>
      expect(payload.message).toBe(PLANNER_DAY_CHANGED_MESSAGE)
      expect(payload.error).toBe('Conflict')
    })
}
