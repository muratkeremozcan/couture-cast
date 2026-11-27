import { CommunitySyncState } from '@couture/api-client'
// Learning path Step 27: Widget and notification deep-link handling.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-27-widget-and-notification-deep-link-handling
// Story 3.7 Task 5 step 1 owner: unit-test web deep-link hydration, severe weather focus, and invalid banner
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createWeatherAlertPolledEvent } from '@couture/api-client/testing/deep-link-events'
import { http, HttpResponse } from 'msw'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useMswHandlers } from '../../test-utils/msw/runtime'
import { mockCommunityFeedItem } from '../../test-utils/msw/handlers'
import { WEB_ACCESS_TOKEN_STORAGE_KEY } from '../../lib/wardrobe'
import CommunityPage from '../community/page'
import { createWebSpotlightActivation } from '../lib/deep-link-handler'
import { currentWebSessionScope } from '../../lib/use-web-session'
import { cityPage } from '../../test-utils/home-spotlight-teaser'
import { LookbookPrismLayout } from './lookbook-prism-layout'

const captureMock = vi.fn()

function signIn() {
  window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, 'test-access-token')
}

vi.mock('posthog-js', () => ({
  default: {
    capture: (...args: unknown[]): void => {
      captureMock(...args)
    },
  },
}))

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }))
vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => router,
  useSearchParams: () => new URLSearchParams(window.location.search),
}))

describe('Web Deep-Link Handling (Story 3.7)', () => {
  const originalLocation = window.location

  beforeEach(() => {
    // Story6.5 transport is covered independently; these legacy presentation cases own static HTTP.
    vi.spyOn(CommunitySyncState.prototype, 'start').mockImplementation(() => undefined)
    captureMock.mockClear()
    vi.clearAllMocks()
  })

  afterEach(() => {
    window.sessionStorage.clear()
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

  it('3.7-UNIT-001: keeps the guest sample available on a widget link', async () => {
    setLocationSearch('?source=widget&size=small&slot=am')
    render(<LookbookPrismLayout />)

    expect(await screen.findByTestId('guest-preview-entry')).toBeVisible()
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
    // The events feed is per account, so the alert is read with the reader's bearer.
    signIn()
    const authorizations: (string | null)[] = []
    useMswHandlers(
      http.get('/api/v1/events/poll', ({ request }) => {
        authorizations.push(request.headers.get('authorization'))
        return HttpResponse.json({
          events: [createWeatherAlertPolledEvent('alert-999', 'user-1')],
          nextSince: '2026-07-30T12:00:00.000Z',
        })
      })
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
    expect(authorizations).toEqual(['Bearer test-access-token'])
  })

  it('3.7-UNIT-003: forwards a legacy Community notification to the Community tab', async () => {
    const query = `?source=notification&type=community&cardId=${mockCommunityFeedItem.id}`
    setLocationSearch(query)
    render(<LookbookPrismLayout />)
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith(`/community${query}`))
    expect(screen.queryByTestId('community-card-grid')).toBeNull()
  })

  it('3.7-UNIT-004: Displays InfoBanner and logs deep_link_invalid event on invalid deep link parameters', async () => {
    setLocationSearch('?source=invalid_source&slot=bad_slot')
    render(<LookbookPrismLayout />)

    const infoBanner = await screen.findByTestId('deep-link-info-banner')
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

  it('treats a valid payload without a supported target as invalid', async () => {
    setLocationSearch('?source=app')
    render(<LookbookPrismLayout />)

    expect(await screen.findByTestId('deep-link-info-banner')).toBeInTheDocument()
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
    window.sessionStorage.clear()
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

  it.each([404, 403])(
    'the Community destination reports an unavailable card (%i) after an authenticated target read',
    async (status) => {
      signIn()
      const authorizations: (string | null)[] = []
      useMswHandlers(
        http.get('/api/v1/community/posts/unavailable-look', ({ request }) => {
          authorizations.push(request.headers.get('authorization'))
          return new HttpResponse(null, { status })
        })
      )
      setLocationSearch('?source=notification&type=community&cardId=unavailable-look')
      render(<CommunityPage />)

      expect(await screen.findByTestId('deep-link-info-banner')).toHaveTextContent(
        'This link is invalid, expired, or no longer available.'
      )
      expect(authorizations).toEqual(['Bearer test-access-token'])
      expect(screen.queryByTestId('lookbook-card-unavailable-look')).toBeNull()
      expect(router.replace).not.toHaveBeenCalled()
    }
  )

  it.each([
    ['Today', LookbookPrismLayout],
    ['Community', CommunityPage],
  ] as const)(
    'reports a signed-out notification on %s without a member probe',
    async (_entry, Entry) => {
      const probe = vi.fn(() => new HttpResponse(null, { status: 403 }))
      useMswHandlers(http.get('/api/v1/community/posts/unavailable-look', probe))
      setLocationSearch('?source=notification&type=community&cardId=unavailable-look')
      render(<Entry />)

      const banner = await screen.findByTestId('deep-link-info-banner')
      expect(banner).toHaveTextContent(
        'This link is invalid, expired, or no longer available.'
      )
      expect(captureMock).toHaveBeenCalledWith('deep_link_invalid', expect.anything())
      expect(probe).not.toHaveBeenCalled()
      expect(router.replace).not.toHaveBeenCalled()
      fireEvent.click(within(banner).getByRole('button'))
      expect(screen.queryByTestId('deep-link-info-banner')).toBeNull()
    }
  )

  it.each([true, false])(
    'only the account that opened the Spotlight gets programmatic focus (same owner: %s)',
    async (sameOwner) => {
      signIn()
      const scope = currentWebSessionScope()!
      const token = createWebSpotlightActivation(
        'look-1',
        sameOwner ? scope : `${scope}-previous`
      )
      useMswHandlers(
        http.get('/api/v1/community/spotlight', () =>
          HttpResponse.json({ data: cityPage() })
        )
      )
      setLocationSearch(
        `?source=app&type=community&cardId=look-1&focus=spotlight&focusToken=${token}`
      )
      render(<CommunityPage />)

      const card = await screen.findByTestId('spotlight-lookbook-card-look-1')
      if (sameOwner) await waitFor(() => expect(card).toHaveFocus())
      else {
        await waitFor(() =>
          expect(screen.getByTestId('screen-gate')).toHaveAttribute('data-ready', 'true')
        )
        expect(card).not.toHaveFocus()
      }
    }
  )

  it('reports a weather alert link opened while signed out without reading the feed', async () => {
    let polls = 0
    useMswHandlers(
      http.get('/api/v1/events/poll', () => {
        polls += 1
        return HttpResponse.json({ events: [], nextSince: null })
      })
    )
    setLocationSearch('?source=notification&type=severe_weather&alertId=alert-999')
    render(<LookbookPrismLayout />)

    await waitFor(() =>
      expect(captureMock).toHaveBeenCalledWith(
        'deep_link_invalid',
        expect.objectContaining({ reason: 'Weather alert target could not be loaded' })
      )
    )
    expect(polls).toBe(0)
  })

  it('reports an unloadable weather alert target rather than focusing nothing', async () => {
    signIn()
    useMswHandlers(http.get('/api/v1/events/poll', () => HttpResponse.error()))
    setLocationSearch('?source=notification&type=severe_weather&alertId=alert-999')
    render(<LookbookPrismLayout />)

    await waitFor(() =>
      expect(captureMock).toHaveBeenCalledWith(
        'deep_link_invalid',
        expect.objectContaining({ reason: 'Weather alert target could not be loaded' })
      )
    )
    expect(await screen.findByTestId('deep-link-info-banner')).toBeInTheDocument()
  })

  it('reports a weather alert that is no longer in the polled feed', async () => {
    signIn()
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
