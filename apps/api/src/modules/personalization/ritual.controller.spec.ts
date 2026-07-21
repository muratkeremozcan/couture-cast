import 'reflect-metadata'
import { type INestApplication } from '@nestjs/common'
import { Test, type TestingModule } from '@nestjs/testing'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ritualResponseSchema, type RitualResponse } from '../../contracts/http.js'
import type { AccessTokenIdentityService } from '../auth/access-token-identity.service.js'
import { GuardianConsentStateService } from '../auth/guardian-consent-state.service.js'
import { RequestAuthGuard } from '../auth/security.guards.js'
import { RitualController } from './ritual.controller.js'
import { RitualService, RITUAL_REDIS_CLIENT } from './ritual.service.js'
import { PrismaClient, type OutfitRecommendation, type Prisma } from '@prisma/client'
import { WeatherQueryService } from '../weather/weather-query.service.js'
import { LocationPreferencesService } from '../location-preferences/location-preferences.service.js'
import Redis from 'ioredis'

// In-memory store to simulate Redis in testing
const redisStore: Record<string, { val: string; ttl: number; setAt: number }> = {}

vi.mock('ioredis', () => {
  return {
    default: class MockRedis {
      get(key: string) {
        const item = redisStore[key]
        if (!item) return Promise.resolve(null)
        const elapsed = (Date.now() - item.setAt) / 1000
        if (elapsed > item.ttl) {
          delete redisStore[key]
          return Promise.resolve(null)
        }
        return Promise.resolve(item.val)
      }
      set(key: string, value: string, mode?: string, ttl?: number) {
        if (mode !== 'EX' || typeof ttl !== 'number') {
          return Promise.reject(
            new Error('MockRedis.set: mode must be EX and TTL must be specified')
          )
        }
        redisStore[key] = {
          val: value,
          ttl: ttl,
          setAt: Date.now(),
        }
        return Promise.resolve('OK')
      }
      quit() {
        return Promise.resolve('OK')
      }
    },
  }
})

describe('RitualController', () => {
  let app: INestApplication | undefined
  let outfitRecommendationCreateMock: ReturnType<typeof vi.fn>
  let prismaMock: PrismaClient
  let weatherQueryMock: WeatherQueryService
  let locationPrefsMock: LocationPreferencesService

  const mockTimezone = 'America/Chicago'
  const mockLocation = {
    id: 'loc-1',
    label: 'Home',
    locationKey: 'chicago-il',
    latitude: 41.878,
    longitude: -87.63,
    timezone: mockTimezone,
    isPrimary: true,
    sortOrder: 0,
    createdAt: '2026-07-16T12:00:00.000Z',
    updatedAt: '2026-07-16T12:00:00.000Z',
  }

  const segments = Array.from({ length: 48 }, (_, index) => {
    const date = new Date(
      new Date('2026-07-16T12:00:00.000Z').getTime() + index * 60 * 60 * 1000
    )
    const isSpecialEvening = index === 7

    return {
      id: `seg-${index}`,
      forecast_at: date,
      temperature: isSpecialEvening ? 18 : 22,
      feels_like: isSpecialEvening ? 17 : 21,
      precipitation_probability: isSpecialEvening ? 0.5 : 0.1,
      precipitation_amount: isSpecialEvening ? 0.8 : 0.0,
      wind_speed: isSpecialEvening ? 6.0 : 2.0,
      wind_gust: null,
      condition: isSpecialEvening ? 'rain' : 'clear',
      provider_weather_code: '1000',
    }
  })

  const weatherSnapshot = {
    id: 'weather-snap-1',
    location_key: 'chicago-il',
    latitude: 41.878,
    longitude: -87.63,
    timezone: mockTimezone,
    provider: 'weatherapi',
    provider_updated_at: new Date('2026-07-16T12:00:00.000Z'),
    fetched_at: new Date('2026-07-16T12:00:00.000Z'),
    temperature: 16,
    condition: 'clear',
    alerts: [],
    segments,
  }

  let persistedRecommendations: OutfitRecommendation[] = []

  beforeEach(async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-16T06:00:00.000Z'))

    persistedRecommendations = []
    for (const key of Object.keys(redisStore)) {
      delete redisStore[key]
    }

    outfitRecommendationCreateMock = vi
      .fn()
      .mockImplementation(
        ({
          data,
        }: {
          data:
            | Prisma.OutfitRecommendationCreateInput
            | Prisma.OutfitRecommendationUncheckedCreateInput
        }) => {
          const input = data as {
            scenario: string
            user_id?: string
            user?: { connect?: { id: string } }
            forecast_segment_id?: string | null
            forecast_segment?: { connect?: { id: string } }
            garment_ids?: Prisma.JsonValue
            reasoning_badges?: Prisma.JsonValue
          }
          const scenarioStr = input.scenario
          const newRec: OutfitRecommendation = {
            id: `rec-${scenarioStr}-${Math.random().toString(36).substring(2, 9)}`,
            user_id: input.user_id ?? input.user?.connect?.id ?? '',
            forecast_segment_id:
              input.forecast_segment_id ?? input.forecast_segment?.connect?.id ?? null,
            scenario: scenarioStr,
            garment_ids: input.garment_ids || null,
            reasoning_badges: input.reasoning_badges || null,
            created_at: new Date(),
            updated_at: new Date(),
          }
          persistedRecommendations.push(newRec)
          return Promise.resolve(newRec)
        }
      )

    prismaMock = {
      comfortPreferences: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'comfort-1',
          user_id: 'user-1',
          runs_cold_warm: 'neutral',
          wind_tolerance: 'medium',
          precip_preparedness: 'medium',
          updated_at: new Date('2026-07-15T12:00:00.000Z'),
        }),
      },
      garmentItem: {
        findMany: vi.fn().mockResolvedValue([]),
        findFirst: vi.fn().mockResolvedValue(null),
      },
      outfitRecommendation: {
        findFirst: vi
          .fn()
          .mockImplementation(
            ({ where }: { where: Prisma.OutfitRecommendationFindFirstArgs['where'] }) => {
              if (!where) return Promise.resolve(null)
              const filter = where as {
                user_id?: string
                forecast_segment_id?: string | null
                scenario?: string
              }
              return Promise.resolve(
                persistedRecommendations.find(
                  (r) =>
                    r.user_id === filter.user_id &&
                    r.forecast_segment_id === filter.forecast_segment_id &&
                    r.scenario === filter.scenario
                ) || null
              )
            }
          ),
        create: outfitRecommendationCreateMock,
      },
    } as unknown as PrismaClient

    weatherQueryMock = {
      getLatestWeather: vi.fn().mockResolvedValue({
        status: 'fresh',
        data: weatherSnapshot,
      }),
    } as unknown as WeatherQueryService

    locationPrefsMock = {
      listLocations: vi.fn().mockResolvedValue([mockLocation]),
    } as unknown as LocationPreferencesService

    const guardianConsentStateService = {
      canTeenAccess: vi.fn().mockResolvedValue(true),
    } as unknown as GuardianConsentStateService

    const accessTokenIdentityService = {
      resolveIdentity: vi.fn((token: string) =>
        token === 'ritual-token'
          ? Promise.resolve({ userId: 'user-1', role: 'guardian' as const })
          : Promise.reject(new Error('Unknown test access token'))
      ),
    } as unknown as AccessTokenIdentityService

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [RitualController],
      providers: [
        RitualService,
        {
          provide: PrismaClient,
          useValue: prismaMock,
        },
        {
          provide: WeatherQueryService,
          useValue: weatherQueryMock,
        },
        {
          provide: LocationPreferencesService,
          useValue: locationPrefsMock,
        },
        {
          provide: GuardianConsentStateService,
          useValue: guardianConsentStateService,
        },
        {
          provide: RITUAL_REDIS_CLIENT,
          useValue: new Redis(),
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
    vi.useRealTimers()
    vi.restoreAllMocks()
    if (app) {
      await app.close()
      app = undefined
    }
  })

  const getHttpServer = (): Parameters<typeof request>[0] => {
    if (!app) {
      throw new Error('App is not initialized')
    }
    return app.getHttpServer() as Parameters<typeof request>[0]
  }

  it('requires authentication to access /api/v1/ritual', async () => {
    const unauthResponse = await request(getHttpServer()).get('/api/v1/ritual')
    expect(unauthResponse.status).toBe(401)
  })

  it('generates outfit recommendations, persists to DB, and caches in Redis', async () => {
    const response = await request(getHttpServer())
      .get('/api/v1/ritual')
      .set({ authorization: 'Bearer ritual-token' })

    expect(response.status).toBe(200)

    const parsed: RitualResponse = ritualResponseSchema.parse(response.body)
    expect(parsed.data.outfits).toHaveLength(3)

    // Explicitly assert on reasoningBadges structure
    for (const outfit of parsed.data.outfits) {
      for (const badge of outfit.reasoningBadges) {
        expect(badge.key).toBeDefined()
        expect(badge.label).toBeDefined()
        expect(Array.isArray(badge.bullets)).toBe(true)
        for (const bullet of badge.bullets) {
          expect(typeof bullet).toBe('string')
        }
      }
    }

    expect(persistedRecommendations).toHaveLength(3)
    expect(outfitRecommendationCreateMock).toHaveBeenCalledTimes(3)

    const cacheKey = 'ritual:user-1:chicago-il:07/16/2026'
    expect(redisStore[cacheKey]).toBeDefined()
    expect(redisStore[cacheKey]?.ttl).toBe(900)

    outfitRecommendationCreateMock.mockClear()
    const cachedResponse = await request(getHttpServer())
      .get('/api/v1/ritual')
      .set({ authorization: 'Bearer ritual-token' })

    expect(cachedResponse.status).toBe(200)
    expect(outfitRecommendationCreateMock).not.toHaveBeenCalled()
  })
})
