// Learning path Step 39: Production content-screening readiness.
// Story 6.2 Task 5: the general worker process closes what it opens.
//
// THIS FILE EXISTS BECAUSE OF A LIVE DEFECT, not to reach a coverage number.
// `bootstrap.ts` composed the community runtime, pushed `community.worker` onto
// the shutdown list, and dropped `community.close` on the floor.
// `CommunityModerationQueue` creates its own BullMQ `Queue`, and therefore its
// own Redis connection, the first time the outbox dispatcher enqueues, and that
// connection is invisible to `createQueues()`. So `SIGTERM` closed the consumer
// and left the producer's connection open for the lifetime of the container.
// `community.bootstrap.ts` had always retained the hook; this process had not,
// and nothing failed when it did not.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkerShutdownResources } from './shutdown-resources'
import type * as BootstrapModule from './bootstrap.js'
import type * as WeatherConfigModule from '../modules/weather/providers/weather.config'

const harness = vi.hoisted(() => ({
  communityClose: vi.fn().mockResolvedValue(undefined),
  createCommunityWorkerRuntime: vi.fn(),
  shutdownWorkerResources: vi.fn().mockResolvedValue(undefined),
  queueNames: [
    'weather-ingestion',
    'alert-fanout',
    'color-extraction',
    'billing-reconciliation',
    'maintenance',
    'community-moderation',
  ],
}))

vi.mock('../config/queues', () => ({
  createQueues: () =>
    harness.queueNames.map((name) => ({
      name,
      close: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
    })),
  queueConfigs: harness.queueNames.map((name) => ({ name })),
}))

vi.mock('./base.worker', () => ({
  createWorker: vi.fn(() => ({ on: vi.fn(), close: vi.fn() })),
  defaultWorkerOptions: vi.fn(() => ({})),
}))

vi.mock('./prisma', () => ({
  getPrismaClient: vi.fn(() => ({})),
  disconnectPrismaClient: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('ioredis', () => ({
  default: class {
    quit = vi.fn().mockResolvedValue('OK')
    disconnect = vi.fn()
  },
}))

vi.mock('../posthog/posthog.service.js', () => ({
  PostHogService: class {
    onApplicationShutdown = vi.fn()
  },
}))

// Pinned rather than read from the developer's `.env`, so this spec asserts
// shutdown wiring and not whoever's local `WEATHER_REFRESH_MINUTES`.
vi.mock('../modules/weather/providers/weather.config', async (importOriginal) => ({
  ...(await importOriginal<typeof WeatherConfigModule>()),
  loadWeatherConfig: () => ({
    refreshMinutes: 5,
    providerMode: 'openweather',
    ingestionTargets: [],
    weatherApiForecastDays: 3,
  }),
}))

vi.mock('../modules/weather/weather-scheduler', () => ({
  registerWeatherRefreshScheduler: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('./maintenance.scheduler', () => ({
  registerMaintenanceSchedulers: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../modules/community/community-maintenance.scheduler', () => ({
  registerCommunityMaintenanceSchedulers: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../modules/commerce/billing-reconciliation.scheduler', () => ({
  BILLING_RECONCILIATION_JOB_NAME: 'billing-reconciliation',
  COMMERCE_RETENTION_JOB_NAME: 'commerce-retention',
  registerBillingReconciliationSchedulers: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../modules/community/community-worker-runtime', () => ({
  createCommunityWorkerRuntime: harness.createCommunityWorkerRuntime,
}))

vi.mock('./shutdown-resources', () => ({
  shutdownWorkerResources: harness.shutdownWorkerResources,
}))

/**
 * Imported fresh per test. `bootstrap.ts` keeps its worker, queue and closeable
 * lists at module scope, so a second `startWorkers()` in the same module
 * instance would append to the first one's lists and make a length assertion
 * meaningless.
 */
async function loadBootstrap(): Promise<typeof BootstrapModule> {
  vi.resetModules()
  return import('./bootstrap.js')
}

describe('general worker bootstrap', () => {
  beforeEach(() => {
    harness.communityClose.mockClear().mockResolvedValue(undefined)
    harness.shutdownWorkerResources.mockClear().mockResolvedValue(undefined)
    harness.createCommunityWorkerRuntime.mockReset().mockResolvedValue({
      worker: { on: vi.fn(), close: vi.fn() },
      sweeps: {
        dispatchPending: vi.fn(),
        sweepStalePendingReview: vi.fn(),
        sweepExpiredUploads: vi.fn(),
        sweepErasureRequests: vi.fn(),
      },
      readiness: {
        selector: 'fixture',
        engineVersion: 'adr013-nsfw-v1.0-fixture',
        startupDurationMs: 1,
      },
      close: harness.communityClose,
    })
    // `performShutdown` ends in `process.exit`, which would take the vitest
    // worker with it.
    vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never)
  })

  const shutdownResources = (): WorkerShutdownResources =>
    harness.shutdownWorkerResources.mock.calls[0]?.[0] as WorkerShutdownResources

  it('waits for community readiness before it has a consumer to shut down', async () => {
    const bootstrap = await loadBootstrap()

    await bootstrap.startWorkers()

    expect(harness.createCommunityWorkerRuntime).toHaveBeenCalledTimes(1)
  })

  it('closes the community runtime on shutdown', async () => {
    const bootstrap = await loadBootstrap()

    await bootstrap.startWorkers()
    await bootstrap.performShutdown()

    const resources = shutdownResources()
    expect(resources).toBeDefined()
    // Every closeable the process opened has to be reachable from one call, so
    // the shutdown deadline and its force-disconnect fallback cover them all.
    await Promise.all(resources.queues.map((queue) => queue.close()))
    expect(harness.communityClose).toHaveBeenCalled()
  })

  it('force-disconnects the community runtime when the deadline expires', async () => {
    const bootstrap = await loadBootstrap()

    await bootstrap.startWorkers()
    await bootstrap.performShutdown()

    const resources = shutdownResources()
    await Promise.all(resources.queues.map((queue) => queue.disconnect()))

    expect(harness.communityClose).toHaveBeenCalled()
  })

  it('still hands over the six BullMQ queues it created', async () => {
    const bootstrap = await loadBootstrap()

    await bootstrap.startWorkers()
    await bootstrap.performShutdown()

    // Six queues plus the community closeable. A regression that dropped the
    // closeable again would leave exactly six.
    expect(shutdownResources().queues).toHaveLength(harness.queueNames.length + 1)
  })
})
