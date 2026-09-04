import { Inject, Injectable } from '@nestjs/common'
import { Prisma, PrismaClient } from '@prisma/client'

import { NormalizedDailyWeatherEntrySchema } from './providers/weather.schemas.js'
import type {
  NormalizedDailyWeatherEntry,
  NormalizedWeatherForecast,
} from './providers/weather.types.js'

// Story 5.5 Decision 3: `WeatherSnapshot.daily_summaries` is parsed with this
// schema on every read. A malformed entry is discarded and logged rather
// than failing the read, so hourly weather is never taken down by it.
export function parseDailySummaries(
  raw: Prisma.JsonValue | null | undefined,
  logger: { warn: (message: string, meta?: unknown) => void } = console
): NormalizedDailyWeatherEntry[] {
  if (!Array.isArray(raw)) {
    return []
  }

  const parsed: NormalizedDailyWeatherEntry[] = []
  for (const entry of raw) {
    const result = NormalizedDailyWeatherEntrySchema.safeParse(entry)
    if (result.success) {
      parsed.push(result.data)
    } else {
      logger.warn('Discarding malformed WeatherSnapshot.daily_summaries entry', {
        issues: result.error.issues,
      })
    }
  }
  return parsed
}

export type WeatherSnapshotWithSegments = Prisma.WeatherSnapshotGetPayload<{
  include: { segments: true }
}>

export interface WeatherIngestionStateSnapshot {
  last_provider_failure_at: Date | null
  last_provider_success_at: Date | null
}

type PersistedWeatherSnapshot = WeatherSnapshotWithSegments

function normalizeLocationKey(locationKey: string): string {
  return locationKey.trim().toLowerCase()
}

@Injectable()
export class WeatherRepository {
  constructor(@Inject(PrismaClient) private readonly prisma: PrismaClient) {}

  async persistForecast(
    forecast: NormalizedWeatherForecast
  ): Promise<PersistedWeatherSnapshot> {
    const locationKey = normalizeLocationKey(forecast.locationKey)
    try {
      return await this.prisma.$transaction(async (transaction) => {
        const existing = await transaction.weatherSnapshot.findUnique({
          where: {
            location_key_provider_provider_updated_at: {
              location_key: locationKey,
              provider: forecast.provider,
              provider_updated_at: forecast.providerUpdatedAt,
            },
          },
          include: { segments: true },
        })

        if (existing) {
          return existing
        }

        return await transaction.weatherSnapshot.create({
          data: this.toCreateInput(forecast),
          include: { segments: true },
        })
      })
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const existing = await this.prisma.weatherSnapshot.findUnique({
          where: {
            location_key_provider_provider_updated_at: {
              location_key: locationKey,
              provider: forecast.provider,
              provider_updated_at: forecast.providerUpdatedAt,
            },
          },
          include: { segments: true },
        })
        if (existing) {
          return existing
        }
      }
      throw error
    }
  }

  async findLatestByLocationKey(
    locationKey: string
  ): Promise<WeatherSnapshotWithSegments | null> {
    const normalizedKey = normalizeLocationKey(locationKey)
    return this.prisma.weatherSnapshot.findFirst({
      where: {
        location_key: normalizedKey,
        provider: { in: ['openweather', 'weatherapi'] },
      },
      orderBy: [{ fetched_at: 'desc' }, { id: 'desc' }],
      include: {
        segments: {
          orderBy: { forecast_at: 'asc' },
        },
      },
    })
  }

  async findIngestionState(
    locationKey: string
  ): Promise<WeatherIngestionStateSnapshot | null> {
    return this.prisma.weatherIngestionState.findUnique({
      where: { location_key: normalizeLocationKey(locationKey) },
      select: {
        last_provider_failure_at: true,
        last_provider_success_at: true,
      },
    })
  }

  async recordProviderFailure(locationKey: string, failedAt: Date): Promise<void> {
    const normalizedKey = normalizeLocationKey(locationKey)
    await this.prisma.weatherIngestionState.upsert({
      where: { location_key: normalizedKey },
      create: {
        location_key: normalizedKey,
        last_provider_failure_at: failedAt,
      },
      update: {
        last_provider_failure_at: failedAt,
      },
    })
  }

  async recordProviderSuccess(locationKey: string, succeededAt: Date): Promise<void> {
    const normalizedKey = normalizeLocationKey(locationKey)
    await this.prisma.weatherIngestionState.upsert({
      where: { location_key: normalizedKey },
      create: {
        location_key: normalizedKey,
        last_provider_success_at: succeededAt,
      },
      update: {
        last_provider_success_at: succeededAt,
      },
    })
  }

  private toCreateInput(
    forecast: NormalizedWeatherForecast
  ): Prisma.WeatherSnapshotCreateInput {
    return {
      location: forecast.locationName ?? forecast.locationKey,
      location_key: normalizeLocationKey(forecast.locationKey),
      latitude: forecast.latitude,
      longitude: forecast.longitude,
      timezone: forecast.timezone,
      provider: forecast.provider,
      provider_updated_at: forecast.providerUpdatedAt,
      fetched_at: forecast.fetchedAt,
      temperature: forecast.current.temperature,
      condition: forecast.current.condition,
      alerts: forecast.alerts as unknown as Prisma.InputJsonArray,
      // Story 5.5 Decision 3: nullable, so an absent/empty daily projection
      // stores as `null` rather than an empty array, matching the "daily
      // projection unavailable for this snapshot" reading on the way back
      // out through `parseDailySummaries`.
      daily_summaries:
        forecast.daily && forecast.daily.length > 0
          ? (forecast.daily as unknown as Prisma.InputJsonArray)
          : Prisma.JsonNull,
      segments: {
        create: forecast.hourly.map((hour, index) => ({
          forecast_at: hour.forecastAt,
          hour_offset: index,
          temperature: hour.temperature,
          feels_like: hour.feelsLike,
          precipitation_probability: hour.precipitationProbability,
          precipitation_amount: hour.precipitationAmount,
          wind_speed: hour.windSpeed,
          wind_gust: hour.windGust,
          condition: hour.condition,
          provider_weather_code: hour.providerWeatherCode,
        })),
      },
    }
  }
}
