/* eslint-disable @typescript-eslint/await-thenable */
// Story 3.3 Task 5 step 1 owner: verify the production now/next widget link contract.
import React from 'react'
import { screen, waitFor } from '@testing-library/react'
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
import { setMobileAccessTokenResolver } from '@/src/lib/mobile-auth'
import { clearRitualMemoryCache } from '@/src/lib/ritual-cache'
import { initI18n } from '@/src/lib/i18n'

let mockParams: Record<string, string> = {}
const mockSetParams = vi.fn()
const mockRouter = { setParams: mockSetParams }

function deepLinkParams(params: Record<string, string>) {
  return params
}

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

describe('Widget Deep Link Hydration', () => {
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
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-07-24T17:30:00.000Z'))
    restoreAccessTokenResolver = setMobileAccessTokenResolver(() => 'session-token')
    mockParams = {}
  })

  afterEach(() => {
    restoreAccessTokenResolver?.()
    restoreAccessTokenResolver = undefined
    vi.restoreAllMocks()
    clearRitualMemoryCache()
    localStorage.clear()
  })

  it.each([
    {
      name: 'current widget scenario',
      params: deepLinkParams({ source: 'widget', size: 'small', slot: 'now' }),
      expectedCopy: 'Mild morning with gentle winds. Trench coat recommended.',
      expectedProperties: {
        interactionType: 'widget_tap',
        widgetSize: 'small',
        slot: 'now',
        locale: 'en-US',
      },
    },
    {
      name: 'next widget scenario',
      params: deepLinkParams({ source: 'widget', size: 'medium', slot: 'next' }),
      expectedCopy: 'Warm and sunny midday. Light tee is perfect.',
      expectedProperties: {
        interactionType: 'widget_tap',
        widgetSize: 'medium',
        slot: 'next',
        locale: 'en-US',
      },
    },
    {
      name: 'watch handoff without widget dimensions',
      params: deepLinkParams({ source: 'watch', slot: 'next' }),
      expectedCopy: 'Warm and sunny midday. Light tee is perfect.',
      expectedProperties: {
        interactionType: 'watch_tap',
        slot: 'next',
        locale: 'en-US',
      },
    },
  ])('hydrates the $name', async ({ params, expectedCopy, expectedProperties }) => {
    mockParams = params

    await render(<TabOneScreen />)

    await waitFor(() => {
      expect(screen.getByText(expectedCopy)).toBeTruthy()
    })
    const heroInteractionCalls = mockCapture.mock.calls.filter(
      ([event]) => event === 'hero_interaction'
    )
    expect(heroInteractionCalls).toEqual([['hero_interaction', expectedProperties]])
    expect(mockSetParams).toHaveBeenCalledWith({
      source: undefined,
      size: undefined,
      slot: undefined,
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

  it.each([
    {
      name: 'malformed widget parameters',
      params: deepLinkParams({ source: 'widget', size: 'huge', slot: 'evening' }),
    },
    {
      name: 'parameters from an unknown source',
      params: deepLinkParams({ source: 'other', size: 'medium', slot: 'next' }),
    },
  ])('ignores $name before analytics or hydration', async ({ params }) => {
    mockParams = params

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
})
