/* eslint-disable @typescript-eslint/await-thenable */
// Covers the hero screen's degraded and native-only paths: a durable cache
// that refuses writes, a widget slot that maps to a named scenario, and the
// iOS accessibility-focus routes the web renderer never takes.
import React from 'react'
import type * as ReactNativeModule from 'react-native'
import type * as RitualCacheModule from '@/src/lib/ritual-cache'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { render } from 'vitest-browser-react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { AccessibilityInfo, Platform, findNodeHandle } from 'react-native'
import { createWeatherAlertPolledEvent } from '@couture/api-client/testing/deep-link-events'

const { NATIVE_NODE_HANDLE } = vi.hoisted(() => ({ NATIVE_NODE_HANDLE: 4242 }))

// react-native-web throws from findNodeHandle and no-ops setAccessibilityFocus,
// so the native focus routes can only be observed by standing in for both.
vi.mock('react-native', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactNativeModule>()
  return {
    ...actual,
    findNodeHandle: vi.fn(() => NATIVE_NODE_HANDLE),
    AccessibilityInfo: {
      ...actual.AccessibilityInfo,
      setAccessibilityFocus: vi.fn(),
    },
  }
})

let mockParams: Record<string, string> = {}
const mockSetParams = vi.fn()
const mockPush = vi.fn()

vi.mock('expo-router', () => ({
  useLocalSearchParams: () => mockParams,
  useRouter: () => ({ setParams: mockSetParams, push: mockPush }),
}))

vi.mock('expo-localization', () => ({
  getLocales: () => [{ languageTag: 'en-US', languageCode: 'en', regionCode: 'US' }],
}))

const mockCapture = vi.fn()
vi.mock('@/src/analytics/mobile-analytics', () => ({
  useMobileAnalytics: () => ({
    capture: mockCapture,
    getDistinctId: () => 'test-user-id',
    screen: vi.fn(),
  }),
  MobileAnalyticsDiagnosticsPanel: () => null,
}))

const { readLatestRitualCacheMock, saveRitualCacheMock } = vi.hoisted(() => ({
  readLatestRitualCacheMock: vi.fn(),
  saveRitualCacheMock: vi.fn(),
}))

// The durable cache is a storage boundary. Owning it here is what makes a
// failing write reproducible without corrupting real storage.
vi.mock('@/src/lib/ritual-cache', async (importOriginal) => {
  const actual = await importOriginal<typeof RitualCacheModule>()
  return {
    // `withoutShopThisLook` is a pure transform, not a storage boundary, so the
    // real one is kept: mocking it would hide the very stripping the screen is
    // supposed to perform before it writes.
    withoutShopThisLook: actual.withoutShopThisLook,
    readLatestRitualCache: readLatestRitualCacheMock,
    saveRitualCache: saveRitualCacheMock,
    clearRitualMemoryCache: () => undefined,
  }
})

import TabOneScreen from '@/app/(tabs)/index'
import { server } from '@/src/test-utils/msw/server'
import { mockRitualResponse } from '@/src/test-utils/msw/handlers'
import { setMobileAccessTokenResolver } from '@/src/lib/mobile-auth'
import { AccessibilityAnnouncerProvider } from '@/src/hooks/use-accessibility-announcer'
import i18n, { initI18n } from '@/src/lib/i18n'

function renderScreen() {
  return render(
    <AccessibilityAnnouncerProvider>
      <TabOneScreen />
    </AccessibilityAnnouncerProvider>
  )
}

describe('TabOneScreen degraded and native-only paths', () => {
  let restoreAccessTokenResolver: (() => void) | undefined

  beforeAll(async () => {
    process.env.EXPO_PUBLIC_API_BASE_URL =
      typeof window !== 'undefined' ? window.location.origin : 'https://mock-api.test'
    await initI18n()
  })

  beforeEach(async () => {
    mockParams = {}
    readLatestRitualCacheMock.mockResolvedValue(null)
    saveRitualCacheMock.mockResolvedValue(undefined)
    restoreAccessTokenResolver = setMobileAccessTokenResolver(() => 'session-token')
    await i18n.changeLanguage('en-US')
  })

  afterEach(() => {
    restoreAccessTokenResolver?.()
    restoreAccessTokenResolver = undefined
    Object.defineProperty(Platform, 'OS', { value: 'web', configurable: true })
    vi.clearAllMocks()
    vi.mocked(findNodeHandle).mockReturnValue(NATIVE_NODE_HANDLE)
  })

  it('3.3-MOB-HERO-17 still shows today’s ritual when the durable cache refuses the write', async () => {
    // Offline resilience is a nice-to-have; failing to persist it must never
    // cost the user the recommendation they already fetched.
    saveRitualCacheMock.mockRejectedValue(new Error('quota exceeded'))

    renderScreen()

    await waitFor(() => {
      expect(screen.getByText('Classic Trench Coat')).toBeTruthy()
    })
    expect(screen.queryByTestId('hero-error-state')).toBeNull()
    await waitFor(() => {
      expect(saveRitualCacheMock).toHaveBeenCalled()
    })
  })

  it('3.3-MOB-HERO-18 keeps a garment swap applied when the cache write fails', async () => {
    saveRitualCacheMock.mockRejectedValue(new Error('quota exceeded'))

    renderScreen()
    await waitFor(() => {
      expect(screen.getByText('Classic Trench Coat')).toBeTruthy()
    })

    fireEvent.click(screen.getByTestId('garment-tile-classic-trench-coat'))
    await waitFor(() => {
      expect(screen.getByTestId('garment-swap-modal')).toBeTruthy()
    })
    fireEvent.click(screen.getByTestId('swap-option-denim-jacket'))

    await waitFor(() => {
      expect(screen.getByTestId('garment-tile-denim-jacket')).toBeTruthy()
    })
    expect(mockCapture).toHaveBeenCalledWith(
      'hero_interaction',
      expect.objectContaining({ interactionType: 'garment_swap' })
    )
  })

  it('3.3-MOB-HERO-19 hydrates a named widget slot into its scenario', async () => {
    // now/next slots resolve against the clock; am/pm/evening name a scenario
    // outright and take a different branch of the widget handler.
    mockParams = { source: 'widget', size: 'small', slot: 'evening' }

    renderScreen()

    await waitFor(() => {
      expect(screen.getByTestId('garment-tile-crewneck-sweater')).toBeTruthy()
    })
    expect(mockCapture).toHaveBeenCalledWith(
      'hero_interaction',
      expect.objectContaining({ interactionType: 'widget_tap', slot: 'evening' })
    )
  })

  it('3.3-MOB-HERO-20 moves native accessibility focus to a deep-linked weather alert', async () => {
    // On iOS the alert is reached by measuring its layout and moving the
    // VoiceOver cursor, which is a completely different route from the web
    // renderer's element.focus().
    Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true })
    mockParams = { source: 'notification', type: 'severe_weather', alertId: 'alert-777' }
    server.use(
      http.get('*/api/v1/events/poll', () =>
        HttpResponse.json({
          events: [createWeatherAlertPolledEvent('alert-777', 'test-user-id')],
          nextSince: '2026-07-24T17:29:00.000Z',
        })
      )
    )

    renderScreen()

    await waitFor(() => {
      expect(screen.getByTestId('severe-weather-alert-focused')).toBeTruthy()
    })
    expect(screen.getByText('A severe thunderstorm warning is active.')).toBeTruthy()
    await waitFor(() => {
      expect(AccessibilityInfo.setAccessibilityFocus).toHaveBeenCalledWith(
        NATIVE_NODE_HANDLE
      )
    })
  })

  it('3.3-MOB-HERO-21 moves native accessibility focus into the swap sheet', async () => {
    Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true })

    renderScreen()
    await waitFor(() => {
      expect(screen.getByText('Classic Trench Coat')).toBeTruthy()
    })

    fireEvent.click(screen.getByTestId('garment-tile-classic-trench-coat'))

    await waitFor(() => {
      expect(screen.getByTestId('garment-swap-modal')).toBeTruthy()
    })
    await waitFor(() => {
      expect(AccessibilityInfo.setAccessibilityFocus).toHaveBeenCalledWith(
        NATIVE_NODE_HANDLE
      )
    })
    // The sheet must still be dismissible after the native focus attempt.
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => {
      expect(screen.queryByTestId('garment-swap-modal')).toBeNull()
    })
  })

  it('3.3-MOB-HERO-22 ignores a superseded ritual load that fails after a newer one succeeded', async () => {
    // Switching language starts a second load. If the first one then fails,
    // its error must not replace the recommendations already on screen --
    // otherwise a slow, dead request retroactively blanks a good render.
    let releaseSupersededLoad: () => void = () => undefined
    let supersededLoadAnswered = false
    const supersededLoadGate = new Promise<void>((resolve) => {
      releaseSupersededLoad = resolve
    })
    server.use(
      http.get('*/api/v1/ritual', async ({ request }) => {
        if (new URL(request.url).searchParams.get('locale') === 'en-US') {
          await supersededLoadGate
          supersededLoadAnswered = true
          return new HttpResponse(null, { status: 503 })
        }
        return HttpResponse.json(mockRitualResponse)
      })
    )

    renderScreen()
    await act(async () => {
      await i18n.changeLanguage('tr-TR')
    })
    await waitFor(() => {
      expect(screen.getByText('Classic Trench Coat')).toBeTruthy()
    })

    releaseSupersededLoad()
    await waitFor(() => {
      expect(supersededLoadAnswered).toBe(true)
    })

    expect(screen.queryByTestId('hero-error-state')).toBeNull()
    expect(screen.getByText('Classic Trench Coat')).toBeTruthy()
  })
})
