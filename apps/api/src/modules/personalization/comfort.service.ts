// Story 2.2 Task 2 step 1 owner: implement ComfortService persistence and cache invalidation
import { Injectable, Inject } from '@nestjs/common'
import {
  PrismaClient,
  type ComfortPreferences as DbComfortPreferences,
} from '@prisma/client'
import { RitualService } from './ritual.service.js'
import {
  type ComfortPreferences,
  type UpdateComfortPreferencesInput,
} from '../../contracts/http.js'

@Injectable()
export class ComfortService {
  constructor(
    @Inject(PrismaClient)
    private readonly prisma: PrismaClient,
    @Inject(RitualService)
    private readonly ritualService: RitualService
  ) {}

  private mapToContract(dbPrefs: DbComfortPreferences | null): ComfortPreferences {
    return {
      runsColdWarm: dbPrefs?.runs_cold_warm ?? 'neutral',
      windTolerance: dbPrefs?.wind_tolerance ?? 'medium',
      precipPreparedness: dbPrefs?.precip_preparedness ?? 'medium',
    }
  }

  async getComfortPreferences(userId: string): Promise<ComfortPreferences> {
    const dbPrefs = await this.prisma.comfortPreferences.findUnique({
      where: { user_id: userId },
    })
    return this.mapToContract(dbPrefs)
  }

  async updateComfortPreferences(
    userId: string,
    data: UpdateComfortPreferencesInput
  ): Promise<ComfortPreferences> {
    const updated = await this.prisma.comfortPreferences.upsert({
      where: { user_id: userId },
      update: {
        runs_cold_warm: data.runsColdWarm,
        wind_tolerance: data.windTolerance,
        precip_preparedness: data.precipPreparedness,
      },
      create: {
        user_id: userId,
        runs_cold_warm: data.runsColdWarm,
        wind_tolerance: data.windTolerance,
        precip_preparedness: data.precipPreparedness,
      },
    })

    // Invalidate daily outfits cache
    await this.ritualService.invalidateUserCache(userId)

    return this.mapToContract(updated)
  }
}
