/* eslint-disable @typescript-eslint/await-thenable */
// Story 3.7 Task 5 step 2 owner: unit-test mobile deep-link hydration, severe weather alert focus, and community card highlight
import React from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import {
  createCommunityPolledEvent,
  createWeatherAlertPolledEvent,
} from '@couture/api-client/testing/deep-link-events'
import { http, HttpResponse } from 'msw'
import { render } from 'vitest-browser-react'
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import TabOneScreen from '@/app/(tabs)/index'
import CommunityScreen from '@/app/(tabs)/community'
import { setMobileAccessTokenResolver } from '@/src/lib/mobile-auth'
import { clearRitualMemoryCache } from '@/src/lib/ritual-cache'
import { initI18n } from '@/src/lib/i18n'
import { server } from '@/src/test-utils/msw/server'

let mockParams: Record<string, string> = {}
const mockSetParams = vi.fn()
const mockPush = vi.fn()
const mockRouter = { setParams: mockSetParams, push: mockPush }

vi.mock('expo-router', () => ({
  useLocalSearchParams: () => mockParams,
  useRouter: () => mockRouter,
}))

vi.mock('expo-localization', () => ({
  getLocales: () => [{ languageTag: 'en-US', languageCode: 'en', regionCode: 'US' }],
}))

const mockCapture = vi.fn()
const mockAnalytics = {
  capture: mockCapture,
  getDistinctId: () => 'test-user-id',
  screen: vi.fn(),
}
vi.mock('@/src/analytics/mobile-analytics', () => ({
  useMobileAnalytics: () => mockAnalytics,
  MobileAnalyticsDiagnosticsPanel: () => null,
}))

let restoreAccessTokenResolver: (() => void) | undefined

describe('Mobile Deep Link Handling (Story 3.7)', () => {
  beforeAll(async () => {
    const apiBaseUrl =
      typeof window !== 'undefined' ? window.location.origin : 'https://mock-api.test'
    vi.stubEnv('EXPO_PUBLIC_API_BASE_URL', apiBaseUrl)
    process.env.EXPO_PUBLIC_API_BASE_URL = apiBaseUrl
    await initI18n()
  })

  afterAll(() => {
    vi.unstubAllEnvs()
  })

  beforeEach(() => {
    mockCapture.mockClear()
    mockSetParams.mockClear()
    mockPush.mockClear()
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-07-24T17:30:00.000Z'))
    restoreAccessTokenResolver = setMobileAccessTokenResolver(() => 'session-token')
    mockParams = {}
    server.use(
      http.get('*/api/v1/events/poll', () =>
        HttpResponse.json({
          events: [
            createWeatherAlertPolledEvent('alert-777', 'test-user-id'),
            createCommunityPolledEvent('look-42', 'test-user-id'),
          ],
          nextSince: '2026-07-24T17:29:00.000Z',
        })
      )
    )
  })

  afterEach(() => {
    restoreAccessTokenResolver?.()
    restoreAccessTokenResolver = undefined
    vi.restoreAllMocks()
    clearRitualMemoryCache()
    localStorage.clear()
  })

  it('3.7-UNIT-005: Focuses severe weather alert banner on severe_weather push notification', async () => {
    mockParams = {
      source: 'notification',
      type: 'severe_weather',
      alertId: 'alert-777',
    }

    await render(<TabOneScreen />)

    await waitFor(() => {
      expect(screen.getByTestId('severe-weather-alert-focused')).toBeTruthy()
    })
    expect(screen.getByText('A severe thunderstorm warning is active.')).toBeTruthy()

    expect(mockCapture).toHaveBeenCalledWith('deep_link_handled', {
      source: 'notification',
      type: 'severe_weather',
      alertId: 'alert-777',
      surface: 'mobile',
    })
  })

  it('3.7-UNIT-006: Renders InfoBanner and captures deep_link_invalid on malformed parameters', async () => {
    mockParams = {
      source: 'invalid_source',
      slot: 'bad_slot',
    }

    await render(<TabOneScreen />)

    await waitFor(() => {
      expect(screen.getByTestId('deep-link-info-banner')).toBeTruthy()
    })

    expect(mockCapture).toHaveBeenCalledWith(
      'deep_link_invalid',
      expect.objectContaining({
        surface: 'mobile',
      })
    )
  })

  it('3.7-UNIT-007: CommunityScreen highlights post card on community notification deep link', async () => {
    mockParams = {
      source: 'notification',
      type: 'community',
      cardId: 'look-42',
    }

    await render(<CommunityScreen />)

    await waitFor(() => {
      expect(screen.getByTestId('highlighted-community-card-look-42')).toBeTruthy()
    })

    expect(mockCapture).toHaveBeenCalledWith('deep_link_handled', {
      source: 'notification',
      type: 'community',
      cardId: 'look-42',
      surface: 'mobile',
    })
    expect(
      mockCapture.mock.calls.filter(([event]) => event === 'deep_link_handled')
    ).toHaveLength(1)
  })

  it('3.7-UNIT-008: CommunityScreen stays a plain tab when it is opened without a deep link', async () => {
    // The community tab is reachable from the tab bar, not only from a
    // notification, so an empty parameter set must not look like a failure.
    await render(<CommunityScreen />)

    expect(screen.getByTestId('community-screen')).toBeTruthy()
    expect(screen.queryByTestId('deep-link-info-banner')).toBeNull()
    expect(mockCapture).not.toHaveBeenCalled()
  })

  it('3.7-UNIT-009: CommunityScreen flags a community link with no card id and lets it be dismissed', async () => {
    mockParams = { source: 'notification', type: 'community' }

    await render(<CommunityScreen />)

    await waitFor(() => {
      expect(screen.getByTestId('deep-link-info-banner')).toBeTruthy()
    })
    expect(mockCapture).toHaveBeenCalledWith(
      'deep_link_invalid',
      expect.objectContaining({ surface: 'mobile' })
    )

    // The banner is advisory; the tab has to remain usable after dismissal.
    fireEvent.click(screen.getByLabelText('Dismiss banner'))
    await waitFor(() => {
      expect(screen.queryByTestId('deep-link-info-banner')).toBeNull()
    })
    expect(screen.getByTestId('community-screen')).toBeTruthy()
  })

  it('3.7-UNIT-010: CommunityScreen reports a community card that is no longer in the feed', async () => {
    mockParams = { source: 'notification', type: 'community', cardId: 'look-99' }
    server.use(
      http.get('*/api/v1/events/poll', () =>
        HttpResponse.json({
          events: [createCommunityPolledEvent('look-42', 'test-user-id')],
          nextSince: '2026-07-24T17:29:00.000Z',
        })
      )
    )

    await render(<CommunityScreen />)

    await waitFor(() => {
      expect(mockCapture).toHaveBeenCalledWith(
        'deep_link_invalid',
        expect.objectContaining({ reason: 'Community card target was not found' })
      )
    })
    expect(screen.queryByTestId('highlighted-community-card-look-99')).toBeNull()
  })

  it('3.7-UNIT-011: CommunityScreen reports a community card that could not be loaded', async () => {
    mockParams = { source: 'notification', type: 'community', cardId: 'look-42' }
    server.use(
      http.get('*/api/v1/events/poll', () => new HttpResponse(null, { status: 503 }))
    )

    await render(<CommunityScreen />)

    await waitFor(() => {
      expect(mockCapture).toHaveBeenCalledWith(
        'deep_link_invalid',
        expect.objectContaining({ reason: 'Community card target could not be loaded' })
      )
    })
  })

  it('3.7-UNIT-012: CommunityScreen falls back to generic copy for a card with no locale or climate band', async () => {
    mockParams = { source: 'notification', type: 'community', cardId: 'look-77' }
    server.use(
      http.get('*/api/v1/events/poll', () =>
        HttpResponse.json({
          events: [
            {
              id: 'event-look-77',
              channel: 'lookbook:new',
              userId: 'test-user-id',
              createdAt: '2026-07-30T12:00:00.000Z',
              payload: {
                version: '1',
                timestamp: '2026-07-30T12:00:00.000Z',
                userId: 'test-user-id',
                // locale and climateBand are optional on lookbook:new, so the
                // card has to read sensibly without them.
                data: { postId: 'look-77' },
              },
            },
          ],
          nextSince: '2026-07-24T17:29:00.000Z',
        })
      )
    )

    await render(<CommunityScreen />)

    await waitFor(() => {
      expect(screen.getByTestId('highlighted-community-card-look-77')).toBeTruthy()
    })
    expect(
      screen.getByTestId('highlighted-community-card-look-77').textContent
    ).toContain('All-weather look from the community')
  })
})
