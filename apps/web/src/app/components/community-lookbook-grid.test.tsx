// Story 3.5 Task 6 step 2 owner: unit-test community lookbook filter chip interactions and ARIA status in apps/web/src/app/components/community-lookbook-grid.test.tsx
import { useState } from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CommunityLookbookGrid, LookbookFilterNav } from './community-lookbook-grid'
import { CHIP_NAVIGATION_HEIGHT_PX } from './chip-navigation'
import type { FilterCategory } from './community-lookbook-grid'

const posthogMocks = vi.hoisted(() => ({
  capture: vi.fn(),
}))

vi.mock('posthog-js', () => ({
  default: {
    capture: posthogMocks.capture,
  },
}))

function LookbookHarness() {
  const [activeTab, setActiveTab] = useState<FilterCategory>('New')

  return (
    <>
      <LookbookFilterNav
        activeTab={activeTab}
        isMobilePreview={false}
        onTabChange={setActiveTab}
      />
      <CommunityLookbookGrid activeTab={activeTab} isMobilePreview={false} />
    </>
  )
}

describe('CommunityLookbookGrid (3.5-UNIT-002)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders filter tabs with active tab aria-pressed="true" and polite status message', () => {
    render(<LookbookHarness />)

    const newTab = screen.getByRole('button', { name: /new/i })
    const followingTab = screen.getByRole('button', { name: /following/i })

    expect(screen.getByRole('navigation', { name: 'Lookbook Filters' })).toHaveStyle({
      top: `${CHIP_NAVIGATION_HEIGHT_PX}px`,
    })
    expect(newTab).toHaveAttribute('aria-pressed', 'true')
    expect(followingTab).toHaveAttribute('aria-pressed', 'false')

    const liveRegion = screen.getByRole('status')
    expect(liveRegion).toHaveTextContent(/showing new lookbook posts/i)
  })

  it('updates aria-pressed and aria-live status when a filter chip is clicked', () => {
    render(<LookbookHarness />)

    const followingTab = screen.getByRole('button', { name: /following/i })
    fireEvent.click(followingTab)

    expect(followingTab).toHaveAttribute('aria-pressed', 'true')
    const newTab = screen.getByRole('button', { name: /new/i })
    expect(newTab).toHaveAttribute('aria-pressed', 'false')

    const liveRegion = screen.getByRole('status')
    expect(liveRegion).toHaveTextContent(/showing following lookbook posts/i)

    expect(posthogMocks.capture).toHaveBeenCalledWith('layout_interaction', {
      action: 'filter_chip_click',
      target: 'following',
    })
  })

  it('keeps cards focusable when a community image fails', () => {
    render(<LookbookHarness />)

    const imageSurface = screen.getByTestId('lookbook-image-look-1')
    const image = imageSurface.querySelector('img')
    fireEvent.error(image as HTMLImageElement)

    expect(image).toHaveProperty('hidden', true)
    expect(
      screen.getByText(/milan autumn wool trench/i).closest('[tabindex="0"]')
    ).toBeInTheDocument()
  })
})
