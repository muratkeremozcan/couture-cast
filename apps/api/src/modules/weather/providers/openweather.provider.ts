import type { z } from 'zod'
import { mapOpenWeatherCondition } from './weather-condition.mapper.js'
import {
  classifyFetchFailure,
  classifyHttpFailure,
  WeatherProviderError,
} from './weather-provider.error.js'
import type { IWeatherProvider } from './weather-provider.interface.js'
import type { OpenWeatherHourlySchema } from './weather.schemas.js'
import {
  NormalizedWeatherForecastSchema,
  OpenWeatherResponseSchema,
  WeatherIngestionTargetSchema,
} from './weather.schemas.js'
import type {
  NormalizedWeatherForecast,
  WeatherIngestionTarget,
} from './weather.types.js'

const PROVIDER = 'openweather' as const
const DEFAULT_BASE_URL = 'https://api.openweathermap.org/data/3.0/onecall'
const LOCATION_TOLERANCE_DEGREES = 0.02

function longitudeDistance(left: number, right: number): number {
  return Math.abs(((left - right + 540) % 360) - 180)
}

export interface OpenWeatherProviderOptions {
  apiKey?: string
  baseUrl?: string
  env?: NodeJS.ProcessEnv
}

export class OpenWeatherProvider implements IWeatherProvider {
  private readonly apiKey: string
  private readonly baseUrl: string

  constructor(options: OpenWeatherProviderOptions = {}) {
    const env = options.env ?? process.env
    this.apiKey = options.apiKey ?? env.OPENWEATHER_API_KEY ?? ''
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL
  }

  async fetchForecast(
    target: WeatherIngestionTarget,
    signal: AbortSignal
  ): Promise<NormalizedWeatherForecast> {
    if (!this.apiKey) {
      throw new WeatherProviderError('OpenWeather API key is not configured', {
        provider: PROVIDER,
        kind: 'invalid_configuration',
      })
    }

    const targetResult = WeatherIngestionTargetSchema.safeParse(target)
    if (!targetResult.success) {
      throw new WeatherProviderError('OpenWeather target is invalid', {
        provider: PROVIDER,
        kind: 'invalid_target',
      })
    }

    const { latitude, longitude, locationKey } = targetResult.data
    const roundedLat = Math.round(latitude * 10000) / 10000
    const roundedLon = Math.round(longitude * 10000) / 10000
    const url = this.buildUrl(roundedLat, roundedLon)

    let response: Response
    try {
      response = await fetch(url, { signal })
    } catch (error: unknown) {
      throw classifyFetchFailure(PROVIDER, error, signal)
    }

    if (!response.ok) {
      throw classifyHttpFailure(PROVIDER, response.status)
    }
    const fetchedAt = new Date()

    let rawData: unknown
    try {
      rawData = await response.json()
    } catch (error: unknown) {
      if (
        signal.aborted ||
        (error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name))
      ) {
        throw classifyFetchFailure(PROVIDER, error, signal)
      }
      throw new WeatherProviderError('OpenWeather returned malformed JSON', {
        provider: PROVIDER,
        kind: 'invalid_response',
      })
    }
    const parsed = OpenWeatherResponseSchema.safeParse(rawData)
    if (!parsed.success) {
      throw new WeatherProviderError('OpenWeather response validation failed', {
        provider: PROVIDER,
        kind: 'invalid_response',
        cause: parsed.error,
      })
    }
    const data = parsed.data

    this.validateLocationMatch(data, roundedLat, roundedLon)

    const currentHourEpoch = Math.floor(fetchedAt.getTime() / 3600000) * 3600
    const uniqueHours = this.extractUniqueHourly(data.hourly, currentHourEpoch)

    const hourlyEntries = uniqueHours.map((hour) => {
      const providerCondition = hour.weather[0]!
      const precipitationAmount = (hour.rain?.['1h'] ?? 0) + (hour.snow?.['1h'] ?? 0)

      return {
        forecastAt: new Date(hour.dt * 1000),
        temperature: hour.temp,
        feelsLike: hour.feels_like,
        precipitationProbability: hour.pop,
        precipitationAmount,
        windSpeed: hour.wind_speed,
        windGust: hour.wind_gust ?? hour.wind_speed,
        condition: mapOpenWeatherCondition(providerCondition.id),
        providerConditionText: providerCondition.description,
        providerWeatherCode: String(providerCondition.id),
      }
    })

    const normalizedForecast: NormalizedWeatherForecast = {
      provider: PROVIDER,
      locationKey,
      latitude: roundedLat,
      longitude: roundedLon,
      timezone: data.timezone,
      providerUpdatedAt: new Date(data.current.dt * 1000),
      fetchedAt,
      current: {
        temperature: data.current.temp,
        feelsLike: data.current.feels_like,
        windSpeed: data.current.wind_speed,
        humidity: data.current.humidity,
        condition: mapOpenWeatherCondition(data.current.weather[0]!.id),
        providerConditionText: data.current.weather[0]!.description,
        providerWeatherCode: String(data.current.weather[0]!.id),
      },
      hourly: hourlyEntries,
      alerts: (data.alerts ?? [])
        .filter((alert) => alert.end > alert.start)
        .map((alert) => ({
          event: alert.event,
          description: alert.description,
          start: new Date(alert.start * 1000),
          end: new Date(alert.end * 1000),
        })),
    }

    const finalValidation = NormalizedWeatherForecastSchema.safeParse(normalizedForecast)
    if (!finalValidation.success) {
      throw new WeatherProviderError(
        'OpenWeather normalized response validation failed',
        {
          provider: PROVIDER,
          kind: 'invalid_response',
          cause: finalValidation.error,
        }
      )
    }

    return finalValidation.data
  }

  private validateLocationMatch(
    data: { lat: number; lon: number },
    roundedLat: number,
    roundedLon: number
  ): void {
    if (
      Math.abs(data.lat - roundedLat) > LOCATION_TOLERANCE_DEGREES ||
      longitudeDistance(data.lon, roundedLon) > LOCATION_TOLERANCE_DEGREES
    ) {
      throw new WeatherProviderError(
        'OpenWeather response location did not match the target',
        {
          provider: PROVIDER,
          kind: 'invalid_response',
        }
      )
    }
  }

  private extractUniqueHourly(
    hourly: z.infer<typeof OpenWeatherHourlySchema>[],
    currentHourEpoch: number
  ): z.infer<typeof OpenWeatherHourlySchema>[] {
    const futureHours = hourly.filter((hour) => hour.dt >= currentHourEpoch)
    if (new Set(futureHours.map((hour) => hour.dt)).size !== futureHours.length) {
      throw new WeatherProviderError('OpenWeather returned duplicate hourly forecasts', {
        provider: PROVIDER,
        kind: 'invalid_response',
      })
    }
    const uniqueHours = futureHours.sort((left, right) => left.dt - right.dt).slice(0, 48)

    if (uniqueHours.length !== 48) {
      throw new WeatherProviderError(
        'OpenWeather returned an incomplete hourly forecast',
        {
          provider: PROVIDER,
          kind: 'invalid_response',
        }
      )
    }
    return uniqueHours
  }

  private buildUrl(latitude: number, longitude: number): URL {
    let url: URL
    try {
      url = new URL(this.baseUrl)
    } catch {
      throw new WeatherProviderError('OpenWeather base URL is invalid', {
        provider: PROVIDER,
        kind: 'invalid_configuration',
      })
    }

    url.searchParams.set('lat', String(latitude))
    url.searchParams.set('lon', String(longitude))
    url.searchParams.set('units', 'metric')
    url.searchParams.set('exclude', 'minutely,daily')
    url.searchParams.set('appid', this.apiKey)
    return url
  }
}
