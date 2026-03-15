import { fireEvent, render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

const { captureMock } = vi.hoisted(() => ({
  captureMock: vi.fn(),
}))

vi.mock('../../analytics/browser-analytics', () => ({
  browserAnalytics: {
    capture: captureMock,
  },
}))

import { PostHogClickTracker } from './posthog-click-tracker'

describe('PostHogClickTracker', () => {
  it('captures click events from data-ph attributes', () => {
    const { getByTestId } = render(
      <>
        <PostHogClickTracker />
        <button
          type="button"
          data-testid="tracked-button"
          data-ph-event="cta_clicked"
          data-ph-cta-label="Preview outfits"
          data-ph-cta-type="primary"
        >
          Track me
        </button>
      </>
    )

    fireEvent.click(getByTestId('tracked-button'))

    expect(captureMock).toHaveBeenCalledWith('cta_clicked', {
      cta_label: 'Preview outfits',
      cta_type: 'primary',
    })
  })

  it('ignores clicks without a data-ph-event target', () => {
    const { getByTestId } = render(
      <>
        <PostHogClickTracker />
        <button type="button" data-testid="plain-button">
          Ignore me
        </button>
      </>
    )

    fireEvent.click(getByTestId('plain-button'))

    expect(captureMock).not.toHaveBeenCalled()
  })
})
