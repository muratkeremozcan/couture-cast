import { describe, expect, it, vi } from 'vitest'
import { AdminCron } from './admin.cron'
import type { AdminService } from './admin.service'

const createCron = () => {
  const pruneFailedJobs = vi.fn()
  const adminService = { pruneFailedJobs } as unknown as AdminService

  return { pruneFailedJobs, cron: new AdminCron(adminService) }
}

describe('AdminCron', () => {
  it('prunes dead-letter records older than the 30 day retention window', async () => {
    const { cron, pruneFailedJobs } = createCron()
    pruneFailedJobs.mockResolvedValue({ deleted: 12 })

    await cron.pruneJobFailures()

    expect(pruneFailedJobs).toHaveBeenCalledWith(30)
  })

  it('swallows a prune failure so one bad night cannot kill the scheduler', async () => {
    // An unhandled rejection inside a @Cron handler takes down the process, and
    // the next nightly run would recover on its own anyway.
    const { cron, pruneFailedJobs } = createCron()
    pruneFailedJobs.mockRejectedValue(new Error('database unreachable'))

    await expect(cron.pruneJobFailures()).resolves.toBeUndefined()
    expect(pruneFailedJobs).toHaveBeenCalledOnce()
  })
})
