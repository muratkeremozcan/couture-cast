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
  const eventExpectations = createAnalyticsEventExpectations(trackedEvents, expect)
  const originalPostHogApiKey = process.env.POSTHOG_API_KEY

  beforeEach(() => {
    trackedEvents.splice(0, trackedEvents.length)
    captureMock.mockClear()
    initMock.mockClear()
    distinctIdMock.mockReset()
    distinctIdMock.mockReturnValue('web-test-user')
    process.env.POSTHOG_API_KEY = 'phc_test'
  })

  afterEach(() => {
    process.env.POSTHOG_API_KEY = originalPostHogApiKey
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

describe('AnalyticsEventActions degraded inputs', () => {
  const eventExpectations = createAnalyticsEventExpectations(trackedEvents, expect)
  const originalPostHogApiKey = process.env.POSTHOG_API_KEY

  beforeEach(() => {
    trackedEvents.splice(0, trackedEvents.length)
    captureMock.mockClear()
    initMock.mockClear()
    distinctIdMock.mockReset()
    distinctIdMock.mockReturnValue('web-test-user')
    process.env.POSTHOG_API_KEY = 'phc_test'
  })

  afterEach(() => {
    process.env.POSTHOG_API_KEY = originalPostHogApiKey
    delete window.__enableAnalyticsTestHook
    delete window.__analyticsBindingsReady
    vi.restoreAllMocks()
  })

  it('skips non-alert channels entirely', async () => {
    useMswHandlers(
      http.get('/api/v1/events/poll', () =>
        HttpResponse.json({
          events: [
            { id: 'evt-1', channel: 'daily_digest', userId: 'u-1', payload: {} },
            {
              id: 'evt-2',
              channel: 'weather_alert',
              userId: 'u-1',
              payload: { alertType: 'storm', severity: 'critical' },
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
        { alert_type: 'storm', severity: 'critical' },
        { afterIndex: eventCursor, count: 1 }
      )
    })
    // Exactly one alert event: the digest channel must not be counted as one.
    expect(
      trackedEvents.filter((tracked) => tracked.event === 'alert_received')
    ).toHaveLength(1)
  })

  it('falls back to safe defaults when an alert carries no payload at all', async () => {
    useMswHandlers(
      http.get('/api/v1/events/poll', () =>
        HttpResponse.json({
          events: [{ id: 'evt-1', channel: 'alert_generic', userId: '', payload: null }],
        })
      )
    )

    render(<AnalyticsEventActions />)
    const eventCursor = eventExpectations.createCursor()

    // A payload-less alert must degrade to the channel name and a safe severity
    // rather than emitting nothing or a malformed contract payload.
    await waitFor(() => {
      eventExpectations.expectEventTracked(
        'alert_received',
        {
          alert_type: 'alert_generic',
          severity: 'info',
          user_id: 'web-test-user',
        },
        { afterIndex: eventCursor, count: 1 }
      )
    })
  })

  it('discards alert payload fields whose types do not match the contract', async () => {
    useMswHandlers(
      http.get('/api/v1/events/poll', () =>
        HttpResponse.json({
          events: [
            {
              id: 'evt-1',
              channel: 'alert_typed',
              userId: '',
              payload: { alertType: 42, severity: 'chartreuse', weatherSeverity: 7 },
            },
          ],
        })
      )
    )

    render(<AnalyticsEventActions />)
    const eventCursor = eventExpectations.createCursor()

    await waitFor(() => {
      const tracked = eventExpectations.expectEventTracked(
        'alert_received',
        { alert_type: 'alert_typed', severity: 'info', user_id: 'web-test-user' },
        { afterIndex: eventCursor, count: 1 }
      )
      // A number would corrupt the funnel's severity dimension; it is dropped.
      expect(tracked.properties?.weather_severity).toBeUndefined()
    })
  })

  it('tolerates a poll response with no events array at all', async () => {
    useMswHandlers(
      http.get('/api/v1/events/poll', () => HttpResponse.json({ nextSince: 'cursor-1' }))
    )

    render(<AnalyticsEventActions />)
    const primaryCta = screen.getByTestId('cta-primary')
    const eventCursor = eventExpectations.createCursor()
    fireEvent.click(primaryCta)

    // The CTA path must still work when the feed returns an empty envelope.
    await waitFor(() => {
      eventExpectations.expectEventTracked(
        'ritual_created',
        { user_id: 'web-test-user' },
        { afterIndex: eventCursor, count: 1 }
      )
    })
  })

  it('falls back to an anonymous identity when PostHog has no distinct id', async () => {
    distinctIdMock.mockReturnValue('')
    vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({
      timeZone: '',
    } as Intl.ResolvedDateTimeFormatOptions)

    render(<AnalyticsEventActions />)
    const eventCursor = eventExpectations.createCursor()
    fireEvent.click(screen.getByTestId('cta-primary'))

    // Dropping the event would leave a funnel hole; an explicit anonymous
    // identity keeps it attributable to "unknown" instead.
    await waitFor(() => {
      eventExpectations.expectEventTracked(
        'ritual_created',
        { user_id: 'web-anonymous-user', location_id: 'unknown' },
        { afterIndex: eventCursor, count: 1 }
      )
    })
  })

  it('publishes the binding-ready flag only while mounted, for the E2E hook', () => {
    window.__enableAnalyticsTestHook = true

    const { unmount } = render(<AnalyticsEventActions />)
    expect(window.__analyticsBindingsReady).toBe(true)

    unmount()
    expect(window.__analyticsBindingsReady).toBe(false)
  })

  it('captures nothing when the file picker is dismissed', () => {
    render(<AnalyticsEventActions />)

    const uploadInput = document.getElementById(
      'wardrobe-upload-input'
    ) as HTMLInputElement
    fireEvent.change(uploadInput)

    expect(
      trackedEvents.filter((tracked) => tracked.event === 'wardrobe_upload_started')
    ).toHaveLength(0)
  })

  it('synthesizes an item id for a file with no name', async () => {
    render(<AnalyticsEventActions />)

    const uploadInput = document.getElementById(
      'wardrobe-upload-input'
    ) as HTMLInputElement
    const eventCursor = eventExpectations.createCursor()
    fireEvent.change(uploadInput, {
      target: { files: [new File(['look'], '', { type: 'image/jpeg' })] },
    })

    await waitFor(() => {
      const tracked = eventExpectations.expectEventTracked(
        'wardrobe_upload_started',
        { upload_source: 'web_file_picker' },
        { afterIndex: eventCursor, count: 1 }
      )
      // A nameless file must still get a stable, non-empty identifier.
      expect(tracked.properties?.item_id).toMatch(/^web-upload-\d+$/)
    })
  })

  it('keeps polling on an interval so later alerts are still captured', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      let pollCount = 0
      useMswHandlers(
        http.get('/api/v1/events/poll', () => {
          pollCount += 1
          return HttpResponse.json({
            events: [
              {
                id: `evt-${pollCount}`,
                channel: 'weather_alert',
                userId: 'alert-user',
                payload: { alertType: 'storm', severity: 'warning' },
              },
            ],
          })
        })
      )

      render(<AnalyticsEventActions />)
      await vi.waitFor(() => expect(pollCount).toBe(1))

      await vi.advanceTimersByTimeAsync(30_000)

      await vi.waitFor(() => expect(pollCount).toBe(2))
      expect(
        trackedEvents.filter((tracked) => tracked.event === 'alert_received').length
      ).toBeGreaterThanOrEqual(2)
    } finally {
      vi.useRealTimers()
    }
  })
})
