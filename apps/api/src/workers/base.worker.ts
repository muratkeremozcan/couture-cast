import { Worker } from 'bullmq'
import type { WorkerOptions, JobsOptions, Job } from 'bullmq'
import { getRedisConfig, redisOptionsFromConfig } from '../config/redis'
import { getPrismaClient } from './prisma'

/** Story 0.4 Task 2/3/4/5 context
 * Worker foundation and failure capture:
 * - Why DLQ exists: failed background jobs need a durable triage/retry path instead of being
 *   lost in transient logs.
 * - Current implementation: failed jobs are written to the `jobFailure` table, which acts as the
 *   dead-letter record that admin endpoints can inspect, retry, and prune.
 * - Why concurrency controls exist: each queue has different CPU/IO cost and downstream limits,
 *   so workers must cap parallelism to protect service stability.
 * - Alternatives: rely only on BullMQ's failed set, use dedicated `<queue>-dlq` queues, or push
 *   failures to external incident systems.
 * - Setup steps:
 *   1) Create a worker with the queue processor.
 *   2) Attach a failed-job listener.
 *   3) Persist failure context for operator workflows.
 *   4) Apply connection + concurrency defaults used by worker bootstrap.
 */
export type WorkerFactory = (queueName: string, opts: WorkerOptions) => Worker

export function createWorker(
  queueName: string,
  processor: (job: Job) => Promise<void>,
  options: WorkerOptions
) {
  const prisma = getPrismaClient()
  // 1) Create a worker with the queue processor.
  const worker = new Worker(queueName, processor, options)

  // 2) Attach a failed-job listener.
  // Persist failed job details as our DLQ record for admin triage and replay.
  worker.on('failed', (job, err) => {
    if (!job) return
    void (async () => {
      try {
        // 3) Persist failure context for operator workflows.
        await prisma.jobFailure.create({
          data: {
            queue_name: queueName,
            job_id: job.id as string,
            job_data: job.data as unknown as object,
            error_message: err?.message || 'Unknown error',
            attempts: job.attemptsMade ?? 0,
          },
        })
      } catch (writeErr) {
        console.error('Failed to write job failure', writeErr)
      }
    })()
  })

  return worker
}

export function defaultWorkerOptions(concurrency: number): WorkerOptions {
  const redisConfig = getRedisConfig()
  // 4) Apply connection + concurrency defaults used by worker bootstrap.
  return {
    connection: redisOptionsFromConfig(redisConfig),
    // Queue-specific caps are passed here; finer rate limits are set in bootstrap.ts.
    concurrency,
  }
}

export const defaultJobOptions: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 1000 },
}
