// Story 4.2 Task 3 step 1 owner: integrate smart tagging inference into BullMQ wardrobe color processor in apps/api/src/modules/wardrobe/wardrobe-color.processor.ts
import { Prisma, type GarmentItem, type PrismaClient } from '@prisma/client'
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

type ProcessableGarment = GarmentItem & { object_path: string }

interface TaggingOutcome {
  hasInferenceCheckpoint: boolean
  tagSnapshot: GarmentTagSuggestionSnapshot | null
  taggingFailureCode: string | null
}

function isProcessableGarment(
  garment: GarmentItem | null
): garment is ProcessableGarment {
  return (
    Boolean(garment?.object_path) &&
    garment?.retention_status === 'active' &&
    garment.upload_status === 'processing'
  )
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

  private async resolveTaggingOutcome(
    garment: ProcessableGarment,
    bytes: Buffer
  ): Promise<TaggingOutcome> {
    const storedSnapshot = garment.tag_suggestions
      ? garmentTagSuggestionSnapshotSchema.safeParse(garment.tag_suggestions)
      : null
    const tagSnapshot = storedSnapshot?.success === true ? storedSnapshot.data : null
    const taggingFailureCode =
      typeof garment.tagging_failure_code === 'string'
        ? garment.tagging_failure_code
        : storedSnapshot?.success === false
          ? 'TAGGING_OUTPUT_INVALID'
          : null
    const hasInferenceCheckpoint = storedSnapshot !== null || taggingFailureCode !== null

    if (hasInferenceCheckpoint) {
      return { hasInferenceCheckpoint, tagSnapshot, taggingFailureCode }
    }

    return this.inferTaggingOutcome(bytes)
  }

  private async inferTaggingOutcome(bytes: Buffer): Promise<TaggingOutcome> {
    if (!this.taggingEngine) {
      return {
        hasInferenceCheckpoint: false,
        tagSnapshot: null,
        taggingFailureCode: 'TAGGING_INFERENCE_FAILED',
      }
    }

    try {
      const rawSnapshot = await this.taggingEngine.inferTags(bytes)
      const parsed = garmentTagSuggestionSnapshotSchema.safeParse(rawSnapshot)
      return {
        hasInferenceCheckpoint: false,
        tagSnapshot: parsed.success ? parsed.data : null,
        taggingFailureCode: parsed.success ? null : 'TAGGING_OUTPUT_INVALID',
      }
    } catch (error) {
      return {
        hasInferenceCheckpoint: false,
        tagSnapshot: null,
        taggingFailureCode:
          error instanceof GarmentTaggingOutputError
            ? 'TAGGING_OUTPUT_INVALID'
            : 'TAGGING_INFERENCE_FAILED',
      }
    }
  }

  private taggingPersistenceData(outcome: TaggingOutcome) {
    const { tagSnapshot, taggingFailureCode } = outcome
    return {
      tag_suggestions: tagSnapshot
        ? (tagSnapshot as unknown as Prisma.InputJsonValue)
        : Prisma.DbNull,
      tagging_model_version: tagSnapshot?.analysisVersion ?? null,
      tag_suggested_at: tagSnapshot ? new Date() : null,
      tagging_failure_code: taggingFailureCode,
    }
  }

  private processingGuard(garment: ProcessableGarment) {
    return {
      id: garment.id,
      user_id: garment.user_id,
      object_path: garment.object_path,
      retention_status: 'active' as const,
      upload_status: 'processing' as const,
    }
  }

  private async checkpointTaggingOutcome(
    garment: ProcessableGarment,
    outcome: TaggingOutcome
  ): Promise<boolean> {
    if (outcome.hasInferenceCheckpoint) {
      return true
    }

    const checkpointed = await this.prisma.garmentItem.updateMany({
      where: this.processingGuard(garment),
      data: this.taggingPersistenceData(outcome),
    })
    return checkpointed.count === 1
  }

  private async applyProcessingResult(
    garment: ProcessableGarment,
    dominantHex: string,
    outcome: TaggingOutcome
  ): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const changed = await tx.garmentItem.updateMany({
        where: this.processingGuard(garment),
        data: {
          color_palette: { dominant: dominantHex },
          ...this.taggingPersistenceData(outcome),
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
  }

  private logCompletion(
    garmentId: string,
    startedAt: number,
    outcome: TaggingOutcome,
    applied: boolean
  ): void {
    const logContext = {
      analysisVersion: outcome.tagSnapshot?.analysisVersion ?? null,
      applied,
      durationMs: Date.now() - startedAt,
      garmentId,
      outcome: outcome.tagSnapshot ? 'suggested' : 'manual_confirmation_required',
      taggingFailureCode: outcome.taggingFailureCode,
    }
    if (applied) {
      this.logger.info(logContext, 'Wardrobe processing completed')
    } else {
      this.logger.warn(logContext, 'Wardrobe processing completed')
    }
  }

  async process(garmentId: string): Promise<void> {
    const startedAt = Date.now()
    const garment = await this.prisma.garmentItem.findUnique({
      where: { id: garmentId },
    })
    if (!isProcessableGarment(garment)) {
      return
    }

    const bytes = await this.storage.download(garment.object_path)
    const dominantHex = await this.extractDominantHex(bytes)
    const taggingOutcome = await this.resolveTaggingOutcome(garment, bytes)
    if (!(await this.checkpointTaggingOutcome(garment, taggingOutcome))) {
      return
    }

    const applied = await this.applyProcessingResult(garment, dominantHex, taggingOutcome)
    this.logCompletion(garment.id, startedAt, taggingOutcome, applied)
  }

  async markFailed(garmentId: string): Promise<void> {
    await this.prisma.garmentItem.updateMany({
      where: { id: garmentId, upload_status: 'processing' },
      data: { upload_status: 'failed', failure_code: 'COLOR_PROCESSING_FAILED' },
    })
  }
}
