import { Injectable, OnModuleDestroy } from '@nestjs/common'
import { Queue } from 'bullmq'
import { z } from 'zod'

import { queueConfigs } from '../../config/queues'

export const GARMENT_COLOR_PROCESSING_JOB = 'garment-color-processing'
const JOB_RETENTION_SECONDS = 7 * 24 * 60 * 60

export const garmentColorProcessingJobSchema = z
  .object({ garmentId: z.string().trim().min(1).max(128) })
  .strict()

export type GarmentColorProcessingJob = z.infer<typeof garmentColorProcessingJobSchema>

export interface GarmentProcessingPublisher {
  enqueue(garmentId: string): Promise<void>
}

@Injectable()
export class WardrobeProcessingQueue
  implements GarmentProcessingPublisher, OnModuleDestroy
{
  private readonly queue: Queue<GarmentColorProcessingJob>

  constructor() {
    const config = queueConfigs.find((candidate) => candidate.name === 'color-extraction')
    if (!config) {
      throw new Error('color-extraction queue configuration is missing')
    }
    this.queue = new Queue<GarmentColorProcessingJob>(config.name, config.options)
  }

  async enqueue(garmentId: string): Promise<void> {
    const data = garmentColorProcessingJobSchema.parse({ garmentId })
    await this.queue.add(GARMENT_COLOR_PROCESSING_JOB, data, {
      jobId: garmentId,
      removeOnComplete: { age: JOB_RETENTION_SECONDS },
      removeOnFail: { age: JOB_RETENTION_SECONDS },
    })
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close()
  }
}
