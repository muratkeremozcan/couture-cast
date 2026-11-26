// Learning path Step 58: Production status and nightly health, production follow-ups.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#production-follow-ups-after-the-project-close
import { CommunitySyncState } from '@couture/api-client'
// Learning path Step 25: Lookbook Prism responsive layout and community grid.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-25-lookbook-prism-responsive-layout-and-community-grid
// Learning path Step 26: Chip navigation and sticky bottom nav.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-26-chip-navigation-and-sticky-bottom-nav
// Learning path Step 28: Accessibility hardening.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-28-accessibility-hardening
// Story 3.5 Task 6 step 3 owner: Lookbook Prism responsive layout, comparison mode, and focus rings.
// Learning path Step 68: Five-tab navigation and back pattern.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-68-five-tab-navigation-and-back-pattern
// Story CC-7.11 test owner (TEA): 7.11-CMP-HOME-PLAN-01..04 (D9: the Home drawer and the 320 px
// rail column are gone). Story CC-7.12 D11: Plan week opens Looks on Plan
// (`/looks?segment=plan`) in one tap. The /?planner=1 server redirect is
// app/looks/legacy-redirects.test.ts; the planner gate cases render on the Looks Plan segment in
// app/looks/page.test.tsx.
// Learning path Step 69: Looks tab for saved looks, ideas and plans.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-69-looks-tab-for-saved-looks-ideas-and-plans
// Test design: _bmad-output/test-artifacts/test-design-7-12-looks-tab-saved-looks-ideas-plans.md
// Test design: _bmad-output/test-artifacts/test-design-7-11-five-tab-navigation-back-pattern.md
import { render, screen, fireEvent, within } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { http, HttpResponse } from 'msw'
import { useMswHandlers } from '../../test-utils/msw/runtime'
import { signInFixtureMember } from '../../test-utils/member-session'
import { LookbookPrismLayout } from './lookbook-prism-layout'

vi.mock('posthog-js', () => ({
  default: {
    capture: vi.fn(),
  },
}))

// Story CC-7.12 D7: the Home sample outfit's View pushes the saved look through the app router.
vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    prefetch: vi.fn(),
  }),
  useSearchParams: () => new URLSearchParams(),
}))

// Story CC-7.11 D9: Home no longer imports the planner; this stand-in proves it never mounts.
const plannerRail = vi.hoisted(() => vi.fn(() => null))
vi.mock('./planner-rail', () => ({ PlannerRail: plannerRail }))

/**
 * Story 6.1: the community column reads `GET /api/v1/community/feed` through
 * `lib/community.ts`, which throws `signed_out` without a bearer token, so any
 * test that needs a rendered card signs in and serves one post.
 */
const COMMUNITY_POST_ID = 'community-post-1'

function signIn() {
  signInFixtureMember()
}

function communityFeedHandler() {
  return http.get('/api/v1/community/feed', () =>
    HttpResponse.json({
      data: {
        items: [
          {
            id: COMMUNITY_POST_ID,
            caption: 'Wool trench over a silk scarf for a crisp commute.',
            altText: 'A camel wool trench over a patterned silk scarf.',
            climateBand: 'temperate_wet',
            imageAccess: {
              url: 'https://storage.local/community/community-post-1.jpg',
              expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
            },
            publishedAt: '2026-09-05T12:00:00.000Z',
            createdAt: '2026-09-05T12:00:00.000Z',
            status: 'published',
            challengeId: null,
            author: { displayName: 'Style Explorer 91C4', isSelf: false },
          },
        ],
        authorStates: [],
        nextCursor: null,
        mode: 'auto',
        viewerBand: 'temperate_wet',
        bandResolved: true,
        bandUnresolvedReason: null,
        experimentVariant: 'auto',
        activeChallenge: null,
      },
    })
  )
}

describe('LookbookPrismLayout (Integration 3.5-INT-001 - 3.5-INT-005)', () => {
  beforeEach(() => {
    // Story6.5 transport is covered independently; these legacy presentation cases own static HTTP.
    vi.spyOn(CommunitySyncState.prototype, 'start').mockImplementation(() => undefined)
    vi.clearAllMocks()
    window.sessionStorage.clear()
  })

  it('3.5-INT-001: Renders Lookbook Prism responsive container with primary regions', () => {
    render(<LookbookPrismLayout />)

    const grid = screen.getByTestId('lookbook-prism-grid')
    expect(grid).toHaveClass('min-[1280px]:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]')
    // Story CC-7.11 D9: the 320 px planner rail column left with the drawer, so the grid holds
    // two columns at every width.
    expect(grid.className).not.toMatch(/min-\[1440px\]:grid-cols-/)
    expect(grid.className).not.toContain('320px')
    expect(grid.children).toHaveLength(2)
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

  /**
   * The old form read `New` off the chip strip and "Milan Autumn Wool Trench" off
   * `MOCK_LOOKBOOK_ITEMS`; both are gone, because the spec's Boundaries forbid a
   * chip with no server behind it.
   */
  it('3.5-INT-005: Keeps the member outfit before Community filters and cards', async () => {
    signIn()
    useMswHandlers(
      communityFeedHandler(),
      http.get('/api/v1/ritual', () =>
        HttpResponse.json(
          { message: 'No location preferences found for user' },
          { status: 400 }
        )
      )
    )
    render(<LookbookPrismLayout />)

    const community = await screen.findByTestId(`lookbook-card-${COMMUNITY_POST_ID}`)
    const hero = screen.getByRole('region', { name: /hero ritual canvas/i })
    const communitySection = screen.getByRole('region', { name: 'Community Section' })
    const outfit = await within(hero).findByTestId('member-sample-outfit')

    // Production follow-up 2026-11-19: the climate filters moved out of the hero
    // column and into the Community Section, beside the feed they filter. On a
    // phone the old order put the outfit cards between the chips and the looks.
    // Home renders exactly one filter nav now, so no second nav can disagree
    // with the grid about the served mode or the resolved band.
    const filterNavs = screen.getAllByRole('navigation', { name: 'Community filters' })
    expect(filterNavs).toHaveLength(1)
    const filterNav = filterNavs[0]!
    expect(communitySection).toContainElement(filterNav)
    expect(hero).not.toContainElement(filterNav)
    const filter = within(filterNav).getByTestId('community-filter-auto')

    expect(
      outfit.compareDocumentPosition(filter) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(
      filter.compareDocumentPosition(community) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(outfit).not.toHaveAttribute('tabindex')
    expect(community).toHaveAttribute('tabindex', '-1')
  })

  it('7.9 P2-10 keeps the embedded feed New post neutral so Open wardrobe stays Home gold primary', async () => {
    signIn()
    useMswHandlers(
      communityFeedHandler(),
      http.get('/api/v1/ritual', () =>
        HttpResponse.json(
          { message: 'No location preferences found for user' },
          { status: 400 }
        )
      )
    )
    render(<LookbookPrismLayout />)
    await screen.findByTestId(`lookbook-card-${COMMUNITY_POST_ID}`)

    const newPost = await screen.findByTestId('create-post-button')
    expect(newPost).not.toHaveAttribute('data-gold')
    expect(newPost).toHaveClass('border-line-strong', 'bg-page', 'text-ink')
    expect(newPost).not.toHaveClass('bg-primary')
  })

  /**
   * Story CC-7.11 D9 replaced the Home drawer (Story 5.5 Decision 7): "Plan week" is a link to
   * Looks (CC-7.12 D11: the Plan segment), so pressing it navigates and Home never mounts the
   * planner itself.
   */
  it('7.11-CMP-HOME-PLAN-01 7.12-E2E-034 Plan week is a link to Looks on Plan and opens no planner on Home', () => {
    render(<LookbookPrismLayout />)

    const control = screen.getByTestId('planner-open-control')
    expect(control.tagName).toBe('A')
    expect(control).toHaveAttribute('href', '/looks?segment=plan')
    expect(control).toHaveTextContent('Plan week')

    fireEvent.click(control)
    expect(
      screen.queryByRole('complementary', { name: /planner rail/i })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /close planner/i })
    ).not.toBeInTheDocument()
  })

  /**
   * The >=1440px inline rail slot left with the drawer: a wide Home renders the same two
   * columns and still holds no planner after Plan week is pressed.
   */
  it('7.11-CMP-HOME-PLAN-02 renders no rail slot at 1440px and wider', () => {
    const originalInnerWidth = window.innerWidth
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: 1440,
    })

    try {
      render(<LookbookPrismLayout />)
      fireEvent(window, new Event('resize'))

      fireEvent.click(screen.getByTestId('planner-open-control'))
      expect(
        screen.queryByRole('complementary', { name: /planner rail/i })
      ).not.toBeInTheDocument()
      expect(screen.getByTestId('lookbook-prism-grid').children).toHaveLength(2)
    } finally {
      Object.defineProperty(window, 'innerWidth', {
        writable: true,
        configurable: true,
        value: originalInnerWidth,
      })
    }
  })

  /**
   * Story 5.2 Decision 2's gate now renders on the Looks Plan segment (app/looks/page.test.tsx,
   * the free preview since CC-7.12). Home's part is to mount no planner at all, at either width,
   * before or after Plan week is pressed.
   */
  it('7.11-CMP-HOME-PLAN-03 never mounts the planner on Home, narrow or wide', () => {
    const originalInnerWidth = window.innerWidth
    try {
      for (const width of [1024, 1440]) {
        Object.defineProperty(window, 'innerWidth', {
          writable: true,
          configurable: true,
          value: width,
        })
        const view = render(<LookbookPrismLayout />)
        fireEvent(window, new Event('resize'))
        fireEvent.click(screen.getByTestId('planner-open-control'))
        view.unmount()
      }
      expect(plannerRail).not.toHaveBeenCalled()
    } finally {
      Object.defineProperty(window, 'innerWidth', {
        writable: true,
        configurable: true,
        value: originalInnerWidth,
      })
    }
  })

  /**
   * `/?planner=1` is answered by next.config.ts before Home renders, so Home neither opens a
   * drawer for the query nor edits the address bar any more.
   */
  it('7.11-CMP-HOME-PLAN-04 leaves a planner=1 query alone and opens nothing on Home', () => {
    window.history.replaceState(window.history.state, '', '/?planner=1')
    try {
      render(<LookbookPrismLayout />)

      expect(window.location.search).toBe('?planner=1')
      expect(
        screen.queryByRole('complementary', { name: /planner rail/i })
      ).not.toBeInTheDocument()
    } finally {
      window.history.replaceState(window.history.state, '', '/')
    }
  })

  /**
   * Story 6.1: the chip category no longer selects a feed filter; all three land
   * on `auto`. What it still synchronizes is the hero copy and the grid's
   * `data-chip-category`. The old assertion that "Parisian Silk & Cashmere Blend"
   * appeared TWICE was reading the hero title and a `MOCK_LOOKBOOK_ITEMS` card
   * that no longer exists.
   */
  it('synchronizes chip selection across hero and community content', () => {
    render(<LookbookPrismLayout />)

    expect(screen.getByTestId('hero-recommendation-title')).toHaveTextContent(
      'Double-Breasted Blazer & Silk Knit'
    )
    expect(screen.getByTestId('community-card-grid')).toHaveAttribute(
      'data-chip-category',
      'Personal'
    )

    fireEvent.click(screen.getByTestId('chip-community'))

    expect(screen.getByTestId('hero-recommendation-title')).toHaveTextContent(
      'Parisian Silk & Cashmere Blend'
    )
    expect(screen.getAllByText('Parisian Silk & Cashmere Blend')).toHaveLength(1)
    expect(screen.getByTestId('community-card-grid')).toHaveAttribute(
      'data-chip-category',
      'Community'
    )
  })

  /**
   * The hero card is hardcoded story 3.5 design copy, and the `Sponsored` chip's
   * entry used to read "Sponsored Selection" over "A clearly labeled brand
   * selection": a paid-placement disclosure over content with no partner behind
   * it. Story 5.1 owns the real vocabulary for that ("Paid partnership",
   * "Presented by {{partner}}"), and it renders only beside an offer that exists.
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
