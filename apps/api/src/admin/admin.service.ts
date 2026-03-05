import { Injectable } from '@nestjs/common'
import { PrismaClient } from '@prisma/client'
import { Queue } from 'bullmq'
import { redisOptionsFromConfig, getRedisConfig } from '../config/redis'
import { defaultJobOptions } from '../workers/base.worker'

/** Story 0.4 Task 5 context
 * Admin dead-letter operations:
 * - Why DLQ exists: operators need a safe place to inspect and replay failed async jobs.
 * - Here, the DLQ is persisted in `jobFailure` rows written by worker failure hooks.
 * - Alternatives: inspect only BullMQ failed sets, or reconstruct failures from logs/events.
 * - Setup steps:
 *   1) List recent failures (optionally by queue).
 *   2) Prune old failures to keep storage bounded.
 *   3) Re-enqueue a failed payload with default retry options.
 *   4) Remove the DLQ row after successful requeue.
 */
const prisma = new PrismaClient()

@Injectable()
export class AdminService {
  // 1) List recent failures (optionally by queue).
  async listFailedJobs(queue?: string) {
    const where = queue ? { queue_name: queue } : {}
    return prisma.jobFailure.findMany({
      where,
      orderBy: { failed_at: 'desc' },
      take: 100,
    })
  }

  // 2) Prune old failures to keep storage bounded.
  async pruneFailedJobs(olderThanDays = 30) {
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - olderThanDays)
    const result = await prisma.jobFailure.deleteMany({
      where: {
        failed_at: {
          lt: cutoff,
        },
      },
    })
    return { deleted: result.count }
  }

  async retryFailedJob(id: string) {
    const failure = await prisma.jobFailure.findUnique({ where: { id } })
    if (!failure) {
      throw new Error('failed job not found')
    }

    const redisConfig = getRedisConfig()
    const connection = redisOptionsFromConfig(redisConfig)
    const queue = new Queue(failure.queue_name, { connection })
    // 3) Re-enqueue a failed payload with default retry options.
    // Replay with the same baseline retry behavior used for normal background jobs.
    await queue.add('retry', failure.job_data as unknown as object, defaultJobOptions)
    await queue.close()

    // 4) Remove the DLQ row after successful requeue.
    await prisma.jobFailure.delete({ where: { id } })

    return { retried: true, queue: failure.queue_name, jobId: failure.job_id }
  }
}
