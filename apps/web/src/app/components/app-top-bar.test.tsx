// Learning path Step 66: One app shell and visual system.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-66-one-app-shell-and-visual-system
// Story CC-7.9 test owner: 7.9-CMP-001, the web top bar (D6). The measured 56 px and one-row
// layout are 7.9-E2E-001; this pins the structure every screen relies on.
// Test design: _bmad-output/test-artifacts/test-design-7-9-one-app-shell-visual-system.md
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AppTopBar } from './app-top-bar'

const navigation = vi.hoisted(() => ({ pathname: '/wardrobe' }))
vi.mock('next/navigation', () => ({ usePathname: () => navigation.pathname }))

describe('7.9-CMP-001 AppTopBar', () => {
  it('renders one header row with the title as its only h1 and no back on a tab root', () => {
    render(<AppTopBar title="Wardrobe" />)

    const header = screen.getByTestId('app-header')
    expect(header.tagName).toBe('HEADER')
    // h-top-bar is the tokens' 56 px shell height; the border sits inside it (border-box).
    expect(header).toHaveClass('h-top-bar')
    const headings = within(header).getAllByRole('heading', { level: 1 })
    expect(headings).toHaveLength(1)
    expect(headings[0]).toHaveTextContent('Wardrobe')
    expect(screen.queryByTestId('app-top-bar-back')).not.toBeInTheDocument()
  })

  it('translates a catalog title key', () => {
    render(<AppTopBar titleKey="nav.community" />)

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Community')
  })

  it('shows a back link to the parent route, labeled from the catalog', () => {
    render(<AppTopBar title="Outfit capsules" backHref="/wardrobe" />)

    const back = screen.getByTestId('app-top-bar-back')
    expect(back.tagName).toBe('A')
    expect(back).toHaveAttribute('href', '/wardrobe')
    expect(back).toHaveTextContent('Back')
  })

  it('shows a back button that calls onBack for a sub-screen that is not a route', () => {
    const onBack = vi.fn()
    render(<AppTopBar title="Blue linen shirt" onBack={onBack} />)

    const back = screen.getByTestId('app-top-bar-back')
    expect(back.tagName).toBe('BUTTON')
    fireEvent.click(back)
    expect(onBack).toHaveBeenCalledTimes(1)
  })

  it('keeps trailing actions and the desktop tab links in the same row', () => {
    render(
      <AppTopBar title="Wardrobe" trailing={<button type="button">Add garment</button>} />
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
})
