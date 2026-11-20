// Learning path Step 58: Production follow-ups after the project close.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#production-follow-ups-after-the-project-close
// PR 259 round 3 (CodeRabbit, planner-rail.tsx `load`): a foreground week read (the Retry on a
// day that failed to generate) can answer after a reshuffle advanced the week generation. Its
// answer is older than what the rail shows, so it may not undo a newer state:
// - a focus refresh had found the planner disabled and cleared the week: an older Retry that
//   succeeds must leave the disabled panel, not an entitled rail with no week;
// - a reshuffle had updated the week: an older Retry that fails with a transient 500 must not
//   replace that week with the error panel;
// - a foreground read that fails with no newer week still shows its error.
// Each case holds the requests it orders (the reshuffle, the focus refresh, the Retry) and
// releases them in the order that exposes the race.
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { I18nextProvider } from 'react-i18next'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PREMIUM_PLANNER_DISABLED_MESSAGE } from '@couture/api-client/contracts/http'
import { getI18n } from '../../i18n'
import { signInFixtureMember } from '../../test-utils/member-session'
import { useMswHandlers } from '../../test-utils/msw/runtime'
import { settle } from '../../test-utils/request-barrier'
import { PlannerRail } from './planner-rail'

const PLANNER_PATH = '/api/v1/commerce/premium/planner'
const RESHUFFLE_PATH = `${PLANNER_PATH}/:planDate/reshuffle`
const DATES = ['2026-09-10', '2026-09-11', '2026-09-12']
const [READY_DATE, FAILED_DATE] = DATES as [string, string, string]

function outfit(planDate: string, scenario: 'morning' | 'midday' | 'evening') {
  return {
    id: `${planDate}-${scenario}`,
    scenario,
    garmentIds: ['garment-1'],
    reasoningBadges: [
      { key: 'daily_base', label: 'Daily base', bullets: ['Standard top and bottom.'] },
    ],
    comfortNotes: 'Layer up; it will feel cooler than it reads.',
    capsuleId: null,
    capsuleName: 'Weekday capsule',
    autoFilledGarmentIds: [],
    displayGarments: [{ id: 'garment-1', category: 'top' as const, imageAccess: null }],
    shopThisLook: null,
  }
}

function readyDay(planDate: string, overrides: Record<string, unknown> = {}) {
  return {
    status: 'ready' as const,
    planDate,
    version: 1,
    weather: {
      confidence: 'hourly' as const,
      freshness: 'fresh' as const,
      condition: 'clear' as const,
      temperatureLow: 15,
      temperatureHigh: 22,
    },
    isStarterWardrobe: false,
    outfits: (['morning', 'midday', 'evening'] as const).map((scenario) =>
      outfit(planDate, scenario)
    ),
    ...overrides,
  }
}

const failedDay = (planDate: string) => ({
  status: 'error' as const,
  planDate,
  errorCode: 'generation_failed' as const,
  retryable: true as const,
})

/** A week with one ready day to reshuffle and one failed day to Retry. */
function week(days: readonly unknown[] = defaultDays()) {
  return {
    data: {
      locationId: 'location-1',
      timezone: 'America/New_York',
      anchorDate: DATES[0],
      daysReady: days.filter((day) => (day as { status?: string }).status === 'ready')
        .length,
      days,
    },
  }
}
const defaultDays = () => [
  readyDay(READY_DATE),
  failedDay(FAILED_DATE),
  readyDay(DATES[2]!),
]

/** The day the reshuffle returns: marked, so the reshuffled week can be told from the first. */
const RESHUFFLED_DAY = () => readyDay(READY_DATE, { version: 2, isStarterWardrobe: true })

function hold() {
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  return { gate, release }
}

const release = (gate: { release: () => void }) =>
  act(async () => {
    gate.release()
    await Promise.resolve()
  })

type Answer = () => Promise<Response> | Response

/**
 * Serves the week reads in the order they arrive: `answers[n]` answers the n-th GET. The
 * reshuffle answers when its gate opens.
 */
function useScenario(answers: Answer[], reshuffle = hold()) {
  let reads = 0
  useMswHandlers(
    http.get(PLANNER_PATH, () => {
      const answer = answers[reads]
      reads += 1
      if (!answer) throw new Error(`Unexpected week read ${reads}`)
      return answer()
    }),
    http.post(RESHUFFLE_PATH, async () => {
      await reshuffle.gate
      return HttpResponse.json({ data: { day: RESHUFFLED_DAY(), unchanged: false } })
    })
  )
  return { reads: () => reads, reshuffle }
}

function renderRail() {
  return render(
    <I18nextProvider i18n={getI18n()}>
      <PlannerRail isOpen onClose={vi.fn()} variant="rail" />
    </I18nextProvider>
  )
}

const ok =
  (days?: readonly unknown[]): Answer =>
  () =>
    HttpResponse.json(week(days))
const serverError: Answer = () =>
  HttpResponse.json(
    { statusCode: 500, message: 'Internal error', error: 'Internal Server Error' },
    { status: 500 }
  )
const disabled: Answer = () =>
  HttpResponse.json(
    {
      statusCode: 503,
      message: PREMIUM_PLANNER_DISABLED_MESSAGE,
      error: 'Service Unavailable',
    },
    { status: 503 }
  )

describe('the planner rail with a foreground Retry that answers after a newer week state', () => {
  beforeEach(async () => {
    window.sessionStorage.clear()
    signInFixtureMember()
    await getI18n().changeLanguage('en-US')
  })

  it('WEEK-RACE-01 an older Retry that succeeds leaves the disabled panel, not an empty entitled list', async () => {
    const retryRead = hold()
    const focusRead = hold()
    const scenario = useScenario([
      ok(),
      async () => {
        await focusRead.gate
        return disabled()
      },
      async () => {
        await retryRead.gate
        return HttpResponse.json(week())
      },
    ])
    renderRail()
    fireEvent.click(await screen.findByTestId(`planner-reshuffle-${READY_DATE}`))
    // The focus refresh and the Retry are both out, the reshuffle still held.
    act(() => {
      window.dispatchEvent(new Event('focus'))
    })
    await waitFor(() => expect(scenario.reads()).toBe(2))
    fireEvent.click(screen.getByTestId(`planner-retry-${FAILED_DATE}`))
    await waitFor(() => expect(scenario.reads()).toBe(3))

    // The focus refresh finds the planner disabled; then the reshuffle lands (it advances the
    // generation and, with no week on screen, updates nothing); then the older Retry succeeds.
    await release(focusRead)
    expect(await screen.findByTestId('planner-rail-disabled')).toBeInTheDocument()
    await release(scenario.reshuffle)
    await settle()
    await release(retryRead)
    await settle()

    expect(screen.getByTestId('planner-rail-disabled')).toBeInTheDocument()
    expect(screen.queryByTestId('planner-days')).toBeNull()
  })

  it('WEEK-RACE-02 an older Retry that fails with a 500 keeps the week a reshuffle updated', async () => {
    const retryRead = hold()
    const scenario = useScenario([
      ok(),
      async () => {
        await retryRead.gate
        return serverError()
      },
    ])
    renderRail()
    fireEvent.click(await screen.findByTestId(`planner-reshuffle-${READY_DATE}`))
    fireEvent.click(screen.getByTestId(`planner-retry-${FAILED_DATE}`))
    await waitFor(() => expect(scenario.reads()).toBe(2))

    // The reshuffle lands first and updates the week; the older Retry then fails.
    await release(scenario.reshuffle)
    await settle()
    await release(retryRead)
    await settle()

    expect(screen.queryByTestId('planner-rail-error')).toBeNull()
    expect(screen.getByTestId('planner-days')).toBeInTheDocument()
    expect(screen.getByTestId(`planner-starter-${READY_DATE}`)).toBeInTheDocument()
  })

  it('WEEK-RACE-03 control: a Retry that fails with no newer week shows its error', async () => {
    const scenario = useScenario([ok(), serverError])
    renderRail()
    fireEvent.click(await screen.findByTestId(`planner-retry-${FAILED_DATE}`))
    await waitFor(() => expect(scenario.reads()).toBe(2))

    expect(await screen.findByTestId('planner-rail-error')).toBeInTheDocument()
    expect(screen.queryByTestId('planner-days')).toBeNull()
  })

  it('WEEK-RACE-04 control: an older Retry that succeeds after a reshuffle shows the reshuffled week', async () => {
    const retryRead = hold()
    const scenario = useScenario([
      ok(),
      async () => {
        await retryRead.gate
        // The week as the Retry read it, before the reshuffle.
        return HttpResponse.json(week())
      },
    ])
    renderRail()
    fireEvent.click(await screen.findByTestId(`planner-reshuffle-${READY_DATE}`))
    fireEvent.click(screen.getByTestId(`planner-retry-${FAILED_DATE}`))
    await waitFor(() => expect(scenario.reads()).toBe(2))

    await release(scenario.reshuffle)
    await settle()
    await release(retryRead)
    await settle()

    // The older week is dropped; the rail shows the reshuffled one.
    expect(await screen.findByTestId('planner-days')).toBeInTheDocument()
    expect(screen.getByTestId(`planner-starter-${READY_DATE}`)).toBeInTheDocument()
    expect(screen.queryByTestId('planner-rail-error')).toBeNull()
  })
})
