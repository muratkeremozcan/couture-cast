/* eslint-disable @typescript-eslint/await-thenable */
// Story 3.7 Task 5 step 2 owner: unit-test mobile deep-link hydration, severe weather alert focus, and community card highlight
import React from 'react'
import { screen, waitFor } from '@testing-library/react'
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
})
