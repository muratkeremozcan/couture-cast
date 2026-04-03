// Step 8 app reuse owner: searchable owner anchor
import {
  trackAlertReceived,
  trackRitualCreated,
  trackWardrobeUploadStarted,
} from '@couture/api-client'
import type { MobileAnalyticsClient } from './mobile-analytics'

/** Story 0.7 support file: mobile analytics wrapper layer.
 * Wrapper role: collect mobile context, stamp timestamp, and delegate schema enforcement to shared contracts.
 * Problems solved: prevents feature-level ad hoc events that cause naming drift and harder cross-platform observability.
 * Alternatives: call capture directly in screens or expose a generic track(event, props) helper with weaker constraints.
 * Flow refs:
 * - S0.7/T3/1: mobile callers feed feature context into the shared analytics wrappers.
 * - S0.7/T2/2: @couture/api-client performs the canonical property normalization.
 */
type MobileAnalyticsCaptureClient = Pick<MobileAnalyticsClient, 'capture'>

type TrackAlertReceivedInput = {
  userId: string
  alertType: string
  severity: 'info' | 'warning' | 'critical'
  weatherSeverity?: string
}

// Flow ref S0.7/T3/1: accept mobile feature context here, then delegate the
// canonical event shape to the shared wrapper.
export function trackMobileRitualCreated(
  client: MobileAnalyticsCaptureClient,
  input: {
    userId: string
    locationId: string
    ritualType?: string
    weatherContext?: string
  }
) {
  // Flow ref S0.7/T2/2: build the normalized payload through the shared
  // contracts rather than shaping PostHog properties locally.
  const payload = trackRitualCreated({
    userId: input.userId,
    locationId: input.locationId,
    ritualType: input.ritualType,
    weatherContext: input.weatherContext,
    timestamp: new Date().toISOString(),
  })

  // Flow ref S0.7/T3/1: capture only the contract-validated event/properties.
  client.capture(payload.event, payload.properties)
}

export function trackMobileWardrobeUploadStarted(
  client: MobileAnalyticsCaptureClient,
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
  client: MobileAnalyticsCaptureClient,
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
