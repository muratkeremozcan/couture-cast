// Step 5 support owner: searchable owner anchor
import { Injectable } from '@nestjs/common'
import { PrismaClient } from '@prisma/client'
import { Queue } from 'bullmq'
import { redisOptionsFromConfig, getRedisConfig } from '../config/redis'
import { defaultJobOptions } from '../workers/base.worker'

/** Story 0.4 support file: admin dead-letter operations.
 * Admin dead-letter operations:
 * - Why DLQ exists: operators need a safe place to inspect and replay failed async jobs.
 * - Here, the DLQ is persisted in `jobFailure` rows written by worker failure hooks.
 * - Alternatives: inspect only BullMQ failed sets, or reconstruct failures from logs/events.
 *
 * Flow refs:
 * - S0.4/T3: operators inspect, prune, and replay the durable DLQ records created by worker failures.
 */
const prisma = new PrismaClient()

@Injectable()
export class AdminService {
  // Flow ref S0.4/T3: list recent failures so operators can inspect the DLQ.
  async listFailedJobs(queue?: string) {
    const where = queue ? { queue_name: queue } : {}
    return prisma.jobFailure.findMany({
      where,
      orderBy: { failed_at: 'desc' },
      take: 100,
    })
  }

  // Flow ref S0.4/T3: prune old failures to keep DLQ storage bounded.
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
    // Flow ref S0.4/T3: replay with the same baseline retry behavior used for
    // normal background jobs.
    await queue.add('retry', failure.job_data as unknown as object, defaultJobOptions)
    await queue.close()

    // Flow ref S0.4/T3: remove the DLQ row only after successful requeue.
    await prisma.jobFailure.delete({ where: { id } })

    return { retried: true, queue: failure.queue_name, jobId: failure.job_id }
  }
}
