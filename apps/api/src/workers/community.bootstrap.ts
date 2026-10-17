import '../load-env'
import type { Worker } from 'bullmq'
import { createCommunityWorkerRuntime } from '../modules/community/community-worker-runtime'
import { PostHogService } from '../posthog/posthog.service.js'
import { TelemetryService } from '../modules/telemetry/telemetry.service.js'
import { createBaseLogger } from '../logger/pino.config.js'
import { disconnectPrismaClient, getPrismaClient } from './prisma'
import { shutdownWorkerResources } from './shutdown-resources'

/**
 * The community moderation pipeline as its own process group.
 *
 * WHY THIS EXISTS SEPARATELY FROM `bootstrap.ts`. The local end-to-end stack
 * (`scripts/start-api-e2e-with-workers.mjs`, which `playwright/config/local.config.ts`
 * boots as its webServer) cannot start `bootstrap.ts`: that process also starts
 * weather ingestion and registers its refresh scheduler, so a test stack would
 * make live calls to a weather provider on a timer, against the project rule
 * that tests must not reach unmocked external services. Without some process
 * running the community worker, a post published through the real API sits at
 * `pending_review` forever and the story's core loop cannot be exercised end to
 * end by anyone — which is exactly what was happening.
 *
 * IT IS ALSO THE HOSTED WORKER. Story 6.2b's container
 * (`apps/api/Dockerfile.community-worker`) runs this module through
 * `scripts/start-community-worker-production.mjs`, and nothing else consumes
 * `community-moderation` in production, so the interval sweeps below are the
 * production sweeps and the one-second dispatch below is production's cadence.
 * The outbox dispatch reads PostgreSQL and touches Redis only when a post is
 * waiting, so the one-second cadence costs no Redis commands while idle; the
 * idle Redis cost is BullMQ's blocking poll and stalled check, tuned in
 * `community-moderation.worker.ts` and measured in the deployment guide.
 *
 * The pipeline itself is composed by `createCommunityWorkerRuntime`, the same
 * factory `bootstrap.ts` uses, so this process cannot drift from production.
 *
 * WHAT DIFFERS, AND WHY. In production the three community sweeps are BullMQ Job
 * Schedulers on the `maintenance` queue, driven by that queue's worker in
 * `bootstrap.ts`. This process deliberately does NOT subscribe to `maintenance`:
 * BullMQ splits jobs across every worker subscribed to a queue name regardless
 * of process, so doing so would let a feature-flag sync or a retention purge
 * land on a process that cannot route it. It runs the same three functions on a
 * plain interval instead, and the trigger is the one thing this process must
 * not share with `bootstrap.ts`.
 *
 * THE WORK AND THE CADENCE MATCH PRODUCTION. An outbox row becoming a job, a
 * job screening a post, a post reaching a terminal state: all of that runs
 * through the same `createCommunityWorkerRuntime` code path, at the same
 * one-second dispatch interval, locally and on the hosted worker. The general
 * bootstrap's one-minute dispatch cron (`COMMUNITY_MODERATION_DISPATCH_CRON_PATTERN`
 * in `community-maintenance.scheduler.ts`) belongs to a process no hosted target
 * runs.
 */
const logger = createBaseLogger().child({ feature: 'community-workers' })

/**
 * The outbox dispatch interval, locally and on the hosted worker alike. It reads
 * PostgreSQL only; Redis is touched when a waiting post is enqueued.
 */
const DISPATCH_INTERVAL_MS = 1_000
export const COMMUNITY_SHUTDOWN_TIMEOUT_MS = 20_000
const SWEEP_INTERVAL_MS = 30_000

const workers: Worker[] = []
const timers: NodeJS.Timeout[] = []
let posthogService: PostHogService | undefined
let closeRuntime: (() => Promise<void>) | undefined

/**
 * Runs `sweep` on an interval, never overlapping and never rejecting: an
 * unhandled rejection from a timer callback takes the process down, and this
 * process staying up is the whole point of it.
 */
function schedule(name: string, intervalMs: number, sweep: () => Promise<unknown>): void {
  let running = false
  const timer = setInterval(() => {
    if (running) return
    running = true
    void sweep()
      .catch((error: unknown) => {
        logger.error(
          {
            sweep: name,
            error: error instanceof Error ? error.message : 'unknown error',
          },
          'community_sweep_failed'
        )
      })
      .finally(() => {
        running = false
      })
  }, intervalMs)
  timer.unref()
  timers.push(timer)
}

export async function startCommunityWorkers() {
  try {
    const prisma = getPrismaClient()
    posthogService = new PostHogService()
    const telemetryService = new TelemetryService(prisma, posthogService)

    // Readiness first, consumption second. `createCommunityWorkerRuntime`
    // resolves only once the selected screener has loaded and verified whatever
    // it needs, so no job is ever screened by a half-built engine.
    const community = await createCommunityWorkerRuntime({ prisma, telemetryService })
    workers.push(community.worker)
    closeRuntime = community.close

    schedule('dispatch', DISPATCH_INTERVAL_MS, community.sweeps.dispatchPending)
    schedule('stale-review', SWEEP_INTERVAL_MS, community.sweeps.sweepStalePendingReview)
    schedule('upload-expiry', SWEEP_INTERVAL_MS, community.sweeps.sweepExpiredUploads)
    schedule('erasure', SWEEP_INTERVAL_MS, community.sweeps.sweepErasureRequests)

    logger.info(
      {
        queue: 'community-moderation',
        selector: community.readiness?.selector ?? null,
        engineVersion: community.readiness?.engineVersion ?? null,
        startupDurationMs: community.readiness?.startupDurationMs ?? null,
      },
      'Dedicated community worker started'
    )
  } catch (err) {
    logger.error(err, 'Failed to start community workers')
    process.exit(1)
  }
}

/**
 * Stops consumption, lets the active job finish, then closes what that job was
 * using, all under one deadline below the production launcher's 25 seconds.
 *
 * The order is the point. `Worker.close()` stops taking jobs and waits for the
 * active one; only then do the model process, the moderation queue and the
 * PostHog client close. Closing the runtime first (as this did until the Story
 * 6.2b peer review, CX7) terminated the inference thread under a job still
 * screening, so a deploy's SIGTERM failed that attempt with "Community NSFW
 * screener is closing", and on a final attempt marked a valid post
 * `review_failed`. The runtime and PostHog close in the queue phase, after every
 * worker; when the deadline expires, `shutdownWorkerResources` force-closes the
 * worker and the runtime and this process exits nonzero.
 *
 * THE BUDGETS AND THE HOST. Northflank sends SIGKILL 30 seconds after SIGTERM
 * by default (`gracePeriodSeconds`, 15 to 1,800; northflank.com/docs/v1/
 * application/scale/scale-instances, read 2026-10-17). This deadline is 20
 * seconds and the launcher's is 25, so both give up, and log it, before the
 * host's kill.
 *
 * THE SLOW TAIL. One screening may take up to 30 seconds
 * (`MODERATION_SCREENING_TIMEOUT_MS`), longer than this deadline. A job still
 * screening when the deadline expires is abandoned: it neither completes nor
 * fails, its BullMQ lock (30 seconds) expires, and the next worker's stalled
 * check returns it to `waiting`. BullMQ requeues a job on the check after the
 * one that first finds it active without a lock, and the check runs when a
 * worker starts and every 600 seconds after
 * (`COMMUNITY_MODERATION_STALLED_INTERVAL_MS`), so the job is redelivered 10
 * to 20 minutes after the restart. A first stall (`maxStalledCount` 1) does
 * not use up one of the job's attempts. The post waits in `pending_review` meanwhile. When
 * the stale-review sweep's 15 minutes run out first, the post moves to
 * `review_failed` with a `JobFailure` row an operator can retry, and the
 * redelivered job then skips it. Either way the post is screened or reaches
 * human review; it is never lost.
 */
export async function performShutdown() {
  logger.info('Shutting down community workers...')
  let exitCode = 0
  for (const timer of timers) {
    clearInterval(timer)
  }
  const runtime = closeRuntime
  const posthog = posthogService
  try {
    await shutdownWorkerResources(
      {
        workers,
        queues: [
          ...(runtime ? [{ close: runtime, disconnect: runtime }] : []),
          ...(posthog
            ? [
                {
                  close: () => Promise.resolve(posthog.onApplicationShutdown()),
                  disconnect: () => Promise.resolve(),
                },
              ]
            : []),
        ],
        redisClients: [],
        disconnectPrisma: disconnectPrismaClient,
      },
      { timeoutMs: COMMUNITY_SHUTDOWN_TIMEOUT_MS }
    )
  } catch (err) {
    logger.error(err, 'Error closing community workers')
    exitCode = 1
  } finally {
    process.exit(exitCode)
  }
}

let shutdownPromise: Promise<void> | undefined

function shutdown(): Promise<void> {
  shutdownPromise ??= performShutdown()
  return shutdownPromise
}

// Guarded like `wardrobe.bootstrap.ts`, so importing this module in a spec does
// not open a Redis connection, register signal handlers, or call `process.exit`
// inside the test runner.
if (require.main === module) {
  process.on('SIGTERM', () => void shutdown())
  process.on('SIGINT', () => void shutdown())

  void startCommunityWorkers()
}
