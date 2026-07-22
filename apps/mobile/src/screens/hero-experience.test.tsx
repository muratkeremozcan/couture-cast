/* eslint-disable @typescript-eslint/await-thenable */
import React from 'react'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import { render } from 'vitest-browser-react'
import { describe, expect, it, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { server } from '@/src/test-utils/msw/server'
import { http, HttpResponse } from 'msw'
import TabOneScreen, { clearMemoryCache } from '@/app/(tabs)/index'
import { setMobileAccessTokenResolver } from '@/src/lib/mobile-auth'
import { saveRitualCache } from '@/src/lib/ritual-cache'
import { mockRitualResponse } from '@/src/test-utils/msw/handlers'

// Mock analytics hook
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
  beforeAll(() => {
    process.env.EXPO_PUBLIC_API_BASE_URL =
      typeof window !== 'undefined' ? window.location.origin : 'https://mock-api.test'
  })

  beforeEach(() => {
    setMobileAccessTokenResolver(() => 'session-token')
  })

  afterEach(() => {
    vi.clearAllMocks()
    clearMemoryCache()
    localStorage.clear()
  })

  it('displays skeleton state while loading and then loads current weather, 48-hour ribbon, and morning outfit card', async () => {
    await render(<TabOneScreen />)

    // Verify skeleton loaders are visible initially
    expect(screen.getByTestId('weather-header-skeleton')).toBeTruthy()
    expect(screen.getByTestId('hourly-forecast-ribbon-skeleton')).toBeTruthy()
    expect(screen.getByTestId('outfit-recommendation-card-skeleton')).toBeTruthy()

    // Wait for the happy-path rendering to load
    await waitFor(() => {
      expect(screen.getByTestId('weather-header')).toBeTruthy()
    })

    // Verify temperature display
    expect(screen.getByTestId('current-temperature').textContent).toBe('21°C')
    expect(screen.getByText('Clear Sky')).toBeTruthy()

    // Verify hourly forecast is present (default shows 8 items)
    expect(screen.getByTestId('hourly-forecast-ribbon')).toBeTruthy()
    const hourlyItems = screen.getAllByTestId('hourly-item')
    expect(hourlyItems.length).toBe(8)

    // Verify default morning outfit card comfort notes
    expect(
      screen.getByText('Mild morning with gentle winds. Trench coat recommended.')
    ).toBeTruthy()

    // Verify garment tiles are rendered
    expect(screen.getByText('Classic Trench Coat')).toBeTruthy()
    expect(screen.getByText('Navy Chinos')).toBeTruthy()

    // Verify reasoning badges are rendered
    expect(screen.getByText('Breeze Guard')).toBeTruthy()

    // Verify initial telemetry tracked
    expect(mockCapture).toHaveBeenCalledWith('tab_one_viewed')
    expect(mockCapture).toHaveBeenCalledWith('ritual_created', expect.any(Object))
  })

  it('verifies scenario switching updates the displayed outfit card and triggers telemetry', async () => {
    await render(<TabOneScreen />)

    await waitFor(() => {
      expect(screen.getByTestId('weather-header')).toBeTruthy()
    })

    // Click "Evening plans" toggle
    const eveningToggle = screen.getByTestId('scenario-toggle-evening')
    fireEvent.click(eveningToggle)

    // Verify outfit card changes
    expect(screen.getByText('Cool evening ahead. Sweater recommended.')).toBeTruthy()
    expect(screen.getByText('Crewneck Sweater')).toBeTruthy()

    // Verify telemetry interaction captured
    expect(mockCapture).toHaveBeenLastCalledWith('hero_interaction', {
      interactionType: 'scenario_toggle',
      scenario: 'evening',
    })
  })

  it('verifies hourly ribbon expands and collapses and triggers telemetry', async () => {
    await render(<TabOneScreen />)

    await waitFor(() => {
      expect(screen.getByTestId('weather-header')).toBeTruthy()
    })

    const expandButton = screen.getByTestId('ribbon-expand-toggle')
    expect(expandButton.textContent).toBe('Expand (48h)')

    // Click expand
    fireEvent.click(expandButton)

    // Verify items display all 48 entries
    expect(screen.getAllByTestId('hourly-item').length).toBe(48)
    expect(expandButton.textContent).toBe('Collapse')

    // Verify telemetry
    expect(mockCapture).toHaveBeenCalledWith('hero_interaction', {
      interactionType: 'ribbon_toggle',
    })

    // Click collapse
    fireEvent.click(expandButton)
    expect(screen.getAllByTestId('hourly-item').length).toBe(8)
  })

  it('verifies garment swap modal flows and updates garment state with telemetry', async () => {
    await render(<TabOneScreen />)

    await waitFor(() => {
      expect(screen.getByText('Classic Trench Coat')).toBeTruthy()
    })

    // Click swap on trench coat
    const swapButton = screen.getByTestId('garment-tile-classic-trench-coat')
    fireEvent.click(swapButton)

    // Verify modal is visible
    expect(screen.getByTestId('garment-swap-modal')).toBeTruthy()

    // Choose 'Leather Jacket'
    const leatherJacketOption = screen.getByTestId('swap-option-leather-jacket')
    fireEvent.click(leatherJacketOption)

    // Verify garment is updated in view
    expect(screen.queryByText('Classic Trench Coat')).toBeNull()
    expect(screen.getByText('Leather Jacket')).toBeTruthy()

    // Verify telemetry
    expect(mockCapture).toHaveBeenLastCalledWith('hero_interaction', {
      interactionType: 'garment_swap',
      scenario: 'morning',
      itemId: 'leather-jacket',
    })
  })

  it('verifies offline fallback banner and stale state display when API request fails', async () => {
    // Populate the cache with a stale entry (older than 15 mins)
    await saveRitualCache('test-user-id', {
      data: mockRitualResponse,
      timestamp: Date.now() - 20 * 60 * 1000, // 20 minutes ago (stale!)
    })

    // Now fail the API and render
    server.use(
      http.get('*/api/v1/ritual', () => {
        return new HttpResponse(null, { status: 500 })
      })
    )

    await render(<TabOneScreen />)

    // Verify it loads from cache and displays the stale banner
    await waitFor(() => {
      expect(screen.getByTestId('stale-cache-banner')).toBeTruthy()
    })
    expect(screen.getByText('Using recently cached weather data')).toBeTruthy()
    expect(screen.getByText('Classic Trench Coat')).toBeTruthy()
  })

  it('displays Merlot warning banner when weather alerts are active', async () => {
    // Use custom MSW mock containing weather alerts
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
  })
})
