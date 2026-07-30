import {
  resolveWeatherAlertDeepLinkTarget,
  type WeatherAlertDeepLinkTarget,
} from '@couture/api-client'
import {
  hasDeepLinkIntent,
  parseDeepLink,
  resolveDeepLinkScenario,
  type DeepLinkPayload,
  type DeepLinkScenarioContext,
  type DeepLinkSlot,
} from '@couture/utils'
import posthog from 'posthog-js'
import { pollWebEvents } from '../../lib/events-client'
import type { ChipCategory } from '../components/chip-navigation'
import {
  findLookbookFilterByCardId,
  type FilterCategory,
} from '../components/community-lookbook-grid'

export interface ApplyDeepLinkOptions {
  rawParams: Record<string, unknown>
  scenarioContext: DeepLinkScenarioContext
  setChipCategory: (category: ChipCategory) => void
  setActiveTab: (tab: FilterCategory) => void
  setFocusedWeatherAlert: (alert: WeatherAlertDeepLinkTarget | null) => void
  setHighlightedCardId: (id: string | undefined) => void
  setLiveAnnouncement: (announcement: string | null) => void
  setIsInvalidDeepLink: (invalid: boolean) => void
}

const SCENARIO_DESTINATIONS: Record<
  ReturnType<typeof resolveDeepLinkScenario>,
  { chip: ChipCategory; filter: FilterCategory }
> = {
  morning: { chip: 'Personal', filter: 'New' },
  midday: { chip: 'Community', filter: 'Following' },
  evening: { chip: 'Sponsored', filter: 'Brands' },
}

function handleWidgetDeepLink(slot: DeepLinkSlot, options: ApplyDeepLinkOptions) {
  const destination =
    SCENARIO_DESTINATIONS[resolveDeepLinkScenario(slot, options.scenarioContext)]
  options.setChipCategory(destination.chip)
  options.setActiveTab(destination.filter)
}

function invalidDeepLink(options: ApplyDeepLinkOptions, reason: string) {
  options.setFocusedWeatherAlert(null)
  options.setHighlightedCardId(undefined)
  options.setIsInvalidDeepLink(true)
  options.setLiveAnnouncement('This link is invalid, expired, or no longer available.')
  posthog.capture('deep_link_invalid', {
    rawUrl: typeof window !== 'undefined' ? window.location.href : '',
    reason,
    surface: 'web',
  })
}

function captureHandled(payload: DeepLinkPayload, resolvedAlertId?: string) {
  posthog.capture('deep_link_handled', {
    source: payload.source,
    slot: payload.slot,
    ...(payload.size ? { widgetSize: payload.size } : {}),
    type: payload.type,
    alertId: resolvedAlertId ?? payload.alertId,
    cardId: payload.cardId,
    surface: 'web',
  })
}

async function handleWeatherNotification(
  options: ApplyDeepLinkOptions,
  payload: DeepLinkPayload
) {
  let alert: WeatherAlertDeepLinkTarget | undefined
  try {
    const response = await pollWebEvents()
    alert = resolveWeatherAlertDeepLinkTarget(response.events, payload.alertId)
  } catch {
    invalidDeepLink(options, 'Weather alert target could not be loaded')
    return
  }
  if (!alert) {
    invalidDeepLink(options, 'Weather alert target was not found')
    return
  }
  options.setFocusedWeatherAlert(alert)
  captureHandled(payload, alert.id)
  options.setLiveAnnouncement(`Weather alert for ${alert.event.data.location} focused.`)
}

export async function processWebDeepLink(options: ApplyDeepLinkOptions) {
  if (!hasDeepLinkIntent(options.rawParams)) {
    return
  }

  const result = parseDeepLink(options.rawParams)
  if (!result.valid || !result.payload) {
    invalidDeepLink(options, result.errorReason ?? 'Invalid deep link parameters')
    return
  }

  const payload = result.payload
  options.setIsInvalidDeepLink(false)

  if (payload.source === 'widget' || payload.source === 'watch') {
    if (!payload.slot) {
      invalidDeepLink(options, 'Widget target slot was not found')
      return
    }
    handleWidgetDeepLink(payload.slot, options)
  } else if (payload.type === 'severe_weather' || payload.type === 'weather_alert') {
    await handleWeatherNotification(options, payload)
    return
  } else if (payload.type === 'community') {
    if (!payload.cardId) {
      invalidDeepLink(options, 'Community card target was not found')
      return
    }
    const filter = findLookbookFilterByCardId(payload.cardId)
    if (!filter) {
      invalidDeepLink(options, 'Community card target was not found')
      return
    }
    options.setChipCategory('Community')
    options.setActiveTab(filter)
    options.setHighlightedCardId(payload.cardId)
  } else {
    invalidDeepLink(options, 'Deep link target was not found')
    return
  }

  captureHandled(payload)
  options.setLiveAnnouncement(`Navigated from ${payload.source}. Guidance updated.`)
}
