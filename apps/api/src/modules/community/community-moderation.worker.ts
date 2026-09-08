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
 * One screening job at a time per process, matching `runtime.concurrency` in the
 * model manifest. Throughput comes from adding replicas.
 *
 * IT IS THE FAILURE PATH THAT DECIDES THIS, not the happy path. The inference
 * controller serialises classification to one per model process whatever BullMQ
 * does, so on a healthy model five concurrent jobs merely queue at the model:
 * about 135ms in total at the measured warm p95 of 26.6ms, invisible against the
 * 30-second outer ceiling. A wedged inference is what costs. It burns the full
 * 10-second inner ceiling and then holds respawn off through a 5-second cooldown,
 * and every queued job waits that out before its own inference starts. At
 * concurrency five the last job in the queue can sit through roughly 40 seconds
 * of other jobs' timeouts and blow its own 30-second `withModerationTimeout` for
 * a reason that has nothing to do with its content, so one bad image would fail
 * up to five posts and four of them would reach `review_failed` after exhausting
 * their retries against a model that is fine.
 *
 * It used to be five, which was right while the image half was a stub and the
 * only cost was decode and re-encode. Memory is not the argument: one model
 * process serves every job either way.
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
