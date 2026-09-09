// Story 4.4 Task 4: BullMQ producer for "My Form" photo processing, mirroring
// wardrobe-processing.queue.ts exactly but enqueuing onto the existing
// moderation-review queue, keyed per commit rather than per profile (decision 5).
import { Inject, Injectable, Logger, OnModuleDestroy, Optional } from '@nestjs/common'
import { Queue, type QueueOptions } from 'bullmq'
import { z } from 'zod'

import { queueConfigs, type QueueName } from '../../config/queues'

export const SILHOUETTE_PHOTO_PROCESSING_JOB = 'silhouette-photo-processing'
export const SILHOUETTE_PHOTO_PROCESSING_QUEUE: QueueName = 'moderation-review'
const JOB_RETENTION_SECONDS = 7 * 24 * 60 * 60

/**
 * Where the producer publishes. Production never provides this token, so the
 * class binds to `moderation-review` out of `queueConfigs`.
 *
 * A suite that runs a real BullMQ Worker provides a per-run name here instead.
 * BullMQ hands a job to whichever subscriber of that name claims it first, in
 * any process on the Redis, and the end-to-end stack's wardrobe worker
 * (`start-api-e2e-with-workers.mjs`) subscribes to the production name at
 * concurrency 10 on the same local Redis the integration suite uses. Measured
 * on 2026-09-08 with that worker live: `4.4-INT-17` failed on its 10 s drain
 * and `4.4-INT-15` took 3,156 ms in place of ~100 ms, because the other
 * process consumed the job. Only a name nothing else subscribes to closes that.
 */
export const SILHOUETTE_PHOTO_PROCESSING_QUEUE_BINDING = Symbol(
  'SilhouettePhotoProcessingQueueBinding'
)

export type SilhouettePhotoProcessingQueueBinding = {
  name: string
  options: QueueOptions
}

function productionBinding(): SilhouettePhotoProcessingQueueBinding {
  const found = queueConfigs.find((c) => c.name === SILHOUETTE_PHOTO_PROCESSING_QUEUE)
  if (!found) {
    throw new Error('moderation-review queue configuration is missing')
  }
  return found
}

export const silhouettePhotoProcessingJobSchema = z
  .object({ silhouetteProfileId: z.string().trim().min(1).max(128) })
  .strict()

export type SilhouettePhotoProcessingJob = z.infer<
  typeof silhouettePhotoProcessingJobSchema
>

export interface SilhouettePhotoProcessingPublisher {
  enqueue(silhouetteProfileId: string, uploadSessionId: string): Promise<void>
}

/**
 * BullMQ refuses to add a job whose custom `jobId` already exists in Redis,
 * including jobs still retained in the completed/failed sets. `SilhouetteProfile`
 * is one row per user, so its id is stable for the life of the account -- keying
 * on it alone (as `WardrobeProcessingQueue` legitimately does with `garmentId`,
 * which is one row per upload attempt) would silently drop every My Form photo a
 * user commits after their first for the whole `JOB_RETENTION_SECONDS` window,
 * leaving the profile stuck in `processing` forever. The upload session id is
 * regenerated per upload-url allocation, so pairing the two keeps the job id
 * unique per genuine commit while still deduplicating a double-enqueue of the
 * same commit.
 *
 * The separator is `__`, not `:`: BullMQ rejects a custom job id containing a
 * colon, because it composes its own Redis keys with one.
 */
export function buildSilhouettePhotoJobId(
  silhouetteProfileId: string,
  uploadSessionId: string
): string {
  return `${silhouetteProfileId}__${uploadSessionId}`
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
  private readonly config: SilhouettePhotoProcessingQueueBinding
  private queue: Queue<SilhouettePhotoProcessingJob> | null = null

  constructor(
    @Optional()
    @Inject(SILHOUETTE_PHOTO_PROCESSING_QUEUE_BINDING)
    binding?: SilhouettePhotoProcessingQueueBinding
  ) {
    this.config = binding ?? productionBinding()
  }

  /** The queue name this producer publishes to. */
  get queueName(): string {
    return this.config.name
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

  async enqueue(silhouetteProfileId: string, uploadSessionId: string): Promise<void> {
    const data = silhouettePhotoProcessingJobSchema.parse({ silhouetteProfileId })
    await this.getQueue().add(SILHOUETTE_PHOTO_PROCESSING_JOB, data, {
      jobId: buildSilhouettePhotoJobId(silhouetteProfileId, uploadSessionId),
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
