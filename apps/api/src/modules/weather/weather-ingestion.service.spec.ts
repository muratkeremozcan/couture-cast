// Learning path Step 16: Weather API ingestion service and durable worker ingestion.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-16-weather-api-ingestion-service-and-durable-worker-ingestion
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { WeatherProviderError } from './providers/weather-provider.error.js'
import type {
  NormalizedWeatherForecast,
  WeatherIngestionTarget,
} from './providers/weather.types.js'
import { WeatherIngestionService } from './weather-ingestion.service.js'

const target: WeatherIngestionTarget = {
  locationKey: 'new-york-ny',
  latitude: 40.7128,
  longitude: -74.006,
}

function buildForecast(provider: NormalizedWeatherForecast['provider']) {
  return {
    provider,
    locationKey: target.locationKey,
    latitude: 40.7128,
    longitude: -74.006,
    timezone: 'America/New_York',
    providerUpdatedAt: new Date('2026-07-06T13:00:00.000Z'),
    fetchedAt: new Date('2026-07-06T13:30:00.000Z'),
    current: {
      temperature: 21,
      feelsLike: 20,
      condition: 'rain',
      providerConditionText: 'light rain',
      providerWeatherCode: '500',
      windSpeed: 4,
      humidity: 55,
    },
    hourly: Array.from({ length: 48 }, (_, index) => ({
      forecastAt: new Date(Date.UTC(2026, 6, 6, 14 + index)),
      temperature: 21,
      feelsLike: 20,
      precipitationProbability: 0.25,
      precipitationAmount: 0.4,
      windSpeed: 4,
      windGust: 6,
      condition: 'rain',
      providerConditionText: 'light rain',
      providerWeatherCode: '500',
    })),
    alerts: [],
  } satisfies NormalizedWeatherForecast
}

function providerError(
  provider: NormalizedWeatherForecast['provider'],
  kind: ConstructorParameters<typeof WeatherProviderError>[1]['kind'],
  statusCode?: number
) {
  return new WeatherProviderError(`${provider} failed`, {
    provider,
    kind,
    statusCode,
  })
}

function createService(input: {
  primaryResults: unknown[]
  secondaryResults?: unknown[]
}) {
  const primaryProvider = {
    fetchForecast: vi.fn(),
  }
  const secondaryProvider = {
    fetchForecast: vi.fn(),
  }

  for (const result of input.primaryResults) {
    if (result instanceof Error) {
      primaryProvider.fetchForecast.mockRejectedValueOnce(result)
    } else {
      primaryProvider.fetchForecast.mockResolvedValueOnce(result)
    }
  }

  for (const result of input.secondaryResults ?? []) {
    if (result instanceof Error) {
      secondaryProvider.fetchForecast.mockRejectedValueOnce(result)
    } else {
      secondaryProvider.fetchForecast.mockResolvedValueOnce(result)
    }
  }

  const repository = {
    persistForecast: vi.fn().mockResolvedValue({
      id: 'persisted-weather',
      fetched_at: new Date('2026-07-06T13:30:00.000Z'),
    }),
    recordProviderFailure: vi.fn().mockResolvedValue(undefined),
    recordProviderSuccess: vi.fn().mockResolvedValue(undefined),
  }
  const queryService = {
    getLatestWeather: vi.fn().mockResolvedValue({
      status: 'cached',
      data: {
        id: 'cached-weather',
        fetched_at: new Date('2026-07-06T13:20:00.000Z'),
      },
      message: 'Using recently cached weather data.',
    }),
  }
  const sleeper = vi.fn().mockResolvedValue(undefined)
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }
  const meter = {
    recordProviderRequest: vi.fn(),
    recordRateLimit: vi.fn(),
    recordIngestion: vi.fn(),
    recordFallbackOutcome: vi.fn(),
    recordSnapshotAge: vi.fn(),
  }
  const alertProcessor = {
    process: vi.fn().mockResolvedValue([]),
  }

  const service = new WeatherIngestionService(
    primaryProvider,
    secondaryProvider,
    repository as never,
    queryService as never,
    undefined,
    sleeper,
    logger as never,
    meter,
    alertProcessor as never
  )

  return {
    service,
    primaryProvider,
    secondaryProvider,
    repository,
    queryService,
    sleeper,
    logger,
    meter,
    alertProcessor,
  }
}

describe('WeatherIngestionService', () => {
  it('persists a successful primary forecast without calling the secondary provider', async () => {
    const forecast = buildForecast('openweather')
    const {
      service,
      primaryProvider,
      secondaryProvider,
      repository,
      logger,
      meter,
      alertProcessor,
    } = createService({
      primaryResults: [forecast],
    })

    await expect(service.ingestTarget(target)).resolves.toMatchObject({
      outcome: 'persisted',
      provider: 'openweather',
    })

    expect(primaryProvider.fetchForecast).toHaveBeenCalledTimes(1)
    expect(secondaryProvider.fetchForecast).not.toHaveBeenCalled()
    expect(repository.persistForecast).toHaveBeenCalledWith(forecast)
    expect(alertProcessor.process).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'persisted-weather' }),
      forecast
    )
    expect(repository.recordProviderSuccess).toHaveBeenCalledWith(
      'new-york-ny',
      expect.any(Date)
    )
    expect(repository.persistForecast.mock.invocationCallOrder[0]).toBeLessThan(
      alertProcessor.process.mock.invocationCallOrder[0]!
    )
    expect(alertProcessor.process.mock.invocationCallOrder[0]).toBeLessThan(
      repository.recordProviderSuccess.mock.invocationCallOrder[0]!
    )
    expect(repository.recordProviderFailure).not.toHaveBeenCalled()
    expect(logger.info).toHaveBeenCalledWith('weather_provider_attempt', {
      provider: 'openweather',
      attempt: 1,
    })
    expect(logger.info).toHaveBeenCalledWith('weather_ingestion_completed', {
      provider: 'openweather',
      outcome: 'persisted',
    })
    expect(meter.recordProviderRequest).toHaveBeenCalledWith(
      'openweather',
      'success',
      expect.any(Number),
      undefined
    )
    expect(meter.recordIngestion).toHaveBeenCalledWith('persisted')
    expect(meter.recordSnapshotAge).toHaveBeenCalledWith('persisted', expect.any(Number))
  })

  it('does not fail the ingestion attempt when alert processing fails', async () => {
    const forecast = buildForecast('openweather')
    const { service, alertProcessor, repository, meter } = createService({
      primaryResults: [forecast],
    })
    alertProcessor.process.mockRejectedValueOnce(new Error('event store unavailable'))

    await expect(service.ingestTarget(target)).resolves.not.toThrow()

    expect(repository.persistForecast).toHaveBeenCalledWith(forecast)
    expect(repository.recordProviderSuccess).toHaveBeenCalled()
    expect(meter.recordIngestion).toHaveBeenCalledWith('persisted')
  })

  it('uses exactly three primary attempts with 5s and 15s delays before failover', async () => {
    const secondaryForecast = buildForecast('weatherapi')
    const { service, primaryProvider, secondaryProvider, sleeper, repository } =
      createService({
        primaryResults: [
          providerError('openweather', 'timeout'),
          providerError('openweather', 'retryable_http', 503),
          providerError('openweather', 'timeout'),
        ],
        secondaryResults: [secondaryForecast],
      })

    await expect(service.ingestTarget(target)).resolves.toMatchObject({
      outcome: 'persisted',
      provider: 'weatherapi',
    })

    expect(primaryProvider.fetchForecast).toHaveBeenCalledTimes(3)
    expect(sleeper).toHaveBeenNthCalledWith(1, 5000, expect.any(AbortSignal))
    expect(sleeper).toHaveBeenNthCalledWith(2, 15000, expect.any(AbortSignal))
    expect(secondaryProvider.fetchForecast).toHaveBeenCalledTimes(1)
    expect(repository.persistForecast).toHaveBeenCalledWith(secondaryForecast)
  })

  it('fails over immediately on a primary rate limit without sleeping', async () => {
    const secondaryForecast = buildForecast('weatherapi')
    const { service, primaryProvider, secondaryProvider, sleeper } = createService({
      primaryResults: [providerError('openweather', 'rate_limit', 429)],
      secondaryResults: [secondaryForecast],
    })

    await expect(service.ingestTarget(target)).resolves.toMatchObject({
      outcome: 'persisted',
      provider: 'weatherapi',
    })

    expect(primaryProvider.fetchForecast).toHaveBeenCalledTimes(1)
    expect(sleeper).not.toHaveBeenCalled()
    expect(secondaryProvider.fetchForecast).toHaveBeenCalledTimes(1)
  })

  it('returns latest persisted weather when both providers fail', async () => {
    const { service, queryService, repository, logger, meter, alertProcessor } =
      createService({
        primaryResults: [providerError('openweather', 'invalid_response')],
        secondaryResults: [providerError('weatherapi', 'non_retryable_http', 400)],
      })

    await expect(service.ingestTarget(target)).resolves.toMatchObject({
      outcome: 'fallback',
      fallback: {
        status: 'cached',
        message: 'Using recently cached weather data.',
      },
    })

    expect(repository.persistForecast).not.toHaveBeenCalled()
    expect(alertProcessor.process).not.toHaveBeenCalled()
    expect(repository.recordProviderFailure).toHaveBeenCalledWith(
      'new-york-ny',
      expect.any(Date)
    )
    expect(queryService.getLatestWeather).toHaveBeenCalledWith('new-york-ny', {
      liveProviderFailed: true,
    })
    expect(logger.warn).toHaveBeenCalledWith('weather_provider_failover', {
      fromProvider: 'openweather',
      toProvider: 'weatherapi',
      reason: 'invalid_response',
      statusClass: undefined,
    })
    expect(logger.warn).toHaveBeenCalledWith('weather_fallback_outcome', {
      outcome: 'cached',
    })
    expect(meter.recordFallbackOutcome).toHaveBeenCalledWith('cached')
    expect(meter.recordIngestion).toHaveBeenCalledWith('fallback')
  })

  it('counts secondary provider rate limits in rate-limit telemetry', async () => {
    const { service, meter } = createService({
      primaryResults: [providerError('openweather', 'invalid_response')],
      secondaryResults: [providerError('weatherapi', 'rate_limit', 429)],
    })

    await expect(service.ingestTarget(target)).resolves.toMatchObject({
      outcome: 'fallback',
    })

    expect(meter.recordRateLimit).toHaveBeenCalledWith('weatherapi')
  })

  it('does not fail ingestion when telemetry recording throws after persistence', async () => {
    const forecast = buildForecast('openweather')
    const { service, meter } = createService({
      primaryResults: [forecast],
    })
    meter.recordIngestion.mockImplementationOnce(() => {
      throw new Error('metrics backend unavailable')
    })

    await expect(service.ingestTarget(target)).resolves.toMatchObject({
      outcome: 'persisted',
      provider: 'openweather',
    })
  })

  it('rejects abort-only provider failures instead of falling back', async () => {
    const { service, queryService, repository } = createService({
      primaryResults: [providerError('openweather', 'invalid_target')],
    })

    await expect(service.ingestTarget(target)).rejects.toMatchObject({
      kind: 'invalid_target',
    })

    expect(repository.persistForecast).not.toHaveBeenCalled()
    expect(queryService.getLatestWeather).not.toHaveBeenCalled()
  })

  it('keeps weather logs and metrics free of coordinates, API keys, user ids, and raw payloads', async () => {
    const primaryFailure = new WeatherProviderError('primary failed with secret', {
      provider: 'openweather',
      kind: 'retryable_http',
      statusCode: 503,
      cause: new Error('OPENWEATHER_API_KEY=secret 40.7128 -74.006 user-123 raw payload'),
    })
    const secondaryFailure = new WeatherProviderError('secondary failed with secret', {
      provider: 'weatherapi',
      kind: 'non_retryable_http',
      statusCode: 400,
      cause: new Error('WEATHERAPI_API_KEY=secret 40.7128 -74.006 user-123 raw payload'),
    })
    const { service, logger, meter } = createService({
      primaryResults: [primaryFailure],
      secondaryResults: [secondaryFailure],
    })

    await expect(service.ingestTarget(target)).resolves.toMatchObject({
      outcome: 'fallback',
    })

    const telemetryPayload = JSON.stringify({
      logs: [logger.info.mock.calls, logger.warn.mock.calls, logger.error.mock.calls],
      metrics: [
        meter.recordProviderRequest.mock.calls,
        meter.recordRateLimit.mock.calls,
        meter.recordIngestion.mock.calls,
        meter.recordFallbackOutcome.mock.calls,
        meter.recordSnapshotAge.mock.calls,
      ],
    })

    expect(telemetryPayload).not.toContain('40.7128')
    expect(telemetryPayload).not.toContain('-74.006')
    expect(telemetryPayload).not.toContain('OPENWEATHER_API_KEY')
    expect(telemetryPayload).not.toContain('WEATHERAPI_API_KEY')
    expect(telemetryPayload).not.toContain('secret')
    expect(telemetryPayload).not.toContain('user-123')
    expect(telemetryPayload).not.toContain('raw payload')
  })

  it('keeps ingestion failure logs free of coordinates, API keys, user ids, and raw payloads', async () => {
    const abortFailure = new WeatherProviderError('aborted with secret', {
      provider: 'openweather',
      kind: 'aborted',
      cause: new Error('OPENWEATHER_API_KEY=secret 40.7128 -74.006 user-123 raw payload'),
    })
    const { service, logger, meter } = createService({
      primaryResults: [abortFailure],
    })

    await expect(service.ingestTarget(target)).rejects.toMatchObject({
      kind: 'aborted',
    })

    const telemetryPayload = JSON.stringify({
      logs: [logger.info.mock.calls, logger.warn.mock.calls, logger.error.mock.calls],
      metrics: [
        meter.recordProviderRequest.mock.calls,
        meter.recordRateLimit.mock.calls,
        meter.recordIngestion.mock.calls,
        meter.recordFallbackOutcome.mock.calls,
        meter.recordSnapshotAge.mock.calls,
      ],
    })

    expect(logger.error).toHaveBeenCalledWith('weather_ingestion_failed', {
      outcome: 'failed',
      errorKind: 'aborted',
    })
    expect(telemetryPayload).not.toContain('40.7128')
    expect(telemetryPayload).not.toContain('-74.006')
    expect(telemetryPayload).not.toContain('OPENWEATHER_API_KEY')
    expect(telemetryPayload).not.toContain('secret')
    expect(telemetryPayload).not.toContain('user-123')
    expect(telemetryPayload).not.toContain('raw payload')
  })

  describe('non-provider failure paths', () => {
    it('reports an unexpected error kind when the failure is not a provider error', async () => {
      // Persistence and alerting failures still have to be observable as failed
      // ingestions, even though they carry no provider error kind.
      const { service, repository, logger, meter } = createService({
        primaryResults: [buildForecast('openweather')],
      })
      repository.persistForecast.mockRejectedValue(new Error('database unreachable'))

      await expect(service.ingestTarget(target)).rejects.toThrow('database unreachable')
      expect(meter.recordIngestion).toHaveBeenCalledWith('failed')
      expect(logger.error).toHaveBeenCalledWith('weather_ingestion_failed', {
        outcome: 'failed',
        errorKind: 'unexpected_error',
      })
    })

    it('persists the forecast even when alert processing throws a non-Error', async () => {
      // Alert processing is downstream of the snapshot; it must never lose it.
      const { service, alertProcessor, logger } = createService({
        primaryResults: [buildForecast('openweather')],
      })
      alertProcessor.process.mockRejectedValue('alert engine offline')

      await expect(service.ingestTarget(target)).resolves.toMatchObject({
        outcome: 'persisted',
      })
      expect(logger.error).toHaveBeenCalledWith(
        'Alert processing failed during weather ingestion',
        expect.objectContaining({ error: 'alert engine offline' })
      )
    })

    it('skips the snapshot-age metric when the fallback has no cached data', async () => {
      const { service, queryService, meter } = createService({
        primaryResults: [providerError('openweather', 'network')],
        secondaryResults: [providerError('weatherapi', 'network')],
      })
      queryService.getLatestWeather.mockResolvedValue({
        status: 'unavailable',
        data: null,
        message: 'No cached weather data is available.',
      })

      await expect(service.ingestTarget(target)).resolves.toMatchObject({
        outcome: 'fallback',
      })
      expect(meter.recordFallbackOutcome).toHaveBeenCalledWith('unavailable')
      expect(meter.recordSnapshotAge).not.toHaveBeenCalled()
    })

    it.each(['aborted', 'invalid_target'] as const)(
      'rethrows a %s failure from the secondary provider instead of falling back',
      async (kind) => {
        // These two kinds mean retrying is pointless, so the caller must see them.
        const { service, queryService } = createService({
          primaryResults: [providerError('openweather', 'network')],
          secondaryResults: [providerError('weatherapi', kind)],
        })

        await expect(service.ingestTarget(target)).rejects.toBeInstanceOf(
          WeatherProviderError
        )
        expect(queryService.getLatestWeather).not.toHaveBeenCalled()
      }
    )
  })

  describe('error normalisation', () => {
    it('treats a thrown non-Error from a provider as a network failure', async () => {
      const { service, meter, primaryProvider } = createService({
        primaryResults: [],
        secondaryResults: [buildForecast('weatherapi')],
      })
      primaryProvider.fetchForecast.mockRejectedValue('provider exploded')

      await expect(service.ingestTarget(target)).resolves.toMatchObject({
        outcome: 'persisted',
        provider: 'weatherapi',
      })
      expect(meter.recordProviderRequest).toHaveBeenCalledWith(
        'openweather',
        'network',
        expect.any(Number),
        undefined
      )
    })

    it.each(['AbortError', 'AbortSignal'])(
      'treats a thrown %s as an aborted ingestion',
      async (errorName) => {
        const abortError = Object.assign(new Error('aborted'), { name: errorName })
        const { service, secondaryProvider } = createService({
          primaryResults: [abortError],
        })

        await expect(service.ingestTarget(target)).rejects.toMatchObject({
          kind: 'aborted',
        })
        // An abort must stop the failover chain rather than burn the backup quota.
        expect(secondaryProvider.fetchForecast).not.toHaveBeenCalled()
      }
    )

    it('treats any provider failure as aborted once the caller signal is aborted', async () => {
      const controller = new AbortController()
      const { service, secondaryProvider } = createService({
        primaryResults: [new Error('socket hang up')],
      })
      controller.abort()

      await expect(service.ingestTarget(target, controller.signal)).rejects.toMatchObject(
        { kind: 'aborted' }
      )
      expect(secondaryProvider.fetchForecast).not.toHaveBeenCalled()
    })
  })

  describe('default collaborators', () => {
    const createBareService = () => {
      const primaryProvider = { fetchForecast: vi.fn() }
      const secondaryProvider = { fetchForecast: vi.fn() }
      const repository = {
        persistForecast: vi.fn().mockResolvedValue({
          id: 'persisted-weather',
          fetched_at: new Date('2026-07-06T13:30:00.000Z'),
        }),
        recordProviderFailure: vi.fn().mockResolvedValue(undefined),
        recordProviderSuccess: vi.fn().mockResolvedValue(undefined),
      }
      const queryService = {
        getLatestWeather: vi.fn().mockResolvedValue({
          status: 'unavailable',
          data: null,
          message: 'No cached weather data is available.',
        }),
      }

      return {
        primaryProvider,
        secondaryProvider,
        repository,
        queryService,
        service: new WeatherIngestionService(
          primaryProvider,
          secondaryProvider,
          repository as never,
          queryService as never
        ),
      }
    }

    beforeEach(() => {
      vi.stubEnv('LOG_LEVEL', 'silent')
    })

    afterEach(() => {
      vi.unstubAllEnvs()
      vi.useRealTimers()
    })

    it('ingests successfully with only its required dependencies wired', async () => {
      // Nest resolves the clock, sleeper, logger, and meter as optional; the
      // service has to stand up without any of them.
      const { primaryProvider, repository, service } = createBareService()
      primaryProvider.fetchForecast.mockResolvedValue(buildForecast('openweather'))

      await expect(service.ingestTarget(target)).resolves.toMatchObject({
        outcome: 'persisted',
        provider: 'openweather',
      })
      expect(repository.recordProviderSuccess).toHaveBeenCalledOnce()
    })

    it('waits out the real backoff delay between primary retries', async () => {
      vi.useFakeTimers()
      const { primaryProvider, secondaryProvider, service } = createBareService()
      primaryProvider.fetchForecast.mockRejectedValue(
        providerError('openweather', 'timeout')
      )
      secondaryProvider.fetchForecast.mockResolvedValue(buildForecast('weatherapi'))

      const ingestion = service.ingestTarget(target)
      // Two 5s/15s backoffs sit between the three primary attempts.
      await vi.advanceTimersByTimeAsync(20_000)

      await expect(ingestion).resolves.toMatchObject({ provider: 'weatherapi' })
      expect(primaryProvider.fetchForecast).toHaveBeenCalledTimes(3)
    })

    it('does not start a backoff timer when the caller signal is already aborted', async () => {
      vi.useFakeTimers()
      const controller = new AbortController()
      controller.abort()
      const { primaryProvider, service } = createBareService()
      primaryProvider.fetchForecast.mockRejectedValueOnce(
        providerError('openweather', 'timeout')
      )

      const ingestion = service.ingestTarget(target, controller.signal)

      await expect(ingestion).rejects.toBeInstanceOf(Error)
      expect(vi.getTimerCount()).toBe(0)
    })

    it.each([
      { name: 'an Error reason', reason: new Error('ingestion deadline exceeded') },
      { name: 'a non-Error reason', reason: 'deadline' },
    ])('aborts an in-flight backoff sleep with $name', async ({ reason }) => {
      vi.useFakeTimers()
      const controller = new AbortController()
      const { primaryProvider, service } = createBareService()
      primaryProvider.fetchForecast.mockRejectedValue(
        providerError('openweather', 'timeout')
      )

      const ingestion = service.ingestTarget(target, controller.signal)
      await vi.advanceTimersByTimeAsync(0)
      controller.abort(reason)

      // The sleep must reject immediately rather than holding the job for 5s.
      await expect(ingestion).rejects.toBeInstanceOf(Error)
      expect(primaryProvider.fetchForecast).toHaveBeenCalledTimes(1)
    })
  })
})
