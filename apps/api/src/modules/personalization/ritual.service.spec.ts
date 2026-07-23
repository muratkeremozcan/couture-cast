// Step 22 step 4 owner: verify translation key parity and placeholder replacements in apps/api/src/modules/personalization/ritual.service.spec.ts
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import {
  RitualService,
  comfortNotesTranslations,
  badgeTranslations,
} from './ritual.service.js'
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
      redis as unknown as Redis
    )

    vi.setSystemTime(new Date('2026-07-16T12:59:00.000Z'))
    await customService.getOrCreateRitual('user-1')

    expect(getSpy).toHaveBeenLastCalledWith('ritual:user-1:chicago-il:07/16/2026:en-US')
    expect(setSpy).toHaveBeenLastCalledWith(
      'ritual:user-1:chicago-il:07/16/2026:en-US',
      expect.any(String),
      'EX',
      900
    )

    vi.setSystemTime(new Date('2026-07-16T13:00:00.000Z'))
    await customService.getOrCreateRitual('user-1')

    expect(getSpy).toHaveBeenLastCalledWith('ritual:user-1:chicago-il:07/17/2026:en-US')
    expect(setSpy).toHaveBeenLastCalledWith(
      'ritual:user-1:chicago-il:07/17/2026:en-US',
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
        redis as unknown as Redis
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
        created_at: new Date('2026-07-16T04:00:00.000Z'),
        updated_at: new Date('2026-07-16T04:00:00.000Z'),
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
        redis as unknown as Redis
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
        redis as unknown as Redis
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
        redis as unknown as Redis
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
        redis as unknown as Redis
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
        redis as unknown as Redis
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
      expect(Object.keys(store).filter((key) => key.endsWith(':en-US'))).toHaveLength(1)
      expect(Object.keys(store).filter((key) => key.endsWith(':tr-TR'))).toHaveLength(1)
    })

    it('preserves custom badge bullets when localizing a non-English response', async () => {
      const redis = new Redis()
      const customService = new RitualService(
        prismaMock,
        weatherQueryMock,
        locationPreferencesMock,
        redis as unknown as Redis
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
        created_at: new Date('2026-07-16T04:00:00.000Z'),
        updated_at: new Date('2026-07-16T04:00:00.000Z'),
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
      mockRedisInstance.store['ritual:user-1:chicago:07/16/2026:en-US'] = 'data1'
      mockRedisInstance.store['ritual:user-1:ny:07/16/2026:tr-TR'] = 'data2'
      mockRedisInstance.store['ritual:user-2:chicago:07/16/2026:en-US'] = 'data3'

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
        'ritual:user-1:chicago:07/16/2026:en-US',
        'ritual:user-1:ny:07/16/2026:tr-TR',
      ])

      expect(
        mockRedisInstance.store['ritual:user-1:chicago:07/16/2026:en-US']
      ).toBeUndefined()
      expect(mockRedisInstance.store['ritual:user-1:ny:07/16/2026:tr-TR']).toBeUndefined()
      expect(mockRedisInstance.store['ritual:user-2:chicago:07/16/2026:en-US']).toBe(
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
})
