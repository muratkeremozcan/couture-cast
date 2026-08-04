import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common'
import { Queue } from 'bullmq'
import { z } from 'zod'

import { queueConfigs, type QueueConfig } from '../../config/queues'

export const GARMENT_COLOR_PROCESSING_JOB = 'garment-color-processing'
const JOB_RETENTION_SECONDS = 7 * 24 * 60 * 60

export const garmentColorProcessingJobSchema = z
  .object({ garmentId: z.string().trim().min(1).max(128) })
  .strict()

export type GarmentColorProcessingJob = z.infer<typeof garmentColorProcessingJobSchema>

export interface GarmentProcessingPublisher {
  enqueue(garmentId: string): Promise<void>
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
  private readonly config: QueueConfig
  private queue: Queue<GarmentColorProcessingJob> | null = null

  constructor() {
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

  async enqueue(garmentId: string): Promise<void> {
    const data = garmentColorProcessingJobSchema.parse({ garmentId })
    await this.getQueue().add(GARMENT_COLOR_PROCESSING_JOB, data, {
      jobId: garmentId,
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
