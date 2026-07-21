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
      public store: Record<string, string> = {}
      get(key: string) {
        return Promise.resolve(this.store[key] || null)
      }
      set(key: string, value: string) {
        this.store[key] = value
        return Promise.resolve('OK')
      }
      scan(cursor: string, ...args: string[]) {
        const matchIdx = args.indexOf('MATCH')
        const pattern = matchIdx !== -1 ? (args[matchIdx + 1] ?? '*') : '*'
        const regexStr = '^' + pattern.replace(/\*/g, '.*') + '$'
        const regex = new RegExp(regexStr)
        const matchedKeys = Object.keys(this.store).filter((k) => regex.test(k))
        return Promise.resolve(['0', matchedKeys])
      }
      del(keys: string | string[]) {
        const keysArr = Array.isArray(keys) ? keys : [keys]
        let deletedCount = 0
        for (const k of keysArr) {
          if (k in this.store) {
            delete this.store[k]
            deletedCount++
          }
        }
        return Promise.resolve(deletedCount)
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
  let garmentItemFindFirst: ReturnType<typeof vi.fn>
  let outfitRecommendationFindFirst: ReturnType<typeof vi.fn>
  let outfitRecommendationCreate: ReturnType<typeof vi.fn>
  let outfitRecommendationUpdate: ReturnType<typeof vi.fn>
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
    {
      id: 'seg-morning-tomorrow',
      forecast_at: new Date('2026-07-17T13:00:00.000Z'), // 8:00 AM in America/Chicago (tomorrow)
      temperature: 16,
      feels_like: 15,
      precipitation_probability: 0.1,
      precipitation_amount: 0.0,
      wind_speed: 2.0,
      wind_gust: null,
      condition: 'clear',
      provider_weather_code: '1000',
    },
    {
      id: 'seg-midday-tomorrow',
      forecast_at: new Date('2026-07-17T18:00:00.000Z'), // 1:00 PM in America/Chicago (tomorrow)
      temperature: 23,
      feels_like: 22,
      precipitation_probability: 0.2,
      precipitation_amount: 0.0,
      wind_speed: 4.0,
      wind_gust: null,
      condition: 'partly_cloudy',
      provider_weather_code: '1003',
    },
    {
      id: 'seg-evening-tomorrow',
      forecast_at: new Date('2026-07-18T00:00:00.000Z'), // 7:00 PM in America/Chicago (tomorrow)
      temperature: 19,
      feels_like: 18,
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
    garmentItemFindFirst = vi.fn().mockResolvedValue(null)
    outfitRecommendationFindFirst = vi.fn().mockResolvedValue(null)
    outfitRecommendationCreate = vi
      .fn()
      .mockImplementation(
        ({ data }: { data: Prisma.OutfitRecommendationCreateInput }) => {
          const scenarioStr = typeof data.scenario === 'string' ? data.scenario : ''
          return Promise.resolve({ id: `rec-${scenarioStr}`, ...data })
        }
      )
    outfitRecommendationUpdate = vi
      .fn()
      .mockImplementation(
        ({
          where,
          data,
        }: {
          where: { id: string }
          data: Prisma.OutfitRecommendationUpdateInput
        }) => {
          return Promise.resolve({ id: where.id, ...data })
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
        findFirst: garmentItemFindFirst,
      },
      outfitRecommendation: {
        findFirst: outfitRecommendationFindFirst,
        create: outfitRecommendationCreate,
        update: outfitRecommendationUpdate,
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
    expect(eveningOutfit?.reasoningBadges).toContainEqual({
      key: 'wind_layer',
      label: 'Wind layer',
      bullets: [
        'Wind speed is 6 m/s, which exceeds your wind tolerance threshold of 3 m/s.',
      ],
    })
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
    expect(eveningOutfit?.reasoningBadges).toContainEqual({
      key: 'rain_ready',
      label: 'Rain-ready',
      bullets: [
        'Precipitation probability is 50%, which exceeds your threshold of 20%.',
        'Precipitation amount is 0.8 mm, which exceeds your threshold of 0.1 mm.',
      ],
    })
  })

  it('prevents cache reuse across the 8:00 AM cutoff boundary (07:59 vs 08:00)', async () => {
    const redis = new Redis()
    const getSpy = vi.spyOn(redis, 'get')
    const setSpy = vi.spyOn(redis, 'set')

    const customService = new RitualService(
      prismaMock,
      weatherQueryMock,
      locationPreferencesMock,
      redis as unknown as Redis
    )

    vi.setSystemTime(new Date('2026-07-16T12:59:00.000Z'))
    await customService.getOrCreateRitual('user-1')

    expect(getSpy).toHaveBeenLastCalledWith('ritual:user-1:chicago-il:07/16/2026')
    expect(setSpy).toHaveBeenLastCalledWith(
      'ritual:user-1:chicago-il:07/16/2026',
      expect.any(String),
      'EX',
      900
    )

    vi.setSystemTime(new Date('2026-07-16T13:00:00.000Z'))
    await customService.getOrCreateRitual('user-1')

    expect(getSpy).toHaveBeenLastCalledWith('ritual:user-1:chicago-il:07/17/2026')
    expect(setSpy).toHaveBeenLastCalledWith(
      'ritual:user-1:chicago-il:07/17/2026',
      expect.any(String),
      'EX',
      900
    )
  })

  it('invalidates cache on preference changes or wardrobe updates, and updates database recommendation rather than creating new', async () => {
    const redis = new Redis()
    const customService = new RitualService(
      prismaMock,
      weatherQueryMock,
      locationPreferencesMock,
      redis as unknown as Redis
    )

    const initialRec = {
      id: 'rec-1',
      user_id: 'user-1',
      forecast_segment_id: 'seg-morning',
      scenario: 'morning',
      garment_ids: ['default-top'],
      reasoning_badges: [],
      created_at: new Date('2026-07-16T04:00:00.000Z'),
      updated_at: new Date('2026-07-16T04:00:00.000Z'),
    }
    outfitRecommendationFindFirst.mockResolvedValue(initialRec)

    garmentItemFindFirst.mockResolvedValue({
      id: 'garment-1',
      user_id: 'user-1',
      category: 'top',
      comfort_range: 'mild',
      updated_at: new Date('2026-07-16T05:00:00.000Z'),
    })

    await customService.getOrCreateRitual('user-1')

    expect(outfitRecommendationUpdate).toHaveBeenCalled()
    expect(outfitRecommendationCreate).not.toHaveBeenCalled()
  })

  // Story 2.3 Task 4 step 1 owner: test badge keys, labels, and bullet interpolation rules
  it('correctly maps various badge types and interpolates correct bullet rationales', async () => {
    comfortPreferencesFindUnique.mockResolvedValue({
      id: 'comfort-1',
      user_id: 'user-1',
      runs_cold_warm: 'cold',
      wind_tolerance: 'high',
      precip_preparedness: 'low',
      updated_at: new Date('2026-07-16T12:00:00.000Z'),
    })

    const result = await service.getOrCreateRitual('user-1')

    const morningOutfit = result.outfits.find((o) => o.scenario === 'morning')
    expect(morningOutfit?.reasoningBadges).toEqual([
      {
        key: 'commute_warmth',
        label: 'Commute warmth',
        bullets: [
          'Morning feels-like temperature is 14°C (adjusted to 11°C), which is below the commute warmth threshold of 12°C.',
        ],
      },
    ])

    const middayOutfit = result.outfits.find((o) => o.scenario === 'midday')
    expect(middayOutfit?.reasoningBadges).toEqual([
      {
        key: 'light_layers',
        label: 'Light layers',
        bullets: [
          'Feels-like temperature is 21°C (adjusted to 18°C), which is between 15°C and 22°C.',
        ],
      },
    ])

    const eveningOutfit = result.outfits.find((o) => o.scenario === 'evening')
    expect(eveningOutfit?.reasoningBadges).toEqual([
      {
        key: 'evening_chill',
        label: 'Evening chill',
        bullets: [
          'Evening feels-like temperature is 17°C (adjusted to 14°C), which is below the evening chill threshold of 15°C.',
        ],
      },
    ])
  })

  it('prevents rounding and floating-point exposure in wind and precipitation badges', async () => {
    const unroundedSegments = segments.map((s) => ({
      ...s,
      wind_speed: 6.000000000000001,
      precipitation_amount: 0.80000000000001,
    }))
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const originalGetLatestWeather = weatherQueryMock.getLatestWeather
    weatherQueryMock.getLatestWeather = vi.fn().mockResolvedValue({
      status: 'fresh',
      data: {
        ...weatherSnapshot,
        segments: unroundedSegments,
      },
    })

    comfortPreferencesFindUnique.mockResolvedValue({
      id: 'comfort-1',
      user_id: 'user-1',
      runs_cold_warm: 'neutral',
      wind_tolerance: 'low',
      precip_preparedness: 'high',
      updated_at: new Date('2026-07-16T12:00:00.000Z'),
    })

    const result = await service.getOrCreateRitual('user-1')
    const eveningOutfit = result.outfits.find((o) => o.scenario === 'evening')

    expect(eveningOutfit?.reasoningBadges).toContainEqual({
      key: 'wind_layer',
      label: 'Wind layer',
      bullets: [
        'Wind speed is 6 m/s, which exceeds your wind tolerance threshold of 3 m/s.',
      ],
    })

    expect(eveningOutfit?.reasoningBadges).toContainEqual({
      key: 'rain_ready',
      label: 'Rain-ready',
      bullets: [
        'Precipitation probability is 50%, which exceeds your threshold of 20%.',
        'Precipitation amount is 0.8 mm, which exceeds your threshold of 0.1 mm.',
      ],
    })

    weatherQueryMock.getLatestWeather = originalGetLatestWeather
  })

  describe('invalidateUserCache', () => {
    it('should scan and delete matching user cache keys', async () => {
      const redis = new Redis()
      const mockRedisInstance = redis as unknown as { store: Record<string, string> }
      mockRedisInstance.store['ritual:user-1:chicago:07/16/2026'] = 'data1'
      mockRedisInstance.store['ritual:user-1:ny:07/16/2026'] = 'data2'
      mockRedisInstance.store['ritual:user-2:chicago:07/16/2026'] = 'data3'

      const customService = new RitualService(
        prismaMock,
        weatherQueryMock,
        locationPreferencesMock,
        redis as unknown as Redis
      )

      const scanSpy = vi.spyOn(redis, 'scan')
      const delSpy = vi.spyOn(redis, 'del')

      await customService.invalidateUserCache('user-1')

      expect(scanSpy).toHaveBeenCalledWith('0', 'MATCH', 'ritual:user-1:*', 'COUNT', 100)
      expect(delSpy).toHaveBeenCalledWith([
        'ritual:user-1:chicago:07/16/2026',
        'ritual:user-1:ny:07/16/2026',
      ])

      expect(mockRedisInstance.store['ritual:user-1:chicago:07/16/2026']).toBeUndefined()
      expect(mockRedisInstance.store['ritual:user-1:ny:07/16/2026']).toBeUndefined()
      expect(mockRedisInstance.store['ritual:user-2:chicago:07/16/2026']).toBe('data3')
    })
  })
})
