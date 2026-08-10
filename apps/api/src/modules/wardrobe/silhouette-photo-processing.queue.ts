// Story 4.4 Task 4: BullMQ producer for "My Form" photo processing, mirroring
// wardrobe-processing.queue.ts exactly but enqueuing onto the existing
// moderation-review queue with jobId: silhouetteProfileId (decision 5).
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common'
import { Queue } from 'bullmq'
import { z } from 'zod'

import { queueConfigs, type QueueConfig } from '../../config/queues'

export const SILHOUETTE_PHOTO_PROCESSING_JOB = 'silhouette-photo-processing'
const JOB_RETENTION_SECONDS = 7 * 24 * 60 * 60

export const silhouettePhotoProcessingJobSchema = z
  .object({ silhouetteProfileId: z.string().trim().min(1).max(128) })
  .strict()

export type SilhouettePhotoProcessingJob = z.infer<
  typeof silhouettePhotoProcessingJobSchema
>

export interface SilhouettePhotoProcessingPublisher {
  enqueue(silhouetteProfileId: string): Promise<void>
}

/**
 * Lazy-initialized BullMQ queue, matching `WardrobeProcessingQueue`'s
 * cold-start rationale: the Queue client is only instantiated on first use,
 * so a serverless health check never opens an eager Redis connection.
 */
@Injectable()
export class SilhouettePhotoProcessingQueue
  implements SilhouettePhotoProcessingPublisher, OnModuleDestroy
{
  private readonly logger = new Logger(SilhouettePhotoProcessingQueue.name)
  private readonly config: QueueConfig
  private queue: Queue<SilhouettePhotoProcessingJob> | null = null

  constructor() {
    const found = queueConfigs.find((c) => c.name === 'moderation-review')
    if (!found) {
      throw new Error('moderation-review queue configuration is missing')
    }
    this.config = found
  }

  private getQueue(): Queue<SilhouettePhotoProcessingJob> {
    if (!this.queue) {
      this.queue = new Queue<SilhouettePhotoProcessingJob>(
        this.config.name,
        this.config.options
      )
    }
    return this.queue
  }

  async enqueue(silhouetteProfileId: string): Promise<void> {
    const data = silhouettePhotoProcessingJobSchema.parse({ silhouetteProfileId })
    await this.getQueue().add(SILHOUETTE_PHOTO_PROCESSING_JOB, data, {
      jobId: silhouetteProfileId,
      removeOnComplete: { age: JOB_RETENTION_SECONDS },
      removeOnFail: { age: JOB_RETENTION_SECONDS },
    })
  }

  async onModuleDestroy(): Promise<void> {
    if (this.queue) {
      await this.queue.close()
      this.queue = null
    }
    this.logger.debug('SilhouettePhotoProcessingQueue closed')
  }
}
