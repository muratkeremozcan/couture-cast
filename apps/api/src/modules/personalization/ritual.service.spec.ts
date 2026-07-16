import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { RitualService } from './ritual.service.js'
import type { PrismaClient, Prisma } from '@prisma/client'
import type { WeatherQueryService } from '../weather/weather-query.service.js'
import type { LocationPreferencesService } from '../location-preferences/location-preferences.service.js'
import Redis from 'ioredis'

// Mock ioredis
vi.mock('ioredis', () => {
  return {
    default: class MockRedis {
      private store: Record<string, string> = {}
      get(key: string) {
        return Promise.resolve(this.store[key] || null)
      }
      set(key: string, value: string) {
        this.store[key] = value
        return Promise.resolve('OK')
      }
      quit() {
        return Promise.resolve('OK')
      }
    },
  }
})

describe('RitualService', () => {
  let comfortPreferencesFindUnique: ReturnType<typeof vi.fn>
  let garmentItemFindMany: ReturnType<typeof vi.fn>
  let outfitRecommendationFindFirst: ReturnType<typeof vi.fn>
  let outfitRecommendationCreate: ReturnType<typeof vi.fn>
  let getLatestWeatherMock: ReturnType<typeof vi.fn>
  let listLocationsMock: ReturnType<typeof vi.fn>

  let prismaMock: PrismaClient
  let weatherQueryMock: WeatherQueryService
  let locationPreferencesMock: LocationPreferencesService
  let service: RitualService

  const mockTimezone = 'America/Chicago'

  const segments = [
    {
      id: 'seg-morning',
      forecast_at: new Date('2026-07-16T13:00:00.000Z'), // 8:00 AM in America/Chicago
      temperature: 15,
      feels_like: 14,
      precipitation_probability: 0.1,
      precipitation_amount: 0.0,
      wind_speed: 2.0,
      wind_gust: null,
      condition: 'clear',
      provider_weather_code: '1000',
    },
    {
      id: 'seg-midday',
      forecast_at: new Date('2026-07-16T18:00:00.000Z'), // 1:00 PM in America/Chicago
      temperature: 22,
      feels_like: 21,
      precipitation_probability: 0.2,
      precipitation_amount: 0.0,
      wind_speed: 4.0,
      wind_gust: null,
      condition: 'partly_cloudy',
      provider_weather_code: '1003',
    },
    {
      id: 'seg-evening',
      forecast_at: new Date('2026-07-17T00:00:00.000Z'), // 7:00 PM in America/Chicago
      temperature: 18,
      feels_like: 17,
      precipitation_probability: 0.5,
      precipitation_amount: 0.8,
      wind_speed: 6.0,
      wind_gust: null,
      condition: 'rain',
      provider_weather_code: '1063',
    },
  ]

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

  const mockLocations = [
    {
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
    },
  ]

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-16T06:00:00.000Z'))

    comfortPreferencesFindUnique = vi.fn().mockResolvedValue(null)
    garmentItemFindMany = vi.fn().mockResolvedValue([])
    outfitRecommendationFindFirst = vi.fn().mockResolvedValue(null)
    outfitRecommendationCreate = vi
      .fn()
      .mockImplementation(
        ({ data }: { data: Prisma.OutfitRecommendationCreateInput }) => {
          const scenarioStr = typeof data.scenario === 'string' ? data.scenario : ''
          return Promise.resolve({ id: `rec-${scenarioStr}`, ...data })
        }
      )

    prismaMock = {
      comfortPreferences: {
        findUnique: comfortPreferencesFindUnique,
        create: vi.fn(),
        update: vi.fn(),
      },
      garmentItem: {
        findMany: garmentItemFindMany,
      },
      outfitRecommendation: {
        findFirst: outfitRecommendationFindFirst,
        create: outfitRecommendationCreate,
      },
    } as unknown as PrismaClient

    getLatestWeatherMock = vi.fn().mockResolvedValue({
      status: 'fresh',
      data: weatherSnapshot,
    })
    weatherQueryMock = {
      getLatestWeather: getLatestWeatherMock,
    } as unknown as WeatherQueryService

    listLocationsMock = vi.fn().mockResolvedValue(mockLocations)
    locationPreferencesMock = {
      listLocations: listLocationsMock,
    } as unknown as LocationPreferencesService

    const redis = new Redis()
    service = new RitualService(
      prismaMock,
      weatherQueryMock,
      locationPreferencesMock,
      redis as unknown as Redis
    )
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('correctly maps morning, midday, and evening segments based on local timezone hours', async () => {
    const result = await service.getOrCreateRitual('user-1')

    expect(result.outfits).toHaveLength(3)
    expect(result.outfits[0]!.scenario).toBe('morning')
    expect(result.outfits[1]!.scenario).toBe('midday')
    expect(result.outfits[2]!.scenario).toBe('evening')

    expect(getLatestWeatherMock).toHaveBeenCalledWith('chicago-il')
  })

  it('returns default placeholders for empty closet', async () => {
    garmentItemFindMany.mockResolvedValue([])

    const result = await service.getOrCreateRitual('user-1')

    expect(result.outfits[0]!.garmentIds).toEqual([
      'default-outerwear',
      'default-top',
      'default-bottom',
      'default-shoes',
    ])

    expect(result.outfits[1]!.garmentIds).toEqual([
      'default-top',
      'default-bottom',
      'default-shoes',
    ])
  })

  it('respects runs_cold preference (+/- 3C effective feels-like calibration)', async () => {
    comfortPreferencesFindUnique.mockResolvedValue({
      id: 'comfort-1',
      user_id: 'user-1',
      runs_cold_warm: 'cold',
      wind_tolerance: 'medium',
      precip_preparedness: 'medium',
      updated_at: new Date('2026-07-16T12:00:00.000Z'),
    })

    const result = await service.getOrCreateRitual('user-1')

    expect(result.outfits[0]!.comfortNotes).toContain('adjusted to 11°C for comfort')
    expect(result.outfits[1]!.comfortNotes).toContain('adjusted to 18°C for comfort')
  })

  it('respects runs_warm preference (+3C effective feels-like calibration)', async () => {
    comfortPreferencesFindUnique.mockResolvedValue({
      id: 'comfort-1',
      user_id: 'user-1',
      runs_cold_warm: 'warm',
      wind_tolerance: 'medium',
      precip_preparedness: 'medium',
      updated_at: new Date('2026-07-16T12:00:00.000Z'),
    })

    const result = await service.getOrCreateRitual('user-1')

    expect(result.outfits[0]!.comfortNotes).toContain('adjusted to 17°C for comfort')
    expect(result.outfits[1]!.comfortNotes).toContain('adjusted to 24°C for comfort')
  })

  it('correctly maps wind tolerance alert badge based on user tolerance setting', async () => {
    comfortPreferencesFindUnique.mockResolvedValue({
      id: 'comfort-1',
      user_id: 'user-1',
      runs_cold_warm: 'neutral',
      wind_tolerance: 'low',
      precip_preparedness: 'medium',
      updated_at: new Date('2026-07-16T12:00:00.000Z'),
    })

    const result = await service.getOrCreateRitual('user-1')
    const eveningOutfit = result.outfits.find((o) => o.scenario === 'evening')
    expect(eveningOutfit?.reasoningBadges).toContainEqual({ label: 'Wind layer' })
  })

  it('correctly maps precipitation alert badge based on user preparedness setting', async () => {
    comfortPreferencesFindUnique.mockResolvedValue({
      id: 'comfort-1',
      user_id: 'user-1',
      runs_cold_warm: 'neutral',
      wind_tolerance: 'medium',
      precip_preparedness: 'high',
      updated_at: new Date('2026-07-16T12:00:00.000Z'),
    })

    const result = await service.getOrCreateRitual('user-1')
    const eveningOutfit = result.outfits.find((o) => o.scenario === 'evening')
    expect(eveningOutfit?.reasoningBadges).toContainEqual({ label: 'Rain-ready' })
  })
})
