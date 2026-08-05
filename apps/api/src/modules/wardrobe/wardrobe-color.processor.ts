// Story 4.2 Task 3 step 1 owner: integrate smart tagging inference into BullMQ wardrobe color processor in apps/api/src/modules/wardrobe/wardrobe-color.processor.ts
import { Prisma, type PrismaClient } from '@prisma/client'
import {
  garmentTagSuggestionSnapshotSchema,
  type GarmentTagSuggestionSnapshot,
} from '@couture/api-client/contracts/http'
import { createBaseLogger } from '../../logger/pino.config'
import {
  GarmentTaggingOutputError,
  type GarmentTaggingEngine,
} from './garment-tagging.engine'
import type { WardrobeStorage } from './wardrobe-storage.adapter'

function channelHex(value: number): string {
  return Math.max(0, Math.min(255, Math.round(value)))
    .toString(16)
    .padStart(2, '0')
}

export class WardrobeColorProcessor {
  private readonly logger = createBaseLogger().child({ feature: 'wardrobe-processing' })

  constructor(
    private readonly prisma: PrismaClient,
    private readonly storage: WardrobeStorage,
    private readonly taggingEngine?: GarmentTaggingEngine
  ) {}

  private async extractDominantHex(bytes: Buffer): Promise<string> {
    try {
      const sharpModule = await import('sharp')
      const sharpFn = sharpModule.default || sharpModule
      const stats = await sharpFn(bytes, {
        failOn: 'error',
        limitInputPixels: 4096 * 4096,
        sequentialRead: true,
      }).stats()
      const red = stats.channels[0]?.mean ?? 0
      const green = stats.channels[1]?.mean ?? 0
      const blue = stats.channels[2]?.mean ?? 0
      return `#${channelHex(red)}${channelHex(green)}${channelHex(blue)}`
    } catch {
      return '#808080'
    }
  }

  async process(garmentId: string): Promise<void> {
    const garment = await this.prisma.garmentItem.findUnique({
      where: { id: garmentId },
    })
    if (
      !garment?.object_path ||
      garment.retention_status !== 'active' ||
      !['processing', 'failed'].includes(garment.upload_status)
    ) {
      return
    }

    const bytes = await this.storage.download(garment.object_path)
    const dominantHex = await this.extractDominantHex(bytes)

    let tagSnapshot: GarmentTagSuggestionSnapshot | null = null
    let taggingFailureCode: string | null = null

    if (this.taggingEngine) {
      try {
        const rawSnapshot = await this.taggingEngine.inferTags(bytes)
        const parsed = garmentTagSuggestionSnapshotSchema.safeParse(rawSnapshot)
        if (parsed.success) {
          tagSnapshot = parsed.data
        } else {
          taggingFailureCode = 'TAGGING_OUTPUT_INVALID'
        }
      } catch (error) {
        taggingFailureCode =
          error instanceof GarmentTaggingOutputError
            ? 'TAGGING_OUTPUT_INVALID'
            : 'TAGGING_INFERENCE_FAILED'
      }
    } else {
      taggingFailureCode = 'TAGGING_INFERENCE_UNAVAILABLE'
    }

    const applied = await this.prisma.$transaction(async (tx) => {
      const changed = await tx.garmentItem.updateMany({
        where: {
          id: garment.id,
          user_id: garment.user_id,
          object_path: garment.object_path,
          retention_status: 'active',
          upload_status: { in: ['processing', 'failed'] },
        },
        data: {
          color_palette: { dominant: dominantHex },
          tag_suggestions: tagSnapshot
            ? (tagSnapshot as unknown as Prisma.InputJsonValue)
            : Prisma.DbNull,
          tagging_model_version: tagSnapshot ? tagSnapshot.analysisVersion : null,
          tag_suggested_at: tagSnapshot ? new Date() : null,
          tagging_failure_code: taggingFailureCode,
          upload_status: 'awaiting_tags',
          failure_code: null,
        },
      })
      if (changed.count !== 1) {
        return false
      }
      await tx.paletteInsights.upsert({
        where: { garment_item_id: garment.id },
        create: {
          garment_item_id: garment.id,
          user_id: garment.user_id,
          hex_codes: [dominantHex],
          confidence_score: 1,
        },
        update: {
          hex_codes: [dominantHex],
          confidence_score: 1,
        },
      })
      return true
    })

    this.logger.info(
      {
        applied,
        garmentId: garment.id,
        outcome: tagSnapshot ? 'suggested' : 'manual_confirmation_required',
        taggingFailureCode,
      },
      'Wardrobe processing completed'
    )
  }

  async markFailed(garmentId: string): Promise<void> {
    await this.prisma.garmentItem.updateMany({
      where: { id: garmentId, upload_status: 'processing' },
      data: { upload_status: 'failed', failure_code: 'COLOR_PROCESSING_FAILED' },
    })
  }
}
