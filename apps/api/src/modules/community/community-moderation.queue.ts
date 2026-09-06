// Story 6.1 Task 4: BullMQ producer for community moderation screening (ADR-013).
// Enqueues posts to the "community-moderation" queue with deterministic job IDs.
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common'
import { Queue } from 'bullmq'
import { z } from 'zod'

import { queueConfigs, type QueueConfig } from '../../config/queues.js'

export const COMMUNITY_MODERATION_QUEUE = 'community-moderation'
export const COMMUNITY_MODERATION_JOB = 'community-moderation-screening'
const JOB_RETENTION_SECONDS = 7 * 24 * 60 * 60

export const communityModerationJobSchema = z
  .object({
    postId: z.string().trim().min(1).max(128),
    uploadSessionId: z.string().trim().min(1).max(128),
    platform: z.enum(['web', 'mobile']).optional(),
  })
  .strict()

export type CommunityModerationJob = z.infer<typeof communityModerationJobSchema>

export interface CommunityModerationPublisher {
  enqueue(
    postId: string,
    uploadSessionId: string,
    platform?: 'web' | 'mobile'
  ): Promise<void>
}

/**
 * Deterministic job ID composition (postId__uploadSessionId) to prevent duplicates.
 * Separator is "__", not ":", because BullMQ rejects colons in custom job IDs.
 *
 * OPERATIONAL TRAP, observed on a live worker rather than reasoned about.
 * BullMQ retains a COMPLETED job under `removeOnComplete: { age: 7 days }`, and
 * `queue.add` with a jobId that already exists returns the existing job instead
 * of creating one. So re-driving a post that has already been screened is a
 * SILENT no-op for seven days: the outbox row is stamped as dispatched, no job
 * runs, and the post stays wherever it was. `AdminService.retryFailedJob` on a
 * community post inside that window does nothing visible either.
 *
 * That is the correct behaviour — it is what makes a duplicate dispatch safe —
 * but an operator who needs a genuine re-screen has to do one of two things:
 * remove the retained job from the queue first (`queue.getJob(id)` then
 * `job.remove()`), or give the post a new upload session, which changes the
 * object path and therefore the job id. Re-arming the outbox row alone is not
 * enough and looks like it worked.
 */
export function buildCommunityModerationJobId(
  postId: string,
  uploadSessionId: string
): string {
  return `${postId}__${uploadSessionId}`
}

/**
 * Lazy-initialized BullMQ queue, matching WardrobeProcessingQueue pattern:
 * the Queue client is instantiated on first use to avoid eager Redis connections
 * during serverless cold-start.
 */
@Injectable()
export class CommunityModerationQueue
  implements CommunityModerationPublisher, OnModuleDestroy
{
  private readonly logger = new Logger(CommunityModerationQueue.name)
  private readonly config: QueueConfig
  private queue: Queue<CommunityModerationJob> | null = null

  constructor() {
    const found = queueConfigs.find((c) => c.name === COMMUNITY_MODERATION_QUEUE)
    if (!found) {
      throw new Error('community-moderation queue configuration is missing')
    }
    this.config = found
  }

  private getQueue(): Queue<CommunityModerationJob> {
    if (!this.queue) {
      this.queue = new Queue<CommunityModerationJob>(
        this.config.name,
        this.config.options
      )
    }
    return this.queue
  }

  async enqueue(
    postId: string,
    uploadSessionId: string,
    platform?: 'web' | 'mobile'
  ): Promise<void> {
    const data = communityModerationJobSchema.parse({
      postId,
      uploadSessionId,
      platform,
    })
    await this.getQueue().add(COMMUNITY_MODERATION_JOB, data, {
      jobId: buildCommunityModerationJobId(postId, uploadSessionId),
      removeOnComplete: { age: JOB_RETENTION_SECONDS },
      removeOnFail: { age: JOB_RETENTION_SECONDS },
    })
  }

  async onModuleDestroy(): Promise<void> {
    if (this.queue) {
      await this.queue.close()
      this.queue = null
    }
    this.logger.debug('CommunityModerationQueue closed')
  }
}
