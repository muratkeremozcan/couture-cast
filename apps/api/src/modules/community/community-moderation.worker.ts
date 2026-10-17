// Story 6.1 Task 4: BullMQ worker for community content moderation (ADR-013).
import { type Worker, type WorkerOptions, type Job } from 'bullmq'
import { type PrismaClient } from '@prisma/client'
import { createWorker, defaultWorkerOptions } from '../../workers/base.worker.js'
import type { TelemetryService } from '../telemetry/telemetry.service.js'
import { type CommunityStorage } from './community-storage.adapter.js'
import {
  type CommunityModerationEngine,
  DefaultCommunityModerationEngine,
  SCREENING_UNAVAILABLE_REASON,
} from './community-moderation.engine.js'
import { NsfwScreeningError } from './tensorflow-nsfw-image-screener.js'
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

/**
 * How long an idle worker blocks on Redis before it asks again, in seconds.
 * BullMQ's default is 5, and a new job wakes the blocked call at once whatever
 * this is set to, so the value costs no pickup latency; what it sets is how
 * often an idle worker spends commands. Story 6.2b measured the default at about
 * 6,500 Redis commands an hour from an idle worker, nine times the Upstash free
 * tier's 500,000 a month. The cost of a long block is only felt when a
 * connection dies silently mid-block, and the outbox dispatcher and the stale
 * review sweep are the backstops for that case.
 */
export const COMMUNITY_MODERATION_DRAIN_DELAY_SECONDS = 300

/**
 * How often the worker looks for jobs whose lock expired because a worker died
 * mid-job, in milliseconds. BullMQ's default is 30 seconds. A worker also runs
 * this check when it starts, so a restarted container recovers a stalled job at
 * once; the interval only bounds recovery while the same process stays up, and
 * the stale-review sweep bounds it again for the post.
 */
export const COMMUNITY_MODERATION_STALLED_INTERVAL_MS = 600_000

/**
 * The BullMQ worker name, from the commit the image was built from
 * (`COMMUNITY_WORKER_COMMIT_SHA`, a build argument of the worker image). BullMQ
 * puts it in the Redis client name and on every job the worker processes, so
 * the hosted canary can prove which build consumed its job.
 */
export function communityWorkerName(commitSha: string): string {
  return `community-worker@${commitSha}`
}

function workerNameOption(): Partial<WorkerOptions> {
  const sha = process.env.COMMUNITY_WORKER_COMMIT_SHA?.trim()
  return sha ? { name: communityWorkerName(sha) } : {}
}

/**
 * The reason persisted on `LookbookPost.moderation_reason` when BullMQ runs out
 * of attempts.
 *
 * A raw error message is the wrong thing to store: it is free text nobody can
 * query, it changes when a library reworks its wording, and it is the branch
 * most likely to carry a path or an internal detail into a column an operator
 * reads. `NsfwScreeningError` carries a stable code for the case that actually
 * produces messages, an inference timeout, and everything else falls back to
 * the same deterministic refusal the engine emits when no verdict was reached.
 */
export function terminalReason(error: unknown): string {
  if (error instanceof NsfwScreeningError) {
    return error.reasonCode
  }
  return SCREENING_UNAVAILABLE_REASON
}

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
    drainDelay: COMMUNITY_MODERATION_DRAIN_DELAY_SECONDS,
    stalledInterval: COMMUNITY_MODERATION_STALLED_INTERVAL_MS,
    ...workerNameOption(),
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
          await processor.markFailed(data.postId, terminalReason(error), {
            attempt,
            maxAttempts,
          })
        }
        throw error
      }
    },
    workerOpts
  )
}
