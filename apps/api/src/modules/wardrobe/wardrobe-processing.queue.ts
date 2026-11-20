import { Inject, Injectable, Logger, OnModuleDestroy, Optional } from '@nestjs/common'
import { Queue, type QueueOptions } from 'bullmq'
import { z } from 'zod'

import { queueConfigs, type QueueConfig } from '../../config/queues'

export const GARMENT_COLOR_PROCESSING_JOB = 'garment-color-processing'
const JOB_RETENTION_SECONDS = 7 * 24 * 60 * 60

export const garmentColorProcessingJobSchema = z
  .object({ garmentId: z.string().trim().min(1).max(128) })
  .strict()

export type GarmentColorProcessingJob = z.infer<typeof garmentColorProcessingJobSchema>

/**
 * The queue a producer publishes to. Production binds nothing and gets `color-extraction`; an
 * integration suite binds a per-run name so a worker sharing its Redis never claims its jobs,
 * as `SilhouettePhotoProcessingQueue` does.
 */
export const WARDROBE_PROCESSING_QUEUE_BINDING = Symbol('WardrobeProcessingQueueBinding')

export type WardrobeProcessingQueueBinding = { name: string; options: QueueOptions }

export interface GarmentProcessingPublisher {
  /**
   * `jobId` defaults to the garment id. A garment whose processing a legal hold deferred is
   * enqueued again under the id `garmentProcessingJobId` derives, since the first job's id is
   * retained as completed. The payload is the garment id either way.
   */
  enqueue(garmentId: string, jobId?: string): Promise<void>
}

/**
 * Lazy-initialized BullMQ queue for garment color extraction.
 *
 * The Queue client is only instantiated on the first enqueue() call.
 * This avoids an eager Redis TCP connection at serverless cold-start (Vercel),
 * which would otherwise cause FUNCTION_INVOCATION_FAILED errors on the
 * health-check path before any queue work is requested.
 */
@Injectable()
export class WardrobeProcessingQueue
  implements GarmentProcessingPublisher, OnModuleDestroy
{
  private readonly logger = new Logger(WardrobeProcessingQueue.name)
  private readonly config: QueueConfig | WardrobeProcessingQueueBinding
  private queue: Queue<GarmentColorProcessingJob> | null = null

  constructor(
    @Optional()
    @Inject(WARDROBE_PROCESSING_QUEUE_BINDING)
    binding?: WardrobeProcessingQueueBinding
  ) {
    if (binding) {
      this.config = binding
      return
    }
    const found = queueConfigs.find((c) => c.name === 'color-extraction')
    if (!found) {
      throw new Error('color-extraction queue configuration is missing')
    }
    this.config = found
  }

  private getQueue(): Queue<GarmentColorProcessingJob> {
    if (!this.queue) {
      // Instantiate the Queue client on first use, not at module load time.
      // This defers the Redis TCP handshake until actual work arrives.
      this.queue = new Queue<GarmentColorProcessingJob>(
        this.config.name,
        this.config.options
      )
    }
    return this.queue
  }

  async enqueue(garmentId: string, jobId: string = garmentId): Promise<void> {
    const data = garmentColorProcessingJobSchema.parse({ garmentId })
    await this.getQueue().add(GARMENT_COLOR_PROCESSING_JOB, data, {
      jobId,
      removeOnComplete: { age: JOB_RETENTION_SECONDS },
      removeOnFail: { age: JOB_RETENTION_SECONDS },
    })
  }

  async onModuleDestroy(): Promise<void> {
    if (this.queue) {
      await this.queue.close()
      this.queue = null
    }
    this.logger.debug('WardrobeProcessingQueue closed')
  }
}
