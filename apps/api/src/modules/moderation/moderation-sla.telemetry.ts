// Story 6.12 owner: the SLA monitor's metrics and log vocabulary in `apps/api/src/modules/moderation/moderation-sla.telemetry.ts`.
// Bounded attributes only, with no case or member label.
import { metrics } from '@opentelemetry/api'
import {
  moderationSlaAlertKinds,
  moderationSlaFailureCodes,
  type ModerationSlaAlertKind,
  type ModerationSlaFailureCode,
} from '@couture/api-client/contracts/http'

/** The dashboard spec reads this list, so a panel cannot name a metric the code never emits. */
export const MODERATION_SLA_METRIC_NAMES = [
  'moderation_sla_open_cases',
  'moderation_sla_oldest_pending_review_age_seconds',
  'moderation_sla_alerts_total',
  'moderation_sla_delivery_failures_total',
] as const

export const MODERATION_SLA_LOG_EVENTS = {
  flagUnavailable: 'moderation_sla_flag_unavailable',
  attemptFailed: 'moderation_sla_delivery_attempt_failed',
  deliveryFailed: 'moderation_sla_delivery_failed',
  failureRecordFailed: 'moderation_sla_failure_record_failed',
  alertFailed: 'moderation_sla_alert_processing_failed',
  claimFailed: 'moderation_sla_claim_failed',
  signalsFailed: 'moderation_sla_signals_failed',
} as const

export const MODERATION_SLA_ANALYTICS_EVENTS = {
  snapshot: 'moderation_sla_snapshot',
  recorded: 'moderation_sla_alert_recorded',
  deliveryFailed: 'moderation_sla_delivery_failed',
} as const

export type ModerationSlaOpenState = 'on_track' | 'at_risk' | 'breached'

export interface ModerationSlaMeter {
  setOpenCases(state: ModerationSlaOpenState, count: number): void
  setOldestPendingReviewAgeSeconds(seconds: number): void
  countAlert(kind: ModerationSlaAlertKind): void
  countDeliveryFailure(code: ModerationSlaFailureCode): void
}

/** Metrics never change monitor behaviour, so every call swallows its own failure. */
export function createOpenTelemetryModerationSlaMeter(
  meter = metrics.getMeter('couturecast-api-moderation-sla')
): ModerationSlaMeter {
  const [openCasesName, pendingAgeName, alertsName, failuresName] =
    MODERATION_SLA_METRIC_NAMES
  const openCases = meter.createGauge(openCasesName, {
    description: 'Open moderation cases by SLA state, as of the latest sweep.',
  })
  const pendingAge = meter.createGauge(pendingAgeName, {
    description: 'Age of the oldest pending_review post, 0 when none is waiting.',
  })
  const alerts = meter.createCounter(alertsName, {
    description: 'Operations alerts recorded, by kind.',
  })
  const failures = meter.createCounter(failuresName, {
    description: 'Failed operations alert delivery attempts, by closed code.',
  })
  const safely = (record: () => void) => {
    try {
      record()
    } catch {
      // Metrics must not change monitor behaviour.
    }
  }
  // Each series starts at 0. Prometheus `increase()` needs an earlier sample, so without this the
  // first alert and the first failure after every worker start read as no change.
  safely(() => {
    for (const kind of moderationSlaAlertKinds) alerts.add(0, { kind })
    for (const code of moderationSlaFailureCodes) failures.add(0, { code })
  })
  return {
    setOpenCases: (state, count) => safely(() => openCases.record(count, { state })),
    setOldestPendingReviewAgeSeconds: (seconds) =>
      safely(() => pendingAge.record(seconds)),
    countAlert: (kind) => safely(() => alerts.add(1, { kind })),
    countDeliveryFailure: (code) => safely(() => failures.add(1, { code })),
  }
}
