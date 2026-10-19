import { createBaseLogger } from '../../logger/pino.config.js'
import type { FeatureFlagsService } from '../feature-flags/feature-flags.service.js'
import { CommunityCommentsProcessor } from './community-comments.processor.js'
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
  COMMUNITY_COMMENT_JOB,
  communityCommentJobSchema,
  communityModerationJobSchema,
} from './community-moderation.queue.js'
import {
  CommunityModerationProcessor,
  MODERATION_SCREENING_TIMEOUT_MS,
} from './community-moderation.processor.js'
import type { CommunityModerationMeter } from './community-moderation.telemetry.js'

const logger = createBaseLogger().child({ feature: 'community-moderation' })

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
 * 6,500 Redis commands an hour from an idle worker, about 4.8 million a month,
 * which the production database's Upstash Pay as You Go plan bills at 0.20 USD
 * per 100K commands (upstash.com/pricing/redis, read 2026-10-17): about 9.50
 * USD a month for an idle worker. The cost of a long block is only felt when a
 * connection dies silently mid-block, and the outbox dispatcher and the stale
 * review sweep are the backstops for that case.
 */
export const COMMUNITY_MODERATION_DRAIN_DELAY_SECONDS = 300

/**
 * How long a worker's lock on an active job lasts without renewal. A running
 * job renews it every half lock; a worker that died stops renewing, and the job
 * counts as stalled once the lock is gone. BullMQ's default, stated here
 * because the crash-recovery budget below is computed from it.
 */
export const COMMUNITY_MODERATION_LOCK_DURATION_MS = 30_000

/**
 * The longest the host takes to restart a crashed worker, for the recovery
 * budget: the restart drill's three minutes. Northflank restarts a crashed
 * container in seconds.
 */
export const COMMUNITY_WORKER_RESTART_BUDGET_MS = 180_000

/**
 * How often the worker looks for jobs whose lock expired because a worker died
 * mid-job, in milliseconds. BullMQ's default is 30 seconds.
 *
 * BullMQ runs the check once per interval across all workers (a Redis key
 * expiring after the interval guards it), and a worker also runs it when it
 * starts. A check requeues a job only if an earlier check marked it and its lock
 * has since expired, so a job abandoned by a crash is back in `waiting` at most
 * `max(interval, restart) + interval` after the crash, once the interval is at
 * least the lock duration (`communityCrashRedeliveryMs`).
 *
 * The interval is chosen so that a crash recovers before the stale-review sweep
 * (`STALE_PENDING_REVIEW_MINUTES`, 15 minutes after the post entered
 * `pending_review`) fails the post (Story 6.2b review, RF13). With 120 seconds
 * and a three-minute restart the job is redelivered within 300 seconds; adding
 * the attempts the job may already have spent and the redelivered attempt
 * (`communityCrashRecoveryMs`) gives 423 seconds, under the 900-second sweep.
 * The 600 seconds this was before gave 1,323 seconds, past the sweep, so a valid
 * post could reach `review_failed` while its job waited to be redelivered. The
 * cost is one stalled check every two minutes while idle; the Redis section of
 * the readiness evidence measures it.
 */
export const COMMUNITY_MODERATION_STALLED_INTERVAL_MS = 120_000

/**
 * How long after a crash BullMQ returns the crashed worker's job to `waiting`,
 * at most: the first check after the crash and the restart marks it, and the
 * next one requeues it. Holds when the interval is at least the lock duration.
 */
export function communityCrashRedeliveryMs(
  stalledIntervalMs: number = COMMUNITY_MODERATION_STALLED_INTERVAL_MS,
  restartMs: number = COMMUNITY_WORKER_RESTART_BUDGET_MS
): number {
  return Math.max(stalledIntervalMs, restartMs) + stalledIntervalMs
}

/** Attempts a moderation job gets (`defaultJobOptions`) and their backoff. */
const MODERATION_ATTEMPTS = 3
const MODERATION_BACKOFF_TOTAL_MS = 1_000 + 2_000

/**
 * The longest a post can wait in `pending_review` when its worker crashes on
 * the job's last attempt: every attempt screening to its ceiling, the backoff
 * between them, the redelivery after the crash, and the redelivered attempt.
 */
export function communityCrashRecoveryMs(
  stalledIntervalMs: number = COMMUNITY_MODERATION_STALLED_INTERVAL_MS,
  restartMs: number = COMMUNITY_WORKER_RESTART_BUDGET_MS
): number {
  return (
    MODERATION_ATTEMPTS * MODERATION_SCREENING_TIMEOUT_MS +
    MODERATION_BACKOFF_TOTAL_MS +
    communityCrashRedeliveryMs(stalledIntervalMs, restartMs) +
    MODERATION_SCREENING_TIMEOUT_MS
  )
}

/**
 * The community worker's BullMQ options: one job at a time, the long idle
 * block, the lock and stalled check the recovery budget is computed from, and
 * the worker name. `overrides` win; the crash-recovery test shortens the
 * timings through them.
 */
export function communityModerationWorkerOptions(
  overrides?: Partial<WorkerOptions>
): WorkerOptions {
  return {
    ...defaultWorkerOptions(COMMUNITY_MODERATION_CONCURRENCY),
    drainDelay: COMMUNITY_MODERATION_DRAIN_DELAY_SECONDS,
    lockDuration: COMMUNITY_MODERATION_LOCK_DURATION_MS,
    stalledInterval: COMMUNITY_MODERATION_STALLED_INTERVAL_MS,
    maxStalledCount: 1,
    ...workerNameOption(),
    ...overrides,
  }
}

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
 * The name and commit the worker's heartbeat carries (Story 6.2b review, RF15):
 * the BullMQ worker name when the image baked a commit, and plain
 * `community-worker` otherwise, which no canary expecting a build accepts.
 */
export function communityWorkerIdentity(env: Readonly<NodeJS.ProcessEnv> = process.env): {
  name: string
  commitSha: string | null
} {
  const sha = env.COMMUNITY_WORKER_COMMIT_SHA?.trim()
  return sha
    ? { name: communityWorkerName(sha), commitSha: sha }
    : { name: 'community-worker', commitSha: null }
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
  featureFlags?: Pick<FeatureFlagsService, 'getFeatureFlag'>
  storage: CommunityStorage
  engine?: CommunityModerationEngine
  telemetryService: TelemetryService
  meter?: CommunityModerationMeter
}

/**
 * The community moderation worker. `queueName` is the production queue unless
 * a test names its own, so it never takes a running stack's jobs.
 */
export function createCommunityModerationWorker(
  deps: CommunityModerationWorkerDependencies,
  options?: Partial<WorkerOptions>,
  queueName: string = COMMUNITY_MODERATION_QUEUE
): Worker {
  const engine = deps.engine ?? new DefaultCommunityModerationEngine()
  const processor = new CommunityModerationProcessor(
    deps.prisma,
    deps.storage,
    deps.telemetryService,
    engine,
    deps.meter
  )

  const comments = new CommunityCommentsProcessor(deps.prisma, engine, deps.featureFlags)
  const workerOpts = communityModerationWorkerOptions(options)

  return createWorker(
    queueName,
    async (job: Job) => {
      if (job.name === COMMUNITY_COMMENT_JOB) {
        const data = communityCommentJobSchema.parse(job.data)
        try {
          await comments.process(data.commentId, data.generation)
        } catch (error) {
          if (job.attemptsMade + 1 >= (job.opts.attempts ?? 3)) {
            try {
              await comments.markFailed(data.commentId, false, data.generation)
            } catch {
              logger.warn(
                {
                  event: 'community_comment_failure_settlement_failed',
                  reason: 'settlement_failed',
                  attempt: job.attemptsMade + 1,
                },
                'Comment screening failure settlement deferred'
              )
            }
          }
          throw error
        }
        return
      }
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
