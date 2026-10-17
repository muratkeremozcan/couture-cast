// Learning path Step 39: Production content-screening readiness.
// Story 6.2 Task 5: the dedicated community process starts ready and closes clean.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as ShutdownResourcesModule from './shutdown-resources'
import type * as CommunityBootstrapModule from './community.bootstrap.js'

type WorkerShutdownResources = ShutdownResourcesModule.WorkerShutdownResources
type RealShutdown = (
  resources: WorkerShutdownResources,
  options?: ShutdownResourcesModule.WorkerShutdownOptions
) => Promise<void>

const harness = vi.hoisted(() => ({
  order: [] as string[],
  communityClose: vi.fn(),
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

vi.mock('./shutdown-resources', async (importOriginal) => {
  const actual = await importOriginal<typeof ShutdownResourcesModule>()
  harness.realShutdownWorkerResources = (resources, options) =>
    actual.shutdownWorkerResources(resources, options)
  return { shutdownWorkerResources: harness.shutdownWorkerResources }
})

/**
 * Imported fresh per test, because this module keeps its worker list, its timer
 * list and its retained close hook at module scope.
 */
async function loadBootstrap(): Promise<typeof CommunityBootstrapModule> {
  vi.resetModules()
  return import('./community.bootstrap.js')
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

  it('awaits the runtime before it reports itself started', async () => {
    const bootstrap = await loadBootstrap()

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
    const bootstrap = await loadBootstrap()

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
    const bootstrap = await loadBootstrap()
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
    const bootstrap = await loadBootstrap()

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
    expect(options.timeoutMs).toBe(bootstrap.COMMUNITY_SHUTDOWN_TIMEOUT_MS)
    expect(bootstrap.COMMUNITY_SHUTDOWN_TIMEOUT_MS).toBeLessThan(25_000)
  })

  it('exits nonzero when the screener refuses to start', async () => {
    // Decision 3: an unusable selector or an unverified model must exit before
    // queue consumption rather than leave a process that screens nothing.
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never)
    harness.createCommunityWorkerRuntime.mockRejectedValueOnce(
      new Error('COMMUNITY_NSFW_SCREENER is required')
    )
    const bootstrap = await loadBootstrap()

    await bootstrap.startCommunityWorkers()

    expect(exit).toHaveBeenCalledWith(1)
  })
})
