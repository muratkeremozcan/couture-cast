// Learning path Step 21: Reasoning badges and explanations.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-21-reasoning-badges-and-explanations
// Learning path Step 26: Chip navigation and sticky bottom nav.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-26-chip-navigation-and-sticky-bottom-nav
import type * as FocusEffectModule from '@/src/test-utils/focus-effect'
import type * as ReactNativeModule from 'react-native'
import React from 'react'
import { act, screen, fireEvent, waitFor } from '@testing-library/react'
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
      await userEvent.click(await screen.findByTestId('outfit-share-card-open'))
      expect(await screen.findByTestId('share-card-title')).toBeVisible()
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
      const opener = await screen.findByTestId('outfit-share-card-open')
      await userEvent.click(opener)
      expect(await screen.findByTestId('share-card-title')).toBeVisible()
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

  it('displays skeleton state while loading and then loads current weather, 48-hour ribbon, and morning outfit card', async () => {
    await render(<TabOneScreen />)

    expect(screen.getByTestId('weather-header-skeleton')).toBeTruthy()
    expect(screen.getByTestId('hourly-forecast-ribbon-skeleton')).toBeTruthy()
    expect(screen.getByTestId('outfit-recommendation-card-skeleton')).toBeTruthy()

    await waitFor(() => {
      expect(screen.getByTestId('weather-header')).toBeTruthy()
    })

    expect(screen.getByTestId('weather-header')).toHaveAttribute(
      'aria-label',
      'Clear Sky and 70 degrees Fahrenheit'
    )

    expect(screen.getByTestId('current-temperature').textContent).toBe('70°F')
    expect(screen.getByText('Clear Sky')).toBeTruthy()

    expect(screen.getByTestId('hourly-forecast-ribbon')).toBeTruthy()
    const hourlyItems = screen.getAllByTestId('hourly-item')
    expect(hourlyItems.length).toBe(8)

    expect(
      screen.getByText('Mild morning with gentle winds. Trench coat recommended.')
    ).toBeTruthy()

    expect(screen.getByText('Classic Trench Coat')).toBeTruthy()
    expect(screen.getByText('Navy Chinos')).toBeTruthy()
    expect(screen.getByTestId('garment-tile-classic-trench-coat')).toHaveAttribute(
      'aria-label',
      'Classic Trench Coat: outerwear'
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

    const eveningToggle = screen.getByTestId('scenario-toggle-evening')
    fireEvent.click(eveningToggle)

    expect(screen.getByText('Cool evening ahead. Sweater recommended.')).toBeTruthy()
    expect(screen.getByText('Crewneck Sweater')).toBeTruthy()

    // Asserted with `toHaveBeenCalledWith`: the morning card's affiliate impression
    // is emitted from a passive effect that can flush after this click, so the order
    // of the two is not a contract.
    expect(mockCapture).toHaveBeenCalledWith('hero_interaction', {
      interactionType: 'scenario_toggle',
      scenario: 'evening',
    })
  })

  it('keeps mobile chip selection synchronized with the displayed recommendation', async () => {
    await render(<TabOneScreen />)

    await waitFor(() => {
      expect(
        screen.getByText('Mild morning with gentle winds. Trench coat recommended.')
      ).toBeTruthy()
    })

    fireEvent.click(screen.getByTestId('chip-sponsored'))

    expect(screen.getByText('Cool evening ahead. Sweater recommended.')).toBeTruthy()
    expect(screen.getByTestId('chip-sponsored').getAttribute('aria-selected')).toBe(
      'true'
    )
    expect(mockCapture).toHaveBeenCalledWith('chip_changed', {
      chipCategory: 'Sponsored',
      previousCategory: 'Personal',
      surface: 'mobile',
    })
  })

  it('verifies hourly ribbon expands and collapses and triggers telemetry', async () => {
    await render(<TabOneScreen />)

    await waitFor(() => {
      expect(screen.getByTestId('weather-header')).toBeTruthy()
    })

    const expandButton = screen.getByTestId('ribbon-expand-toggle')
    expect(expandButton.textContent).toBe('Expand (48h)')

    fireEvent.click(expandButton)

    expect(screen.getAllByTestId('hourly-item').length).toBe(48)
    expect(expandButton.textContent).toBe('Collapse')

    expect(mockCapture).toHaveBeenCalledWith('hero_interaction', {
      interactionType: 'ribbon_toggle',
      isExpanded: true,
    })

    fireEvent.click(expandButton)
    expect(screen.getAllByTestId('hourly-item').length).toBe(8)
  })

  it('centers the hourly ribbon toggle label inside its 44-point target', async () => {
    await render(<TabOneScreen />)
    const toggle = await screen.findByTestId('ribbon-expand-toggle')
    expect(toggle).toHaveAttribute('role', 'button')
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    const box = toggle.getBoundingClientRect()
    const label = screen.getByText('Expand (48h)').getBoundingClientRect()
    expect(box.height).toBeGreaterThanOrEqual(44)
    expect(label.top - box.top).toBeCloseTo(box.bottom - label.bottom, 0)
    expect(label.left - box.left).toBeCloseTo(box.right - label.right, 0)
  })

  it('verifies garment swap modal flows and updates garment state with telemetry', async () => {
    await render(<TabOneScreen />)

    await waitFor(() => {
      expect(screen.getByText('Classic Trench Coat')).toBeTruthy()
    })

    const swapButton = screen.getByTestId('garment-tile-classic-trench-coat')
    swapButton.focus()
    fireEvent.click(swapButton)

    expect(screen.getByTestId('garment-swap-modal')).toBeTruthy()
    expect(screen.getByTestId('garment-swap-modal')).toHaveAttribute('role', 'dialog')
    expect(screen.getByTestId('garment-swap-modal')).toHaveAttribute('aria-modal', 'true')
    expect(screen.getByText(/Choose alternate outerwear/i)).toBeTruthy()

    await waitFor(() => {
      expect(screen.getByTestId('swap-option-classic-trench-coat')).toHaveFocus()
    })

    const leatherJacketOption = screen.getByTestId('swap-option-leather-jacket')
    // Focus returns on a 400 ms timer after the modal closes; fake time removes the race.
    const focusReturnDelayMs = 400
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      fireEvent.click(leatherJacketOption)

      expect(screen.queryByText('Classic Trench Coat')).toBeNull()
      expect(screen.getByText('Leather Jacket')).toBeTruthy()
      // The modal leaves on its real exit animation; only the app's focus timer is faked.
      // expect.poll and vi.waitFor advance fake timers between retries, which would fire
      // that timer early, so the exit is awaited on real animation frames instead.
      for (
        let frames = 0;
        frames < 300 && screen.queryByTestId('garment-swap-modal');
        frames += 1
      ) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      }
      expect(screen.queryByTestId('garment-swap-modal')).toBeNull()
      await act(async () => {
        await vi.advanceTimersByTimeAsync(focusReturnDelayMs - 1)
      })
      expect(screen.getByTestId('garment-tile-leather-jacket')).not.toHaveFocus()
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1)
      })
      expect(screen.getByTestId('garment-tile-leather-jacket')).toHaveFocus()
    } finally {
      vi.useRealTimers()
    }

    expect(mockCapture).toHaveBeenLastCalledWith('hero_interaction', {
      interactionType: 'garment_swap',
      scenario: 'morning',
      itemId: 'leather-jacket',
    })
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
    expect(screen.getByText('Classic Trench Coat')).toBeTruthy()
  })

  it('renders a complete retry state when recommendations cannot be loaded', async () => {
    server.use(
      http.get('*/api/v1/ritual', () => {
        return new HttpResponse(null, { status: 500 })
      })
    )

    await render(<TabOneScreen />)

    await waitFor(() => {
      expect(screen.getByTestId('hero-error-state')).toBeTruthy()
    })
    expect(screen.getByText('Unable to load daily recommendations')).toBeTruthy()
    expect(screen.getByText('Retry')).toBeTruthy()
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
    expect(screen.getByText('Saatlik tahmin')).toBeTruthy()
    expect(screen.getByText('Genişlet (48 sa)')).toBeTruthy()
  })

  it('renders localized API fixtures selected by the locale query parameter', async () => {
    await i18n.changeLanguage('tr-TR')

    await render(<TabOneScreen />)

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
