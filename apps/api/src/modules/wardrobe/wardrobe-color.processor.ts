// Story 4.2 Task 3 step 1 owner: integrate smart tagging inference into BullMQ wardrobe color processor in apps/api/src/modules/wardrobe/wardrobe-color.processor.ts
import { Prisma, type GarmentItem, type PrismaClient } from '@prisma/client'
import {
  garmentTagSuggestionSnapshotSchema,
  type GarmentTagSuggestionSnapshot,
} from '@couture/api-client/contracts/http'
import { createBaseLogger } from '../../logger/pino.config'
import {
  GarmentTaggingManualModeError,
  GarmentTaggingOutputError,
  TAGGING_MANUAL_MODE_CODE,
  type GarmentTaggingEngine,
} from './garment-tagging.engine'
import type { WardrobeStorage } from './wardrobe-storage.adapter'
import { isOwnGarmentObject } from './wardrobe-upload-paths'
import { interactiveTransaction } from '../../prisma/prisma-client.js'

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

/**
 * What a pass ended in: done or no longer this job's (`settled`), held and recorded for the
 * handoff (`deferred`), or released meanwhile and to be processed again (`resume`).
 */
type DeferralOutcome = 'settled' | 'deferred' | 'resume'

/** A hold flipping this many times during one job fails it, so the queue retries it later. */
const MAX_PROCESS_PASSES = 3

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
        taggingFailureCode: this.taggingFailureCodeFor(error),
      }
    }
  }

  private taggingFailureCodeFor(error: unknown): string {
    if (error instanceof GarmentTaggingManualModeError) return TAGGING_MANUAL_MODE_CODE
    return error instanceof GarmentTaggingOutputError
      ? 'TAGGING_OUTPUT_INVALID'
      : 'TAGGING_INFERENCE_FAILED'
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
    return interactiveTransaction(this.prisma, async (tx) => {
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
      outcome: outcome.tagSnapshot
        ? 'suggested'
        : outcome.taggingFailureCode === TAGGING_MANUAL_MODE_CODE
          ? 'manual_mode'
          : 'manual_confirmation_required',
      taggingFailureCode: outcome.taggingFailureCode,
    }
    if (applied) {
      this.logger.info(logContext, 'Wardrobe processing completed')
    } else {
      this.logger.warn(logContext, 'Wardrobe processing completed')
    }
  }

  /**
   * Processes the garment, or defers it while a legal hold stands. A hold released between this
   * job's read and its deferral resumes processing here (final review F-7): the deferral
   * classifies the row under its lock, so a release either committed before (and the garment is
   * processed now) or waits until the deferral committed (and the maintenance handoff enqueues
   * it again). A hold that keeps flipping past the bound fails the job, so the queue retries it.
   */
  async process(garmentId: string): Promise<void> {
    for (let pass = 0; pass < MAX_PROCESS_PASSES; pass += 1) {
      if ((await this.processOnce(garmentId)) !== 'resume') return
      this.logger.warn({ garmentId }, 'garment_processing_resumed_after_release')
    }
    throw new Error('Garment hold changed during every processing pass')
  }

  private async processOnce(garmentId: string): Promise<DeferralOutcome> {
    const startedAt = Date.now()
    const garment = await this.prisma.garmentItem.findUnique({
      where: { id: garmentId },
    })
    if (!isProcessableGarment(garment)) {
      return garment?.upload_status === 'processing'
        ? this.deferIfHeld(garment.id)
        : 'settled'
    }
    // The path column was member-writable before the 2026-11-19 revoke migration: never read
    // an object that is not this garment's own object (owner, kind and this garment's id).
    if (!isOwnGarmentObject(garment)) {
      this.logger.error({ garmentId }, 'garment_object_path_not_own')
      await this.markFailed(garmentId)
      return 'settled'
    }

    const bytes = await this.storage.download(garment.object_path)
    const dominantHex = await this.extractDominantHex(bytes)
    const taggingOutcome = await this.resolveTaggingOutcome(garment, bytes)
    if (!(await this.checkpointTaggingOutcome(garment, taggingOutcome))) {
      return this.deferIfHeld(garment.id)
    }

    const applied = await this.applyProcessingResult(garment, dominantHex, taggingOutcome)
    this.logCompletion(garment.id, startedAt, taggingOutcome, applied)
    return applied ? 'settled' : this.deferIfHeld(garment.id)
  }

  /**
   * A processing garment under legal hold is not processed: the worker leaves its image alone.
   * It records that, and clears the job handoff marker, so the work is recoverable once the hold
   * is released: the maintenance handoff (or a commit replay) enqueues it again under a job id
   * derived from `processing_deferred_at`, since this job's own id stays retained as completed
   * and would make a plain re-enqueue a no-op.
   *
   * Classified under the garment row lock an operator's release (any update of the row) also
   * takes (final review F-7): a held garment is deferred in the same transaction, and one the
   * hold already released is handed back for processing (`resume`), so a release landing between
   * this job's read and its deferral no longer leaves the marker set with nothing queued.
   */
  private deferIfHeld(garmentId: string): Promise<DeferralOutcome> {
    return interactiveTransaction(this.prisma, async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM "GarmentItem" WHERE id = ${garmentId} FOR UPDATE`
      const row = await tx.garmentItem.findUnique({ where: { id: garmentId } })
      if (row?.upload_status !== 'processing') return 'settled'
      if (row.retention_status === 'legal_hold') {
        await tx.garmentItem.updateMany({
          where: {
            id: garmentId,
            upload_status: 'processing',
            retention_status: 'legal_hold',
          },
          data: { processing_job_enqueued_at: null, processing_deferred_at: new Date() },
        })
        this.logger.warn({ garmentId }, 'garment_processing_deferred_for_hold')
        return 'deferred'
      }
      return isProcessableGarment(row) ? 'resume' : 'settled'
    })
  }

  async markFailed(garmentId: string): Promise<void> {
    await this.prisma.garmentItem.updateMany({
      where: { id: garmentId, upload_status: 'processing' },
      data: { upload_status: 'failed', failure_code: 'COLOR_PROCESSING_FAILED' },
    })
  }
}
