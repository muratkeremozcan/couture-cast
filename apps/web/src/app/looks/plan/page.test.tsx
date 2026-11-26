// Learning path Step 68: Five-tab navigation and back pattern.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-68-five-tab-navigation-and-back-pattern
// Story CC-7.11 test owner (TEA): 7.11-CMP-PLAN-01 to 7.11-CMP-PLAN-06 (D9, D10). The planner
// gate cases moved here from Home's 5.2-WEB-RAIL-01 to 03 when the drawer left Home.
// Test design: _bmad-output/test-artifacts/test-design-7-11-five-tab-navigation-back-pattern.md
import { render, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PREMIUM_REQUIRED_MESSAGE } from '@couture/api-client/contracts/http'
import { WEB_ACCESS_TOKEN_STORAGE_KEY } from '../../../lib/wardrobe'
import { useMswHandlers } from '../../../test-utils/msw/runtime'
import { signInFixtureMember } from '../../../test-utils/member-session'
import LooksPlanPage from './page'

const router = vi.hoisted(() => ({
  back: vi.fn(),
  replace: vi.fn(),
  push: vi.fn(),
  prefetch: vi.fn(),
}))
vi.mock('next/navigation', () => ({
  usePathname: () => '/looks/plan',
  useRouter: () => router,
}))
vi.mock('posthog-js', () => ({ default: { capture: vi.fn() } }))

const PLANNER_PATH = '/api/v1/commerce/premium/planner'

/** One valid seven-date, all-ready planner window (packages/api-client/testing/planner-contract.spec.ts). */
function buildPlannerResponse() {
  const dates = [
    '2026-09-10',
    '2026-09-11',
    '2026-09-12',
    '2026-09-13',
    '2026-09-14',
    '2026-09-15',
    '2026-09-16',
  ]
  return {
    data: {
      locationId: 'location-1',
      timezone: 'America/New_York',
      anchorDate: dates[0],
      daysReady: 7,
      days: dates.map((planDate) => ({
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
        outfits: (['morning', 'midday', 'evening'] as const).map((scenario) => ({
          id: `${planDate}-${scenario}`,
          scenario,
          garmentIds: ['garment-1'],
          reasoningBadges: [],
          comfortNotes: 'Layer up; it will feel cooler than it reads.',
          capsuleId: null,
          capsuleName: null,
          autoFilledGarmentIds: [],
          displayGarments: [
            { id: 'garment-1', category: 'top' as const, imageAccess: null },
          ],
          shopThisLook: null,
        })),
      })),
    },
  }
}

const startUrl = window.location.href

beforeEach(() => {
  window.history.replaceState(null, '', '/looks/plan')
})

afterEach(() => {
  window.sessionStorage.removeItem(WEB_ACCESS_TOKEN_STORAGE_KEY)
  window.history.replaceState(null, '', startUrl)
})

describe('7.11 Plan route (D9)', () => {
  it('7.11-CMP-PLAN-01 titles the screen Plan with a back link to Looks, and the rail drops its own heading row and X', () => {
    render(<LooksPlanPage />)

    expect(screen.getByTestId('app-top-bar-title')).toHaveTextContent('Plan')
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    const back = screen.getByTestId('app-top-bar-back')
    expect(back).toHaveAttribute('href', '/looks')
    expect(back).toHaveTextContent('Back')
    expect(screen.getByTestId('bottom-nav-looks')).toHaveAttribute('aria-current', 'page')

    const rail = screen.getByRole('complementary', { name: 'Planner Rail' })
    expect(screen.getByRole('main')).toContainElement(rail)
    // The rail variant is page content: no overlay chrome.
    expect(rail).not.toHaveClass('fixed')
    // The top bar carries title and back, so the rail's heading row and close button are gone.
    expect(within(rail).queryByText('7-Day Outfit Planner')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Close planner' })).toBeNull()
  })

  it('7.11-CMP-PLAN-02 (was 5.2-WEB-RAIL-01) renders the locked upsell signed out, with no request', () => {
    const requested = vi.fn()
    useMswHandlers(
      http.get(PLANNER_PATH, () => {
        requested()
        return HttpResponse.json(buildPlannerResponse())
      })
    )

    render(<LooksPlanPage />)

    expect(screen.getByTestId('planner-rail-locked')).toHaveTextContent(
      'The 7-Day Planner is a Premium feature'
    )
    const cta = screen.getByTestId('planner-rail-get-premium')
    expect(cta).toHaveAttribute('href', '/settings')
    expect(cta).toHaveTextContent('Get Premium')
    expect(requested).not.toHaveBeenCalled()
  })

  it('7.11-CMP-PLAN-03 (was 5.2-WEB-RAIL-02) renders the week for an entitled member', async () => {
    signInFixtureMember()
    useMswHandlers(
      http.get(PLANNER_PATH, () => HttpResponse.json(buildPlannerResponse()))
    )

    render(<LooksPlanPage />)

    await waitFor(() => expect(screen.getByTestId('planner-days')).toBeInTheDocument())
    expect(screen.queryByTestId('planner-rail-locked')).toBeNull()
  })

  it('7.11-CMP-PLAN-04 (was 5.2-WEB-RAIL-03) keeps the locked upsell for a member without Premium', async () => {
    signInFixtureMember()
    const requested = vi.fn()
    useMswHandlers(
      http.get(PLANNER_PATH, () => {
        requested()
        return HttpResponse.json(
          { statusCode: 403, message: PREMIUM_REQUIRED_MESSAGE, error: 'Forbidden' },
          { status: 403 }
        )
      })
    )

    render(<LooksPlanPage />)

    await waitFor(() => expect(requested).toHaveBeenCalled())
    expect(await screen.findByTestId('planner-rail-locked')).toBeInTheDocument()
  })

  // Codex 7.11 #1: the query is dropped through the router, so the router's URL agrees with the
  // address bar and the replace keeps the entry's place in the in-app history (no raw
  // replaceState with the router's state, which Next skipped).
  it('7.11-CMP-PLAN-05 drops the passed-through planner query with one router replace, so history keeps one entry', () => {
    window.history.replaceState(null, '', '/looks/plan?planner=1&from=home')
    const depth = window.history.length
    const replaceState = vi.spyOn(window.history, 'replaceState')

    render(<LooksPlanPage />)

    expect(router.replace).toHaveBeenCalledTimes(1)
    expect(router.replace).toHaveBeenCalledWith('/looks/plan?from=home', {
      scroll: false,
    })
    expect(replaceState, 'the router owns the replace').not.toHaveBeenCalled()
    expect(window.history.length).toBe(depth)
    expect(router.push).not.toHaveBeenCalled()
  })

  it('7.11-CMP-PLAN-06 leaves a URL without the planner query untouched', () => {
    window.history.replaceState(null, '', '/looks/plan?from=home')
    const replace = vi.spyOn(window.history, 'replaceState')

    render(<LooksPlanPage />)

    expect(window.location.search).toBe('?from=home')
    expect(replace).not.toHaveBeenCalled()
    expect(router.replace).not.toHaveBeenCalled()
  })
})
