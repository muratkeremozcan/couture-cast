// Learning path Step 26: Chip navigation and sticky bottom nav.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-26-chip-navigation-and-sticky-bottom-nav
// Learning path Step 28: Accessibility hardening.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-28-accessibility-hardening
// Story 3.6 Task 5 step 3 owner: unit-test mobile React Native chip navigation pressables and selection state in apps/mobile/components/chip-navigation.test.tsx
import React, { useState } from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { MobileChipNavigation, type ChipCategory } from './chip-navigation'

const analyticsMocks = vi.hoisted(() => ({
  capture: vi.fn(),
  announce: vi.fn(),
}))

vi.mock('@/src/analytics/mobile-analytics', async () =>
  (await import('@/src/test-utils/mobile-analytics.js')).mobileAnalyticsModuleMock({
    capture: analyticsMocks.capture,
    getDistinctId: () => undefined,
  })
)

vi.mock('@/src/hooks/use-accessibility-announcer', () => ({
  useAccessibilityAnnouncer: () => ({ announce: analyticsMocks.announce }),
}))

const labelOverrides = vi.hoisted((): Record<string, string> => ({}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: { defaultValue?: string; chip?: string }) => {
      if (key === 'accessibility.chip_filter_label') {
        return `Show ${values?.chip ?? ''} recommendations`
      }
      return labelOverrides[key] ?? values?.defaultValue ?? key
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

describe('MobileChipNavigation long localized labels', () => {
  // The longest chip labels across the 10 locales: fr-FR, fr-CA and it-IT.
  const longestLabels = [
    ['Personnel', 'Communauté', 'Sponsorisé'],
    ['Personnel', 'Communauté', 'Commandité'],
    ['Personale', 'Community', 'Sponsorizzato'],
  ]

  it.each(longestLabels)(
    'keeps %s, %s and %s on one untruncated line',
    (personal, community, sponsored) => {
      Object.assign(labelOverrides, {
        'accessibility.chip_personal': personal,
        'accessibility.chip_community': community,
        'accessibility.chip_sponsored': sponsored,
      })
      try {
        render(<MobileChipHarness />)
        for (const label of [personal, community, sponsored]) {
          const text = screen.getByText(label)
          const range = document.createRange()
          range.selectNodeContents(text)
          const lineTops = new Set(
            Array.from(range.getClientRects(), (rect: DOMRect) => Math.round(rect.top))
          )
          // One rendered line, fully inside the chip's padded content box. Android
          // breaks an overlong word mid-word; a browser lets it spill into the padding
          // instead. Both fail here.
          expect(lineTops.size, `${label} line count`).toBe(1)
          const chip = text.closest('[data-testid^="chip-"]')
          if (!chip) throw new Error(`No chip wraps ${label}`)
          const chipRect = chip.getBoundingClientRect()
          const chipStyle = getComputedStyle(chip)
          const textRect = range.getBoundingClientRect()
          expect(textRect.left, `${label} left edge`).toBeGreaterThanOrEqual(
            chipRect.left + parseFloat(chipStyle.paddingLeft)
          )
          expect(textRect.right, `${label} right edge`).toBeLessThanOrEqual(
            chipRect.right - parseFloat(chipStyle.paddingRight)
          )
        }
      } finally {
        for (const key of Object.keys(labelOverrides)) delete labelOverrides[key]
      }
    }
  )
})
