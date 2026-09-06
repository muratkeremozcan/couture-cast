// Learning path Step 27: Widget and notification deep-link handling.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-27-widget-and-notification-deep-link-handling
// Story 3.7 Task 5 step 1 owner: unit-test web deep-link hydration, severe weather focus, and invalid banner
import { render, screen, waitFor, within } from '@testing-library/react'
import { createWeatherAlertPolledEvent } from '@couture/api-client/testing/deep-link-events'
import { http, HttpResponse } from 'msw'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useMswHandlers } from '../../test-utils/msw/runtime'
import { mockCommunityFeedItem } from '../../test-utils/msw/handlers'
import { WEB_ACCESS_TOKEN_STORAGE_KEY } from '../../lib/wardrobe'
import { LookbookPrismLayout } from './lookbook-prism-layout'

const captureMock = vi.fn()

function signIn() {
  window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, 'test-access-token')
}

/**
 * Story 6.1: a community deep link now resolves against the server. Its target
 * has to exist on both sides: `GET /api/v1/community/posts/{postId}`, which
 * the default handler answers for `mockCommunityFeedItem.id` and 404s for every
 * other id, and the feed the grid renders the highlighted card from. The
 * default feed is empty, so a test that wants a card serves one.
 */
function communityFeedHandler() {
  return http.get('/api/v1/community/feed', () =>
    HttpResponse.json({
      data: {
        items: [mockCommunityFeedItem],
        authorStates: [],
        nextCursor: null,
        mode: 'auto',
        viewerBand: 'temperate_wet',
        bandResolved: true,
        bandUnresolvedReason: null,
        experimentVariant: 'auto',
        activeChallenge: null,
      },
    })
  )
}

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
    setLocationSearch('?source=widget&size=small&slot=am')
    render(<LookbookPrismLayout />)

    expect(screen.getByTestId('hero-recommendation-title')).toHaveTextContent(
      'Double-Breasted Blazer & Silk Knit'
    )
    expect(captureMock).toHaveBeenCalledWith('deep_link_handled', {
      source: 'widget',
      slot: 'am',
      widgetSize: 'small',
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
    // Resolution is a server read now, so the card can only be found after the
    // `GET /community/posts/{postId}` probe answers.
    signIn()
    useMswHandlers(communityFeedHandler())
    setLocationSearch(
      `?source=notification&type=community&cardId=${mockCommunityFeedItem.id}`
    )
    render(<LookbookPrismLayout />)

    const highlightedCard = await screen.findByTestId(
      `lookbook-card-${mockCommunityFeedItem.id}`
    )
    expect(highlightedCard).toHaveAttribute('data-highlighted', 'true')
    expect(screen.queryByTestId('deep-link-info-banner')).not.toBeInTheDocument()
    await waitFor(() => expect(highlightedCard).toHaveFocus())
    expect(captureMock).toHaveBeenCalledWith('deep_link_handled', {
      source: 'notification',
      slot: undefined,
      type: 'community',
      alertId: undefined,
      cardId: mockCommunityFeedItem.id,
      surface: 'web',
    })
  })

  it('3.7-UNIT-004: Displays InfoBanner and logs deep_link_invalid event on invalid deep link parameters', () => {
    setLocationSearch('?source=invalid_source&slot=bad_slot')
    render(<LookbookPrismLayout />)

    const infoBanner = screen.getByTestId('deep-link-info-banner')
    expect(infoBanner).toBeInTheDocument()
    expect(
      within(infoBanner).getByText(
        'This link is invalid, expired, or no longer available.'
      )
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

  it('treats a valid payload without a supported target as invalid', () => {
    setLocationSearch('?source=app')
    render(<LookbookPrismLayout />)

    expect(screen.getByTestId('deep-link-info-banner')).toBeInTheDocument()
    expect(captureMock).toHaveBeenCalledWith(
      'deep_link_invalid',
      expect.objectContaining({
        reason: 'Deep link target was not found',
        surface: 'web',
      })
    )
    expect(captureMock).not.toHaveBeenCalledWith('deep_link_handled', expect.anything())
  })
})

describe('Web Deep-Link Handling degraded targets (Story 3.7)', () => {
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

  it('hydrates a watch deep link through the same slot mapping as a widget', () => {
    setLocationSearch('?source=watch&slot=pm')
    render(<LookbookPrismLayout />)

    expect(screen.queryByTestId('deep-link-info-banner')).not.toBeInTheDocument()
    expect(captureMock).toHaveBeenCalledWith('deep_link_handled', {
      source: 'watch',
      slot: 'pm',
      type: undefined,
      alertId: undefined,
      cardId: undefined,
      surface: 'web',
    })
  })

  it('treats a community card that no longer exists as an invalid link', async () => {
    // Signed in, so the 404 from `GET /community/posts/{postId}` is the reason
    // the target is unreachable rather than the missing bearer token.
    signIn()
    setLocationSearch('?source=notification&type=community&cardId=look-does-not-exist')
    render(<LookbookPrismLayout />)

    // A card that was removed since the notification was sent must not silently
    // land the user on an unrelated filter. The probe is asynchronous, so the
    // banner arrives with the server's answer.
    expect(await screen.findByTestId('deep-link-info-banner')).toBeInTheDocument()
    expect(captureMock).toHaveBeenCalledWith(
      'deep_link_invalid',
      expect.objectContaining({ reason: 'Community card target was not found' })
    )
  })

  it('reports an unloadable weather alert target rather than focusing nothing', async () => {
    useMswHandlers(http.get('/api/v1/events/poll', () => HttpResponse.error()))
    setLocationSearch('?source=notification&type=severe_weather&alertId=alert-999')
    render(<LookbookPrismLayout />)

    await waitFor(() =>
      expect(captureMock).toHaveBeenCalledWith(
        'deep_link_invalid',
        expect.objectContaining({ reason: 'Weather alert target could not be loaded' })
      )
    )
    expect(screen.getByTestId('deep-link-info-banner')).toBeInTheDocument()
  })

  it('reports a weather alert that is no longer in the polled feed', async () => {
    useMswHandlers(
      http.get('/api/v1/events/poll', () =>
        HttpResponse.json({
          events: [createWeatherAlertPolledEvent('alert-other', 'user-1')],
          nextSince: '2026-07-30T12:00:00.000Z',
        })
      )
    )
    setLocationSearch('?source=notification&type=severe_weather&alertId=alert-expired')
    render(<LookbookPrismLayout />)

    await waitFor(() =>
      expect(captureMock).toHaveBeenCalledWith(
        'deep_link_invalid',
        expect.objectContaining({ reason: 'Weather alert target was not found' })
      )
    )
    expect(screen.queryByTestId('severe-weather-alert-focused')).not.toBeInTheDocument()
  })
})
