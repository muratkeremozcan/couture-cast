// Learning path Step 38: Community feed by climate band.
// Learning path Step 40: Community screening release gate and hosted worker.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-40-community-screening-release-gate-and-hosted-worker
// Learning path Step 42: Screened threaded comments.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-42-screened-threaded-comments
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
const harness = vi.hoisted(() => {
  /** What reached the worker's own Redis connection, and when the worker closed. */
  const connection: unknown[][] = []
  return {
    order: [] as string[],
    connection,
    createWorker: vi.fn(() => ({
      on: vi.fn(),
      close: vi.fn(() => {
        connection.push(['worker.close'])
        return Promise.resolve()
      }),
      client: Promise.resolve({
        set: (...args: unknown[]) => {
          connection.push(['set', ...args])
          return Promise.resolve('OK')
        },
        del: (...args: unknown[]) => {
          connection.push(['del', ...args])
          return Promise.resolve(1)
        },
      }),
    })),
    queueClose: vi.fn().mockResolvedValue(undefined),
    screenerEnsureReady: vi.fn(),
    screenerClose: vi.fn(),
    commentDispatch: vi.fn().mockResolvedValue(undefined),
    commentStale: vi.fn().mockResolvedValue(undefined),
    dispatchPending: vi.fn().mockResolvedValue({ dispatched: 1, failed: 0 }),
    sweepStalePendingReview: vi.fn().mockResolvedValue({ stalled: 0 }),
    sweepExpiredUploads: vi
      .fn()
      .mockResolvedValue({ objectsDeleted: 0, draftsDeleted: 0 }),
    sweepErasureRequests: vi.fn().mockResolvedValue({
      hidden: 0,
      anonymized: 0,
      objectsPurged: 0,
      overdue: 0,
    }),
  }
})

vi.mock('./community-comments.outbox.js', () => ({
  CommunityCommentsOutbox: class {
    dispatchPending = harness.commentDispatch
    sweepStale = harness.commentStale
  },
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

import {
  createCommunityWorkerRuntime,
  runCommunitySweepSteps,
} from './community-worker-runtime'
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
describe('runCommunitySweepSteps', () => {
  it('runs every independent step before rejecting with safe failed-step names', async () => {
    const names = [
      'post_dispatch',
      'reaction_dispatch',
      'comment_dispatch',
      'post_stale',
      'comment_stale',
    ] as const
    const failed = ['post_dispatch', 'comment_dispatch', 'post_stale']
    const order: string[] = []
    const warn = vi.fn()
    const result = await runCommunitySweepSteps(
      names.map((name) => ({
        name,
        run: () => {
          order.push(name)
          return failed.includes(name)
            ? Promise.reject(new Error('private member content and confidential SQL'))
            : Promise.resolve()
        },
      })),
      { warn }
    ).catch((error: unknown) => error)

    expect(result).toBeInstanceOf(Error)
    expect(result).toMatchObject({
      message:
        'Community sweep steps failed: post_dispatch, comment_dispatch, post_stale',
    })
    expect(order).toEqual(names)
    expect(warn.mock.calls).toEqual(
      failed.map((step) => [
        { event: 'community_sweep_step_failed', step, reason: 'sweep_failed' },
        'Community sweep step deferred',
      ])
    )
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/private|member|confidential|SQL/)
  })
})

describe('createCommunityWorkerRuntime', () => {
  const claim = vi.fn().mockResolvedValue([])
  const settle = vi.fn().mockResolvedValue({ count: 1 })
  const prisma = {
    $queryRaw: claim,
    $executeRaw: vi.fn().mockResolvedValue(0),
    communityReactionOutbox: { updateMany: settle, deleteMany: vi.fn() },
    communityReactionReceipt: { deleteMany: vi.fn() },
  } as unknown as PrismaClient
  const captureReactionEvent = vi.fn().mockResolvedValue(undefined)
  const telemetryService = { captureReactionEvent } as unknown as TelemetryService
  const originalScreener = process.env[COMMUNITY_NSFW_SCREENER_ENV]

  const recordScreenerReadiness = vi.fn()
  const meter = (): CommunityModerationMeter => ({
    recordScreenerReadiness,
    recordScreening: vi.fn(),
    recordAttemptFailure: vi.fn(),
    recordModelHealth: vi.fn(),
  })

  beforeEach(() => {
    harness.commentDispatch.mockReset().mockResolvedValue(undefined)
    harness.commentStale.mockReset().mockResolvedValue(undefined)
    harness.dispatchPending.mockReset().mockResolvedValue({ dispatched: 1, failed: 0 })
    harness.sweepStalePendingReview.mockReset().mockResolvedValue({ stalled: 0 })
    claim.mockReset().mockResolvedValue([])
    settle.mockClear()
    captureReactionEvent.mockClear()
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
    delete process.env.COMMUNITY_WORKER_COMMIT_SHA
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

  it('keeps existing dispatch and stale work progressing when each comment sweep fails', async () => {
    const order: string[] = []
    harness.dispatchPending.mockImplementation(() => {
      order.push('post')
      return Promise.resolve({ dispatched: 1, failed: 0 })
    })
    harness.commentDispatch.mockImplementation(() => {
      order.push('comment')
      return Promise.reject(new Error('synthetic raw member and body must not be logged'))
    })
    harness.commentStale.mockRejectedValue(new Error('synthetic comment stale failure'))
    const runtime = await createCommunityWorkerRuntime({
      prisma,
      telemetryService,
      meter: meter(),
    })
    claim.mockImplementationOnce(() => {
      order.push('reaction')
      return Promise.resolve([])
    })
    try {
      await expect(runtime.sweeps.dispatchPending()).rejects.toThrow(
        'Community sweep steps failed: comment_dispatch'
      )
      expect(order).toEqual(['post', 'reaction', 'comment'])
      await expect(runtime.sweeps.sweepStalePendingReview()).rejects.toThrow(
        'Community sweep steps failed: comment_stale'
      )
      expect(harness.sweepStalePendingReview).toHaveBeenCalledOnce()
      expect(harness.commentStale).toHaveBeenCalledOnce()
      await expect(runtime.sweeps.dispatchPending()).rejects.toThrow(
        'Community sweep steps failed: comment_dispatch'
      )
      await expect(runtime.sweeps.sweepStalePendingReview()).rejects.toThrow(
        'Community sweep steps failed: comment_stale'
      )
      expect(harness.dispatchPending).toHaveBeenCalledTimes(2)
      expect(harness.sweepStalePendingReview).toHaveBeenCalledTimes(2)
    } finally {
      await runtime.close()
    }
  })

  it('exposes exactly the four sweeps both process groups drive', async () => {
    const runtime = await createCommunityWorkerRuntime({
      prisma,
      telemetryService,
      meter: meter(),
    })

    claim.mockResolvedValueOnce([
      {
        id: '63100000-0000-4000-8000-000000000001',
        user_id: 'synthetic-member',
        event_type: 'community_reaction_added',
        payload: {},
        attempts: 1,
        created_at: new Date(),
      },
    ])
    await runtime.sweeps.dispatchPending()
    expect(captureReactionEvent).toHaveBeenCalledOnce()
    expect(settle).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          delivered_at: expect.any(Date) as unknown,
          lease_id: null,
        }) as unknown,
      })
    )
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

  it('writes its presence heartbeat on the worker connection and removes it before the worker closes', async () => {
    // Story 6.2b review (RF15): the canary counts consumers by these keys,
    // because Upstash answers CLIENT LIST from one node.
    process.env.COMMUNITY_WORKER_COMMIT_SHA = 'abc123'
    harness.connection.length = 0
    const runtime = await createCommunityWorkerRuntime({
      prisma,
      telemetryService,
      meter: meter(),
    })
    await runtime.heartbeat.beat()

    const key = `community-worker:heartbeat:community-worker@abc123:${runtime.heartbeat.instanceId}`
    expect(runtime.heartbeat.key).toBe(key)
    expect(harness.connection).toEqual([
      ['set', key, expect.stringContaining('"commitSha":"abc123"'), 'EX', 90],
    ])

    await runtime.worker.close()

    expect(harness.connection.slice(1)).toEqual([['del', key], ['worker.close']])
  })

  it('closes the screener and the queue client it opened', async () => {
    const runtime = await createCommunityWorkerRuntime({
      prisma,
      telemetryService,
      meter: meter(),
    })
    claim.mockReset().mockResolvedValue([])
    settle.mockClear()
    captureReactionEvent.mockClear()
    harness.order.length = 0

    await runtime.close()

    // The queue holds the lazily-created Redis connection; the screener holds a
    // model process. Closing one and not the other is how a `SIGTERM` leaves a
    // connection open for the life of the container.
    expect(harness.order).toEqual(['screenerClose', 'queueClose'])
  })

  it('closes the queue even when the screener close rejects', async () => {
    // Awaiting the screener close directly meant a model process that failed
    // to terminate skipped the queue close entirely, which is the same leaked
    // Redis connection the ordering above exists to prevent, reached by
    // another route. Both are attempted; the failure is surfaced afterwards.
    const closeFailure = new Error('worker terminate rejected')
    harness.screenerClose.mockReset().mockImplementation(() => {
      harness.order.push('screenerClose')
      return Promise.reject(closeFailure)
    })

    const runtime = await createCommunityWorkerRuntime({
      prisma,
      telemetryService,
      meter: meter(),
    })
    claim.mockReset().mockResolvedValue([])
    settle.mockClear()
    captureReactionEvent.mockClear()
    harness.order.length = 0

    await expect(runtime.close()).rejects.toBe(closeFailure)
    expect(harness.order).toEqual(['screenerClose', 'queueClose'])
    expect(harness.queueClose).toHaveBeenCalledTimes(1)
  })
})
