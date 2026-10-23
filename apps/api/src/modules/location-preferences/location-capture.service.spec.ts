import {
  BadRequestException,
  type HttpException,
  ServiceUnavailableException,
} from '@nestjs/common'
import type { Prisma } from '@prisma/client'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type {
  GeocodedPlace,
  ILocationGeocoder,
} from '../weather/providers/location-geocoding'
import { WeatherProviderError } from '../weather/providers/weather-provider.error'
import type { IWeatherProvider } from '../weather/providers/weather-provider.interface'
import { classifyClimateBand } from '@couture/utils'
import type {
  NormalizedDailyWeatherEntry,
  NormalizedWeatherForecast,
} from '../weather/providers/weather.types'
import type { TelemetryService } from '../telemetry/telemetry.service'
import type { WeatherRepository } from '../weather/weather.repository'
import {
  encodeLocationCandidate,
  resolveLocationCandidateSecret,
} from './location-candidate-token'
import { LocationSearchRateLimitException } from './location-capture.errors'
import { LocationCaptureService } from './location-capture.service'
import {
  SavedLocationDuplicateError,
  SavedLocationLimitExceededError,
  type CreateSavedLocationCommand,
  type CreateSavedLocationOptions,
  type LocationPreferencesRepository,
  type SavedLocationRecord,
} from './location-preferences.repository'

const now = new Date('2026-10-22T12:00:30.000Z')
const userId = 'member-1'
// The spec's numbers, written out so a change to a production constant fails.
const PROVIDER_DEADLINE_MS = 3000
const CANDIDATE_LIFETIME_MS = 15 * 60_000

const chicago: GeocodedPlace = {
  city: 'Chicago',
  region: 'Illinois',
  country: 'US',
  latitude: 41.878,
  longitude: -87.63,
  localizedName: 'シカゴ',
}

/** Stands in for the Prisma transaction client the repository opens. */
const transaction = { sentinel: 'transaction' } as unknown as Prisma.TransactionClient

function record(overrides: Partial<SavedLocationRecord> = {}): SavedLocationRecord {
  return {
    id: 'location-1',
    user_id: userId,
    label: 'Home',
    location_key: 'home',
    latitude: 1,
    longitude: 1,
    timezone: 'UTC',
    city: null,
    region: null,
    country: null,
    is_primary: true,
    sort_order: 0,
    created_at: now,
    updated_at: now,
    ...overrides,
  }
}

function day(localDate: string): NormalizedDailyWeatherEntry {
  return {
    localDate,
    condition: 'drizzle',
    temperatureMin: 24,
    temperatureMax: 33,
    precipitationProbability: 0.4,
    precipitationAmount: 1.2,
    windSpeed: 3,
  }
}

/** Five days: comfortably above the climate band's three-day minimum. */
const usableDaily = [
  '2026-10-22',
  '2026-10-23',
  '2026-10-24',
  '2026-10-25',
  '2026-10-26',
].map(day)

function forecast(
  overrides: Partial<NormalizedWeatherForecast> = {}
): NormalizedWeatherForecast {
  return {
    provider: 'openweather',
    locationKey: 'ignored',
    latitude: 41.878,
    longitude: -87.63,
    timezone: 'America/Chicago',
    providerUpdatedAt: now,
    fetchedAt: now,
    current: {
      temperature: 31,
      feelsLike: 30,
      windSpeed: 3,
      humidity: 70,
      condition: 'drizzle',
      providerConditionText: 'light drizzle',
      providerWeatherCode: '300',
    },
    hourly: [],
    daily: usableDaily,
    alerts: [],
    ...overrides,
  }
}

describe('LocationCaptureService', () => {
  let saved: SavedLocationRecord[]
  let repository: {
    [K in keyof LocationPreferencesRepository]: Mock<LocationPreferencesRepository[K]>
  }
  let persistForecastWithin: ReturnType<typeof vi.fn>
  let geocoder: ILocationGeocoder & { search: ReturnType<typeof vi.fn> }
  let fetchForecast: Mock<IWeatherProvider['fetchForecast']>
  let captureEvent: ReturnType<typeof vi.fn>
  let searches: number
  let service: LocationCaptureService

  beforeEach(() => {
    saved = []
    searches = 0
    repository = {
      create: vi.fn(
        async (
          _owner: string,
          command: CreateSavedLocationCommand,
          options?: CreateSavedLocationOptions
        ) => {
          // The real repository runs this inside the location's transaction.
          await options?.withinTransaction?.(transaction)
          const created = record({
            id: `location-${saved.length + 1}`,
            label: command.label,
            location_key: command.locationKey,
            latitude: command.latitude,
            longitude: command.longitude,
            timezone: command.timezone,
            city: command.city ?? null,
            region: command.region ?? null,
            country: command.country ?? null,
            is_primary: saved.length === 0,
            sort_order: saved.length,
          })
          saved.push(created)
          return created
        }
      ),
      delete: vi.fn<LocationPreferencesRepository['delete']>(),
      findByIdForUser: vi.fn<LocationPreferencesRepository['findByIdForUser']>(),
      findByLocationKeyForUser:
        vi.fn<LocationPreferencesRepository['findByLocationKeyForUser']>(),
      findManyByUserId: vi.fn(() => Promise.resolve([...saved])),
      recordSearch: vi.fn(() => {
        searches += 1
        return Promise.resolve({
          searches,
          windowStart: new Date('2026-10-22T12:00:00.000Z'),
        })
      }),
      setPrimary: vi.fn<LocationPreferencesRepository['setPrimary']>(),
      update: vi.fn<LocationPreferencesRepository['update']>(),
    }
    persistForecastWithin = vi.fn().mockResolvedValue(undefined)
    geocoder = {
      provider: 'openweather',
      search: vi.fn().mockResolvedValue([chicago]),
    }
    fetchForecast = vi
      .fn<IWeatherProvider['fetchForecast']>()
      .mockResolvedValue(forecast())
    captureEvent = vi.fn().mockResolvedValue(undefined)
    service = new LocationCaptureService(
      repository,
      { persistForecastWithin } as unknown as Pick<
        WeatherRepository,
        'persistForecastWithin'
      >,
      geocoder,
      { fetchForecast },
      { captureEvent } as unknown as Pick<TelemetryService, 'captureEvent'>,
      { now: () => now }
    )
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  async function searchToken(place: GeocodedPlace = chicago): Promise<string> {
    geocoder.search.mockResolvedValueOnce([place])
    const [candidate] = await service.search(userId, place.city, 'en-US', 'web')
    return candidate!.candidateToken
  }

  describe('search', () => {
    it('1.2b-UNIT-CAP-01 returns candidates with ISO country, rounded coordinates and a localized label', async () => {
      const candidates = await service.search(userId, 'Chicago', 'fr-FR', 'web')

      expect(geocoder.search).toHaveBeenCalledWith(
        'Chicago',
        'fr',
        expect.any(AbortSignal)
      )
      expect(candidates).toEqual([
        {
          city: 'Chicago',
          region: 'Illinois',
          country: 'US',
          latitude: 41.878,
          longitude: -87.63,
          displayLabel: 'シカゴ, Illinois, États-Unis',
          candidateToken: candidates[0]?.candidateToken,
        },
      ])
      expect(candidates[0]?.candidateToken).toMatch(/^[\w-]+\.[\w-]+$/)
      expect(captureEvent).not.toHaveBeenCalled()
    })

    it('1.2b-UNIT-CAP-18 names a city state once in its display label', async () => {
      geocoder.search.mockResolvedValueOnce([
        { ...chicago, city: 'Monaco', region: null, country: 'MC', localizedName: null },
      ])

      const [monaco] = await service.search(userId, 'Monaco', 'en-US', 'web')

      expect(monaco?.displayLabel).toBe('Monaco')
    })

    it('1.2b-UNIT-CAP-02 collapses provider results that share a location key', async () => {
      geocoder.search.mockResolvedValueOnce([
        chicago,
        { ...chicago, localizedName: null },
      ])

      expect(await service.search(userId, 'Chicago', 'en-US', 'web')).toHaveLength(1)
    })

    it('1.2b-UNIT-CAP-03 records a no-results search without the query', async () => {
      geocoder.search.mockResolvedValueOnce([])

      expect(await service.search(userId, 'Nowhere', 'en-US', 'mobile')).toEqual([])
      expect(captureEvent).toHaveBeenCalledWith(userId, 'location_search_failed', {
        platform: 'mobile',
        outcome: 'no_results',
        resultCount: 0,
      })
    })

    it.each([
      [
        'provider_unavailable',
        new WeatherProviderError('down', {
          provider: 'openweather',
          kind: 'retryable_http',
        }),
      ],
      [
        'provider_timeout',
        new WeatherProviderError('slow', { provider: 'openweather', kind: 'timeout' }),
      ],
      [
        'provider_unconfigured',
        new WeatherProviderError('key', {
          provider: 'openweather',
          kind: 'invalid_configuration',
        }),
      ],
      ['provider_unavailable', new Error('boom')],
    ])(
      '1.2b-UNIT-CAP-04 answers a typed retryable 503 and records %s',
      async (outcome, error) => {
        geocoder.search.mockRejectedValueOnce(error)

        const failure = await service
          .search(userId, 'Chicago', 'en-US', 'web')
          .catch((caught: unknown) => caught)

        expect(failure).toBeInstanceOf(ServiceUnavailableException)
        expect((failure as HttpException).getResponse()).toEqual({
          statusCode: 503,
          code: 'provider_unavailable',
          retryable: true,
          message: 'The location provider is temporarily unavailable. Try again.',
          error: 'Service Unavailable',
        })
        expect(captureEvent).toHaveBeenCalledWith(userId, 'location_search_failed', {
          platform: 'web',
          outcome,
          resultCount: 0,
        })
      }
    )

    it('1.2b-UNIT-CAP-05 passes a 3-second deadline to the provider', async () => {
      const timeout = vi.spyOn(AbortSignal, 'timeout')

      await service.search(userId, 'Chicago', 'en-US', 'web')

      expect(timeout).toHaveBeenCalledWith(PROVIDER_DEADLINE_MS)
      // The deadline is the signal the geocoder actually receives.
      expect(geocoder.search.mock.calls[0]?.[2]).toBe(timeout.mock.results[0]?.value)
    })

    it('1.2b-UNIT-CAP-06 refuses the 31st search in a minute before any provider call', async () => {
      for (let index = 0; index < 30; index += 1) {
        await service.search(userId, 'Chicago', 'en-US', 'web')
      }
      geocoder.search.mockClear()

      const refused = await service
        .search(userId, 'Chicago', 'en-US', 'web')
        .catch((caught: unknown) => caught)

      expect(refused).toBeInstanceOf(LocationSearchRateLimitException)
      expect((refused as LocationSearchRateLimitException).retryAfterSeconds).toBe(30)
      expect(geocoder.search).not.toHaveBeenCalled()
    })

    it('1.2b-UNIT-CAP-07 fails closed with a 503 when the candidate secret is missing', async () => {
      vi.stubEnv('NODE_ENV', 'production')
      vi.stubEnv('TEST_ENV', '')
      vi.stubEnv('LOCATION_CANDIDATE_SECRET', '')

      const failure = await service
        .search(userId, 'Chicago', 'en-US', 'web')
        .catch((caught: unknown) => caught)

      expect((failure as HttpException).getResponse()).toMatchObject({
        statusCode: 503,
        code: 'location_service_unavailable',
      })
      expect(geocoder.search).not.toHaveBeenCalled()
      expect(captureEvent).toHaveBeenCalledWith(userId, 'location_search_failed', {
        platform: 'web',
        outcome: 'service_unavailable',
        resultCount: 0,
      })
    })
  })

  describe('saveFromSearch', () => {
    it('1.2b-UNIT-CAP-08 saves the first location weather-ready with server-held fields only', async () => {
      const token = await searchToken()

      const location = await service.saveFromSearch(userId, token, '  Home ', 'web')

      expect(fetchForecast).toHaveBeenCalledWith(
        {
          locationKey: 'chicago-illinois-us-41-878n-87-630w',
          locationName: 'Chicago',
          latitude: 41.878,
          longitude: -87.63,
        },
        expect.any(AbortSignal)
      )
      expect(persistForecastWithin).toHaveBeenCalledTimes(1)
      // Inside the location's own transaction, so it commits with the location.
      expect(persistForecastWithin.mock.calls[0]![0]).toBe(transaction)
      // The persisted snapshot resolves the climate band on its own.
      const persisted = persistForecastWithin.mock
        .calls[0]![1] as NormalizedWeatherForecast
      expect(classifyClimateBand(persisted.daily ?? [])).not.toBeNull()
      expect(location).toMatchObject({
        label: 'Home',
        locationKey: 'chicago-illinois-us-41-878n-87-630w',
        timezone: 'America/Chicago',
        city: 'Chicago',
        region: 'Illinois',
        country: 'US',
        isPrimary: true,
      })
      expect(captureEvent).toHaveBeenLastCalledWith(userId, 'location_saved', {
        platform: 'web',
        outcome: 'saved',
        resultCount: 1,
      })
    })

    it('1.2b-UNIT-CAP-09 saves nothing when the forecast fails, times out, has an invalid timezone or cannot resolve a climate band', async () => {
      const token = await searchToken()

      for (const failure of [
        () =>
          fetchForecast.mockRejectedValueOnce(
            new WeatherProviderError('down', {
              provider: 'openweather',
              kind: 'retryable_http',
            })
          ),
        () =>
          fetchForecast.mockRejectedValueOnce(
            new WeatherProviderError('slow', { provider: 'openweather', kind: 'timeout' })
          ),
        () => fetchForecast.mockResolvedValueOnce(forecast({ timezone: 'Mars/Olympus' })),
        () => fetchForecast.mockResolvedValueOnce(forecast({ daily: undefined })),
        () => fetchForecast.mockResolvedValueOnce(forecast({ daily: [] })),
        // Two usable days: one short of the band's minimum.
        () =>
          fetchForecast.mockResolvedValueOnce(
            forecast({ daily: usableDaily.slice(0, 2) })
          ),
        // Five days, but a refreshed row repeats a date: three distinct is the
        // minimum, so repeating two dates leaves too few.
        () =>
          fetchForecast.mockResolvedValueOnce(
            forecast({ daily: [...usableDaily.slice(0, 2), ...usableDaily.slice(0, 2)] })
          ),
        // Malformed rows are discarded on read, exactly as Community reads them.
        () =>
          fetchForecast.mockResolvedValueOnce(
            forecast({
              daily: usableDaily.map((entry, index) =>
                index < 3 ? { ...entry, precipitationProbability: 7 } : entry
              ),
            })
          ),
      ]) {
        failure()
        const error = await service
          .saveFromSearch(userId, token, 'Home', 'web')
          .catch((caught: unknown) => caught)
        expect((error as HttpException).getResponse()).toMatchObject({
          statusCode: 503,
          code: 'provider_unavailable',
          retryable: true,
        })
      }

      expect(persistForecastWithin).not.toHaveBeenCalled()
      expect(repository.create).not.toHaveBeenCalled()
      expect(captureEvent).toHaveBeenLastCalledWith(userId, 'location_saved', {
        platform: 'web',
        outcome: 'forecast_unavailable',
        resultCount: 0,
      })
    })

    it('1.2b-UNIT-CAP-10 refuses tampered, foreign-environment and expired tokens with 400', async () => {
      const secret = resolveLocationCandidateSecret()!
      const tokens = [
        `${(await searchToken()).split('.')[0]}.forged`,
        encodeLocationCandidate(chicago, 'another-environment-secret-0123456789abc', now),
        encodeLocationCandidate(
          chicago,
          secret,
          new Date(now.getTime() - CANDIDATE_LIFETIME_MS)
        ),
      ]

      for (const token of tokens) {
        const error = await service
          .saveFromSearch(userId, token, 'Home', 'web')
          .catch((caught: unknown) => caught)
        expect(error).toBeInstanceOf(BadRequestException)
        expect((error as HttpException).getResponse()).toMatchObject({
          code: 'invalid_candidate',
        })
      }
      expect(fetchForecast).not.toHaveBeenCalled()
    })

    it('1.2b-UNIT-CAP-11 refuses a duplicate key before calling the provider', async () => {
      const token = await searchToken()
      await service.saveFromSearch(userId, token, 'Home', 'web')
      fetchForecast.mockClear()

      const error = await service
        .saveFromSearch(userId, token, 'Again', 'web')
        .catch((caught: unknown) => caught)

      expect((error as HttpException).getResponse()).toMatchObject({
        code: 'location_duplicate',
      })
      expect(fetchForecast).not.toHaveBeenCalled()
    })

    it('1.2b-UNIT-CAP-12 explains the three-location limit', async () => {
      saved.push(
        record({ id: 'a', location_key: 'a' }),
        record({ id: 'b', location_key: 'b', is_primary: false }),
        record({ id: 'c', location_key: 'c', is_primary: false })
      )

      const error = await service
        .saveFromSearch(userId, await searchToken(), 'Fourth', 'web')
        .catch((caught: unknown) => caught)

      expect((error as HttpException).getResponse()).toMatchObject({
        code: 'location_limit_reached',
      })
      expect(captureEvent).toHaveBeenLastCalledWith(userId, 'location_saved', {
        platform: 'web',
        outcome: 'limit_reached',
        resultCount: 3,
      })
      // Refused before the provider is asked, so a full collection costs no quota.
      expect(fetchForecast).not.toHaveBeenCalled()
      expect(persistForecastWithin).not.toHaveBeenCalled()
    })

    it('1.2b-UNIT-CAP-13 maps a duplicate that races in under the lock to 400', async () => {
      repository.create.mockRejectedValueOnce(new SavedLocationDuplicateError())

      const error = await service
        .saveFromSearch(userId, await searchToken(), 'Home', 'web')
        .catch((caught: unknown) => caught)

      expect((error as HttpException).getResponse()).toMatchObject({
        code: 'location_duplicate',
      })
    })

    it('1.2b-UNIT-CAP-19 maps a limit that races in under the lock to 400', async () => {
      repository.create.mockRejectedValueOnce(new SavedLocationLimitExceededError())

      const error = await service
        .saveFromSearch(userId, await searchToken(), 'Home', 'web')
        .catch((caught: unknown) => caught)

      expect(error).toBeInstanceOf(BadRequestException)
      expect((error as HttpException).getResponse()).toMatchObject({
        code: 'location_limit_reached',
      })
      expect(captureEvent).toHaveBeenLastCalledWith(userId, 'location_saved', {
        platform: 'web',
        outcome: 'limit_reached',
        resultCount: 3,
      })
    })

    it('1.2b-UNIT-CAP-20 gives up on the save forecast at 3 seconds and saves nothing', async () => {
      const token = await searchToken()
      // Node's AbortSignal.timeout runs on an internal timer that fake timers
      // cannot reach, so the deadline is rebuilt on the faked setTimeout.
      vi.useFakeTimers()
      vi.spyOn(AbortSignal, 'timeout').mockImplementation((milliseconds) => {
        const controller = new AbortController()
        setTimeout(() => controller.abort(), milliseconds)
        return controller.signal
      })
      fetchForecast.mockImplementationOnce(
        (_target, signal) =>
          new Promise((_resolve, reject) => {
            signal?.addEventListener('abort', () =>
              reject(
                new WeatherProviderError('slow', {
                  provider: 'openweather',
                  kind: 'timeout',
                })
              )
            )
          })
      )
      let settled = false
      const outcome = service
        .saveFromSearch(userId, token, 'Home', 'web')
        .catch((caught: unknown) => caught)
        .finally(() => {
          settled = true
        })

      await vi.advanceTimersByTimeAsync(PROVIDER_DEADLINE_MS - 1)
      expect(settled).toBe(false)
      await vi.advanceTimersByTimeAsync(1)
      expect(settled).toBe(true)

      expect(((await outcome) as HttpException).getResponse()).toMatchObject({
        statusCode: 503,
        code: 'provider_unavailable',
        retryable: true,
      })
      expect(persistForecastWithin).not.toHaveBeenCalled()
      expect(repository.create).not.toHaveBeenCalled()
    })

    it('1.2b-UNIT-CAP-21 fails closed with a 503 on save when the candidate secret is missing', async () => {
      const token = await searchToken()
      vi.stubEnv('NODE_ENV', 'production')
      vi.stubEnv('TEST_ENV', '')
      vi.stubEnv('LOCATION_CANDIDATE_SECRET', '')

      const failure = await service
        .saveFromSearch(userId, token, 'Home', 'web')
        .catch((caught: unknown) => caught)

      expect(failure).toBeInstanceOf(ServiceUnavailableException)
      expect((failure as HttpException).getResponse()).toMatchObject({
        statusCode: 503,
        code: 'location_service_unavailable',
      })
      expect(fetchForecast).not.toHaveBeenCalled()
      expect(repository.create).not.toHaveBeenCalled()
      expect(captureEvent).toHaveBeenLastCalledWith(userId, 'location_saved', {
        platform: 'web',
        outcome: 'service_unavailable',
        resultCount: 0,
      })
    })

    it('1.2b-UNIT-CAP-14 saves a replayed token into the caller collection only', async () => {
      const token = await searchToken()

      await service.saveFromSearch('member-2', token, 'Borrowed', 'mobile')

      expect(repository.create).toHaveBeenCalledWith(
        'member-2',
        expect.anything(),
        expect.anything()
      )
      expect(repository.create).not.toHaveBeenCalledWith(
        userId,
        expect.anything(),
        expect.anything()
      )
    })

    it('1.2b-UNIT-CAP-15 gives every display locale the same location key', async () => {
      geocoder.search.mockResolvedValueOnce([{ ...chicago, localizedName: 'シカゴ' }])
      const [ja] = await service.search(userId, 'Chicago', 'tr-TR', 'web')
      geocoder.search.mockResolvedValueOnce([{ ...chicago, localizedName: null }])
      const [en] = await service.search(userId, 'Chicago', 'en-US', 'web')

      const first = await service.saveFromSearch(userId, ja!.candidateToken, 'A', 'web')
      saved.splice(0)
      const second = await service.saveFromSearch(userId, en!.candidateToken, 'B', 'web')

      expect(first.locationKey).toBe(second.locationKey)
    })

    it('1.2b-UNIT-CAP-16 never lets an analytics failure change the outcome', async () => {
      captureEvent.mockRejectedValue(new Error('posthog down'))

      await expect(
        service.saveFromSearch(userId, await searchToken(), 'Home', 'web')
      ).resolves.toMatchObject({ label: 'Home' })
    })

    it('1.2b-UNIT-CAP-17 keeps place names, coordinates and keys out of analytics', async () => {
      await service.saveFromSearch(userId, await searchToken(), 'Home', 'web')
      geocoder.search.mockResolvedValueOnce([])
      await service.search(userId, 'Secret Query', 'en-US', 'web')

      const serialized = JSON.stringify(
        (captureEvent.mock.calls as unknown[][]).map((call) => call.slice(1))
      )
      expect(serialized).not.toMatch(/chicago|illinois|41\.8|87\.6|secret query|home/i)
    })
  })
})
