// Story 3.7 Task 3 step 1 owner: implement mobile deep-link handler and Expo Router parameter processing
import {
  resolveWeatherAlertDeepLinkTarget,
  type WeatherAlertDeepLinkTarget,
} from '@couture/api-client'
import { eventsPollResultSchema } from '@couture/api-client/contracts/http'
import {
  hasDeepLinkIntent,
  parseDeepLink,
  resolveDeepLinkScenario,
  type DeepLinkPayload,
  type DeepLinkScenario,
} from '@couture/utils'
import type { MobileAnalyticsClient } from '../analytics/mobile-analytics'
import { createMobileApiClient } from './api-client'
import { resolveMobileAccessToken } from './mobile-auth'

async function pollMobileEvents() {
  const client = createMobileApiClient({
    accessToken: async () => (await resolveMobileAccessToken()) || '',
  })
  const result = eventsPollResultSchema.parse(await client.apiV1EventsPollGet())
  return result.events
}

export async function loadMobileWeatherAlertTarget(
  alertId?: string
): Promise<WeatherAlertDeepLinkTarget | undefined> {
  return resolveWeatherAlertDeepLinkTarget(await pollMobileEvents(), alertId)
}

// A community card target used to be resolved from the event poll here. The
// community screen now reads the post itself through `GET /community/posts/{id}`,
// which is the only source that knows whether the viewer may see it and is not
// bounded by the poll window.

export interface ProcessMobileDeepLinkOptions {
  params: Record<string, unknown>
  locale: string
  analytics: MobileAnalyticsClient
  setWidgetScenario: (scenario: DeepLinkScenario) => void
  setForecastSlot: (slot: 'now' | 'next') => void
  setFocusedWeatherAlert: (alert: WeatherAlertDeepLinkTarget | null) => void
  setIsInvalidDeepLink: (invalid: boolean) => void
  resolveWeatherAlert?: typeof loadMobileWeatherAlertTarget
  pushToCommunity: (params: {
    source: 'notification'
    type: 'community'
    cardId: string
    expiresAt?: string
  }) => void
}

function invalidDeepLink(options: ProcessMobileDeepLinkOptions, reason: string) {
  options.setFocusedWeatherAlert(null)
  options.setIsInvalidDeepLink(true)
  options.analytics.capture('deep_link_invalid', {
    rawUrl: JSON.stringify(options.params),
    reason,
    surface: 'mobile',
  })
}

function handleWidgetDeepLink(
  options: ProcessMobileDeepLinkOptions,
  payload: DeepLinkPayload
) {
  if (!payload.slot) {
    invalidDeepLink(options, 'Widget target slot was not found')
    return
  }
  if (payload.slot === 'now' || payload.slot === 'next') {
    options.setForecastSlot(payload.slot)
  } else {
    options.setWidgetScenario(resolveDeepLinkScenario(payload.slot))
  }
  options.analytics.capture('deep_link_handled', {
    source: payload.source,
    slot: payload.slot,
    ...(payload.size ? { widgetSize: payload.size } : {}),
    surface: 'mobile',
  })
  options.analytics.capture('hero_interaction', {
    interactionType: payload.source === 'widget' ? 'widget_tap' : 'watch_tap',
    ...(payload.size ? { widgetSize: payload.size } : {}),
    slot: payload.slot,
    locale: options.locale,
  })
}

async function handleWeatherDeepLink(
  options: ProcessMobileDeepLinkOptions,
  payload: DeepLinkPayload
) {
  if (payload.type !== 'severe_weather' && payload.type !== 'weather_alert') {
    invalidDeepLink(options, 'Weather alert notification type was not found')
    return
  }

  let alert: WeatherAlertDeepLinkTarget | undefined
  try {
    alert = await (options.resolveWeatherAlert ?? loadMobileWeatherAlertTarget)(
      payload.alertId
    )
  } catch {
    invalidDeepLink(options, 'Weather alert target could not be loaded')
    return
  }
  if (!alert) {
    invalidDeepLink(options, 'Weather alert target was not found')
    return
  }
  options.setFocusedWeatherAlert(alert)
  options.analytics.capture('deep_link_handled', {
    source: payload.source,
    type: payload.type,
    alertId: alert.id,
    surface: 'mobile',
  })
}

export async function processMobileDeepLink(
  options: ProcessMobileDeepLinkOptions
): Promise<void> {
  if (!hasDeepLinkIntent(options.params)) {
    return
  }

  const result = parseDeepLink(options.params)
  if (!result.valid || !result.payload) {
    invalidDeepLink(options, result.errorReason ?? 'Invalid deep link parameters')
    return
  }

  const payload = result.payload
  options.setIsInvalidDeepLink(false)

  if (payload.source === 'widget' || payload.source === 'watch') {
    handleWidgetDeepLink(options, payload)
    return
  }

  if (payload.type === 'community' && payload.cardId) {
    options.pushToCommunity({
      source: 'notification',
      type: 'community',
      cardId: payload.cardId,
      ...(payload.expiresAt ? { expiresAt: payload.expiresAt } : {}),
    })
    return
  }

  await handleWeatherDeepLink(options, payload)
}
