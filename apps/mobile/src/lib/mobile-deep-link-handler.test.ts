import { describe, expect, it, vi, beforeEach } from 'vitest'
import {
  processMobileDeepLink,
  type ProcessMobileDeepLinkOptions,
} from './mobile-deep-link-handler'
import type { WeatherAlertDeepLinkTarget } from '@couture/api-client'

function createMockOptions(
  params: Record<string, unknown> = {},
  overrides: Partial<ProcessMobileDeepLinkOptions> = {}
) {
  const capture = vi.fn()
  const options: ProcessMobileDeepLinkOptions = {
    params,
    locale: 'en-US',
    analytics: {
      capture,
      screen: vi.fn(),
      getDistinctId: () => 'test-user-id',
    },
    setWidgetScenario: vi.fn(),
    setForecastSlot: vi.fn(),
    setFocusedWeatherAlert: vi.fn(),
    setIsInvalidDeepLink: vi.fn(),
    pushToCommunity: vi.fn(),
    resolveWeatherAlert: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }

  return { options, capture }
}

const fakeWeatherAlert: WeatherAlertDeepLinkTarget = {
  id: 'alert-999',
  event: {
    version: '1',
    timestamp: '2026-07-30T12:00:00.000Z',
    userId: 'test-user-id',
    data: {
      alertType: 'severe',
      location: 'Chicago',
      message: 'A severe thunderstorm warning is active.',
      severity: 'critical',
    },
  },
}

describe('processMobileDeepLink', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('returns immediately when params have no deep link intent', async () => {
    const { options, capture } = createMockOptions({})

    await processMobileDeepLink(options)

    expect(capture).not.toHaveBeenCalled()
    expect(options.setIsInvalidDeepLink).not.toHaveBeenCalled()
  })

  it('fires deep_link_invalid on malformed source parameter', async () => {
    const { options, capture } = createMockOptions({ source: 'bad_source', slot: 'am' })

    await processMobileDeepLink(options)

    expect(options.setIsInvalidDeepLink).toHaveBeenCalledWith(true)
    expect(capture).toHaveBeenCalledWith(
      'deep_link_invalid',
      expect.objectContaining({
        reason: expect.stringContaining('source') as unknown as string,
        surface: 'mobile',
      })
    )
  })

  it('fires deep_link_invalid when source is missing', async () => {
    const { options, capture } = createMockOptions({ slot: 'am' })

    await processMobileDeepLink(options)

    expect(options.setIsInvalidDeepLink).toHaveBeenCalledWith(true)
    expect(capture).toHaveBeenCalledWith(
      'deep_link_invalid',
      expect.objectContaining({
        reason: 'Missing source parameter',
        surface: 'mobile',
      })
    )
  })

  describe('widget deep links', () => {
    it('sets forecast slot for source=widget slot=now', async () => {
      const { options, capture } = createMockOptions({
        source: 'widget',
        size: 'small',
        slot: 'now',
      })

      await processMobileDeepLink(options)

      expect(options.setForecastSlot).toHaveBeenCalledWith('now')
      expect(options.setIsInvalidDeepLink).toHaveBeenCalledWith(false)
      expect(capture).toHaveBeenCalledWith('deep_link_handled', {
        source: 'widget',
        slot: 'now',
        widgetSize: 'small',
        surface: 'mobile',
      })
      expect(capture).toHaveBeenCalledWith('hero_interaction', {
        interactionType: 'widget_tap',
        widgetSize: 'small',
        slot: 'now',
        locale: 'en-US',
      })
    })

    it('sets forecast slot for source=widget slot=next', async () => {
      const { options } = createMockOptions({
        source: 'widget',
        size: 'medium',
        slot: 'next',
      })

      await processMobileDeepLink(options)

      expect(options.setForecastSlot).toHaveBeenCalledWith('next')
    })

    it('sets widget scenario for source=widget slot=am', async () => {
      const { options, capture } = createMockOptions({ source: 'widget', slot: 'am' })

      await processMobileDeepLink(options)

      expect(options.setWidgetScenario).toHaveBeenCalledWith('morning')
      expect(capture).toHaveBeenCalledWith(
        'deep_link_handled',
        expect.objectContaining({ source: 'widget', slot: 'am' })
      )
    })

    it('sets widget scenario for source=widget slot=pm', async () => {
      const { options } = createMockOptions({ source: 'widget', slot: 'pm' })

      await processMobileDeepLink(options)

      expect(options.setWidgetScenario).toHaveBeenCalledWith('midday')
    })

    it('sets widget scenario for source=widget slot=evening', async () => {
      const { options } = createMockOptions({ source: 'widget', slot: 'evening' })

      await processMobileDeepLink(options)

      expect(options.setWidgetScenario).toHaveBeenCalledWith('evening')
    })

    it('omits widgetSize from analytics when size is absent', async () => {
      const { options, capture } = createMockOptions({ source: 'widget', slot: 'am' })

      await processMobileDeepLink(options)

      expect(capture).toHaveBeenCalledWith('deep_link_handled', {
        source: 'widget',
        slot: 'am',
        surface: 'mobile',
      })
      expect(capture).toHaveBeenCalledWith('hero_interaction', {
        interactionType: 'widget_tap',
        slot: 'am',
        locale: 'en-US',
      })
    })
  })

  describe('watch deep links', () => {
    it('uses watch_tap interaction type for source=watch', async () => {
      const { options, capture } = createMockOptions({ source: 'watch', slot: 'next' })

      await processMobileDeepLink(options)

      expect(capture).toHaveBeenCalledWith(
        'hero_interaction',
        expect.objectContaining({ interactionType: 'watch_tap' })
      )
    })
  })

  describe('severe weather notification deep links', () => {
    it('does not resolve an alert for an unsupported target type', async () => {
      const resolveWeatherAlert = vi.fn()
      const { options, capture } = createMockOptions(
        { source: 'app' },
        { resolveWeatherAlert }
      )

      await processMobileDeepLink(options)

      expect(resolveWeatherAlert).not.toHaveBeenCalled()
      expect(capture).toHaveBeenCalledWith(
        'deep_link_invalid',
        expect.objectContaining({
          reason: 'Weather alert notification type was not found',
          surface: 'mobile',
        })
      )
    })

    it('focuses weather alert when target resolves', async () => {
      const resolveWeatherAlert = vi.fn().mockResolvedValue(fakeWeatherAlert)
      const { options, capture } = createMockOptions(
        { source: 'notification', type: 'severe_weather', alertId: 'alert-999' },
        { resolveWeatherAlert }
      )

      await processMobileDeepLink(options)

      expect(resolveWeatherAlert).toHaveBeenCalledWith('alert-999')
      expect(options.setFocusedWeatherAlert).toHaveBeenCalledWith(fakeWeatherAlert)
      expect(options.setIsInvalidDeepLink).toHaveBeenCalledWith(false)
      expect(capture).toHaveBeenCalledWith('deep_link_handled', {
        source: 'notification',
        type: 'severe_weather',
        alertId: 'alert-999',
        surface: 'mobile',
      })
    })

    it('fires deep_link_invalid when weather alert target is not found', async () => {
      const resolveWeatherAlert = vi.fn().mockResolvedValue(undefined)
      const { options, capture } = createMockOptions(
        { source: 'notification', type: 'severe_weather', alertId: 'alert-missing' },
        { resolveWeatherAlert }
      )

      await processMobileDeepLink(options)

      expect(options.setIsInvalidDeepLink).toHaveBeenCalledWith(true)
      expect(capture).toHaveBeenCalledWith(
        'deep_link_invalid',
        expect.objectContaining({
          reason: 'Weather alert target was not found',
          surface: 'mobile',
        })
      )
    })

    it('fires deep_link_invalid when weather alert resolution throws', async () => {
      const resolveWeatherAlert = vi.fn().mockRejectedValue(new Error('Network error'))
      const { options, capture } = createMockOptions(
        { source: 'notification', type: 'severe_weather', alertId: 'alert-999' },
        { resolveWeatherAlert }
      )

      await processMobileDeepLink(options)

      expect(options.setIsInvalidDeepLink).toHaveBeenCalledWith(true)
      expect(capture).toHaveBeenCalledWith(
        'deep_link_invalid',
        expect.objectContaining({
          reason: 'Weather alert target could not be loaded',
          surface: 'mobile',
        })
      )
    })
  })

  describe('community notification deep links', () => {
    it('pushes to community tab with cardId', async () => {
      const { options } = createMockOptions({
        source: 'notification',
        type: 'community',
        cardId: 'look-42',
      })

      await processMobileDeepLink(options)

      expect(options.pushToCommunity).toHaveBeenCalledWith({
        source: 'notification',
        type: 'community',
        cardId: 'look-42',
      })
      expect(options.setIsInvalidDeepLink).toHaveBeenCalledWith(false)
    })

    it('forwards expiresAt when present on community deep link', async () => {
      const { options } = createMockOptions({
        source: 'notification',
        type: 'community',
        cardId: 'look-42',
        expiresAt: '2099-12-31T23:59:59.000Z',
      })

      await processMobileDeepLink(options)

      expect(options.pushToCommunity).toHaveBeenCalledWith({
        source: 'notification',
        type: 'community',
        cardId: 'look-42',
        expiresAt: '2099-12-31T23:59:59.000Z',
      })
    })
  })

  describe('invalid deep link payloads', () => {
    it('fires invalid for widget without slot', async () => {
      const { options, capture } = createMockOptions({ source: 'widget' })

      await processMobileDeepLink(options)

      expect(options.setIsInvalidDeepLink).toHaveBeenCalledWith(true)
      expect(capture).toHaveBeenCalledWith(
        'deep_link_invalid',
        expect.objectContaining({ surface: 'mobile' })
      )
    })

    it('fires invalid for notification without type', async () => {
      const { options } = createMockOptions({ source: 'notification' })

      await processMobileDeepLink(options)

      expect(options.setIsInvalidDeepLink).toHaveBeenCalledWith(true)
    })

    it('clears focused weather alert on invalid link', async () => {
      const { options } = createMockOptions({ source: 'bad_source' })

      await processMobileDeepLink(options)

      expect(options.setFocusedWeatherAlert).toHaveBeenCalledWith(null)
    })

    it('includes raw params in invalid analytics payload', async () => {
      const params = { source: 'bad_source', slot: 'bad_slot' }
      const { options, capture } = createMockOptions(params)

      await processMobileDeepLink(options)

      expect(capture).toHaveBeenCalledWith(
        'deep_link_invalid',
        expect.objectContaining({
          rawUrl: JSON.stringify(params),
        })
      )
    })
  })
})
