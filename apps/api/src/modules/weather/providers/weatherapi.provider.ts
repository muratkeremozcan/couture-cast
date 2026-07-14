import { Injectable } from '@nestjs/common'
import type { z } from 'zod'
import {
  mapWeatherApiAlertSeverity,
  mapWeatherApiCondition,
} from './weather-condition.mapper.js'
import {
  classifyFetchFailure,
  classifyHttpFailure,
  WeatherProviderError,
} from './weather-provider.error.js'
import type { IWeatherProvider } from './weather-provider.interface.js'
import type { WeatherApiHourSchema } from './weather.schemas.js'
import {
  NormalizedWeatherForecastSchema,
  WeatherApiResponseSchema,
  WeatherIngestionTargetSchema,
} from './weather.schemas.js'
import type {
  NormalizedWeatherAlert,
  NormalizedWeatherForecast,
  WeatherIngestionTarget,
} from './weather.types.js'

const PROVIDER = 'weatherapi' as const
const DEFAULT_BASE_URL = 'https://api.weatherapi.com/v1/forecast.json'
const LOCATION_TOLERANCE_DEGREES = 0.02

function longitudeDistance(left: number, right: number): number {
  return Math.abs(((left - right + 540) % 360) - 180)
}

export interface WeatherApiProviderOptions {
  apiKey?: string
  baseUrl?: string
  env?: NodeJS.ProcessEnv
}

@Injectable()
export class WeatherApiProvider implements IWeatherProvider {
  private readonly apiKey: string
  private readonly baseUrl: string

  constructor(options: WeatherApiProviderOptions = {}) {
    const env = options.env ?? process.env
    this.apiKey = options.apiKey ?? env.WEATHERAPI_API_KEY ?? ''
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL
  }

  async fetchForecast(
    target: WeatherIngestionTarget,
    signal: AbortSignal
  ): Promise<NormalizedWeatherForecast> {
    if (!this.apiKey) {
      throw new WeatherProviderError('WeatherAPI API key is not configured', {
        provider: PROVIDER,
        kind: 'invalid_configuration',
      })
    }

    const targetResult = WeatherIngestionTargetSchema.safeParse(target)
    if (!targetResult.success) {
      throw new WeatherProviderError('WeatherAPI target is invalid', {
        provider: PROVIDER,
        kind: 'invalid_target',
      })
    }

    const { latitude, longitude, locationKey, locationName } = targetResult.data
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
      throw new WeatherProviderError('WeatherAPI returned malformed JSON', {
        provider: PROVIDER,
        kind: 'invalid_response',
      })
    }
    const parsed = WeatherApiResponseSchema.safeParse(rawData)
    if (!parsed.success) {
      throw new WeatherProviderError('WeatherAPI response validation failed', {
        provider: PROVIDER,
        kind: 'invalid_response',
        cause: parsed.error,
      })
    }
    const data = parsed.data

    this.validateLocationMatch(data.location, roundedLat, roundedLon)

    const currentHourEpoch = Math.floor(fetchedAt.getTime() / 3600000) * 3600
    const allHours = data.forecast.forecastday.flatMap((day) => day.hour)
    const uniqueHours = this.extractUniqueHourly(allHours, currentHourEpoch)

    const hourlyEntries = uniqueHours.map((hour) => ({
      forecastAt: new Date(hour.time_epoch * 1000),
      temperature: hour.temp_c,
      feelsLike: hour.feelslike_c,
      precipitationProbability: Math.max(hour.chance_of_rain, hour.chance_of_snow) / 100,
      precipitationAmount: hour.precip_mm,
      windSpeed: hour.wind_kph / 3.6,
      windGust: (hour.gust_kph ?? hour.wind_kph) / 3.6,
      condition: mapWeatherApiCondition(hour.condition.code),
      providerConditionText: hour.condition.text,
      providerWeatherCode: String(hour.condition.code),
    }))

    const normalizedForecast: NormalizedWeatherForecast = {
      provider: PROVIDER,
      locationKey,
      locationName,
      latitude: roundedLat,
      longitude: roundedLon,
      timezone: data.location.tz_id,
      providerUpdatedAt: new Date(data.current.last_updated_epoch * 1000),
      fetchedAt,
      current: {
        temperature: data.current.temp_c,
        feelsLike: data.current.feelslike_c,
        windSpeed: data.current.wind_kph / 3.6,
        humidity: data.current.humidity,
        condition: mapWeatherApiCondition(data.current.condition.code),
        providerConditionText: data.current.condition.text,
        providerWeatherCode: String(data.current.condition.code),
      },
      hourly: hourlyEntries,
      alerts: (data.alerts?.alert ?? [])
        .filter(
          (alert) =>
            new Date(alert.expires).getTime() > new Date(alert.effective).getTime()
        )
        .map(
          (alert): NormalizedWeatherAlert => ({
            event: alert.event,
            description: alert.desc,
            start: new Date(alert.effective),
            end: new Date(alert.expires),
            severity: mapWeatherApiAlertSeverity(alert.severity),
          })
        ),
    }

    const finalValidation = NormalizedWeatherForecastSchema.safeParse(normalizedForecast)
    if (!finalValidation.success) {
      throw new WeatherProviderError('WeatherAPI normalized response validation failed', {
        provider: PROVIDER,
        kind: 'invalid_response',
        cause: finalValidation.error,
      })
    }

    return finalValidation.data
  }

  private validateLocationMatch(
    location: { lat: number; lon: number },
    roundedLat: number,
    roundedLon: number
  ): void {
    if (
      Math.abs(location.lat - roundedLat) > LOCATION_TOLERANCE_DEGREES ||
      longitudeDistance(location.lon, roundedLon) > LOCATION_TOLERANCE_DEGREES
    ) {
      throw new WeatherProviderError(
        'WeatherAPI response location did not match the target',
        {
          provider: PROVIDER,
          kind: 'invalid_response',
        }
      )
    }
  }

  private extractUniqueHourly(
    hourly: z.infer<typeof WeatherApiHourSchema>[],
    currentHourEpoch: number
  ): z.infer<typeof WeatherApiHourSchema>[] {
    const futureHours = hourly.filter((hour) => hour.time_epoch >= currentHourEpoch)
    if (new Set(futureHours.map((hour) => hour.time_epoch)).size !== futureHours.length) {
      throw new WeatherProviderError('WeatherAPI returned duplicate hourly forecasts', {
        provider: PROVIDER,
        kind: 'invalid_response',
      })
    }
    const uniqueHours = futureHours
      .sort((left, right) => left.time_epoch - right.time_epoch)
      .slice(0, 48)

    if (uniqueHours.length < 24) {
      throw new WeatherProviderError(
        'WeatherAPI returned an incomplete hourly forecast (less than 24 hours)',
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
      throw new WeatherProviderError('WeatherAPI base URL is invalid', {
        provider: PROVIDER,
        kind: 'invalid_configuration',
      })
    }

    url.searchParams.set('key', this.apiKey)
    url.searchParams.set('q', `${latitude},${longitude}`)
    url.searchParams.set('days', '3')
    url.searchParams.set('aqi', 'no')
    url.searchParams.set('alerts', 'yes')
    return url
  }
}
