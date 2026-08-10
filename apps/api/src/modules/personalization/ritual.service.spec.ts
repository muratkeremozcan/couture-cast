/* eslint-disable @typescript-eslint/no-unsafe-argument */
// Step 22 step 4 owner: verify translation key parity and placeholder replacements in apps/api/src/modules/personalization/ritual.service.spec.ts
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import {
  RitualService,
  comfortNotesTranslations,
  badgeTranslations,
} from './ritual.service.js'
import { BadRequestException, InternalServerErrorException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import type { PrismaClient, GarmentItem } from '@prisma/client'
import type { WeatherQueryService } from '../weather/weather-query.service.js'
import type { LocationPreferencesService } from '../location-preferences/location-preferences.service.js'
import type { AnalyticsClient } from '../../analytics/analytics.service.js'
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
      userProfile: {
        findUnique: vi.fn().mockResolvedValue(null),
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

    const analyticsMock = { capture: vi.fn().mockResolvedValue({ status: 'queued' }) }
    const redis = new Redis()
    service = new RitualService(
      prismaMock,
      weatherQueryMock,
      locationPreferencesMock,
      redis as unknown as Redis,
      analyticsMock satisfies AnalyticsClient
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

    expect(result.outfits[0]!.comfortNotes).toContain('adjusted to 52°F for comfort')
    expect(result.outfits[1]!.comfortNotes).toContain('adjusted to 64°F for comfort')
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

    expect(result.outfits[0]!.comfortNotes).toContain('adjusted to 63°F for comfort')
    expect(result.outfits[1]!.comfortNotes).toContain('adjusted to 75°F for comfort')
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
      redis as unknown as Redis,
      { capture: vi.fn() } satisfies AnalyticsClient
    )

    vi.setSystemTime(new Date('2026-07-16T12:59:00.000Z'))
    await customService.getOrCreateRitual('user-1')

    expect(getSpy).toHaveBeenLastCalledWith(
      'ritual:user-1:chicago-il:07/16/2026:en-US:any'
    )
    expect(setSpy).toHaveBeenLastCalledWith(
      'ritual:user-1:chicago-il:07/16/2026:en-US:any',
      expect.any(String),
      'EX',
      900
    )

    vi.setSystemTime(new Date('2026-07-16T13:00:00.000Z'))
    await customService.getOrCreateRitual('user-1')

    expect(getSpy).toHaveBeenLastCalledWith(
      'ritual:user-1:chicago-il:07/17/2026:en-US:any'
    )
    expect(setSpy).toHaveBeenLastCalledWith(
      'ritual:user-1:chicago-il:07/17/2026:en-US:any',
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
      redis as unknown as Redis,
      { capture: vi.fn() } satisfies AnalyticsClient
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
          'Morning feels-like temperature is 57°F (adjusted to 52°F), which is below the commute warmth threshold of 54°F.',
        ],
      },
    ])

    const middayOutfit = result.outfits.find((o) => o.scenario === 'midday')
    expect(middayOutfit?.reasoningBadges).toEqual([
      {
        key: 'light_layers',
        label: 'Light layers',
        bullets: [
          'Feels-like temperature is 70°F (adjusted to 64°F), which is between 59°F and 72°F.',
        ],
      },
    ])

    const eveningOutfit = result.outfits.find((o) => o.scenario === 'evening')
    expect(eveningOutfit?.reasoningBadges).toEqual([
      {
        key: 'evening_chill',
        label: 'Evening chill',
        bullets: [
          'Evening feels-like temperature is 63°F (adjusted to 57°F), which is below the evening chill threshold of 59°F.',
        ],
      },
    ])

    const createCalls = outfitRecommendationCreate.mock.calls as unknown as [
      { data: { reasoning_badges: unknown } },
    ][]
    const persistedBadgeText = JSON.stringify(
      createCalls.map(([input]) => input.data.reasoning_badges)
    )
    expect(persistedBadgeText).toContain('12°C')
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
    expect(eveningOutfit?.comfortNotes).toContain('Winds are high at 6 m/s')
    expect(eveningOutfit?.comfortNotes).not.toContain('6.000000000000001')

    weatherQueryMock.getLatestWeather = originalGetLatestWeather
  })

  describe('mapRawBadgeToCanonical mappings', () => {
    it('correctly maps raw badges based on new exact key and fallback rules', async () => {
      const redis = new Redis()
      const customService = new RitualService(
        prismaMock,
        weatherQueryMock,
        locationPreferencesMock,
        redis as unknown as Redis,
        { capture: vi.fn() } satisfies AnalyticsClient
      )

      const recMock = {
        id: 'rec-1',
        user_id: 'user-1',
        forecast_segment_id: 'seg-morning',
        scenario: 'morning',
        garment_ids: ['default-top'],
        reasoning_badges: [
          // 1. Exact-key lookup matches a canonical key
          { key: 'wind_layer', label: 'Custom Wind Label', bullets: ['Bullet 1'] },
          // 2. Key is present but custom/non-canonical; preserves provided label
          {
            key: 'my_custom_badge',
            label: 'My Custom Badge Label',
            bullets: ['Bullet 2'],
          },
          // 3. Key is absent, triggers keyword inference on label
          { label: 'Commute warmth advice', bullets: ['Bullet 3'] },
          // 4. Key is absent, label has no match; preserves provided label
          { label: 'Completely unknown label', bullets: ['Bullet 4'] },
        ],
        capsule_revision: 0,
        created_at: new Date('2026-07-16T05:30:00.000Z'),
        updated_at: new Date('2026-07-16T05:30:00.000Z'),
      }
      outfitRecommendationFindFirst.mockResolvedValue(recMock)

      const result = await customService.getOrCreateRitual('user-1')
      const morningOutfit = result.outfits.find((o) => o.scenario === 'morning')
      expect(morningOutfit).toBeDefined()
      expect(morningOutfit?.reasoningBadges).toEqual([
        {
          key: 'wind_layer',
          label: 'Wind layer', // maps key exactly and uses canonical label
          bullets: ['Bullet 1'],
        },
        {
          key: 'my_custom_badge',
          label: 'My Custom Badge Label', // preserves the custom label
          bullets: ['Bullet 2'],
        },
        {
          key: 'commute_warmth',
          label: 'Commute warmth', // infers from label since key is absent
          bullets: ['Bullet 3'],
        },
        {
          key: 'daily_base',
          label: 'Completely unknown label', // preserves the label since key is absent and no match found
          bullets: ['Bullet 4'],
        },
      ])
    })
  })

  describe('localization support', () => {
    it('translates comfort notes and reasoning badges using UserProfile locale preference', async () => {
      const redis = new Redis()
      const localPrisma = {
        ...prismaMock,
        userProfile: {
          findUnique: vi.fn().mockResolvedValue({
            id: 'profile-1',
            user_id: 'user-1',
            preferences: { locale: 'tr-TR' },
          }),
        },
      } as unknown as PrismaClient

      const customService = new RitualService(
        localPrisma,
        weatherQueryMock,
        locationPreferencesMock,
        redis as unknown as Redis,
        { capture: vi.fn() } satisfies AnalyticsClient
      )

      const result = await customService.getOrCreateRitual('user-1')
      expect(result).toBeDefined()
      const morningOutfit = result.outfits.find((o) => o.scenario === 'morning')
      expect(morningOutfit).toBeDefined()
      expect(morningOutfit?.comfortNotes).toContain('Hissedilen sıcaklık')
      const baseBadge = morningOutfit?.reasoningBadges.find((b) => b.key === 'daily_base')
      expect(baseBadge).toBeDefined()
      expect(baseBadge?.label).toBe('Günlük temel')
      expect(baseBadge?.bullets[0]).toBe('Gün için uygun standart üst ve alt giysi')
    })

    it('translates comfort notes and reasoning badges using Accept-Language header fallback', async () => {
      const redis = new Redis()
      const localPrisma = {
        ...prismaMock,
        userProfile: {
          findUnique: vi.fn().mockResolvedValue(null),
        },
      } as unknown as PrismaClient

      const customService = new RitualService(
        localPrisma,
        weatherQueryMock,
        locationPreferencesMock,
        redis as unknown as Redis,
        { capture: vi.fn() } satisfies AnalyticsClient
      )

      const result = await customService.getOrCreateRitual('user-1', undefined, 'es-419')
      expect(result).toBeDefined()
      const morningOutfit = result.outfits.find((o) => o.scenario === 'morning')
      expect(morningOutfit).toBeDefined()
      expect(morningOutfit?.comfortNotes).toContain('Sensación térmica')
      const baseBadge = morningOutfit?.reasoningBadges.find((b) => b.key === 'daily_base')
      expect(baseBadge).toBeDefined()
      expect(baseBadge?.label).toBe('Base diaria')
      expect(baseBadge?.bullets[0]).toBe(
        'Prenda superior e inferior estándar adecuadas para el día'
      )
    })

    it('keeps an explicitly saved en-US locale ahead of Accept-Language', async () => {
      const redis = new Redis()
      const localPrisma = {
        ...prismaMock,
        userProfile: {
          findUnique: vi.fn().mockResolvedValue({
            id: 'profile-1',
            user_id: 'user-1',
            preferences: { locale: 'en-US' },
          }),
        },
      } as unknown as PrismaClient
      const customService = new RitualService(
        localPrisma,
        weatherQueryMock,
        locationPreferencesMock,
        redis as unknown as Redis,
        { capture: vi.fn() } satisfies AnalyticsClient
      )

      const result = await customService.getOrCreateRitual('user-1', undefined, 'tr-TR')

      expect(result.outfits[0]?.comfortNotes).toContain('Feels like')
      expect(result.outfits[0]?.comfortNotes).toContain('°F')
      expect(result.outfits[0]?.comfortNotes).not.toContain('Hissedilen sıcaklık')
    })

    it('honors weighted case-insensitive Accept-Language values', async () => {
      const redis = new Redis()
      const customService = new RitualService(
        prismaMock,
        weatherQueryMock,
        locationPreferencesMock,
        redis as unknown as Redis,
        { capture: vi.fn() } satisfies AnalyticsClient
      )

      const result = await customService.getOrCreateRitual(
        'user-1',
        undefined,
        'ja-JP, TR-tr;q=0.9, fr-FR;q=0.4'
      )

      expect(result.outfits[0]?.comfortNotes).toContain('Hissedilen sıcaklık')
    })

    it('gives an explicit query locale precedence and keeps cache entries isolated', async () => {
      const redis = new Redis()
      const customService = new RitualService(
        prismaMock,
        weatherQueryMock,
        locationPreferencesMock,
        redis as unknown as Redis,
        { capture: vi.fn() } satisfies AnalyticsClient
      )

      const englishResult = await customService.getOrCreateRitual(
        'user-1',
        undefined,
        'fr-FR',
        'en-US'
      )
      const turkishResult = await customService.getOrCreateRitual(
        'user-1',
        undefined,
        'fr-FR',
        'tr-TR'
      )
      const store = (redis as unknown as { store: Record<string, string> }).store

      expect(englishResult.outfits[0]?.comfortNotes).toContain('°F')
      expect(turkishResult.outfits[0]?.comfortNotes).toContain('Hissedilen sıcaklık')
      expect(Object.keys(store).filter((key) => key.endsWith(':en-US:any'))).toHaveLength(
        1
      )
      expect(Object.keys(store).filter((key) => key.endsWith(':tr-TR:any'))).toHaveLength(
        1
      )
    })

    it('preserves custom badge bullets when localizing a non-English response', async () => {
      const redis = new Redis()
      const customService = new RitualService(
        prismaMock,
        weatherQueryMock,
        locationPreferencesMock,
        redis as unknown as Redis,
        { capture: vi.fn() } satisfies AnalyticsClient
      )
      outfitRecommendationFindFirst.mockResolvedValue({
        id: 'rec-custom',
        user_id: 'user-1',
        forecast_segment_id: 'seg-morning',
        scenario: 'morning',
        garment_ids: ['default-top'],
        reasoning_badges: [
          {
            key: 'stylist_note',
            label: 'Silk scarf',
            bullets: ['Balances the custom evening silhouette'],
          },
        ],
        capsule_revision: 0,
        created_at: new Date('2026-07-16T05:30:00.000Z'),
        updated_at: new Date('2026-07-16T05:30:00.000Z'),
      })

      const result = await customService.getOrCreateRitual(
        'user-1',
        undefined,
        undefined,
        'tr-TR'
      )
      const badge = result.outfits[0]?.reasoningBadges[0]

      expect(badge).toEqual({
        key: 'stylist_note',
        label: 'Silk scarf',
        bullets: ['Balances the custom evening silhouette'],
      })
    })
  })

  describe('invalidateUserCache', () => {
    it('should scan and delete matching user cache keys', async () => {
      const redis = new Redis()
      const mockRedisInstance = redis as unknown as { store: Record<string, string> }
      mockRedisInstance.store['ritual:user-1:chicago:07/16/2026:en-US:any'] = 'data1'
      mockRedisInstance.store['ritual:user-1:ny:07/16/2026:tr-TR:any'] = 'data2'
      mockRedisInstance.store['ritual:user-2:chicago:07/16/2026:en-US:any'] = 'data3'

      const customService = new RitualService(
        prismaMock,
        weatherQueryMock,
        locationPreferencesMock,
        redis as unknown as Redis,
        { capture: vi.fn() } satisfies AnalyticsClient
      )

      const scanSpy = vi.spyOn(redis, 'scan')
      const delSpy = vi.spyOn(redis, 'del')

      await expect(customService.invalidateUserCache('user-1')).resolves.toBe(true)

      expect(scanSpy).toHaveBeenCalledWith('0', 'MATCH', 'ritual:user-1:*', 'COUNT', 100)
      expect(delSpy).toHaveBeenCalledWith([
        'ritual:user-1:chicago:07/16/2026:en-US:any',
        'ritual:user-1:ny:07/16/2026:tr-TR:any',
      ])

      expect(
        mockRedisInstance.store['ritual:user-1:chicago:07/16/2026:en-US:any']
      ).toBeUndefined()
      expect(
        mockRedisInstance.store['ritual:user-1:ny:07/16/2026:tr-TR:any']
      ).toBeUndefined()
      expect(mockRedisInstance.store['ritual:user-2:chicago:07/16/2026:en-US:any']).toBe(
        'data3'
      )
    })
  })

  describe('Translation Catalog Parity and Interpolation checks', () => {
    const expectedLocales = [
      'en-US',
      'en-CA',
      'es-419',
      'fr-CA',
      'fr-FR',
      'tr-TR',
      'de-DE',
      'it-IT',
      'pt-BR',
      'pt-PT',
    ]

    it('verifies that all expected locales are present in translation dictionaries', () => {
      const comfortLocales = Object.keys(comfortNotesTranslations)
      const badgeLocales = Object.keys(badgeTranslations)
      expect(comfortLocales).toEqual(expect.arrayContaining(expectedLocales))
      expect(badgeLocales).toEqual(expect.arrayContaining(expectedLocales))
    })

    it('verifies comfortNotesTranslations has key parity across all locales', () => {
      const enUsNotes = comfortNotesTranslations['en-US']
      if (!enUsNotes) throw new Error('en-US comfort notes are missing')
      const sourceKeys = Object.keys(enUsNotes).sort()

      Object.values(comfortNotesTranslations).forEach((targetNotes) => {
        const targetKeys = Object.keys(targetNotes).sort()
        expect(targetKeys).toEqual(sourceKeys)
      })
    })

    it('verifies comfortNotesTranslations interpolation placeholder matches across all locales', () => {
      const extractPlaceholderNames = (str: string) => {
        const regex = /\{([^}]+)\}/g
        return [...str.matchAll(regex)].map((m) => m[1]).sort()
      }

      const enUsNotes = comfortNotesTranslations['en-US']
      if (!enUsNotes) throw new Error('en-US comfort notes are missing')
      type ComfortNoteKey = keyof typeof enUsNotes
      const comfortNoteKeys = Object.keys(enUsNotes) as ComfortNoteKey[]

      comfortNoteKeys.forEach((key) => {
        const sourceString = enUsNotes[key]
        const sourcePlaceholders = extractPlaceholderNames(sourceString)
        if (sourcePlaceholders.length === 0) return

        Object.values(comfortNotesTranslations).forEach((targetNotes) => {
          const targetString = targetNotes[key]
          const targetPlaceholders = extractPlaceholderNames(targetString)
          expect(targetPlaceholders).toEqual(sourcePlaceholders)
        })
      })
    })

    it('verifies badgeTranslations has key parity across all locales', () => {
      const enUsBadges = badgeTranslations['en-US']
      if (!enUsBadges) throw new Error('en-US badge translations are missing')
      const sourceKeys = Object.keys(enUsBadges).sort()

      Object.values(badgeTranslations).forEach((targetBadges) => {
        const targetKeys = Object.keys(targetBadges).sort()
        expect(targetKeys).toEqual(sourceKeys)
      })
    })
  })

  // ---------------------------------------------------------------------------
  // Shared helpers for the degraded-dependency and fallback suites below.
  // ---------------------------------------------------------------------------
  const buildService = (
    options: {
      prisma?: PrismaClient
      redis?: Redis
      analytics?: AnalyticsClient
    } = {}
  ) =>
    new RitualService(
      options.prisma ?? prismaMock,
      weatherQueryMock,
      locationPreferencesMock,
      (options.redis ?? new Redis()) as unknown as Redis,
      options.analytics ?? ({ capture: vi.fn() } satisfies AnalyticsClient)
    )

  const buildGarment = (
    id: string,
    category: string,
    comfortRange: string
  ): GarmentItem =>
    ({
      id,
      user_id: 'user-1',
      category,
      comfort_range: comfortRange,
      upload_status: 'ready',
      retention_status: 'active',
      updated_at: new Date('2026-07-16T05:00:00.000Z'),
    }) as unknown as GarmentItem

  const withEnv = async (
    values: Record<string, string | undefined>,
    run: () => Promise<void>
  ) => {
    const previous = Object.fromEntries(
      Object.keys(values).map((key) => [key, process.env[key]])
    )
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    try {
      await run()
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
    }
  }

  const productionEnv = { TEST_ENV: undefined, VERCEL_ENV: undefined }

  describe('degraded dependencies', () => {
    it('still builds the ritual when the Redis read fails', async () => {
      // A Redis outage may only cost a cache hit; the morning ritual must survive it.
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
      const redis = new Redis()
      vi.spyOn(redis, 'get').mockRejectedValue(new Error('connection refused'))

      const result = await buildService({ redis }).getOrCreateRitual('user-1')

      expect(result.outfits).toHaveLength(3)
      expect(warn).toHaveBeenCalled()
    })

    it('still returns the ritual when the Redis write fails', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
      const redis = new Redis()
      vi.spyOn(redis, 'set').mockRejectedValue(new Error('OOM command not allowed'))

      const result = await buildService({ redis }).getOrCreateRitual('user-1')

      expect(result.outfits).toHaveLength(3)
      expect(warn).toHaveBeenCalled()
    })

    it('reports a failed cache invalidation instead of throwing', async () => {
      // Callers use the boolean to decide whether to warn; a throw would break
      // the preference save that triggered the invalidation.
      const redis = new Redis()
      vi.spyOn(redis, 'scan').mockRejectedValue(new Error('connection refused'))

      await expect(buildService({ redis }).invalidateUserCache('user-1')).resolves.toBe(
        false
      )
    })

    it('closes its Redis connection when the module shuts down', async () => {
      const redis = new Redis()
      const quitSpy = vi.spyOn(redis, 'quit')

      await buildService({ redis }).onModuleDestroy()

      expect(quitSpy).toHaveBeenCalledTimes(1)
    })
  })

  describe('location resolution', () => {
    it('rejects a location the user does not own', async () => {
      await expect(
        service.getOrCreateRitual('user-1', 'loc-someone-else')
      ).rejects.toThrow(BadRequestException)
    })

    it('rejects a user with no saved locations', async () => {
      listLocationsMock.mockResolvedValue([])

      await expect(service.getOrCreateRitual('user-1')).rejects.toThrow(
        'No location preferences found for user'
      )
    })

    it('falls back to the first location when none is marked primary', async () => {
      listLocationsMock.mockResolvedValue([
        { ...mockLocations[0], id: 'loc-2', isPrimary: false, locationKey: 'austin-tx' },
      ])

      await service.getOrCreateRitual('user-1')

      expect(getLatestWeatherMock).toHaveBeenCalledWith('austin-tx')
    })
  })

  describe('weather availability', () => {
    it('surfaces the provider outage message outside test environments', async () => {
      await withEnv(productionEnv, async () => {
        getLatestWeatherMock.mockResolvedValue({
          status: 'unavailable',
          message: 'Weather provider is down',
        })

        await expect(service.getOrCreateRitual('user-1')).rejects.toThrow(
          InternalServerErrorException
        )
      })
    })

    it('reuses a seeded snapshot when the provider is unavailable in a test environment', async () => {
      // Preview and local environments have no provider budget; the ritual is
      // still expected to render end to end there.
      await withEnv({ TEST_ENV: 'local' }, async () => {
        getLatestWeatherMock.mockResolvedValue({ status: 'unavailable' })
        const weatherSnapshotFindFirst = vi.fn().mockResolvedValue(weatherSnapshot)
        const prisma = {
          ...prismaMock,
          weatherSnapshot: { findFirst: weatherSnapshotFindFirst, create: vi.fn() },
        } as unknown as PrismaClient

        const result = await buildService({ prisma }).getOrCreateRitual('user-1')

        expect(result.outfits).toHaveLength(3)
        expect(weatherSnapshotFindFirst).toHaveBeenCalledWith({
          where: { location_key: 'chicago-il' },
          include: { segments: true },
        })
      })
    })

    it('seeds a snapshot when a test environment has none at all', async () => {
      await withEnv({ TEST_ENV: 'preview' }, async () => {
        getLatestWeatherMock.mockResolvedValue({ status: 'unavailable' })
        const weatherSnapshotCreate = vi
          .fn()
          .mockImplementation(
            ({
              data,
            }: {
              data: { segments: { create: { forecast_at: Date }[] } } & Record<
                string,
                unknown
              >
            }) =>
              Promise.resolve({
                ...data,
                alerts: [],
                segments: data.segments.create,
              })
          )
        const prisma = {
          ...prismaMock,
          weatherSnapshot: {
            findFirst: vi.fn().mockResolvedValue(null),
            create: weatherSnapshotCreate,
          },
        } as unknown as PrismaClient

        const result = await buildService({ prisma }).getOrCreateRitual('user-1')

        expect(result.outfits).toHaveLength(3)
        const createArgs = weatherSnapshotCreate.mock.calls[0]?.[0] as {
          data: { id: string; location: string; segments: { create: unknown[] } }
        }
        expect(createArgs.data.id).toBe('mock-wx-chicago-il')
        expect(createArgs.data.location).toBe('Home')
        expect(createArgs.data.segments.create).toHaveLength(48)
      })
    })
  })

  describe('cache freshness', () => {
    const cacheKey = 'ritual:user-1:chicago-il:07/16/2026:en-US:any'
    const cachedData = { weather: {}, outfits: [], badges: ['cached'] }

    const seedCache = (redis: Redis, payload: unknown) => {
      const store = (redis as unknown as { store: Record<string, string> }).store
      store[cacheKey] = JSON.stringify(payload)
    }

    it('serves a matching cache entry without recomputing recommendations', async () => {
      const redis = new Redis()
      seedCache(redis, {
        generatedAt: '2026-07-16T05:00:00.000Z',
        weather: { fetchedAt: weatherSnapshot.fetched_at.toISOString() },
        capsuleRevision: 0,
        data: cachedData,
      })

      const result = await buildService({ redis }).getOrCreateRitual('user-1')

      expect(result).toEqual(cachedData)
      expect(outfitRecommendationFindFirst).not.toHaveBeenCalled()
    })

    it('ignores a cache entry written before the capsule revision moved', async () => {
      // Serving it would show a capsule the user already edited or deleted.
      const redis = new Redis()
      seedCache(redis, {
        generatedAt: '2026-07-16T05:00:00.000Z',
        weather: { fetchedAt: weatherSnapshot.fetched_at.toISOString() },
        capsuleRevision: 0,
        data: cachedData,
      })
      const prisma = {
        ...prismaMock,
        userProfile: {
          findUnique: vi.fn().mockResolvedValue({ capsule_revision: 3 }),
        },
      } as unknown as PrismaClient

      const result = await buildService({ prisma, redis }).getOrCreateRitual('user-1')

      expect(result.outfits).toHaveLength(3)
      expect(outfitRecommendationCreate).toHaveBeenCalled()
    })

    it('recomputes when the cache entry cannot be parsed', async () => {
      const redis = new Redis()
      const store = (redis as unknown as { store: Record<string, string> }).store
      store[cacheKey] = '{ not json'

      const result = await buildService({ redis }).getOrCreateRitual('user-1')

      expect(result.outfits).toHaveLength(3)
    })

    it('ignores a cache entry captured against an older weather fetch', async () => {
      const redis = new Redis()
      seedCache(redis, {
        generatedAt: '2026-07-16T05:00:00.000Z',
        weather: { fetchedAt: '2026-07-15T12:00:00.000Z' },
        capsuleRevision: 0,
        data: cachedData,
      })

      const result = await buildService({ redis }).getOrCreateRitual('user-1')

      expect(result.outfits).toHaveLength(3)
    })
  })

  describe('forecast segment fallbacks', () => {
    it('falls back to the most recent day with full scenario coverage', async () => {
      // Staging seeds routinely lag a day; a 500 here would block the whole app.
      getLatestWeatherMock.mockResolvedValue({
        status: 'fresh',
        data: {
          ...weatherSnapshot,
          segments: segments.filter((segment) => segment.id.endsWith('-tomorrow')),
        },
      })

      const result = await service.getOrCreateRitual('user-1')

      expect(result.outfits).toHaveLength(3)
      const createdSegmentIds = (
        outfitRecommendationCreate.mock.calls as unknown as [
          { data: { forecast_segment_id: string } },
        ][]
      ).map(([input]) => input.data.forecast_segment_id)
      expect(createdSegmentIds).toEqual([
        'seg-morning-tomorrow',
        'seg-midday-tomorrow',
        'seg-evening-tomorrow',
      ])
    })

    it('fails when no day has morning, midday and evening coverage', async () => {
      await withEnv(productionEnv, async () => {
        getLatestWeatherMock.mockResolvedValue({
          status: 'fresh',
          data: { ...weatherSnapshot, segments: [segments[0]] },
        })

        await expect(service.getOrCreateRitual('user-1')).rejects.toThrow(
          'Required daily scenario forecast segments'
        )
      })
    })

    it('self-heals a stale forecast window in a test environment', async () => {
      await withEnv({ TEST_ENV: 'local' }, async () => {
        getLatestWeatherMock.mockResolvedValue({
          status: 'fresh',
          data: { ...weatherSnapshot, segments: [segments[0]] },
        })
        const forecastSegmentUpsert = vi.fn().mockResolvedValue({})
        const prisma = {
          ...prismaMock,
          forecastSegment: { upsert: forecastSegmentUpsert },
          weatherSnapshot: {
            findUniqueOrThrow: vi.fn().mockResolvedValue(weatherSnapshot),
          },
        } as unknown as PrismaClient

        const result = await buildService({ prisma }).getOrCreateRitual('user-1')

        expect(forecastSegmentUpsert).toHaveBeenCalledTimes(48)
        expect(result.outfits).toHaveLength(3)
      })
    })
  })

  describe('garment selection', () => {
    it('pairs a dress with shoes when the closet holds one', async () => {
      garmentItemFindMany.mockResolvedValue([
        buildGarment('dress-1', 'dress', 'warm'),
        buildGarment('shoes-1', 'shoes', 'warm'),
      ])

      const result = await service.getOrCreateRitual('user-1')

      const midday = result.outfits.find((outfit) => outfit.scenario === 'midday')
      expect(midday?.garmentIds).toEqual(['dress-1', 'shoes-1'])
    })

    it('prefers an adjacent comfort range before falling back to any garment in the slot', async () => {
      // Midday sits in the `warm` band; `mild` is the first configured neighbour
      // and the untagged-for-this-band bottom must still fill its slot.
      garmentItemFindMany.mockResolvedValue([
        buildGarment('top-hot', 'top', 'hot'),
        buildGarment('top-mild', 'top', 'mild'),
        buildGarment('bottom-cold', 'bottom', 'cold'),
        buildGarment('shoes-warm', 'shoes', 'warm'),
      ])

      const result = await service.getOrCreateRitual('user-1')

      const midday = result.outfits.find((outfit) => outfit.scenario === 'midday')
      expect(midday?.garmentIds).toEqual(['top-mild', 'bottom-cold', 'shoes-warm'])
    })
  })

  describe('capsule recommendations', () => {
    const capsuleGarments = [
      buildGarment('top-1', 'top', 'warm'),
      buildGarment('bottom-1', 'bottom', 'warm'),
      buildGarment('shoes-1', 'shoes', 'warm'),
    ]

    const capsule = {
      id: 'cap-1',
      user_id: 'user-1',
      name: 'Weekend',
      occasions: ['casual'],
      is_favorite: false,
      updated_at: new Date('2026-07-15T00:00:00.000Z'),
      garment_joins: capsuleGarments.slice(0, 2).map((garment, index) => ({
        garment_id: garment.id,
        garment_order: index,
        garment,
      })),
    }

    const buildPrismaWithCapsule = () =>
      ({
        ...prismaMock,
        outfitCapsule: { findMany: vi.fn().mockResolvedValue([capsule]) },
      }) as unknown as PrismaClient

    beforeEach(() => {
      garmentItemFindMany.mockResolvedValue(capsuleGarments)
    })

    it('recommends a saved capsule, auto-fills its gaps and reports it', async () => {
      const capture = vi.fn()

      const result = await buildService({
        prisma: buildPrismaWithCapsule(),
        analytics: { capture },
      }).getOrCreateRitual('user-1')

      const midday = result.outfits.find((outfit) => outfit.scenario === 'midday')
      expect(midday?.capsuleId).toBe('cap-1')
      expect(midday?.capsuleName).toBe('Weekend')
      expect(midday?.autoFilledGarmentIds).toEqual(['shoes-1'])
      expect(midday?.reasoningBadges).toContainEqual({
        key: 'saved_capsule',
        label: 'Saved capsule',
        bullets: ['Selected from your saved capsule'],
      })
      expect(capture).toHaveBeenCalledWith({
        distinctId: 'user-1',
        event: 'wardrobe_capsule_recommended',
        properties: {
          capsule_id: 'cap-1',
          scenario: 'midday',
          completeness: 'partial',
          auto_filled_garment_count: 1,
          /*
           * The ritual path recommends a capsule without an occasion filter.
           * The analytics contract declares requested_occasion as
           * nullable().optional(), so an absent value is emitted as undefined
           * rather than an explicit null.
           */
          requested_occasion: undefined,
        },
      })
    })

    it('keeps the ritual when capsule telemetry fails', async () => {
      // Analytics is a degraded dependency, never a blocker on the core ritual.
      const capture = vi.fn().mockImplementation(() => {
        throw new Error('posthog unreachable')
      })

      const result = await buildService({
        prisma: buildPrismaWithCapsule(),
        analytics: { capture },
      }).getOrCreateRitual('user-1')

      const midday = result.outfits.find((outfit) => outfit.scenario === 'midday')
      expect(midday?.capsuleId).toBe('cap-1')
    })

    it('skips capsules that do not match the requested occasion', async () => {
      const result = await buildService({
        prisma: buildPrismaWithCapsule(),
      }).getOrCreateRitual('user-1', undefined, undefined, undefined, 'work')

      const midday = result.outfits.find((outfit) => outfit.scenario === 'midday')
      expect(midday?.capsuleId).toBeNull()
      expect(midday?.autoFilledGarmentIds).toEqual([])
    })
  })

  describe('recommendation persistence races', () => {
    const uniqueViolation = () =>
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
      })

    it('adopts the recommendation a concurrent request already wrote', async () => {
      // Two devices opening the ritual at once must converge on one row rather
      // than surfacing a 500 or writing a duplicate recommendation.
      const concurrent = {
        id: 'rec-concurrent',
        user_id: 'user-1',
        scenario: 'morning',
        garment_ids: ['default-top'],
        reasoning_badges: [],
        capsule_id: null,
        capsule_revision: 0,
        created_at: new Date('2026-07-16T05:00:00.000Z'),
        updated_at: new Date('2026-07-16T05:00:00.000Z'),
      }
      let lookups = 0
      /*
       * The shared mock is declared as ReturnType<typeof vi.fn>, whose call
       * signature returns void, but the Prisma findFirst it stands in for is
       * async. Returning the promise is what the code under test awaits.
       */
      // eslint-disable-next-line @typescript-eslint/no-misused-promises
      outfitRecommendationFindFirst.mockImplementation(() => {
        lookups += 1
        // Odd lookups are the pre-write read, even lookups the post-conflict re-read.
        return Promise.resolve(lookups % 2 === 1 ? null : concurrent)
      })
      outfitRecommendationCreate.mockRejectedValue(uniqueViolation())

      const result = await service.getOrCreateRitual('user-1')

      expect(result.outfits).toHaveLength(3)
      expect(result.outfits.every((outfit) => outfit.id === 'rec-concurrent')).toBe(true)
    })

    it('rethrows the conflict when the winning row cannot be read back', async () => {
      outfitRecommendationFindFirst.mockResolvedValue(null)
      outfitRecommendationCreate.mockRejectedValue(uniqueViolation())

      await expect(service.getOrCreateRitual('user-1')).rejects.toThrow(
        'Unique constraint failed'
      )
    })

    it('rethrows a create failure that is not a conflict', async () => {
      outfitRecommendationCreate.mockRejectedValue(new Error('connection reset'))

      await expect(service.getOrCreateRitual('user-1')).rejects.toThrow(
        'connection reset'
      )
    })

    it('rethrows when refreshing a stale recommendation fails', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
      outfitRecommendationFindFirst.mockResolvedValue({
        id: 'rec-stale',
        user_id: 'user-1',
        scenario: 'morning',
        garment_ids: [],
        reasoning_badges: [],
        capsule_id: null,
        // A revision behind the profile marks the row stale and forces an update.
        capsule_revision: 9,
        created_at: new Date('2026-07-16T05:00:00.000Z'),
        updated_at: new Date('2026-07-16T05:00:00.000Z'),
      })
      outfitRecommendationUpdate.mockRejectedValue(new Error('write conflict'))

      await expect(service.getOrCreateRitual('user-1')).rejects.toThrow('write conflict')
      expect(warn).toHaveBeenCalled()
    })
  })

  describe('weather alert mapping', () => {
    it('normalizes provider severities and timestamp shapes', async () => {
      getLatestWeatherMock.mockResolvedValue({
        status: 'fresh',
        data: {
          ...weatherSnapshot,
          alerts: [
            {
              event: 'Ice storm',
              description: 'Freezing rain expected',
              start: new Date('2026-07-16T12:00:00.000Z'),
              end: '2026-07-16T18:00:00.000Z',
              severity: 'Extreme',
            },
            {
              event: 'Fog',
              description: 'Dense fog advisory',
              start: '2026-07-16T12:00:00.000Z',
              end: '2026-07-16T14:00:00.000Z',
            },
            {
              event: 'Unknown',
              description: 'Unrecognized severity',
              start: '2026-07-16T12:00:00.000Z',
              end: '2026-07-16T14:00:00.000Z',
              severity: 'catastrophic',
            },
          ],
        },
      })

      const result = await service.getOrCreateRitual('user-1')

      expect(result.weather.alerts).toEqual([
        {
          event: 'Ice storm',
          description: 'Freezing rain expected',
          start: '2026-07-16T12:00:00.000Z',
          end: '2026-07-16T18:00:00.000Z',
          severity: 'high',
        },
        {
          event: 'Fog',
          description: 'Dense fog advisory',
          start: '2026-07-16T12:00:00.000Z',
          end: '2026-07-16T14:00:00.000Z',
          severity: 'medium',
        },
        {
          event: 'Unknown',
          description: 'Unrecognized severity',
          start: '2026-07-16T12:00:00.000Z',
          end: '2026-07-16T14:00:00.000Z',
          severity: 'medium',
        },
      ])
    })

    it('drops a non-array alerts payload', async () => {
      getLatestWeatherMock.mockResolvedValue({
        status: 'fresh',
        data: { ...weatherSnapshot, alerts: null },
      })

      const result = await service.getOrCreateRitual('user-1')

      expect(result.weather.alerts).toEqual([])
    })
  })
})
