// Story 5.5 Task 8 owner: the mobile 7-day outfit planner screen.
//
// The mobile counterpart of the (forthcoming) `apps/web/src/app/components/planner-rail`
// live-data suite. The network boundary stays REAL and is driven through MSW, following
// `palette-advisor-screen.test.tsx`: the screen's whole job is turning HTTP outcomes into
// rendered states, and several of those states (403 not-entitled, 503 disabled, 409
// conflict) are reached only by a real rejected request, so stubbing `src/lib/planner`
// would leave exactly the interesting half unproven.
/* eslint-disable @typescript-eslint/await-thenable */
import { http, HttpResponse } from 'msw'
import { screen, waitFor } from '@testing-library/react'
import { render } from 'vitest-browser-react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  PlannerDayResult,
  PlannerReadyDay,
  PlannerScenarioOutfit,
} from '@couture/api-client/contracts/http'

// `router` from 'expo-router' is used for the locked panel's CTA. The real module
// transitively pulls in `expo-asset` -> `expo-modules-core`, which cannot be evaluated
// in this browser test bundle -- the same hazard `settings-premium-section.test.tsx`
// and `tab-two-screen.test.tsx` mock around for the same reason.
vi.mock('expo-router', () => ({ router: { push: vi.fn() } }))

vi.mock('expo-localization', () => ({
  getLocales: () => [{ languageTag: 'en-US', languageCode: 'en', regionCode: 'US' }],
}))

import i18n, { initI18n } from '../lib/i18n'
import { server } from '../test-utils/msw/server'
import { press } from '../test-utils/press'
import { setMobileAccessTokenResolver } from '../lib/mobile-auth'
import { PlannerScreen } from '../features/premium/planner-screen'

const PLANNER_ROUTE = '*/api/v1/commerce/premium/planner'

const DATES = [
  '2026-09-07',
  '2026-09-08',
  '2026-09-09',
  '2026-09-10',
  '2026-09-11',
  '2026-09-12',
  '2026-09-13',
] as const

function outfit(
  scenario: PlannerScenarioOutfit['scenario'],
  overrides: Partial<PlannerScenarioOutfit> = {}
): PlannerScenarioOutfit {
  return {
    id: `outfit-${scenario}`,
    scenario,
    garmentIds: ['garment-1'],
    reasoningBadges: [],
    comfortNotes: `${scenario} comfort notes`,
    capsuleId: null,
    capsuleName: null,
    autoFilledGarmentIds: [],
    displayGarments: [{ id: 'garment-1', category: 'top', imageAccess: null }],
    shopThisLook: null,
    ...overrides,
  }
}

function readyDay(
  planDate: string,
  overrides: Partial<PlannerReadyDay> = {}
): PlannerReadyDay {
  return {
    status: 'ready',
    planDate,
    version: 1,
    weather: {
      confidence: 'hourly',
      freshness: 'fresh',
      condition: 'clear',
      temperatureLow: 12,
      temperatureHigh: 20,
    },
    isStarterWardrobe: false,
    outfits: [outfit('morning'), outfit('midday'), outfit('evening')],
    ...overrides,
  }
}

function errorDay(planDate: string): PlannerDayResult {
  return { status: 'error', planDate, errorCode: 'generation_failed', retryable: true }
}

function readyWeek(days: PlannerDayResult[] = DATES.map((d) => readyDay(d))) {
  return {
    locationId: 'location-1',
    timezone: 'America/New_York',
    anchorDate: DATES[0],
    daysReady: days.filter((d) => d.status === 'ready').length,
    days,
  }
}

function servePlanner(data: ReturnType<typeof readyWeek>) {
  server.use(http.get(PLANNER_ROUTE, () => HttpResponse.json({ data })))
}

const errorEnvelope = (statusCode: number, message: string) =>
  HttpResponse.json({ statusCode, message, error: 'Error' }, { status: statusCode })

describe('PlannerScreen (Story 5.5)', () => {
  let restoreAccessTokenResolver: (() => void) | undefined

  beforeAll(async () => {
    process.env.EXPO_PUBLIC_API_BASE_URL =
      typeof window !== 'undefined' ? window.location.origin : 'https://mock-api.test'
    await initI18n()
    await i18n.changeLanguage('en-US')
  })

  beforeEach(() => {
    restoreAccessTokenResolver = setMobileAccessTokenResolver(() => 'session-token')
  })

  afterEach(() => {
    restoreAccessTokenResolver?.()
    restoreAccessTokenResolver = undefined
  })

  it('5.5-MOB-01 shows a loading indicator while the request is in flight', async () => {
    server.use(
      http.get(PLANNER_ROUTE, async () => {
        await new Promise((resolve) => setTimeout(resolve, 50))
        return HttpResponse.json({ data: readyWeek() })
      })
    )
    await render(<PlannerScreen />)

    expect(screen.getByTestId('planner-loading')).toBeTruthy()
    await waitFor(() => expect(screen.queryByTestId('planner-loading')).toBeNull())
  })

  it('5.5-MOB-02 renders the locked panel with no session', async () => {
    restoreAccessTokenResolver?.()
    restoreAccessTokenResolver = setMobileAccessTokenResolver(() => undefined)
    await render(<PlannerScreen />)

    const locked = await screen.findByTestId('planner-locked')
    expect(locked.textContent).toContain('Premium feature')
  })

  it('5.5-MOB-03 renders the locked panel for a signed-in, non-entitled reader (403)', async () => {
    server.use(
      http.get(PLANNER_ROUTE, () => errorEnvelope(403, 'Premium subscription required.'))
    )
    await render(<PlannerScreen />)

    await screen.findByTestId('planner-locked')
  })

  it('5.5-MOB-04 renders the disabled notice when the kill switch is off (503)', async () => {
    server.use(
      http.get(PLANNER_ROUTE, () =>
        errorEnvelope(503, 'The premium planner is temporarily unavailable.')
      )
    )
    await render(<PlannerScreen />)

    await screen.findByTestId('planner-disabled')
  })

  it('5.5-MOB-05 renders a retry on an unclassified load failure', async () => {
    server.use(http.get(PLANNER_ROUTE, () => errorEnvelope(500, 'boom')))
    await render(<PlannerScreen />)

    await screen.findByTestId('planner-load-error')
    expect(screen.getByTestId('planner-retry')).toBeTruthy()
  })

  it('5.5-MOB-06 renders all seven ready dates with weather and scenarios', async () => {
    servePlanner(readyWeek())
    await render(<PlannerScreen />)

    for (const date of DATES) {
      await screen.findByTestId(`planner-day-${date}`)
    }
    const first = screen.getByTestId(`planner-day-${DATES[0]}`)
    expect(first.textContent).toContain('Morning')
    expect(first.textContent).toContain('Midday')
    expect(first.textContent).toContain('Evening')
    expect(first.textContent).toContain('Clear sky')
  })

  it('5.5-MOB-07 surfaces degraded weather confidence without a temperature claim', async () => {
    servePlanner(
      readyWeek([
        readyDay(DATES[0], {
          weather: {
            confidence: 'unavailable',
            freshness: null,
            condition: null,
            temperatureLow: null,
            temperatureHigh: null,
          },
        }),
        ...DATES.slice(1).map((d) => readyDay(d)),
      ])
    )
    await render(<PlannerScreen />)

    const unavailable = await screen.findByTestId('planner-weather-unavailable')
    expect(unavailable.textContent).toContain('unavailable')
  })

  it('5.5-MOB-08 renders an isolated error card for a failed date, leaving the rest visible', async () => {
    servePlanner(
      readyWeek([errorDay(DATES[0]), ...DATES.slice(1).map((d) => readyDay(d))])
    )
    await render(<PlannerScreen />)

    await screen.findByTestId('planner-day-error')
    for (const date of DATES.slice(1)) {
      await screen.findByTestId(`planner-day-${date}`)
    }
  })

  it('5.5-MOB-09 retries the whole week from a failed date', async () => {
    let calls = 0
    server.use(
      http.get(PLANNER_ROUTE, () => {
        calls += 1
        return HttpResponse.json({
          data: readyWeek(
            calls === 1
              ? [errorDay(DATES[0]), ...DATES.slice(1).map((d) => readyDay(d))]
              : DATES.map((d) => readyDay(d))
          ),
        })
      })
    )
    await render(<PlannerScreen />)

    await press(await screen.findByTestId('planner-day-error-retry'))

    await screen.findByTestId(`planner-day-${DATES[0]}`)
    expect(screen.queryByTestId('planner-day-error')).toBeNull()
  })

  it('5.5-MOB-10 reshuffles a day and shows the success notice', async () => {
    servePlanner(readyWeek())
    let sentBody: unknown = null
    server.use(
      http.post(`${PLANNER_ROUTE}/${DATES[0]}/reshuffle`, async ({ request }) => {
        sentBody = await request.json()
        return HttpResponse.json({
          data: {
            day: readyDay(DATES[0], {
              version: 2,
              outfits: [
                outfit('morning', { comfortNotes: 'reshuffled morning' }),
                outfit('midday'),
                outfit('evening'),
              ],
            }),
            unchanged: false,
          },
        })
      })
    )
    await render(<PlannerScreen />)

    await press(await screen.findByTestId(`planner-reshuffle-${DATES[0]}`))

    await waitFor(() =>
      expect(screen.getByTestId(`planner-day-notice-${DATES[0]}`).textContent).toContain(
        'reshuffled'
      )
    )
    expect(sentBody).toEqual({ expectedVersion: 1 })
    expect(screen.getByTestId(`planner-day-${DATES[0]}`).textContent).toContain(
      'reshuffled morning'
    )
  })

  it('5.5-MOB-11 reports no alternative when the reshuffle leaves the day unchanged', async () => {
    servePlanner(readyWeek())
    server.use(
      http.post(`${PLANNER_ROUTE}/${DATES[0]}/reshuffle`, () =>
        HttpResponse.json({ data: { day: readyDay(DATES[0]), unchanged: true } })
      )
    )
    await render(<PlannerScreen />)

    await press(await screen.findByTestId(`planner-reshuffle-${DATES[0]}`))

    await waitFor(() =>
      expect(screen.getByTestId(`planner-day-notice-${DATES[0]}`).textContent).toContain(
        'No different outfits'
      )
    )
  })

  it('5.5-MOB-12 refreshes the day on a version conflict', async () => {
    servePlanner(readyWeek())
    let getCalls = 0
    server.use(
      http.get(PLANNER_ROUTE, () => {
        getCalls += 1
        return HttpResponse.json({ data: readyWeek() })
      }),
      http.post(`${PLANNER_ROUTE}/${DATES[0]}/reshuffle`, () =>
        errorEnvelope(409, 'This day changed since you last viewed it.')
      )
    )
    await render(<PlannerScreen />)
    await screen.findByTestId(`planner-day-${DATES[0]}`)

    await press(screen.getByTestId(`planner-reshuffle-${DATES[0]}`))

    await waitFor(() =>
      expect(screen.getByTestId(`planner-day-notice-${DATES[0]}`).textContent).toContain(
        'changed since you last viewed it'
      )
    )
    await waitFor(() => expect(getCalls).toBeGreaterThan(1))
  })

  it('5.5-MOB-13 ignores a second reshuffle press while the first is in flight', async () => {
    servePlanner(readyWeek())
    let reshuffleCalls = 0
    server.use(
      http.post(`${PLANNER_ROUTE}/${DATES[0]}/reshuffle`, async () => {
        reshuffleCalls += 1
        await new Promise((resolve) => setTimeout(resolve, 50))
        return HttpResponse.json({ data: { day: readyDay(DATES[0]), unchanged: true } })
      })
    )
    await render(<PlannerScreen />)

    const button = await screen.findByTestId(`planner-reshuffle-${DATES[0]}`)
    await press(button)
    await press(button)
    await press(button)

    await waitFor(() =>
      expect(screen.getByTestId(`planner-day-notice-${DATES[0]}`).textContent).toContain(
        'No different outfits'
      )
    )
    expect(reshuffleCalls).toBe(1)
  })
})
