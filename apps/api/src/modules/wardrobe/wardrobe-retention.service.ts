import { Inject, Injectable } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { Prisma, PrismaClient, type GarmentItem } from '@prisma/client'

import { createBaseLogger } from '../../logger/pino.config'
import { SupabaseWardrobeStorageAdapter } from './wardrobe-storage.adapter'

const ABANDONED_UPLOAD_RETENTION_MS = 24 * 60 * 60 * 1000
const CLEANUP_BATCH_SIZE = 100

@Injectable()
export class WardrobeRetentionService {
  private readonly logger = createBaseLogger().child({ feature: 'wardrobe-retention' })

  constructor(
    @Inject(PrismaClient) private readonly prisma: PrismaClient,
    @Inject(SupabaseWardrobeStorageAdapter)
    private readonly storage: SupabaseWardrobeStorageAdapter
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

    const claimed = await this.prisma.garmentItem.updateMany({
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
    if (claimed.count === 1) {
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
      await this.prisma.garmentItem.updateMany({
        where: { id: garment.id, retention_status: { not: 'legal_hold' } },
        data: {
          retention_status: 'deletion_pending',
          retention_trigger: garment.retention_trigger ?? 'abandoned_upload',
          deletion_requested_at: garment.deletion_requested_at ?? now,
        },
      })

      await this.purgeGarment(garment).catch((error: unknown) => {
        this.logger.error(
          { error, garmentId: garment.id },
          'wardrobe_retention_purge_failed'
        )
      })
    }
  }

  private async purgeGarment(garment: GarmentItem): Promise<void> {
    if (garment.retention_status === 'legal_hold') {
      return
    }
    if (garment.object_path) {
      await this.storage.remove([garment.object_path])
    }

    const completedAt = new Date()
    await this.prisma.$transaction(async (tx) => {
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
