import type { WorkerOptions } from 'bullmq'
import { defaultWorkerOptions } from './base.worker'

/**
 * The idle Redis backoff of the hosted wardrobe worker's consumers, as BullMQ options.
 *
 * The hosted worker bills per Redis command on a pay-as-you-go plan and uploads are rare, so it
 * idles far slower than the community worker (whose 300 s block and 120 s stalled check keep
 * moderation recovery inside its SLA; see `community-moderation.worker.ts`, unchanged).
 *
 * Cost model of one idle consumer on an empty, warmed queue, counted against a local Redis
 * including script commands (it reproduces the community worker's recorded 138 and 306 an hour):
 * - a stalled check costs 7 commands and runs every `stalledInterval`;
 * - an empty blocking wait costs 8 commands and ends every `drainDelay`.
 * Three consumers at 900 s and 1800 s project to about 137 commands an hour, with the five
 * maintenance locks (`idle-worker-options.spec.ts` pins the arithmetic). It does not cover
 * reconnects, retries with delayed jobs or maintenance that finds work. The live service moved the
 * whole Redis from 23.4 to 9.1 commands a minute (see the deployment guide).
 *
 * - `drainDelay` is in SECONDS. BullMQ blocks that long on an empty queue; on a healthy socket a
 *   new job wakes the call at once. A silently dropped idle socket would not, so the connection
 *   sets TCP keepalive (`HOSTED_KEEP_ALIVE_MS`, the delay before the first probe after
 *   inactivity): the probes help preserve idle flows through a NAT or load balancer and reveal a
 *   dead peer, though probe retry timing and the network's idle policy are separate. They are TCP
 *   packets, not Redis commands.
 * - `lockDuration` and `stalledInterval` are milliseconds. A job whose worker died is requeued by
 *   up to two successful stalled checks once a consumer is running again and Redis is reachable
 *   (about 30 minutes), plus the restart and reconnect time. The hourly handoff only repairs a
 *   photo whose first enqueue never happened.
 *
 * Only the hosted entry point (`startWardrobeWorker({ hosted: true })`) takes these. A developer's
 * or separately deployed wardrobe worker keeps the community worker's 300 s and 120 s
 * (`standaloneWorkerOptions`), so its crash recovery stays about four minutes.
 */
export const IDLE_DRAIN_DELAY_SECONDS = 1800
export const IDLE_LOCK_DURATION_MS = 30_000
export const IDLE_STALLED_INTERVAL_MS = 900_000
export const IDLE_MAX_STALLED_COUNT = 1
export const HOSTED_KEEP_ALIVE_MS = 60_000

/** Commands one idle consumer spends per stalled check and per empty blocking wait (measured). */
export const COMMANDS_PER_STALLED_CHECK = 7
export const COMMANDS_PER_EMPTY_BLOCKING_WAIT = 8

/** One job at a time: the hosted service has 0.2 vCPU and 512 MB. Throughput comes from replicas. */
export const HOSTED_WORKER_CONCURRENCY = 1

/** What a standalone (non-hosted) wardrobe worker keeps: the community worker's own settings. */
export const STANDALONE_DRAIN_DELAY_SECONDS = 300
export const STANDALONE_STALLED_INTERVAL_MS = 120_000

/** The options every consumer of the hosted wardrobe worker uses. */
export function hostedWorkerOptions(): WorkerOptions {
  const base = defaultWorkerOptions(HOSTED_WORKER_CONCURRENCY)
  return {
    ...base,
    connection: {
      ...(base.connection as Record<string, unknown>),
      keepAlive: HOSTED_KEEP_ALIVE_MS,
    },
    drainDelay: IDLE_DRAIN_DELAY_SECONDS,
    lockDuration: IDLE_LOCK_DURATION_MS,
    stalledInterval: IDLE_STALLED_INTERVAL_MS,
    maxStalledCount: IDLE_MAX_STALLED_COUNT,
  }
}

/** The options a standalone wardrobe worker uses: the previous settings, no keepalive change. */
export function standaloneWorkerOptions(): WorkerOptions {
  return {
    ...defaultWorkerOptions(HOSTED_WORKER_CONCURRENCY),
    drainDelay: STANDALONE_DRAIN_DELAY_SECONDS,
    lockDuration: IDLE_LOCK_DURATION_MS,
    stalledInterval: STANDALONE_STALLED_INTERVAL_MS,
    maxStalledCount: IDLE_MAX_STALLED_COUNT,
  }
}

/** Hosted entry point: the slow idle settings; any other entry point: the standalone ones. */
export function wardrobeWorkerOptions(hosted: boolean): WorkerOptions {
  return hosted ? hostedWorkerOptions() : standaloneWorkerOptions()
}
