// Story 5.5 Task 7 owner: component tests for the live seven-day planner rail.
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
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
import { WEB_ACCESS_TOKEN_STORAGE_KEY } from '../../lib/wardrobe'
import { getI18n } from '../../i18n'
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

  it('renders the locked upsell signed out with no request', () => {
    const requested = vi.fn()
    useMswHandlers(
      http.get(PLANNER_PATH, () => {
        requested()
        return HttpResponse.json(buildResponse(SEVEN_DATES.map((d) => buildReadyDay(d))))
      })
    )
    renderRail()
    expect(screen.getByTestId('planner-rail-locked')).toBeInTheDocument()
    expect(requested).not.toHaveBeenCalled()
  })

  it('shows a checking skeleton before the request resolves', async () => {
    window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, 'token')
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
    window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, 'token')
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
    window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, 'token')
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
    window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, 'token')
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

  it('locks with the not-entitled upsell on a 403 from PremiumEntitlementGuard', async () => {
    window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, 'token')
    useMswHandlers(
      http.get(PLANNER_PATH, () =>
        HttpResponse.json(errorBody(403, PREMIUM_REQUIRED_MESSAGE), { status: 403 })
      )
    )
    renderRail()
    expect(await screen.findByTestId('planner-rail-locked')).toBeInTheDocument()
  })

  it('shows the disabled note (not the upsell) when the flag is off', async () => {
    window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, 'token')
    useMswHandlers(
      http.get(PLANNER_PATH, () =>
        HttpResponse.json(errorBody(503, PREMIUM_PLANNER_DISABLED_MESSAGE), {
          status: 503,
        })
      )
    )
    renderRail()
    expect(await screen.findByTestId('planner-rail-disabled')).toBeInTheDocument()
    expect(screen.queryByTestId('planner-rail-locked')).not.toBeInTheDocument()
  })

  it('offers a localized retry on an unclassified failure', async () => {
    window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, 'token')
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
    window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, 'token')
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
    window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, 'token')
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
    window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, 'token')
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
    window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, 'token')
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
    window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, 'token')
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
    window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, 'token')
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
    window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, 'token')
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
    expect(screen.getByTestId('planner-rail-locked')).toBeInTheDocument()

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

  it('aborts an in-flight reshuffle, not just the week fetch, when the rail closes', async () => {
    window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, 'token')
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
    window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, 'token')
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

  it('does not refresh on window focus once closed', async () => {
    window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, 'token')
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

  it('locks with the not-entitled upsell when a reshuffle discovers entitlement lapsed', async () => {
    window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, 'token')
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
    expect(await screen.findByTestId('planner-rail-locked')).toBeInTheDocument()
  })

  it('shows the disabled note when a reshuffle discovers the flag went off', async () => {
    window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, 'token')
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
      expect(screen.getByTestId('planner-rail-locked')).toBeInTheDocument()
    )

    fireEvent.keyDown(screen.getByRole('complementary'), { key: 'a' })
    expect(onClose).not.toHaveBeenCalled()
    expect(document.activeElement).toHaveAccessibleName('Close planner')
  })

  it('wraps Tab forward and Shift+Tab backward between the overlay endpoints', async () => {
    renderRail({ variant: 'overlay' })
    await waitFor(() =>
      expect(screen.getByTestId('planner-rail-locked')).toBeInTheDocument()
    )

    const overlay = screen.getByRole('complementary')
    const closeButton = screen.getByRole('button', { name: 'Close planner' })
    const getPremiumLink = screen.getByTestId('planner-rail-get-premium')
    expect(document.activeElement).toBe(closeButton)

    // Shift+Tab from the first focusable element wraps to the last.
    fireEvent.keyDown(overlay, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(getPremiumLink)

    // Tab from the last focusable element wraps to the first.
    fireEvent.keyDown(overlay, { key: 'Tab' })
    expect(document.activeElement).toBe(closeButton)
  })

  // Story 5.5 Task 9 (AC 7): the axe matrix. `variant` stands in for the two
  // supported widths -- `rail` is the >=1440px desktop layout, `overlay` is
  // the narrower phone/tablet layout (Decision 7) -- and each is checked both
  // signed out (the locked upsell, no request) and entitled (the full ready
  // week). The two states render structurally different DOM (a locked panel
  // vs. seven day cards), so a pass on one variant/state combination says
  // nothing about the others; all four are asserted independently rather than
  // deduplicated into one "representative" case.
  describe.each([
    ['rail' as const, 'desktop'],
    ['overlay' as const, 'phone'],
  ])('automated accessibility, %s variant (%s width)', (variant, _widthLabel) => {
    it('passes signed out with the locked upsell', async () => {
      const { container } = renderRail({ variant })
      await waitFor(() =>
        expect(screen.getByTestId('planner-rail-locked')).toBeInTheDocument()
      )

      const results = await axe.run(container, {
        runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
      })
      expect(results.violations).toEqual([])
    })

    it('passes entitled with a full ready week', async () => {
      window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, 'token')
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
