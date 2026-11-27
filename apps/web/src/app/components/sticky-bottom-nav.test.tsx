// Learning path Step 65: Signed-in shell without flashes.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-65-signed-in-shell-without-flashes
// Learning path Step 36: Colour palette, beauty and accessory advisor.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-36-colour-palette-beauty-and-accessory-advisor
// Learning path Step 26: Chip navigation and sticky bottom nav.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-26-chip-navigation-and-sticky-bottom-nav
// Learning path Step 58: Production follow-ups after the project close.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#production-follow-ups-after-the-project-close
// Learning path Step 68: Five-tab navigation and back pattern.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-68-five-tab-navigation-and-back-pattern
// Learning path Step 69: Looks tab for saved looks, ideas and plans.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-69-looks-tab-for-saved-looks-ideas-and-plans
// CC-7.17 wrapped-tab clearance: _bmad-output/project-knowledge/learning-path-step-by-step.md#step-74-teen-voice-and-copy
// Story CC-7.12 test owner (TEA): 7.12-UNIT-061 (the saved look detail and the capsules manager
// highlight Looks).
// Test design: _bmad-output/test-artifacts/test-design-7-12-looks-tab-saved-looks-ideas-plans.md
// Story 3.6 Task 5 step 2 owner: sticky bottom navigation mobile visibility and telemetry.
// Story CC-7.11 test owner (TEA): 7.11-UNIT-013 (resolveActiveNavTab), 7.11-UNIT-021 (five tabs,
// catalog labels, shared svg icons, no emoji); five-tab updates to 3.6, 5.4, 7.7 and 7.9 cases.
// Test design: _bmad-output/test-artifacts/test-design-7-11-five-tab-navigation-back-pattern.md
import { createElement, type ComponentProps } from 'react'
import type * as NextLinkModule from 'next/link'
import { act, render, screen, fireEvent, within } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { APP_TABS, TAB_ICON_PATHS, TAB_ICON_VIEWBOX } from '@couture/utils'
import { getI18n } from '../../i18n'
import { AppTopBar } from './app-top-bar'
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

// Story CC-7.11 D11: the top bar's back reads the router, so the mock names it too.
const router = vi.hoisted(() => ({ back: vi.fn(), replace: vi.fn(), push: vi.fn() }))

vi.mock('next/navigation', () => ({
  usePathname: () => navigationMocks.pathname,
  useRouter: () => router,
}))

/** The five tab ids in D1 order: Today, Closet, Looks, Community, Profile. */
const TAB_IDS = ['home', 'wardrobe', 'looks', 'community', 'settings'] as const

// Story CC-7.7 D5 (7.7-CMP-009): Next renders `scroll` into no attribute, so the props each tab
// link is built with are recorded here; the real Link still renders, so the other cases see the
// same anchors as before.
const linkProps = vi.hoisted(() => new Map<string, Record<string, unknown>>())

vi.mock('next/link', async (importOriginal) => {
  const actual = await importOriginal<typeof NextLinkModule>()
  const Link = actual.default
  return {
    ...actual,
    default: (props: ComponentProps<typeof Link>) => {
      const testId = (props as unknown as Record<string, unknown>)['data-testid']
      linkProps.set(String(testId), { href: props.href, scroll: props.scroll })
      return createElement(Link, props)
    },
  }
})

function BottomNavHarness({ isMobilePreview = false }: { isMobilePreview?: boolean }) {
  return <StickyBottomNav isMobilePreview={isMobilePreview} />
}

describe('StickyBottomNav Component (Story 3.6)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    navigationMocks.pathname = '/'
  })

  it('3.6-UNIT-006: renders 5 destination tabs with gold active indicator line on active route', () => {
    render(<BottomNavHarness />)

    const homeTab = screen.getByTestId('bottom-nav-home')
    const wardrobeTab = screen.getByTestId('bottom-nav-wardrobe')
    const looksTab = screen.getByTestId('bottom-nav-looks')
    const communityTab = screen.getByTestId('bottom-nav-community')
    const settingsTab = screen.getByTestId('bottom-nav-settings')

    expect(homeTab).toHaveAttribute('aria-current', 'page')
    expect(wardrobeTab).not.toHaveAttribute('aria-current')
    expect(looksTab).not.toHaveAttribute('aria-current')
    expect(communityTab).not.toHaveAttribute('aria-current')
    expect(settingsTab).not.toHaveAttribute('aria-current')
    // P6: the indicator renders on the active tab only.
    expect(screen.getAllByTestId('gold-active-indicator')).toHaveLength(1)

    expect(
      homeTab.querySelector('[data-testid="gold-active-indicator"]')
    ).toBeInTheDocument()
    expect(
      wardrobeTab.querySelector('[data-testid="gold-active-indicator"]')
    ).not.toBeInTheDocument()
    expect(homeTab).toHaveAttribute('href', '/')
    expect(wardrobeTab).toHaveAttribute('href', '/wardrobe')
    expect(looksTab).toHaveAttribute('href', '/looks')
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
   * every nested route, so `/wardrobe/onboarding` told the reader they were on the home
   * tab. A route under no tab at all is what made the second half of the rule
   * necessary: no tab is a real answer, and defaulting to Home is the same lie in a
   * different place. Story CC-7.11 D10 moved capsules to Looks and made `/palette` a
   * Profile row, so those two now name their parent tab (7.11-UNIT-013 below).
   */
  it('5.4-WEB-030: resolves the active tab by longest prefix, with no tab for a route under none', () => {
    expect(resolveActiveNavTab('/')).toBe('home')
    expect(resolveActiveNavTab('/wardrobe')).toBe('wardrobe')
    // CC-7.12 D6: the capsules manager moved to /looks/capsules; the old address is a server
    // redirect, so it no longer names Looks here.
    expect(resolveActiveNavTab('/looks/capsules')).toBe('looks')
    expect(resolveActiveNavTab('/wardrobe/onboarding')).toBe('wardrobe')
    expect(resolveActiveNavTab('/settings')).toBe('settings')
    expect(resolveActiveNavTab('/community')).toBe('community')
    // A sibling route that merely starts with the same characters is not nested
    // under the tab, so the boundary check has to reject it.
    expect(resolveActiveNavTab('/wardrobe-silhouette')).toBeNull()
    expect(resolveActiveNavTab('/palette')).toBe('settings')
    expect(resolveActiveNavTab('/signup')).toBeNull()
    expect(resolveActiveNavTab(null)).toBeNull()
  })

  it('5.4-WEB-031: highlights Closet on a nested wardrobe route', () => {
    navigationMocks.pathname = '/wardrobe/onboarding'
    render(<BottomNavHarness />)

    expect(screen.getByTestId('bottom-nav-wardrobe')).toHaveAttribute(
      'aria-current',
      'page'
    )
    expect(screen.getByTestId('bottom-nav-home')).not.toHaveAttribute('aria-current')
  })

  // Story CC-7.11 D10: `/palette` is a Profile > Style row now, so Profile marks it; a route
  // under no tab (sign-up) still highlights nothing and announces nothing on arrival.
  it('5.4-WEB-032: highlights Profile on /palette and no tab, with no announcement, under none', () => {
    navigationMocks.pathname = '/palette'
    const { unmount } = render(<BottomNavHarness />)

    expect(screen.getByTestId('bottom-nav-settings')).toHaveAttribute(
      'aria-current',
      'page'
    )
    for (const id of ['home', 'wardrobe', 'looks', 'community']) {
      expect(screen.getByTestId(`bottom-nav-${id}`)).not.toHaveAttribute('aria-current')
    }
    expect(screen.getByTestId('bottom-nav-status')).toHaveTextContent(
      'Navigated to Profile tab'
    )
    unmount()

    navigationMocks.pathname = '/signup'
    render(<BottomNavHarness />)
    for (const id of TAB_IDS) {
      expect(screen.getByTestId(`bottom-nav-${id}`)).not.toHaveAttribute('aria-current')
    }
    expect(screen.queryByTestId('gold-active-indicator')).not.toBeInTheDocument()
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

  it('keeps page clearance in sync with wrapped bottom tab labels', () => {
    const observe = vi.fn()
    const disconnect = vi.fn()
    let notifyResize: (() => void) | undefined
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe = observe
        disconnect = disconnect

        constructor(onResize: () => void) {
          notifyResize = onResize
        }
      }
    )
    const height = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get')
    const rootStyle = document.documentElement.style
    const clearance = '--cc-web-tab-bar-height'
    try {
      height.mockReturnValue(56)
      const { unmount } = render(<BottomNavHarness />)
      const nav = screen.getByTestId('sticky-bottom-nav')
      expect(observe).toHaveBeenCalledExactlyOnceWith(nav.firstElementChild)
      expect(rootStyle.getPropertyValue(clearance)).toBe('56px')

      height.mockReturnValue(84)
      notifyResize!()
      expect(rootStyle.getPropertyValue(clearance)).toBe('84px')

      height.mockReturnValue(0)
      notifyResize!()
      expect(rootStyle.getPropertyValue(clearance)).toBe('84px')

      unmount()
      expect(disconnect).toHaveBeenCalledOnce()
      expect(rootStyle.getPropertyValue(clearance)).toBe('')
    } finally {
      height.mockRestore()
      vi.unstubAllGlobals()
    }
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
        home: 'Heute',
        wardrobe: 'Schrank',
        looks: 'Looks',
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

    // Story CC-7.11 D3 replaced the one-line rule: five tabs share 320 px, so a label too wide
    // for its tab wraps to a second line at 12 px; it is never cut, shrunk or uppercased.
    it('7.9-CMP-NAV-001 keeps each German label at the 12 px caption size, wrapping and never cut, without the wide uppercase that cut it at 320 px', async () => {
      await act(async () => {
        await getI18n().changeLanguage('de-DE')
      })
      render(<StickyBottomNav />)

      for (const [id, name] of Object.entries({
        home: 'Heute',
        wardrobe: 'Schrank',
        looks: 'Looks',
        community: 'Community',
        settings: 'Profil',
      })) {
        const label = within(screen.getByTestId(`bottom-nav-${id}`)).getByText(name)
        // Vercel Preview O-1 on 3d7af2a2: uppercase and tracking-wider at text-xs left
        // STARTSEITE, GARDEROBE and COMMUNITY wider than their tabs at 320 px.
        expect(label).toHaveClass('text-xs', 'max-w-full', 'text-center')
        expect(label.className).not.toMatch(
          /\bwhitespace-nowrap\b|\btruncate\b|\btext-ellipsis\b|\bline-clamp-/
        )
        expect(label.className).not.toMatch(/\buppercase\b|\btracking-/)
      }
    })

    // Story CC-7.9 D6: the top bar's desktop tab links replaced the home header ProfileNavLink.
    it('PROFILE-NAV-WEB-03 the top bar Profile link reads the reader language and records English', async () => {
      render(<AppTopBar titleKey="nav.today" />)
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

// Story CC-7.7 D5 test owner: a bottom-nav tab switch keeps the window where it is, so the screen
// gate of the tab it opens restores that tab's own scroll (or starts a first visit at the top).
// Test design: _bmad-output/test-artifacts/test-design-7-7-signed-in-shell-without-flashes.md
// (7.7-CMP-009). The return itself is 7.7-CMP-001 and 7.7-E2E-008.
describe('StickyBottomNav scroll (Story CC-7.7)', () => {
  beforeEach(() => {
    linkProps.clear()
    navigationMocks.pathname = '/'
  })

  it('7.7-CMP-009 every tab link renders with scroll={false}', () => {
    render(<StickyBottomNav />)

    const tabs = [...TAB_IDS]
    for (const tab of tabs) expect(screen.getByTestId(`bottom-nav-${tab}`)).toBeVisible()
    const tabLinks = [...linkProps.keys()].filter((key) => key.startsWith('bottom-nav-'))
    expect(tabLinks.sort()).toEqual(tabs.map((tab) => `bottom-nav-${tab}`).sort())
    for (const key of tabLinks) expect(linkProps.get(key)?.scroll).toBe(false)
  })
})

// Story CC-7.11 D1, D2 (7.11-UNIT-021): the bar reads the one shared tab list and draws the one
// shared icon set; emoji left the bar.
describe('7.11-UNIT-021 StickyBottomNav five tabs and shared icons', () => {
  beforeEach(() => {
    navigationMocks.pathname = '/wardrobe'
  })

  it('renders five links in D1 order with the catalog labels and routes', () => {
    render(<StickyBottomNav />)

    const nav = screen.getByRole('navigation', { name: 'Bottom navigation' })
    const links = within(nav).getAllByRole('link')
    expect(links.map((link) => link.getAttribute('data-testid'))).toEqual(
      TAB_IDS.map((id) => `bottom-nav-${id}`)
    )
    expect(links.map((link) => link.textContent)).toEqual([
      'Today',
      'Closet',
      'Looks',
      'Community',
      'Profile',
    ])
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/',
      '/wardrobe',
      '/looks',
      '/community',
      '/settings',
    ])
    // The bar is built from the shared list, so the two never drift.
    expect(APP_TABS.map((tab) => tab.id)).toEqual([...TAB_IDS])
    // Each link's accessible name is its label alone: the icon adds nothing to it.
    expect(links.map((link) => link.getAttribute('aria-label'))).toEqual(
      TAB_IDS.map(() => null)
    )
    expect(within(nav).getByRole('link', { name: 'Closet' })).toHaveAttribute(
      'aria-current',
      'page'
    )
  })

  it('draws each icon as an aria-hidden inline svg with the shared path set', () => {
    render(<StickyBottomNav />)

    for (const id of TAB_IDS) {
      const link = screen.getByTestId(`bottom-nav-${id}`)
      const svgs = link.querySelectorAll('svg')
      expect(svgs).toHaveLength(1)
      const svg = svgs[0]!
      expect(svg).toBe(within(link).getByTestId(`tab-icon-${id}`))
      expect(svg).toHaveAttribute('aria-hidden', 'true')
      expect(svg).toHaveAttribute('focusable', 'false')
      expect(svg).toHaveAttribute('viewBox', TAB_ICON_VIEWBOX)
      // D2: the icon strokes in the label color, so active and inactive follow the text.
      expect(svg).toHaveAttribute('stroke', 'currentColor')
      expect(svg).toHaveAttribute('fill', 'none')
      expect(
        [...svg.querySelectorAll('path')].map((path) => path.getAttribute('d'))
      ).toEqual([...TAB_ICON_PATHS[id]])
    }
  })

  it('carries no emoji anywhere in the bar', () => {
    render(<StickyBottomNav />)

    const nav = screen.getByTestId('sticky-bottom-nav')
    expect(nav.textContent).not.toMatch(/\p{Extended_Pictographic}/u)
    expect(nav.textContent).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u)
  })
})

// Story CC-7.11 D10 (7.11-UNIT-013): a sub-screen highlights its parent tab, including the ones
// whose path sits under another tab's prefix or under none.
describe('7.11-UNIT-013 resolveActiveNavTab for the five tabs and their sub-screens', () => {
  it.each([
    ['/looks', 'looks'],
    // CC-7.12 D5, D6: the saved look detail and the capsules manager sit under Looks.
    ['/looks/saved/sl-1', 'looks'],
    ['/looks/capsules', 'looks'],
    ['/wardrobe/silhouette', 'wardrobe'],
    ['/wardrobe/onboarding', 'wardrobe'],
    ['/settings/style', 'settings'],
    ['/palette', 'settings'],
    ['/notification-settings', 'settings'],
    ['/guardian/dashboard', 'settings'],
    ['/teen/dashboard', 'settings'],
  ] as const)('%s resolves to %s', (pathname, tab) => {
    expect(resolveActiveNavTab(pathname)).toBe(tab)
  })

  it('matches Today on / exactly and never as a prefix', () => {
    expect(resolveActiveNavTab('/')).toBe('home')
    expect(resolveActiveNavTab('/signup')).toBeNull()
    expect(resolveActiveNavTab('/looksbook')).toBeNull()
    expect(resolveActiveNavTab('/settings-style')).toBeNull()
  })

  it.each(['/looks/saved/sl-1', '/looks/capsules'])(
    '7.12-UNIT-061 highlights Looks in the bar on %s',
    (pathname) => {
      navigationMocks.pathname = pathname
      render(<StickyBottomNav />)

      expect(screen.getByTestId('bottom-nav-looks')).toHaveAttribute(
        'aria-current',
        'page'
      )
      expect(screen.getByTestId('bottom-nav-wardrobe')).not.toHaveAttribute(
        'aria-current'
      )
    }
  )

  it('highlights Looks in the bar on the Looks Plan segment', () => {
    navigationMocks.pathname = '/looks'
    render(<StickyBottomNav />)

    expect(screen.getByTestId('bottom-nav-looks')).toHaveAttribute('aria-current', 'page')
    expect(
      within(screen.getByTestId('bottom-nav-looks')).getByTestId('gold-active-indicator')
    ).toBeInTheDocument()
    expect(screen.getByTestId('bottom-nav-home')).not.toHaveAttribute('aria-current')
  })
})
