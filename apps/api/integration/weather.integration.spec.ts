import 'reflect-metadata'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type INestApplication } from '@nestjs/common'
import { Test, type TestingModule } from '@nestjs/testing'
import { Prisma, PrismaClient } from '@prisma/client'
import request from 'supertest'
import {
  latestWeatherResponseSchema,
  unauthorizedHttpErrorSchema,
} from '@couture/api-client/contracts/http'
import type { AccessTokenIdentityService } from '../src/modules/auth/access-token-identity.service'
import { GuardianConsentStateService } from '../src/modules/auth/guardian-consent-state.service'
import { RequestAuthGuard } from '../src/modules/auth/security.guards'
import type {
  NormalizedWeatherForecast,
  WeatherIngestionTarget,
} from '../src/modules/weather/providers/weather.types'
import { WeatherController } from '../src/modules/weather/weather.controller'
import { WeatherQueryService } from '../src/modules/weather/weather-query.service'
import { WeatherRepository } from '../src/modules/weather/weather.repository'
import { TelemetryService } from '../src/modules/telemetry/telemetry.service'
import { SavedLocationWeatherTargetSource } from '../src/modules/weather/weather-target-source'

const locationKey = 'new-york-ny'

const authHeaders = {
  authorization: 'Bearer weather-token',
}

const realDatabaseIt = process.env.WEATHER_REAL_DB_INTEGRATION === 'true' ? it : it.skip

type CreateWeatherSnapshotArgs = {
  data: {
    location: string
    location_key: string
    provider: string
    provider_updated_at: Date
    segments: {
      create: {
        forecast_at: Date
        hour_offset: number
      }[]
    }
  }
  include: { segments: true }
}

function buildForecast(): NormalizedWeatherForecast {
  const fetchedAt = new Date('2026-07-08T12:00:00.000Z')

  return {
    provider: 'openweather',
    locationKey,
    latitude: 40.713,
    longitude: -74.006,
    timezone: 'America/New_York',
    providerUpdatedAt: new Date('2026-07-08T11:55:00.000Z'),
    fetchedAt,
    current: {
      temperature: 23,
      feelsLike: 24,
      condition: 'rain',
      providerConditionText: 'light rain',
      providerWeatherCode: '500',
      windSpeed: 4,
      humidity: 65,
    },
    hourly: Array.from({ length: 48 }, (_, index) => ({
      forecastAt: new Date(fetchedAt.getTime() + index * 60 * 60 * 1000),
      temperature: 23 + index * 0.1,
      feelsLike: 24 + index * 0.1,
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

function buildSnapshot() {
  const forecast = buildForecast()
  return {
    id: 'weather-1',
    location: forecast.locationKey,
    location_key: forecast.locationKey,
    latitude: forecast.latitude,
    longitude: forecast.longitude,
    timezone: forecast.timezone,
    provider: forecast.provider,
    provider_updated_at: forecast.providerUpdatedAt,
    temperature: forecast.current.temperature,
    condition: forecast.current.condition,
    alerts: forecast.alerts,
    fetched_at: forecast.fetchedAt,
    created_at: forecast.fetchedAt,
    segments: forecast.hourly.map((hour, index) => ({
      id: `segment-${index}`,
      weather_snapshot_id: 'weather-1',
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
      created_at: forecast.fetchedAt,
    })),
  }
}

function createPrismaStub(existingSnapshot: unknown = null) {
  const createdSnapshot = buildSnapshot()
  const tx = {
    weatherSnapshot: {
      findUnique: vi.fn().mockResolvedValue(existingSnapshot),
      create: vi.fn().mockResolvedValue(createdSnapshot),
    },
  }
  const prisma = {
    $transaction: vi.fn((callback: (transaction: typeof tx) => unknown) => callback(tx)),
    weatherSnapshot: {
      findFirst: vi.fn().mockResolvedValue(createdSnapshot),
      findUnique: vi.fn().mockResolvedValue(existingSnapshot),
    },
    weatherIngestionState: {
      findUnique: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue({ location_key: locationKey }),
    },
  }

  return { createdSnapshot, prisma, tx }
}

describe('Weather API integration', () => {
  let app: INestApplication | undefined
  let prisma: ReturnType<typeof createPrismaStub>['prisma']

  const getHttpServer = (): Parameters<typeof request>[0] => {
    if (!app) {
      throw new Error('App is not initialized')
    }

    return app.getHttpServer() as Parameters<typeof request>[0]
  }

  beforeEach(async () => {
    ;({ prisma } = createPrismaStub())
    const guardianConsentStateService = {
      canTeenAccess: vi.fn().mockResolvedValue(true),
    } as unknown as GuardianConsentStateService
    const accessTokenIdentityService = {
      resolveIdentity: vi.fn((token: string) =>
        token === 'weather-token'
          ? Promise.resolve({ userId: 'teen-weather', role: 'teen' as const })
          : Promise.reject(new Error('Unknown test access token'))
      ),
    } as unknown as AccessTokenIdentityService

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [WeatherController],
      providers: [
        WeatherRepository,
        {
          provide: WeatherQueryService,
          useFactory: (repository: WeatherRepository) =>
            new WeatherQueryService(repository, {
              now: () => new Date('2026-07-08T12:30:00.000Z'),
            }),
          inject: [WeatherRepository],
        },
        {
          provide: PrismaClient,
          useValue: prisma,
        },
        {
          provide: GuardianConsentStateService,
          useValue: guardianConsentStateService,
        },
        {
          provide: TelemetryService,
          useValue: {
            captureEvent: vi.fn().mockResolvedValue(undefined),
          },
        },
      ],
    })
      .overrideGuard(RequestAuthGuard)
      .useValue(
        new RequestAuthGuard(guardianConsentStateService, accessTokenIdentityService)
      )
      .compile()

    app = moduleFixture.createNestApplication()
    await app.init()
  })

  afterEach(async () => {
    vi.restoreAllMocks()

    if (app) {
      await app.close()
      app = undefined
    }
  })

  it('persists normalized weather transactionally and returns duplicate provider updates idempotently', async () => {
    const forecast = buildForecast()
    const { createdSnapshot, prisma: prismaStub, tx } = createPrismaStub()
    const repository = new WeatherRepository(prismaStub as never)

    await expect(repository.persistForecast(forecast)).resolves.toBe(createdSnapshot)

    expect(prismaStub.$transaction).toHaveBeenCalledTimes(1)
    const createArgs = tx.weatherSnapshot.create.mock.calls[0]?.[0] as
      | CreateWeatherSnapshotArgs
      | undefined
    expect(createArgs).toBeDefined()
    if (!createArgs) {
      throw new Error('Expected weather snapshot create args')
    }
    expect(createArgs.data.location_key).toBe(locationKey)
    expect(createArgs.data.provider).toBe('openweather')
    expect(createArgs.data.provider_updated_at).toBe(forecast.providerUpdatedAt)
    expect(createArgs.data.segments.create[0]).toMatchObject({
      forecast_at: forecast.hourly[0]!.forecastAt,
      hour_offset: 0,
    })
    expect(createArgs.include).toEqual({ segments: true })

    const duplicate = createPrismaStub(createdSnapshot)
    const duplicateRepository = new WeatherRepository(duplicate.prisma as never)

    await expect(duplicateRepository.persistForecast(forecast)).resolves.toBe(
      createdSnapshot
    )
    expect(duplicate.tx.weatherSnapshot.create).not.toHaveBeenCalled()
  })

  it('carries a saved location display name into the persisted weather snapshot', async () => {
    const targetSource = new SavedLocationWeatherTargetSource({
      savedLocation: {
        findMany: vi.fn().mockResolvedValue([
          {
            location_key: locationKey,
            latitude: 40.713,
            longitude: -74.006,
            city: 'New York',
            label: 'Home',
          },
        ]),
      },
    } as never)
    const [target] = await targetSource.getTargets()

    expect(target).toBeDefined()
    if (!target) {
      throw new Error('Expected a saved-location weather target')
    }

    const targetWithLocationName = target as WeatherIngestionTarget & {
      locationName?: string
    }
    const forecast = {
      ...buildForecast(),
      locationKey: target.locationKey,
      latitude: target.latitude,
      longitude: target.longitude,
      locationName: targetWithLocationName.locationName,
    }
    const { prisma: prismaStub, tx } = createPrismaStub()
    const repository = new WeatherRepository(prismaStub as never)

    await repository.persistForecast(forecast)

    const createArgs = tx.weatherSnapshot.create.mock.calls[0]?.[0] as
      | CreateWeatherSnapshotArgs
      | undefined
    expect(createArgs?.data.location).toBe('New York')
    expect(createArgs?.data.location_key).toBe(locationKey)
  })

  it('recovers duplicate provider update races by reading the committed snapshot', async () => {
    const forecast = buildForecast()
    const existingSnapshot = buildSnapshot()
    const { prisma: prismaStub, tx } = createPrismaStub(existingSnapshot)
    tx.weatherSnapshot.findUnique.mockResolvedValueOnce(null)
    tx.weatherSnapshot.create.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
      })
    )
    const repository = new WeatherRepository(prismaStub as never)

    await expect(repository.persistForecast(forecast)).resolves.toBe(existingSnapshot)
    expect(prismaStub.weatherSnapshot.findUnique).toHaveBeenCalledWith({
      where: {
        location_key_provider_provider_updated_at: {
          location_key: locationKey,
          provider: 'openweather',
          provider_updated_at: forecast.providerUpdatedAt,
        },
      },
      include: { segments: true },
    })
  })

  realDatabaseIt(
    'persists duplicate provider updates idempotently against the migrated database',
    async () => {
      const realPrisma = new PrismaClient()
      const repository = new WeatherRepository(realPrisma)
      const forecast = {
        ...buildForecast(),
        locationKey: `weather-integration-${Date.now()}`,
      }

      try {
        await realPrisma.$connect()
        const first = await repository.persistForecast(forecast)
        const second = await repository.persistForecast(forecast)

        expect(second.id).toBe(first.id)
        expect(first.segments).toHaveLength(48)
        expect(second.segments).toHaveLength(48)
      } finally {
        await realPrisma.forecastSegment.deleteMany({
          where: {
            weather_snapshot: {
              location_key: forecast.locationKey,
            },
          },
        })
        await realPrisma.weatherSnapshot.deleteMany({
          where: { location_key: forecast.locationKey },
        })
        await realPrisma.$disconnect()
      }
    }
  )

  it('requires auth and validates the canonical latest-weather response over HTTP', async () => {
    const unauthorizedResponse = await request(getHttpServer()).get(
      `/api/v1/weather/${locationKey}`
    )

    expect(unauthorizedResponse.status).toBe(401)
    unauthorizedHttpErrorSchema.parse(unauthorizedResponse.body)

    const missingLocationResponse = await request(getHttpServer())
      .get('/api/v1/weather/')
      .set(authHeaders)

    expect(missingLocationResponse.status).toBe(400)

    const response = await request(getHttpServer())
      .get(`/api/v1/weather/${locationKey}`)
      .set(authHeaders)

    expect(response.status).toBe(200)
    const body = latestWeatherResponseSchema.parse(response.body)
    expect(body.data.status).toBe('fresh')
    expect(body.data.weather?.locationKey).toBe(locationKey)
    expect(body.data.weather?.hourly).toHaveLength(48)
    expect(prisma.weatherSnapshot.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          location_key: locationKey,
          provider: { in: ['openweather', 'weatherapi'] },
        },
        orderBy: [{ fetched_at: 'desc' }, { id: 'desc' }],
      })
    )
  })
})
