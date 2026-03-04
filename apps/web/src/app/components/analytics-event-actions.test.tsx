import { createEvent, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { captureMock, distinctIdMock } = vi.hoisted(() => ({
  captureMock: vi.fn(),
  distinctIdMock: vi.fn(() => 'web-test-user'),
}))

vi.mock('@couture/api-client', () => ({
  trackAlertReceived: vi.fn(
    (input: {
      alertType: string
      severity: 'info' | 'warning' | 'critical'
      userId: string
      weatherSeverity?: string
    }) => ({
      event: 'alert_received',
      properties: {
        alert_type: input.alertType,
        severity: input.severity,
        user_id: input.userId,
        weather_severity: input.weatherSeverity,
      },
    })
  ),
  trackRitualCreated: vi.fn((input: { userId: string }) => ({
    event: 'ritual_created',
    properties: {
      user_id: input.userId,
      ritual_type: 'daily_outfit',
      weather_context: 'hero_cta',
    },
  })),
  trackWardrobeUploadStarted: vi.fn(
    (input: { userId: string; itemId: string; fileSize: number }) => ({
      event: 'wardrobe_upload_started',
      properties: {
        user_id: input.userId,
        item_id: input.itemId,
        file_size: input.fileSize,
        upload_source: 'web_file_picker',
      },
    })
  ),
}))

vi.mock('posthog-js', () => ({
  default: {
    capture: captureMock,
    get_distinct_id: distinctIdMock,
  },
}))

import { AnalyticsEventActions } from './analytics-event-actions'
import { worker } from '../../test-utils/msw/browser'

describe('AnalyticsEventActions', () => {
  beforeEach(() => {
    captureMock.mockClear()
    distinctIdMock.mockClear()
    distinctIdMock.mockReturnValue('web-test-user')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('captures ritual creation when primary CTA is clicked', async () => {
    render(<AnalyticsEventActions />)

    const primaryCta = screen.getByTestId('cta-primary')
    const clickEvent = createEvent.click(primaryCta)
    fireEvent(primaryCta, clickEvent)

    expect(clickEvent.defaultPrevented).toBe(true)

    await waitFor(() => {
      expect(captureMock).toHaveBeenCalledWith(
        'ritual_created',
        expect.objectContaining({
          user_id: 'web-test-user',
          ritual_type: 'daily_outfit',
          weather_context: 'hero_cta',
        })
      )
    })
  })

  it('keeps CTA interactions working when polling fetch fails', async () => {
    worker.use(http.get('/api/v1/events/poll', () => HttpResponse.error()))

    render(<AnalyticsEventActions />)

    const primaryCta = screen.getByTestId('cta-primary')
    const clickEvent = createEvent.click(primaryCta)
    fireEvent(primaryCta, clickEvent)

    expect(clickEvent.defaultPrevented).toBe(true)

    await waitFor(() => {
      expect(captureMock).toHaveBeenCalledWith(
        'ritual_created',
        expect.objectContaining({
          user_id: 'web-test-user',
        })
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
    fireEvent.change(uploadInput as HTMLInputElement, {
      target: { files: [file] },
    })

    await waitFor(() => {
      expect(captureMock).toHaveBeenCalledWith(
        'wardrobe_upload_started',
        expect.objectContaining({
          user_id: 'web-test-user',
          item_id: 'outfit.jpg',
          file_size: 4,
          upload_source: 'web_file_picker',
        })
      )
    })

    expect((uploadInput as HTMLInputElement).value).toBe('')
  })

  it('captures alert analytics when event polling returns alert channels', async () => {
    worker.use(
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

    await waitFor(() => {
      expect(captureMock).toHaveBeenCalledWith(
        'alert_received',
        expect.objectContaining({
          alert_type: 'storm_warning',
          severity: 'warning',
          user_id: 'alert-user',
          weather_severity: 'severe',
        })
      )
    })
  })
})
