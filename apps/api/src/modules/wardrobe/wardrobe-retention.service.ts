import { Inject, Injectable } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { Prisma, PrismaClient, type GarmentItem } from '@prisma/client'

import { createBaseLogger } from '../../logger/pino.config'
import { RitualService } from '../personalization/ritual.service'
import { SupabaseWardrobeStorageAdapter } from './wardrobe-storage.adapter'
import { lockCapsules, lockGarments, lockOwnerProfile } from './wardrobe-capsule.locks'

const ABANDONED_UPLOAD_RETENTION_MS = 24 * 60 * 60 * 1000
const CLEANUP_BATCH_SIZE = 100

@Injectable()
export class WardrobeRetentionService {
  private readonly logger = createBaseLogger().child({ feature: 'wardrobe-retention' })

  constructor(
    @Inject(PrismaClient) private readonly prisma: PrismaClient,
    @Inject(SupabaseWardrobeStorageAdapter)
    private readonly storage: SupabaseWardrobeStorageAdapter,
    private readonly ritualService: RitualService
  ) {}

  async requestDeletion(
    userId: string,
    garmentId: string,
    trigger = 'user_deleted_garment'
  ): Promise<void> {
    const garment = await this.prisma.garmentItem.findFirst({
      where: { id: garmentId, user_id: userId },
    })
    if (!garment || garment.retention_status === 'legal_hold') {
      return
    }

    /**
     * The availability flip runs under the shared lock order rather than as a
     * bare update. Capsule creation validates garment eligibility while holding
     * these same locks, so an unlocked flip here would let a capsule be built
     * from a garment that is being deleted in the same instant.
     */
    const claimed = await this.prisma.$transaction(async (tx) => {
      await lockOwnerProfile(tx, userId)

      const affectedCapsules = await tx.outfitCapsule.findMany({
        where: { user_id: userId, garment_joins: { some: { garment_id: garment.id } } },
        select: { id: true },
        orderBy: { id: 'asc' },
      })
      await lockCapsules(
        tx,
        userId,
        affectedCapsules.map((capsule) => capsule.id)
      )
      await lockGarments(tx, userId, [garment.id])

      return tx.garmentItem.updateMany({
        where: {
          id: garment.id,
          user_id: userId,
          retention_status: { not: 'legal_hold' },
        },
        data: {
          retention_status: 'deletion_pending',
          retention_trigger: trigger,
          deletion_requested_at: new Date(),
        },
      })
    })

    if (claimed.count === 1) {
      await this.invalidateRitualCache(userId, garment.id)
      await this.purgeGarment({
        ...garment,
        retention_status: 'deletion_pending',
        retention_trigger: trigger,
      })
    }
  }

  @Cron(CronExpression.EVERY_HOUR)
  async purgeExpiredAndDeletedGarments(): Promise<void> {
    const now = new Date()
    const abandonedBefore = new Date(now.getTime() - ABANDONED_UPLOAD_RETENTION_MS)
    const candidates = await this.prisma.garmentItem.findMany({
      where: {
        retention_status: { not: 'legal_hold' },
        retention_purged_at: null,
        OR: [
          { retention_status: 'deletion_pending' },
          {
            upload_status: { in: ['pending_upload', 'bytes_uploaded'] },
            created_at: { lte: abandonedBefore },
            upload_expires_at: { lte: now },
          },
        ],
      },
      orderBy: { created_at: 'asc' },
      take: CLEANUP_BATCH_SIZE,
    })

    for (const garment of candidates) {
      const claimed = await this.prisma.garmentItem.updateMany({
        where: { id: garment.id, retention_status: { not: 'legal_hold' } },
        data: {
          retention_status: 'deletion_pending',
          retention_trigger: garment.retention_trigger ?? 'abandoned_upload',
          deletion_requested_at: garment.deletion_requested_at ?? now,
        },
      })
      if (claimed.count === 1) {
        await this.invalidateRitualCache(garment.user_id, garment.id)
      }

      await this.purgeGarment(garment).catch((error: unknown) => {
        this.logger.error(
          { error, garmentId: garment.id },
          'wardrobe_retention_purge_failed'
        )
      })
    }
  }

  private async invalidateRitualCache(userId: string, garmentId: string): Promise<void> {
    const invalidated = await this.ritualService.invalidateUserCache(userId)
    if (!invalidated) {
      this.logger.warn(
        { garmentId, userId },
        'wardrobe_retention_cache_invalidation_failed'
      )
    }
  }

  private async purgeGarment(garment: GarmentItem): Promise<void> {
    if (garment.retention_status === 'legal_hold' || garment.retention_purged_at) {
      return
    }
    if (garment.object_path) {
      await this.storage.remove([garment.object_path])
    }

    const completedAt = new Date()
    await this.prisma.$transaction(async (tx) => {
      /**
       * Same lock order as every capsule mutation: owner profile, then affected
       * capsules by id, then the target garment. Acquiring capsules before the
       * profile here would deadlock against a concurrent PATCH, and taking no
       * lock at all leaves the capsule eligibility check racing this purge.
       */
      await lockOwnerProfile(tx, garment.user_id)

      const affectedCapsules = await tx.outfitCapsule.findMany({
        where: {
          user_id: garment.user_id,
          garment_joins: { some: { garment_id: garment.id } },
        },
        select: { id: true },
        orderBy: { id: 'asc' },
      })
      const capsuleIds = affectedCapsules.map((capsule) => capsule.id)

      await lockCapsules(tx, garment.user_id, capsuleIds)
      await lockGarments(tx, garment.user_id, [garment.id])

      /**
       * Re-read under the lock. A concurrent sweep or an explicit deletion may
       * have purged this garment already, and repeating the work would bump
       * every containing capsule's revision a second time for one transition.
       */
      const locked = await tx.garmentItem.findFirst({
        where: { id: garment.id, user_id: garment.user_id },
      })
      if (
        !locked ||
        locked.retention_status === 'legal_hold' ||
        locked.retention_purged_at
      ) {
        return
      }

      if (capsuleIds.length > 0) {
        await tx.outfitCapsule.updateMany({
          where: { id: { in: capsuleIds } },
          data: {
            revision: { increment: 1 },
            updated_at: completedAt,
          },
        })

        /**
         * One profile increment per retention transition, regardless of how many
         * capsules it touched, so a stale recommendation is rejected exactly once.
         */
        await tx.userProfile.update({
          where: { user_id: garment.user_id },
          data: { capsule_revision: { increment: 1 } },
        })
      }

      await tx.paletteInsights.deleteMany({ where: { garment_item_id: garment.id } })
      await tx.garmentItem.update({
        where: { id: garment.id },
        data: {
          object_path: null,
          image_url: null,
          color_palette: Prisma.DbNull,
          file_size_bytes: null,
          mime_type: null,
          content_sha256: null,
          width_px: null,
          height_px: null,
          failure_code: 'DELETED',
          upload_status: 'failed',
          retention_purged_at: completedAt,
        },
      })
      await tx.auditLog.create({
        data: {
          user_id: garment.user_id,
          event_type: 'garment_retention_purged',
          event_data: {
            garmentId: garment.id,
            trigger: garment.retention_trigger ?? 'unknown',
            completedAt: completedAt.toISOString(),
            outcome: 'purged',
          },
          timestamp: completedAt,
        },
      })
    })
  }
}
