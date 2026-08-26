// Story 5.4 Task 6: BullMQ producer for palette analysis, mirroring
// silhouette-photo-processing.queue.ts's shape exactly but on its own
// dedicated queue (Decision 12): 'moderation-review' unconditionally parses
// `silhouettePhotoProcessingJobSchema`, so a palette job on it throws before
// reaching any handler.
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common'
import { Queue } from 'bullmq'
import { z } from 'zod'

import { queueConfigs, type QueueConfig } from '../../config/queues.js'

export const PALETTE_ANALYSIS_PROCESSING_JOB = 'palette-analysis-processing'
const JOB_RETENTION_SECONDS = 7 * 24 * 60 * 60

export const paletteAnalysisProcessingJobSchema = z
  .object({ paletteProfileId: z.string().trim().min(1).max(128) })
  .strict()

export type PaletteAnalysisProcessingJob = z.infer<
  typeof paletteAnalysisProcessingJobSchema
>

export interface PaletteAnalysisProcessingPublisher {
  enqueue(paletteProfileId: string, correlationId: string): Promise<void>
}

/**
 * `PaletteProfile` is one row per user, so keying the BullMQ job id on it
 * alone would silently drop every analysis after the first for the whole
 * `JOB_RETENTION_SECONDS` window, leaving the profile stuck in `processing`
 * forever -- the exact bug `silhouette-photo-processing.queue.ts`'s own
 * docblock documents for the identical shape. `correlationId` is the upload
 * session id for a selfie commit, or a freshly generated id for a wardrobe
 * analyze call (which has no upload session at all); either way it changes
 * per genuine analysis attempt, so pairing it with the profile id keeps the
 * job id unique per attempt while still deduplicating a double-enqueue of
 * the same one.
 *
 * The separator is `__`, not `:`: BullMQ rejects a custom job id containing
 * a colon, because it composes its own Redis keys with one.
 */
export function buildPaletteAnalysisJobId(
  paletteProfileId: string,
  correlationId: string
): string {
  return `${paletteProfileId}__${correlationId}`
}

/**
 * Lazy-initialized BullMQ queue, matching `SilhouettePhotoProcessingQueue`'s
 * cold-start rationale: the Queue client is only instantiated on first use,
 * so a serverless health check never opens an eager Redis connection.
 */
@Injectable()
export class PaletteAnalysisProcessingQueue
  implements PaletteAnalysisProcessingPublisher, OnModuleDestroy
{
  private readonly logger = new Logger(PaletteAnalysisProcessingQueue.name)
  private readonly config: QueueConfig
  private queue: Queue<PaletteAnalysisProcessingJob> | null = null

  constructor() {
    const found = queueConfigs.find((c) => c.name === 'palette-analysis')
    if (!found) {
      throw new Error('palette-analysis queue configuration is missing')
    }
    this.config = found
  }

  private getQueue(): Queue<PaletteAnalysisProcessingJob> {
    if (!this.queue) {
      this.queue = new Queue<PaletteAnalysisProcessingJob>(
        this.config.name,
        this.config.options
      )
    }
    return this.queue
  }

  async enqueue(paletteProfileId: string, correlationId: string): Promise<void> {
    const data = paletteAnalysisProcessingJobSchema.parse({ paletteProfileId })
    await this.getQueue().add(PALETTE_ANALYSIS_PROCESSING_JOB, data, {
      jobId: buildPaletteAnalysisJobId(paletteProfileId, correlationId),
      removeOnComplete: { age: JOB_RETENTION_SECONDS },
      removeOnFail: { age: JOB_RETENTION_SECONDS },
    })
  }

  async onModuleDestroy(): Promise<void> {
    if (this.queue) {
      await this.queue.close()
      this.queue = null
    }
    this.logger.debug('PaletteAnalysisProcessingQueue closed')
  }
}
