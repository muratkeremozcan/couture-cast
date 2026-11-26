// Learning path Step 66: One app shell and visual system.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-66-one-app-shell-and-visual-system
// Learning path Step 68: Five-tab navigation and back pattern.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-68-five-tab-navigation-and-back-pattern
// Story CC-7.9 test owner: 7.9-CMP-001, the web top bar (D6). The measured 56 px and one-row
// layout are 7.9-E2E-001; this pins the structure every screen relies on.
// Test design: _bmad-output/test-artifacts/test-design-7-9-one-app-shell-visual-system.md
// Story CC-7.11 test owner (TEA): 7.11-UNIT-020 (history-aware back, D11), five desktop tabs (D1).
// Test design: _bmad-output/test-artifacts/test-design-7-11-five-tab-navigation-back-pattern.md
import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearAppHistory } from '../../lib/app-history'
import { AppTopBar } from './app-top-bar'

const navigation = vi.hoisted(() => ({ pathname: '/wardrobe' }))
const router = vi.hoisted(() => ({
  back: vi.fn(),
  replace: vi.fn(),
  push: vi.fn(),
  forward: vi.fn(),
  refresh: vi.fn(),
  prefetch: vi.fn(),
}))
vi.mock('next/navigation', () => ({
  usePathname: () => navigation.pathname,
  useRouter: () => router,
}))

/**
 * Records whether the click reached the browser's default action: the window listener runs
 * after React's root listener, reads `defaultPrevented`, then stops jsdom's navigation stub.
 */
function clickReachesDefault(target: HTMLElement, init: MouseEventInit = {}) {
  let reached: boolean | null = null
  const listener = (event: Event) => {
    reached = !event.defaultPrevented
    event.preventDefault()
  }
  window.addEventListener('click', listener)
  try {
    fireEvent.click(target, init)
  } finally {
    window.removeEventListener('click', listener)
  }
  return reached
}

describe('7.9-CMP-001 AppTopBar', () => {
  it('renders one header row with the title as its only h1 and no back on a tab root', () => {
    render(<AppTopBar title="Closet" />)

    const header = screen.getByTestId('app-header')
    expect(header.tagName).toBe('HEADER')
    // h-top-bar is the tokens' 56 px shell height; the border sits inside it (border-box).
    expect(header).toHaveClass('h-top-bar')
    const headings = within(header).getAllByRole('heading', { level: 1 })
    expect(headings).toHaveLength(1)
    expect(headings[0]).toHaveTextContent('Closet')
    expect(headings[0]).toBe(screen.getByTestId('app-top-bar-title'))
    expect(within(header).getByTestId('app-top-bar')).toBeInTheDocument()
    expect(screen.queryByTestId('app-top-bar-back')).not.toBeInTheDocument()
  })

  it('translates a catalog title key', () => {
    render(<AppTopBar titleKey="nav.community" />)

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Community')
  })

  it('shows a back link to the parent route, labeled from the catalog', () => {
    render(<AppTopBar title="Outfit capsules" parentHref="/looks" />)

    const back = screen.getByTestId('app-top-bar-back')
    expect(back.tagName).toBe('A')
    expect(back).toHaveAttribute('href', '/looks')
    expect(back).toHaveTextContent('Back')
  })

  it('shows a back button that calls onBack for a sub-screen that is not a route', () => {
    const onBack = vi.fn()
    render(<AppTopBar title="Blue linen shirt" onBack={onBack} />)

    const back = screen.getByTestId('app-top-bar-back')
    expect(back.tagName).toBe('BUTTON')
    fireEvent.click(back)
    expect(onBack).toHaveBeenCalledTimes(1)
    expect(router.back).not.toHaveBeenCalled()
    expect(router.replace).not.toHaveBeenCalled()
  })

  it('keeps trailing actions and the desktop tab links in the same row', () => {
    render(
      <AppTopBar title="Closet" trailing={<button type="button">Add garment</button>} />
    )

    const header = screen.getByTestId('app-header')
    expect(
      within(header).getByRole('button', { name: 'Add garment' })
    ).toBeInTheDocument()
    const primary = within(header).getByRole('navigation', { name: 'Main navigation' })
    expect(within(primary).getByTestId('nav-wardrobe')).toHaveAttribute(
      'aria-current',
      'page'
    )
    expect(within(primary).getByTestId('nav-ritual')).not.toHaveAttribute('aria-current')
    expect(within(primary).getByTestId('nav-profile')).toHaveAttribute(
      'href',
      '/settings'
    )
  })

  // Story CC-7.11 D1: the desktop links read the same five-tab list as the bottom bar.
  it('7.11-CMP-TOPBAR-01 lists the five tabs in order with their catalog labels and routes', () => {
    render(<AppTopBar title="Closet" />)

    const primary = screen.getByRole('navigation', { name: 'Main navigation' })
    const links = within(primary).getAllByRole('link')
    expect(links.map((link) => link.getAttribute('data-testid'))).toEqual([
      'nav-ritual',
      'nav-wardrobe',
      'nav-looks',
      'nav-community',
      'nav-profile',
    ])
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
  })

  it('7.11-CMP-TOPBAR-02 marks Looks on a Looks sub-screen whose path sits under another tab', () => {
    navigation.pathname = '/wardrobe/capsules'
    try {
      render(<AppTopBar title="Outfit capsules" parentHref="/looks" />)
      const primary = screen.getByRole('navigation', { name: 'Main navigation' })
      expect(within(primary).getByTestId('nav-looks')).toHaveAttribute(
        'aria-current',
        'page'
      )
      expect(within(primary).getByTestId('nav-wardrobe')).not.toHaveAttribute(
        'aria-current'
      )
    } finally {
      navigation.pathname = '/wardrobe'
    }
  })
})

/** A router navigation: the app router writes its own state object; the history module stamps it. */
const push = (url: string) => window.history.pushState({ __NA: true }, '', url)
const replace = (url: string) => window.history.replaceState({ __NA: true }, '', url)

/** Waits until jsdom has delivered the popstate of a queued traversal. */
async function settle() {
  for (let round = 0; round < 10; round++)
    await new Promise((resolve) => setTimeout(resolve, 0))
}

/**
 * Story CC-7.11 D11 and TEA P1: back steps through in-app history when the member arrived from
 * inside the app, and replaces to the parent tab on a direct entry (cold load, reload, typed
 * URL), so it never leaves the app. The real history module drives both states: navigations go
 * through the wrapped `pushState` / `replaceState` and traversals through jsdom's real history.
 */
describe('7.11-UNIT-020 AppTopBar history-aware back', () => {
  beforeEach(() => {
    // The entry on show becomes this test's direct entry.
    clearAppHistory()
  })

  afterEach(() => {
    clearAppHistory()
  })

  it('with in-app history below, back calls router.back() and not replace', () => {
    push('/looks/plan')
    render(<AppTopBar title="Plan" parentHref="/looks" />)

    const reachedDefault = clickReachesDefault(screen.getByTestId('app-top-bar-back'))

    expect(router.back).toHaveBeenCalledTimes(1)
    expect(router.replace).not.toHaveBeenCalled()
    expect(router.push).not.toHaveBeenCalled()
    // The link's own navigation is cancelled, so the browser does not also push the parent.
    expect(reachedDefault).toBe(false)
  })

  it('on a direct entry, back replaces to parentHref and does not call back', () => {
    // A cold load: the screen on show is the first entry, nothing in the app sits below it.
    replace('/wardrobe/silhouette')
    render(<AppTopBar title="Silhouette" parentHref="/wardrobe" />)

    const reachedDefault = clickReachesDefault(screen.getByTestId('app-top-bar-back'))

    expect(router.replace).toHaveBeenCalledTimes(1)
    expect(router.replace).toHaveBeenCalledWith('/wardrobe')
    expect(router.back).not.toHaveBeenCalled()
    expect(router.push).not.toHaveBeenCalled()
    expect(reachedDefault).toBe(false)
  })

  it('with nothing navigated (a fresh document), back replaces to parentHref', () => {
    render(<AppTopBar title="Style" parentHref="/settings" />)

    fireEvent.click(screen.getByTestId('app-top-bar-back'))

    expect(router.replace).toHaveBeenCalledTimes(1)
    expect(router.replace).toHaveBeenCalledWith('/settings')
    expect(router.back).not.toHaveBeenCalled()
  })

  it('[Codex 7.11 #1] Plan opened directly, then Today, then Plan: back steps back to Today, never replaces to Looks', async () => {
    replace('/looks/plan')
    push('/')
    push('/looks/plan')
    render(<AppTopBar title="Plan" parentHref="/looks" />)

    fireEvent.click(screen.getByTestId('app-top-bar-back'))
    expect(router.back).toHaveBeenCalledTimes(1)
    expect(router.replace).not.toHaveBeenCalled()

    // The browser lands back on Today; from the first Plan (the direct entry) back replaces.
    window.history.back()
    await settle()
    window.history.back()
    await settle()
    expect(window.location.pathname).toBe('/looks/plan')
    fireEvent.click(screen.getByTestId('app-top-bar-back'))
    expect(router.back).toHaveBeenCalledTimes(1)
    expect(router.replace).toHaveBeenCalledTimes(1)
    expect(router.replace).toHaveBeenCalledWith('/looks')
  })

  it('never calls both back and replace across repeated presses', () => {
    push('/settings/style')
    render(<AppTopBar title="Style" parentHref="/settings" />)

    const back = screen.getByTestId('app-top-bar-back')
    fireEvent.click(back)
    fireEvent.click(back)

    // The mocked router.back() does not traverse, so the entry on show is unchanged and both
    // presses step back.
    expect(router.back).toHaveBeenCalledTimes(2)
    expect(router.replace).not.toHaveBeenCalled()
  })

  it.each([
    ['metaKey', { metaKey: true }],
    ['ctrlKey', { ctrlKey: true }],
    ['shiftKey', { shiftKey: true }],
    ['altKey', { altKey: true }],
  ] as const)(
    'a %s click keeps the link default and neither steps back nor replaces',
    (_name, init) => {
      push('/looks/plan')
      render(<AppTopBar title="Plan" parentHref="/looks" />)

      const reachedDefault = clickReachesDefault(
        screen.getByTestId('app-top-bar-back'),
        init
      )

      expect(router.back).not.toHaveBeenCalled()
      expect(router.replace).not.toHaveBeenCalled()
      expect(router.push).not.toHaveBeenCalled()
      // A new tab or window opens on the parent's href, as a link does.
      expect(reachedDefault).toBe(true)
    }
  )
})
