import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common'
import { createBaseLogger } from '../../logger/pino.config.js'
import { TelemetryService } from '../telemetry/telemetry.service'
import {
  WeatherRefreshQueue,
  type WeatherRefreshPublisher,
} from '../weather/weather-refresh.queue.js'
import { WeatherRepository } from '../weather/weather.repository.js'
import type {
  CreateSavedLocationInput,
  SavedLocation,
  UpdateSavedLocationInput,
} from '../../contracts/http'
import {
  PrismaLocationPreferencesRepository,
  type CreateSavedLocationCommand,
  type LocationPreferencesRepository,
  SavedLocationDuplicateError,
  SavedLocationLimitExceededError,
  type SavedLocationRecord,
  type UpdateSavedLocationCommand,
} from './location-preferences.repository'

function normalizeLocationKey(locationKey: string): string {
  const normalized = locationKey
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')

  if (!normalized) {
    throw new BadRequestException('Invalid saved location key')
  }

  return normalized
}

function roundCoordinate(value: number): number {
  return Math.round(value * 1000) / 1000
}

function requireCompleteLocationIdentity(input: UpdateSavedLocationInput): void {
  const providedFieldCount = [
    input.locationKey,
    input.latitude,
    input.longitude,
    input.timezone,
  ].filter((value) => value !== undefined).length

  if (providedFieldCount > 0 && providedFieldCount < 4) {
    throw new BadRequestException(
      'locationKey, latitude, longitude, and timezone must be updated together'
    )
  }
}

function handleRepositoryError(error: unknown): never {
  if (
    error instanceof SavedLocationDuplicateError ||
    error instanceof SavedLocationLimitExceededError
  ) {
    throw new BadRequestException(error.message)
  }

  throw error
}

export function toSavedLocation(record: SavedLocationRecord): SavedLocation {
  return {
    id: record.id,
    label: record.label,
    locationKey: record.location_key,
    latitude: record.latitude,
    longitude: record.longitude,
    timezone: record.timezone,
    city: record.city,
    region: record.region,
    country: record.country,
    isPrimary: record.is_primary,
    sortOrder: record.sort_order,
    createdAt: record.created_at.toISOString(),
    updatedAt: record.updated_at.toISOString(),
  }
}

function trimOrNull(val: string | null | undefined): string | null | undefined {
  if (val === undefined) {
    return undefined
  }
  if (val === null) {
    return null
  }
  return val.trim()
}

function buildUpdateCommand(input: UpdateSavedLocationInput): UpdateSavedLocationCommand {
  const command: UpdateSavedLocationCommand = {}

  if (input.label !== undefined) {
    command.label = input.label.trim()
  }
  if (input.latitude !== undefined) {
    command.latitude = roundCoordinate(input.latitude)
  }
  if (input.longitude !== undefined) {
    command.longitude = roundCoordinate(input.longitude)
  }
  if (input.timezone !== undefined) {
    command.timezone = input.timezone.trim()
  }

  const city = trimOrNull(input.city)
  if (city !== undefined) {
    command.city = city
  }

  const region = trimOrNull(input.region)
  if (region !== undefined) {
    command.region = region
  }

  const country = trimOrNull(input.country)
  if (country !== undefined) {
    command.country = country
  }

  if (input.sortOrder !== undefined) {
    command.sortOrder = input.sortOrder
  }

  return command
}

/** Story 1.2b: a new primary whose snapshot is older than this gets a refresh. */
export const PRIMARY_REFRESH_STALE_AFTER_MS = 5 * 60 * 1000
/** Enqueueing never holds a primary switch longer than this. */
export const PRIMARY_REFRESH_ENQUEUE_DEADLINE_MS = 1000

export const LOCATION_PREFERENCES_CLOCK = Symbol('LOCATION_PREFERENCES_CLOCK')

export interface LocationPreferencesClock {
  now(): Date
}

function withDeadline(work: Promise<void>, ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<void>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error('refresh enqueue deadline exceeded')), ms)
  })
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer))
}

@Injectable()
export class LocationPreferencesService {
  private readonly logger = createBaseLogger().child({ feature: 'location-preferences' })

  constructor(
    @Inject(PrismaLocationPreferencesRepository)
    private readonly repository: LocationPreferencesRepository,
    @Inject(TelemetryService)
    private readonly telemetryService: Pick<TelemetryService, 'captureEvent'>,
    @Inject(WeatherRepository)
    private readonly weatherRepository: Pick<
      WeatherRepository,
      'findLatestByLocationKey'
    >,
    @Inject(WeatherRefreshQueue)
    private readonly weatherRefresh: WeatherRefreshPublisher,
    @Optional()
    @Inject(LOCATION_PREFERENCES_CLOCK)
    clock?: LocationPreferencesClock
  ) {
    this.clock = clock ?? { now: () => new Date() }
  }

  private readonly clock: LocationPreferencesClock

  async listLocations(userId: string): Promise<SavedLocation[]> {
    const locations = await this.repository.findManyByUserId(userId)

    return locations.map(toSavedLocation)
  }

  async createLocation(
    userId: string,
    input: CreateSavedLocationInput
  ): Promise<SavedLocation> {
    const locationKey = normalizeLocationKey(input.locationKey)

    const command: CreateSavedLocationCommand = {
      label: input.label.trim(),
      locationKey,
      latitude: roundCoordinate(input.latitude),
      longitude: roundCoordinate(input.longitude),
      timezone: input.timezone.trim(),
      city: input.city?.trim() ?? null,
      region: input.region?.trim() ?? null,
      country: input.country?.trim() ?? null,
    }

    try {
      const location = await this.repository.create(userId, command)

      return toSavedLocation(location)
    } catch (error) {
      handleRepositoryError(error)
    }
  }

  async updateLocation(
    userId: string,
    locationId: string,
    input: UpdateSavedLocationInput
  ): Promise<SavedLocation> {
    const existing = await this.repository.findByIdForUser(userId, locationId)
    if (!existing) {
      throw new NotFoundException('Saved location not found')
    }

    requireCompleteLocationIdentity(input)

    const command = buildUpdateCommand(input)
    if (input.locationKey !== undefined) {
      const locationKey = normalizeLocationKey(input.locationKey)
      const duplicate = await this.repository.findByLocationKeyForUser(
        userId,
        locationKey
      )
      if (duplicate && duplicate.id !== locationId) {
        throw new BadRequestException('Saved location already exists')
      }
      command.locationKey = locationKey
    }

    let updated: SavedLocationRecord | null
    try {
      updated = await this.repository.update(userId, locationId, command)
    } catch (error) {
      handleRepositoryError(error)
    }

    if (!updated) {
      throw new NotFoundException('Saved location not found')
    }

    return toSavedLocation(updated)
  }

  async setPrimary(userId: string, locationId: string): Promise<SavedLocation> {
    const existing = await this.repository.findManyByUserId(userId)
    const currentPrimary = existing.find((loc) => loc.is_primary)
    const fromLocation = currentPrimary ? currentPrimary.location_key : null

    const updated = await this.repository.setPrimary(userId, locationId)
    if (!updated) {
      throw new NotFoundException('Saved location not found')
    }

    const savedLocation = toSavedLocation(updated)

    if (fromLocation !== savedLocation.locationKey) {
      await this.telemetryService.captureEvent(userId, 'location_switched', {})
      await this.refreshPrimaryIfStale(updated)
    }

    return savedLocation
  }

  async deleteLocation(userId: string, locationId: string): Promise<{ deleted: true }> {
    const deleted = await this.repository.delete(userId, locationId)
    if (!deleted) {
      throw new NotFoundException('Saved location not found')
    }

    if (deleted.is_primary) {
      const remaining = await this.repository.findManyByUserId(userId)
      const promoted = remaining.find((location) => location.is_primary)
      if (promoted) {
        await this.refreshPrimaryIfStale(promoted)
      }
    }

    return { deleted: true }
  }

  /**
   * Story 1.2b: a new primary location whose snapshot is absent or older than
   * five minutes gets the existing `weather-refresh-location` job. Until it
   * lands the ritual serves its stale-data fallback, or weather-unavailable
   * for a location that never had a snapshot. A slow or failed enqueue never
   * fails the request; the next sweep covers the location either way.
   */
  private async refreshPrimaryIfStale(location: SavedLocationRecord): Promise<void> {
    try {
      const now = this.clock.now()
      const snapshot = await this.weatherRepository.findLatestByLocationKey(
        location.location_key
      )
      if (
        snapshot &&
        now.getTime() - snapshot.fetched_at.getTime() <= PRIMARY_REFRESH_STALE_AFTER_MS
      ) {
        return
      }
      await withDeadline(
        this.weatherRefresh.enqueueLocationRefresh(
          {
            locationKey: location.location_key,
            locationName: location.city?.trim() || location.label.trim(),
            latitude: location.latitude,
            longitude: location.longitude,
          },
          now
        ),
        PRIMARY_REFRESH_ENQUEUE_DEADLINE_MS
      )
    } catch (error) {
      this.logger.warn(
        { reason: error instanceof Error ? error.name : 'unknown' },
        'primary location refresh enqueue failed'
      )
    }
  }
}
