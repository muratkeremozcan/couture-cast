// Story 5.5 Task 8 owner: the mobile 7-day outfit planner screen.
// Learning path Step 69: Looks tab for saved looks, ideas and plans.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-69-looks-tab-for-saved-looks-ideas-and-plans
// Story CC-7.12 test owner (TEA): 7.12-NAT-030 (D10, P4, P5): the locked and signed-out states
// render the free Plan preview (`plan-free-preview`: the one line, one `plan-upgrade` to
// `/settings`, or sign-in when signed out, and seven `plan-free-day-*` rows) with no lock panel,
// and `PlannerBody` renders the same states without the screen's own scroll view.
// Test design: _bmad-output/test-artifacts/test-design-7-12-looks-tab-saved-looks-ideas-plans.md.
//
// The mobile counterpart of the (forthcoming) `apps/web/src/app/components/planner-rail`
// live-data suite. The network boundary stays REAL and is driven through MSW, following
// `palette-advisor-screen.test.tsx`: the screen's whole job is turning HTTP outcomes into
// rendered states, and several of those states (403 not-entitled, 503 disabled, 409
// conflict) are reached only by a real rejected request, so stubbing `src/lib/planner`
// would leave exactly the interesting half unproven.
/* eslint-disable @typescript-eslint/await-thenable */
import { http, HttpResponse } from 'msw'
import { screen, waitFor, within } from '@testing-library/react'
import { render } from 'vitest-browser-react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  PlannerDayResult,
  PlannerReadyDay,
  PlannerScenarioOutfit,
} from '@couture/api-client/contracts/http'

// `router` from 'expo-router' is used for the free preview's Upgrade. The real module
// transitively pulls in `expo-asset` -> `expo-modules-core`, which cannot be evaluated
// in this browser test bundle; the same hazard `settings-premium-section.test.tsx`
// and `tab-two-screen.test.tsx` mock around for the same reason.
vi.mock('expo-router', () => ({ router: { push: vi.fn() } }))

vi.mock('expo-localization', () => ({
  getLocales: () => [{ languageTag: 'en-US', languageCode: 'en', regionCode: 'US' }],
}))

import i18n, { initI18n } from '../lib/i18n'
import { server } from '../test-utils/msw/server'
import { press } from '../test-utils/press'
import { setMobileAccessTokenResolver } from '../lib/mobile-auth'
import { router } from 'expo-router'
import { PlannerBody, PlannerScreen } from '../features/premium/planner-screen'

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

/** Every API path the screen requests from now on; the recorder answers none of them. */
function recordApiRequests() {
  const requests: string[] = []
  server.use(
    http.all('*/api/*', ({ request }) => {
      requests.push(new URL(request.url).pathname)
    })
  )
  return requests
}

/**
 * 7.12-NAT-030: the free Plan preview, the one line and one Upgrade above a seven day sample week,
 * with no lock panel, lock string or planner intro anywhere on the screen.
 */
async function expectFreePlanPreview() {
  const preview = await screen.findByTestId('plan-free-preview')
  expect(preview).toHaveTextContent(i18n.t('looks.freePlan.line'))
  expect(i18n.t('looks.freePlan.line')).toBe(
    'Premium plans your whole week around your forecast.'
  )
  const upgrades = screen.getAllByTestId('plan-upgrade')
  expect(upgrades).toHaveLength(1)
  expect(upgrades[0]).toHaveTextContent(i18n.t('looks.freePlan.upgrade'))
  expect(preview.contains(upgrades[0]!)).toBe(true)
  const days = Array.from({ length: 7 }, (_, offset) =>
    within(preview).getByTestId(`plan-free-day-${offset}`)
  )
  expect(within(preview).queryByTestId('plan-free-day-7')).toBeNull()
  for (const day of days) expect(day.textContent?.trim().length).toBeGreaterThan(0)
  // P4: the line and Upgrade sit above the sample week.
  expect(upgrades[0]!.getBoundingClientRect().bottom).toBeLessThanOrEqual(
    days[0]!.getBoundingClientRect().top + 0.5
  )
  // D10: the lock panel and its strings are gone, and the free line replaces the intro.
  expect(screen.queryByTestId('planner-locked')).toBeNull()
  expect(screen.queryByTestId('planner-locked-cta')).toBeNull()
  expect(document.body.textContent).not.toContain('Premium feature')
  expect(document.body.textContent).not.toContain('Get Premium')
  expect(document.body.textContent).not.toContain(
    i18n.t('commerce.premium.planner.intro')
  )
  return upgrades[0]!
}

describe('PlannerScreen (Story 5.5)', () => {
  let restoreAccessTokenResolver: (() => void) | undefined

  beforeAll(async () => {
    process.env.EXPO_PUBLIC_API_BASE_URL =
      typeof window !== 'undefined' ? window.location.origin : 'https://mock-api.test'
    await initI18n()
    await i18n.changeLanguage('en-US')
  })

  beforeEach(() => {
    vi.mocked(router.push).mockClear()
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

  it('[7.9 D6] leaves the title to the top bar and keeps the section name', async () => {
    restoreAccessTokenResolver?.()
    restoreAccessTokenResolver = setMobileAccessTokenResolver(() => undefined)
    await render(<PlannerScreen />)
    await screen.findByTestId('plan-free-preview')

    const section = screen.getByTestId('planner-screen')
    expect(section).toHaveAttribute('aria-label', '7-Day Planner')
    // The stack's AppTopBar shows the route title (Plan since CC-7.11 D9, app/planner.tsx); the
    // body keeps no copy of the section name as a title.
    expect(within(section).queryByText('7-Day Planner')).toBeNull()
    expect(within(section).queryByRole('heading', { name: '7-Day Planner' })).toBeNull()
  })

  it('[P0] [7.12-NAT-030] 5.5-MOB-02 renders the free preview with no session; Upgrade opens sign-in', async () => {
    restoreAccessTokenResolver?.()
    restoreAccessTokenResolver = setMobileAccessTokenResolver(() => undefined)
    const requests = recordApiRequests()
    await render(<PlannerScreen />)

    const upgrade = await expectFreePlanPreview()
    await press(upgrade)
    // P5: signed out, Upgrade opens sign-in and calls no purchase or entitlement endpoint.
    expect(vi.mocked(router.push).mock.calls).toEqual([['/signin']])
    expect(
      requests.filter((path) => !path.endsWith('/commerce/premium/planner'))
    ).toEqual([])
  })

  it('[P0] [7.12-NAT-030] 5.5-MOB-03 renders the free preview for a signed-in, non-entitled reader (403); Upgrade opens Profile', async () => {
    server.use(
      http.get(PLANNER_ROUTE, () => errorEnvelope(403, 'Premium subscription required.'))
    )
    const requests = recordApiRequests()
    await render(<PlannerScreen />)

    const upgrade = await expectFreePlanPreview()
    await press(upgrade)
    // D10: Upgrade opens Profile's Premium section; it buys nothing itself. The recorder saw
    // the planner read, so an empty remainder is a real observation.
    expect(vi.mocked(router.push).mock.calls).toEqual([['/settings']])
    expect(requests).toContain('/api/v1/commerce/premium/planner')
    expect(
      requests.filter((path) => !path.endsWith('/commerce/premium/planner'))
    ).toEqual([])
  })

  it('[P1] [7.12-NAT-030] PlannerBody renders the free preview without the screen scroll view (Looks Plan)', async () => {
    server.use(
      http.get(PLANNER_ROUTE, () => errorEnvelope(403, 'Premium subscription required.'))
    )
    await render(<PlannerBody />)

    await expectFreePlanPreview()
    expect(screen.queryByTestId('planner-screen')).toBeNull()
  })

  it('[P1] [7.12-NAT-030] PlannerBody renders the entitled week with no free preview', async () => {
    servePlanner(readyWeek())
    await render(<PlannerBody />)

    for (const date of DATES) await screen.findByTestId(`planner-day-${date}`)
    expect(screen.queryByTestId('plan-free-preview')).toBeNull()
    expect(screen.queryByTestId('plan-upgrade')).toBeNull()
    expect(screen.queryByTestId('planner-screen')).toBeNull()
    expect(document.body.textContent).toContain(i18n.t('commerce.premium.planner.intro'))
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
