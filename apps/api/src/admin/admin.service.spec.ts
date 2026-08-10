import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AdminService } from './admin.service.js'
import { defaultJobOptions } from '../workers/base.worker.js'

const mocks = vi.hoisted(() => ({
  jobFailure: {
    findMany: vi.fn(),
    deleteMany: vi.fn(),
    findUnique: vi.fn(),
    delete: vi.fn(),
  },
  queue: {
    add: vi.fn(),
    close: vi.fn(),
  },
  queueConstructorArgs: [] as [string, { connection: unknown }][],
}))

vi.mock('@prisma/client', () => ({
  PrismaClient: class {
    jobFailure = mocks.jobFailure
  },
}))

vi.mock('bullmq', () => ({
  Queue: class {
    add = mocks.queue.add
    close = mocks.queue.close

    constructor(name: string, options: { connection: unknown }) {
      mocks.queueConstructorArgs.push([name, options])
    }
  },
  Worker: class {},
}))

// vi.mock is hoisted above these imports, so the mocked Prisma and BullMQ
// modules are already in place when the service module is evaluated.

describe('AdminService', () => {
  let service: InstanceType<typeof AdminService>

  const failureRow = {
    id: 'failure-1',
    queue_name: 'weather-refresh',
    job_id: 'job-42',
    job_data: { locationKey: 'chicago-il' },
    error_message: 'provider timeout',
    attempts: 3,
    failed_at: new Date('2026-07-16T12:00:00.000Z'),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.queueConstructorArgs.length = 0
    mocks.jobFailure.findMany.mockResolvedValue([])
    mocks.jobFailure.deleteMany.mockResolvedValue({ count: 0 })
    mocks.jobFailure.findUnique.mockResolvedValue(failureRow)
    mocks.jobFailure.delete.mockResolvedValue(failureRow)
    mocks.queue.add.mockResolvedValue({ id: 'job-99' })
    mocks.queue.close.mockResolvedValue(undefined)
    service = new AdminService()
  })

  describe('listFailedJobs', () => {
    it('returns the newest failures first and caps the page at 100 rows', async () => {
      mocks.jobFailure.findMany.mockResolvedValue([failureRow])

      await expect(service.listFailedJobs()).resolves.toEqual([failureRow])
      expect(mocks.jobFailure.findMany).toHaveBeenCalledWith({
        where: {},
        orderBy: { failed_at: 'desc' },
        take: 100,
      })
    })

    it('filters by queue name when one is supplied', async () => {
      await service.listFailedJobs('weather-refresh')

      expect(mocks.jobFailure.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { queue_name: 'weather-refresh' } })
      )
    })
  })

  describe('pruneFailedJobs', () => {
    it('deletes failures older than the default 30 day window', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-07-16T12:00:00.000Z'))
      try {
        mocks.jobFailure.deleteMany.mockResolvedValue({ count: 7 })

        await expect(service.pruneFailedJobs()).resolves.toEqual({ deleted: 7 })

        const args = mocks.jobFailure.deleteMany.mock.calls[0]?.[0] as {
          where: { failed_at: { lt: Date } }
        }
        expect(args.where.failed_at.lt.toISOString()).toBe('2026-06-16T12:00:00.000Z')
      } finally {
        vi.useRealTimers()
      }
    })

    it('honors a custom retention window', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-07-16T12:00:00.000Z'))
      try {
        await service.pruneFailedJobs(1)

        const args = mocks.jobFailure.deleteMany.mock.calls[0]?.[0] as {
          where: { failed_at: { lt: Date } }
        }
        expect(args.where.failed_at.lt.toISOString()).toBe('2026-07-15T12:00:00.000Z')
      } finally {
        vi.useRealTimers()
      }
    })
  })

  describe('retryFailedJob', () => {
    it('requeues the original payload onto the original queue and clears the DLQ row', async () => {
      await expect(service.retryFailedJob('failure-1')).resolves.toEqual({
        retried: true,
        queue: 'weather-refresh',
        jobId: 'job-42',
      })

      expect(mocks.queueConstructorArgs[0]?.[0]).toBe('weather-refresh')
      expect(mocks.queue.add).toHaveBeenCalledWith(
        'retry',
        { locationKey: 'chicago-il' },
        defaultJobOptions
      )
      expect(mocks.queue.close).toHaveBeenCalledTimes(1)
      expect(mocks.jobFailure.delete).toHaveBeenCalledWith({ where: { id: 'failure-1' } })
    })

    it('connects the replay queue with the configured Redis options', async () => {
      process.env.REDIS_URL = 'redis://queue.example.com:6399'
      try {
        await service.retryFailedJob('failure-1')

        expect(mocks.queueConstructorArgs[0]?.[1].connection).toMatchObject({
          host: 'queue.example.com',
          port: 6399,
        })
      } finally {
        delete process.env.REDIS_URL
      }
    })

    it('rejects when the dead-letter record does not exist', async () => {
      mocks.jobFailure.findUnique.mockResolvedValue(null)

      await expect(service.retryFailedJob('missing')).rejects.toThrow(
        'failed job not found'
      )
      expect(mocks.queue.add).not.toHaveBeenCalled()
      expect(mocks.jobFailure.delete).not.toHaveBeenCalled()
    })

    it('keeps the DLQ row when the requeue fails', async () => {
      // Losing the record on a failed enqueue would silently drop the job;
      // the operator must be able to retry again.
      mocks.queue.add.mockRejectedValue(new Error('redis unavailable'))

      await expect(service.retryFailedJob('failure-1')).rejects.toThrow(
        'redis unavailable'
      )
      expect(mocks.jobFailure.delete).not.toHaveBeenCalled()
    })
  })
})
