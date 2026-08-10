import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Prisma } from '@prisma/client'
import type { PrismaClient } from '@prisma/client'

import {
  PrismaLocationPreferencesRepository,
  SavedLocationDuplicateError,
  SavedLocationLimitExceededError,
  type SavedLocationRecord,
} from './location-preferences.repository.js'

const userId = 'user-1'

function savedLocation(
  overrides: Partial<SavedLocationRecord> = {}
): SavedLocationRecord {
  const now = new Date('2026-07-09T12:00:00.000Z')

  return {
    id: 'location-1',
    user_id: userId,
    label: 'Home',
    location_key: 'chicago-il',
    latitude: 41.878,
    longitude: -87.63,
    timezone: 'America/Chicago',
    city: 'Chicago',
    region: 'IL',
    country: 'US',
    is_primary: true,
    sort_order: 0,
    created_at: now,
    updated_at: now,
    ...overrides,
  }
}

function knownRequestError(code: string) {
  return new Prisma.PrismaClientKnownRequestError('prisma failure', {
    code,
    clientVersion: 'test',
  })
}

function createPrismaStub() {
  const tx = {
    $executeRaw: vi.fn().mockResolvedValue(1),
    savedLocation: {
      findUnique: vi.fn().mockResolvedValue(null),
      findFirst: vi.fn().mockResolvedValue(null),
      count: vi.fn().mockResolvedValue(0),
      create: vi
        .fn()
        .mockImplementation(({ data }: { data: object }) =>
          Promise.resolve(savedLocation(data as Partial<SavedLocationRecord>))
        ),
      delete: vi.fn().mockResolvedValue(savedLocation()),
      update: vi.fn().mockResolvedValue(savedLocation()),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  }

  const prisma = {
    $transaction: vi.fn((callback: (transaction: typeof tx) => unknown) => callback(tx)),
    savedLocation: {
      findFirst: vi.fn().mockResolvedValue(null),
      findUnique: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockResolvedValue(savedLocation()),
    },
  }

  return { prisma, tx }
}

describe('PrismaLocationPreferencesRepository', () => {
  let prisma: ReturnType<typeof createPrismaStub>['prisma']
  let tx: ReturnType<typeof createPrismaStub>['tx']
  let repository: PrismaLocationPreferencesRepository

  const createCommand = {
    label: 'Office',
    locationKey: 'austin-tx',
    latitude: 30.267,
    longitude: -97.743,
    timezone: 'America/Chicago',
  }

  beforeEach(() => {
    const stub = createPrismaStub()
    prisma = stub.prisma
    tx = stub.tx
    repository = new PrismaLocationPreferencesRepository(
      prisma as unknown as PrismaClient
    )
  })

  describe('create', () => {
    it('marks the first saved location primary and starts the sort order at zero', async () => {
      const created = await repository.create(userId, createCommand)

      expect(created.is_primary).toBe(true)
      const createArgs = tx.savedLocation.create.mock.calls[0]?.[0] as {
        data: Record<string, unknown>
      }
      expect(createArgs.data).toMatchObject({
        user_id: userId,
        label: 'Office',
        location_key: 'austin-tx',
        city: null,
        region: null,
        country: null,
        is_primary: true,
        sort_order: 0,
      })
    })

    it('appends after the current highest sort order without stealing primary', async () => {
      tx.savedLocation.count.mockResolvedValue(2)
      tx.savedLocation.findFirst.mockResolvedValue({ sort_order: 4 })

      await repository.create(userId, { ...createCommand, city: 'Austin' })

      const createArgs = tx.savedLocation.create.mock.calls[0]?.[0] as {
        data: Record<string, unknown>
      }
      expect(createArgs.data).toMatchObject({
        city: 'Austin',
        is_primary: false,
        sort_order: 5,
      })
    })

    it('serializes concurrent writes for the same user with an advisory lock', async () => {
      // The duplicate and three-location checks are read-then-write, so the lock
      // is what makes them safe under concurrent requests.
      await repository.create(userId, createCommand)

      expect(tx.$executeRaw).toHaveBeenCalledTimes(1)
      expect(tx.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
        tx.savedLocation.count.mock.invocationCallOrder[0]!
      )
    })

    it('rejects a location key the user already saved', async () => {
      tx.savedLocation.findUnique.mockResolvedValue(savedLocation())

      await expect(repository.create(userId, createCommand)).rejects.toBeInstanceOf(
        SavedLocationDuplicateError
      )
      expect(tx.savedLocation.create).not.toHaveBeenCalled()
    })

    it('rejects once the user already holds three locations', async () => {
      tx.savedLocation.count.mockResolvedValue(3)

      await expect(repository.create(userId, createCommand)).rejects.toBeInstanceOf(
        SavedLocationLimitExceededError
      )
      expect(tx.savedLocation.create).not.toHaveBeenCalled()
    })

    it('translates a unique-constraint race into a duplicate error', async () => {
      // Two in-flight requests can both pass the pre-check; the database is the
      // final arbiter and its P2002 must surface as the same domain error.
      tx.savedLocation.create.mockRejectedValue(knownRequestError('P2002'))

      await expect(repository.create(userId, createCommand)).rejects.toBeInstanceOf(
        SavedLocationDuplicateError
      )
    })

    it('rethrows unrelated database failures untouched', async () => {
      tx.savedLocation.create.mockRejectedValue(knownRequestError('P2034'))

      await expect(repository.create(userId, createCommand)).rejects.toBeInstanceOf(
        Prisma.PrismaClientKnownRequestError
      )
    })
  })

  describe('delete', () => {
    it('returns null and issues no delete when the location belongs to another user', async () => {
      tx.savedLocation.findFirst.mockResolvedValue(null)

      await expect(repository.delete(userId, 'location-9')).resolves.toBeNull()
      expect(tx.savedLocation.delete).not.toHaveBeenCalled()
    })

    it('promotes the next location when the primary one is removed', async () => {
      const existing = savedLocation({ id: 'location-1', is_primary: true })
      tx.savedLocation.findFirst
        .mockResolvedValueOnce(existing)
        .mockResolvedValueOnce(savedLocation({ id: 'location-2', is_primary: false }))

      await expect(repository.delete(userId, 'location-1')).resolves.toBe(existing)

      expect(tx.savedLocation.delete).toHaveBeenCalledWith({
        where: { id: 'location-1' },
      })
      expect(tx.savedLocation.update).toHaveBeenCalledWith({
        where: { id: 'location-2' },
        data: { is_primary: true },
      })
    })

    it('leaves the primary flag alone when a secondary location is removed', async () => {
      tx.savedLocation.findFirst.mockResolvedValue(
        savedLocation({ id: 'location-2', is_primary: false })
      )

      await repository.delete(userId, 'location-2')

      expect(tx.savedLocation.update).not.toHaveBeenCalled()
    })

    it('does not promote anything when the last location is removed', async () => {
      tx.savedLocation.findFirst
        .mockResolvedValueOnce(savedLocation({ is_primary: true }))
        .mockResolvedValueOnce(null)

      await repository.delete(userId, 'location-1')

      expect(tx.savedLocation.update).not.toHaveBeenCalled()
    })
  })

  describe('reads', () => {
    it('scopes a location lookup to the owning user', async () => {
      await repository.findByIdForUser(userId, 'location-1')

      expect(prisma.savedLocation.findFirst).toHaveBeenCalledWith({
        where: { id: 'location-1', user_id: userId },
      })
    })

    it('looks a location up by its composite user/location key', async () => {
      await repository.findByLocationKeyForUser(userId, 'chicago-il')

      expect(prisma.savedLocation.findUnique).toHaveBeenCalledWith({
        where: {
          user_id_location_key: { user_id: userId, location_key: 'chicago-il' },
        },
      })
    })

    it('returns a user list in a deterministic sort order', async () => {
      await repository.findManyByUserId(userId)

      expect(prisma.savedLocation.findMany).toHaveBeenCalledWith({
        where: { user_id: userId },
        orderBy: [{ sort_order: 'asc' }, { created_at: 'asc' }, { id: 'asc' }],
      })
    })
  })

  describe('setPrimary', () => {
    it('returns null when the location is not the user’s', async () => {
      tx.savedLocation.findFirst.mockResolvedValue(null)

      await expect(repository.setPrimary(userId, 'location-9')).resolves.toBeNull()
      expect(tx.savedLocation.updateMany).not.toHaveBeenCalled()
    })

    it('clears the previous primary before promoting the new one', async () => {
      // Two primaries at once would make the ritual pick a location at random.
      tx.savedLocation.findFirst.mockResolvedValue(savedLocation({ id: 'location-2' }))

      await repository.setPrimary(userId, 'location-2')

      expect(tx.savedLocation.updateMany).toHaveBeenCalledWith({
        where: { user_id: userId, is_primary: true },
        data: { is_primary: false },
      })
      expect(tx.savedLocation.update).toHaveBeenCalledWith({
        where: { id: 'location-2' },
        data: { is_primary: true },
      })
      expect(tx.savedLocation.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
        tx.savedLocation.update.mock.invocationCallOrder[0]!
      )
    })
  })

  describe('update', () => {
    it('returns null when the location is not the user’s', async () => {
      prisma.savedLocation.findFirst.mockResolvedValue(null)

      await expect(
        repository.update(userId, 'location-9', { label: 'Gym' })
      ).resolves.toBeNull()
      expect(prisma.savedLocation.update).not.toHaveBeenCalled()
    })

    it('forwards only the supplied fields so omitted ones stay untouched', async () => {
      prisma.savedLocation.findFirst.mockResolvedValue(savedLocation())

      await repository.update(userId, 'location-1', { label: 'Gym', sortOrder: 2 })

      expect(prisma.savedLocation.update).toHaveBeenCalledWith({
        where: { id: 'location-1' },
        data: {
          label: 'Gym',
          location_key: undefined,
          latitude: undefined,
          longitude: undefined,
          timezone: undefined,
          city: undefined,
          region: undefined,
          country: undefined,
          sort_order: 2,
        },
      })
    })

    it('returns null when the row disappears between the read and the write', async () => {
      prisma.savedLocation.findFirst.mockResolvedValue(savedLocation())
      prisma.savedLocation.update.mockRejectedValue(knownRequestError('P2025'))

      await expect(
        repository.update(userId, 'location-1', { label: 'Gym' })
      ).resolves.toBeNull()
    })

    it('surfaces a colliding location key as a duplicate error', async () => {
      prisma.savedLocation.findFirst.mockResolvedValue(savedLocation())
      prisma.savedLocation.update.mockRejectedValue(knownRequestError('P2002'))

      await expect(
        repository.update(userId, 'location-1', { locationKey: 'austin-tx' })
      ).rejects.toBeInstanceOf(SavedLocationDuplicateError)
    })

    it('rethrows unrelated database failures untouched', async () => {
      prisma.savedLocation.findFirst.mockResolvedValue(savedLocation())
      const failure = new Error('connection reset')
      prisma.savedLocation.update.mockRejectedValue(failure)

      await expect(
        repository.update(userId, 'location-1', { label: 'Gym' })
      ).rejects.toBe(failure)
    })
  })
})
