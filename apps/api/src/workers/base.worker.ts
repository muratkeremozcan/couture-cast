import { Worker } from 'bullmq'
import type { WorkerOptions, JobsOptions, Job } from 'bullmq'
import { PrismaClient } from '@prisma/client'
import { getRedisConfig, redisOptionsFromConfig } from '../config/redis'

const prisma = new PrismaClient()

export type WorkerFactory = (queueName: string, opts: WorkerOptions) => Worker

export function createWorker(
  queueName: string,
  processor: (job: Job) => Promise<void>,
  options: WorkerOptions
) {
  const worker = new Worker(queueName, processor, options)

  worker.on('failed', (job, err) => {
    if (!job) return
    void (async () => {
      try {
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
  return {
    connection: redisOptionsFromConfig(redisConfig),
    concurrency,
  }
}

export const defaultJobOptions: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 1000 },
}
