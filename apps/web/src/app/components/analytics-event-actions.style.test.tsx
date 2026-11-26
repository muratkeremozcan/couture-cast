import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@couture/api-client', () => ({
  // Signed out: the style case renders without reading the events feed.
  commentSessionIdentity: vi.fn(() => null),
  trackAlertReceived: vi.fn(() => ({ event: 'alert_received', properties: {} })),
  trackRitualCreated: vi.fn(() => ({ event: 'ritual_created', properties: {} })),
  trackWardrobeUploadStarted: vi.fn(() => ({
    event: 'wardrobe_upload_started',
    properties: {},
  })),
}))

vi.mock('../../lib/api-client', () => ({
  createWebApiClient: vi.fn(() => ({
    apiV1EventsPollGetRaw: vi.fn(() =>
      Promise.resolve({
        raw: new Response(
          JSON.stringify({
            events: [],
            nextSince: null,
          }),
          {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
            },
          }
        ),
      })
    ),
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
  // Story CC-7.9 D3: Home's one gold action is the sample entry (guest) or Open wardrobe
  // (member), so this CTA is a neutral outline on the token roles and never paints gold.
  it('styles the preview CTA as a neutral outline on the token roles', () => {
    render(<AnalyticsEventActions />)

    const primaryCta = screen.getByTestId('cta-primary')
    expect(primaryCta).toHaveClass(
      'border-line-strong',
      'text-ink',
      'rounded-full',
      'font-semibold'
    )
    expect(primaryCta).not.toHaveClass('bg-primary')
    expect(primaryCta).not.toHaveAttribute('data-gold')
  })
})
