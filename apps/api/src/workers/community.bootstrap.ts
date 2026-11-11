// Story 6.2b shutdown owner: drain the consumer before closing the screener under one 20-second deadline in `apps/api/src/workers/community.bootstrap.ts`
import { startCommunityEngagementRuntime } from '../modules/community/community-engagement.runtime.js'
import { CommunityFlagEvaluationService } from '../modules/feature-flags/community-flag-evaluation.service.js'
import '../load-env'
import { FeatureFlagsService } from '../modules/feature-flags/feature-flags.service.js'
import { ComplimentaryAccessService } from '../modules/feature-flags/complimentary-access.service.js'
import { FeatureFlagsRepository } from '../modules/feature-flags/feature-flags.repository.js'
import type { Worker } from 'bullmq'
import { createCommunityWorkerRuntime } from '../modules/community/community-worker-runtime'
import {
  startBackoffLoop,
  tickFromCount,
  type BackoffLoop,
  type IdleBackoffPolicy,
  type LoopTick,
} from '../modules/community/community-idle-backoff'
import {
  createModerationHistoryRetention,
  MODERATION_HISTORY_RETENTION_INTERVAL_MS,
} from '../modules/moderation/moderation-history.retention'
import {
  createModerationSlaSweep,
  MODERATION_SLA_SWEEP_INTERVAL_MS,
} from '../modules/moderation/moderation-sla.sweep'
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
 * `community-moderation` in production, so the sweeps below are the production
 * sweeps and their cadence (`COMMUNITY_WORKER_LOOPS`) is production's cadence.
 * The outbox dispatch reads PostgreSQL and touches Redis only when a post is
 * waiting, so it costs no Redis commands while idle; the
 * idle Redis cost is BullMQ's blocking poll and stalled check, tuned in
 * `community-moderation.worker.ts`, plus the worker's presence heartbeat
 * (`community-worker-heartbeat.ts`), all measured in the deployment guide.
 *
 * The pipeline itself is composed by `createCommunityWorkerRuntime`, the same
 * factory `bootstrap.ts` uses, so this process cannot drift from production.
 *
 * WHAT DIFFERS, AND WHY. In production the three community sweeps are BullMQ Job
 * Schedulers on the `maintenance` queue, driven by that queue's worker in
 * `bootstrap.ts`. This process deliberately does NOT subscribe to `maintenance`:
 * BullMQ splits jobs across every worker subscribed to a queue name regardless
 * of process, so doing so would let a feature-flag sync or a retention purge
 * land on a process that cannot route it. It runs the same functions on its own
 * timers, with idle backoff, and the trigger is the one thing this process must
 * not share with `bootstrap.ts`.
 *
 * THE WORK AND THE CADENCE MATCH PRODUCTION. An outbox row becoming a job, a
 * job screening a post, a post reaching a terminal state: all of that runs
 * through the same `createCommunityWorkerRuntime` code path, at the same
 * dispatch cadence, locally and on the hosted worker. The general
 * bootstrap's one-minute dispatch cron (`COMMUNITY_MODERATION_DISPATCH_CRON_PATTERN`
 * in `community-maintenance.scheduler.ts`) belongs to a process no hosted target
 * runs.
 */
const logger = createBaseLogger().child({ feature: 'community-workers' })

export const COMMUNITY_SHUTDOWN_TIMEOUT_MS = 20_000

/**
 * The cadence of each sweep while it finds work, and its longest sleep while idle.
 *
 * The outbox dispatch runs every second while posts, comments or analytics rows move, and an idle
 * one rechecks at least every 10 seconds.
 * That is the longest a post or comment published to an idle worker waits before screening starts,
 * well inside the one-minute dispatch the general worker was designed with
 * (`COMMUNITY_MODERATION_DISPATCH_CRON_PATTERN`) and the 15-minute stale-review window.
 * It reads PostgreSQL only; Redis is touched when a waiting post is enqueued.
 *
 * The four maintenance sweeps run every 30 seconds while they find work and at least every five
 * minutes when idle, which matches or beats the general worker's crons for the same sweeps
 * (`community-maintenance.scheduler.ts`): stale review and ban expiry every 5 minutes, erasure
 * every 15, upload expiry hourly.
 * The 72-hour erasure deadline, the 15-minute erasure repeat pace and the 15-minute stale window
 * each keep that five minutes of headroom or more.
 */
export const COMMUNITY_WORKER_LOOPS = {
  dispatch: { baseMs: 1_000, idleCapMs: 10_000 },
  maintenance: { baseMs: 30_000, idleCapMs: 300_000 },
} as const satisfies Record<string, IdleBackoffPolicy>

/**
 * The loops this process runs: production's, except that a test stack (`NODE_ENV=test`) may cap
 * an idle maintenance sweep lower with `COMMUNITY_MAINTENANCE_IDLE_CAP_MS`, from its 30 s base up
 * to production's five minutes. The end-to-end stack sets 30 s: its erasure journey ages a request
 * in the database and waits for the real sweep, which an idle five-minute backoff could leave
 * untouched past any reasonable test timeout (pw-e2e, 2026-11-11). Set anywhere else, or outside
 * that range, the worker refuses to start rather than run a cadence nobody measured.
 */
export function communityWorkerLoops(
  env: NodeJS.ProcessEnv = process.env
): Record<keyof typeof COMMUNITY_WORKER_LOOPS, IdleBackoffPolicy> {
  const raw = env.COMMUNITY_MAINTENANCE_IDLE_CAP_MS?.trim()
  if (!raw) return COMMUNITY_WORKER_LOOPS
  if (env.NODE_ENV !== 'test')
    throw new Error('COMMUNITY_MAINTENANCE_IDLE_CAP_MS is for test stacks only.')
  const { baseMs, idleCapMs } = COMMUNITY_WORKER_LOOPS.maintenance
  const cap = /^\d{1,6}$/.test(raw) ? Number(raw) : Number.NaN
  if (!(cap >= baseMs && cap <= idleCapMs))
    throw new Error(
      `COMMUNITY_MAINTENANCE_IDLE_CAP_MS must be whole ms from ${baseMs} to ${idleCapMs}.`
    )
  return { ...COMMUNITY_WORKER_LOOPS, maintenance: { baseMs, idleCapMs: cap } }
}

/** What one community worker process started, owned by its caller. */
export type CommunityWorkerProcessState = {
  readonly workers: Worker[]
  readonly timers: NodeJS.Timeout[]
  readonly loops: BackoffLoop[]
  /** Sweep ticks in flight; shutdown waits for them before it closes what they use. */
  readonly running: Set<Promise<unknown>>
  posthogService?: PostHogService
  closeRuntime?: () => Promise<void>
}

export function createCommunityWorkerProcessState(): CommunityWorkerProcessState {
  return { workers: [], timers: [], loops: [], running: new Set() }
}

/**
 * Runs `sweep` on an interval, never overlapping and never rejecting: an
 * unhandled rejection from a timer callback takes the process down, and this
 * process staying up is the whole point of it.
 */
function schedule(
  { timers, running: inFlight }: Pick<CommunityWorkerProcessState, 'timers' | 'running'>,
  name: string,
  intervalMs: number,
  sweep: () => Promise<unknown>,
  options: { runAtStart?: boolean } = {}
): void {
  let running = false
  const tick = () => {
    if (running) return
    running = true
    const flight = sweep()
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
        inFlight.delete(flight)
      })
    inFlight.add(flight)
  }
  if (options.runAtStart) tick()
  const timer = setInterval(tick, intervalMs)
  timer.unref()
  timers.push(timer)
}

/**
 * Runs `sweep` with idle backoff, never overlapping and never rejecting.
 * A tick that moved work forward keeps the base cadence; an idle or failed one doubles the delay
 * up to the policy's cap.
 */
function scheduleWithBackoff(
  { loops, running }: Pick<CommunityWorkerProcessState, 'loops' | 'running'>,
  name: string,
  policy: IdleBackoffPolicy,
  sweep: () => Promise<LoopTick>
): void {
  loops.push(
    startBackoffLoop({
      policy,
      work: sweep,
      onError: (error: unknown) => {
        logger.error(
          {
            sweep: name,
            error: error instanceof Error ? error.message : 'unknown error',
          },
          'community_sweep_failed'
        )
      },
      track: (flight) => {
        running.add(flight)
        void flight.finally(() => running.delete(flight))
      },
    })
  )
}

export async function startCommunityWorkers(state: CommunityWorkerProcessState) {
  try {
    const prisma = getPrismaClient()
    const posthogService = new PostHogService()
    // Story 6.14 D2: one complimentary seam for every evaluator this worker builds.
    const complimentaryAccess = new ComplimentaryAccessService(prisma, posthogService)
    state.posthogService = posthogService
    const telemetryService = new TelemetryService(prisma, posthogService)
    const engagement = await startCommunityEngagementRuntime(
      prisma,
      posthogService,
      'community'
    )
    state.closeRuntime = engagement.close

    // Readiness first, consumption second. `createCommunityWorkerRuntime`
    // resolves only once the selected screener has loaded and verified whatever
    // it needs, so no job is ever screened by a half-built engine.
    const runtimeFlags = new FeatureFlagsService(
      new FeatureFlagsRepository(prisma),
      posthogService,
      new CommunityFlagEvaluationService(prisma, posthogService, complimentaryAccess),
      complimentaryAccess
    )
    const community = await createCommunityWorkerRuntime({
      prisma,
      telemetryService,
      featureFlags: runtimeFlags,
      moderationSla: createModerationSlaSweep({
        prisma,
        flags: runtimeFlags,
        analytics: posthogService,
      }),
      moderationHistoryRetention: createModerationHistoryRetention({
        prisma,
        flags: runtimeFlags,
      }),
    })
    state.workers.push(community.worker)
    state.closeRuntime = async () => {
      await Promise.all([community.close(), engagement.close()])
    }

    const { sweeps } = community
    const loops = communityWorkerLoops()
    scheduleWithBackoff(state, 'dispatch', loops.dispatch, async () =>
      tickFromCount(await sweeps.dispatchPending())
    )
    scheduleWithBackoff(state, 'stale-review', loops.maintenance, async () =>
      tickFromCount(await sweeps.sweepStalePendingReview())
    )
    scheduleWithBackoff(state, 'upload-expiry', loops.maintenance, async () => {
      const result = await sweeps.sweepExpiredUploads()
      return tickFromCount(result.objectsDeleted + result.draftsDeleted)
    })
    scheduleWithBackoff(state, 'erasure', loops.maintenance, async () => {
      const result = await sweeps.sweepErasureRequests()
      return tickFromCount(
        result.hidden +
          result.anonymized +
          result.objectsPurged +
          result.requestsCompleted
      )
    })
    scheduleWithBackoff(state, 'ban-expiry', loops.maintenance, async () => {
      const result = await sweeps.sweepExpiredBanHolds()
      return tickFromCount(result.subjects + result.posts + result.comments)
    })
    // Story 6.12: this is the path that runs in production, because the hosted process has no
    // `maintenance` consumer. The sweep's keys make an overlap with the general worker harmless.
    schedule(
      state,
      'moderation-sla',
      MODERATION_SLA_SWEEP_INTERVAL_MS,
      community.sweeps.sweepModerationSla
    )
    // Story 6.13: daily, and once now, because a worker that restarts daily never reaches the interval.
    schedule(
      state,
      'moderation-history-retention',
      MODERATION_HISTORY_RETENTION_INTERVAL_MS,
      community.sweeps.sweepModerationHistoryRetention,
      { runAtStart: true }
    )

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
 * The order is the point. Closing the worker first removes its presence
 * heartbeat (at most `COMMUNITY_WORKER_HEARTBEAT_STOP_TIMEOUT_MS` of the
 * deadline; Story 6.2b review, RF15), then `Worker.close()` stops taking jobs
 * and waits for the active one; only then do the model process, the moderation
 * queue and the PostHog client close. Closing the runtime first (as this did until the Story
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
 * screening when the deadline expires is abandoned, as is a job whose worker
 * crashed: it neither completes nor fails, its BullMQ lock
 * (`COMMUNITY_MODERATION_LOCK_DURATION_MS`, 30 seconds) expires, and a stalled
 * check returns it to `waiting`. The check runs once per
 * `COMMUNITY_MODERATION_STALLED_INTERVAL_MS` (120 seconds) across all workers
 * and when a worker starts; a check requeues a job an earlier check marked, so
 * the job is back at most `max(interval, restart) + interval` after the crash
 * (`communityCrashRedeliveryMs`), 300 seconds with a three-minute restart, and
 * a requeued job wakes the worker's 300-second idle block at once. A first stall
 * (`maxStalledCount` 1) does not use up one of the job's attempts. The post
 * waits in `pending_review` meanwhile, and the whole recovery
 * (`communityCrashRecoveryMs`, 423 seconds) ends before the stale-review sweep
 * fails the post at 15 minutes (Story 6.2b review, RF13;
 * `community-moderation-crash-recovery.integration.spec.ts` kills a worker
 * mid-screening against real Redis). If a post does reach `review_failed`
 * through the sweep, the sweep writes a `JobFailure` row and the redelivered
 * job skips the post. The admin retry of that row does not re-screen it either:
 * the processor screens only `pending_review` posts, so the post stays
 * `review_failed`, visible to its author with the stalled-review copy, until
 * an operator releases or removes it (Story 6.2b review, RF14; recorded in
 * deferred work).
 */
export async function performShutdown(state: CommunityWorkerProcessState) {
  const { workers, timers, loops, running } = state
  logger.info('Shutting down community workers...')
  let exitCode = 0
  for (const timer of timers) {
    clearInterval(timer)
  }
  for (const loop of loops) {
    loop.stop()
  }
  const runtime = state.closeRuntime
  const posthog = state.posthogService
  try {
    await shutdownWorkerResources(
      {
        // A sweep tick in flight is drained with the consumers, before the queue, the screener,
        // PostHog and Prisma it may be using close; a forced close stops waiting for it.
        workers: [
          ...workers,
          {
            close: (force?: boolean) =>
              force
                ? Promise.resolve()
                : Promise.allSettled([...running]).then(() => undefined),
          },
        ],
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

// Guarded like `wardrobe.bootstrap.ts`, so importing this module in a spec does
// not open a Redis connection, register signal handlers, or call `process.exit`
// inside the test runner.
if (require.main === module) {
  const state = createCommunityWorkerProcessState()
  let shutdownPromise: Promise<void> | undefined
  const shutdown = () => (shutdownPromise ??= performShutdown(state))
  process.on('SIGTERM', () => void shutdown())
  process.on('SIGINT', () => void shutdown())

  void startCommunityWorkers(state)
}
