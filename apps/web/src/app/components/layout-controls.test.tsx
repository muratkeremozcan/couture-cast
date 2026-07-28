// Story 3.5 Task 6 step 1 owner: unit-test layout controls and PostHog event triggers in apps/web/src/app/components/layout-controls.test.tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { LayoutControls } from './layout-controls'

const posthogMocks = vi.hoisted(() => ({
  capture: vi.fn(),
}))

vi.mock('posthog-js', () => ({
  default: {
    capture: posthogMocks.capture,
  },
}))

describe('LayoutControls (3.5-UNIT-001)', () => {
  const defaultProps = {
    isComparisonMode: false,
    onToggleComparison: vi.fn(),
    isMobilePreview: false,
    onToggleMobilePreview: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders Comparison Mode and Mobile Preview toggle buttons with aria attributes', () => {
    render(<LayoutControls {...defaultProps} />)

    const comparisonBtn = screen.getByRole('button', { name: /comparison mode/i })
    const mobilePreviewBtn = screen.getByRole('button', { name: /mobile preview/i })

    expect(comparisonBtn).toBeInTheDocument()
    expect(comparisonBtn).toHaveAttribute('aria-pressed', 'false')

    expect(mobilePreviewBtn).toBeInTheDocument()
    expect(mobilePreviewBtn).toHaveAttribute('aria-pressed', 'false')
  })

  it('triggers onToggleComparison and fires PostHog layout_interaction event on comparison mode click', () => {
    render(<LayoutControls {...defaultProps} />)

    const comparisonBtn = screen.getByRole('button', { name: /comparison mode/i })
    fireEvent.click(comparisonBtn)

    expect(defaultProps.onToggleComparison).toHaveBeenCalledTimes(1)
    expect(posthogMocks.capture).toHaveBeenCalledWith('layout_interaction', {
      action: 'toggle_comparison',
      target: 'comparison_mode_button',
    })
  })

  it('triggers onToggleMobilePreview and fires PostHog layout_interaction event on mobile preview click', () => {
    render(<LayoutControls {...defaultProps} />)

    const mobilePreviewBtn = screen.getByRole('button', { name: /mobile preview/i })
    fireEvent.click(mobilePreviewBtn)

    expect(defaultProps.onToggleMobilePreview).toHaveBeenCalledTimes(1)
    expect(posthogMocks.capture).toHaveBeenCalledWith('layout_interaction', {
      action: 'toggle_mobile_preview',
      target: 'mobile_preview_button',
    })
  })
})
