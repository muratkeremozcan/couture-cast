// Learning path Step 26: Chip navigation and sticky bottom nav.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-26-chip-navigation-and-sticky-bottom-nav
// Learning path Step 28: Accessibility hardening.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-28-accessibility-hardening
// Story 3.6 Task 5 step 3 owner: unit-test mobile React Native chip navigation pressables and selection state in apps/mobile/components/chip-navigation.test.tsx
import React, { useState } from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { MobileChipNavigation } from './chip-navigation'
import type { ChipCategory } from './chip-navigation'

const analyticsMocks = vi.hoisted(() => ({
  capture: vi.fn(),
  announce: vi.fn(),
}))

vi.mock('@/src/analytics/mobile-analytics', () => ({
  useMobileAnalytics: () => ({
    capture: analyticsMocks.capture,
    getDistinctId: vi.fn(),
    screen: vi.fn(),
  }),
}))

vi.mock('@/src/hooks/use-accessibility-announcer', () => ({
  useAccessibilityAnnouncer: () => ({ announce: analyticsMocks.announce }),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: { defaultValue?: string; chip?: string }) => {
      if (key === 'accessibility.chip_filter_label') {
        return `Show ${values?.chip ?? ''} recommendations`
      }
      return values?.defaultValue ?? key
    },
  }),
}))

function MobileChipHarness() {
  const [activeCategory, setActiveCategory] = useState<ChipCategory>('Personal')

  return (
    <MobileChipNavigation
      activeCategory={activeCategory}
      onCategoryChange={setActiveCategory}
    />
  )
}

describe('MobileChipNavigation Component (Story 3.6 - 3.6-UNIT-009)', () => {
  it('renders chips and updates selection state on press', () => {
    render(<MobileChipHarness />)

    const personalChip = screen.getByTestId('chip-personal')
    const communityChip = screen.getByTestId('chip-community')
    const sponsoredChip = screen.getByTestId('chip-sponsored')

    expect(personalChip).toBeDefined()
    expect(communityChip).toBeDefined()
    expect(sponsoredChip).toBeDefined()
    expect(personalChip.getAttribute('aria-selected')).toBe('true')
    expect(communityChip.getAttribute('aria-selected')).toBe('false')

    fireEvent.click(communityChip)

    expect(personalChip.getAttribute('aria-selected')).toBe('false')
    expect(communityChip.getAttribute('aria-selected')).toBe('true')
    expect(analyticsMocks.announce).toHaveBeenCalledWith('chip_change', 'Community')
    expect(analyticsMocks.capture).toHaveBeenCalledWith('chip_changed', {
      chipCategory: 'Community',
      previousCategory: 'Personal',
      surface: 'mobile',
    })
  })
})
