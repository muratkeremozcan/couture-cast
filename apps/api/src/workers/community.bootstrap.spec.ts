// Learning path Step 39: Production content-screening readiness.
// Story 6.2 Task 5: the dedicated community process starts ready and closes clean.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkerShutdownResources } from './shutdown-resources'
import type * as CommunityBootstrapModule from './community.bootstrap.js'

const harness = vi.hoisted(() => ({
  order: [] as string[],
  communityClose: vi.fn(),
  createCommunityWorkerRuntime: vi.fn(),
  shutdownWorkerResources: vi.fn(),
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

vi.mock('./shutdown-resources', () => ({
  shutdownWorkerResources: harness.shutdownWorkerResources,
}))

/**
 * Imported fresh per test, because this module keeps its worker list, its timer
 * list and its retained close hook at module scope.
 */
async function loadBootstrap(): Promise<typeof CommunityBootstrapModule> {
  vi.resetModules()
  return import('./community.bootstrap.js')
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

  it('closes the runtime before draining the worker', async () => {
    const bootstrap = await loadBootstrap()

    await bootstrap.startCommunityWorkers()
    await bootstrap.performShutdown()

    expect(harness.order).toEqual(['communityClose', 'shutdownWorkerResources'])
  })

  it('hands the worker it started to the shutdown helper', async () => {
    const bootstrap = await loadBootstrap()

    await bootstrap.startCommunityWorkers()
    await bootstrap.performShutdown()

    const resources = harness.shutdownWorkerResources.mock
      .calls[0]?.[0] as WorkerShutdownResources
    expect(resources.workers).toHaveLength(1)
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
