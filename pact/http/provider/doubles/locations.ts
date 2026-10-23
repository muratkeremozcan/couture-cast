import type { Prisma } from '@prisma/client'
import type { TelemetryService } from '../../../../apps/api/src/modules/telemetry/telemetry.service'
import type { LocationClock } from '../../../../apps/api/src/modules/location-preferences/location-clock.js'
import {
  MAX_SAVED_LOCATIONS,
  SavedLocationDuplicateError,
  SavedLocationLimitExceededError,
  type LocationPreferencesRepository,
  type SavedLocationRecord,
} from '../../../../apps/api/src/modules/location-preferences/location-preferences.repository.js'
import type { ILocationGeocoder } from '../../../../apps/api/src/modules/weather/providers/location-geocoding.js'
import { WeatherProviderError } from '../../../../apps/api/src/modules/weather/providers/weather-provider.error.js'
import type { IWeatherProvider } from '../../../../apps/api/src/modules/weather/providers/weather-provider.interface.js'
import type {
  NormalizedDailyWeatherEntry,
  NormalizedWeatherForecast,
} from '../../../../apps/api/src/modules/weather/providers/weather.types.js'
import type { WeatherRefreshPublisher } from '../../../../apps/api/src/modules/weather/weather-refresh.queue.js'
import type { WeatherRepository } from '../../../../apps/api/src/modules/weather/weather.repository.js'
import { getProviderLocationWorld, PACT_CHICAGO_PLACE } from '../state'

/**
 * Story 1.2b location seams. Provider verification runs the real controller,
 * `RequestAuthGuard`, `LocationCaptureService` and `LocationPreferencesService`;
 * only what those services inject is faked here: the saved-location repository,
 * the weather repository, the geocoder, the forecast provider, telemetry, the
 * clock and the refresh queue. Each fake reads the world the current provider
 * state built in `state.ts`, so every status and `code` the contract records is
 * produced by the services themselves. Nothing here reaches a network.
 */

function world() {
  const current = getProviderLocationWorld()
  if (!current) throw new Error('LOCATION_STATE_NOT_CONFIGURED')
  return current
}

function ownedBy(userId: string): SavedLocationRecord[] {
  return world()
    .records.filter((record) => record.user_id === userId)
    .sort(
      (a, b) =>
        a.sort_order - b.sort_order ||
        a.created_at.getTime() - b.created_at.getTime() ||
        a.id.localeCompare(b.id)
    )
}

function findOwned(userId: string, locationId: string) {
  return world().records.find(
    (record) => record.id === locationId && record.user_id === userId
  )
}

/** The repository opens a Prisma transaction; the fake hands over a stand-in. */
const transaction = {} as Prisma.TransactionClient

/** Mirrors `PrismaLocationPreferencesRepository`, one member's rows at a time. */
const repository = {
  async create(userId, command, options = {}) {
    const existing = ownedBy(userId)
    if (existing.some((record) => record.location_key === command.locationKey)) {
      throw new SavedLocationDuplicateError()
    }
    if (existing.length >= MAX_SAVED_LOCATIONS) {
      throw new SavedLocationLimitExceededError()
    }
    await options.withinTransaction?.(transaction)
    const now = world().now
    const last = existing.at(-1)
    const created: SavedLocationRecord = {
      id: `loc-saved-${world().records.length + 1}`,
      user_id: userId,
      label: command.label,
      location_key: command.locationKey,
      latitude: command.latitude,
      longitude: command.longitude,
      timezone: command.timezone,
      city: command.city ?? null,
      region: command.region ?? null,
      country: command.country ?? null,
      is_primary: existing.length === 0,
      sort_order: last ? last.sort_order + 1 : 0,
      created_at: now,
      updated_at: now,
    }
    world().records.push(created)
    return { ...created }
  },
  delete(userId, locationId) {
    const existing = findOwned(userId, locationId)
    if (!existing) return Promise.resolve(null)
    const current = world()
    current.records = current.records.filter((record) => record !== existing)
    if (existing.is_primary) {
      const [next] = ownedBy(userId)
      if (next) next.is_primary = true
    }
    return Promise.resolve(existing)
  },
  findByIdForUser(userId, locationId) {
    return Promise.resolve(findOwned(userId, locationId) ?? null)
  },
  findByLocationKeyForUser(userId, locationKey) {
    return Promise.resolve(
      ownedBy(userId).find((record) => record.location_key === locationKey) ?? null
    )
  },
  findManyByUserId(userId) {
    return Promise.resolve(ownedBy(userId).map((record) => ({ ...record })))
  },
  recordSearch(userId, now) {
    const windowStart = new Date(Math.floor(now.getTime() / 60_000) * 60_000)
    const windows = world().searchWindows
    const previous = windows.get(userId)
    const searches =
      previous && previous.windowStart.getTime() === windowStart.getTime()
        ? previous.searches + 1
        : 1
    windows.set(userId, { searches, windowStart })
    return Promise.resolve({ searches, windowStart })
  },
  setPrimary(userId, locationId) {
    const target = findOwned(userId, locationId)
    if (!target) return Promise.resolve(null)
    for (const record of ownedBy(userId)) record.is_primary = false
    target.is_primary = true
    target.updated_at = world().now
    return Promise.resolve({ ...target })
  },
  update(userId, locationId, command) {
    const target = findOwned(userId, locationId)
    if (!target) return Promise.resolve(null)
    if (
      command.locationKey !== undefined &&
      ownedBy(userId).some(
        (record) =>
          record.id !== locationId && record.location_key === command.locationKey
      )
    ) {
      return Promise.reject(new SavedLocationDuplicateError())
    }
    if (command.label !== undefined) target.label = command.label
    if (command.locationKey !== undefined) target.location_key = command.locationKey
    if (command.latitude !== undefined) target.latitude = command.latitude
    if (command.longitude !== undefined) target.longitude = command.longitude
    if (command.timezone !== undefined) target.timezone = command.timezone
    if (command.city !== undefined) target.city = command.city
    if (command.region !== undefined) target.region = command.region
    if (command.country !== undefined) target.country = command.country
    if (command.sortOrder !== undefined) target.sort_order = command.sortOrder
    target.updated_at = world().now
    return Promise.resolve({ ...target })
  },
} satisfies LocationPreferencesRepository

/** No snapshot is stored, so a new primary always asks for a refresh. */
const weatherRepository = {
  persistForecastWithin(_transaction, forecast) {
    world().persistedForecasts.push(forecast)
    return Promise.resolve()
  },
  findLatestByLocationKey() {
    return Promise.resolve(null)
  },
} satisfies Pick<WeatherRepository, 'persistForecastWithin' | 'findLatestByLocationKey'>

const outage = () =>
  new WeatherProviderError('Pact provider outage', {
    provider: 'openweather',
    kind: 'retryable_http',
    statusCode: 503,
  })

const geocoder = {
  provider: 'openweather',
  search() {
    if (world().geocoderDown) return Promise.reject(outage())
    return Promise.resolve([PACT_CHICAGO_PLACE])
  },
} satisfies ILocationGeocoder

/** Five usable days: above the climate band's minimum, so the save is weather-ready. */
const usableDaily: NormalizedDailyWeatherEntry[] = [
  '2026-10-22',
  '2026-10-23',
  '2026-10-24',
  '2026-10-25',
  '2026-10-26',
].map((localDate) => ({
  localDate,
  condition: 'drizzle',
  temperatureMin: 8,
  temperatureMax: 15,
  precipitationProbability: 0.4,
  precipitationAmount: 1.2,
  windSpeed: 3,
}))

const forecastProvider = {
  fetchForecast(target) {
    if (world().forecastDown) return Promise.reject(outage())
    const now = world().now
    const forecast: NormalizedWeatherForecast = {
      provider: 'openweather',
      locationKey: target.locationKey,
      locationName: target.locationName,
      latitude: target.latitude,
      longitude: target.longitude,
      timezone: 'America/Chicago',
      providerUpdatedAt: now,
      fetchedAt: now,
      current: {
        temperature: 12,
        feelsLike: 11,
        windSpeed: 3,
        humidity: 70,
        condition: 'drizzle',
        providerConditionText: 'light drizzle',
        providerWeatherCode: '300',
      },
      hourly: [],
      daily: usableDaily,
      alerts: [],
    }
    return Promise.resolve(forecast)
  },
} satisfies IWeatherProvider

const telemetry = {
  captureEvent() {
    return Promise.resolve()
  },
} satisfies Pick<TelemetryService, 'captureEvent'>

const clock = {
  now: () => world().now,
} satisfies LocationClock

const weatherRefresh = {
  enqueueLocationRefresh(target) {
    world().refreshTargets.push(target)
    return Promise.resolve()
  },
} satisfies WeatherRefreshPublisher

export function createLocationDoubles() {
  return {
    repository,
    weatherRepository,
    geocoder,
    forecastProvider,
    telemetry,
    clock,
    weatherRefresh,
  }
}
