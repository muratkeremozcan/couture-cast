// Story 6.2 Task 4: privacy-safe operational metrics for the community
// moderation worker.
//
// SEPARATE FROM `TelemetryService` ON PURPOSE. That service is product
// analytics: every call persists a `TelemetryEvent` row keyed to a person and
// forwards it to PostHog. Screening readiness, latency, disposition counts and
// model health are facts about a process, they belong to whoever is holding the
// pager, and attaching a user to them would put a person beside a safety
// verdict for no operational gain. So this file follows `weather-telemetry.ts`
// instead: an OpenTelemetry meter with bounded attributes, and the pino `event`
// vocabulary that goes with it.
import { metrics } from '@opentelemetry/api'
import type { NsfwImageDisposition } from './community-moderation.engine.js'

export const COMMUNITY_MODERATION_LOG_FEATURE = 'community-moderation'

export const COMMUNITY_MODERATION_LOG_EVENTS = {
  screenerReady: 'community_moderation_screener_ready',
  screenerIncidentMode: 'community_moderation_screener_incident_mode',
  screenerStartupFailed: 'community_moderation_screener_startup_failed',
  screeningCompleted: 'community_moderation_screening_completed',
  screeningAttemptFailed: 'community_moderation_screening_attempt_failed',
  modelTerminated: 'community_moderation_model_terminated',
} as const

/** How a screening job ended, as far as the post is concerned. */
export type ModerationOutcome = 'published' | 'flagged' | 'review_failed' | 'error'

/** Which screener the process selected, and therefore what a verdict is worth. */
export type ModerationScreenerSelector = 'tensorflow' | 'fixture' | 'unavailable'

/** Why the supervised inference runtime was torn down. */
export type ModerationModelHealthState =
  | 'ready'
  | 'timeout_terminated'
  | 'crashed'
  | 'respawned'

/**
 * The slice of `@opentelemetry/api` this module uses, declared structurally so a
 * spec can pass plain fakes. Same reasoning as `weather-telemetry.ts`.
 */
export interface OtelCounter {
  add(value: number, attributes?: Record<string, string | number>): void
}

export interface OtelHistogram {
  record(value: number, attributes?: Record<string, string | number>): void
}

export interface OtelMeter {
  createCounter(name: string, options?: { description?: string }): OtelCounter
  createHistogram(
    name: string,
    options?: { description?: string; unit?: string }
  ): OtelHistogram
}

export interface CommunityModerationMeter {
  recordScreenerReadiness(
    selector: ModerationScreenerSelector,
    outcome: 'ready' | 'failed',
    startupDurationMs: number
  ): void
  recordScreening(
    disposition: NsfwImageDisposition | 'unavailable',
    outcome: ModerationOutcome,
    durationMs: number,
    attempt: number
  ): void
  recordAttemptFailure(outcome: ModerationOutcome, attempt: number): void
  recordModelHealth(state: ModerationModelHealthState): void
}

/**
 * Attempt numbers become a metric attribute, so they are clamped rather than
 * passed through. BullMQ gives this pipeline three attempts; a value outside
 * that range means a caller miscounted, and letting it reach the meter would
 * turn one bounded label into an unbounded time series.
 */
const MAX_RECORDED_ATTEMPT = 10

function boundedAttempt(attempt: number): number {
  if (!Number.isFinite(attempt)) return 0
  return Math.min(Math.max(Math.trunc(attempt), 0), MAX_RECORDED_ATTEMPT)
}

function boundedDuration(durationMs: number): number {
  return Number.isFinite(durationMs) ? Math.max(0, durationMs) : 0
}

export function createOpenTelemetryCommunityModerationMeter(
  meter: OtelMeter = metrics.getMeter('couturecast-api-community-moderation')
): CommunityModerationMeter {
  const readinessCounter = meter.createCounter(
    'community_moderation_screener_readiness_total',
    {
      description: 'Community screener startup attempts by selector and outcome.',
    }
  )
  const startupDurationHistogram = meter.createHistogram(
    'community_moderation_screener_startup_duration_ms',
    {
      description: 'Time from screener construction to a verified ready model.',
      unit: 'ms',
    }
  )
  const screeningCounter = meter.createCounter('community_moderation_screenings_total', {
    description: 'Completed screening jobs by image disposition and terminal outcome.',
  })
  const screeningDurationHistogram = meter.createHistogram(
    'community_moderation_screening_duration_ms',
    {
      description: 'End-to-end screening duration for one BullMQ attempt.',
      unit: 'ms',
    }
  )
  const attemptFailureCounter = meter.createCounter(
    'community_moderation_screening_attempt_failures_total',
    {
      description: 'Failed screening attempts, including attempts BullMQ will retry.',
    }
  )
  const modelHealthCounter = meter.createCounter(
    'community_moderation_model_health_total',
    { description: 'Supervised inference runtime lifecycle transitions.' }
  )

  return {
    recordScreenerReadiness(selector, outcome, startupDurationMs) {
      readinessCounter.add(1, { selector, outcome })
      startupDurationHistogram.record(boundedDuration(startupDurationMs), { selector })
    },
    recordScreening(disposition, outcome, durationMs, attempt) {
      screeningCounter.add(1, {
        disposition,
        outcome,
        attempt: boundedAttempt(attempt),
      })
      screeningDurationHistogram.record(boundedDuration(durationMs), {
        disposition,
        outcome,
      })
    },
    recordAttemptFailure(outcome, attempt) {
      attemptFailureCounter.add(1, { outcome, attempt: boundedAttempt(attempt) })
    },
    recordModelHealth(state) {
      modelHealthCounter.add(1, { state })
    },
  }
}

/**
 * Wraps a meter so a metrics fault cannot change a moderation verdict. An
 * exporter that is unreachable, misconfigured or shutting down must not be able
 * to fail a screening job and send a post to `review_failed`.
 */
export function createSafeCommunityModerationMeter(
  meter: CommunityModerationMeter
): CommunityModerationMeter {
  return {
    recordScreenerReadiness(selector, outcome, startupDurationMs) {
      try {
        meter.recordScreenerReadiness(selector, outcome, startupDurationMs)
      } catch {
        // Metrics must not change moderation behaviour.
      }
    },
    recordScreening(disposition, outcome, durationMs, attempt) {
      try {
        meter.recordScreening(disposition, outcome, durationMs, attempt)
      } catch {
        // Metrics must not change moderation behaviour.
      }
    },
    recordAttemptFailure(outcome, attempt) {
      try {
        meter.recordAttemptFailure(outcome, attempt)
      } catch {
        // Metrics must not change moderation behaviour.
      }
    },
    recordModelHealth(state) {
      try {
        meter.recordModelHealth(state)
      } catch {
        // Metrics must not change moderation behaviour.
      }
    },
  }
}
