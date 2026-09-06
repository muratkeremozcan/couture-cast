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

export interface CommunityModerationWorkerDependencies {
  prisma: PrismaClient
  storage: CommunityStorage
  engine?: CommunityModerationEngine
  telemetryService: TelemetryService
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
    engine
  )

  const defaultOpts = defaultWorkerOptions(5)
  const workerOpts: WorkerOptions = {
    ...defaultOpts,
    ...options,
  }

  return createWorker(
    COMMUNITY_MODERATION_QUEUE,
    async (job: Job) => {
      const data = communityModerationJobSchema.parse(job.data)
      try {
        await processor.process(data)
      } catch (error) {
        const maxAttempts = job.opts.attempts ?? 3
        if (job.attemptsMade + 1 >= maxAttempts) {
          const errorMessage =
            error instanceof Error ? error.message : 'Moderation execution failed'
          await processor.markFailed(data.postId, errorMessage)
        }
        throw error
      }
    },
    workerOpts
  )
}
