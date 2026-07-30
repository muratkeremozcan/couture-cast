import { render, screen, waitFor } from '@testing-library/react'
import { createWeatherAlertPolledEvent } from '@couture/api-client/testing/deep-link-events'
import { http, HttpResponse } from 'msw'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useMswHandlers } from '../../test-utils/msw/runtime'
import { LookbookPrismLayout } from './lookbook-prism-layout'

const captureMock = vi.fn()

vi.mock('posthog-js', () => ({
  default: {
    capture: (...args: unknown[]): void => {
      captureMock(...args)
    },
  },
}))

vi.mock('next/navigation', () => ({
  usePathname: () => '/',
}))

describe('Web Deep-Link Handling (Story 3.7)', () => {
  const originalLocation = window.location

  beforeEach(() => {
    captureMock.mockClear()
    vi.clearAllMocks()
  })

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      writable: true,
      value: originalLocation,
    })
  })

  const setLocationSearch = (search: string) => {
    Object.defineProperty(window, 'location', {
      writable: true,
      value: {
        ...originalLocation,
        search,
        href: `http://localhost${search}`,
      },
    })
  }

  it('3.7-UNIT-001: Hydrates Personal/Morning recommendation on widget tap deep-link', () => {
    setLocationSearch('?source=widget&slot=am')
    render(<LookbookPrismLayout />)

    expect(screen.getByTestId('hero-recommendation-title')).toHaveTextContent(
      'Double-Breasted Blazer & Silk Knit'
    )
    expect(captureMock).toHaveBeenCalledWith('deep_link_handled', {
      source: 'widget',
      slot: 'am',
      type: undefined,
      alertId: undefined,
      cardId: undefined,
      surface: 'web',
    })
  })

  it('3.7-UNIT-002: Focuses the canonical severe weather alert target', async () => {
    useMswHandlers(
      http.get('/api/v1/events/poll', () =>
        HttpResponse.json({
          events: [createWeatherAlertPolledEvent('alert-999', 'user-1')],
          nextSince: '2026-07-30T12:00:00.000Z',
        })
      )
    )
    setLocationSearch('?source=notification&type=severe_weather&alertId=alert-999')
    render(<LookbookPrismLayout />)

    const alert = await screen.findByTestId('severe-weather-alert-focused')
    expect(alert).toHaveTextContent('A severe thunderstorm warning is active.')
    await waitFor(() => {
      expect(alert).toHaveFocus()
      expect(captureMock).toHaveBeenCalledWith('deep_link_handled', {
        source: 'notification',
        slot: undefined,
        type: 'severe_weather',
        alertId: 'alert-999',
        cardId: undefined,
        surface: 'web',
      })
    })
  })

  it('3.7-UNIT-003: Selects, scrolls to, and focuses the community card', async () => {
    setLocationSearch('?source=notification&type=community&cardId=look-4')
    render(<LookbookPrismLayout />)

    const highlightedCard = document.getElementById('lookbook-card-look-4')
    expect(highlightedCard).toBeInTheDocument()
    expect(highlightedCard).toHaveAttribute('data-highlighted', 'true')
    await waitFor(() => expect(highlightedCard).toHaveFocus())
    expect(captureMock).toHaveBeenCalledWith('deep_link_handled', {
      source: 'notification',
      slot: undefined,
      type: 'community',
      alertId: undefined,
      cardId: 'look-4',
      surface: 'web',
    })
  })

  it('3.7-UNIT-004: Displays InfoBanner and logs deep_link_invalid event on invalid deep link parameters', () => {
    setLocationSearch('?source=invalid_source&slot=bad_slot')
    render(<LookbookPrismLayout />)

    expect(screen.getByTestId('deep-link-info-banner')).toBeInTheDocument()
    expect(
      screen.getByText('We refreshed your data after reconnecting')
    ).toBeInTheDocument()
    const expectedReason = expect.stringContaining('source') as unknown as string
    expect(captureMock).toHaveBeenCalledWith(
      'deep_link_invalid',
      expect.objectContaining({
        reason: expectedReason,
        surface: 'web',
      })
    )
  })
})
