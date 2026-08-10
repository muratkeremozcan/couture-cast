import { HttpException, HttpStatus } from '@nestjs/common'
import { describe, expect, it, vi } from 'vitest'
import { AdminController } from './admin.controller'
import type { AdminService } from './admin.service'

const createController = () => {
  const listFailedJobs = vi.fn()
  const retryFailedJob = vi.fn()
  const adminService = { listFailedJobs, retryFailedJob } as unknown as AdminService

  return {
    listFailedJobs,
    retryFailedJob,
    controller: new AdminController(adminService),
  }
}

describe('AdminController', () => {
  const failureRow = {
    id: 'failure-1',
    queue_name: 'weather-refresh',
    job_id: 'job-42',
  }

  describe('getFailedJobs', () => {
    it('returns the dead-letter page for every queue when no filter is given', async () => {
      const { controller, listFailedJobs } = createController()
      listFailedJobs.mockResolvedValue([failureRow])

      await expect(controller.getFailedJobs()).resolves.toEqual([failureRow])
      expect(listFailedJobs).toHaveBeenCalledWith(undefined)
    })

    it('passes the queue filter straight through to the service', async () => {
      const { controller, listFailedJobs } = createController()
      listFailedJobs.mockResolvedValue([])

      await controller.getFailedJobs('weather-refresh')

      expect(listFailedJobs).toHaveBeenCalledWith('weather-refresh')
    })
  })

  describe('retryFailedJob', () => {
    it('replays the requested dead-letter record', async () => {
      const { controller, retryFailedJob } = createController()
      retryFailedJob.mockResolvedValue({
        retried: true,
        queue: 'weather-refresh',
        jobId: 'job-42',
      })

      await expect(controller.retryFailedJob('failure-1')).resolves.toEqual({
        retried: true,
        queue: 'weather-refresh',
        jobId: 'job-42',
      })
      expect(retryFailedJob).toHaveBeenCalledWith('failure-1')
    })

    it.each([undefined, ''])(
      'rejects a replay request with a %s id before touching the queue',
      (id) => {
        // A missing id would otherwise reach the service and surface as a 500.
        const { controller, retryFailedJob } = createController()

        let thrown: unknown
        try {
          void controller.retryFailedJob(id)
        } catch (error) {
          thrown = error
        }

        expect(thrown).toBeInstanceOf(HttpException)
        expect((thrown as HttpException).getStatus()).toBe(HttpStatus.BAD_REQUEST)
        expect(retryFailedJob).not.toHaveBeenCalled()
      }
    )
  })
})
