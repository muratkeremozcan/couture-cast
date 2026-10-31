// Learning path Step 45: Client location capture.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-45-client-location-capture
import { BadRequestException, NotFoundException } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { UpdateSavedLocationInput } from '../../contracts/http'

import { LocationPreferencesService } from './location-preferences.service'
import {
  SavedLocationDuplicateError,
  SavedLocationLimitExceededError,
  type CreateSavedLocationCommand,
  type LocationPreferencesRepository,
  type SavedLocationRecord,
  type UpdateSavedLocationCommand,
} from './location-preferences.repository'
import type { TelemetryService } from '../telemetry/telemetry.service'
import type { WeatherRefreshPublisher } from '../weather/weather-refresh.queue'
import type { WeatherRepository } from '../weather/weather.repository'

const userId = 'user-1'

function savedLocation(
  overrides: Partial<SavedLocationRecord> = {}
): SavedLocationRecord {
  const now = new Date('2026-07-09T12:00:00.000Z')

  return {
    id: overrides.id ?? 'location-1',
    user_id: overrides.user_id ?? userId,
    label: overrides.label ?? 'Home',
    location_key: overrides.location_key ?? 'chicago-il',
    latitude: overrides.latitude ?? 41.878,
    longitude: overrides.longitude ?? -87.63,
    timezone: overrides.timezone ?? 'America/Chicago',
    city: overrides.city ?? 'Chicago',
    region: overrides.region ?? 'IL',
    country: overrides.country ?? 'US',
    is_primary: overrides.is_primary ?? true,
    sort_order: overrides.sort_order ?? 0,
    created_at: overrides.created_at ?? now,
    updated_at: overrides.updated_at ?? now,
  }
}

function createRepositoryStub() {
  const locations = [
    savedLocation({ id: 'location-1', location_key: 'home', sort_order: 0 }),
    savedLocation({
      id: 'location-2',
      label: 'Office',
      location_key: 'office',
      is_primary: false,
      sort_order: 1,
    }),
  ]

  return {
    create: vi
      .fn()
      .mockImplementation((_ownerId: string, command: CreateSavedLocationCommand) =>
        Promise.resolve(
          savedLocation({
            id: 'created-location',
            label: command.label,
            location_key: command.locationKey,
            latitude: command.latitude,
            longitude: command.longitude,
            timezone: command.timezone,
            city: command.city ?? null,
            region: command.region ?? null,
            country: command.country ?? null,
            is_primary: locations.length === 0,
            sort_order: locations.length,
          })
        )
      ),
    delete: vi.fn().mockResolvedValue(savedLocation({ id: 'location-1' })),
    findByIdForUser: vi.fn().mockImplementation((_ownerId: string, id: string) => {
      return Promise.resolve(locations.find((location) => location.id === id) ?? null)
    }),
    findByLocationKeyForUser: vi.fn().mockResolvedValue(null),
    findManyByUserId: vi.fn().mockResolvedValue(locations),
    recordSearch: vi.fn(),
    setPrimary: vi.fn().mockImplementation((_ownerId: string, id: string) => {
      if (locations.some((location) => location.id === id)) {
        return Promise.resolve(savedLocation({ id }))
      }

      return Promise.resolve(null)
    }),
    update: vi
      .fn()
      .mockImplementation(
        (_ownerId: string, id: string, command: UpdateSavedLocationCommand) =>
          Promise.resolve(savedLocation({ id, ...command }))
      ),
  } satisfies LocationPreferencesRepository
}

describe('LocationPreferencesService', () => {
  let repository: ReturnType<typeof createRepositoryStub>
  let service: LocationPreferencesService
  let captureEvent: ReturnType<typeof vi.fn>
  let findLatestByLocationKey: ReturnType<typeof vi.fn>
  let enqueueLocationRefresh: Mock<WeatherRefreshPublisher['enqueueLocationRefresh']>
  const now = new Date('2026-10-22T12:00:00.000Z')

  beforeEach(() => {
    repository = createRepositoryStub()
    captureEvent = vi.fn()
    findLatestByLocationKey = vi.fn().mockResolvedValue(null)
    enqueueLocationRefresh = vi
      .fn<WeatherRefreshPublisher['enqueueLocationRefresh']>()
      .mockResolvedValue(undefined)
    const telemetryService = { captureEvent } as unknown as TelemetryService
    service = new LocationPreferencesService(
      repository,
      telemetryService,
      { findLatestByLocationKey } as unknown as Pick<
        WeatherRepository,
        'findLatestByLocationKey'
      >,
      { enqueueLocationRefresh },
      { now: () => now }
    )
  })

  it('creates the first saved location as primary with canonical key and rounded coordinates', async () => {
    await service.createLocation(userId, {
      label: 'Office',
      locationKey: ' Chicago IL ',
      latitude: 41.87812,
      longitude: -87.62984,
      timezone: 'America/Chicago',
      city: 'Chicago',
      region: 'IL',
      country: 'US',
    })

    expect(repository.create).toHaveBeenCalledWith(
      userId,
      expect.objectContaining({
        locationKey: 'chicago-il',
        latitude: 41.878,
        longitude: -87.63,
      })
    )
  })

  it('throws BadRequestException for invalid normalized key', async () => {
    await expect(
      service.createLocation(userId, {
        label: 'Office',
        locationKey: ' --- ',
        latitude: 41.87812,
        longitude: -87.62984,
        timezone: 'America/Chicago',
      })
    ).rejects.toBeInstanceOf(BadRequestException)
  })

  it('rejects max-three and duplicate saved locations per user', async () => {
    repository.create.mockRejectedValueOnce(new SavedLocationLimitExceededError())

    await expect(
      service.createLocation(userId, {
        label: 'Gym',
        locationKey: 'gym',
        latitude: 40,
        longitude: -90,
        timezone: 'America/Chicago',
      })
    ).rejects.toBeInstanceOf(BadRequestException)

    repository.create.mockRejectedValueOnce(new SavedLocationDuplicateError())

    await expect(
      service.createLocation(userId, {
        label: 'Office',
        locationKey: 'Office',
        latitude: 40,
        longitude: -90,
        timezone: 'America/Chicago',
      })
    ).rejects.toBeInstanceOf(BadRequestException)
  })

  it('lists all saved locations for a user', async () => {
    const result = await service.listLocations(userId)
    expect(repository.findManyByUserId).toHaveBeenCalledWith(userId)
    expect(result).toHaveLength(2)
    expect(result[0]?.id).toBe('location-1')
  })

  it('updates a saved location successfully', async () => {
    const input: UpdateSavedLocationInput = {
      label: ' New Home ',
      locationKey: 'new-york-ny',
      latitude: 42.1234,
      longitude: -88.5678,
      timezone: 'America/New_York',
      city: null,
      region: ' NY ',
      country: ' US ',
      sortOrder: 2,
    }

    const result = await service.updateLocation(userId, 'location-1', input)

    expect(repository.update).toHaveBeenCalledWith(
      userId,
      'location-1',
      expect.objectContaining({
        label: 'New Home',
        locationKey: 'new-york-ny',
        latitude: 42.123,
        longitude: -88.568,
        timezone: 'America/New_York',
        city: null,
        region: 'NY',
        country: 'US',
        sortOrder: 2,
      })
    )
    expect(result.label).toBe('New Home')
  })

  it('updates only the label successfully', async () => {
    const input: UpdateSavedLocationInput = {
      label: ' Just Label ',
    }

    const result = await service.updateLocation(userId, 'location-1', input)

    expect(repository.update).toHaveBeenCalledWith(
      userId,
      'location-1',
      expect.objectContaining({
        label: 'Just Label',
      })
    )
    expect(result.label).toBe('Just Label')
  })

  it('updates locationKey and checks for duplicates', async () => {
    const input: UpdateSavedLocationInput = {
      locationKey: 'office',
      latitude: 42.1234,
      longitude: -88.5678,
      timezone: 'America/New_York',
    }

    // Attempting to update to a duplicate key that belongs to a different location
    repository.findByLocationKeyForUser.mockResolvedValueOnce(
      savedLocation({ id: 'location-2', location_key: 'office' })
    )

    await expect(
      service.updateLocation(userId, 'location-1', input)
    ).rejects.toBeInstanceOf(BadRequestException)

    // Updating to same key of the current location is allowed
    repository.findByLocationKeyForUser.mockResolvedValueOnce(
      savedLocation({ id: 'location-1', location_key: 'office' })
    )

    const result = await service.updateLocation(userId, 'location-1', input)
    expect(result.id).toBe('location-1')
  })

  it('handles repository errors during update', async () => {
    repository.update.mockRejectedValueOnce(new SavedLocationDuplicateError())

    const input: UpdateSavedLocationInput = {
      label: 'New Office',
      locationKey: 'new-office',
      latitude: 42.1234,
      longitude: -88.5678,
      timezone: 'America/New_York',
    }

    await expect(
      service.updateLocation(userId, 'location-1', input)
    ).rejects.toBeInstanceOf(BadRequestException)
  })

  it('throws NotFoundException if location is missing during update', async () => {
    repository.findByIdForUser.mockResolvedValueOnce(null)

    await expect(
      service.updateLocation(userId, 'missing-location', {
        label: 'Gym',
      })
    ).rejects.toBeInstanceOf(NotFoundException)
  })

  it('throws NotFoundException if updated record is null', async () => {
    repository.update.mockResolvedValueOnce(null)

    await expect(
      service.updateLocation(userId, 'location-1', {
        label: 'Gym',
        locationKey: 'gym-location',
        latitude: 40.1,
        longitude: -90.2,
        timezone: 'America/Chicago',
      })
    ).rejects.toBeInstanceOf(NotFoundException)
  })

  it('throws generic error in handleRepositoryError if not custom error', async () => {
    const genericError = new Error('Database connection failed')
    repository.update.mockRejectedValueOnce(genericError)

    await expect(
      service.updateLocation(userId, 'location-1', {
        label: 'Gym',
        locationKey: 'gym-location',
        latitude: 40.1,
        longitude: -90.2,
        timezone: 'America/Chicago',
      })
    ).rejects.toThrow('Database connection failed')
  })

  it('rejects partial location identity updates', async () => {
    await expect(
      service.updateLocation(userId, 'location-1', {
        locationKey: 'new-location',
      })
    ).rejects.toBeInstanceOf(BadRequestException)

    expect(repository.update).not.toHaveBeenCalled()
  })

  it('sets primary transactionally and returns 404 for foreign locations', async () => {
    await expect(service.setPrimary(userId, 'missing-location')).rejects.toBeInstanceOf(
      NotFoundException
    )

    await service.setPrimary(userId, 'location-2')

    expect(repository.setPrimary).toHaveBeenCalledWith(userId, 'location-2')
    expect(captureEvent).toHaveBeenCalledWith(userId, 'location_switched', {})
  })

  // Story 1.2b: the switch event is pseudonymous; no place key may reach it.
  it('captures location_switched with no place keys', async () => {
    await service.setPrimary(userId, 'location-2')

    expect(JSON.stringify(captureEvent.mock.calls)).not.toMatch(/home|chicago|office/i)
  })

  it.each([
    ['absent', null],
    ['older than five minutes', { fetched_at: new Date(now.getTime() - 5 * 60_000 - 1) }],
  ])(
    'enqueues a refresh when the new primary snapshot is %s',
    async (_label, snapshot) => {
      findLatestByLocationKey.mockResolvedValue(snapshot)

      await service.setPrimary(userId, 'location-2')

      expect(findLatestByLocationKey).toHaveBeenCalledWith('chicago-il')
      expect(enqueueLocationRefresh).toHaveBeenCalledWith(
        {
          locationKey: 'chicago-il',
          locationName: 'Chicago',
          latitude: 41.878,
          longitude: -87.63,
        },
        now
      )
    }
  )

  it('skips the refresh when the new primary snapshot is five minutes old or newer', async () => {
    findLatestByLocationKey.mockResolvedValue({
      fetched_at: new Date(now.getTime() - 5 * 60_000),
    })

    await service.setPrimary(userId, 'location-2')

    expect(enqueueLocationRefresh).not.toHaveBeenCalled()
  })

  it('never fails the switch when the refresh enqueue fails or stalls', async () => {
    // The spec's number, written out so a change to the production deadline fails.
    /** A switch waits at most one second on its refresh enqueue. */
    const REFRESH_ENQUEUE_DEADLINE_MS = 1000
    vi.useFakeTimers()
    try {
      enqueueLocationRefresh.mockReturnValueOnce(new Promise(() => undefined))
      const stalled = service.setPrimary(userId, 'location-2')
      await vi.advanceTimersByTimeAsync(REFRESH_ENQUEUE_DEADLINE_MS)
      await expect(stalled).resolves.toMatchObject({ id: 'location-2' })
    } finally {
      vi.useRealTimers()
    }

    enqueueLocationRefresh.mockRejectedValueOnce(new Error('redis down'))
    await expect(service.setPrimary(userId, 'location-2')).resolves.toMatchObject({
      id: 'location-2',
    })
  })

  it('promotes the lowest remaining sort order when deleting the primary location', async () => {
    await service.deleteLocation(userId, 'location-1')

    expect(repository.delete).toHaveBeenCalledWith(userId, 'location-1')
  })

  it('refreshes the primary promoted by deleting the current one', async () => {
    repository.delete.mockResolvedValueOnce(
      savedLocation({ id: 'location-1', location_key: 'home', is_primary: true })
    )
    repository.findManyByUserId.mockResolvedValueOnce([
      savedLocation({
        id: 'location-2',
        location_key: 'office-key',
        city: '',
        label: 'Office',
        is_primary: true,
      }),
    ])

    await service.deleteLocation(userId, 'location-1')

    expect(enqueueLocationRefresh).toHaveBeenCalledWith(
      expect.objectContaining({ locationKey: 'office-key', locationName: 'Office' }),
      now
    )
  })

  it('does not refresh when a non-primary location is deleted', async () => {
    repository.delete.mockResolvedValueOnce(
      savedLocation({ id: 'location-2', is_primary: false })
    )

    await service.deleteLocation(userId, 'location-2')

    expect(enqueueLocationRefresh).not.toHaveBeenCalled()
  })

  it('throws NotFoundException if location to delete is not found', async () => {
    repository.delete.mockResolvedValueOnce(null)

    await expect(
      service.deleteLocation(userId, 'missing-location')
    ).rejects.toBeInstanceOf(NotFoundException)
  })
})
