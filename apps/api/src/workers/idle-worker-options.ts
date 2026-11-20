import type { WorkerOptions } from 'bullmq'
import { defaultWorkerOptions } from './base.worker'

/**
 * The idle Redis backoff of the hosted wardrobe worker's consumers, as BullMQ options.
 *
 * The hosted worker bills per Redis command on a pay-as-you-go plan and uploads are rare, so it
 * idles far slower than the community worker (whose 300 s block and 120 s stalled check keep
 * moderation recovery inside its SLA; see `community-moderation.worker.ts`, unchanged).
 *
 * Measured cost of one idle consumer, against a local Redis counting script commands and on the
 * live service (about 950 commands an hour for three consumers at 300 s and 120 s):
 * - a stalled check costs 7 commands and runs every `stalledInterval`;
 * - an empty blocking wait costs 8 commands and ends every `drainDelay`.
 * Three consumers at 900 s and 1800 s therefore cost about 140 commands an hour (see
 * `idle-worker-options.spec.ts`, which pins the arithmetic).
 *
 * - `drainDelay` is in SECONDS. BullMQ blocks that long on an empty queue; a new job wakes the
 *   call at once, so it adds no pickup latency. A silent drop of the idle socket would, so the
 *   connection sends TCP keepalive probes (`HOSTED_KEEP_ALIVE_MS`): they hold the connection
 *   open through a NAT or load balancer that forgets idle flows (about 20 minutes on common
 *   clouds) and reveal a dead peer. They are TCP packets, not Redis commands.
 * - `lockDuration` and `stalledInterval` are milliseconds. A job whose worker died is requeued at
 *   the second stalled check after the crash (30 minutes at most); the hourly retention purge
 *   re-enqueues stranded processing work too.
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
