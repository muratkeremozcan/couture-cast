/* eslint-disable @typescript-eslint/await-thenable */
import React from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { render } from 'vitest-browser-react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'

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
const mockGetDistinctId = vi.fn(() => 'test-user-id')
vi.mock('@/src/analytics/mobile-analytics', () => ({
  useMobileAnalytics: () => ({
    capture: mockCapture,
    getDistinctId: mockGetDistinctId,
    screen: vi.fn(),
  }),
  MobileAnalyticsDiagnosticsPanel: () => null,
}))

import TabOneScreen from '@/app/(tabs)/index'
import { server } from '@/src/test-utils/msw/server'
import { mockRitualResponse } from '@/src/test-utils/msw/handlers'
import { setMobileAccessTokenResolver } from '@/src/lib/mobile-auth'
import { clearRitualMemoryCache, saveRitualCache } from '@/src/lib/ritual-cache'
import { AccessibilityAnnouncerProvider } from '@/src/hooks/use-accessibility-announcer'
import i18n, { initI18n } from '@/src/lib/i18n'

/** Every `/api/v1/ritual` request the screen issued during a test. */
let ritualRequestCount = 0

function countingRitualHandler() {
  return http.get('*/api/v1/ritual', () => {
    ritualRequestCount += 1
    return HttpResponse.json(mockRitualResponse)
  })
}

/**
 * The screen reads the announcer through context, so the live region only
 * exists when the provider wraps it -- the same composition `app/_layout.tsx`
 * ships.
 */
function renderScreen() {
  return render(
    <AccessibilityAnnouncerProvider>
      <TabOneScreen />
    </AccessibilityAnnouncerProvider>
  )
}

describe('TabOneScreen cache, recovery, and deep-link routing', () => {
  let restoreAccessTokenResolver: (() => void) | undefined

  beforeAll(async () => {
    process.env.EXPO_PUBLIC_API_BASE_URL =
      typeof window !== 'undefined' ? window.location.origin : 'https://mock-api.test'
    await initI18n()
  })

  beforeEach(async () => {
    mockParams = {}
    ritualRequestCount = 0
    mockGetDistinctId.mockReturnValue('test-user-id')
    restoreAccessTokenResolver = setMobileAccessTokenResolver(() => 'session-token')
    server.use(countingRitualHandler())
    await i18n.changeLanguage('en-US')
  })

  afterEach(() => {
    restoreAccessTokenResolver?.()
    restoreAccessTokenResolver = undefined
    vi.clearAllMocks()
    clearRitualMemoryCache()
    localStorage.clear()
  })

  it('3.3-MOB-HERO-10 serves a cache younger than 15 minutes without touching the network', async () => {
    await saveRitualCache('test-user-id', 'en-US', {
      data: mockRitualResponse,
      timestamp: Date.now(),
    })

    renderScreen()

    await waitFor(() => {
      expect(screen.getByText('Classic Trench Coat')).toBeTruthy()
    })
    expect(ritualRequestCount).toBe(0)
    // `ritual_created` marks a freshly generated ritual; emitting it from a
    // cache replay would inflate the daily-ritual funnel with re-opens.
    expect(mockCapture).not.toHaveBeenCalledWith('ritual_created', expect.anything())
    expect(screen.queryByTestId('stale-cache-banner')).toBeNull()
  })

  it('3.3-MOB-HERO-11 scopes the cache to an anonymous identity when analytics has no distinct id', async () => {
    mockGetDistinctId.mockReturnValue('')
    await saveRitualCache('mobile-anonymous-user', 'en-US', {
      data: mockRitualResponse,
      timestamp: Date.now(),
    })

    renderScreen()

    await waitFor(() => {
      expect(screen.getByText('Classic Trench Coat')).toBeTruthy()
    })
    // A signed-out user still gets the offline ritual; without the fallback id
    // the cache key would be `ritual::en-US:...` and never match on re-open.
    expect(ritualRequestCount).toBe(0)
  })

  it('3.3-MOB-HERO-12 refetches after the cache passes 15 minutes', async () => {
    await saveRitualCache('test-user-id', 'en-US', {
      data: mockRitualResponse,
      timestamp: Date.now() - 16 * 60 * 1000,
    })

    renderScreen()

    await waitFor(() => {
      expect(ritualRequestCount).toBe(1)
    })
    // A successful refresh is not a degraded read, so the offline notice must
    // stay hidden even though a stale entry existed.
    expect(screen.queryByTestId('stale-cache-banner')).toBeNull()
  })

  it('3.3-MOB-HERO-13 recovers from the error state via Retry and announces the refreshed conditions', async () => {
    server.use(http.get('*/api/v1/ritual', () => new HttpResponse(null, { status: 500 })))

    renderScreen()
    await waitFor(() => {
      expect(screen.getByTestId('hero-error-state')).toBeTruthy()
    })

    server.use(countingRitualHandler())
    fireEvent.click(screen.getByText('Retry'))

    await waitFor(() => {
      expect(screen.getByTestId('weather-header')).toBeTruthy()
    })
    expect(screen.queryByTestId('hero-error-state')).toBeNull()
    // Only a user-initiated refresh announces; the initial load must stay
    // silent or every app open would interrupt a screen reader.
    await waitFor(() => {
      expect(document.getElementById('a11y-live-announcer')?.textContent).toBe(
        'Daily guidance updated: Clear Sky'
      )
    })
  })

  it('3.3-MOB-HERO-14 hands a community notification to the community route without clearing its params', async () => {
    mockParams = { source: 'notification', type: 'community', cardId: 'look-42' }

    renderScreen()

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith({
        pathname: '/community',
        params: { source: 'notification', type: 'community', cardId: 'look-42' },
      })
    })
    // Clearing the params here would strip the card id off the navigation the
    // community tab is about to read.
    expect(mockSetParams).not.toHaveBeenCalled()
  })

  it('3.3-MOB-HERO-15 lets the user dismiss the invalid deep-link banner', async () => {
    mockParams = { source: 'invalid_source', slot: 'bad_slot' }

    renderScreen()
    await waitFor(() => {
      expect(screen.getByTestId('deep-link-info-banner')).toBeTruthy()
    })

    fireEvent.click(screen.getByLabelText('Dismiss banner'))

    await waitFor(() => {
      expect(screen.queryByTestId('deep-link-info-banner')).toBeNull()
    })
    // The banner is dismissed for good, not re-raised by the next render pass.
    expect(screen.getByTestId('hero-experience-scrollview')).toBeTruthy()
  })

  it('3.3-MOB-HERO-16 returns focus to the garment that opened the swap sheet when it is cancelled', async () => {
    renderScreen()
    await waitFor(() => {
      expect(screen.getByText('Classic Trench Coat')).toBeTruthy()
    })

    const tile = screen.getByTestId('garment-tile-classic-trench-coat')
    tile.focus()
    fireEvent.click(tile)
    await waitFor(() => {
      expect(screen.getByTestId('garment-swap-modal')).toBeTruthy()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    await waitFor(() => {
      expect(screen.queryByTestId('garment-swap-modal')).toBeNull()
    })
    // Dropping focus to the document body after a dismissed sheet strands a
    // keyboard or screen-reader user at the top of the page.
    await waitFor(() => {
      expect(screen.getByTestId('garment-tile-classic-trench-coat')).toHaveFocus()
    })
    // Cancelling must not mutate the outfit.
    expect(screen.getByText('Classic Trench Coat')).toBeTruthy()
    expect(mockCapture).not.toHaveBeenCalledWith(
      'hero_interaction',
      expect.objectContaining({ interactionType: 'garment_swap' })
    )
  })
})
