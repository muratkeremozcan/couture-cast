import { metrics } from '@opentelemetry/api'
import type { WeatherProviderName } from './providers/weather.types'

export const WEATHER_LOG_FEATURE = 'weather'

export const WEATHER_LOG_EVENTS = {
  providerAttempt: 'weather_provider_attempt',
  providerRequestFailed: 'weather_provider_request_failed',
  providerFailover: 'weather_provider_failover',
  ingestionCompleted: 'weather_ingestion_completed',
  ingestionFailed: 'weather_ingestion_failed',
  fallbackOutcome: 'weather_fallback_outcome',
} as const

type MetricAttributes = Record<string, string>

type OtelCounter = {
  add(value: number, attributes?: MetricAttributes): void
}

type OtelHistogram = {
  record(value: number, attributes?: MetricAttributes): void
}

type OtelMeter = {
  createCounter(name: string, options?: Record<string, unknown>): OtelCounter
  createHistogram(name: string, options?: Record<string, unknown>): OtelHistogram
}

export type WeatherIngestionMetricOutcome = 'persisted' | 'fallback' | 'failed'
export type WeatherFallbackMetricOutcome = 'fresh' | 'cached' | 'stale' | 'unavailable'

export interface WeatherMeter {
  recordProviderRequest(
    provider: WeatherProviderName,
    outcome: string,
    durationMs: number,
    statusClass?: string
  ): void
  recordRateLimit(provider: WeatherProviderName): void
  recordIngestion(outcome: WeatherIngestionMetricOutcome): void
  recordFallbackOutcome(outcome: WeatherFallbackMetricOutcome): void
  recordSnapshotAge(
    outcome: WeatherFallbackMetricOutcome | 'persisted',
    ageMs: number
  ): void
}

function boundedStatusClass(statusClass: string | undefined): string | undefined {
  return statusClass && /^[1-5]xx$/u.test(statusClass) ? statusClass : undefined
}

function removeUndefinedAttributes(
  attributes: Record<string, string | undefined>
): MetricAttributes {
  return Object.fromEntries(
    Object.entries(attributes).filter(([, value]) => value !== undefined)
  ) as MetricAttributes
}

export function createOpenTelemetryWeatherMeter(
  meter: OtelMeter = metrics.getMeter('couturecast-api-weather')
): WeatherMeter {
  const providerRequestCounter = meter.createCounter('weather_provider_requests_total', {
    description: 'Weather provider requests by provider and bounded outcome.',
  })
  const providerDurationHistogram = meter.createHistogram(
    'weather_provider_request_duration_ms',
    {
      description: 'Weather provider request duration by provider and bounded outcome.',
      unit: 'ms',
    }
  )
  const rateLimitCounter = meter.createCounter('weather_provider_rate_limits_total', {
    description: 'Weather provider rate-limit responses by provider.',
  })
  const ingestionCounter = meter.createCounter('weather_ingestion_jobs_total', {
    description: 'Weather ingestion job outcomes.',
  })
  const fallbackCounter = meter.createCounter('weather_fallback_outcomes_total', {
    description: 'Latest-weather fallback outcomes after provider failure.',
  })
  const snapshotAgeHistogram = meter.createHistogram('weather_snapshot_age_ms', {
    description: 'Age of weather snapshots returned or persisted by ingestion.',
    unit: 'ms',
  })

  return {
    recordProviderRequest(provider, outcome, durationMs, statusClass) {
      const attributes = removeUndefinedAttributes({
        provider,
        outcome,
        status_class: boundedStatusClass(statusClass),
      })
      providerRequestCounter.add(1, attributes)
      providerDurationHistogram.record(durationMs, attributes)
    },
    recordRateLimit(provider) {
      rateLimitCounter.add(1, { provider })
    },
    recordIngestion(outcome) {
      ingestionCounter.add(1, { outcome })
    },
    recordFallbackOutcome(outcome) {
      fallbackCounter.add(1, { outcome })
    },
    recordSnapshotAge(outcome, ageMs) {
      snapshotAgeHistogram.record(Math.max(0, ageMs), { outcome })
    },
  }
}
