// Story 1.2b capture owner: search, rate limit, save-time forecast and transactional snapshot in `apps/api/src/modules/location-preferences/location-capture.service.ts`
import { Inject, Injectable } from '@nestjs/common'
import { classifyClimateBand } from '@couture/utils'
import type { Prisma } from '@prisma/client'
import type {
  LocationPlatform,
  LocationSearchCandidate,
  SavedLocation,
  SupportedLocale,
} from '../../contracts/http'
import { createBaseLogger } from '../../logger/pino.config.js'
import { TelemetryService } from '../telemetry/telemetry.service.js'
import type {
  GeocodedPlace,
  ILocationGeocoder,
} from '../weather/providers/location-geocoding.js'
import { WeatherProviderError } from '../weather/providers/weather-provider.error.js'
import type { IWeatherProvider } from '../weather/providers/weather-provider.interface.js'
import type { NormalizedWeatherForecast } from '../weather/providers/weather.types.js'
import { parseDailySummaries, WeatherRepository } from '../weather/weather.repository.js'
import {
  decodeLocationCandidate,
  encodeLocationCandidate,
  InvalidLocationCandidateError,
  resolveLocationCandidateSecret,
  type LocationCandidate,
} from './location-candidate-token.js'
import {
  LocationSearchRateLimitException,
  locationRequestError,
  locationUnavailableError,
} from './location-capture.errors.js'
import { buildSearchLocationKey } from './location-key.js'
import {
  MAX_SAVED_LOCATIONS,
  PrismaLocationPreferencesRepository,
  SavedLocationDuplicateError,
  SavedLocationLimitExceededError,
  type LocationPreferencesRepository,
} from './location-preferences.repository.js'
import { LOCATION_CLOCK, type LocationClock } from './location-clock.js'
import { toSavedLocation } from './location-preferences.service.js'

export const LOCATION_GEOCODER = Symbol('LOCATION_GEOCODER')
export const LOCATION_FORECAST_PROVIDER = Symbol('LOCATION_FORECAST_PROVIDER')

/** Story 1.2b: provider calls on the capture path give up after 3 seconds. */
export const LOCATION_PROVIDER_TIMEOUT_MS = 3000
export const LOCATION_SEARCHES_PER_MINUTE = 30

type SearchFailureOutcome =
  | 'no_results'
  | 'provider_unavailable'
  | 'provider_timeout'
  | 'provider_unconfigured'
  | 'service_unavailable'

type SaveOutcome =
  | 'saved'
  | 'limit_reached'
  | 'duplicate'
  | 'invalid_candidate'
  | 'forecast_unavailable'
  | 'service_unavailable'

const SERVICE_UNAVAILABLE_MESSAGE = 'Location search is temporarily unavailable.'
const PROVIDER_UNAVAILABLE_MESSAGE =
  'The location provider is temporarily unavailable. Try again.'
const INVALID_CANDIDATE_MESSAGE = 'This search result expired. Search again.'
const LIMIT_MESSAGE = 'Users can save at most three locations'
const DUPLICATE_MESSAGE = 'Saved location already exists'

function searchFailureOutcome(error: unknown): SearchFailureOutcome {
  if (!(error instanceof WeatherProviderError)) return 'provider_unavailable'
  if (error.kind === 'timeout') return 'provider_timeout'
  if (error.kind === 'invalid_configuration') return 'provider_unconfigured'
  return 'provider_unavailable'
}

function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value })
    return true
  } catch {
    return false
  }
}

function countryDisplayName(country: string, locale: string): string {
  try {
    return new Intl.DisplayNames([locale], { type: 'region' }).of(country) ?? country
  } catch {
    return country
  }
}

/** City states such as Monaco name the city and country alike; say it once. */
function displayLabel(place: GeocodedPlace, locale: string): string {
  const seen = new Set<string>()
  return [
    place.localizedName ?? place.city,
    place.region,
    countryDisplayName(place.country, locale),
  ]
    .filter((part): part is string => {
      if (!part) return false
      const key = part.trim().toLocaleLowerCase(locale)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .join(', ')
}

/**
 * Story 1.2b: city search through the configured provider's geocoding and the
 * save path that turns a signed candidate into a weather-ready saved location.
 * New log lines here carry no query text, coordinates, place names or keys.
 */
@Injectable()
export class LocationCaptureService {
  private readonly logger = createBaseLogger().child({ feature: 'location-capture' })

  constructor(
    @Inject(PrismaLocationPreferencesRepository)
    private readonly repository: LocationPreferencesRepository,
    @Inject(WeatherRepository)
    private readonly weatherRepository: Pick<WeatherRepository, 'persistForecastWithin'>,
    @Inject(LOCATION_GEOCODER)
    private readonly geocoder: ILocationGeocoder,
    @Inject(LOCATION_FORECAST_PROVIDER)
    private readonly forecastProvider: IWeatherProvider,
    @Inject(TelemetryService)
    private readonly telemetryService: Pick<TelemetryService, 'captureEvent'>,
    @Inject(LOCATION_CLOCK)
    private readonly clock: LocationClock
  ) {}

  async search(
    userId: string,
    query: string,
    locale: SupportedLocale,
    platform: LocationPlatform
  ): Promise<LocationSearchCandidate[]> {
    await this.limitSearches(userId)

    const secret = resolveLocationCandidateSecret()
    if (!secret) {
      await this.recordSearchFailure(userId, platform, 'service_unavailable')
      throw locationUnavailableError(
        'location_service_unavailable',
        SERVICE_UNAVAILABLE_MESSAGE
      )
    }

    let places: GeocodedPlace[]
    try {
      places = await this.geocoder.search(
        query,
        locale.split('-')[0] ?? 'en',
        AbortSignal.timeout(LOCATION_PROVIDER_TIMEOUT_MS)
      )
    } catch (error) {
      const outcome = searchFailureOutcome(error)
      this.logger.warn(
        { provider: this.geocoder.provider, outcome },
        'location search failed'
      )
      await this.recordSearchFailure(userId, platform, outcome)
      throw locationUnavailableError('provider_unavailable', PROVIDER_UNAVAILABLE_MESSAGE)
    }

    const now = this.clock.now()
    const seen = new Set<string>()
    const candidates: LocationSearchCandidate[] = []
    for (const place of places) {
      const key = buildSearchLocationKey(place)
      if (seen.has(key)) continue
      seen.add(key)
      candidates.push({
        city: place.city,
        region: place.region,
        country: place.country,
        latitude: place.latitude,
        longitude: place.longitude,
        displayLabel: displayLabel(place, locale),
        candidateToken: encodeLocationCandidate(place, secret, now),
      })
    }

    if (candidates.length === 0) {
      await this.recordSearchFailure(userId, platform, 'no_results')
    }
    return candidates
  }

  async saveFromSearch(
    userId: string,
    candidateToken: string,
    label: string,
    platform: LocationPlatform
  ): Promise<SavedLocation> {
    const secret = resolveLocationCandidateSecret()
    if (!secret) {
      await this.recordSave(userId, platform, 'service_unavailable', null)
      throw locationUnavailableError(
        'location_service_unavailable',
        SERVICE_UNAVAILABLE_MESSAGE
      )
    }

    let candidate: LocationCandidate
    try {
      candidate = decodeLocationCandidate(candidateToken, secret, this.clock.now())
    } catch (error) {
      if (!(error instanceof InvalidLocationCandidateError)) throw error
      await this.recordSave(userId, platform, 'invalid_candidate', null)
      throw locationRequestError('invalid_candidate', INVALID_CANDIDATE_MESSAGE)
    }

    const locationKey = buildSearchLocationKey(candidate)
    const existing = await this.repository.findManyByUserId(userId)
    if (existing.some((location) => location.location_key === locationKey)) {
      await this.recordSave(userId, platform, 'duplicate', existing.length)
      throw locationRequestError('location_duplicate', DUPLICATE_MESSAGE)
    }
    if (existing.length >= MAX_SAVED_LOCATIONS) {
      await this.recordSave(userId, platform, 'limit_reached', existing.length)
      throw locationRequestError('location_limit_reached', LIMIT_MESSAGE)
    }

    const forecast = await this.fetchSaveForecast(
      userId,
      platform,
      candidate,
      locationKey,
      existing.length
    )
    try {
      // The snapshot commits with the location: a save that loses the
      // duplicate or limit race leaves no orphan snapshot behind.
      const location = await this.repository.create(
        userId,
        {
          label: label.trim(),
          locationKey,
          latitude: candidate.latitude,
          longitude: candidate.longitude,
          timezone: forecast.timezone,
          city: candidate.city,
          region: candidate.region,
          country: candidate.country,
        },
        {
          withinTransaction: (transaction) =>
            this.weatherRepository.persistForecastWithin(transaction, forecast),
        }
      )
      await this.recordSave(userId, platform, 'saved', existing.length + 1)
      return toSavedLocation(location)
    } catch (error) {
      if (error instanceof SavedLocationDuplicateError) {
        await this.recordSave(userId, platform, 'duplicate', existing.length)
        throw locationRequestError('location_duplicate', DUPLICATE_MESSAGE)
      }
      if (error instanceof SavedLocationLimitExceededError) {
        await this.recordSave(userId, platform, 'limit_reached', MAX_SAVED_LOCATIONS)
        throw locationRequestError('location_limit_reached', LIMIT_MESSAGE)
      }
      throw error
    }
  }

  /**
   * One forecast call through the configured provider. It supplies the IANA
   * timezone and becomes the location's snapshot, so the location is
   * weather-ready when the save returns. Any failure saves nothing.
   */
  private async fetchSaveForecast(
    userId: string,
    platform: LocationPlatform,
    candidate: LocationCandidate,
    locationKey: string,
    savedCount: number
  ): Promise<NormalizedWeatherForecast> {
    try {
      const forecast = await this.forecastProvider.fetchForecast(
        {
          locationKey,
          locationName: candidate.city,
          latitude: candidate.latitude,
          longitude: candidate.longitude,
        },
        AbortSignal.timeout(LOCATION_PROVIDER_TIMEOUT_MS)
      )
      if (!isValidTimeZone(forecast.timezone)) {
        throw new WeatherProviderError('Forecast timezone is invalid', {
          provider: forecast.provider,
          kind: 'invalid_response',
        })
      }
      // Weather-ready means the climate band can resolve from this snapshot:
      // the daily projection, read back exactly as Community reads it, has to
      // hold the band's minimum usable days.
      const daily = parseDailySummaries(forecast.daily as unknown as Prisma.JsonValue, {
        warn: (message, meta) => this.logger.warn({ meta }, message),
      })
      if (!classifyClimateBand(daily)) {
        throw new WeatherProviderError('Forecast has too few usable days', {
          provider: forecast.provider,
          kind: 'invalid_response',
        })
      }
      return forecast
    } catch (error) {
      this.logger.warn(
        { provider: this.geocoder.provider, outcome: searchFailureOutcome(error) },
        'location save forecast failed'
      )
      await this.recordSave(userId, platform, 'forecast_unavailable', savedCount)
      throw locationUnavailableError('provider_unavailable', PROVIDER_UNAVAILABLE_MESSAGE)
    }
  }

  private async limitSearches(userId: string): Promise<void> {
    const now = this.clock.now()
    const { searches, windowStart } = await this.repository.recordSearch(userId, now)
    if (searches <= LOCATION_SEARCHES_PER_MINUTE) return
    throw new LocationSearchRateLimitException(
      Math.max(1, Math.ceil((windowStart.getTime() + 60_000 - now.getTime()) / 1000))
    )
  }

  private async recordSearchFailure(
    userId: string,
    platform: LocationPlatform,
    outcome: SearchFailureOutcome
  ): Promise<void> {
    await this.capture(userId, 'location_search_failed', {
      platform,
      outcome,
      resultCount: 0,
    })
  }

  private async recordSave(
    userId: string,
    platform: LocationPlatform,
    outcome: SaveOutcome,
    savedCount: number | null
  ): Promise<void> {
    const resultCount =
      savedCount ?? (await this.repository.findManyByUserId(userId)).length
    await this.capture(userId, 'location_saved', {
      platform,
      outcome,
      resultCount: Math.min(resultCount, MAX_SAVED_LOCATIONS),
    })
  }

  /** Analytics must never change the request outcome. */
  private async capture(
    userId: string,
    event: 'location_saved' | 'location_search_failed',
    properties: Parameters<TelemetryService['captureEvent']>[2]
  ): Promise<void> {
    try {
      await this.telemetryService.captureEvent(userId, event, properties as never)
    } catch {
      this.logger.warn({ event }, 'location analytics capture failed')
    }
  }
}
