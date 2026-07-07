import { Injectable } from '@nestjs/common'
import { Prisma, PrismaClient } from '@prisma/client'

import type { NormalizedWeatherForecast } from './providers/weather.types.js'

export type WeatherSnapshotWithSegments = Prisma.WeatherSnapshotGetPayload<{
  include: { segments: true }
}>

type PersistedWeatherSnapshot = WeatherSnapshotWithSegments

@Injectable()
export class WeatherRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async persistForecast(
    forecast: NormalizedWeatherForecast
  ): Promise<PersistedWeatherSnapshot> {
    try {
      return await this.prisma.$transaction(async (transaction) => {
        const existing = await transaction.weatherSnapshot.findUnique({
          where: {
            location_key_provider_provider_updated_at: {
              location_key: forecast.locationKey,
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
              location_key: forecast.locationKey,
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
    const normalizedKey = locationKey.trim().toLowerCase()
    return this.prisma.weatherSnapshot.findFirst({
      where: { location_key: normalizedKey },
      orderBy: [{ fetched_at: 'desc' }, { id: 'desc' }],
      include: {
        segments: {
          orderBy: { forecast_at: 'asc' },
        },
      },
    })
  }

  private toCreateInput(
    forecast: NormalizedWeatherForecast
  ): Prisma.WeatherSnapshotCreateInput {
    return {
      location: forecast.locationKey,
      location_key: forecast.locationKey,
      latitude: forecast.latitude,
      longitude: forecast.longitude,
      timezone: forecast.timezone,
      provider: forecast.provider,
      provider_updated_at: forecast.providerUpdatedAt,
      fetched_at: forecast.fetchedAt,
      temperature: forecast.current.temperature,
      condition: forecast.current.condition,
      alerts: forecast.alerts as unknown as Prisma.InputJsonArray,
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
