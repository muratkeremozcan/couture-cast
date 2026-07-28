// Story 3.5 Task 6 step 3 owner: integration-test Lookbook Prism responsive layout, comparison mode, and focus rings in apps/web/src/app/components/lookbook-prism-layout.test.tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { LookbookPrismLayout } from './lookbook-prism-layout'

// Mock posthog-js
vi.mock('posthog-js', () => ({
  default: {
    capture: vi.fn(),
  },
}))

describe('LookbookPrismLayout (Integration 3.5-INT-001 - 3.5-INT-005)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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

  it('3.5-INT-005: Keeps Hero, Chips, Garments, Community in DOM focus order', () => {
    render(<LookbookPrismLayout />)

    const hero = screen.getByRole('region', { name: /hero ritual canvas/i })
    const filter = screen.getByRole('button', { name: /^new$/i })
    const garment = screen.getByText(/double-breasted blazer/i).closest('[tabindex="0"]')
    const community = screen
      .getByText(/milan autumn wool trench/i)
      .closest('[tabindex="0"]')

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
})
