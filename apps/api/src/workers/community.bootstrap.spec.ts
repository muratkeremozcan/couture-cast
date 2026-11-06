// Learning path Step 39: Production content-screening readiness.
// Learning path Step 40: Community screening release gate and hosted worker.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-40-community-screening-release-gate-and-hosted-worker
// Story 6.2 Task 5: the dedicated community process starts ready and closes clean.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as ShutdownResourcesModule from './shutdown-resources'
import {
  COMMUNITY_SHUTDOWN_TIMEOUT_MS,
  createCommunityWorkerProcessState,
  performShutdown,
  startCommunityWorkers,
} from './community.bootstrap.js'
import { PostHogService } from '../posthog/posthog.service.js'

type WorkerShutdownResources = ShutdownResourcesModule.WorkerShutdownResources
type RealShutdown = (
  resources: WorkerShutdownResources,
  options?: ShutdownResourcesModule.WorkerShutdownOptions
) => Promise<void>

const harness = vi.hoisted(() => ({
  order: [] as string[],
  communityClose: vi.fn(),
  createModerationSlaSweep: vi.fn(() => ({ run: vi.fn() })),
  createCommunityWorkerRuntime: vi.fn(),
  shutdownWorkerResources: vi.fn(),
  realShutdownWorkerResources: undefined as RealShutdown | undefined,
  posthogShutdown: vi.fn(),
}))

vi.mock('./prisma', () => ({
  getPrismaClient: vi.fn(() => ({})),
  disconnectPrismaClient: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../posthog/posthog.service.js', () => ({
  PostHogService: class {
    onApplicationShutdown = harness.posthogShutdown
  },
}))

vi.mock('../modules/community/community-worker-runtime', () => ({
  createCommunityWorkerRuntime: harness.createCommunityWorkerRuntime,
}))

vi.mock('../modules/moderation/moderation-sla.sweep', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  createModerationSlaSweep: harness.createModerationSlaSweep,
}))

vi.mock('./shutdown-resources', async (importOriginal) => {
  const actual = await importOriginal<typeof ShutdownResourcesModule>()
  harness.realShutdownWorkerResources = (resources, options) =>
    actual.shutdownWorkerResources(resources, options)
  return { shutdownWorkerResources: harness.shutdownWorkerResources }
})

/**
 * A fresh process per test. The module is imported once, while the file is
 * collected, so no test pays for loading the worker graph inside its own time
 * budget; each test gets its own worker list, timer list and close hook.
 */
function freshProcess() {
  const state = createCommunityWorkerProcessState()
  return {
    startCommunityWorkers: () => startCommunityWorkers(state),
    performShutdown: () => performShutdown(state),
  }
}

/** Runs the real deadline-bounded shutdown sequence instead of the recorder. */
function useRealShutdown(): void {
  const real = harness.realShutdownWorkerResources
  if (!real) throw new Error('the real shutdown helper was not loaded')
  harness.shutdownWorkerResources.mockImplementation(real)
}

describe('dedicated community worker bootstrap', () => {
  beforeEach(() => {
    harness.order.length = 0
    harness.communityClose.mockReset().mockImplementation(() => {
      harness.order.push('communityClose')
      return Promise.resolve()
    })
    harness.shutdownWorkerResources.mockReset().mockImplementation(() => {
      harness.order.push('shutdownWorkerResources')
      return Promise.resolve()
    })
    harness.posthogShutdown.mockReset()
    harness.createCommunityWorkerRuntime.mockReset().mockResolvedValue({
      worker: { on: vi.fn(), close: vi.fn() },
      sweeps: {
        dispatchPending: vi.fn().mockResolvedValue(undefined),
        sweepStalePendingReview: vi.fn().mockResolvedValue(undefined),
        sweepExpiredUploads: vi.fn().mockResolvedValue(undefined),
        sweepErasureRequests: vi.fn().mockResolvedValue(undefined),
        sweepExpiredBanHolds: vi.fn().mockResolvedValue(undefined),
        sweepModerationSla: vi.fn().mockResolvedValue(undefined),
        sweepModerationHistoryRetention: vi.fn().mockResolvedValue(undefined),
      },
      readiness: {
        selector: 'fixture',
        engineVersion: 'adr013-nsfw-v1.0-fixture',
        startupDurationMs: 2,
      },
      close: harness.communityClose,
    })
    vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never)
  })

  describe('U-W-INTERVAL: the hosted path of the SLA sweep', () => {
    const slaIntervalMs = 60_000

    function runtimeWithSweep(sweepModerationSla: () => Promise<unknown>) {
      harness.createCommunityWorkerRuntime.mockResolvedValue({
        worker: { on: vi.fn(), close: vi.fn() },
        sweeps: {
          dispatchPending: vi.fn().mockResolvedValue(undefined),
          sweepStalePendingReview: vi.fn().mockResolvedValue(undefined),
          sweepExpiredUploads: vi.fn().mockResolvedValue(undefined),
          sweepErasureRequests: vi.fn().mockResolvedValue(undefined),
          sweepExpiredBanHolds: vi.fn().mockResolvedValue(undefined),
          sweepModerationSla,
          sweepModerationHistoryRetention: vi.fn().mockResolvedValue(undefined),
        },
        readiness: { selector: 'fixture', engineVersion: 'x', startupDurationMs: 1 },
        close: harness.communityClose,
      })
    }

    afterEach(() => {
      vi.useRealTimers()
    })

    it('U-W-FACTORY: passes a sweep, because a composition with none stays off for good', async () => {
      runtimeWithSweep(vi.fn().mockResolvedValue({ recorded: 0 }))
      await freshProcess().startCommunityWorkers()
      expect(harness.createCommunityWorkerRuntime).toHaveBeenCalledWith(
        expect.objectContaining({
          moderationSla: expect.objectContaining({
            run: expect.any(Function) as unknown,
          }) as unknown,
        })
      )
    })

    it('runs the sweep every 60 seconds, starting with the first tick', async () => {
      vi.useFakeTimers()
      const sweep = vi.fn().mockResolvedValue({ recorded: 0 })
      runtimeWithSweep(sweep)
      const bootstrap = freshProcess()
      await bootstrap.startCommunityWorkers()
      expect(sweep).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(slaIntervalMs - 1)
      expect(sweep).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1)
      expect(sweep).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(slaIntervalMs)
      expect(sweep).toHaveBeenCalledTimes(2)
      vi.useRealTimers()
      await bootstrap.performShutdown()
    })

    it('does not overlap a slow sweep', async () => {
      vi.useFakeTimers()
      let finish!: () => void
      const sweep = vi.fn(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve
          })
      )
      runtimeWithSweep(sweep)
      const bootstrap = freshProcess()
      await bootstrap.startCommunityWorkers()
      await vi.advanceTimersByTimeAsync(3 * slaIntervalMs)
      expect(sweep).toHaveBeenCalledTimes(1)
      finish()
      await vi.advanceTimersByTimeAsync(slaIntervalMs)
      expect(sweep).toHaveBeenCalledTimes(2)
      finish()
      vi.useRealTimers()
      await bootstrap.performShutdown()
    })

    it('survives a rejected sweep and keeps its interval', async () => {
      vi.useFakeTimers()
      const sweep = vi.fn().mockRejectedValue(new Error('database down'))
      runtimeWithSweep(sweep)
      const bootstrap = freshProcess()
      await bootstrap.startCommunityWorkers()
      await vi.advanceTimersByTimeAsync(slaIntervalMs)
      await vi.advanceTimersByTimeAsync(slaIntervalMs)
      expect(sweep).toHaveBeenCalledTimes(2)
      vi.useRealTimers()
      await bootstrap.performShutdown()
    })

    it('passes PostHog to the runtime, because PostHog is the hosted signal (D13)', async () => {
      const bootstrap = freshProcess()
      await bootstrap.startCommunityWorkers()
      expect(harness.createModerationSlaSweep).toHaveBeenCalledWith(
        expect.objectContaining({
          analytics: expect.any(PostHogService) as unknown,
          flags: expect.objectContaining({
            getFeatureFlag: expect.any(Function) as unknown,
          }) as unknown,
        })
      )
      vi.useRealTimers()
      await bootstrap.performShutdown()
    })

    it('U-W-OTEL: starts no SDK and subscribes to no maintenance queue in this image', () => {
      const source = readFileSync(join(__dirname, 'community.bootstrap.ts'), 'utf8')
      const code = source.replace(/^\s*(\/\/|\*|\/\*).*$/gm, '')
      expect(code).not.toMatch(/initializeOpenTelemetry|instrumentation/)
      expect(code).not.toMatch(
        /createWorker\(\s*'maintenance'|new Worker\(\s*'maintenance'/
      )
    })
  })

  describe('U-W-BOOT-RUN: the hosted path of the history retention', () => {
    const dayMs = 86_400_000

    function runtimeWithRetention(
      sweepModerationHistoryRetention: () => Promise<unknown>
    ) {
      harness.createCommunityWorkerRuntime.mockResolvedValue({
        worker: { on: vi.fn(), close: vi.fn() },
        sweeps: {
          dispatchPending: vi.fn().mockResolvedValue(undefined),
          sweepStalePendingReview: vi.fn().mockResolvedValue(undefined),
          sweepExpiredUploads: vi.fn().mockResolvedValue(undefined),
          sweepErasureRequests: vi.fn().mockResolvedValue(undefined),
          sweepExpiredBanHolds: vi.fn().mockResolvedValue(undefined),
          sweepModerationSla: vi.fn().mockResolvedValue(undefined),
          sweepModerationHistoryRetention,
        },
        readiness: { selector: 'fixture', engineVersion: 'x', startupDurationMs: 1 },
        close: harness.communityClose,
      })
    }

    afterEach(() => {
      vi.useRealTimers()
    })

    it('passes a composition with a run function', async () => {
      runtimeWithRetention(vi.fn().mockResolvedValue({ skipped: true }))
      const bootstrap = freshProcess()
      await bootstrap.startCommunityWorkers()
      expect(harness.createCommunityWorkerRuntime).toHaveBeenCalledWith(
        expect.objectContaining({
          moderationHistoryRetention: expect.objectContaining({
            run: expect.any(Function) as unknown,
          }) as unknown,
        })
      )
      vi.useRealTimers()
      await bootstrap.performShutdown()
    })

    /** The tick behind the 24-hour timer. Advancing a fake day through every 30-second sweep is too slow. */
    const dailyTick = (setIntervalSpy: { mock: { calls: unknown[][] } }) => {
      const call = setIntervalSpy.mock.calls.find(([, delay]) => delay === dayMs)
      expect(call, 'a timer at exactly 24 hours').toBeDefined()
      return call![0] as () => void
    }
    const settle = async () => {
      for (let turn = 0; turn < 5; turn++) await Promise.resolve()
    }

    it('runs once at boot and then every 24 hours, so a daily restart still prunes', async () => {
      const setIntervalSpy = vi.spyOn(globalThis, 'setInterval')
      const sweep = vi.fn().mockResolvedValue({ skipped: false })
      runtimeWithRetention(sweep)
      const bootstrap = freshProcess()
      await bootstrap.startCommunityWorkers()
      expect(sweep).toHaveBeenCalledTimes(1)
      await settle()
      dailyTick(setIntervalSpy)()
      expect(sweep).toHaveBeenCalledTimes(2)
      setIntervalSpy.mockRestore()
      await bootstrap.performShutdown()
    })

    it('[U-W-OVERLAP] does not overlap a slow run, and survives a rejected one', async () => {
      const setIntervalSpy = vi.spyOn(globalThis, 'setInterval')
      let finish: (() => void) | undefined
      const sweep = vi
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise<void>((resolve) => {
              finish = resolve
            })
        )
        .mockRejectedValueOnce(new Error('row data: member-1'))
        .mockResolvedValue({ skipped: false })
      runtimeWithRetention(sweep)
      const bootstrap = freshProcess()
      await bootstrap.startCommunityWorkers()
      expect(sweep).toHaveBeenCalledTimes(1)
      const tick = dailyTick(setIntervalSpy)
      tick()
      expect(sweep).toHaveBeenCalledTimes(1)
      finish?.()
      await settle()
      tick()
      expect(sweep).toHaveBeenCalledTimes(2)
      await settle()
      tick()
      expect(sweep).toHaveBeenCalledTimes(3)
      setIntervalSpy.mockRestore()
      await bootstrap.performShutdown()
    })
  })

  it('awaits the runtime before it reports itself started', async () => {
    const bootstrap = freshProcess()

    await bootstrap.startCommunityWorkers()

    expect(harness.createCommunityWorkerRuntime).toHaveBeenCalledTimes(1)
  })

  it('drains the worker before it closes the runtime and telemetry', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never)
    useRealShutdown()
    const workerClose = vi.fn(() => {
      harness.order.push('workerClose')
      return Promise.resolve()
    })
    harness.posthogShutdown.mockImplementation(() =>
      harness.order.push('posthogShutdown')
    )
    harness.createCommunityWorkerRuntime.mockResolvedValueOnce({
      worker: { on: vi.fn(), close: workerClose },
      sweeps: {
        dispatchPending: vi.fn().mockResolvedValue(undefined),
        sweepStalePendingReview: vi.fn().mockResolvedValue(undefined),
        sweepExpiredUploads: vi.fn().mockResolvedValue(undefined),
        sweepErasureRequests: vi.fn().mockResolvedValue(undefined),
      },
      close: harness.communityClose,
    })
    const bootstrap = freshProcess()

    await bootstrap.startCommunityWorkers()
    await bootstrap.performShutdown()

    expect(harness.order).toEqual(['workerClose', 'communityClose', 'posthogShutdown'])
    expect(exit).toHaveBeenCalledWith(0)
  })

  it('lets a job screening at SIGTERM finish with its real disposition', async () => {
    // Story 6.2b peer review (CX7), reproduced against the worker container: a
    // SIGTERM during a screening closed the inference thread under the job, which
    // failed with "Community NSFW screener is closing" and, on its final attempt,
    // marked a valid post review_failed. The screener here behaves like the real
    // one: closing it rejects every screen still in flight.
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never)
    useRealShutdown()
    let finishInference!: () => void
    let screenerClosed = false
    const inference = new Promise<void>((resolve) => {
      finishInference = resolve
    })
    const screen = async (): Promise<'pass'> => {
      await inference
      if (screenerClosed) throw new Error('Community NSFW screener is closing')
      return 'pass'
    }
    const worker = {
      on: vi.fn(),
      // BullMQ's close(): stop fetching, then wait for the active job.
      close: vi.fn(async () => {
        await activeJob
      }),
    }
    harness.createCommunityWorkerRuntime.mockResolvedValueOnce({
      worker,
      sweeps: {
        dispatchPending: vi.fn().mockResolvedValue(undefined),
        sweepStalePendingReview: vi.fn().mockResolvedValue(undefined),
        sweepExpiredUploads: vi.fn().mockResolvedValue(undefined),
        sweepErasureRequests: vi.fn().mockResolvedValue(undefined),
      },
      close: vi.fn(() => {
        screenerClosed = true
        return Promise.resolve()
      }),
    })
    const bootstrap = freshProcess()
    await bootstrap.startCommunityWorkers()

    const activeJob = screen().then(
      (disposition) => (disposition === 'pass' ? 'published' : 'flagged'),
      () => 'review_failed'
    )
    const shutdown = bootstrap.performShutdown()
    await Promise.resolve()
    finishInference()
    await shutdown

    await expect(activeJob).resolves.toBe('published')
    expect(screenerClosed).toBe(true)
    expect(exit).toHaveBeenCalledWith(0)
  })

  it('hands the worker it started to the shutdown helper', async () => {
    const bootstrap = freshProcess()

    await bootstrap.startCommunityWorkers()
    await bootstrap.performShutdown()

    const resources = harness.shutdownWorkerResources.mock
      .calls[0]?.[0] as WorkerShutdownResources
    expect(resources.workers).toHaveLength(1)
    // Below the production launcher's 25-second deadline, so the bootstrap's
    // own force-disconnect runs before the launcher gives up on it.
    const options = harness.shutdownWorkerResources.mock.calls[0]?.[1] as {
      timeoutMs?: number
    }
    expect(options.timeoutMs).toBe(COMMUNITY_SHUTDOWN_TIMEOUT_MS)
    expect(COMMUNITY_SHUTDOWN_TIMEOUT_MS).toBeLessThan(25_000)
  })

  it('exits nonzero when the screener refuses to start', async () => {
    // Decision 3: an unusable selector or an unverified model must exit before
    // queue consumption rather than leave a process that screens nothing.
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never)
    harness.createCommunityWorkerRuntime.mockRejectedValueOnce(
      new Error('COMMUNITY_NSFW_SCREENER is required')
    )
    const bootstrap = freshProcess()

    await bootstrap.startCommunityWorkers()

    expect(exit).toHaveBeenCalledWith(1)
  })
})
