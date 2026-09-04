import type { PlannerService } from '../../../../apps/api/src/modules/personalization/planner.service'
import {
  PLANNER_DAY_CHANGED_MESSAGE,
  PREMIUM_PLANNER_DISABLED_MESSAGE,
  type PlannerDayResult,
  type PlannerReadyDay,
  type PlannerResponse,
  type PlannerReshuffleResponse,
} from '@couture/api-client/contracts/http'
import { ConflictException, ServiceUnavailableException } from '@nestjs/common'
import { getProviderPlannerState } from '../state'

/**
 * Provider double for the premium planner surface (Story 5.5).
 *
 * The shape follows `doubles/palette-advisor.ts`: a scenario-driven double
 * for the whole service (not the weather/wardrobe/generation-engine
 * internals it composes), with the real `PremiumEntitlementGuard` left
 * un-mocked so the `not-entitled` scenario produces the 403 the contract
 * records rather than a hand-written one.
 *
 * `PlannerService.assertPlannerEnabled`'s flag check is reproduced here as
 * the `disabled` scenario's 503: it is the first thing both
 * `getPlannerWindow` and `reshuffleDay` do in the real service, so this
 * double checks it first too, in both methods.
 *
 * Every date and identifier below is mirrored in
 * `pact/http/consumer/interactions/planner.ts`. Both sides must agree or the
 * pinned `string()` matchers fail verification.
 */

const LOCATION_ID = 'loc-1'
const TIMEZONE = 'America/Chicago'
const ANCHOR_DATE = '2026-07-16'

/** Hardcoded rather than computed, exactly like the consumer fixture: no
 * `Date` arithmetic, no risk of a timezone-sourced mismatch between the two
 * sides of this contract. */
const PLANNER_WINDOW = [
  '2026-07-16',
  '2026-07-17',
  '2026-07-18',
  '2026-07-19',
  '2026-07-20',
  '2026-07-21',
  '2026-07-22',
] as const

const PARTIAL_FAILURE_DATE: string = PLANNER_WINDOW[3]

type PlannerScenarioName = 'morning' | 'midday' | 'evening'
const SCENARIOS: readonly PlannerScenarioName[] = ['morning', 'midday', 'evening']

function buildReadyDay(
  planDate: string,
  dayIndex: number,
  version: number
): PlannerReadyDay {
  return {
    status: 'ready',
    planDate,
    version,
    weather: {
      confidence: 'hourly',
      freshness: 'fresh',
      condition: 'clear',
      temperatureLow: 15,
      temperatureHigh: 22,
    },
    isStarterWardrobe: false,
    outfits: SCENARIOS.map((scenario) => ({
      id: `${planDate}-${scenario}`,
      scenario,
      garmentIds: [`garment-${dayIndex}-${scenario}`],
      reasoningBadges: [
        { key: 'wind_layer', label: 'Wind layer', bullets: ['Wind is high'] },
      ],
      comfortNotes: 'Comfortable for the forecast.',
      capsuleId: dayIndex === 0 ? 'capsule-1' : null,
      capsuleName: dayIndex === 0 ? 'Weekend Casual' : null,
      autoFilledGarmentIds: [],
      displayGarments:
        dayIndex === 0
          ? [
              {
                id: `garment-${dayIndex}-${scenario}`,
                category: 'top' as const,
                imageAccess: {
                  url: 'https://storage.couturecast.test/garment.jpg',
                  expiresAt: '2026-07-16T12:15:00.000Z',
                },
              },
            ]
          : [],
      shopThisLook: null,
    })),
  }
}

function buildErrorDay(planDate: string): PlannerDayResult {
  return { status: 'error', planDate, errorCode: 'generation_failed', retryable: true }
}

function buildReadyWeekResponse(): PlannerResponse {
  return {
    data: {
      locationId: LOCATION_ID,
      timezone: TIMEZONE,
      anchorDate: ANCHOR_DATE,
      daysReady: 7,
      days: PLANNER_WINDOW.map((planDate, index) => buildReadyDay(planDate, index, 1)),
    },
  }
}

function buildPartialWeekResponse(): PlannerResponse {
  const readyDays = PLANNER_WINDOW.filter((planDate) => planDate !== PARTIAL_FAILURE_DATE)
  return {
    data: {
      locationId: LOCATION_ID,
      timezone: TIMEZONE,
      anchorDate: ANCHOR_DATE,
      daysReady: readyDays.length,
      days: PLANNER_WINDOW.map((planDate, index) =>
        planDate === PARTIAL_FAILURE_DATE
          ? buildErrorDay(planDate)
          : buildReadyDay(planDate, index, 1)
      ),
    },
  }
}

export function createPlannerDoubles() {
  const scenarioOf = () => getProviderPlannerState()?.scenario ?? 'ready-week'

  /** `PlannerService.assertPlannerEnabled` runs before anything else in both
   * `getPlannerWindow` and `reshuffleDay`. */
  const assertEnabled = () => {
    if (scenarioOf() === 'disabled') {
      throw new ServiceUnavailableException(PREMIUM_PLANNER_DISABLED_MESSAGE)
    }
  }

  const mockPlannerService = {
    getPlannerWindow: (): Promise<PlannerResponse> => {
      assertEnabled()
      return Promise.resolve(
        scenarioOf() === 'partial-week'
          ? buildPartialWeekResponse()
          : buildReadyWeekResponse()
      )
    },
    reshuffleDay: (
      _userId: string,
      planDate: string
    ): Promise<PlannerReshuffleResponse> => {
      assertEnabled()
      const scenario = scenarioOf()
      // Story 5.5 AC 4: a stale `expectedVersion` is a 409, never a 200.
      if (scenario === 'reshuffle-conflict') {
        throw new ConflictException(PLANNER_DAY_CHANGED_MESSAGE)
      }
      const day = buildReadyDay(planDate, 0, 2)
      const unchanged = scenario === 'reshuffle-unchanged'
      return Promise.resolve({ data: { day, unchanged } })
    },
  } as unknown as PlannerService

  return { mockPlannerService }
}
