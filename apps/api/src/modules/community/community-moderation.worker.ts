// Story 6.1 Task 4: BullMQ worker for community content moderation (ADR-013).
import { type Worker, type WorkerOptions, type Job } from 'bullmq'
import { type PrismaClient } from '@prisma/client'
import { createWorker, defaultWorkerOptions } from '../../workers/base.worker.js'
import type { TelemetryService } from '../telemetry/telemetry.service.js'
import { type CommunityStorage } from './community-storage.adapter.js'
import {
  type CommunityModerationEngine,
  DefaultCommunityModerationEngine,
} from './community-moderation.engine.js'
import {
  COMMUNITY_MODERATION_QUEUE,
  communityModerationJobSchema,
} from './community-moderation.queue.js'
import { CommunityModerationProcessor } from './community-moderation.processor.js'
import type { CommunityModerationMeter } from './community-moderation.telemetry.js'

/**
 * One screening job at a time per process, because one process holds one model.
 *
 * It used to be five, which was right while the image half was a stub and the
 * only cost was decode and re-encode. ADR-013 inference is CPU-bound and runs in
 * a single supervised runtime, so five concurrent jobs would queue behind that
 * one runtime anyway while holding five decoded images in memory against the
 * worker's 512 MiB ceiling. Throughput scales by adding replicas, not by raising
 * this number.
 */
export const COMMUNITY_MODERATION_CONCURRENCY = 1

export interface CommunityModerationWorkerDependencies {
  prisma: PrismaClient
  storage: CommunityStorage
  engine?: CommunityModerationEngine
  telemetryService: TelemetryService
  meter?: CommunityModerationMeter
}

export function createCommunityModerationWorker(
  deps: CommunityModerationWorkerDependencies,
  options?: Partial<WorkerOptions>
): Worker {
  const engine = deps.engine ?? new DefaultCommunityModerationEngine()
  const processor = new CommunityModerationProcessor(
    deps.prisma,
    deps.storage,
    deps.telemetryService,
    engine,
    deps.meter
  )

  const defaultOpts = defaultWorkerOptions(COMMUNITY_MODERATION_CONCURRENCY)
  const workerOpts: WorkerOptions = {
    ...defaultOpts,
    ...options,
  }

  return createWorker(
    COMMUNITY_MODERATION_QUEUE,
    async (job: Job) => {
      const data = communityModerationJobSchema.parse(job.data)
      const maxAttempts = job.opts.attempts ?? 3
      // `attemptsMade` counts the attempts BEFORE this one, so the attempt the
      // processor is executing is one higher. Evidence that says "failed on
      // attempt 0" is evidence nobody can reconcile with a three-attempt policy.
      const attempt = job.attemptsMade + 1
      try {
        await processor.process(data, { attempt, maxAttempts })
      } catch (error) {
        if (attempt >= maxAttempts) {
          const errorMessage =
            error instanceof Error ? error.message : 'Moderation execution failed'
          await processor.markFailed(data.postId, errorMessage, { attempt, maxAttempts })
        }
        throw error
      }
    },
    workerOpts
  )
}
