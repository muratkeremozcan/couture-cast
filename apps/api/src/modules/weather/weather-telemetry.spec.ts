import { describe, expect, it, vi } from 'vitest'
import { createOpenTelemetryWeatherMeter } from './weather-telemetry'

describe('weather telemetry', () => {
  it('records provider, rate-limit, ingestion, fallback, and snapshot-age metrics with bounded attributes', () => {
    const providerRequestCounter = { add: vi.fn() }
    const providerDurationHistogram = { record: vi.fn() }
    const rateLimitCounter = { add: vi.fn() }
    const ingestionCounter = { add: vi.fn() }
    const fallbackCounter = { add: vi.fn() }
    const snapshotAgeHistogram = { record: vi.fn() }
    const meter = {
      createCounter: vi
        .fn()
        .mockReturnValueOnce(providerRequestCounter)
        .mockReturnValueOnce(rateLimitCounter)
        .mockReturnValueOnce(ingestionCounter)
        .mockReturnValueOnce(fallbackCounter),
      createHistogram: vi
        .fn()
        .mockReturnValueOnce(providerDurationHistogram)
        .mockReturnValueOnce(snapshotAgeHistogram),
    }

    const weatherMeter = createOpenTelemetryWeatherMeter(meter as never)

    weatherMeter.recordProviderRequest('openweather', 'retryable_http', 123, '5xx')
    weatherMeter.recordRateLimit('weatherapi')
    weatherMeter.recordIngestion('fallback')
    weatherMeter.recordFallbackOutcome('stale')
    weatherMeter.recordSnapshotAge('stale', 3_600_001)

    expect(meter.createCounter).toHaveBeenCalledWith(
      'weather_provider_requests_total',
      expect.any(Object)
    )
    expect(meter.createHistogram).toHaveBeenCalledWith(
      'weather_provider_request_duration_ms',
      expect.any(Object)
    )
    expect(providerRequestCounter.add).toHaveBeenCalledWith(1, {
      provider: 'openweather',
      outcome: 'retryable_http',
      status_class: '5xx',
    })
    expect(providerDurationHistogram.record).toHaveBeenCalledWith(123, {
      provider: 'openweather',
      outcome: 'retryable_http',
      status_class: '5xx',
    })
    expect(rateLimitCounter.add).toHaveBeenCalledWith(1, {
      provider: 'weatherapi',
    })
    expect(ingestionCounter.add).toHaveBeenCalledWith(1, {
      outcome: 'fallback',
    })
    expect(fallbackCounter.add).toHaveBeenCalledWith(1, {
      outcome: 'stale',
    })
    expect(snapshotAgeHistogram.record).toHaveBeenCalledWith(3_600_001, {
      outcome: 'stale',
    })
  })

  it('drops invalid status classes and clamps negative snapshot ages', () => {
    const providerRequestCounter = { add: vi.fn() }
    const providerDurationHistogram = { record: vi.fn() }
    const rateLimitCounter = { add: vi.fn() }
    const ingestionCounter = { add: vi.fn() }
    const fallbackCounter = { add: vi.fn() }
    const snapshotAgeHistogram = { record: vi.fn() }
    const meter = {
      createCounter: vi
        .fn()
        .mockReturnValueOnce(providerRequestCounter)
        .mockReturnValueOnce(rateLimitCounter)
        .mockReturnValueOnce(ingestionCounter)
        .mockReturnValueOnce(fallbackCounter),
      createHistogram: vi
        .fn()
        .mockReturnValueOnce(providerDurationHistogram)
        .mockReturnValueOnce(snapshotAgeHistogram),
    }

    const weatherMeter = createOpenTelemetryWeatherMeter(meter as never)

    weatherMeter.recordProviderRequest('openweather', 'retryable_http', 10, '6xx')
    weatherMeter.recordProviderRequest('openweather', 'retryable_http', 11, 'abc')
    weatherMeter.recordProviderRequest('openweather', 'retryable_http', 12, '200')
    weatherMeter.recordSnapshotAge('cached', -25)

    expect(providerRequestCounter.add).toHaveBeenNthCalledWith(1, 1, {
      provider: 'openweather',
      outcome: 'retryable_http',
    })
    expect(providerRequestCounter.add).toHaveBeenNthCalledWith(2, 1, {
      provider: 'openweather',
      outcome: 'retryable_http',
    })
    expect(providerRequestCounter.add).toHaveBeenNthCalledWith(3, 1, {
      provider: 'openweather',
      outcome: 'retryable_http',
    })
    expect(providerDurationHistogram.record).toHaveBeenNthCalledWith(1, 10, {
      provider: 'openweather',
      outcome: 'retryable_http',
    })
    expect(providerDurationHistogram.record).toHaveBeenNthCalledWith(2, 11, {
      provider: 'openweather',
      outcome: 'retryable_http',
    })
    expect(providerDurationHistogram.record).toHaveBeenNthCalledWith(3, 12, {
      provider: 'openweather',
      outcome: 'retryable_http',
    })
    expect(snapshotAgeHistogram.record).toHaveBeenCalledWith(0, {
      outcome: 'cached',
    })
  })
})
