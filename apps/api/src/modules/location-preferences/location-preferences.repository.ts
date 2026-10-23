import { Inject, Injectable } from '@nestjs/common'
import { Prisma, PrismaClient } from '@prisma/client'

export type SavedLocationRecord = Prisma.SavedLocationGetPayload<Record<string, never>>

export interface CreateSavedLocationCommand {
  label: string
  locationKey: string
  latitude: number
  longitude: number
  timezone: string
  city?: string | null
  region?: string | null
  country?: string | null
}

export interface UpdateSavedLocationCommand {
  label?: string
  locationKey?: string
  latitude?: number
  longitude?: number
  timezone?: string
  city?: string | null
  region?: string | null
  country?: string | null
  sortOrder?: number
}

export interface LocationPreferencesRepository {
  create(
    userId: string,
    command: CreateSavedLocationCommand
  ): Promise<SavedLocationRecord>
  delete(userId: string, locationId: string): Promise<SavedLocationRecord | null>
  findByIdForUser(userId: string, locationId: string): Promise<SavedLocationRecord | null>
  findByLocationKeyForUser(
    userId: string,
    locationKey: string
  ): Promise<SavedLocationRecord | null>
  findManyByUserId(userId: string): Promise<SavedLocationRecord[]>
  recordSearch(userId: string, now: Date): Promise<LocationSearchWindowCount>
  setPrimary(userId: string, locationId: string): Promise<SavedLocationRecord | null>
  update(
    userId: string,
    locationId: string,
    command: UpdateSavedLocationCommand
  ): Promise<SavedLocationRecord | null>
}

export interface LocationSearchWindowCount {
  searches: number
  windowStart: Date
}

export const MAX_SAVED_LOCATIONS = 3

const savedLocationOrderBy = [
  { sort_order: 'asc' },
  { created_at: 'asc' },
  { id: 'asc' },
] satisfies Prisma.SavedLocationOrderByWithRelationInput[]

export class SavedLocationDuplicateError extends Error {
  constructor() {
    super('Saved location already exists')
    this.name = 'SavedLocationDuplicateError'
  }
}

export class SavedLocationLimitExceededError extends Error {
  constructor() {
    super('Users can save at most three locations')
    this.name = 'SavedLocationLimitExceededError'
  }
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
}

@Injectable()
export class PrismaLocationPreferencesRepository
  implements LocationPreferencesRepository
{
  constructor(@Inject(PrismaClient) private readonly prisma: PrismaClient) {}

  async create(
    userId: string,
    command: CreateSavedLocationCommand
  ): Promise<SavedLocationRecord> {
    try {
      return await this.prisma.$transaction(async (transaction) => {
        await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))`

        const duplicate = await transaction.savedLocation.findUnique({
          where: {
            user_id_location_key: {
              user_id: userId,
              location_key: command.locationKey,
            },
          },
        })

        if (duplicate) {
          throw new SavedLocationDuplicateError()
        }

        const count = await transaction.savedLocation.count({
          where: { user_id: userId },
        })

        if (count >= MAX_SAVED_LOCATIONS) {
          throw new SavedLocationLimitExceededError()
        }

        const lastLocation = await transaction.savedLocation.findFirst({
          where: { user_id: userId },
          orderBy: [{ sort_order: 'desc' }, { created_at: 'desc' }, { id: 'desc' }],
          select: { sort_order: true },
        })

        return transaction.savedLocation.create({
          data: {
            user_id: userId,
            label: command.label,
            location_key: command.locationKey,
            latitude: command.latitude,
            longitude: command.longitude,
            timezone: command.timezone,
            city: command.city ?? null,
            region: command.region ?? null,
            country: command.country ?? null,
            is_primary: count === 0,
            sort_order: lastLocation ? lastLocation.sort_order + 1 : 0,
          },
        })
      })
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new SavedLocationDuplicateError()
      }

      throw error
    }
  }

  async delete(userId: string, locationId: string): Promise<SavedLocationRecord | null> {
    return this.prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))`

      const existing = await transaction.savedLocation.findFirst({
        where: { id: locationId, user_id: userId },
      })

      if (!existing) {
        return null
      }

      await transaction.savedLocation.delete({
        where: { id: existing.id },
      })

      if (existing.is_primary) {
        const nextPrimary = await transaction.savedLocation.findFirst({
          where: { user_id: userId },
          orderBy: savedLocationOrderBy,
        })

        if (nextPrimary) {
          await transaction.savedLocation.update({
            where: { id: nextPrimary.id },
            data: { is_primary: true },
          })
        }
      }

      return existing
    })
  }

  findByIdForUser(
    userId: string,
    locationId: string
  ): Promise<SavedLocationRecord | null> {
    return this.prisma.savedLocation.findFirst({
      where: { id: locationId, user_id: userId },
    })
  }

  findByLocationKeyForUser(
    userId: string,
    locationKey: string
  ): Promise<SavedLocationRecord | null> {
    return this.prisma.savedLocation.findUnique({
      where: {
        user_id_location_key: {
          user_id: userId,
          location_key: locationKey,
        },
      },
    })
  }

  findManyByUserId(userId: string): Promise<SavedLocationRecord[]> {
    return this.prisma.savedLocation.findMany({
      where: { user_id: userId },
      orderBy: savedLocationOrderBy,
    })
  }

  /**
   * Story 1.2b: counts one city search in the member's fixed one-minute window
   * and returns the window's count, in one atomic statement, so concurrent
   * searches serialize on the member's row and none is lost.
   */
  async recordSearch(userId: string, now: Date): Promise<LocationSearchWindowCount> {
    const [row] = await this.prisma.$queryRaw<{ searches: number; window_start: Date }[]>`
      INSERT INTO "LocationSearchWindow" AS w (user_id, window_start, searches)
      VALUES (${userId}, date_trunc('minute', ${now.toISOString()}::timestamptz), 1)
      ON CONFLICT (user_id) DO UPDATE SET
        searches = CASE
          WHEN w.window_start = EXCLUDED.window_start THEN w.searches + 1
          ELSE 1
        END,
        window_start = EXCLUDED.window_start
      RETURNING searches, window_start`
    if (!row) {
      throw new Error('Location search window upsert returned no row')
    }
    return { searches: row.searches, windowStart: row.window_start }
  }

  setPrimary(userId: string, locationId: string): Promise<SavedLocationRecord | null> {
    return this.prisma.$transaction(async (transaction) => {
      const existing = await transaction.savedLocation.findFirst({
        where: { id: locationId, user_id: userId },
      })

      if (!existing) {
        return null
      }

      await transaction.savedLocation.updateMany({
        where: { user_id: userId, is_primary: true },
        data: { is_primary: false },
      })

      return transaction.savedLocation.update({
        where: { id: existing.id },
        data: { is_primary: true },
      })
    })
  }

  async update(
    userId: string,
    locationId: string,
    command: UpdateSavedLocationCommand
  ): Promise<SavedLocationRecord | null> {
    try {
      const existing = await this.findByIdForUser(userId, locationId)

      if (!existing) {
        return null
      }

      return await this.prisma.savedLocation.update({
        where: { id: existing.id },
        data: {
          label: command.label,
          location_key: command.locationKey,
          latitude: command.latitude,
          longitude: command.longitude,
          timezone: command.timezone,
          city: command.city,
          region: command.region,
          country: command.country,
          sort_order: command.sortOrder,
        },
      })
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        return null
      }

      if (isUniqueConstraintError(error)) {
        throw new SavedLocationDuplicateError()
      }

      throw error
    }
  }
}
