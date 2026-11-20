// Learning path Step 58: Production follow-ups after the project close.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#production-follow-ups-after-the-project-close
// PR 259 round 3 (CodeRabbit, planner-rail.tsx `load`): a foreground week read (the Retry on a
// day that failed to generate) can answer after a reshuffle advanced the week generation. Its
// answer is older than what the rail shows, so it may not undo a newer state:
// - a focus refresh had found the planner disabled and cleared the week: an older Retry that
//   succeeds must leave the disabled panel, not an entitled rail with no week, and one that
//   fails with a 500 must not replace the lock with a generic load error;
// - a reshuffle had updated the week: an older Retry that fails with a 500 must not replace that
//   week with the error panel;
// - a foreground read that fails with no newer week still shows its error.
// Every response is a week the API contract accepts (seven consecutive dates, checked against
// plannerResponseSchema), so no case stands on a payload the client would reject. Each case holds
// the requests it orders (the reshuffle, the focus refresh, the Retry), releases one only after
// the transition before it showed, and awaits the production client's own promise inside `act`
// before asserting. One case releases all three inside a single render batch.
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { I18nextProvider } from 'react-i18next'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  PREMIUM_PLANNER_DISABLED_MESSAGE,
  plannerResponseSchema,
} from '@couture/api-client/contracts/http'
import { getI18n } from '../../i18n'
import type * as Planner from '../../lib/planner'
import { signInFixtureMember } from '../../test-utils/member-session'
import { useMswHandlers } from '../../test-utils/msw/runtime'
import { settle } from '../../test-utils/request-barrier'
import { PlannerRail } from './planner-rail'

/** Every call the rail makes through the production client, so a test can await its result. */
const client = vi.hoisted(() => ({
  get: [] as Promise<unknown>[],
  reshuffle: [] as Promise<unknown>[],
}))
vi.mock('../../lib/planner', async (importOriginal) => {
  const actual = await importOriginal<typeof Planner>()
  return {
    ...actual,
    getPlannerFromWeb: (...args: Parameters<typeof actual.getPlannerFromWeb>) => {
      const pending = actual.getPlannerFromWeb(...args)
      client.get.push(pending)
      return pending
    },
    reshufflePlannerDayFromWeb: (
      ...args: Parameters<typeof actual.reshufflePlannerDayFromWeb>
    ) => {
      const pending = actual.reshufflePlannerDayFromWeb(...args)
      client.reshuffle.push(pending)
      return pending
    },
  }
})

/** The production client call has answered and the rail has applied it. */
const consumed = (pending: Promise<unknown> | undefined) =>
  act(async () => {
    await Promise.allSettled([pending])
    await Promise.resolve()
  })

const PLANNER_PATH = '/api/v1/commerce/premium/planner'
const RESHUFFLE_PATH = `${PLANNER_PATH}/:planDate/reshuffle`
const DATES = [
  '2026-09-10',
  '2026-09-11',
  '2026-09-12',
  '2026-09-13',
  '2026-09-14',
  '2026-09-15',
  '2026-09-16',
]
const READY_DATE = DATES[0]!
const FAILED_DATE = DATES[1]!

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

/**
 * Seven consecutive days: one ready day to reshuffle, one failed day to Retry. The body is
 * parsed with the API contract's own schema, so a malformed week cannot stand in for a race.
 */
function week() {
  const days = DATES.map((date) =>
    date === FAILED_DATE ? failedDay(date) : readyDay(date)
  )
  const body = {
    data: {
      locationId: 'location-1',
      timezone: 'America/New_York',
      anchorDate: DATES[0],
      daysReady: days.filter((day) => day.status === 'ready').length,
      days,
    },
  }
  plannerResponseSchema.parse(body)
  return body
}

/** The day the reshuffle returns: marked, so the reshuffled week can be told from the first. */
const RESHUFFLED_DAY = () => readyDay(READY_DATE, { version: 2, isStarterWardrobe: true })

function hold() {
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  return { gate, release }
}

const open = (gate: { release: () => void }) =>
  act(async () => {
    gate.release()
    await Promise.resolve()
  })

type Answer = () => Promise<Response> | Response

const ok: Answer = () => HttpResponse.json(week())
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
const after =
  (gate: { gate: Promise<void> }, answer: Answer): Answer =>
  async () => {
    await gate.gate
    return answer()
  }

/**
 * Serves the week reads in the order they arrive: `answers[n]` answers the n-th GET. The
 * reshuffle answers when its gate opens.
 */
function useScenario(answers: Answer[]) {
  const reshuffle = hold()
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

/**
 * The rail with a reshuffle held, a focus refresh held and a foreground Retry held, in the
 * order that exposes the race: the reshuffle starts first, then the focus refresh, then the
 * Retry (which puts the rail in `checking`).
 */
async function startThreeRequests(scenario: ReturnType<typeof useScenario>) {
  renderRail()
  fireEvent.click(await screen.findByTestId(`planner-reshuffle-${READY_DATE}`))
  await waitFor(() => expect(client.reshuffle).toHaveLength(1))
  act(() => {
    window.dispatchEvent(new Event('focus'))
  })
  await waitFor(() => expect(scenario.reads()).toBe(2))
  fireEvent.click(screen.getByTestId(`planner-retry-${FAILED_DATE}`))
  await waitFor(() => expect(scenario.reads()).toBe(3))
  expect(client.get).toHaveLength(3)
}

describe('the planner rail with a foreground Retry that answers after a newer week state', () => {
  beforeEach(async () => {
    window.sessionStorage.clear()
    client.get.length = 0
    client.reshuffle.length = 0
    signInFixtureMember()
    await getI18n().changeLanguage('en-US')
  })

  /** The focus refresh found the planner disabled; the reshuffle then landed on no week. */
  function useDisabledThenRetry(retryAnswer: Answer) {
    const focusRead = hold()
    const retryRead = hold()
    const scenario = useScenario([
      ok,
      after(focusRead, disabled),
      after(retryRead, retryAnswer),
    ])
    return { scenario, focusRead, retryRead }
  }

  it('WEEK-RACE-01 an older Retry that succeeds leaves the disabled panel, not an empty entitled list', async () => {
    const { scenario, focusRead, retryRead } = useDisabledThenRetry(ok)
    await startThreeRequests(scenario)

    // Each answer is consumed, and its transition shown, before the next is released.
    await open(focusRead)
    await consumed(client.get[1])
    expect(await screen.findByTestId('planner-rail-disabled')).toBeInTheDocument()
    await open(scenario.reshuffle)
    await consumed(client.reshuffle[0])
    expect(screen.getByTestId('planner-rail-disabled')).toBeInTheDocument()
    await open(retryRead)
    await consumed(client.get[2])
    await settle()

    expect(screen.getByTestId('planner-rail-disabled')).toBeInTheDocument()
    expect(screen.queryByTestId('planner-days')).toBeNull()
  })

  it('WEEK-RACE-02 the same order with a 500 as the older Retry result keeps the disabled panel', async () => {
    const { scenario, focusRead, retryRead } = useDisabledThenRetry(serverError)
    await startThreeRequests(scenario)

    await open(focusRead)
    await consumed(client.get[1])
    expect(await screen.findByTestId('planner-rail-disabled')).toBeInTheDocument()
    await open(scenario.reshuffle)
    await consumed(client.reshuffle[0])
    await open(retryRead)
    await consumed(client.get[2])
    await settle()

    expect(screen.getByTestId('planner-rail-disabled')).toBeInTheDocument()
    expect(screen.queryByTestId('planner-rail-error')).toBeNull()
    expect(screen.queryByTestId('planner-days')).toBeNull()
  })

  it('WEEK-RACE-03 the three answers released inside one render batch never render an empty entitled list', async () => {
    const { scenario, focusRead, retryRead } = useDisabledThenRetry(ok)
    await startThreeRequests(scenario)

    // One `act`: React commits nothing until it ends, so the rail meets the focus answer, the
    // reshuffle and the older Retry success as one batch, in that order.
    await act(async () => {
      focusRead.release()
      await Promise.allSettled([client.get[1]])
      scenario.reshuffle.release()
      await Promise.allSettled([client.reshuffle[0]])
      retryRead.release()
      await Promise.allSettled([client.get[2]])
    })
    await settle()

    expect(screen.getByTestId('planner-rail-disabled')).toBeInTheDocument()
    expect(screen.queryByTestId('planner-days')).toBeNull()
  })

  it('WEEK-RACE-04 an older Retry that fails with a 500 keeps the week a reshuffle updated', async () => {
    const retryRead = hold()
    const scenario = useScenario([ok, after(retryRead, serverError)])
    renderRail()
    fireEvent.click(await screen.findByTestId(`planner-reshuffle-${READY_DATE}`))
    await waitFor(() => expect(client.reshuffle).toHaveLength(1))
    fireEvent.click(screen.getByTestId(`planner-retry-${FAILED_DATE}`))
    await waitFor(() => expect(scenario.reads()).toBe(2))

    // The reshuffle lands first and updates the week; the older Retry then fails.
    await open(scenario.reshuffle)
    await consumed(client.reshuffle[0])
    await open(retryRead)
    await consumed(client.get[1])
    await settle()

    expect(screen.queryByTestId('planner-rail-error')).toBeNull()
    expect(screen.getByTestId('planner-days')).toBeInTheDocument()
    expect(screen.getByTestId(`planner-starter-${READY_DATE}`)).toBeInTheDocument()
  })

  it('WEEK-RACE-05 control: a Retry that fails with no newer week shows its error', async () => {
    const scenario = useScenario([ok, serverError])
    renderRail()
    fireEvent.click(await screen.findByTestId(`planner-retry-${FAILED_DATE}`))
    await waitFor(() => expect(scenario.reads()).toBe(2))
    await consumed(client.get[1])

    expect(await screen.findByTestId('planner-rail-error')).toBeInTheDocument()
    expect(screen.queryByTestId('planner-days')).toBeNull()
  })

  it('WEEK-RACE-06 control: an older Retry that succeeds after a reshuffle shows the reshuffled week', async () => {
    const retryRead = hold()
    const scenario = useScenario([ok, after(retryRead, ok)])
    renderRail()
    fireEvent.click(await screen.findByTestId(`planner-reshuffle-${READY_DATE}`))
    await waitFor(() => expect(client.reshuffle).toHaveLength(1))
    fireEvent.click(screen.getByTestId(`planner-retry-${FAILED_DATE}`))
    await waitFor(() => expect(scenario.reads()).toBe(2))

    await open(scenario.reshuffle)
    await consumed(client.reshuffle[0])
    // The Retry answers with the week as it read it, before the reshuffle.
    await open(retryRead)
    await consumed(client.get[1])
    await settle()

    // The older week is dropped; the rail shows the reshuffled one.
    expect(await screen.findByTestId('planner-days')).toBeInTheDocument()
    expect(screen.getByTestId(`planner-starter-${READY_DATE}`)).toBeInTheDocument()
    expect(screen.queryByTestId('planner-rail-error')).toBeNull()
  })
})
