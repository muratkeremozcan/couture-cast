import {
  trackAlertReceived,
  trackRitualCreated,
  trackWardrobeUploadStarted,
} from '@couture/api-client'
import type { PostHog } from 'posthog-react-native'

/** Story 0.7 Task 2/3: mobile analytics wrapper layer.
 * Wrapper role: collect mobile context, stamp timestamp, and delegate schema enforcement to shared contracts.
 * Problems solved: prevents feature-level ad hoc events that cause naming drift and harder cross-platform observability.
 * Alternatives: call capture directly in screens or expose a generic track(event, props) helper with weaker constraints.
 * Setup steps (where we did this):
 *   1) accept feature context in each trackMobile* input.
 *   2) build normalized payload through @couture/api-client track* contracts.
 *   3) send only the contract-validated event/properties to the PostHog client.
 */
type MobilePostHogClient = Pick<PostHog, 'capture'>

type TrackAlertReceivedInput = {
  userId: string
  alertType: string
  severity: 'info' | 'warning' | 'critical'
  weatherSeverity?: string
}

// 1) accept feature context in each trackMobile* input.
export function trackMobileRitualCreated(
  client: MobilePostHogClient,
  input: {
    userId: string
    locationId: string
    ritualType?: string
    weatherContext?: string
  }
) {
  // 2) build normalized payload through @couture/api-client track* contracts.
  const payload = trackRitualCreated({
    userId: input.userId,
    locationId: input.locationId,
    ritualType: input.ritualType,
    weatherContext: input.weatherContext,
    timestamp: new Date().toISOString(),
  })

  // 3) send only the contract-validated event/properties to the PostHog client.
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
