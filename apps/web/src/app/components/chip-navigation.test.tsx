// Learning path Step 26: Chip navigation and sticky bottom nav.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-26-chip-navigation-and-sticky-bottom-nav
// Learning path Step 28: Accessibility hardening.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-28-accessibility-hardening
// Story 3.6 Task 5 step 1 owner: unit-test web chip navigation keyboard traversal, ARIA live updates, and telemetry error isolation in apps/web/src/app/components/chip-navigation.test.tsx
import { useState } from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CHIP_NAVIGATION_HEIGHT_PX, ChipNavigation } from './chip-navigation'
import type { ChipCategory } from './chip-navigation'

const posthogMocks = vi.hoisted(() => ({
  capture: vi.fn(),
}))

vi.mock('posthog-js', () => ({
  default: {
    capture: posthogMocks.capture,
  },
}))

function ChipNavigationHarness({
  initialCategory = 'Personal',
  onCaptureError = false,
}: {
  initialCategory?: ChipCategory
  onCaptureError?: boolean
}) {
  const [activeCategory, setActiveCategory] = useState<ChipCategory>(initialCategory)

  if (onCaptureError) {
    posthogMocks.capture.mockImplementationOnce(() => {
      throw new Error('Telemetry network failure')
    })
  }

  return (
    <>
      <ChipNavigation
        activeCategory={activeCategory}
        onCategoryChange={setActiveCategory}
        surface="web"
      />
      <button type="button" data-testid="outside-button">
        Outside Element
      </button>
    </>
  )
}

describe('ChipNavigation Component (Story 3.6)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('3.6-UNIT-001: renders Personal, Community, and Sponsored chips with correct aria-pressed states', () => {
    render(<ChipNavigationHarness initialCategory="Personal" />)

    const personalChip = screen.getByTestId('chip-personal')
    const communityChip = screen.getByTestId('chip-community')
    const sponsoredChip = screen.getByTestId('chip-sponsored')

    expect(screen.getByTestId('chip-navigation-bar')).toHaveStyle({
      height: `${CHIP_NAVIGATION_HEIGHT_PX}px`,
    })
    expect(personalChip).toHaveAttribute('aria-pressed', 'true')
    expect(communityChip).toHaveAttribute('aria-pressed', 'false')
    expect(sponsoredChip).toHaveAttribute('aria-pressed', 'false')
  })

  it('3.6-UNIT-002: navigates focus between chips via arrow keys and permits clean Tab exit', () => {
    render(<ChipNavigationHarness initialCategory="Personal" />)

    const personalChip = screen.getByTestId('chip-personal')
    const communityChip = screen.getByTestId('chip-community')
    const sponsoredChip = screen.getByTestId('chip-sponsored')
    const outsideButton = screen.getByTestId('outside-button')

    expect(personalChip).toHaveAttribute('tabindex', '0')
    expect(communityChip).toHaveAttribute('tabindex', '-1')
    expect(sponsoredChip).toHaveAttribute('tabindex', '-1')

    personalChip.focus()
    expect(document.activeElement).toBe(personalChip)

    // ArrowRight -> Community
    fireEvent.keyDown(personalChip, { key: 'ArrowRight' })
    expect(document.activeElement).toBe(communityChip)
    expect(communityChip).toHaveAttribute('aria-pressed', 'true')

    // ArrowRight -> Sponsored
    fireEvent.keyDown(communityChip, { key: 'ArrowRight' })
    expect(document.activeElement).toBe(sponsoredChip)
    expect(sponsoredChip).toHaveAttribute('aria-pressed', 'true')

    // Home -> Personal
    fireEvent.keyDown(sponsoredChip, { key: 'Home' })
    expect(document.activeElement).toBe(personalChip)

    // End -> Sponsored
    fireEvent.keyDown(personalChip, { key: 'End' })
    expect(document.activeElement).toBe(sponsoredChip)

    expect(personalChip).toHaveAttribute('tabindex', '-1')
    expect(communityChip).toHaveAttribute('tabindex', '-1')
    expect(sponsoredChip).toHaveAttribute('tabindex', '0')
    expect(outsideButton).toBeEnabled()
  })

  it('3.6-UNIT-003: emits PostHog chip_changed event on chip selection', () => {
    render(<ChipNavigationHarness initialCategory="Personal" />)

    const communityChip = screen.getByTestId('chip-community')
    fireEvent.click(communityChip)

    expect(posthogMocks.capture).toHaveBeenCalledWith('chip_changed', {
      chipCategory: 'Community',
      previousCategory: 'Personal',
      surface: 'web',
    })
  })

  it('3.6-UNIT-004: updates aria-live status region text dynamically upon chip selection', () => {
    render(<ChipNavigationHarness initialCategory="Personal" />)

    const liveRegion = screen.getByRole('status')
    expect(liveRegion).toHaveTextContent(/showing personal recommendations/i)

    const sponsoredChip = screen.getByTestId('chip-sponsored')
    fireEvent.click(sponsoredChip)

    expect(liveRegion).toHaveTextContent(/showing sponsored recommendations/i)
  })

  it('3.6-UNIT-005: insulates state updates and callbacks if posthog.capture throws an exception', () => {
    render(<ChipNavigationHarness initialCategory="Personal" onCaptureError={true} />)

    const communityChip = screen.getByTestId('chip-community')
    expect(() => fireEvent.click(communityChip)).not.toThrow()

    expect(communityChip).toHaveAttribute('aria-pressed', 'true')
    const liveRegion = screen.getByRole('status')
    expect(liveRegion).toHaveTextContent(/showing community recommendations/i)
  })
})
