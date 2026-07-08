import { describe, expect, it, vi } from 'vitest'
import { Prisma } from '@prisma/client'

import { WeatherRepository } from './weather.repository.js'
import type { NormalizedWeatherForecast } from './providers/weather.types.js'

type CreateForecastSegmentInput = {
  forecast_at: Date
  hour_offset: number
  temperature: number
  feels_like: number
  precipitation_probability: number
  precipitation_amount: number
  wind_speed: number
  wind_gust: number | null
  condition: string
  provider_weather_code: string
}

type CreateWeatherSnapshotArgs = {
  data: {
    location: string
    location_key: string
    latitude: number
    longitude: number
    timezone: string
    provider: string
    provider_updated_at: Date
    fetched_at: Date
    temperature: number
    condition: string
    alerts: unknown[]
    segments: {
      create: CreateForecastSegmentInput[]
    }
  }
  include: { segments: true }
}

function buildForecast(): NormalizedWeatherForecast {
  const fetchedAt = new Date('2026-07-06T13:30:00.000Z')

  return {
    provider: 'openweather',
    locationKey: 'new-york-ny',
    latitude: 40.7128,
    longitude: -74.006,
    timezone: 'America/New_York',
    providerUpdatedAt: new Date('2026-07-06T13:00:00.000Z'),
    fetchedAt,
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
      temperature: 21 + index * 0.1,
      feelsLike: 20 + index * 0.1,
      precipitationProbability: 0.25,
      precipitationAmount: 0.4,
      windSpeed: 4,
      windGust: 6,
      condition: 'rain',
      providerConditionText: 'light rain',
      providerWeatherCode: '500',
    })),
    alerts: [],
  }
}

function createPrismaStub(existingSnapshot: unknown = null) {
  const createdSnapshot = { id: 'weather-1', segments: [] }
  const tx = {
    weatherSnapshot: {
      findUnique: vi.fn().mockResolvedValue(existingSnapshot),
      create: vi.fn().mockResolvedValue(createdSnapshot),
    },
  }
  const prisma = {
    $transaction: vi.fn((callback: (transaction: typeof tx) => unknown) => callback(tx)),
    weatherSnapshot: {
      findUnique: vi.fn().mockResolvedValue(existingSnapshot),
      findFirst: vi.fn().mockResolvedValue(existingSnapshot),
    },
    weatherIngestionState: {
      findUnique: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue({ location_key: 'new-york-ny' }),
    },
  }

  return { prisma, tx, createdSnapshot }
}

describe('WeatherRepository', () => {
  it('persists a normalized forecast and 48 hourly segments in one transaction', async () => {
    const forecast = { ...buildForecast(), locationKey: 'New-York-NY' }
    const { prisma, tx, createdSnapshot } = createPrismaStub()
    const repository = new WeatherRepository(prisma as never)

    await expect(repository.persistForecast(forecast)).resolves.toBe(createdSnapshot)

    expect(prisma.$transaction).toHaveBeenCalledTimes(1)
    expect(tx.weatherSnapshot.findUnique).toHaveBeenCalledWith({
      where: {
        location_key_provider_provider_updated_at: {
          location_key: 'new-york-ny',
          provider: 'openweather',
          provider_updated_at: forecast.providerUpdatedAt,
        },
      },
      include: { segments: true },
    })
    expect(tx.weatherSnapshot.create).toHaveBeenCalledTimes(1)
    const createArgs = tx.weatherSnapshot.create.mock.calls[0]?.[0] as
      | CreateWeatherSnapshotArgs
      | undefined
    expect(createArgs).toBeDefined()
    if (!createArgs) {
      throw new Error('Expected repository to create a weather snapshot')
    }
    expect(createArgs).toMatchObject({
      data: {
        location: 'New-York-NY',
        location_key: 'new-york-ny',
        latitude: 40.7128,
        longitude: -74.006,
        timezone: 'America/New_York',
        provider: 'openweather',
        provider_updated_at: forecast.providerUpdatedAt,
        fetched_at: forecast.fetchedAt,
        temperature: 21,
        condition: 'rain',
        alerts: [],
      },
      include: { segments: true },
    })
    expect(createArgs.data.segments.create).toHaveLength(48)
    expect(createArgs.data.segments.create[0]).toMatchObject({
      forecast_at: forecast.hourly[0]!.forecastAt,
      hour_offset: 0,
      feels_like: 20,
      precipitation_probability: 0.25,
      precipitation_amount: 0.4,
      wind_speed: 4,
      wind_gust: 6,
      provider_weather_code: '500',
    })
  })

  it('recovers from a concurrent unique constraint race by re-reading the snapshot', async () => {
    const existingSnapshot = { id: 'weather-1', segments: [{ id: 'segment-1' }] }
    const { tx, prisma } = createPrismaStub(existingSnapshot)
    tx.weatherSnapshot.findUnique.mockResolvedValueOnce(null)
    tx.weatherSnapshot.create.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
        meta: { target: ['location_key', 'provider', 'provider_updated_at'] },
      })
    )
    const repository = new WeatherRepository(prisma as never)

    await expect(repository.persistForecast(buildForecast())).resolves.toBe(
      existingSnapshot
    )

    expect(prisma.weatherSnapshot.findUnique).toHaveBeenCalledWith({
      where: {
        location_key_provider_provider_updated_at: {
          location_key: 'new-york-ny',
          provider: 'openweather',
          provider_updated_at: new Date('2026-07-06T13:00:00.000Z'),
        },
      },
      include: { segments: true },
    })
  })

  it('returns an already committed provider update without duplicating segments', async () => {
    const existingSnapshot = { id: 'weather-1', segments: [{ id: 'segment-1' }] }
    const { tx, prisma } = createPrismaStub(existingSnapshot)
    const repository = new WeatherRepository(prisma as never)

    await expect(repository.persistForecast(buildForecast())).resolves.toBe(
      existingSnapshot
    )

    expect(tx.weatherSnapshot.create).not.toHaveBeenCalled()
  })

  it('filters latest reads to public provider snapshots', async () => {
    const { prisma } = createPrismaStub()
    const repository = new WeatherRepository(prisma as never)

    await repository.findLatestByLocationKey('New-York-NY')

    expect(prisma.weatherSnapshot.findFirst).toHaveBeenCalledWith({
      where: {
        location_key: 'new-york-ny',
        provider: { in: ['openweather', 'weatherapi'] },
      },
      orderBy: [{ fetched_at: 'desc' }, { id: 'desc' }],
      include: {
        segments: {
          orderBy: { forecast_at: 'asc' },
        },
      },
    })
  })

  it('records provider failure and success state by canonical location', async () => {
    const { prisma } = createPrismaStub()
    const repository = new WeatherRepository(prisma as never)
    const failedAt = new Date('2026-07-06T13:45:00.000Z')
    const succeededAt = new Date('2026-07-06T14:00:00.000Z')

    await repository.recordProviderFailure('New-York-NY', failedAt)
    await repository.recordProviderSuccess('New-York-NY', succeededAt)

    expect(prisma.weatherIngestionState.upsert).toHaveBeenNthCalledWith(1, {
      where: { location_key: 'new-york-ny' },
      create: {
        location_key: 'new-york-ny',
        last_provider_failure_at: failedAt,
      },
      update: {
        last_provider_failure_at: failedAt,
      },
    })
    expect(prisma.weatherIngestionState.upsert).toHaveBeenNthCalledWith(2, {
      where: { location_key: 'new-york-ny' },
      create: {
        location_key: 'new-york-ny',
        last_provider_success_at: succeededAt,
      },
      update: {
        last_provider_success_at: succeededAt,
      },
    })
  })
})
