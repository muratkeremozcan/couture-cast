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
 * THE WORK MATCHES PRODUCTION. THE CADENCE DIFFERS BY SIXTY TIMES. An outbox
 * row becoming a job, a job screening a post, a post reaching a terminal
 * state: all of that runs through the exact same
 * `createCommunityWorkerRuntime` code path production uses. Production polls
 * moderation dispatch once a minute, via the cron in
 * `community-maintenance.scheduler.ts`
 * (`COMMUNITY_MODERATION_DISPATCH_CRON_PATTERN`, `* * * * *`); this process
 * polls it once a second (`DISPATCH_INTERVAL_MS` below). A Playwright spec
 * built on this process's timing exercises the pipeline correctly. It says
 * nothing about how fast an author sees that happen in production, where the
 * wait to leave `pending_review` runs up to a minute against this process's
 * one second.
 */
const logger = createBaseLogger().child({ feature: 'community-workers' })

/**
 * Sixty times faster than production's one-minute moderation-dispatch cron
 * (`COMMUNITY_MODERATION_DISPATCH_CRON_PATTERN` in
 * `community-maintenance.scheduler.ts`), so a Playwright spec does not wait on
 * it. A passing E2E run on this interval is not evidence of production
 * latency.
 */
const DISPATCH_INTERVAL_MS = 1_000
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

function startCommunityWorkers() {
  try {
    const prisma = getPrismaClient()
    posthogService = new PostHogService()
    const telemetryService = new TelemetryService(prisma, posthogService)

    const community = createCommunityWorkerRuntime({ prisma, telemetryService })
    workers.push(community.worker)
    closeRuntime = community.close

    schedule('dispatch', DISPATCH_INTERVAL_MS, community.sweeps.dispatchPending)
    schedule('stale-review', SWEEP_INTERVAL_MS, community.sweeps.sweepStalePendingReview)
    schedule('upload-expiry', SWEEP_INTERVAL_MS, community.sweeps.sweepExpiredUploads)
    schedule('erasure', SWEEP_INTERVAL_MS, community.sweeps.sweepErasureRequests)

    logger.info({ queue: 'community-moderation' }, 'Dedicated community worker started')
  } catch (err) {
    logger.error(err, 'Failed to start community workers')
    process.exit(1)
  }
}

async function performShutdown() {
  logger.info('Shutting down community workers...')
  let exitCode = 0
  for (const timer of timers) {
    clearInterval(timer)
  }
  try {
    if (posthogService) {
      try {
        posthogService.onApplicationShutdown()
      } catch (err) {
        logger.error(err, 'Error shutting down PostHogService')
      }
    }
    await closeRuntime?.()
    await shutdownWorkerResources({
      workers,
      queues: [],
      redisClients: [],
      disconnectPrisma: disconnectPrismaClient,
    })
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

process.on('SIGTERM', () => void shutdown())
process.on('SIGINT', () => void shutdown())

startCommunityWorkers()
