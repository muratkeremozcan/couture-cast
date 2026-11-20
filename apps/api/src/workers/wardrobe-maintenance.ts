import { randomUUID } from 'node:crypto'
import type { Queue } from 'bullmq'
import type { Logger } from 'pino'
import type { WardrobeRetentionService } from '../modules/wardrobe/wardrobe-retention.service'
import {
  WARDROBE_DELETION_DRAIN_JOB_NAME,
  WARDROBE_RETENTION_PURGE_JOB_NAME,
} from './maintenance.scheduler'

/**
 * `WARDROBE_MAINTENANCE_ENABLED=true` makes the dedicated wardrobe worker (`wardrobe.bootstrap.ts`)
 * run the wardrobe retention purge and the deletion drain in a process-local loop
 * ({@link WardrobeMaintenanceLoop}). It consumes no BullMQ queue for them.
 *
 * WHY NOT BULLMQ SCHEDULERS. A Job Scheduler keeps a delayed job pending, and a BullMQ 5.65 worker
 * that knows the next delayed timestamp caps its blocking wait at ten seconds, so two schedules
 * cost the whole service a Redis wakeup every ten seconds with zero traffic: far over the idle
 * budget of the community worker, which is the budget this service was approved against. It would
 * also make this worker a consumer of the shared `maintenance` queue, where it would acknowledge
 * (and so lose) any other job a general worker's schedulers left there.
 *
 * WHY A REDIS LOCK. Two copies of this worker can overlap for a moment (a rollout, a second
 * replica) and a general worker may still run the same two jobs in development. Each tick first
 * takes `wardrobe-maintenance:<task>` with `SET NX PX`, so a second copy skips the tick. The work
 * is database-locked and idempotent as well; the lock only stops two copies doing it at once.
 */
export const WARDROBE_MAINTENANCE_ENV = 'WARDROBE_MAINTENANCE_ENABLED'

export function wardrobeMaintenanceEnabled(
  env: Readonly<NodeJS.ProcessEnv> = process.env
): boolean {
  return env[WARDROBE_MAINTENANCE_ENV]?.trim() === 'true'
}

/**
 * Throws when this environment hands wardrobe maintenance to the dedicated wardrobe worker.
 * The general worker registers the same two jobs on the shared `maintenance` queue for local
 * development; where the hosted worker owns them it must not start, and a shared env file that
 * carries the flag is how it would.
 */
export function assertGeneralWorkerMayRunWardrobeMaintenance(
  env: Readonly<NodeJS.ProcessEnv> = process.env
): void {
  if (!wardrobeMaintenanceEnabled(env)) return
  throw new Error(
    `${WARDROBE_MAINTENANCE_ENV}=true makes the dedicated wardrobe worker the owner of the wardrobe ` +
      'retention purge and deletion drain on this Redis, so the general worker must not start with ' +
      'it. Unset it here, or stop the wardrobe worker that owns maintenance.'
  )
}

/** Removes the two wardrobe schedulers a general worker left on the shared queue. */
export async function removeWardrobeMaintenanceSchedulers(
  queue: Pick<Queue, 'removeJobScheduler'>
): Promise<void> {
  await Promise.all([
    queue.removeJobScheduler(WARDROBE_RETENTION_PURGE_JOB_NAME),
    queue.removeJobScheduler(WARDROBE_DELETION_DRAIN_JOB_NAME),
  ])
}

/** The one Redis command the lock needs, narrower than ioredis' overload set. */
export interface MaintenanceLockRedis {
  set(
    key: string,
    value: string,
    mode: 'PX',
    ttlMs: number,
    flag: 'NX'
  ): Promise<'OK' | null>
}

export const WARDROBE_MAINTENANCE_LOCK_PREFIX = 'wardrobe-maintenance'

export type WardrobeMaintenanceTaskName =
  | 'wardrobe-retention-purge'
  | 'wardrobe-deletion-drain'

/**
 * How often each task runs, and how long its lock lasts. The lock is held for the interval less
 * a margin and never released, so it is the rate limit: one copy runs a task per interval and the
 * next tick (the interval plus up to the jitter, which is under the margin) finds it expired.
 * Hourly purge and 15-minute drain are the cadence the general worker's schedulers carry.
 */
export const WARDROBE_MAINTENANCE_TASKS = {
  'wardrobe-retention-purge': {
    intervalMs: 60 * 60_000,
    lockMs: 60 * 60_000 - 5 * 60_000,
    jitterMs: 2 * 60_000,
    startDelayMs: 60_000,
  },
  'wardrobe-deletion-drain': {
    intervalMs: 15 * 60_000,
    lockMs: 15 * 60_000 - 2 * 60_000,
    jitterMs: 60_000,
    startDelayMs: 30_000,
  },
} as const satisfies Record<
  WardrobeMaintenanceTaskName,
  { intervalMs: number; lockMs: number; jitterMs: number; startDelayMs: number }
>

/** Takes the task's lock; false when another copy holds it. A Redis failure rejects. */
export async function acquireWardrobeMaintenanceLock(
  redis: MaintenanceLockRedis,
  task: WardrobeMaintenanceTaskName,
  holder: string
): Promise<boolean> {
  const reply = await redis.set(
    `${WARDROBE_MAINTENANCE_LOCK_PREFIX}:${task}`,
    holder,
    'PX',
    WARDROBE_MAINTENANCE_TASKS[task].lockMs,
    'NX'
  )
  return reply === 'OK'
}

type RetentionSweeps = Pick<
  WardrobeRetentionService,
  'purgeExpiredAndDeletedGarments' | 'drainDeletions'
>
type MaintenanceLogger = Pick<Logger, 'info' | 'warn' | 'error'>

/**
 * The same two sweeps behind the same Redis lock, for a worker that runs them from BullMQ (the
 * general worker, in development): a copy that finds the lock held skips the job.
 */
export function lockedWardrobeRetention(
  retention: RetentionSweeps,
  redis: MaintenanceLockRedis,
  logger: MaintenanceLogger,
  holder: string = randomUUID()
): RetentionSweeps {
  const guarded = async <T>(
    task: WardrobeMaintenanceTaskName,
    skipped: T,
    run: () => Promise<T>
  ): Promise<T> => {
    if (!(await acquireWardrobeMaintenanceLock(redis, task, holder))) {
      logger.info({ task }, 'wardrobe_maintenance_skipped_lock_held')
      return skipped
    }
    return run()
  }
  return {
    purgeExpiredAndDeletedGarments: () =>
      guarded('wardrobe-retention-purge', undefined, () =>
        retention.purgeExpiredAndDeletedGarments()
      ),
    drainDeletions: (now?: Date) =>
      guarded('wardrobe-deletion-drain', 0, () => retention.drainDeletions(now)),
  }
}

export type WardrobeMaintenanceLoopDeps = {
  retention: RetentionSweeps
  redis: MaintenanceLockRedis
  logger: MaintenanceLogger
  /** This copy's identity in the lock value; a log reader can tell which copy ran a tick. */
  holder?: string
  random?: () => number
  setTimer?: (callback: () => void, ms: number) => NodeJS.Timeout
  clearTimer?: (timer: NodeJS.Timeout) => void
}

/**
 * The hosted worker's maintenance: the retention purge every hour (held capture, held copy release,
 * staging sweep and the job handoff re-enqueue, each step isolated inside the service) and the
 * deletion drain every 15 minutes, in this process, under a Redis lock per tick.
 *
 * Ticks run one at a time, so the two sweeps never share the connection pool at once. A task
 * that fails logs its event (`wardrobe_retention_purge_failed`, `wardrobe_deletion_drain_failed`)
 * and the loop goes on: the next tick retries it, and a failure never stops the other task.
 * Each task first runs shortly after start, so a restart or a rollout does not push a purge an
 * hour out; the lock turns that into a skip when another copy ran it recently.
 */
export class WardrobeMaintenanceLoop {
  private readonly holder: string
  private readonly random: () => number
  private readonly setTimer: (callback: () => void, ms: number) => NodeJS.Timeout
  private readonly clearTimer: (timer: NodeJS.Timeout) => void
  private readonly timers = new Map<WardrobeMaintenanceTaskName, NodeJS.Timeout>()
  private chain: Promise<void> = Promise.resolve()
  private stopped = true

  constructor(private readonly deps: WardrobeMaintenanceLoopDeps) {
    this.holder = deps.holder ?? randomUUID()
    this.random = deps.random ?? Math.random
    this.setTimer = deps.setTimer ?? ((callback, ms) => setTimeout(callback, ms))
    this.clearTimer = deps.clearTimer ?? ((timer) => clearTimeout(timer))
  }

  start(): void {
    if (!this.stopped) return
    this.stopped = false
    for (const task of Object.keys(
      WARDROBE_MAINTENANCE_TASKS
    ) as WardrobeMaintenanceTaskName[]) {
      const { startDelayMs, jitterMs } = WARDROBE_MAINTENANCE_TASKS[task]
      this.schedule(task, startDelayMs + this.random() * jitterMs)
    }
  }

  /** Stops scheduling and waits for the tick in flight. */
  async stop(): Promise<void> {
    this.stopped = true
    for (const timer of this.timers.values()) this.clearTimer(timer)
    this.timers.clear()
    await this.chain
  }

  private schedule(task: WardrobeMaintenanceTaskName, delayMs: number): void {
    if (this.stopped) return
    const timer = this.setTimer(() => {
      this.timers.delete(task)
      this.chain = this.chain.then(() => this.tick(task))
    }, delayMs)
    // The worker's Redis connections keep the process alive; a timer alone must not.
    timer.unref?.()
    this.timers.set(task, timer)
  }

  private async tick(task: WardrobeMaintenanceTaskName): Promise<void> {
    try {
      if (!this.stopped) await this.runTask(task)
    } finally {
      const { intervalMs, jitterMs } = WARDROBE_MAINTENANCE_TASKS[task]
      this.schedule(task, intervalMs + this.random() * jitterMs)
    }
  }

  private async runTask(task: WardrobeMaintenanceTaskName): Promise<void> {
    const { logger, redis, retention } = this.deps
    const events =
      task === 'wardrobe-retention-purge'
        ? {
            done: 'wardrobe_retention_purge_completed',
            failed: 'wardrobe_retention_purge_failed',
          }
        : {
            done: 'wardrobe_deletion_drain_completed',
            failed: 'wardrobe_deletion_drain_failed',
          }
    try {
      if (!(await acquireWardrobeMaintenanceLock(redis, task, this.holder))) {
        logger.info({ task }, 'wardrobe_maintenance_skipped_lock_held')
        return
      }
    } catch (error) {
      // Without the lock this copy cannot tell whether another is running the task: skip the tick.
      logger.error({ err: error, task }, 'wardrobe_maintenance_lock_failed')
      return
    }
    try {
      const result =
        task === 'wardrobe-retention-purge'
          ? await retention.purgeExpiredAndDeletedGarments()
          : await retention.drainDeletions()
      logger.info({ job: task, result }, events.done)
    } catch (error) {
      logger.error({ err: error, job: task }, events.failed)
    }
  }
}
