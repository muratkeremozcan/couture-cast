/* eslint-disable @typescript-eslint/await-thenable */
// Story 3.3 Task 5 step 1 owner: verify the production now/next widget link contract.
import React from 'react'
import { screen, waitFor } from '@testing-library/react'
import { render } from 'vitest-browser-react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import TabOneScreen from '@/app/(tabs)/index'
import { setMobileAccessTokenResolver } from '@/src/lib/mobile-auth'
import { clearRitualMemoryCache } from '@/src/lib/ritual-cache'
import { initI18n } from '@/src/lib/i18n'

let mockParams: Record<string, string> = {}
const mockSetParams = vi.fn()
const mockRouter = { setParams: mockSetParams }

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

describe('Widget Deep Link Hydration', () => {
  beforeAll(async () => {
    process.env.EXPO_PUBLIC_API_BASE_URL =
      typeof window !== 'undefined' ? window.location.origin : 'https://mock-api.test'
    await initI18n()
  })

  beforeEach(() => {
    mockCapture.mockClear()
    mockSetParams.mockClear()
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-07-24T17:30:00.000Z'))
    setMobileAccessTokenResolver(() => 'session-token')
    mockParams = {}
  })

  afterEach(() => {
    vi.restoreAllMocks()
    clearRitualMemoryCache()
    localStorage.clear()
  })

  it('hydrates the current location-time scenario from slot=now', async () => {
    mockParams = { source: 'widget', size: 'small', slot: 'now' }

    await render(<TabOneScreen />)

    await waitFor(() => {
      expect(
        screen.getByText('Mild morning with gentle winds. Trench coat recommended.')
      ).toBeTruthy()
    })
    expect(mockCapture).toHaveBeenCalledWith('hero_interaction', {
      interactionType: 'widget_tap',
      widgetSize: 'small',
      slot: 'now',
      locale: 'en-US',
    })
    const widgetTapCalls = mockCapture.mock.calls.filter(
      ([event, properties]) =>
        event === 'hero_interaction' && properties?.interactionType === 'widget_tap'
    )
    expect(widgetTapCalls).toHaveLength(1)
    expect(mockSetParams).toHaveBeenCalledWith({
      source: undefined,
      size: undefined,
      slot: undefined,
    })
  })

  it('hydrates the next forecast scenario from slot=next', async () => {
    mockParams = { source: 'widget', size: 'medium', slot: 'next' }

    await render(<TabOneScreen />)

    await waitFor(() => {
      expect(
        screen.getByText('Warm and sunny midday. Light tee is perfect.')
      ).toBeTruthy()
    })
    expect(mockCapture).toHaveBeenCalledWith('hero_interaction', {
      interactionType: 'widget_tap',
      widgetSize: 'medium',
      slot: 'next',
      locale: 'en-US',
    })
  })

  it('tracks a later widget link while the tab remains mounted', async () => {
    mockParams = { source: 'widget', size: 'small', slot: 'now' }
    const view = await render(<TabOneScreen />)

    await waitFor(() => {
      expect(mockCapture).toHaveBeenCalledWith(
        'hero_interaction',
        expect.objectContaining({ slot: 'now' })
      )
    })

    mockParams = {}
    await view.rerender(<TabOneScreen />)
    mockParams = { source: 'widget', size: 'medium', slot: 'next' }
    await view.rerender(<TabOneScreen />)

    await waitFor(() => {
      expect(mockCapture).toHaveBeenCalledWith(
        'hero_interaction',
        expect.objectContaining({ slot: 'next' })
      )
    })
  })

  it('rejects malformed widget parameters before analytics or hydration', async () => {
    mockParams = { source: 'widget', size: 'huge', slot: 'evening' }

    await render(<TabOneScreen />)

    await waitFor(() => {
      expect(screen.getByTestId('weather-header')).toBeTruthy()
    })
    expect(mockCapture).not.toHaveBeenCalledWith(
      'hero_interaction',
      expect.objectContaining({ interactionType: 'widget_tap' })
    )
    expect(
      screen.getByText('Mild morning with gentle winds. Trench coat recommended.')
    ).toBeTruthy()
  })

  it('ignores widget parameters when source is not widget', async () => {
    mockParams = { source: 'other', size: 'medium', slot: 'next' }

    await render(<TabOneScreen />)

    await waitFor(() => {
      expect(screen.getByTestId('weather-header')).toBeTruthy()
    })
    expect(mockCapture).not.toHaveBeenCalledWith(
      'hero_interaction',
      expect.objectContaining({ interactionType: 'widget_tap' })
    )
  })
})
