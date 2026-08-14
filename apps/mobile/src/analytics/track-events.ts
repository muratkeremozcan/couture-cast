// Step 8 app reuse owner: searchable owner anchor
import {
  trackAffiliateCtaShown,
  trackAlertReceived,
  trackLocaleSwitched,
  trackPremiumSubscribeTapped,
  trackRitualCreated,
  trackWardrobeUploadStarted,
} from '@couture/api-client'
import type {
  AffiliateCtaShownEvent,
  PremiumSubscribeTappedEvent,
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

/**
 * Story 5.1: the affiliate impression is the one commerce event with no server
 * subject. It rides the mobile analytics client's own `distinctId`, exactly like
 * {@link trackMobileRitualCreated}, and deliberately does not travel through
 * `TelemetryService`, so it writes no `TelemetryEvent` row: a mobile client can
 * neither compute the server-side HMAC subject nor write that table.
 */
export function trackMobileAffiliateCtaShown(
  client: MobileAnalyticsCaptureClient,
  distinctId: string,
  input: AffiliateCtaShownEvent
) {
  const payload = trackAffiliateCtaShown(input, distinctId)

  client.capture(payload.event, payload.properties)
}

/**
 * Story 5.2: the mobile funnel start for a Premium purchase. Client-side only,
 * on the analytics client's own `distinctId`, exactly like
 * {@link trackMobileAffiliateCtaShown} — it never touches `TelemetryService`.
 * The identifier space is disjoint from the server HMAC subject, so this event
 * is directional volume, not a funnel leg; the computable funnel lives in the
 * server events.
 */
export function trackMobilePremiumSubscribeTapped(
  client: MobileAnalyticsCaptureClient,
  distinctId: string,
  input: PremiumSubscribeTappedEvent
) {
  const payload = trackPremiumSubscribeTapped(input, distinctId)

  client.capture(payload.event, payload.properties)
}

export function trackMobileLocaleSwitched(
  client: MobileAnalyticsCaptureClient,
  input: {
    userId: string
    fromLocale: string
    toLocale: string
  }
) {
  const payload = trackLocaleSwitched({
    userId: input.userId,
    fromLocale: input.fromLocale,
    toLocale: input.toLocale,
    timestamp: new Date().toISOString(),
  })

  client.capture(payload.event, payload.properties)
}
