import { describe, expect, it, vi } from 'vitest'

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
    persistForecast: vi.fn().mockResolvedValue({ id: 'persisted-weather' }),
  }
  const queryService = {
    getLatestWeather: vi.fn().mockResolvedValue({
      status: 'cached',
      data: { id: 'cached-weather' },
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
  }

  const service = new WeatherIngestionService(
    primaryProvider,
    secondaryProvider,
    repository as never,
    queryService as never,
    undefined,
    sleeper,
    logger as never,
    meter
  )

  return {
    service,
    primaryProvider,
    secondaryProvider,
    repository,
    queryService,
    sleeper,
  }
}

describe('WeatherIngestionService', () => {
  it('persists a successful primary forecast without calling the secondary provider', async () => {
    const forecast = buildForecast('openweather')
    const { service, primaryProvider, secondaryProvider, repository } = createService({
      primaryResults: [forecast],
    })

    await expect(service.ingestTarget(target)).resolves.toMatchObject({
      outcome: 'persisted',
      provider: 'openweather',
    })

    expect(primaryProvider.fetchForecast).toHaveBeenCalledTimes(1)
    expect(secondaryProvider.fetchForecast).not.toHaveBeenCalled()
    expect(repository.persistForecast).toHaveBeenCalledWith(forecast)
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
    const { service, queryService, repository } = createService({
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
    expect(queryService.getLatestWeather).toHaveBeenCalledWith('new-york-ny', {
      liveProviderFailed: true,
    })
  })
})
