// Learning path Step 36: Colour palette, beauty and accessory advisor.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-36-colour-palette-beauty-and-accessory-advisor
// Learning path Step 26: Chip navigation and sticky bottom nav.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-26-chip-navigation-and-sticky-bottom-nav
// Learning path Step 58: Production follow-ups after the project close.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-58-production-follow-ups-after-the-project-close
// Story 3.6 Task 5 step 2 owner: sticky bottom navigation mobile visibility and telemetry.
import { act, render, screen, fireEvent, within } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { getI18n } from '../../i18n'
import { ProfileNavLink } from './profile-nav-link'
import { resolveActiveNavTab, StickyBottomNav } from './sticky-bottom-nav'

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

  /**
   * Story 5.4 Decision 14. The exact-equality match this replaced highlighted Home on
   * every nested route, so `/wardrobe/capsules` told the reader they were on the home
   * tab. Adding `/palette`, a destination route under no tab at all, is what made
   * the second half of the rule necessary: no tab is a real answer, and defaulting to
   * Home is the same lie in a different place.
   */
  it('5.4-WEB-030: resolves the active tab by longest prefix, with no tab for /palette', () => {
    expect(resolveActiveNavTab('/')).toBe('home')
    expect(resolveActiveNavTab('/wardrobe')).toBe('wardrobe')
    expect(resolveActiveNavTab('/wardrobe/capsules')).toBe('wardrobe')
    expect(resolveActiveNavTab('/wardrobe/onboarding')).toBe('wardrobe')
    expect(resolveActiveNavTab('/settings')).toBe('settings')
    expect(resolveActiveNavTab('/community')).toBe('community')
    // A sibling route that merely starts with the same characters is not nested
    // under the tab, so the boundary check has to reject it.
    expect(resolveActiveNavTab('/wardrobe-silhouette')).toBeNull()
    expect(resolveActiveNavTab('/palette')).toBeNull()
    expect(resolveActiveNavTab('/signup')).toBeNull()
    expect(resolveActiveNavTab(null)).toBeNull()
  })

  it('5.4-WEB-031: highlights Wardrobe on a nested wardrobe route', () => {
    navigationMocks.pathname = '/wardrobe/capsules'
    render(<BottomNavHarness />)

    expect(screen.getByTestId('bottom-nav-wardrobe')).toHaveAttribute(
      'aria-current',
      'page'
    )
    expect(screen.getByTestId('bottom-nav-home')).not.toHaveAttribute('aria-current')
  })

  it('5.4-WEB-032: highlights no tab on /palette and announces nothing on arrival', () => {
    navigationMocks.pathname = '/palette'
    render(<BottomNavHarness />)

    for (const id of ['home', 'wardrobe', 'community', 'settings']) {
      expect(screen.getByTestId(`bottom-nav-${id}`)).not.toHaveAttribute('aria-current')
    }
    expect(screen.getByTestId('bottom-nav-status')).toHaveTextContent('')
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

  /*
   * Production follow-up (2026-11-19): Jade looked for her profile and found a
   * tab called Settings. The tab reads Profile in the reader's language; its id,
   * test id and route stay `settings`, and analytics keeps one English name.
   */
  describe('the Profile tab', () => {
    afterEach(async () => {
      await act(async () => {
        await getI18n().changeLanguage('en-US')
      })
    })

    it('PROFILE-NAV-WEB-01 names the settings tab Profile and records it as Profile', () => {
      navigationMocks.pathname = '/settings'
      render(<BottomNavHarness />)

      const nav = screen.getByRole('navigation', { name: 'Bottom navigation' })
      const profile = within(nav).getByRole('link', { name: 'Profile' })
      expect(profile).toBe(screen.getByTestId('bottom-nav-settings'))
      expect(profile).toHaveAttribute('href', '/settings')
      expect(profile).toHaveAttribute('aria-current', 'page')
      expect(within(nav).queryByRole('link', { name: /settings/i })).toBeNull()
      expect(screen.getByTestId('bottom-nav-status')).toHaveTextContent(
        'Navigated to Profile tab'
      )

      fireEvent.click(profile)
      expect(posthogMocks.capture).toHaveBeenCalledWith('bottom_nav_clicked', {
        tabId: 'settings',
        label: 'Profile',
        targetPath: '/settings',
      })
    })

    it('PROFILE-NAV-WEB-02 shows every tab in the reader language, analytics stays English', async () => {
      await act(async () => {
        await getI18n().changeLanguage('de-DE')
      })
      render(<BottomNavHarness />)

      const names = Object.entries({
        home: 'Startseite',
        wardrobe: 'Garderobe',
        community: 'Community',
        settings: 'Profil',
      })
      for (const [id, name] of names) {
        expect(screen.getByTestId(`bottom-nav-${id}`)).toHaveAccessibleName(name)
      }
      expect(screen.getByRole('navigation')).toHaveAccessibleName('Untere Navigation')

      fireEvent.click(screen.getByTestId('bottom-nav-settings'))
      expect(screen.getByTestId('bottom-nav-status')).toHaveTextContent(
        'Zum Tab Profil gewechselt'
      )
      expect(posthogMocks.capture).toHaveBeenCalledWith('bottom_nav_clicked', {
        tabId: 'settings',
        label: 'Profile',
        targetPath: '/settings',
      })
    })

    it('PROFILE-NAV-WEB-03 the home header Profile link reads the reader language and records English', async () => {
      render(<ProfileNavLink />)
      const link = screen.getByTestId('nav-profile')
      expect(link).toHaveAccessibleName('Profile')
      expect(link).toHaveAttribute('href', '/settings')

      await act(async () => {
        await getI18n().changeLanguage('tr-TR')
      })

      expect(link).toHaveAccessibleName('Profil')
      expect(link).toHaveAttribute('data-ph-label', 'Profile')
    })
  })
})
