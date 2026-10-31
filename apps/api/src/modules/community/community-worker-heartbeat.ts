// Story 6.2b heartbeat owner: write, refresh and remove the presence key in `apps/api/src/modules/community/community-worker-heartbeat.ts`, read by `scripts/lib/community-worker-heartbeat.mjs`
// Story 6.2b review (RF15): the community worker's presence, as every Redis node
// sees it.
import { randomUUID } from 'node:crypto'
import type { Worker } from 'bullmq'
import { createBaseLogger } from '../../logger/pino.config.js'
import { COMMUNITY_MODERATION_LOG_FEATURE } from './community-moderation.telemetry.js'

/**
 * WHY A HEARTBEAT. BullMQ's `queue.getWorkers()` finds consumers through
 * `CLIENT LIST`, and Upstash answers `CLIENT LIST` from whichever node took the
 * connection, listing only that node's clients. Measured against production on
 * 2026-10-17: of 12 fresh connections, 5 listed the hosted worker's named
 * connection and 7 did not, while the worker stayed connected throughout. The
 * hosted canary failed `worker_absent` twice against a healthy worker, and the
 * same blind spot hides a second consumer on another node from the
 * sole-consumer proof. A local Redis is one node, which is why local
 * measurements never showed it.
 *
 * A key is answered the same from every node, so each worker process writes one:
 * `community-worker:heartbeat:<worker name>:<instance id>`, with a fresh UUID per
 * process, so two replicas of one image (which share the worker name) are two
 * keys. The canary and the measurements count these keys, and the readiness
 * gates require that count.
 */
export const COMMUNITY_WORKER_HEARTBEAT_PREFIX = 'community-worker:heartbeat:'

/**
 * How long a heartbeat outlives its last refresh, in seconds, and how often it
 * is refreshed. Three refreshes per lifetime, so two in a row can be lost to a
 * Redis blip before the worker reads as absent. A worker killed without a
 * graceful shutdown reads as present for at most this long.
 *
 * The cost is one `SET` per refresh: 120 commands an hour, about 87,600 a month,
 * which Upstash Pay as You Go bills at about 0.18 USD. The idle Redis
 * measurement includes it.
 */
export const COMMUNITY_WORKER_HEARTBEAT_TTL_SECONDS = 90
export const COMMUNITY_WORKER_HEARTBEAT_INTERVAL_MS = 30_000

/** How long one refresh may take before it is logged as missed. */
export const COMMUNITY_WORKER_HEARTBEAT_COMMAND_TIMEOUT_MS = 5_000

/**
 * How long removing the heartbeat may hold up a graceful shutdown, out of the
 * bootstrap's 20-second deadline (`COMMUNITY_SHUTDOWN_TIMEOUT_MS`). A heartbeat
 * that could not be removed expires on its TTL.
 */
export const COMMUNITY_WORKER_HEARTBEAT_STOP_TIMEOUT_MS = 2_000

export const COMMUNITY_WORKER_HEARTBEAT_LOG_EVENTS = {
  started: 'community_worker_heartbeat_started',
  refreshFailed: 'community_worker_heartbeat_refresh_failed',
  removed: 'community_worker_heartbeat_removed',
  removeFailed: 'community_worker_heartbeat_remove_failed',
} as const

export function communityWorkerHeartbeatKey(
  workerName: string,
  instanceId: string
): string {
  return `${COMMUNITY_WORKER_HEARTBEAT_PREFIX}${workerName}:${instanceId}`
}

/** What the key holds: who wrote it, from which build, and since when. */
export interface CommunityWorkerHeartbeatValue {
  name: string
  commitSha: string | null
  startedAt: string
  pid: number
}

/** The two commands the heartbeat sends, as ioredis declares them. */
export interface HeartbeatRedis {
  set(key: string, value: string, mode: 'EX', seconds: number): Promise<unknown>
  del(key: string): Promise<unknown>
}

export interface HeartbeatLogger {
  info(details: object, message: string): void
  warn(details: object, message: string): void
}

export interface CommunityWorkerHeartbeatOptions {
  /**
   * The connection to write on. The runtime passes the worker's own BullMQ
   * connection, so a heartbeat that refreshes is a worker whose connection
   * works, and the heartbeat opens no connection of its own.
   */
  redis: () => Promise<HeartbeatRedis>
  workerName: string
  commitSha: string | null
  instanceId?: string
  pid?: number
  now?: () => Date
  ttlSeconds?: number
  intervalMs?: number
  commandTimeoutMs?: number
  stopTimeoutMs?: number
  logger?: HeartbeatLogger
}

class HeartbeatTimeoutError extends Error {
  constructor(operation: string, timeoutMs: number) {
    super(`heartbeat ${operation} did not finish within ${timeoutMs} ms`)
    this.name = 'HeartbeatTimeoutError'
  }
}

/** `work`, or a rejection after `timeoutMs`; the timer never holds the process open. */
async function withinTimeout<T>(
  work: () => Promise<T>,
  timeoutMs: number,
  operation: string
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const expiry = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new HeartbeatTimeoutError(operation, timeoutMs)),
      timeoutMs
    )
    timer.unref?.()
  })
  try {
    return await Promise.race([Promise.resolve().then(work), expiry])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : String(error)

/**
 * One worker process's heartbeat. `start` writes it and refreshes it on an
 * interval; `stop` stops refreshing and deletes it. Nothing here throws or
 * rejects: a missed refresh is logged at warn and the next one tries again,
 * because a worker that crashed over its heartbeat would turn a Redis blip into
 * an outage.
 */
export class CommunityWorkerHeartbeat {
  readonly key: string
  readonly instanceId: string
  readonly ttlSeconds: number
  readonly intervalMs: number
  private readonly value: string
  private readonly redis: () => Promise<HeartbeatRedis>
  private readonly commandTimeoutMs: number
  private readonly stopTimeoutMs: number
  private readonly logger: HeartbeatLogger
  private timer: ReturnType<typeof setInterval> | undefined
  private inFlight: Promise<boolean> | undefined
  private stopping: Promise<void> | undefined
  private announced = false

  constructor(options: CommunityWorkerHeartbeatOptions) {
    this.instanceId = options.instanceId ?? randomUUID()
    this.key = communityWorkerHeartbeatKey(options.workerName, this.instanceId)
    this.ttlSeconds = options.ttlSeconds ?? COMMUNITY_WORKER_HEARTBEAT_TTL_SECONDS
    this.intervalMs = options.intervalMs ?? COMMUNITY_WORKER_HEARTBEAT_INTERVAL_MS
    if (this.intervalMs >= this.ttlSeconds * 1000) {
      throw new RangeError(
        'The heartbeat must refresh more often than it expires, or a healthy worker reads as absent'
      )
    }
    this.commandTimeoutMs =
      options.commandTimeoutMs ?? COMMUNITY_WORKER_HEARTBEAT_COMMAND_TIMEOUT_MS
    this.stopTimeoutMs =
      options.stopTimeoutMs ?? COMMUNITY_WORKER_HEARTBEAT_STOP_TIMEOUT_MS
    this.redis = options.redis
    this.logger =
      options.logger ??
      createBaseLogger().child({ feature: COMMUNITY_MODERATION_LOG_FEATURE })
    const value: CommunityWorkerHeartbeatValue = {
      name: options.workerName,
      commitSha: options.commitSha,
      startedAt: (options.now?.() ?? new Date()).toISOString(),
      pid: options.pid ?? process.pid,
    }
    this.value = JSON.stringify(value)
  }

  /** Writes the heartbeat now and every `intervalMs` until `stop`. */
  start(): Promise<boolean> {
    if (this.stopping || this.timer) return Promise.resolve(false)
    this.timer = setInterval(() => void this.beat(), this.intervalMs)
    this.timer.unref?.()
    return this.beat()
  }

  /**
   * One refresh, resolving to whether it landed. A refresh still waiting on
   * Redis is not doubled: the next tick shares it.
   */
  beat(): Promise<boolean> {
    if (this.stopping) return Promise.resolve(false)
    this.inFlight ??= this.write().finally(() => {
      this.inFlight = undefined
    })
    return this.inFlight
  }

  /**
   * Stops refreshing and deletes the key, within `stopTimeoutMs`. Idempotent.
   * A refresh still in flight is waited for first; both go out on the same
   * connection, so the delete lands after it and nothing re-creates the key.
   */
  stop(): Promise<void> {
    this.stopping ??= this.remove()
    return this.stopping
  }

  private async write(): Promise<boolean> {
    try {
      await withinTimeout(
        async () => (await this.redis()).set(this.key, this.value, 'EX', this.ttlSeconds),
        this.commandTimeoutMs,
        'refresh'
      )
      if (!this.announced) {
        this.announced = true
        this.logger.info(
          {
            event: COMMUNITY_WORKER_HEARTBEAT_LOG_EVENTS.started,
            key: this.key,
            ttlSeconds: this.ttlSeconds,
            intervalMs: this.intervalMs,
          },
          'Community worker heartbeat written'
        )
      }
      return true
    } catch (error) {
      this.logger.warn(
        {
          event: COMMUNITY_WORKER_HEARTBEAT_LOG_EVENTS.refreshFailed,
          key: this.key,
          errorMessage: messageOf(error),
        },
        'Community worker heartbeat refresh missed; the next one retries'
      )
      return false
    }
  }

  private async remove(): Promise<void> {
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
    const inFlight = this.inFlight
    try {
      await withinTimeout(
        async () => {
          await inFlight
          await (await this.redis()).del(this.key)
        },
        this.stopTimeoutMs,
        'removal'
      )
      this.logger.info(
        { event: COMMUNITY_WORKER_HEARTBEAT_LOG_EVENTS.removed, key: this.key },
        'Community worker heartbeat removed'
      )
    } catch (error) {
      this.logger.warn(
        {
          event: COMMUNITY_WORKER_HEARTBEAT_LOG_EVENTS.removeFailed,
          key: this.key,
          ttlSeconds: this.ttlSeconds,
          errorMessage: messageOf(error),
        },
        'Community worker heartbeat not removed; it expires on its TTL'
      )
    }
  }
}

/**
 * Makes closing the worker remove its heartbeat first, whoever closes it
 * (`community.bootstrap.ts`, `bootstrap.ts`, a deadline's force-close).
 *
 * First, because the heartbeat rides on the worker's own connection, which
 * `Worker.close()` closes once the active job is done; and because a closing
 * worker takes no new job, so it is no longer a consumer the canary can count
 * on. A graceful close waits for the removal, which `stopTimeoutMs` bounds
 * inside the shutdown deadline. A forced close does not wait: the deadline has
 * already passed, and the key expires on its TTL if the removal does not land.
 */
export function closeWithHeartbeat(
  worker: Worker,
  heartbeat: CommunityWorkerHeartbeat
): void {
  const close = worker.close.bind(worker) as Worker['close']
  worker.close = async (force = false) => {
    if (force) {
      void heartbeat.stop()
      return close(true)
    }
    await heartbeat.stop()
    return close(false)
  }
}
