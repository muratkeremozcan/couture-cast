/* eslint-disable @typescript-eslint/no-unsafe-argument */
// Story 5.5: premium 7-day outfit planner.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common'
import { Prisma } from '@prisma/client'
import type { PrismaClient, GarmentItem, PlannerDayPlan } from '@prisma/client'
import type { WeatherQueryService } from '../weather/weather-query.service.js'
import type { LocationPreferencesService } from '../location-preferences/location-preferences.service.js'
import type { FeatureFlagsService } from '../feature-flags/feature-flags.service.js'
import type { TelemetryService } from '../telemetry/telemetry.service.js'
import type { SupabaseWardrobeStorageAdapter } from '../wardrobe/wardrobe-storage.adapter.js'
import { PlannerService } from './planner.service.js'
import { PLANNER_DAY_CHANGED_MESSAGE } from '../../contracts/http.js'

describe('PlannerService', () => {
  const mockTimezone = 'America/Chicago'
  const anchorIso = '2026-07-16'

  function buildGarment(overrides: Partial<GarmentItem> = {}): GarmentItem {
    return {
      id: 'garment-1',
      user_id: 'user-1',
      category: 'top',
      comfort_range: 'mild',
      upload_status: 'ready',
      retention_status: 'active',
      object_path: null,
      updated_at: new Date('2026-01-01T00:00:00Z'),
      created_at: new Date('2026-01-01T00:00:00Z'),
      ...overrides,
    } as GarmentItem
  }

  const eligibleGarments: GarmentItem[] = [
    buildGarment({ id: 'top-1', category: 'top' }),
    buildGarment({ id: 'bottom-1', category: 'bottom' }),
    buildGarment({ id: 'shoes-1', category: 'shoes' }),
  ]

  function buildSegments() {
    return [
      {
        id: 'seg-morning',
        forecast_at: new Date('2026-07-16T13:00:00.000Z'), // 08:00 America/Chicago
        temperature: 20,
        feels_like: 19,
        precipitation_probability: 0.1,
        precipitation_amount: 0,
        wind_speed: 2,
        wind_gust: null,
        condition: 'clear',
        provider_weather_code: '1000',
      },
      {
        id: 'seg-midday',
        forecast_at: new Date('2026-07-16T18:00:00.000Z'), // 13:00 America/Chicago
        temperature: 24,
        feels_like: 23,
        precipitation_probability: 0.1,
        precipitation_amount: 0,
        wind_speed: 2,
        wind_gust: null,
        condition: 'clear',
        provider_weather_code: '1000',
      },
      {
        id: 'seg-evening',
        forecast_at: new Date('2026-07-17T00:00:00.000Z'), // 19:00 America/Chicago
        temperature: 18,
        feels_like: 17,
        precipitation_probability: 0.1,
        precipitation_amount: 0,
        wind_speed: 2,
        wind_gust: null,
        condition: 'clear',
        provider_weather_code: '1000',
      },
    ]
  }

  const freshWeatherSnapshot = {
    id: 'weather-snap-1',
    location_key: 'chicago-il',
    latitude: 41.878,
    longitude: -87.63,
    timezone: mockTimezone,
    provider: 'weatherapi',
    provider_updated_at: new Date('2026-07-16T12:00:00.000Z'),
    fetched_at: new Date('2026-07-16T12:00:00.000Z'),
    temperature: 20,
    condition: 'clear',
    alerts: [],
    daily_summaries: null,
    segments: buildSegments(),
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

  let comfortPreferencesFindUnique: ReturnType<typeof vi.fn>
  let userProfileFindUnique: ReturnType<typeof vi.fn>
  let garmentItemFindMany: ReturnType<typeof vi.fn>
  let outfitCapsuleFindMany: ReturnType<typeof vi.fn>
  let plannerDayPlanFindMany: ReturnType<typeof vi.fn>
  let plannerDayPlanFindUnique: ReturnType<typeof vi.fn>
  let plannerDayPlanFindUniqueOrThrow: ReturnType<typeof vi.fn>
  let plannerDayPlanCreate: ReturnType<typeof vi.fn>
  let plannerDayPlanUpdate: ReturnType<typeof vi.fn>
  let plannerDayPlanUpdateMany: ReturnType<typeof vi.fn>
  let plannerDayPlanDeleteMany: ReturnType<typeof vi.fn>
  let getLatestWeatherMock: ReturnType<typeof vi.fn>
  let listLocationsMock: ReturnType<typeof vi.fn>
  let getFeatureFlagMock: ReturnType<typeof vi.fn>
  let captureEventMock: ReturnType<typeof vi.fn>
  let signReadUrlMock: ReturnType<typeof vi.fn>

  let prismaMock: PrismaClient
  let weatherQueryMock: WeatherQueryService
  let locationPreferencesMock: LocationPreferencesService
  let featureFlagsMock: FeatureFlagsService
  let telemetryMock: TelemetryService
  let storageMock: SupabaseWardrobeStorageAdapter
  let service: PlannerService

  /** Rows created/updated via the mocked Prisma client, keyed by plan_date ISO string. */
  const rowStore = new Map<string, PlannerDayPlan>()

  function seedRow(planDateIso: string, overrides: Partial<PlannerDayPlan> = {}) {
    const row = {
      id: `row-${planDateIso}`,
      user_id: 'user-1',
      location_id: 'loc-1',
      plan_date: new Date(`${planDateIso}T00:00:00.000Z`),
      locale: 'en-US',
      dependency_fingerprint: 'stale-fingerprint',
      plan_payload: {},
      source: 'generated',
      version: 1,
      reshuffle_count: 0,
      generated_at: new Date('2026-07-01T00:00:00.000Z'),
      created_at: new Date('2026-07-01T00:00:00.000Z'),
      updated_at: new Date('2026-07-01T00:00:00.000Z'),
      ...overrides,
    } as unknown as PlannerDayPlan
    rowStore.set(planDateIso, row)
    return row
  }

  function dateKey(date: Date): string {
    return date.toISOString().slice(0, 10)
  }

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-16T06:00:00.000Z')) // before 08:00 Chicago cutoff

    rowStore.clear()

    comfortPreferencesFindUnique = vi.fn().mockResolvedValue(null)
    userProfileFindUnique = vi.fn().mockResolvedValue(null)
    garmentItemFindMany = vi.fn().mockResolvedValue(eligibleGarments)
    outfitCapsuleFindMany = vi.fn().mockResolvedValue([])
    getLatestWeatherMock = vi
      .fn()
      .mockResolvedValue({ status: 'fresh', data: freshWeatherSnapshot })
    listLocationsMock = vi.fn().mockResolvedValue(mockLocations)
    getFeatureFlagMock = vi.fn().mockResolvedValue(true)
    captureEventMock = vi.fn().mockResolvedValue(undefined)
    signReadUrlMock = vi.fn().mockResolvedValue('https://signed.example.com/garment.jpg')

    type FindManyArgs = { where?: { plan_date?: { in?: Date[] } } }
    type UniqueWhere = {
      id?: string
      user_id_location_id_plan_date?: {
        user_id: string
        location_id: string
        plan_date: Date
      }
    }
    type UpdateArgs = { where: { id: string }; data: Record<string, unknown> }
    type UpdateManyArgs = {
      where: { id: string; version: number }
      data: Record<string, unknown>
    }
    type CreateArgs = { data: Record<string, unknown> & { plan_date: Date } }
    type Increment = { increment: number }
    const isIncrement = (value: unknown): value is Increment =>
      typeof value === 'object' && value !== null && 'increment' in value

    plannerDayPlanFindMany = vi.fn().mockImplementation((args: FindManyArgs) => {
      const dates: Date[] = args.where?.plan_date?.in ?? []
      const rows = dates
        .map((d) => rowStore.get(dateKey(d)))
        .filter((r): r is PlannerDayPlan => Boolean(r))
      return Promise.resolve(rows)
    })
    plannerDayPlanFindUnique = vi
      .fn()
      .mockImplementation(({ where }: { where: UniqueWhere }) => {
        const key = where.user_id_location_id_plan_date
        if (key) {
          const row = rowStore.get(dateKey(key.plan_date))
          return Promise.resolve(row ?? null)
        }
        if (where.id) {
          const row = [...rowStore.values()].find((r) => r.id === where.id)
          return Promise.resolve(row ?? null)
        }
        return Promise.resolve(null)
      })
    plannerDayPlanFindUniqueOrThrow = vi
      .fn()
      .mockImplementation(({ where }: { where: { id: string } }) => {
        const row = [...rowStore.values()].find((r) => r.id === where.id)
        if (!row) throw new Error('not found')
        return Promise.resolve(row)
      })
    plannerDayPlanCreate = vi.fn().mockImplementation(({ data }: CreateArgs) => {
      const key = dateKey(data.plan_date)
      const row = { id: `row-${key}`, version: 1, ...data } as unknown as PlannerDayPlan
      rowStore.set(key, row)
      return Promise.resolve(row)
    })
    plannerDayPlanUpdate = vi.fn().mockImplementation(({ where, data }: UpdateArgs) => {
      const existing = [...rowStore.values()].find((r) => r.id === where.id)
      if (!existing) throw new Error('not found')
      const updated = { ...existing, ...data } as PlannerDayPlan
      rowStore.set(dateKey(existing.plan_date), updated)
      return Promise.resolve(updated)
    })
    plannerDayPlanUpdateMany = vi
      .fn()
      .mockImplementation(({ where, data }: UpdateManyArgs) => {
        const existing = [...rowStore.values()].find((r) => r.id === where.id)
        if (!existing || existing.version !== where.version) {
          return Promise.resolve({ count: 0 })
        }
        const nextVersion = isIncrement(data.version)
          ? existing.version + data.version.increment
          : (data.version as number)
        const nextReshuffleCount = isIncrement(data.reshuffle_count)
          ? existing.reshuffle_count + data.reshuffle_count.increment
          : (data.reshuffle_count as number)
        const updated = {
          ...existing,
          ...data,
          version: nextVersion,
          reshuffle_count: nextReshuffleCount,
        } as PlannerDayPlan
        rowStore.set(dateKey(existing.plan_date), updated)
        return Promise.resolve({ count: 1 })
      })
    plannerDayPlanDeleteMany = vi.fn().mockResolvedValue({ count: 0 })

    prismaMock = {
      comfortPreferences: { findUnique: comfortPreferencesFindUnique },
      userProfile: { findUnique: userProfileFindUnique },
      garmentItem: { findMany: garmentItemFindMany },
      outfitCapsule: { findMany: outfitCapsuleFindMany },
      plannerDayPlan: {
        findMany: plannerDayPlanFindMany,
        findUnique: plannerDayPlanFindUnique,
        findUniqueOrThrow: plannerDayPlanFindUniqueOrThrow,
        create: plannerDayPlanCreate,
        update: plannerDayPlanUpdate,
        updateMany: plannerDayPlanUpdateMany,
        deleteMany: plannerDayPlanDeleteMany,
      },
    } as unknown as PrismaClient

    weatherQueryMock = {
      getLatestWeather: getLatestWeatherMock,
    } as unknown as WeatherQueryService
    locationPreferencesMock = {
      listLocations: listLocationsMock,
    } as unknown as LocationPreferencesService
    featureFlagsMock = {
      getFeatureFlag: getFeatureFlagMock,
    } as unknown as FeatureFlagsService
    telemetryMock = { captureEvent: captureEventMock } as unknown as TelemetryService
    storageMock = {
      signReadUrl: signReadUrlMock,
    } as unknown as SupabaseWardrobeStorageAdapter

    service = new PlannerService(
      prismaMock,
      weatherQueryMock,
      locationPreferencesMock,
      featureFlagsMock,
      telemetryMock,
      storageMock
    )
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('getPlannerWindow', () => {
    it('gates on the feature flag before touching location or wardrobe data', async () => {
      getFeatureFlagMock.mockResolvedValue(false)

      await expect(
        service.getPlannerWindow('user-1', undefined, undefined, undefined, 'web')
      ).rejects.toThrow(ServiceUnavailableException)

      expect(listLocationsMock).not.toHaveBeenCalled()
      expect(garmentItemFindMany).not.toHaveBeenCalled()
    })

    it('returns exactly seven consecutive ready days on first generation', async () => {
      const result = await service.getPlannerWindow(
        'user-1',
        undefined,
        undefined,
        undefined,
        'web'
      )

      expect(result.data.days).toHaveLength(7)
      expect(result.data.anchorDate).toBe(anchorIso)
      expect(result.data.days.map((d) => d.planDate)).toEqual([
        '2026-07-16',
        '2026-07-17',
        '2026-07-18',
        '2026-07-19',
        '2026-07-20',
        '2026-07-21',
        '2026-07-22',
      ])
      expect(result.data.days.every((d) => d.status === 'ready')).toBe(true)
      expect(result.data.daysReady).toBe(7)
    })

    it('uses hourly-exact confidence for the date with matching segments', async () => {
      const result = await service.getPlannerWindow(
        'user-1',
        undefined,
        undefined,
        undefined,
        'web'
      )
      const day1 = result.data.days[0]
      expect(day1?.status).toBe('ready')
      if (day1?.status === 'ready') {
        expect(day1.weather.confidence).toBe('hourly')
        expect(day1.weather.freshness).toBe('fresh')
      }
    })

    it('falls back to an unavailable-weather baseline for a date with no segments', async () => {
      const result = await service.getPlannerWindow(
        'user-1',
        undefined,
        undefined,
        undefined,
        'web'
      )
      const day2 = result.data.days[1]
      expect(day2?.status).toBe('ready')
      if (day2?.status === 'ready') {
        expect(day2.weather.confidence).toBe('unavailable')
        expect(day2.weather.freshness).toBeNull()
        expect(day2.outfits.every((o) => o.reasoningBadges.length === 0)).toBe(true)
      }
    })

    it('rejects a locationId the user does not own', async () => {
      await expect(
        service.getPlannerWindow('user-1', 'not-owned', undefined, undefined, 'web')
      ).rejects.toThrow(ForbiddenException)
    })

    it('resolves an owned, non-primary locationId and queries weather for it', async () => {
      const secondLocation = { ...mockLocations[0], id: 'loc-2', locationKey: 'nyc' }
      listLocationsMock.mockResolvedValue([mockLocations[0], secondLocation])

      const result = await service.getPlannerWindow(
        'user-1',
        'loc-2',
        undefined,
        undefined,
        'web'
      )

      expect(result.data.locationId).toBe('loc-2')
      expect(getLatestWeatherMock).toHaveBeenCalledWith('nyc')
    })

    it('reuses a stored day with an unchanged fingerprint instead of regenerating', async () => {
      await service.getPlannerWindow('user-1', undefined, undefined, undefined, 'web')
      const createCallsAfterFirst = plannerDayPlanCreate.mock.calls.length
      plannerDayPlanCreate.mockClear()

      await service.getPlannerWindow('user-1', undefined, undefined, undefined, 'web')

      expect(createCallsAfterFirst).toBe(7)
      expect(plannerDayPlanCreate).not.toHaveBeenCalled()
      expect(plannerDayPlanUpdate).not.toHaveBeenCalled()
    })

    it('regenerates a day when the eligible wardrobe changes (invalidation)', async () => {
      await service.getPlannerWindow('user-1', undefined, undefined, undefined, 'web')

      garmentItemFindMany.mockResolvedValue([
        ...eligibleGarments,
        buildGarment({ id: 'new-jacket', category: 'outerwear', comfort_range: 'cold' }),
      ])

      await service.getPlannerWindow('user-1', undefined, undefined, undefined, 'web')

      expect(plannerDayPlanUpdate).toHaveBeenCalledTimes(7)
    })

    it('recovers from a concurrent cold-read race by returning the persisted winner', async () => {
      const winner = seedRow('2026-07-16', {
        dependency_fingerprint: 'winner-fingerprint',
        plan_payload: {
          outfits: [
            {
              scenario: 'morning',
              garmentIds: ['top-1', 'bottom-1', 'shoes-1'],
              capsuleId: null,
              capsuleName: null,
              autoFilledGarmentIds: [],
              reasoningBadges: [],
              comfortNotes: 'winner',
            },
            {
              scenario: 'midday',
              garmentIds: ['top-1', 'bottom-1', 'shoes-1'],
              capsuleId: null,
              capsuleName: null,
              autoFilledGarmentIds: [],
              reasoningBadges: [],
              comfortNotes: 'winner',
            },
            {
              scenario: 'evening',
              garmentIds: ['top-1', 'bottom-1', 'shoes-1'],
              capsuleId: null,
              capsuleName: null,
              autoFilledGarmentIds: [],
              reasoningBadges: [],
              comfortNotes: 'winner',
            },
          ],
          isStarterWardrobe: false,
          weather: {
            confidence: 'hourly',
            freshness: 'fresh',
            condition: 'clear',
            temperatureLow: 19,
            temperatureHigh: 23,
          },
        },
      })
      // findMany (used to seed `existingByDate`) intentionally returns nothing for
      // this date, simulating a genuinely cold read racing another request that
      // wins the create.
      plannerDayPlanFindMany.mockResolvedValueOnce([])
      plannerDayPlanCreate.mockImplementationOnce(() => {
        throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: 'test',
          meta: { target: ['user_id', 'location_id', 'plan_date'] },
        })
      })

      const result = await service.getPlannerWindow(
        'user-1',
        undefined,
        undefined,
        undefined,
        'web'
      )

      const day1 = result.data.days[0]
      expect(day1?.status).toBe('ready')
      if (day1?.status === 'ready') {
        expect(day1.outfits[0]?.comfortNotes).toBe('winner')
        expect(day1.version).toBe(winner.version)
      }
    })

    it('isolates a single-day generation failure without failing the whole request', async () => {
      const originalScenarios = getLatestWeatherMock
      let callCount = 0
      // The exact-date matcher throws only for the specific "poisoned" call by
      // making segments a getter that throws once. Simpler: make garmentItem
      // throw only on the second wardrobe load is not per-day, so instead force
      // a per-day failure via a broken locale on one date is impractical here;
      // use a spy on Date to make the fingerprint step throw for day 2 only by
      // poisoning JSON.stringify once.
      const realStringify = JSON.stringify
      const spy = vi.spyOn(JSON, 'stringify').mockImplementation((value, ...rest) => {
        callCount += 1
        if (callCount === 2) {
          throw new Error('boom')
        }
        return realStringify(value, ...(rest as []))
      })

      const result = await service.getPlannerWindow(
        'user-1',
        undefined,
        undefined,
        undefined,
        'web'
      )

      spy.mockRestore()
      void originalScenarios

      const statuses = result.data.days.map((d) => d.status)
      expect(statuses).toContain('error')
      expect(statuses.filter((s) => s === 'ready').length).toBe(6)
      expect(result.data.daysReady).toBe(6)
      const errorDay = result.data.days.find((d) => d.status === 'error')
      if (errorDay?.status === 'error') {
        expect(errorDay.errorCode).toBe('generation_failed')
        expect(errorDay.retryable).toBe(true)
      }
    })

    it('prunes the acting user rows before the anchor date on every read', async () => {
      await service.getPlannerWindow('user-1', undefined, undefined, undefined, 'web')

      expect(plannerDayPlanDeleteMany).toHaveBeenCalledWith({
        where: {
          user_id: 'user-1',
          plan_date: { lt: new Date('2026-07-16T00:00:00.000Z') },
        },
      })
    })

    it('emits premium_planner_viewed with platform and daysReady', async () => {
      await service.getPlannerWindow('user-1', undefined, undefined, undefined, 'mobile')

      expect(captureEventMock).toHaveBeenCalledWith('user-1', 'premium_planner_viewed', {
        platform: 'mobile',
        daysReady: 7,
      })
    })
  })

  describe('reshuffleDay', () => {
    async function seedReadyWindow() {
      await service.getPlannerWindow('user-1', undefined, undefined, undefined, 'web')
    }

    it('gates on the feature flag before reading any row', async () => {
      getFeatureFlagMock.mockResolvedValue(false)

      await expect(
        service.reshuffleDay(
          'user-1',
          '2026-07-16',
          undefined,
          undefined,
          undefined,
          1,
          'web'
        )
      ).rejects.toThrow(ServiceUnavailableException)
      expect(plannerDayPlanFindUnique).not.toHaveBeenCalled()
    })

    it('rejects a malformed planDate', async () => {
      await expect(
        service.reshuffleDay(
          'user-1',
          'not-a-date',
          undefined,
          undefined,
          undefined,
          1,
          'web'
        )
      ).rejects.toThrow(BadRequestException)
    })

    it('rejects a planDate outside the current window', async () => {
      await expect(
        service.reshuffleDay(
          'user-1',
          '2026-08-01',
          undefined,
          undefined,
          undefined,
          1,
          'web'
        )
      ).rejects.toThrow(BadRequestException)
    })

    it('returns 409 when no row exists yet for the date', async () => {
      await expect(
        service.reshuffleDay(
          'user-1',
          '2026-07-16',
          undefined,
          undefined,
          undefined,
          1,
          'web'
        )
      ).rejects.toThrow(ConflictException)
    })

    it('returns 409 on a version conflict without mutating the row', async () => {
      await seedReadyWindow()

      await expect(
        service.reshuffleDay(
          'user-1',
          '2026-07-16',
          undefined,
          undefined,
          undefined,
          999,
          'web'
        )
      ).rejects.toThrow(PLANNER_DAY_CHANGED_MESSAGE)
    })

    it('atomically bumps version, reshuffle_count, and source on success', async () => {
      await seedReadyWindow()
      const before = [...rowStore.values()].find((r) =>
        r.plan_date.toISOString().startsWith('2026-07-16')
      )!

      const result = await service.reshuffleDay(
        'user-1',
        '2026-07-16',
        undefined,
        undefined,
        undefined,
        before.version,
        'web'
      )

      expect(result.data.day.version).toBe(before.version + 1)
      const after = [...rowStore.values()].find((r) => r.id === before.id)!
      expect(after.reshuffle_count).toBe(before.reshuffle_count + 1)
      expect(after.source).toBe('reshuffled')
    })

    it('prefers garments absent from the current result', async () => {
      garmentItemFindMany.mockResolvedValue([
        ...eligibleGarments,
        buildGarment({ id: 'top-2', category: 'top', comfort_range: 'mild' }),
      ])
      await seedReadyWindow()
      const before = [...rowStore.values()].find(
        (r) => dateKey(r.plan_date) === '2026-07-16'
      )!

      const result = await service.reshuffleDay(
        'user-1',
        '2026-07-16',
        undefined,
        undefined,
        undefined,
        before.version,
        'web'
      )

      const morning = result.data.day.outfits.find((o) => o.scenario === 'morning')
      expect(morning?.garmentIds).toContain('top-2')
    })

    it('sets unchanged: true when reshuffle cannot produce a different result', async () => {
      await seedReadyWindow()
      const before = [...rowStore.values()].find(
        (r) => dateKey(r.plan_date) === '2026-07-16'
      )!

      const result = await service.reshuffleDay(
        'user-1',
        '2026-07-16',
        undefined,
        undefined,
        undefined,
        before.version,
        'web'
      )

      // Only one candidate exists per category, so exclusion falls back to the
      // same garments -- the day is unchanged.
      expect(result.data.unchanged).toBe(true)
    })

    it('emits premium_planner_day_reshuffled with the correct dayOffset', async () => {
      await seedReadyWindow()
      const before = [...rowStore.values()].find(
        (r) => dateKey(r.plan_date) === '2026-07-18'
      )!

      await service.reshuffleDay(
        'user-1',
        '2026-07-18',
        undefined,
        undefined,
        undefined,
        before.version,
        'mobile'
      )

      expect(captureEventMock).toHaveBeenCalledWith(
        'user-1',
        'premium_planner_day_reshuffled',
        expect.objectContaining({ platform: 'mobile', dayOffset: 2 })
      )
    })

    it('rejects a locationId the user does not own', async () => {
      await expect(
        service.reshuffleDay(
          'user-1',
          '2026-07-16',
          'not-owned',
          undefined,
          undefined,
          1,
          'web'
        )
      ).rejects.toThrow(ForbiddenException)
    })
  })
})
