// Learning path Step 38: Community feed by climate band.
import { describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import type * as CommunityModerationQueueModule from './community-moderation.queue.js'
import type { TelemetryService } from '../telemetry/telemetry.service'

const harness = vi.hoisted(() => ({
  createWorker: vi.fn(() => ({ on: vi.fn(), close: vi.fn() })),
  queueClose: vi.fn().mockResolvedValue(undefined),
  dispatchPending: vi.fn().mockResolvedValue({ dispatched: 1, failed: 0 }),
  sweepStalePendingReview: vi.fn().mockResolvedValue({ stalled: 0 }),
  sweepExpiredUploads: vi.fn().mockResolvedValue({ objectsDeleted: 0, draftsDeleted: 0 }),
  sweepErasureRequests: vi.fn().mockResolvedValue({
    hidden: 0,
    anonymized: 0,
    objectsPurged: 0,
    overdue: 0,
  }),
}))

vi.mock('../../workers/base.worker.js', () => ({
  createWorker: harness.createWorker,
  defaultWorkerOptions: vi.fn(() => ({})),
}))

vi.mock('./community-moderation.queue.js', async (importOriginal) => {
  const actual = await importOriginal<typeof CommunityModerationQueueModule>()
  return {
    ...actual,
    CommunityModerationQueue: class {
      onModuleDestroy = harness.queueClose
    },
  }
})

vi.mock('./community-moderation.outbox.js', () => ({
  CommunityModerationOutboxDispatcher: class {
    dispatchPending = harness.dispatchPending
  },
}))

vi.mock('./community-maintenance.service.js', () => ({
  CommunityMaintenanceService: class {
    sweepStalePendingReview = harness.sweepStalePendingReview
    sweepExpiredUploads = harness.sweepExpiredUploads
    sweepErasureRequests = harness.sweepErasureRequests
  },
}))

import { createCommunityWorkerRuntime } from './community-worker-runtime'

/**
 * `bootstrap.ts` and `community.bootstrap.ts` both run the community pipeline,
 * and a drift between them would be silent: the end-to-end stack would look
 * like it exercises screening while running different wiring from production.
 * This asserts the one composition both call.
 */
describe('createCommunityWorkerRuntime', () => {
  const prisma = {} as PrismaClient
  const telemetryService = {} as TelemetryService

  it('subscribes a worker to the community-moderation queue', () => {
    const runtime = createCommunityWorkerRuntime({ prisma, telemetryService })

    expect(runtime.worker).toBeDefined()
    expect(harness.createWorker).toHaveBeenCalledWith(
      'community-moderation',
      expect.any(Function),
      expect.any(Object)
    )
  })

  it('exposes exactly the four sweeps both process groups drive', async () => {
    const runtime = createCommunityWorkerRuntime({ prisma, telemetryService })

    await runtime.sweeps.dispatchPending()
    await runtime.sweeps.sweepStalePendingReview()
    await runtime.sweeps.sweepExpiredUploads()
    await runtime.sweeps.sweepErasureRequests()

    expect(Object.keys(runtime.sweeps).sort()).toEqual([
      'dispatchPending',
      'sweepErasureRequests',
      'sweepExpiredUploads',
      'sweepStalePendingReview',
    ])
    expect(harness.dispatchPending).toHaveBeenCalled()
    expect(harness.sweepStalePendingReview).toHaveBeenCalled()
    expect(harness.sweepExpiredUploads).toHaveBeenCalled()
    expect(harness.sweepErasureRequests).toHaveBeenCalled()
  })

  it('closes the queue client it opened', async () => {
    const runtime = createCommunityWorkerRuntime({ prisma, telemetryService })

    await runtime.close()

    expect(harness.queueClose).toHaveBeenCalled()
  })
})
