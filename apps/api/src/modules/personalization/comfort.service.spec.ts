// Story 2.2 Task 3 step 1 owner: unit-test default fallbacks, upserts, and cache invalidation
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { ComfortService } from './comfort.service.js'
import type { PrismaClient } from '@prisma/client'
import type { RitualService } from './ritual.service.js'

describe('ComfortService', () => {
  let comfortPreferencesFindUnique: ReturnType<typeof vi.fn>
  let comfortPreferencesUpsert: ReturnType<typeof vi.fn>
  let invalidateUserCacheMock: ReturnType<typeof vi.fn>

  let prismaMock: PrismaClient
  let ritualServiceMock: RitualService
  let service: ComfortService

  beforeEach(() => {
    comfortPreferencesFindUnique = vi.fn()
    comfortPreferencesUpsert = vi.fn()
    invalidateUserCacheMock = vi.fn().mockResolvedValue(undefined)

    prismaMock = {
      comfortPreferences: {
        findUnique: comfortPreferencesFindUnique,
        upsert: comfortPreferencesUpsert,
      },
    } as unknown as PrismaClient

    ritualServiceMock = {
      invalidateUserCache: invalidateUserCacheMock,
    } as unknown as RitualService

    service = new ComfortService(prismaMock, ritualServiceMock)
  })

  describe('getComfortPreferences', () => {
    it('should return defaults if no comfort preferences exist in DB', async () => {
      comfortPreferencesFindUnique.mockResolvedValue(null)

      const result = await service.getComfortPreferences('user-1')

      expect(comfortPreferencesFindUnique).toHaveBeenCalledWith({
        where: { user_id: 'user-1' },
      })
      expect(result).toEqual({
        runsColdWarm: 'neutral',
        windTolerance: 'medium',
        precipPreparedness: 'medium',
      })
    })

    it('should return mapped DB values if preferences exist', async () => {
      comfortPreferencesFindUnique.mockResolvedValue({
        id: 'pref-1',
        user_id: 'user-1',
        runs_cold_warm: 'cold',
        wind_tolerance: 'low',
        precip_preparedness: 'high',
        created_at: new Date(),
        updated_at: new Date(),
      })

      const result = await service.getComfortPreferences('user-1')

      expect(result).toEqual({
        runsColdWarm: 'cold',
        windTolerance: 'low',
        precipPreparedness: 'high',
      })
    })
  })

  describe('updateComfortPreferences', () => {
    it('should upsert comfort preferences and invalidate Redis cache', async () => {
      const input = {
        runsColdWarm: 'warm' as const,
        windTolerance: 'high' as const,
        precipPreparedness: 'low' as const,
      }

      comfortPreferencesUpsert.mockResolvedValue({
        id: 'pref-1',
        user_id: 'user-1',
        runs_cold_warm: 'warm',
        wind_tolerance: 'high',
        precip_preparedness: 'low',
        created_at: new Date(),
        updated_at: new Date(),
      })

      const result = await service.updateComfortPreferences('user-1', input)

      expect(comfortPreferencesUpsert).toHaveBeenCalledWith({
        where: { user_id: 'user-1' },
        update: {
          runs_cold_warm: 'warm',
          wind_tolerance: 'high',
          precip_preparedness: 'low',
        },
        create: {
          user_id: 'user-1',
          runs_cold_warm: 'warm',
          wind_tolerance: 'high',
          precip_preparedness: 'low',
        },
      })
      expect(invalidateUserCacheMock).toHaveBeenCalledWith('user-1')
      expect(result).toEqual({
        runsColdWarm: 'warm',
        windTolerance: 'high',
        precipPreparedness: 'low',
      })
    })
  })
})
