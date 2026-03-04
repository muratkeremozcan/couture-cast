import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@couture/api-client', () => ({
  trackAlertReceived: vi.fn(() => ({ event: 'alert_received', properties: {} })),
  trackRitualCreated: vi.fn(() => ({ event: 'ritual_created', properties: {} })),
  trackWardrobeUploadStarted: vi.fn(() => ({
    event: 'wardrobe_upload_started',
    properties: {},
  })),
}))

vi.mock('posthog-js', () => ({
  default: {
    capture: vi.fn(),
    get_distinct_id: vi.fn(() => 'web-style-test-user'),
  },
}))

import { AnalyticsEventActions } from './analytics-event-actions'

describe('AnalyticsEventActions styles', () => {
  it('applies expected utility classes to the primary CTA', () => {
    render(<AnalyticsEventActions />)

    const primaryCta = screen.getByTestId('cta-primary')
    expect(primaryCta).toHaveClass(
      'bg-amber-300',
      'text-black',
      'rounded-full',
      'font-semibold'
    )
  })
})
