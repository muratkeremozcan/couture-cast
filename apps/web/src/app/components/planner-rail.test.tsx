// Learning path Step 68: Five-tab navigation and back pattern.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-68-five-tab-navigation-and-back-pattern
// Story CC-7.11 test owner (TEA): 7.11-CMP-PLAN-001 (the rail without its header on the Plan route)
// Test design: _bmad-output/test-artifacts/test-design-7-11-five-tab-navigation-back-pattern.md
// Learning path Step 69: Looks tab for saved looks, ideas and plans.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-69-looks-tab-for-saved-looks-ideas-and-plans
// Story CC-7.12 test owner (TEA): 7.12-UNIT-050 (locked and signed-out render the free preview:
// seven sample days, one line, exactly one Upgrade, no lock ids) and 7.12-UNIT-051 (entitled,
// disabled, error, loading and set-city states unchanged; the existing cases below).
// Test design: _bmad-output/test-artifacts/test-design-7-12-looks-tab-saved-looks-ideas-plans.md
// Story 5.5 Task 7 owner: component tests for the live seven-day planner rail.
import { act, render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { http, HttpResponse } from 'msw'
import axe from 'axe-core'
import { I18nextProvider } from 'react-i18next'
import {
  PREMIUM_REQUIRED_MESSAGE,
  PREMIUM_PLANNER_DISABLED_MESSAGE,
  PLANNER_DAY_CHANGED_MESSAGE,
} from '@couture/api-client/contracts/http'
import { useMswHandlers } from '../../test-utils/msw/runtime'
import { settle } from '../../test-utils/request-barrier'
import { signInFixtureMember } from '../../test-utils/member-session'
import { getI18n } from '../../i18n'
import { AccessibleModal } from './accessible-modal'
import { PlannerRail } from './planner-rail'

const PLANNER_PATH = '/api/v1/commerce/premium/planner'
const RESHUFFLE_PATH = `${PLANNER_PATH}/:planDate/reshuffle`

const SEVEN_DATES = [
  '2026-09-10',
  '2026-09-11',
  '2026-09-12',
  '2026-09-13',
  '2026-09-14',
  '2026-09-15',
  '2026-09-16',
]

function buildOutfit(planDate: string, scenario: 'morning' | 'midday' | 'evening') {
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

function buildReadyDay(planDate: string, overrides: Record<string, unknown> = {}) {
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
      buildOutfit(planDate, scenario)
    ),
    ...overrides,
  }
}

function buildErrorDay(planDate: string) {
  return {
    status: 'error' as const,
    planDate,
    errorCode: 'generation_failed' as const,
    retryable: true as const,
  }
}

function buildResponse(days: readonly unknown[]) {
  const readyCount = days.filter(
    (day) => (day as { status?: unknown }).status === 'ready'
  ).length
  return {
    data: {
      locationId: 'location-1',
      timezone: 'America/New_York',
      anchorDate: SEVEN_DATES[0],
      daysReady: readyCount,
      days,
    },
  }
}

function errorBody(statusCode: number, message: string) {
  return { statusCode, message, error: 'Error' }
}

function renderRail(props: Partial<React.ComponentProps<typeof PlannerRail>> = {}) {
  return render(
    <I18nextProvider i18n={getI18n()}>
      <PlannerRail isOpen onClose={vi.fn()} variant="rail" {...props} />
    </I18nextProvider>
  )
}

describe('PlannerRail', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.sessionStorage.clear()
  })

  it('renders nothing when closed', () => {
    renderRail({ isOpen: false })
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
  })

  it('renders the free preview signed out with no request', () => {
    const requested = vi.fn()
    useMswHandlers(
      http.get(PLANNER_PATH, () => {
        requested()
        return HttpResponse.json(buildResponse(SEVEN_DATES.map((d) => buildReadyDay(d))))
      })
    )
    renderRail()
    expect(screen.getByTestId('plan-free-preview')).toBeInTheDocument()
    expect(requested).not.toHaveBeenCalled()
  })

  // Story CC-7.11 D9: on the Plan route the top bar carries the title and back, so the rail
  // drops its own heading row and X; the default rail keeps both.
  it('7.11-CMP-PLAN-001 hides its heading row and close button with hideHeader', () => {
    const onClose = vi.fn()
    const { unmount } = renderRail({ onClose })
    const rail = screen.getByRole('complementary', { name: /planner rail/i })
    expect(within(rail).getByRole('heading', { level: 3 })).toHaveTextContent(
      getI18n().t('commerce.premium.planner.sectionTitle')
    )
    fireEvent.click(within(rail).getByRole('button', { name: /close planner/i }))
    expect(onClose).toHaveBeenCalledTimes(1)
    unmount()

    renderRail({ hideHeader: true })
    const plain = screen.getByRole('complementary', { name: /planner rail/i })
    expect(within(plain).queryByRole('heading', { level: 3 })).toBeNull()
    expect(within(plain).queryByRole('button', { name: /close planner/i })).toBeNull()
    // The week body still renders: signed out, the free preview.
    expect(within(plain).getByTestId('plan-free-preview')).toBeInTheDocument()
  })

  it('shows a checking skeleton before the request resolves', async () => {
    signInFixtureMember()
    let resolveResponse!: (value: Response) => void
    useMswHandlers(
      http.get(
        PLANNER_PATH,
        () =>
          new Promise<Response>((resolve) => {
            resolveResponse = resolve
          })
      )
    )
    renderRail()
    expect(screen.getByTestId('planner-skeleton')).toBeInTheDocument()
    // MSW's interceptor reaches the resolver only after at least one
    // microtask tick past the synchronous `fetch()` call.
    await waitFor(() => expect(resolveResponse).toBeTypeOf('function'))
    resolveResponse(
      HttpResponse.json(buildResponse(SEVEN_DATES.map((d) => buildReadyDay(d))))
    )
    await waitFor(() => expect(screen.getByTestId('planner-days')).toBeInTheDocument())
  })

  it('renders a ready week with weather, scenarios, and starter-wardrobe marker', async () => {
    signInFixtureMember()
    const days = SEVEN_DATES.map((d, index) =>
      buildReadyDay(d, index === 2 ? { isStarterWardrobe: true } : {})
    )
    useMswHandlers(http.get(PLANNER_PATH, () => HttpResponse.json(buildResponse(days))))
    renderRail()

    await waitFor(() => expect(screen.getByTestId('planner-days')).toBeInTheDocument())
    expect(screen.getByText('Today')).toBeInTheDocument()
    expect(screen.getByText('Tomorrow')).toBeInTheDocument()
    expect(screen.getAllByTestId(/^planner-outfit-/)).toHaveLength(21)
    expect(screen.getByTestId(`planner-starter-${SEVEN_DATES[2]}`)).toBeInTheDocument()
    // The default `en-US` locale sees Fahrenheit (Decision 3's display
    // boundary): 22°C/15°C convert to 72°F/59°F.
    const firstDay = screen.getByTestId(`planner-day-${SEVEN_DATES[0]}`)
    expect(within(firstDay).getByTestId('planner-weather')).toHaveTextContent(
      '72°F / 59°F'
    )
  })

  it('shows an unavailable weather note without a precision claim', async () => {
    signInFixtureMember()
    const days = SEVEN_DATES.map((d, index) =>
      buildReadyDay(
        d,
        index === 0
          ? {
              weather: {
                confidence: 'unavailable',
                freshness: null,
                condition: null,
                temperatureLow: null,
                temperatureHigh: null,
              },
            }
          : {}
      )
    )
    useMswHandlers(http.get(PLANNER_PATH, () => HttpResponse.json(buildResponse(days))))
    renderRail()

    expect(await screen.findByTestId('planner-weather-unavailable')).toBeInTheDocument()
  })

  it('renders an isolated day error beside otherwise-ready days, with retry', async () => {
    signInFixtureMember()
    const days = SEVEN_DATES.map((d, index) =>
      index === 1 ? buildErrorDay(d) : buildReadyDay(d)
    )
    let requestCount = 0
    useMswHandlers(
      http.get(PLANNER_PATH, () => {
        requestCount += 1
        return HttpResponse.json(
          buildResponse(
            requestCount === 1 ? days : SEVEN_DATES.map((d) => buildReadyDay(d))
          )
        )
      })
    )
    renderRail()

    await waitFor(() => expect(screen.getByTestId('planner-days')).toBeInTheDocument())
    const failedDate = SEVEN_DATES[1]!
    expect(screen.getByTestId(`planner-day-${failedDate}`)).toHaveTextContent(
      "This day couldn't be generated."
    )
    // Every ready date stays visible alongside the failed one (AC 3).
    expect(screen.getByTestId(`planner-day-${SEVEN_DATES[0]}`)).toBeInTheDocument()

    fireEvent.click(screen.getByTestId(`planner-retry-${failedDate}`))
    await waitFor(() => expect(requestCount).toBe(2))
    await waitFor(() =>
      expect(screen.queryByTestId(`planner-retry-${failedDate}`)).not.toBeInTheDocument()
    )
  })

  it('shows the free preview on a 403 from PremiumEntitlementGuard', async () => {
    signInFixtureMember()
    useMswHandlers(
      http.get(PLANNER_PATH, () =>
        HttpResponse.json(errorBody(403, PREMIUM_REQUIRED_MESSAGE), { status: 403 })
      )
    )
    renderRail()
    expect(await screen.findByTestId('plan-free-preview')).toBeInTheDocument()
  })

  it('shows the disabled note (not the free preview) when the flag is off', async () => {
    signInFixtureMember()
    useMswHandlers(
      http.get(PLANNER_PATH, () =>
        HttpResponse.json(errorBody(503, PREMIUM_PLANNER_DISABLED_MESSAGE), {
          status: 503,
        })
      )
    )
    renderRail()
    expect(await screen.findByTestId('planner-rail-disabled')).toBeInTheDocument()
    expect(screen.queryByTestId('plan-free-preview')).not.toBeInTheDocument()
  })

  it('offers a localized retry on an unclassified failure', async () => {
    signInFixtureMember()
    let requestCount = 0
    useMswHandlers(
      http.get(PLANNER_PATH, () => {
        requestCount += 1
        if (requestCount === 1) {
          return HttpResponse.json(errorBody(500, 'boom'), { status: 500 })
        }
        return HttpResponse.json(buildResponse(SEVEN_DATES.map((d) => buildReadyDay(d))))
      })
    )
    renderRail()

    await screen.findByTestId('planner-rail-error')
    fireEvent.click(screen.getByTestId('planner-rail-retry'))
    await waitFor(() => expect(screen.getByTestId('planner-days')).toBeInTheDocument())
  })

  it('shows a per-day reshuffle error on an unclassified reshuffle failure', async () => {
    signInFixtureMember()
    const target = SEVEN_DATES[0]!
    useMswHandlers(
      http.get(PLANNER_PATH, () =>
        HttpResponse.json(buildResponse(SEVEN_DATES.map((d) => buildReadyDay(d))))
      ),
      http.post(RESHUFFLE_PATH, () =>
        HttpResponse.json(errorBody(500, 'boom'), { status: 500 })
      )
    )
    renderRail()
    await waitFor(() => expect(screen.getByTestId('planner-days')).toBeInTheDocument())

    fireEvent.click(screen.getByTestId(`planner-reshuffle-${target}`))
    expect(await screen.findByTestId(`planner-day-alert-${target}`)).toHaveTextContent(
      'Unable to reshuffle this day. Try again.'
    )
  })

  it('reshuffles a day and announces the update', async () => {
    signInFixtureMember()
    const target = SEVEN_DATES[0]!
    useMswHandlers(
      http.get(PLANNER_PATH, () =>
        HttpResponse.json(buildResponse(SEVEN_DATES.map((d) => buildReadyDay(d))))
      ),
      http.post(RESHUFFLE_PATH, () =>
        HttpResponse.json({
          data: {
            day: buildReadyDay(target, { version: 2 }),
            unchanged: false,
          },
        })
      )
    )
    renderRail()
    await waitFor(() => expect(screen.getByTestId('planner-days')).toBeInTheDocument())

    const button = screen.getByTestId(`planner-reshuffle-${target}`)
    fireEvent.click(button)
    expect(button).toBeDisabled()
    await waitFor(() => expect(button).not.toBeDisabled())
    expect(screen.getByRole('status')).toHaveTextContent('Today: outfit updated.')
  })

  it('announces no alternative when reshuffle reports unchanged', async () => {
    signInFixtureMember()
    const target = SEVEN_DATES[0]!
    useMswHandlers(
      http.get(PLANNER_PATH, () =>
        HttpResponse.json(buildResponse(SEVEN_DATES.map((d) => buildReadyDay(d))))
      ),
      http.post(RESHUFFLE_PATH, () =>
        HttpResponse.json({
          data: { day: buildReadyDay(target), unchanged: true },
        })
      )
    )
    renderRail()
    await waitFor(() => expect(screen.getByTestId('planner-days')).toBeInTheDocument())

    fireEvent.click(screen.getByTestId(`planner-reshuffle-${target}`))
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(
        'No new combination available for this day.'
      )
    )
  })

  it('refreshes the date on a reshuffle version conflict', async () => {
    signInFixtureMember()
    const target = SEVEN_DATES[0]!
    let getCount = 0
    useMswHandlers(
      http.get(PLANNER_PATH, () => {
        getCount += 1
        return HttpResponse.json(buildResponse(SEVEN_DATES.map((d) => buildReadyDay(d))))
      }),
      http.post(RESHUFFLE_PATH, () =>
        HttpResponse.json(errorBody(409, PLANNER_DAY_CHANGED_MESSAGE), { status: 409 })
      )
    )
    renderRail()
    await waitFor(() => expect(screen.getByTestId('planner-days')).toBeInTheDocument())

    fireEvent.click(screen.getByTestId(`planner-reshuffle-${target}`))
    await waitFor(() =>
      expect(screen.getByTestId(`planner-day-alert-${target}`)).toHaveTextContent(
        'This day changed since you last viewed it.'
      )
    )
    await waitFor(() => expect(getCount).toBe(2))
  })

  it('prevents a second reshuffle while one is in flight', async () => {
    signInFixtureMember()
    const target = SEVEN_DATES[0]!
    const reshuffleCalls = vi.fn()
    let resolveReshuffle!: (value: Response) => void
    useMswHandlers(
      http.get(PLANNER_PATH, () =>
        HttpResponse.json(buildResponse(SEVEN_DATES.map((d) => buildReadyDay(d))))
      ),
      http.post(
        RESHUFFLE_PATH,
        () =>
          new Promise<Response>((resolve) => {
            reshuffleCalls()
            resolveReshuffle = resolve
          })
      )
    )
    renderRail()
    await waitFor(() => expect(screen.getByTestId('planner-days')).toBeInTheDocument())

    const button = screen.getByTestId(`planner-reshuffle-${target}`)
    fireEvent.click(button)
    // The button's own `disabled` attribute (synchronous state update) is
    // the first line of defense; a disabled button dispatches no click in
    // jsdom either, matching a real browser.
    expect(button).toBeDisabled()
    fireEvent.click(button)
    await waitFor(() => expect(reshuffleCalls).toHaveBeenCalledTimes(1))
    resolveReshuffle(
      HttpResponse.json({ data: { day: buildReadyDay(target), unchanged: true } })
    )
    await waitFor(() => expect(button).not.toBeDisabled())
  })

  it('aborts the in-flight request when the rail closes', async () => {
    signInFixtureMember()
    let capturedSignal: AbortSignal | undefined
    useMswHandlers(
      http.get(PLANNER_PATH, ({ request }) => {
        capturedSignal = request.signal
        return new Promise(() => {
          // Never resolves; the assertion is on the abort signal alone.
        })
      })
    )
    const { rerender } = renderRail()
    await waitFor(() => expect(capturedSignal).toBeDefined())
    expect(capturedSignal?.aborted).toBe(false)

    rerender(
      <I18nextProvider i18n={getI18n()}>
        <PlannerRail isOpen={false} onClose={vi.fn()} variant="rail" />
      </I18nextProvider>
    )
    expect(capturedSignal?.aborted).toBe(true)
  })

  it('traps focus and closes on Escape only in the overlay variant', async () => {
    signInFixtureMember()
    useMswHandlers(
      http.get(PLANNER_PATH, () =>
        HttpResponse.json(buildResponse(SEVEN_DATES.map((d) => buildReadyDay(d))))
      )
    )
    const onClose = vi.fn()
    renderRail({ variant: 'overlay', onClose })

    await waitFor(() => expect(screen.getByTestId('planner-days')).toBeInTheDocument())
    expect(document.activeElement).toHaveAccessibleName('Close planner')

    fireEvent.keyDown(screen.getByRole('complementary'), { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('restores focus to the opener when the overlay closes', () => {
    const opener = document.createElement('button')
    opener.textContent = 'Plan week'
    document.body.appendChild(opener)
    opener.focus()
    const openerRef = { current: opener }

    const { rerender } = render(
      <I18nextProvider i18n={getI18n()}>
        <PlannerRail
          isOpen
          onClose={vi.fn()}
          variant="overlay"
          invokingElementRef={openerRef}
        />
      </I18nextProvider>
    )
    expect(screen.getByTestId('plan-free-preview')).toBeInTheDocument()

    rerender(
      <I18nextProvider i18n={getI18n()}>
        <PlannerRail
          isOpen={false}
          onClose={vi.fn()}
          variant="overlay"
          invokingElementRef={openerRef}
        />
      </I18nextProvider>
    )
    expect(document.activeElement).toBe(opener)
    document.body.removeChild(opener)
  })

  it('leaves the scroll lock to its last holder when a dialog and the overlay close in either order', () => {
    document.body.style.overflow = 'auto'
    const tree = (modal: boolean, planner: boolean) => (
      <I18nextProvider i18n={getI18n()}>
        <AccessibleModal
          isOpen={modal}
          onClose={vi.fn()}
          titleId="held-title"
          title="Held"
        >
          <button type="button">Held action</button>
        </AccessibleModal>
        <PlannerRail isOpen={planner} onClose={vi.fn()} variant="overlay" />
      </I18nextProvider>
    )
    try {
      for (const [first, second] of [
        [(m: boolean) => tree(m, true), (p: boolean) => tree(false, p)],
        [(p: boolean) => tree(true, p), (m: boolean) => tree(m, false)],
      ] as const) {
        const view = render(tree(true, true))
        expect(document.body.style.overflow).toBe('hidden')
        view.rerender(first(false))
        expect(document.body.style.overflow).toBe('hidden')
        view.rerender(second(false))
        expect(document.body.style.overflow).toBe('auto')
        view.unmount()
      }
    } finally {
      document.body.style.overflow = ''
    }
  })

  it('aborts an in-flight reshuffle, not just the week fetch, when the rail closes', async () => {
    signInFixtureMember()
    const target = SEVEN_DATES[0]!
    let reshuffleSignal: AbortSignal | undefined
    useMswHandlers(
      http.get(PLANNER_PATH, () =>
        HttpResponse.json(buildResponse(SEVEN_DATES.map((d) => buildReadyDay(d))))
      ),
      http.post(RESHUFFLE_PATH, ({ request }) => {
        reshuffleSignal = request.signal
        return new Promise(() => {
          // Never resolves; the assertion is on the abort signal alone.
        })
      })
    )
    const { rerender } = renderRail()
    await waitFor(() => expect(screen.getByTestId('planner-days')).toBeInTheDocument())

    fireEvent.click(screen.getByTestId(`planner-reshuffle-${target}`))
    await waitFor(() => expect(reshuffleSignal).toBeDefined())
    expect(reshuffleSignal?.aborted).toBe(false)

    rerender(
      <I18nextProvider i18n={getI18n()}>
        <PlannerRail isOpen={false} onClose={vi.fn()} variant="rail" />
      </I18nextProvider>
    )
    expect(reshuffleSignal?.aborted).toBe(true)
  })

  it('refreshes silently on window focus while open and entitled', async () => {
    signInFixtureMember()
    let requestCount = 0
    useMswHandlers(
      http.get(PLANNER_PATH, () => {
        requestCount += 1
        return HttpResponse.json(buildResponse(SEVEN_DATES.map((d) => buildReadyDay(d))))
      })
    )
    renderRail()
    await waitFor(() => expect(screen.getByTestId('planner-days')).toBeInTheDocument())
    expect(requestCount).toBe(1)

    // A silent refresh does not reset to the checking skeleton.
    window.dispatchEvent(new Event('focus'))
    await waitFor(() => expect(requestCount).toBe(2))
    expect(screen.queryByTestId('planner-skeleton')).not.toBeInTheDocument()
    expect(screen.getByTestId('planner-days')).toBeInTheDocument()
  })

  it('refreshes on a window focus that arrives the moment the week renders', async () => {
    // PR checks run 44131052026: on a busy runner the focus came after the week rendered
    // but before React re-registered the focus listener, so the listener that answered
    // still saw the checking state and refreshed nothing. A MutationObserver runs right
    // after the commit, ahead of React's passive effects, which pins that order.
    signInFixtureMember()
    let requestCount = 0
    useMswHandlers(
      http.get(PLANNER_PATH, () => {
        requestCount += 1
        return HttpResponse.json(buildResponse(SEVEN_DATES.map((d) => buildReadyDay(d))))
      })
    )
    let focusedOnRender = false
    const observer = new MutationObserver(() => {
      if (focusedOnRender || !screen.queryByTestId('planner-days')) return
      focusedOnRender = true
      window.dispatchEvent(new Event('focus'))
    })
    observer.observe(document.body, { childList: true, subtree: true })
    try {
      renderRail()
      await waitFor(() => expect(focusedOnRender).toBe(true))
      await waitFor(() => expect(requestCount).toBe(2))
    } finally {
      observer.disconnect()
    }
    expect(screen.queryByTestId('planner-skeleton')).not.toBeInTheDocument()
    expect(screen.getByTestId('planner-days')).toBeInTheDocument()
  })

  it('does not refresh on window focus once closed', async () => {
    signInFixtureMember()
    let requestCount = 0
    useMswHandlers(
      http.get(PLANNER_PATH, () => {
        requestCount += 1
        return HttpResponse.json(buildResponse(SEVEN_DATES.map((d) => buildReadyDay(d))))
      })
    )
    const { rerender } = renderRail()
    await waitFor(() => expect(screen.getByTestId('planner-days')).toBeInTheDocument())

    rerender(
      <I18nextProvider i18n={getI18n()}>
        <PlannerRail isOpen={false} onClose={vi.fn()} variant="rail" />
      </I18nextProvider>
    )
    window.dispatchEvent(new Event('focus'))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(requestCount).toBe(1)
  })

  it('shows the free preview when a reshuffle discovers entitlement lapsed', async () => {
    signInFixtureMember()
    const target = SEVEN_DATES[0]!
    useMswHandlers(
      http.get(PLANNER_PATH, () =>
        HttpResponse.json(buildResponse(SEVEN_DATES.map((d) => buildReadyDay(d))))
      ),
      http.post(RESHUFFLE_PATH, () =>
        HttpResponse.json(
          { statusCode: 403, message: PREMIUM_REQUIRED_MESSAGE, error: 'Forbidden' },
          { status: 403 }
        )
      )
    )
    renderRail()
    await waitFor(() => expect(screen.getByTestId('planner-days')).toBeInTheDocument())

    fireEvent.click(screen.getByTestId(`planner-reshuffle-${target}`))
    expect(await screen.findByTestId('plan-free-preview')).toBeInTheDocument()
  })

  it('shows the disabled note when a reshuffle discovers the flag went off', async () => {
    signInFixtureMember()
    const target = SEVEN_DATES[0]!
    useMswHandlers(
      http.get(PLANNER_PATH, () =>
        HttpResponse.json(buildResponse(SEVEN_DATES.map((d) => buildReadyDay(d))))
      ),
      http.post(RESHUFFLE_PATH, () =>
        HttpResponse.json(
          {
            statusCode: 503,
            message: PREMIUM_PLANNER_DISABLED_MESSAGE,
            error: 'Service Unavailable',
          },
          { status: 503 }
        )
      )
    )
    renderRail()
    await waitFor(() => expect(screen.getByTestId('planner-days')).toBeInTheDocument())

    fireEvent.click(screen.getByTestId(`planner-reshuffle-${target}`))
    expect(await screen.findByTestId('planner-rail-disabled')).toBeInTheDocument()
  })

  it('ignores an overlay keypress that is neither Escape nor Tab', async () => {
    const onClose = vi.fn()
    renderRail({ variant: 'overlay', onClose })
    await waitFor(() =>
      expect(screen.getByTestId('plan-free-preview')).toBeInTheDocument()
    )

    fireEvent.keyDown(screen.getByRole('complementary'), { key: 'a' })
    expect(onClose).not.toHaveBeenCalled()
    expect(document.activeElement).toHaveAccessibleName('Close planner')
  })

  it('wraps Tab forward and Shift+Tab backward between the overlay endpoints', async () => {
    renderRail({ variant: 'overlay' })
    await waitFor(() =>
      expect(screen.getByTestId('plan-free-preview')).toBeInTheDocument()
    )

    const overlay = screen.getByRole('complementary')
    const closeButton = screen.getByRole('button', { name: 'Close planner' })
    const upgradeLink = screen.getByTestId('plan-upgrade')
    expect(document.activeElement).toBe(closeButton)

    // Shift+Tab from the first focusable element wraps to the last.
    fireEvent.keyDown(overlay, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(upgradeLink)

    // Tab from the last focusable element wraps to the first.
    fireEvent.keyDown(overlay, { key: 'Tab' })
    expect(document.activeElement).toBe(closeButton)
  })

  // Story 5.5 Task 9 (AC 7): the axe matrix. `variant` stands in for the two
  // supported widths (`rail` is the >=1440px desktop layout, `overlay` the
  // narrower phone/tablet layout, Decision 7), and each is checked both
  // signed out (the locked upsell, no request) and entitled (the full ready
  // week). The two states render structurally different DOM (a locked panel
  // vs. seven day cards), so a pass on one variant/state combination says
  // nothing about the others; all four are asserted independently rather than
  // deduplicated into one "representative" case.
  describe.each([
    ['rail' as const, 'desktop'],
    ['overlay' as const, 'phone'],
  ])('automated accessibility, %s variant (%s width)', (variant, _widthLabel) => {
    it('passes signed out with the free preview', async () => {
      const { container } = renderRail({ variant })
      await waitFor(() =>
        expect(screen.getByTestId('plan-free-preview')).toBeInTheDocument()
      )

      const results = await axe.run(container, {
        runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
      })
      expect(results.violations).toEqual([])
    })

    it('passes entitled with a full ready week', async () => {
      signInFixtureMember()
      useMswHandlers(
        http.get(PLANNER_PATH, () =>
          HttpResponse.json(buildResponse(SEVEN_DATES.map((d) => buildReadyDay(d))))
        )
      )
      const { container } = renderRail({ variant })
      await waitFor(() => expect(screen.getByTestId('planner-days')).toBeInTheDocument())

      const results = await axe.run(container, {
        runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
      })
      expect(results.violations).toEqual([])
    })
  })
})

// PR #259 review (CodeRabbit): the rail's member-owned week remounts when the member changes,
// and its reads must never undo a reshuffle the member just made.
describe('PlannerRail keeps focus and the newest week with the member', () => {
  beforeEach(() => {
    window.sessionStorage.clear()
  })

  it('PLANNER-MEMBER-01 a member change while focus is in the overlay week moves focus to Close', async () => {
    signInFixtureMember()
    useMswHandlers(
      http.get(PLANNER_PATH, () =>
        HttpResponse.json(buildResponse(SEVEN_DATES.map((d) => buildReadyDay(d))))
      )
    )
    renderRail({ variant: 'overlay' })
    const reshuffle = await screen.findByTestId(`planner-reshuffle-${SEVEN_DATES[0]!}`)
    reshuffle.focus()
    expect(reshuffle).toHaveFocus()

    // The member signs out in this tab: the week is replaced by the free preview.
    act(() => {
      window.sessionStorage.clear()
      window.dispatchEvent(new Event('couture:session'))
    })

    expect(await screen.findByTestId('plan-free-preview')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Close planner' })).toHaveFocus()
  })

  it('PLANNER-MEMBER-02 the inline rail leaves focus where the page puts it', async () => {
    signInFixtureMember()
    useMswHandlers(
      http.get(PLANNER_PATH, () =>
        HttpResponse.json(buildResponse(SEVEN_DATES.map((d) => buildReadyDay(d))))
      )
    )
    renderRail({ variant: 'rail' })
    const reshuffle = await screen.findByTestId(`planner-reshuffle-${SEVEN_DATES[0]!}`)
    reshuffle.focus()

    act(() => {
      window.sessionStorage.clear()
      window.dispatchEvent(new Event('couture:session'))
    })

    expect(await screen.findByTestId('plan-free-preview')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Close planner' })).not.toHaveFocus()
  })

  it('PLANNER-MEMBER-03 a week read that started before a reshuffle landed does not undo it', async () => {
    signInFixtureMember()
    const target = SEVEN_DATES[0]!
    let weekReads = 0
    let releaseStale!: () => void
    const stale = new Promise<void>((resolve) => {
      releaseStale = resolve
    })
    const expectedVersions: number[] = []
    let staleAnswered = false
    useMswHandlers(
      http.get(PLANNER_PATH, async () => {
        weekReads += 1
        // The focus refresh is held until after the reshuffle answers.
        if (weekReads === 2) {
          await stale
          staleAnswered = true
        }
        return HttpResponse.json(buildResponse(SEVEN_DATES.map((d) => buildReadyDay(d))))
      }),
      http.post(RESHUFFLE_PATH, async ({ request }) => {
        const body = (await request.json()) as { expectedVersion: number }
        expectedVersions.push(body.expectedVersion)
        return HttpResponse.json({
          data: {
            day: buildReadyDay(target, { version: body.expectedVersion + 1 }),
            unchanged: false,
          },
        })
      })
    )
    renderRail()
    const button = await screen.findByTestId(`planner-reshuffle-${target}`)

    act(() => {
      window.dispatchEvent(new Event('focus'))
    })
    await waitFor(() => expect(weekReads).toBe(2))

    fireEvent.click(button)
    await waitFor(() => expect(expectedVersions).toEqual([1]))
    await waitFor(() => expect(button).not.toBeDisabled())

    // The older week (version 1) answers now.
    // The click follows the stale answer's delivery, not a timer: the handler has answered it
    // and the rail has had every round of the request barrier to apply or drop it.
    act(() => releaseStale())
    await waitFor(() => expect(staleAnswered).toBe(true))
    await settle()

    fireEvent.click(screen.getByTestId(`planner-reshuffle-${target}`))
    await waitFor(() => expect(expectedVersions).toEqual([1, 2]))
  })

  // PR #259 review round 2 (CodeRabbit): a foreground read dropped because a reshuffle landed
  // first must not leave the rail on its skeleton.
  it('PLANNER-MEMBER-04 a day retry answered after a reshuffle lands shows the reshuffled week', async () => {
    signInFixtureMember()
    const target = SEVEN_DATES[0]!
    const failed = SEVEN_DATES[1]!
    let weekReads = 0
    let releaseRetry!: () => void
    const retryHeld = new Promise<void>((resolve) => {
      releaseRetry = resolve
    })
    let releaseReshuffle!: () => void
    const reshuffleHeld = new Promise<void>((resolve) => {
      releaseReshuffle = resolve
    })
    useMswHandlers(
      http.get(PLANNER_PATH, async () => {
        weekReads += 1
        if (weekReads === 2) await retryHeld
        return HttpResponse.json(
          buildResponse(
            SEVEN_DATES.map((d) => (d === failed ? buildErrorDay(d) : buildReadyDay(d)))
          )
        )
      }),
      http.post(RESHUFFLE_PATH, async () => {
        await reshuffleHeld
        return HttpResponse.json({
          data: { day: buildReadyDay(target, { version: 2 }), unchanged: false },
        })
      })
    )
    renderRail()
    fireEvent.click(await screen.findByTestId(`planner-reshuffle-${target}`))
    fireEvent.click(screen.getByTestId(`planner-retry-${failed}`))
    await waitFor(() => expect(weekReads).toBe(2))
    expect(screen.getByTestId('planner-skeleton')).toBeInTheDocument()

    // The reshuffle answers first, then the retried week.
    await act(async () => {
      releaseReshuffle()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    await act(async () => {
      releaseRetry()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(await screen.findByTestId('planner-days')).toBeInTheDocument()
    expect(screen.queryByTestId('planner-skeleton')).toBeNull()
    expect(screen.getByRole('status')).toHaveTextContent('Today: outfit updated.')
  })
})

// Story CC-7.12 D10: the locked and signed-out states are the free preview, a sample week with one
// line and one Upgrade, so no screen shows a Planner lock; every other state is unchanged.
describe('7.12 PlannerRail free preview (D10)', () => {
  beforeEach(() => {
    window.sessionStorage.clear()
  })

  const LOCK_IDS = ['planner-rail-locked', 'planner-rail-get-premium']

  function expectFreePreview(upgradeHref: string) {
    const preview = screen.getByTestId('plan-free-preview')
    for (let day = 0; day < 7; day += 1) {
      const row = within(preview).getByTestId(`plan-free-day-${day}`)
      expect(row.textContent?.trim()).not.toBe('')
    }
    expect(within(preview).queryByTestId('plan-free-day-7')).toBeNull()
    expect(
      within(preview).getAllByText('Premium plans your whole week around your forecast.')
    ).toHaveLength(1)
    const upgrades = screen.getAllByTestId('plan-upgrade')
    expect(upgrades).toHaveLength(1)
    expect(upgrades[0]).toHaveAttribute('href', upgradeHref)
    expect(upgrades[0]).toHaveTextContent('Upgrade')
    // One Upgrade is the only control of the preview (one primary per screen).
    expect(within(preview).getAllByRole('link')).toEqual(upgrades)
    expect(within(preview).queryAllByRole('button')).toEqual([])
    for (const id of LOCK_IDS) expect(screen.queryByTestId(id)).toBeNull()
    expect(screen.queryByText('The 7-Day Planner is a Premium feature')).toBeNull()
    expect(screen.queryByText('Get Premium')).toBeNull()
  }

  it('7.12-UNIT-050a signed out renders the free preview with Upgrade to sign-in and sends no read', () => {
    const requested = vi.fn()
    useMswHandlers(
      http.get(PLANNER_PATH, () => {
        requested()
        return HttpResponse.json(buildResponse(SEVEN_DATES.map((d) => buildReadyDay(d))))
      })
    )
    renderRail({ hideHeader: true })

    expectFreePreview('/signin')
    expect(screen.queryByTestId('planner-days')).toBeNull()
    expect(requested).not.toHaveBeenCalled()
  })

  it("7.12-UNIT-050b a member without Premium gets the free preview with Upgrade to Profile's Premium section", async () => {
    signInFixtureMember()
    useMswHandlers(
      http.get(PLANNER_PATH, () =>
        HttpResponse.json(errorBody(403, PREMIUM_REQUIRED_MESSAGE), { status: 403 })
      )
    )
    renderRail({ hideHeader: true })

    await screen.findByTestId('plan-free-preview')
    expectFreePreview('/settings/premium')
    expect(screen.queryByTestId('planner-days')).toBeNull()
  })

  it('7.12-UNIT-050c the sample week rows follow the sample week order, today first', () => {
    renderRail({ hideHeader: true })
    const rows = Array.from({ length: 7 }, (_, day) =>
      screen.getByTestId(`plan-free-day-${day}`)
    )
    for (let index = 1; index < rows.length; index += 1) {
      expect(
        rows[index - 1]!.compareDocumentPosition(rows[index]!) &
          Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy()
    }
    const today = new Intl.DateTimeFormat('en-US', { weekday: 'long' }).format(new Date())
    expect(rows[0]).toHaveTextContent(today)
    // P4: the line and Upgrade sit above the week.
    const upgrade = screen.getByTestId('plan-upgrade')
    expect(
      upgrade.compareDocumentPosition(rows[0]!) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
  })

  it('7.12-UNIT-051a an entitled member gets the week and no preview or Upgrade', async () => {
    signInFixtureMember()
    useMswHandlers(
      http.get(PLANNER_PATH, () =>
        HttpResponse.json(buildResponse(SEVEN_DATES.map((d) => buildReadyDay(d))))
      )
    )
    renderRail({ hideHeader: true })

    expect(await screen.findByTestId('planner-days')).toBeInTheDocument()
    expect(screen.queryByTestId('plan-free-preview')).toBeNull()
    expect(screen.queryByTestId('plan-upgrade')).toBeNull()
  })

  it('7.12-UNIT-051b the disabled and error states keep their panels and show no preview', async () => {
    signInFixtureMember()
    useMswHandlers(
      http.get(PLANNER_PATH, () =>
        HttpResponse.json(errorBody(503, PREMIUM_PLANNER_DISABLED_MESSAGE), {
          status: 503,
        })
      )
    )
    const { unmount } = renderRail({ hideHeader: true })
    expect(await screen.findByTestId('planner-rail-disabled')).toBeInTheDocument()
    expect(screen.queryByTestId('plan-free-preview')).toBeNull()
    expect(screen.queryByTestId('plan-upgrade')).toBeNull()
    unmount()

    useMswHandlers(
      http.get(PLANNER_PATH, () =>
        HttpResponse.json(errorBody(500, 'boom'), { status: 500 })
      )
    )
    renderRail({ hideHeader: true })
    expect(await screen.findByTestId('planner-rail-error')).toBeInTheDocument()
    expect(screen.getByTestId('planner-rail-retry')).toBeInTheDocument()
    expect(screen.queryByTestId('plan-free-preview')).toBeNull()
  })

  it('7.12-UNIT-051c a member with no city gets the set-city link back to Looks Plan, and no preview', async () => {
    signInFixtureMember()
    useMswHandlers(
      http.get(PLANNER_PATH, () =>
        HttpResponse.json(errorBody(400, 'No location preferences found for user'), {
          status: 400,
        })
      )
    )
    renderRail({ hideHeader: true })

    const setCity = await screen.findByTestId('planner-set-city')
    expect(setCity).toHaveAttribute(
      'href',
      '/settings/places?addLocation=1&returnTo=%2Flooks%3Fsegment%3Dplan#locations'
    )
    expect(screen.queryByTestId('plan-free-preview')).toBeNull()
  })

  it('7.12-UNIT-051d the loading skeleton shows while the read is out, with no preview', async () => {
    signInFixtureMember()
    let release!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    useMswHandlers(
      http.get(PLANNER_PATH, async () => {
        await held
        return HttpResponse.json(buildResponse(SEVEN_DATES.map((d) => buildReadyDay(d))))
      })
    )
    renderRail({ hideHeader: true })

    expect(await screen.findByTestId('planner-skeleton')).toBeInTheDocument()
    expect(screen.queryByTestId('plan-free-preview')).toBeNull()
    release()
    expect(await screen.findByTestId('planner-days')).toBeInTheDocument()
  })
})
