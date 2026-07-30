import type { PolledEvent } from '../contracts/http/events'
import {
  alertWeatherEventSchema,
  lookbookNewEventSchema,
  type AlertWeatherEvent,
  type LookbookNewEvent,
} from './socket-events'

export interface WeatherAlertDeepLinkTarget {
  id: string
  event: AlertWeatherEvent
}

export interface CommunityCardDeepLinkTarget {
  id: string
  event: LookbookNewEvent
}

function newestFirst(left: PolledEvent, right: PolledEvent): number {
  return Date.parse(right.createdAt) - Date.parse(left.createdAt)
}

export function resolveWeatherAlertDeepLinkTarget(
  events: readonly PolledEvent[],
  alertId?: string
): WeatherAlertDeepLinkTarget | undefined {
  for (const event of [...events].sort(newestFirst)) {
    if (event.channel !== 'alert:weather' || (alertId && event.id !== alertId)) {
      continue
    }

    const parsed = alertWeatherEventSchema.safeParse(event.payload)
    if (parsed.success) {
      return { id: event.id, event: parsed.data }
    }
  }

  return undefined
}

export function resolveCommunityCardDeepLinkTarget(
  events: readonly PolledEvent[],
  cardId: string
): CommunityCardDeepLinkTarget | undefined {
  for (const event of [...events].sort(newestFirst)) {
    if (event.channel !== 'lookbook:new') {
      continue
    }

    const parsed = lookbookNewEventSchema.safeParse(event.payload)
    if (parsed.success && parsed.data.data.postId === cardId) {
      return { id: cardId, event: parsed.data }
    }
  }

  return undefined
}
