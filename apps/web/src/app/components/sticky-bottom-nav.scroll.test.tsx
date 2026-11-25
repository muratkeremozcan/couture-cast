// Learning path Step 65: Signed-in shell without flashes.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-65-signed-in-shell-without-flashes
// Story CC-7.7 D5 test owner: a bottom-nav tab switch keeps the window where it is, so the screen
// gate of the tab it opens restores that tab's own scroll (or starts a first visit at the top).
// Test design: _bmad-output/test-artifacts/test-design-7-7-signed-in-shell-without-flashes.md
// (7.7-CMP-009). The return itself is 7.7-CMP-001 and 7.7-E2E-008.
import type { ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { StickyBottomNav } from './sticky-bottom-nav'

// Next renders `scroll` into no attribute, so the link's props are recorded where it is built.
const linkProps = vi.hoisted(() => new Map<string, Record<string, unknown>>())

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    scroll,
    ...rest
  }: {
    href: unknown
    children?: ReactNode
    scroll?: boolean
    [prop: string]: unknown
  }) => {
    linkProps.set(String(rest['data-testid']), { href, scroll })
    return (
      <a href={String(href)} {...rest}>
        {children}
      </a>
    )
  },
}))
vi.mock('next/navigation', () => ({ usePathname: () => '/' }))
vi.mock('posthog-js', () => ({ default: { capture: vi.fn() } }))

describe('StickyBottomNav scroll', () => {
  it('7.7-CMP-009 every tab link renders with scroll={false}', () => {
    render(<StickyBottomNav />)

    const tabs = ['home', 'wardrobe', 'community', 'settings']
    for (const tab of tabs) expect(screen.getByTestId(`bottom-nav-${tab}`)).toBeVisible()
    expect([...linkProps.keys()].sort()).toEqual(
      tabs.map((tab) => `bottom-nav-${tab}`).sort()
    )
    for (const props of linkProps.values()) expect(props.scroll).toBe(false)
  })
})
