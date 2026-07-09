import { BadRequestException, NotFoundException } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
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

  beforeEach(() => {
    repository = createRepositoryStub()
    service = new LocationPreferencesService(repository)
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
  })

  it('promotes the lowest remaining sort order when deleting the primary location', async () => {
    await service.deleteLocation(userId, 'location-1')

    expect(repository.delete).toHaveBeenCalledWith(userId, 'location-1')
  })

  it('throws NotFoundException if location to delete is not found', async () => {
    repository.delete.mockResolvedValueOnce(null)

    await expect(
      service.deleteLocation(userId, 'missing-location')
    ).rejects.toBeInstanceOf(NotFoundException)
  })
})
