// Learning path Step 21: Reasoning badges and explanations.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-21-reasoning-badges-and-explanations
// Learning path Step 26: Chip navigation and sticky bottom nav.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-26-chip-navigation-and-sticky-bottom-nav
// Learning path Step 68: Five-tab navigation and back pattern.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-68-five-tab-navigation-and-back-pattern
// Story CC-7.11 test owner (TEA): [Codex 7.11 #3], 7.11-NAT-032: the swap sheet title is the
// layer's swipe handle; a swipe closes it like Back, keeps the garment and refocuses the tile.
// Test design: _bmad-output/test-artifacts/test-design-7-11-five-tab-navigation-back-pattern.md.
import type * as FocusEffectModule from '@/src/test-utils/focus-effect'
import type * as ReactNativeModule from 'react-native'
import React from 'react'
import { screen, fireEvent, waitFor, within } from '@testing-library/react'
import { render } from 'vitest-browser-react'
import { describe, expect, it, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
import { server } from '@/src/test-utils/msw/server'
import { http, HttpResponse } from 'msw'
import TabOneScreen from '@/app/(tabs)/index'
import { AccessibilityInfo, NativeModules, Platform, findNodeHandle } from 'react-native'
import { registerShareCardHeading } from '@/src/lib/share-card-focus'
import { AndroidShareCardPresentation } from '@/components/android-share-card-presentation'
import {
  setMobileAccessTokenResolver,
  setMobileApplicationUserId,
} from '@/src/lib/mobile-auth'
import {
  clearRitualMemoryCache,
  ritualCacheOwner,
  saveRitualCache,
} from '@/src/lib/ritual-cache'
import { mockRitualResponse } from '@/src/test-utils/msw/handlers'
import i18n, { initI18n } from '@/src/lib/i18n'
import { failOnConsoleWarnOrError } from '@/src/test-utils/console-guard'
import { dragFrom } from '@/src/test-utils/layer-swipe'
import { LAYER_SWIPE_CLOSE_PX } from '@/components/edge-to-edge-modal'

const mockRouter = { setParams: vi.fn() }

vi.mock('expo-localization', () => ({
  getLocales: () => [{ languageTag: 'en-US', languageCode: 'en', regionCode: 'US' }],
}))

vi.mock('expo-router', async () => ({
  useLocalSearchParams: () => ({}),
  useRouter: () => mockRouter,
  useFocusEffect: (
    await vi.importActual<typeof FocusEffectModule>('@/src/test-utils/focus-effect')
  ).useFocusEffect,
}))

// The Android case runs on react-native-web, whose findNodeHandle always throws. React
// Native's Fabric renderer returns the native tag of a host instance instead, so the
// simulated platform gets that behavior and safeFindNodeHandle runs unmocked.
vi.mock('react-native', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactNativeModule>()
  const tags = new WeakMap<object, number>()
  let nextTag = 900
  return {
    ...actual,
    findNodeHandle: (node: unknown) => {
      if (!node || typeof node !== 'object') return null
      if (!tags.has(node)) tags.set(node, nextTag++)
      return tags.get(node) ?? null
    },
  }
})

// The Android case sends the ritual cache down its native file path. The real module
// needs Expo's native globals, which a browser run lacks, so it is replaced here.
vi.mock('expo-file-system/legacy', async () => {
  const { nativeStorageMocks } = await import('../test-utils/persisted-writes.js')
  return nativeStorageMocks.legacyFileSystem
})

vi.mock('@/src/lib/use-share-card-status-bar', () => ({
  useShareCardStatusBar: () => true,
}))

const { mockCapture, mockGetDistinctId } = vi.hoisted(() => ({
  mockCapture: vi.fn(),
  mockGetDistinctId: vi.fn(() => 'test-user-id'),
}))
vi.mock('@/src/analytics/mobile-analytics', async () =>
  (await import('@/src/test-utils/mobile-analytics.js')).mobileAnalyticsModuleMock({
    capture: mockCapture,
    getDistinctId: mockGetDistinctId,
  })
)

describe('Mobile Hero Experience (TabOneScreen)', () => {
  failOnConsoleWarnOrError()

  it('L8: the hero content adds no share-card heading of its own', async () => {
    await render(<TabOneScreen />)
    await screen.findByTestId('weather-header')
    expect(
      screen.queryByRole('heading', { name: i18n.t('shareCard.sourceOutfit') })
    ).toBeNull()
  })

  it('L8: closing the composer without an invoker node focuses the registered navigation heading', async () => {
    const setFocus = vi.spyOn(AccessibilityInfo, 'setAccessibilityFocus')
    // The tab layout registers its title this way; 77 stands in for its native tag.
    const unregister = registerShareCardHeading('outfit', () => 77)
    try {
      await render(<TabOneScreen />)
      await userEvent.click(await screen.findByTestId('today-outfit-details'))
      await userEvent.click(await screen.findByTestId('outfit-share-card-open'))
      await waitFor(() => expect(screen.getByTestId('share-card-title')).toBeVisible())
      setFocus.mockClear()
      await userEvent.click(screen.getByTestId('share-card-cancel'))
      await waitFor(() => expect(setFocus).toHaveBeenCalledWith(77))
    } finally {
      unregister()
    }
  })

  beforeAll(async () => {
    process.env.EXPO_PUBLIC_API_BASE_URL =
      typeof window !== 'undefined' ? window.location.origin : 'https://mock-api.test'
    await initI18n()
  })

  beforeEach(async () => {
    setMobileAccessTokenResolver(() => 'session-token')
    // Set after the auto-cleanup unmounted the previous screen; changing identity while a
    // screen is mounted reloads it and leaks a request into this test.
    setMobileApplicationUserId('test-member')
    await i18n.changeLanguage('en-US')
  })

  afterEach(() => {
    vi.clearAllMocks()
    clearRitualMemoryCache()
    localStorage.clear()
  })

  it('Android null-member token session opens the outfit share-card composer', async () => {
    const previousPlatform = Platform.OS
    Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true })
    // A real Android build ships the widget bridge the ritual cache publishes through.
    const setWidgetData = vi.fn((_payload: string) => Promise.resolve())
    NativeModules.WidgetSharedModule = { setWidgetData }
    const setFocus = vi.spyOn(AccessibilityInfo, 'setAccessibilityFocus')
    setMobileApplicationUserId(null)
    try {
      await render(
        <AndroidShareCardPresentation pathname="/">
          <TabOneScreen />
        </AndroidShareCardPresentation>
      )
      await userEvent.click(await screen.findByTestId('today-outfit-details'))
      const opener = await screen.findByTestId('outfit-share-card-open')
      await userEvent.click(opener)
      await waitFor(() => expect(screen.getByTestId('share-card-title')).toBeVisible())
      setFocus.mockClear()
      await userEvent.click(screen.getByTestId('share-card-cancel'))
      await waitFor(() =>
        expect(screen.queryByTestId('share-card-title')).not.toBeInTheDocument()
      )
      // No heading is registered, so focus on the opener's tag proves the Cancel restore
      // resolved it through the unmocked safeFindNodeHandle.
      // react-native-web hands host refs out as DOM nodes, so the opener is its own host.
      const openerTag = findNodeHandle(opener as never)
      expect(openerTag).toEqual(expect.any(Number))
      await waitFor(() => expect(setFocus).toHaveBeenLastCalledWith(openerTag))
      await waitFor(() => expect(setWidgetData).toHaveBeenCalledOnce())
    } finally {
      delete NativeModules.WidgetSharedModule
      Object.defineProperty(Platform, 'OS', {
        value: previousPlatform,
        configurable: true,
      })
    }
  })

  // Story CC-7.7 D2 (7.7-NAT-002): the member sample no longer shows while loading; the gate's
  // placeholder holds the body until the ritual read settles.
  it('shows the placeholder while loading, then current weather and a live outfit with collapsed details', async () => {
    await render(<TabOneScreen />)

    expect(screen.getByTestId('screen-placeholder')).toBeVisible()
    expect(screen.queryByTestId('member-sample-outfit')).toBeNull()
    expect(screen.queryByTestId('weather-header')).toBeNull()

    await waitFor(() => {
      expect(screen.getByTestId('weather-header')).toBeTruthy()
    })
    expect(screen.queryByTestId('member-sample-outfit')).toBeNull()

    expect(screen.getByTestId('weather-header')).toHaveAttribute(
      'aria-label',
      'Clear Sky and 70 degrees Fahrenheit'
    )

    expect(screen.getByTestId('current-temperature').textContent).toBe('70°F')
    expect(screen.getByText('Clear Sky')).toBeTruthy()

    expect(screen.queryByTestId('hourly-forecast-ribbon')).toBeNull()
    await userEvent.click(await screen.findByTestId('today-outfit-details'))

    expect(
      screen.getByText('Mild morning with gentle winds. Trench coat recommended.')
    ).toBeTruthy()

    expect(screen.getByTestId('today-outfit-slot-0')).toHaveAccessibleName(
      /swap.*outer layer.*trench coat/i
    )

    expect(screen.getByText('Breeze Guard')).toBeTruthy()

    expect(mockCapture).toHaveBeenCalledWith('tab_one_viewed')
    expect(mockCapture).toHaveBeenCalledWith('ritual_created', expect.any(Object))
  })

  it('verifies scenario switching updates the displayed outfit card and triggers telemetry', async () => {
    await render(<TabOneScreen />)

    await waitFor(() => {
      expect(screen.getByTestId('weather-header')).toBeTruthy()
    })

    await userEvent.click(await screen.findByTestId('today-outfit-details'))
    fireEvent.click(screen.getByTestId('scenario-picker'))
    const eveningToggle = screen.getByTestId('scenario-toggle-evening')
    fireEvent.click(eveningToggle)

    expect(screen.getByText('Cool evening ahead. Sweater recommended.')).toBeTruthy()
    expect(screen.getByTestId('today-outfit-slot-0')).toHaveAccessibleName(
      /merino sweater/i
    )

    // Asserted with `toHaveBeenCalledWith`: the morning card's affiliate impression
    // is emitted from a passive effect that can flush after this click, so the order
    // of the two is not a contract.
    expect(mockCapture).toHaveBeenCalledWith('hero_interaction', {
      interactionType: 'scenario_toggle',
      scenario: 'evening',
    })
  })

  it('toggling hourly weather records the open interaction', async () => {
    const weatherSnapshot = mockRitualResponse.data.weather
    server.use(
      http.get('*/api/v1/ritual', () =>
        HttpResponse.json({
          data: {
            ...mockRitualResponse.data,
            weather: {
              ...weatherSnapshot,
              hourly: weatherSnapshot.hourly.map((hour, index) => {
                if (index === 0) {
                  return { ...hour, condition: 'snow', precipitationProbability: 0.8 }
                }
                if (index === 1) {
                  return { ...hour, condition: 'clear', precipitationProbability: 0.004 }
                }
                return hour
              }),
            },
          },
        })
      )
    )
    await render(<TabOneScreen />)
    const weather = await screen.findByTestId('weather-header')
    await userEvent.click(weather)
    const hours = screen.getAllByTestId('hourly-item')
    expect(hours).toHaveLength(48)
    const [snow, nearZero] = hours
    expect(snow).toHaveAccessibleName(/Snowy.*Rain or snow looks likely/i)
    expect(within(snow!).getByText('Rain or snow looks likely')).toBeVisible()
    expect(nearZero).toHaveAccessibleName(/Dry weather/i)
    expect(within(nearZero!).queryByText(/Rain or snow/)).toBeNull()
    expect(mockCapture).toHaveBeenCalledWith('hero_interaction', {
      interactionType: 'ribbon_toggle',
      isExpanded: true,
    })
    await userEvent.click(weather)
    expect(screen.queryByTestId('hourly-forecast-ribbon')).toBeNull()
  })

  it('verifies garment swap modal flows and updates garment state with telemetry', async () => {
    await render(<TabOneScreen />)

    await waitFor(() => {
      expect(screen.getByTestId('today-outfit-slot-0')).toHaveAccessibleName(
        /trench coat/i
      )
    })

    const swapButton = screen.getByTestId('today-outfit-slot-0')
    swapButton.focus()
    fireEvent.click(swapButton)

    expect(screen.getByTestId('today-outfit-swap')).toBeTruthy()
    expect(screen.getByTestId('today-outfit-swap')).toHaveAttribute('role', 'dialog')
    expect(screen.getByTestId('today-outfit-swap')).toHaveAttribute('aria-modal', 'true')
    expect(screen.getByText(/swap.*outer layer/i)).toBeTruthy()

    await waitFor(() => {
      expect(screen.getByTestId('today-outfit-swap-option-0')).toHaveFocus()
    })

    const denimJacketOption = screen.getByTestId('today-outfit-swap-option-1')
    expect(denimJacketOption).toHaveAccessibleName(/denim jacket/i)
    fireEvent.click(denimJacketOption)

    await waitFor(() => expect(screen.queryByTestId('today-outfit-swap')).toBeNull())
    await waitFor(() => expect(swapButton).toHaveFocus())
    expect(swapButton).toHaveAccessibleName(/denim jacket/i)
    expect(mockCapture).toHaveBeenCalledWith('hero_interaction', {
      interactionType: 'garment_swap',
      scenario: 'morning',
      itemId: 'sample:g:denim-jacket',
    })
  })

  it('[Codex 7.11 #3] [7.11-NAT-032] a swipe down on the swap sheet title closes it, keeps the garment and refocuses its tile', async () => {
    await render(<TabOneScreen />)
    await screen.findByTestId('today-outfit-slot-0')

    const swapButton = screen.getByTestId('today-outfit-slot-0')
    swapButton.focus()
    fireEvent.click(swapButton)
    const sheet = screen.getByTestId('today-outfit-swap')
    const title = screen.getByRole('heading', { name: /swap the outer layer/i })
    expect(sheet.contains(title)).toBe(true)
    const handle = title.closest<HTMLElement>('[data-testid="layer-swipe-handle"]')
    expect(handle, 'the title sits in the swipe handle').not.toBeNull()
    await waitFor(() =>
      expect(screen.getByTestId('today-outfit-swap-option-0')).toHaveFocus()
    )
    mockCapture.mockClear()

    await dragFrom(title, { dy: LAYER_SWIPE_CLOSE_PX / 2 })
    expect(screen.getByTestId('today-outfit-swap')).toBeTruthy()

    await dragFrom(title, { dy: LAYER_SWIPE_CLOSE_PX + 40 })
    await waitFor(() => expect(screen.queryByTestId('today-outfit-swap')).toBeNull())
    // Closed without a choice: the garment stays and no swap is recorded.
    expect(screen.getByTestId('today-outfit-slot-0')).toHaveAccessibleName(/trench coat/i)
    expect(screen.getByTestId('today-outfit-slot-0')).not.toHaveAccessibleName(
      /denim jacket/i
    )
    expect(mockCapture).not.toHaveBeenCalledWith(
      'hero_interaction',
      expect.objectContaining({ interactionType: 'garment_swap' })
    )
    // D13: the tile that opened the sheet takes focus back (returnFocusRef).
    await waitFor(() => expect(screen.getByTestId('today-outfit-slot-0')).toHaveFocus())
  })

  it('verifies offline fallback banner and stale state display when API request fails', async () => {
    // Older than the 15-minute freshness window.
    await saveRitualCache(ritualCacheOwner('test-member'), 'en-US', {
      data: mockRitualResponse,
      timestamp: Date.now() - 20 * 60 * 1000, // 20 minutes ago (stale!)
    })

    server.use(
      http.get('*/api/v1/ritual', () => {
        return new HttpResponse(null, { status: 500 })
      })
    )

    await render(<TabOneScreen />)

    await waitFor(() => {
      expect(screen.getByTestId('stale-cache-banner')).toBeTruthy()
    })
    expect(screen.getByText('Using recently cached weather data')).toBeTruthy()
    expect(screen.getByTestId('today-outfit-slot-0')).toHaveAccessibleName(/trench coat/i)
  })

  it('renders a complete retry state when recommendations cannot be loaded', async () => {
    server.use(
      http.get('*/api/v1/ritual', () => {
        return new HttpResponse(null, { status: 500 })
      })
    )

    await render(<TabOneScreen />)

    // maestro/network-timeout/dev-client-timeout.yaml taps Retry by this id.
    const retry = await screen.findByRole('button', { name: 'Try again' })
    expect(retry).toHaveAttribute('data-testid', 'hero-retry')
    expect(screen.getByTestId('member-sample-outfit')).toBeVisible()
    expect(screen.getByTestId('home-set-city')).toBeVisible()
    expect(screen.queryByTestId('weather-header-skeleton')).toBeNull()
    expect(screen.queryByTestId('outfit-recommendation-card-skeleton')).toBeNull()
  })

  it('requests and renders the active locale across the hero experience', async () => {
    await i18n.changeLanguage('tr-TR')
    let requestedLocale: string | null = null
    server.use(
      http.get('*/api/v1/ritual', ({ request }) => {
        requestedLocale = new URL(request.url).searchParams.get('locale')
        return HttpResponse.json(mockRitualResponse)
      })
    )

    await render(<TabOneScreen />)

    await waitFor(() => {
      expect(screen.getByTestId('weather-header')).toBeTruthy()
    })
    expect(requestedLocale).toBe('tr-TR')
    expect(screen.getByText('Açık')).toBeTruthy()
    await userEvent.click(screen.getByTestId('weather-header'))
    expect(screen.getByText('Saatlik hava durumu')).toBeTruthy()
  })

  it('renders localized API fixtures selected by the locale query parameter', async () => {
    await i18n.changeLanguage('tr-TR')

    await render(<TabOneScreen />)

    await userEvent.click(await screen.findByTestId('today-outfit-details'))
    await waitFor(() => {
      expect(
        screen.getByText('Hafif rüzgarlı serin sabah. Trençkot önerilir.')
      ).toBeTruthy()
    })
    expect(screen.getByText('Rüzgarlık')).toBeTruthy()
  })

  it('uses the resolved supported locale for temperature formatting', async () => {
    await i18n.changeLanguage('en')

    await render(<TabOneScreen />)

    await waitFor(() => {
      expect(screen.getByTestId('current-temperature').textContent).toBe('70°F')
    })
  })

  it('displays Merlot warning banner when weather alerts are active', async () => {
    server.use(
      http.get('*/api/v1/ritual', () => {
        return HttpResponse.json({
          ...mockRitualResponse,
          data: {
            ...mockRitualResponse.data,
            weather: {
              ...mockRitualResponse.data.weather,
              alerts: [
                {
                  event: 'Severe Wind Advisory',
                  description: 'High winds expected up to 50mph.',
                  start: '2026-07-22T00:00:00.000Z',
                  end: '2026-07-22T06:00:00.000Z',
                  severity: 'high',
                },
              ],
            },
          },
        })
      })
    )

    await render(<TabOneScreen />)

    await waitFor(() => {
      expect(screen.getByTestId('weather-alert-banner')).toBeTruthy()
    })
    expect(screen.getByText('Severe Wind Advisory')).toBeTruthy()
    expect(screen.getByText('High winds expected up to 50mph.')).toBeTruthy()
    expect(screen.getByTestId('weather-alert-banner')).toHaveAttribute('role', 'alert')
    expect(screen.getByTestId('weather-alert-banner')).toHaveAttribute(
      'aria-live',
      'assertive'
    )
  })
})
