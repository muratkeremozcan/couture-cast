// Learning path Step 66: One app shell and visual system.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-66-one-app-shell-and-visual-system
// Story CC-7.9 test owner: 7.9-CMP-002, the CC-7.7 session placeholder renders inside the final
// shell (D8): on every tab the top bar comes before the gate's placeholder and the bottom tab bar
// after it, all on the one page surface, and the placeholder paints `card-muted`. The tab bodies
// are stubbed: this pins the shell composition, and 7.9-E2E-011 measures the boxes.
// Test design: _bmad-output/test-artifacts/test-design-7-9-one-app-shell-visual-system.md
// Learning path Step 68: Five-tab navigation and back pattern.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-68-five-tab-navigation-and-back-pattern
// Story CC-7.11 test owner (TEA): Today tab rename (D1); the top bar reads the router (D11).
// Test design: _bmad-output/test-artifacts/test-design-7-11-five-tab-navigation-back-pattern.md
import { render, screen } from '@testing-library/react'
import type { ComponentType } from 'react'
import { describe, expect, it, vi } from 'vitest'
import Home from '../page'
import CommunityPage from '../community/page'
import SettingsPage from '../settings/page'

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/',
  useRouter: () => ({ back: vi.fn(), replace: vi.fn(), push: vi.fn() }),
}))
vi.mock('./lookbook-prism-layout', () => ({ LookbookPrismLayout: () => <section /> }))
vi.mock('./guest-preview/guest-preview-entry', () => ({
  GuestPreviewEntry: () => <section />,
  ProfileSignOut: () => null,
}))
vi.mock('./analytics-event-actions', () => ({ AnalyticsEventActions: () => null }))
vi.mock('./posthog-click-tracker', () => ({ PostHogClickTracker: () => null }))
vi.mock('./community-lookbook-grid', () => ({ CommunityLookbookGrid: () => <section /> }))

const TABS: readonly { name: string; Page: ComponentType }[] = [
  { name: 'Today', Page: Home },
  { name: 'Community', Page: CommunityPage },
  { name: 'Profile', Page: SettingsPage },
]

const follows = (later: Element, earlier: Element) =>
  Boolean(earlier.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING)

describe('7.9-CMP-002 the session placeholder sits inside the shell', () => {
  it.each(TABS)('$name: top bar, placeholder, tab bar, one page surface', ({ Page }) => {
    const { container } = render(<Page />)

    const header = screen.getByTestId('app-header')
    const placeholder = screen.getByTestId('screen-placeholder')
    const nav = screen.getByTestId('sticky-bottom-nav')
    expect(follows(placeholder, header)).toBe(true)
    expect(follows(nav, placeholder)).toBe(true)
    expect(placeholder).toHaveClass('bg-card-muted')

    const pages = container.querySelectorAll('[data-surface="page"]')
    expect(pages).toHaveLength(1)
    for (const part of [header, placeholder, nav]) expect(pages[0]).toContainElement(part)
  })
})
