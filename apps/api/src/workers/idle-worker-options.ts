import type { WorkerOptions } from 'bullmq'
import { defaultWorkerOptions } from './base.worker'

/**
 * The idle Redis backoff of the hosted community worker, as BullMQ options, for every consumer of
 * the hosted wardrobe worker. The numbers are `community-moderation.worker.ts`'s own, measured in
 * Story 6.2b; `idle-worker-options.spec.ts` pins them to that file, which this one does not import
 * because it brings the community screening graph with it.
 *
 * - `drainDelay` is in SECONDS (BullMQ blocks for that long on an empty queue; a new job wakes the
 *   call at once, so it costs no pickup latency). 300 is the community worker's 5 minutes; BullMQ's
 *   default of 5 spent about 6,500 Redis commands an hour per idle worker.
 * - `lockDuration` and `stalledInterval` are milliseconds. A job whose worker died is requeued
 *   within two stalled checks; the hourly retention purge re-enqueues stranded processing work too.
 */
export const IDLE_DRAIN_DELAY_SECONDS = 300
export const IDLE_LOCK_DURATION_MS = 30_000
export const IDLE_STALLED_INTERVAL_MS = 120_000
export const IDLE_MAX_STALLED_COUNT = 1

/** One job at a time: the hosted service has 0.2 vCPU and 512 MB. Throughput comes from replicas. */
export const HOSTED_WORKER_CONCURRENCY = 1

/** The options every consumer of the hosted wardrobe worker uses. */
export function hostedWorkerOptions(): WorkerOptions {
  return {
    ...defaultWorkerOptions(HOSTED_WORKER_CONCURRENCY),
    drainDelay: IDLE_DRAIN_DELAY_SECONDS,
    lockDuration: IDLE_LOCK_DURATION_MS,
    stalledInterval: IDLE_STALLED_INTERVAL_MS,
    maxStalledCount: IDLE_MAX_STALLED_COUNT,
  }
}
