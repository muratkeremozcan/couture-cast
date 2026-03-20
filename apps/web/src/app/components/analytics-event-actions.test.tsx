import { createEvent, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createAnalyticsEventExpectations,
  type MemoryTrackedAnalyticsEvent,
} from '@couture/api-client/testing/analytics-event-assertions'
import { useMswHandlers } from '../../test-utils/msw/runtime'

const { trackedEvents, captureMock, distinctIdMock, initMock } = vi.hoisted(() => {
  const trackedEvents: MemoryTrackedAnalyticsEvent[] = []

  return {
    trackedEvents,
    captureMock: vi.fn((event: string, properties?: Record<string, unknown>) => {
      trackedEvents.push({ event, properties })
    }),
    distinctIdMock: vi.fn(() => 'web-test-user'),
    initMock: vi.fn(),
  }
})

vi.mock('posthog-js', () => ({
  default: {
    capture: captureMock,
    get_distinct_id: distinctIdMock,
    init: initMock,
  },
}))

import { AnalyticsEventActions } from './analytics-event-actions'

describe('AnalyticsEventActions', () => {
  const eventExpectations = createAnalyticsEventExpectations(trackedEvents)

  beforeEach(() => {
    trackedEvents.splice(0, trackedEvents.length)
    captureMock.mockClear()
    initMock.mockClear()
    distinctIdMock.mockReset()
    distinctIdMock.mockReturnValue('web-test-user')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('captures ritual creation when primary CTA is clicked', async () => {
    render(<AnalyticsEventActions />)

    const primaryCta = screen.getByTestId('cta-primary')
    const eventCursor = eventExpectations.createCursor()
    const clickEvent = createEvent.click(primaryCta)
    fireEvent(primaryCta, clickEvent)

    expect(clickEvent.defaultPrevented).toBe(true)

    await waitFor(() => {
      const trackedEvent = eventExpectations.expectEventTracked(
        'ritual_created',
        {
          location_id: Intl.DateTimeFormat().resolvedOptions().timeZone || 'unknown',
          ritual_type: 'daily_outfit',
          user_id: 'web-test-user',
          weather_context: 'hero_cta',
        },
        { afterIndex: eventCursor, count: 1 }
      )

      expect(trackedEvent.properties?.user_id).toBe('web-test-user')
      expect(typeof trackedEvent.properties?.timestamp).toBe('string')
    })
  })

  it('keeps CTA interactions working when polling fetch fails', async () => {
    useMswHandlers(http.get('/api/v1/events/poll', () => HttpResponse.error()))

    render(<AnalyticsEventActions />)

    const primaryCta = screen.getByTestId('cta-primary')
    const eventCursor = eventExpectations.createCursor()
    const clickEvent = createEvent.click(primaryCta)
    fireEvent(primaryCta, clickEvent)

    expect(clickEvent.defaultPrevented).toBe(true)

    await waitFor(() => {
      eventExpectations.expectEventTracked(
        'ritual_created',
        { user_id: 'web-test-user' },
        { afterIndex: eventCursor, count: 1 }
      )
    })
  })

  it('captures wardrobe upload start when file is selected', async () => {
    render(<AnalyticsEventActions />)

    const file = new File(['look'], 'outfit.jpg', { type: 'image/jpeg' })
    const uploadInput = document.getElementById(
      'wardrobe-upload-input'
    ) as HTMLInputElement | null

    expect(uploadInput).not.toBeNull()
    const eventCursor = eventExpectations.createCursor()
    fireEvent.change(uploadInput as HTMLInputElement, {
      target: { files: [file] },
    })

    await waitFor(() => {
      eventExpectations.expectEventTracked(
        'wardrobe_upload_started',
        {
          file_size: 4,
          item_id: 'outfit.jpg',
          upload_source: 'web_file_picker',
          user_id: 'web-test-user',
        },
        { afterIndex: eventCursor, count: 1 }
      )
    })

    expect((uploadInput as HTMLInputElement).value).toBe('')
  })

  it('captures alert analytics when event polling returns alert channels', async () => {
    useMswHandlers(
      http.get('/api/v1/events/poll', () =>
        HttpResponse.json({
          events: [
            {
              id: 'evt-1',
              channel: 'weather_alert',
              userId: 'alert-user',
              payload: {
                alertType: 'storm_warning',
                severity: 'warning',
                weatherSeverity: 'severe',
              },
            },
          ],
          nextSince: 'cursor-1',
        })
      )
    )

    render(<AnalyticsEventActions />)
    const eventCursor = eventExpectations.createCursor()

    await waitFor(() => {
      eventExpectations.expectEventTracked(
        'alert_received',
        {
          alert_type: 'storm_warning',
          severity: 'warning',
          user_id: 'alert-user',
          weather_severity: 'severe',
        },
        { afterIndex: eventCursor, count: 1 }
      )
    })
  })
})
