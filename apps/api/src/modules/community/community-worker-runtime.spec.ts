// Learning path Step 38: Community feed by climate band.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import type * as CommunityModerationQueueModule from './community-moderation.queue.js'
import type { TelemetryService } from '../telemetry/telemetry.service'
import type { NsfwImageScreener } from './community-moderation.engine.js'
import type { CommunityModerationMeter } from './community-moderation.telemetry.js'
import type * as FixtureScreenerModule from './fixture-nsfw-image-screener.js'

/**
 * Ordering is the point of most of this file, so every collaborator records
 * into one shared list.
 *
 * NOTHING HERE MAY LOAD A MODEL. The fixture screener module is mocked outright
 * and the selector under test is always `fixture`, so the real
 * `tensorflow` branch is unreachable from this spec by construction rather than
 * by whichever adapter happens to be wired today.
 */
const harness = vi.hoisted(() => ({
  order: [] as string[],
  createWorker: vi.fn(() => ({ on: vi.fn(), close: vi.fn() })),
  queueClose: vi.fn().mockResolvedValue(undefined),
  screenerEnsureReady: vi.fn(),
  screenerClose: vi.fn(),
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
  createWorker: (...args: unknown[]) => {
    harness.order.push('createWorker')
    return harness.createWorker(...(args as []))
  },
  defaultWorkerOptions: vi.fn(() => ({})),
}))

vi.mock('./fixture-nsfw-image-screener.js', async (importOriginal) => {
  const actual = await importOriginal<typeof FixtureScreenerModule>()
  return {
    ...actual,
    FixtureNsfwImageScreener: class implements NsfwImageScreener {
      readonly engineVersion = 'adr013-nsfw-v1.0-fixture'
      screen = vi.fn()
      ensureReady = harness.screenerEnsureReady
      close = harness.screenerClose
    },
  }
})

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
import {
  COMMUNITY_NSFW_SCREENER_ENV,
  COMMUNITY_NSFW_SCREENER_FIXTURE,
} from './fixture-nsfw-image-screener'

/**
 * `bootstrap.ts` and `community.bootstrap.ts` both run the community pipeline,
 * and a drift between them would be silent: the end-to-end stack would look
 * like it exercises screening while running different wiring from production.
 * This asserts the one composition both call.
 */
describe('createCommunityWorkerRuntime', () => {
  const prisma = {} as PrismaClient
  const telemetryService = {} as TelemetryService
  const originalScreener = process.env[COMMUNITY_NSFW_SCREENER_ENV]

  const recordScreenerReadiness = vi.fn()
  const meter = (): CommunityModerationMeter => ({
    recordScreenerReadiness,
    recordScreening: vi.fn(),
    recordAttemptFailure: vi.fn(),
    recordModelHealth: vi.fn(),
  })

  beforeEach(() => {
    harness.order.length = 0
    recordScreenerReadiness.mockReset()
    harness.screenerEnsureReady.mockReset().mockImplementation(async () => {
      await Promise.resolve()
      harness.order.push('ensureReady')
      return { engineVersion: 'adr013-nsfw-v1.0-fixture' }
    })
    harness.screenerClose.mockReset().mockImplementation(() => {
      harness.order.push('screenerClose')
      return Promise.resolve()
    })
    harness.queueClose.mockReset().mockImplementation(() => {
      harness.order.push('queueClose')
      return Promise.resolve()
    })
    process.env[COMMUNITY_NSFW_SCREENER_ENV] = COMMUNITY_NSFW_SCREENER_FIXTURE
  })

  afterEach(() => {
    if (originalScreener === undefined) {
      delete process.env[COMMUNITY_NSFW_SCREENER_ENV]
    } else {
      process.env[COMMUNITY_NSFW_SCREENER_ENV] = originalScreener
    }
  })

  it('subscribes a worker to the community-moderation queue', async () => {
    const runtime = await createCommunityWorkerRuntime({
      prisma,
      telemetryService,
      meter: meter(),
    })

    expect(runtime.worker).toBeDefined()
    expect(harness.createWorker).toHaveBeenCalledWith(
      'community-moderation',
      expect.any(Function),
      expect.any(Object)
    )
  })

  it('waits for screener readiness before the consumer exists', async () => {
    // A BullMQ worker consumes from the instant it is constructed, so building
    // one before the model has loaded means the first jobs off the queue are
    // screened by an engine that is not ready.
    await createCommunityWorkerRuntime({ prisma, telemetryService, meter: meter() })

    expect(harness.order).toEqual(['ensureReady', 'createWorker'])
  })

  it('reports the selector and startup cost it actually observed', async () => {
    const runtime = await createCommunityWorkerRuntime({
      prisma,
      telemetryService,
      meter: meter(),
    })

    expect(runtime.readiness).toMatchObject({
      selector: COMMUNITY_NSFW_SCREENER_FIXTURE,
      engineVersion: 'adr013-nsfw-v1.0-fixture',
    })
    expect(runtime.readiness?.startupDurationMs).toBeGreaterThanOrEqual(0)
  })

  it('records a ready readiness measurement', async () => {
    await createCommunityWorkerRuntime({ prisma, telemetryService, meter: meter() })

    expect(recordScreenerReadiness).toHaveBeenCalledWith(
      COMMUNITY_NSFW_SCREENER_FIXTURE,
      'ready',
      expect.any(Number)
    )
  })

  it('claims no screening identity when the caller pinned the engine', async () => {
    const runtime = await createCommunityWorkerRuntime({
      prisma,
      telemetryService,
      meter: meter(),
      engine: {
        screenText: vi.fn(),
        screenImage: vi.fn(),
        moderatePost: vi.fn(),
      },
    })

    // No selector was read, so there is no honest readiness payload to report.
    expect(runtime.readiness).toBeUndefined()
    expect(harness.screenerEnsureReady).not.toHaveBeenCalled()
  })

  it('exposes exactly the four sweeps both process groups drive', async () => {
    const runtime = await createCommunityWorkerRuntime({
      prisma,
      telemetryService,
      meter: meter(),
    })

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

  it('closes the screener and the queue client it opened', async () => {
    const runtime = await createCommunityWorkerRuntime({
      prisma,
      telemetryService,
      meter: meter(),
    })
    harness.order.length = 0

    await runtime.close()

    // The queue holds the lazily-created Redis connection; the screener holds a
    // model process. Closing one and not the other is how a `SIGTERM` leaves a
    // connection open for the life of the container.
    expect(harness.order).toEqual(['screenerClose', 'queueClose'])
  })
})
