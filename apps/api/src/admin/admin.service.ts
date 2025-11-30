import { Injectable } from '@nestjs/common'
import { PrismaClient } from '@prisma/client'
import { Queue } from 'bullmq'
import { redisOptionsFromConfig, getRedisConfig } from '../config/redis'
import { defaultJobOptions } from '../workers/base.worker'

const prisma = new PrismaClient()

@Injectable()
export class AdminService {
  async listFailedJobs(queue?: string) {
    const where = queue ? { queue_name: queue } : {}
    return prisma.jobFailure.findMany({
      where,
      orderBy: { failed_at: 'desc' },
      take: 100,
    })
  }

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
    await queue.add('retry', failure.job_data as unknown as object, defaultJobOptions)
    await queue.close()

    await prisma.jobFailure.delete({ where: { id } })

    return { retried: true, queue: failure.queue_name, jobId: failure.job_id }
  }
}
