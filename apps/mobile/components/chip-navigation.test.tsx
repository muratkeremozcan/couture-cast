// Story 3.6 Task 5 step 3 owner: unit-test mobile React Native chip navigation pressables and selection state in apps/mobile/components/chip-navigation.test.tsx
import React, { useState } from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { MobileChipNavigation } from './chip-navigation'
import type { ChipCategory } from './chip-navigation'

const analyticsMocks = vi.hoisted(() => ({
  capture: vi.fn(),
}))

vi.mock('@/src/analytics/mobile-analytics', () => ({
  useMobileAnalytics: () => ({
    capture: analyticsMocks.capture,
    getDistinctId: vi.fn(),
    screen: vi.fn(),
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
    expect(personalChip).toHaveAttribute('aria-selected', 'true')
    expect(communityChip).toHaveAttribute('aria-selected', 'false')

    fireEvent.click(communityChip)

    expect(personalChip).toHaveAttribute('aria-selected', 'false')
    expect(communityChip).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByTestId('mobile-chip-status')).toHaveTextContent(
      'Showing Community recommendations'
    )
    expect(analyticsMocks.capture).toHaveBeenCalledWith('chip_changed', {
      chipCategory: 'Community',
      previousCategory: 'Personal',
      surface: 'mobile',
    })
  })
})
