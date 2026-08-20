// Learning path Step 25: Lookbook Prism responsive layout and community grid.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-25-lookbook-prism-responsive-layout-and-community-grid
// Learning path Step 26: Chip navigation and sticky bottom nav.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-26-chip-navigation-and-sticky-bottom-nav
// Learning path Step 28: Accessibility hardening.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-28-accessibility-hardening
// Story 3.5 Task 6 step 3 owner: integration-test Lookbook Prism responsive layout, comparison mode, and focus rings in apps/web/src/app/components/lookbook-prism-layout.test.tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { http, HttpResponse } from 'msw'
import { useMswHandlers } from '../../test-utils/msw/runtime'
import { WEB_ACCESS_TOKEN_STORAGE_KEY } from '../../lib/wardrobe'
import { LookbookPrismLayout } from './lookbook-prism-layout'

// Mock posthog-js
vi.mock('posthog-js', () => ({
  default: {
    capture: vi.fn(),
  },
}))

vi.mock('next/navigation', () => ({
  usePathname: () => '/',
}))

describe('LookbookPrismLayout (Integration 3.5-INT-001 - 3.5-INT-005)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.sessionStorage.clear()
  })

  it('3.5-INT-001: Renders Lookbook Prism responsive container with primary regions', () => {
    render(<LookbookPrismLayout />)

    const grid = screen.getByTestId('lookbook-prism-grid')
    expect(grid).toHaveClass('min-[1280px]:grid-cols-2')
    expect(grid).toHaveClass('min-[1440px]:grid-cols-[1fr_1fr_320px]')
    expect(
      screen.getByRole('region', { name: /hero ritual canvas/i })
    ).toBeInTheDocument()
    expect(screen.getByRole('region', { name: /community section/i })).toBeInTheDocument()
    expect(screen.getByTestId('community-card-grid')).toHaveClass(
      'min-[768px]:grid-cols-2'
    )
  })

  it('3.5-INT-002: Comparison Mode renders dual outfit cards side-by-side', () => {
    render(<LookbookPrismLayout />)

    const comparisonBtn = screen.getByRole('button', { name: /comparison mode/i })
    fireEvent.click(comparisonBtn)

    expect(screen.getByTestId('comparison-container')).toBeInTheDocument()
    expect(screen.getByText(/LOOK A \(Primary\)/i)).toBeInTheDocument()
    expect(screen.getByText(/LOOK B \(Alternative\)/i)).toBeInTheDocument()
  })

  it('3.5-INT-003: Mobile Preview applies simulated device container frame', () => {
    render(<LookbookPrismLayout />)

    const mobileBtn = screen.getByRole('button', { name: /mobile preview/i })
    fireEvent.click(mobileBtn)

    const container = screen.getByTestId('lookbook-prism-container')
    expect(container).toHaveClass('max-w-[375px]')
    expect(container).toHaveClass('max-h-[812px]')
    expect(container).toHaveClass('overflow-y-auto')
    expect(screen.getByTestId('sticky-bottom-nav')).toHaveClass('sticky')
    expect(screen.getByTestId('community-card-grid')).not.toHaveClass(
      'min-[768px]:grid-cols-2'
    )
  })

  it('3.5-INT-004: Applies reduced-motion overrides', () => {
    render(<LookbookPrismLayout />)
    expect(screen.getByTestId('lookbook-prism-container')).toHaveClass(
      'motion-reduce:transition-none'
    )
  })

  it('3.5-INT-005: Keeps semantic reading order and excludes static cards from Tab', () => {
    render(<LookbookPrismLayout />)

    const hero = screen.getByRole('region', { name: /hero ritual canvas/i })
    const filter = screen.getByRole('button', { name: /^new$/i })
    const garment = screen.getByText(/double-breasted blazer/i).closest('div.group')
    const community = screen.getByText(/milan autumn wool trench/i).closest('article')

    if (!garment || !community) {
      throw new Error('Expected focus targets')
    }

    expect(
      hero.compareDocumentPosition(filter) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(
      filter.compareDocumentPosition(garment) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(
      garment.compareDocumentPosition(community) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(garment).not.toHaveAttribute('tabindex')
    expect(community).toHaveAttribute('tabindex', '-1')
  })

  it('restores the planner after it is closed', () => {
    render(<LookbookPrismLayout />)

    fireEvent.click(screen.getByRole('button', { name: /close planner rail/i }))
    const openPlanner = screen.getByRole('button', {
      name: /open planner rail/i,
    })
    fireEvent.click(openPlanner)

    expect(
      screen.getByRole('complementary', { name: /planner rail/i })
    ).toBeInTheDocument()
  })

  /**
   * Story 5.2 Decision 2: the rail is the story's one real premium gate. With
   * no session there is no entitlement request at all — the locked upsell is
   * the default, which is also what the signed-out accessibility run sees.
   */
  it('5.2-WEB-RAIL-01 renders the locked upsell signed out, with no request', () => {
    render(<LookbookPrismLayout />)

    const rail = screen.getByRole('complementary', { name: /planner rail/i })
    expect(rail).toBeInTheDocument()
    expect(screen.getByTestId('planner-rail-locked')).toHaveTextContent(
      'The 7-Day Planner is a Premium feature'
    )
    const cta = screen.getByTestId('planner-rail-get-premium')
    expect(cta).toHaveAttribute('href', '/settings')
    expect(cta).toHaveTextContent('Get Premium')
    expect(screen.queryByText(/waterproof trench/i)).not.toBeInTheDocument()
  })

  it('5.2-WEB-RAIL-02 renders the planner shell for an entitled user', async () => {
    window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, 'test-access-token')
    useMswHandlers(
      http.get('/api/v1/commerce/subscription', () =>
        HttpResponse.json({
          data: {
            status: 'active',
            store: 'stripe',
            productId: 'premium_monthly',
            willRenew: true,
            currentPeriodEnd: '2026-09-12T00:00:00.000Z',
            syncedAt: '2026-08-12T00:00:00.000Z',
            purchasesEnabled: true,
          },
        })
      )
    )

    render(<LookbookPrismLayout />)

    await waitFor(() =>
      expect(screen.getByText(/waterproof trench/i)).toBeInTheDocument()
    )
    expect(screen.queryByTestId('planner-rail-locked')).not.toBeInTheDocument()
  })

  /** A non-entitled subscription state must not unlock the rail. */
  it('5.2-WEB-RAIL-03 keeps the locked upsell for an expired subscription', async () => {
    window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, 'test-access-token')
    const requested = vi.fn()
    useMswHandlers(
      http.get('/api/v1/commerce/subscription', () => {
        requested()
        return HttpResponse.json({
          data: {
            status: 'expired',
            store: 'stripe',
            productId: 'premium_monthly',
            willRenew: false,
            currentPeriodEnd: '2026-07-12T00:00:00.000Z',
            syncedAt: '2026-08-12T00:00:00.000Z',
            purchasesEnabled: true,
          },
        })
      })
    )

    render(<LookbookPrismLayout />)

    await waitFor(() => expect(requested).toHaveBeenCalled())
    expect(screen.getByTestId('planner-rail-locked')).toBeInTheDocument()
    expect(screen.queryByText(/waterproof trench/i)).not.toBeInTheDocument()
  })

  it('synchronizes chip selection across hero and community content', () => {
    render(<LookbookPrismLayout />)

    expect(screen.getByTestId('hero-recommendation-title')).toHaveTextContent(
      'Double-Breasted Blazer & Silk Knit'
    )
    expect(screen.getByText('Milan Autumn Wool Trench')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('chip-community'))

    expect(screen.getByTestId('hero-recommendation-title')).toHaveTextContent(
      'Parisian Silk & Cashmere Blend'
    )
    expect(screen.getAllByText('Parisian Silk & Cashmere Blend')).toHaveLength(2)
    expect(screen.getByTestId('community-card-grid')).toHaveAttribute(
      'data-chip-category',
      'Community'
    )
  })

  /**
   * The hero card is hardcoded story 3.5 design copy, and the `Sponsored` chip's
   * entry used to read "Sponsored Selection" over "A clearly labeled brand
   * selection" — a paid-placement disclosure over content with no partner
   * behind it. Story 5.1 owns the real vocabulary for that ("Paid partnership",
   * "Presented by {{partner}}"), and it renders only beside an offer that
   * exists.
   *
   * This asserts the negative because that is the failure mode: nothing about
   * the page looks wrong when placeholder copy claims a sponsorship, so only a
   * test that refuses the words will catch it coming back.
   */
  it('does not claim a commercial relationship in the Brands hero copy', () => {
    render(<LookbookPrismLayout />)

    fireEvent.click(screen.getByTestId('chip-sponsored'))

    const heroCard = screen.getByTestId('hero-recommendation-title').closest('div')
    expect(heroCard).not.toBeNull()

    const heroCopy = heroCard?.textContent ?? ''
    expect(heroCopy).not.toMatch(/sponsored/i)
    expect(heroCopy).not.toMatch(/paid partnership/i)
    expect(heroCopy).not.toMatch(/presented by/i)
    expect(heroCopy).not.toMatch(/commission/i)
    expect(heroCopy).toContain('Brand Picks')
  })
})
