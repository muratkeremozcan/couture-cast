// Learning path Step 26: Chip navigation and sticky bottom nav.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-26-chip-navigation-and-sticky-bottom-nav
// Story 3.6 Task 5 step 2 owner: unit-test web sticky bottom navigation mobile visibility and telemetry in apps/web/src/app/components/sticky-bottom-nav.test.tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { StickyBottomNav } from './sticky-bottom-nav'

const posthogMocks = vi.hoisted(() => ({
  capture: vi.fn(),
}))
const navigationMocks = vi.hoisted(() => ({
  pathname: '/',
}))

vi.mock('posthog-js', () => ({
  default: {
    capture: posthogMocks.capture,
  },
}))

vi.mock('next/navigation', () => ({
  usePathname: () => navigationMocks.pathname,
}))

function BottomNavHarness({ isMobilePreview = false }: { isMobilePreview?: boolean }) {
  return <StickyBottomNav isMobilePreview={isMobilePreview} />
}

describe('StickyBottomNav Component (Story 3.6)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    navigationMocks.pathname = '/'
  })

  it('3.6-UNIT-006: renders 4 destination tabs with gold active indicator line on active route', () => {
    render(<BottomNavHarness />)

    const homeTab = screen.getByTestId('bottom-nav-home')
    const wardrobeTab = screen.getByTestId('bottom-nav-wardrobe')
    const communityTab = screen.getByTestId('bottom-nav-community')
    const settingsTab = screen.getByTestId('bottom-nav-settings')

    expect(homeTab).toHaveAttribute('aria-current', 'page')
    expect(wardrobeTab).not.toHaveAttribute('aria-current')
    expect(communityTab).not.toHaveAttribute('aria-current')
    expect(settingsTab).not.toHaveAttribute('aria-current')

    expect(
      homeTab.querySelector('[data-testid="gold-active-indicator"]')
    ).toBeInTheDocument()
    expect(
      wardrobeTab.querySelector('[data-testid="gold-active-indicator"]')
    ).not.toBeInTheDocument()
    expect(homeTab).toHaveAttribute('href', '/')
    expect(wardrobeTab).toHaveAttribute('href', '/wardrobe')
    expect(communityTab).toHaveAttribute('href', '/community')
    expect(settingsTab).toHaveAttribute('href', '/settings')
  })

  it('3.6-UNIT-007: emits PostHog bottom_nav_clicked event on tab selection', () => {
    render(<BottomNavHarness />)

    const communityTab = screen.getByTestId('bottom-nav-community')
    fireEvent.click(communityTab)

    expect(posthogMocks.capture).toHaveBeenCalledWith('bottom_nav_clicked', {
      tabId: 'community',
      label: 'Community',
      targetPath: '/community',
    })

    expect(screen.getByTestId('bottom-nav-status')).toHaveTextContent(
      'Navigated to Community tab'
    )
  })

  it('derives the active destination from the current pathname', () => {
    navigationMocks.pathname = '/community'
    render(<BottomNavHarness />)

    expect(screen.getByTestId('bottom-nav-community')).toHaveAttribute(
      'aria-current',
      'page'
    )
    expect(screen.getByTestId('bottom-nav-home')).not.toHaveAttribute('aria-current')
  })

  it('3.6-UNIT-008: applies responsive mobile visibility classes and forces visibility in mobile preview', () => {
    const { rerender } = render(<StickyBottomNav isMobilePreview={false} />)

    const navElement = screen.getByTestId('sticky-bottom-nav')
    expect(navElement.className).toContain('fixed')
    expect(navElement.className).toContain('min-[768px]:hidden')

    rerender(<StickyBottomNav isMobilePreview={true} />)
    const previewNavElement = screen.getByTestId('sticky-bottom-nav')
    expect(previewNavElement.className).toContain('sticky')
    expect(previewNavElement.className).toContain('flex')
    expect(previewNavElement.className).not.toContain('min-[768px]:hidden')
  })
})
