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
  COMMUNITY_WORKER_LOOPS,
  communityWorkerLoops,
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

/** Sweeps that find nothing to do, shaped like the real results the idle backoff reads. */
function idleSweeps(overrides: Record<string, () => Promise<unknown>> = {}) {
  return {
    dispatchPending: vi.fn().mockResolvedValue(0),
    sweepStalePendingReview: vi.fn().mockResolvedValue(0),
    sweepExpiredUploads: vi
      .fn()
      .mockResolvedValue({ objectsDeleted: 0, draftsDeleted: 0 }),
    sweepErasureRequests: vi.fn().mockResolvedValue({
      hidden: 0,
      anonymized: 0,
      objectsPurged: 0,
      overdue: 0,
      requestsCompleted: 0,
      requestsOverdue: 0,
    }),
    sweepExpiredBanHolds: vi
      .fn()
      .mockResolvedValue({ subjects: 0, posts: 0, comments: 0 }),
    sweepModerationSla: vi.fn().mockResolvedValue({ skipped: 1, recorded: 0 }),
    sweepModerationHistoryRetention: vi.fn().mockResolvedValue({ skipped: true }),
    ...overrides,
  }
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
      sweeps: idleSweeps(),
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
        sweeps: idleSweeps({ sweepModerationSla }),
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

  describe('U-W-BACKOFF: idle sweeps back off and busy ones keep their cadence', () => {
    afterEach(() => {
      vi.useRealTimers()
    })

    /** Starts the worker on fake timers and records when `name` ran, relative to the start. */
    async function startRecording(name: string, results: unknown[], idle: unknown) {
      vi.useFakeTimers()
      const calls: number[] = []
      const startedAt = Date.now()
      const sweep = vi.fn(() => {
        calls.push(Date.now() - startedAt)
        return Promise.resolve(results.length ? results.shift() : idle)
      })
      harness.createCommunityWorkerRuntime.mockResolvedValue({
        worker: { on: vi.fn(), close: vi.fn() },
        sweeps: idleSweeps({ [name]: sweep }),
        readiness: { selector: 'fixture', engineVersion: 'x', startupDurationMs: 1 },
        close: harness.communityClose,
      })
      const bootstrap = freshProcess()
      await bootstrap.startCommunityWorkers()
      return { bootstrap, calls }
    }

    it('backs an idle dispatch off from 1 to 10 seconds and returns to 1 second when it moves work', async () => {
      const results = [0, 0, 0, 0, 0, 0, 2, 0]
      const { bootstrap, calls } = await startRecording('dispatchPending', results, 0)
      await vi.advanceTimersByTimeAsync(48_000)
      expect(calls).toEqual([
        1_000, 3_000, 7_000, 15_000, 25_000, 35_000, 45_000, 46_000, 48_000,
      ])
      await bootstrap.performShutdown()
    })

    it('backs an idle maintenance sweep off from 30 seconds to 5 minutes', async () => {
      const idle = { subjects: 0, posts: 0, comments: 0 }
      const { bootstrap, calls } = await startRecording('sweepExpiredBanHolds', [], idle)
      await vi.advanceTimersByTimeAsync(1_050_000)
      expect(calls).toEqual([30_000, 90_000, 210_000, 450_000, 750_000, 1_050_000])
      await bootstrap.performShutdown()
    })

    it('lets a test stack cap an idle erasure sweep at 30 seconds, so an aged request is swept in time', async () => {
      vi.stubEnv('COMMUNITY_MAINTENANCE_IDLE_CAP_MS', '30000')
      try {
        const idle = { hidden: 0, anonymized: 0, objectsPurged: 0, requestsCompleted: 0 }
        const { bootstrap, calls } = await startRecording(
          'sweepErasureRequests',
          [],
          idle
        )
        await vi.advanceTimersByTimeAsync(150_000)
        expect(calls).toEqual([30_000, 60_000, 90_000, 120_000, 150_000])
        await bootstrap.performShutdown()
      } finally {
        vi.unstubAllEnvs()
      }
    })

    it('treats a failed sweep as idle, so a dependency outage is retried at the cap', async () => {
      vi.useFakeTimers()
      const dispatchPending = vi.fn().mockRejectedValue(new Error('database down'))
      harness.createCommunityWorkerRuntime.mockResolvedValue({
        worker: { on: vi.fn(), close: vi.fn() },
        sweeps: idleSweeps({ dispatchPending }),
        readiness: { selector: 'fixture', engineVersion: 'x', startupDurationMs: 1 },
        close: harness.communityClose,
      })
      const bootstrap = freshProcess()
      await bootstrap.startCommunityWorkers()
      await vi.advanceTimersByTimeAsync(60_000)
      // 1, 3, 7, 15, 25, 35, 45 and 55 seconds.
      expect(dispatchPending).toHaveBeenCalledTimes(8)
      await bootstrap.performShutdown()
    })

    it('stops every loop at shutdown', async () => {
      const { bootstrap, calls } = await startRecording('dispatchPending', [], 0)
      await vi.advanceTimersByTimeAsync(1_000)
      expect(calls).toEqual([1_000])
      await bootstrap.performShutdown()
      await vi.advanceTimersByTimeAsync(600_000)
      expect(calls).toEqual([1_000])
    })
  })

  describe('U-W-BOOT-RUN: the hosted path of the history retention', () => {
    const dayMs = 86_400_000

    function runtimeWithRetention(
      sweepModerationHistoryRetention: () => Promise<unknown>
    ) {
      harness.createCommunityWorkerRuntime.mockResolvedValue({
        worker: { on: vi.fn(), close: vi.fn() },
        sweeps: idleSweeps({ sweepModerationHistoryRetention }),
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
      sweeps: idleSweeps(),
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
      sweeps: idleSweeps(),
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

  it('waits for a sweep tick in flight before it closes the runtime it uses', async () => {
    vi.useFakeTimers()
    useRealShutdown()
    let finishSweep!: () => void
    const dispatchPending = vi.fn(
      () =>
        new Promise<number>((resolve) => {
          finishSweep = () => {
            harness.order.push('sweepFinished')
            resolve(0)
          }
        })
    )
    harness.createCommunityWorkerRuntime.mockResolvedValue({
      worker: { on: vi.fn(), close: vi.fn(() => Promise.resolve()) },
      sweeps: idleSweeps({ dispatchPending }),
      readiness: { selector: 'fixture', engineVersion: 'x', startupDurationMs: 1 },
      close: harness.communityClose,
    })
    const bootstrap = freshProcess()
    await bootstrap.startCommunityWorkers()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(dispatchPending).toHaveBeenCalledOnce()
    vi.useRealTimers()
    const shutdown = bootstrap.performShutdown()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(harness.order).not.toContain('communityClose')
    finishSweep()
    await shutdown
    expect(harness.order).toEqual(['sweepFinished', 'communityClose'])
  })

  it('hands the worker it started to the shutdown helper', async () => {
    const bootstrap = freshProcess()

    await bootstrap.startCommunityWorkers()
    await bootstrap.performShutdown()

    const resources = harness.shutdownWorkerResources.mock
      .calls[0]?.[0] as WorkerShutdownResources
    // The BullMQ consumer, then the drain of sweep ticks in flight.
    expect(resources.workers).toHaveLength(2)
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

describe('communityWorkerLoops: the maintenance idle cap a test stack may lower', () => {
  it('runs production loops when the cap is unset', () => {
    expect(communityWorkerLoops({ NODE_ENV: 'production' })).toBe(COMMUNITY_WORKER_LOOPS)
  })

  it('lowers only the maintenance cap in a test stack', () => {
    expect(
      communityWorkerLoops({
        NODE_ENV: 'test',
        COMMUNITY_MAINTENANCE_IDLE_CAP_MS: '30000',
      })
    ).toEqual({
      dispatch: COMMUNITY_WORKER_LOOPS.dispatch,
      maintenance: { baseMs: 30_000, idleCapMs: 30_000 },
    })
  })

  it('refuses the cap outside a test stack', () => {
    expect(() =>
      communityWorkerLoops({
        NODE_ENV: 'production',
        COMMUNITY_MAINTENANCE_IDLE_CAP_MS: '30000',
      })
    ).toThrow('for test stacks only')
  })

  it.each(['29999', '300001', '1e4', '-30000', 'soon'])('refuses a cap of %s', (raw) => {
    expect(() =>
      communityWorkerLoops({ NODE_ENV: 'test', COMMUNITY_MAINTENANCE_IDLE_CAP_MS: raw })
    ).toThrow('must be whole ms from 30000 to 300000')
  })
})
