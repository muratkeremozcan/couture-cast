import { Worker } from 'bullmq'
import type { WorkerOptions, JobsOptions, Job } from 'bullmq'
import { getRedisConfig, redisOptionsFromConfig } from '../config/redis'
import { getPrismaClient } from './prisma'

/** Story 0.4 owner file: worker foundation and dead-letter capture.
 * Worker foundation and failure capture:
 * - Why DLQ exists: failed background jobs need a durable triage/retry path instead of being
 *   lost in transient logs.
 * - Current implementation: failed jobs are written to the `jobFailure` table, which acts as the
 *   dead-letter record that admin endpoints can inspect, retry, and prune.
 * - Why concurrency controls exist: each queue has different CPU/IO cost and downstream limits,
 *   so workers must cap parallelism to protect service stability.
 * - Alternatives: rely only on BullMQ's failed set, use dedicated `<queue>-dlq` queues, or push
 *   failures to external incident systems.
 * Ownership anchor:
 * - Story 0.4 Task 3 owner: persist failed job context as durable DLQ records for operator workflows.
 *
 * Flow refs:
 * - S0.4/T4: worker bootstrap passes queue-specific concurrency into this foundation layer.
 * - S0.4/T5: the dedicated worker process group creates workers through this shared factory.
 */
export type WorkerFactory = (queueName: string, opts: WorkerOptions) => Worker

export function createWorker(
  queueName: string,
  processor: (job: Job) => Promise<void>,
  options: WorkerOptions
) {
  const prisma = getPrismaClient()
  // Flow ref S0.4/T5: create a worker from the queue processor shared by the
  // dedicated worker process group.
  const worker = new Worker(queueName, processor, options)

  // Flow ref S0.4/T3: attach a failed-job listener that persists DLQ records
  // for admin triage and replay.
  worker.on('failed', (job, err) => {
    if (!job) return
    void (async () => {
      try {
        // Flow ref S0.4/T3: persist failure context so operators can inspect,
        // retry, and prune dead-lettered jobs later.
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
  // Flow ref S0.4/T4: apply the shared connection plus queue-specific
  // concurrency defaults passed in by worker bootstrap.
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
