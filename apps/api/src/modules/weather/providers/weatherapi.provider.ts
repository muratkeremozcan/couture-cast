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
import { WeatherApiForecastDaysSchema } from './weather.config.js'
import type {
  WeatherApiForecastDaySchema,
  WeatherApiHourSchema,
} from './weather.schemas.js'
import {
  LocalDateSchema,
  NormalizedDailyWeatherEntrySchema,
  NormalizedWeatherForecastSchema,
  WeatherApiDaySummarySchema,
  WeatherApiResponseSchema,
  WeatherIngestionTargetSchema,
} from './weather.schemas.js'
import type {
  NormalizedDailyWeatherEntry,
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
  // Story 5.5 Decision 3: overridable for tests; otherwise read from
  // `WEATHERAPI_FORECAST_DAYS` (default 3, capped at 8).
  forecastDays?: number
}

@Injectable()
export class WeatherApiProvider implements IWeatherProvider {
  private readonly apiKey: string
  private readonly baseUrl: string
  private readonly forecastDays: number

  constructor(options: WeatherApiProviderOptions = {}) {
    const env = options.env ?? process.env
    this.apiKey = options.apiKey ?? env.WEATHERAPI_API_KEY ?? ''
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL
    this.forecastDays =
      options.forecastDays ??
      WeatherApiForecastDaysSchema.parse(env.WEATHERAPI_FORECAST_DAYS)
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
      daily: this.extractDaily(data.forecast.forecastday),
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

  // Story 5.5 Decision 3: maps each `forecastday.day` aggregate into the
  // normalized shape, at most eight entries. `date` and `day` are validated
  // independently here (never as part of the container schema), so one
  // malformed daily aggregate is dropped -- logged, never thrown -- rather
  // than failing the whole forecast.
  private extractDaily(
    forecastDays: z.infer<typeof WeatherApiForecastDaySchema>[]
  ): NormalizedDailyWeatherEntry[] | undefined {
    const entries: NormalizedDailyWeatherEntry[] = []
    for (const forecastDay of forecastDays.slice(0, 8)) {
      const dateResult = LocalDateSchema.safeParse(forecastDay.date)
      const dayResult = WeatherApiDaySummarySchema.safeParse(forecastDay.day)
      if (!dateResult.success || !dayResult.success) {
        console.warn('Discarding malformed WeatherAPI daily entry', {
          dateIssues: dateResult.success ? [] : dateResult.error.issues,
          dayIssues: dayResult.success ? [] : dayResult.error.issues,
        })
        continue
      }
      const day = dayResult.data
      const precipitationProbability = Math.max(
        day.daily_chance_of_rain ?? 0,
        day.daily_chance_of_snow ?? 0
      )
      const candidate = {
        localDate: dateResult.data,
        condition: mapWeatherApiCondition(day.condition.code),
        temperatureMin: day.mintemp_c,
        temperatureMax: day.maxtemp_c,
        precipitationProbability: precipitationProbability / 100,
        precipitationAmount: day.totalprecip_mm,
        windSpeed: day.maxwind_kph / 3.6,
      }
      const validated = NormalizedDailyWeatherEntrySchema.safeParse(candidate)
      if (validated.success) {
        entries.push(validated.data)
      }
    }
    return entries.length > 0 ? entries : undefined
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
    url.searchParams.set('days', String(this.forecastDays))
    url.searchParams.set('aqi', 'no')
    url.searchParams.set('alerts', 'yes')
    return url
  }
}
