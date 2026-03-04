import {
  trackAlertReceived,
  trackRitualCreated,
  trackWardrobeUploadStarted,
} from '@couture/api-client'
import type { PostHog } from 'posthog-react-native'

type MobilePostHogClient = Pick<PostHog, 'capture'>

type TrackAlertReceivedInput = {
  userId: string
  alertType: string
  severity: 'info' | 'warning' | 'critical'
  weatherSeverity?: string
}

export function trackMobileRitualCreated(
  client: MobilePostHogClient,
  input: {
    userId: string
    locationId: string
    ritualType?: string
    weatherContext?: string
  }
) {
  const payload = trackRitualCreated({
    userId: input.userId,
    locationId: input.locationId,
    ritualType: input.ritualType,
    weatherContext: input.weatherContext,
    timestamp: new Date().toISOString(),
  })

  client.capture(payload.event, payload.properties)
}

export function trackMobileWardrobeUploadStarted(
  client: MobilePostHogClient,
  input: {
    userId: string
    itemId: string
    fileSize: number
    itemCount?: number
    uploadSource?: string
  }
) {
  const payload = trackWardrobeUploadStarted({
    userId: input.userId,
    itemId: input.itemId,
    fileSize: input.fileSize,
    itemCount: input.itemCount,
    uploadSource: input.uploadSource,
    timestamp: new Date().toISOString(),
  })

  client.capture(payload.event, payload.properties)
}

export function trackMobileAlertReceived(
  client: MobilePostHogClient,
  input: TrackAlertReceivedInput
) {
  const payload = trackAlertReceived({
    userId: input.userId,
    alertType: input.alertType,
    severity: input.severity,
    weatherSeverity: input.weatherSeverity,
    timestamp: new Date().toISOString(),
  })

  client.capture(payload.event, payload.properties)
}
