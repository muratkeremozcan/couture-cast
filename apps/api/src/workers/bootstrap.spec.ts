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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkerShutdownResources } from './shutdown-resources'
import type * as WeatherConfigModule from '../modules/weather/providers/weather.config'
import { createWorkerProcessState, performShutdown, startWorkers } from './bootstrap.js'
import type * as ProcessingQueueModule from '../modules/wardrobe/wardrobe-processing.queue'

const harness = vi.hoisted(() => ({
  registerModerationSlaScheduler: vi.fn().mockResolvedValue(undefined),
  registerModerationHistoryScheduler: vi.fn().mockResolvedValue(undefined),
  registerOrphanAuthUserSweepScheduler: vi.fn().mockResolvedValue(undefined),
  removeOrphanAuthUserSweepScheduler: vi.fn().mockResolvedValue(undefined),
  initializeOpenTelemetry: vi.fn(() => false),
  shutdownOpenTelemetry: vi.fn().mockResolvedValue(undefined),
  exit: vi.fn(),
  engagement: vi.fn().mockResolvedValue({ close: vi.fn() }),
  communityClose: vi.fn().mockResolvedValue(undefined),
  createCommunityWorkerRuntime: vi.fn(),
  shutdownWorkerResources: vi.fn().mockResolvedValue(undefined),
  /** Round 4: the hourly wardrobe job's producers for stranded processing photos. */
  silhouetteHandoffClose: vi.fn().mockResolvedValue(undefined),
  paletteHandoffClose: vi.fn().mockResolvedValue(undefined),
  garmentHandoffClose: vi.fn().mockResolvedValue(undefined),
  queueNames: [
    'weather-ingestion',
    'alert-fanout',
    'color-extraction',
    'billing-reconciliation',
    'maintenance',
    'community-moderation',
  ],
}))

vi.mock('../modules/community/community-engagement.runtime.js', () => ({
  startCommunityEngagementRuntime: harness.engagement,
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
  registerModerationSlaScheduler: harness.registerModerationSlaScheduler,
  registerModerationHistoryScheduler: harness.registerModerationHistoryScheduler,
  registerOrphanAuthUserSweepScheduler: harness.registerOrphanAuthUserSweepScheduler,
  removeOrphanAuthUserSweepScheduler: harness.removeOrphanAuthUserSweepScheduler,
  MODERATION_SLA_SWEEP_JOB_NAME: 'moderation-sla-sweep',
  MODERATION_HISTORY_RETENTION_JOB_NAME: 'moderation-history-retention',
}))

vi.mock('../instrumentation', () => ({
  initializeOpenTelemetry: harness.initializeOpenTelemetry,
  shutdownOpenTelemetry: harness.shutdownOpenTelemetry,
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

vi.mock('../modules/wardrobe/silhouette-photo-processing.queue', () => ({
  SilhouettePhotoProcessingQueue: class {
    enqueue = vi.fn()
    onModuleDestroy = harness.silhouetteHandoffClose
  },
}))

// Round 6 (Codex C5-7): the hourly job also re-enqueues held-then-released garments.
vi.mock('../modules/wardrobe/wardrobe-processing.queue', async (importOriginal) => ({
  ...(await importOriginal<typeof ProcessingQueueModule>()),
  WardrobeProcessingQueue: class {
    enqueue = vi.fn()
    onModuleDestroy = harness.garmentHandoffClose
  },
}))

vi.mock('../modules/commerce/palette-analysis-processing.queue', () => ({
  PaletteAnalysisProcessingQueue: class {
    enqueue = vi.fn()
    onModuleDestroy = harness.paletteHandoffClose
  },
}))

vi.mock('./shutdown-resources', () => ({
  shutdownWorkerResources: harness.shutdownWorkerResources,
}))

/**
 * A fresh process per test. The module is imported once, while the file is
 * collected, so no test pays for loading the worker graph inside its own time
 * budget; each test gets its own worker, queue and closeable lists.
 */
function freshProcess() {
  const state = createWorkerProcessState()
  return {
    startWorkers: () => startWorkers(state),
    performShutdown: () => performShutdown(state),
  }
}

describe('general worker bootstrap', () => {
  beforeEach(() => {
    harness.engagement.mockReset().mockResolvedValue({ close: vi.fn() })
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
    harness.exit.mockClear()
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      harness.exit(code)
    }) as never)
  })

  const shutdownResources = (): WorkerShutdownResources =>
    harness.shutdownWorkerResources.mock.calls[0]?.[0] as WorkerShutdownResources

  it('R05 community capability failure leaves weather/general worker startup running', async () => {
    harness.engagement.mockRejectedValueOnce(
      new Error('Community dispatch capability unavailable')
    )
    const bootstrap = freshProcess()
    await bootstrap.startWorkers()
    expect(harness.createCommunityWorkerRuntime).toHaveBeenCalledTimes(1)
    expect(harness.exit).not.toHaveBeenCalled()
    await bootstrap.performShutdown()
  })

  it('U-W-FACTORY: passes a sweep, because a composition with none stays off for good', async () => {
    const bootstrap = freshProcess()
    await bootstrap.startWorkers()
    expect(harness.createCommunityWorkerRuntime).toHaveBeenCalledWith(
      expect.objectContaining({
        moderationSla: expect.objectContaining({
          run: expect.any(Function) as unknown,
        }) as unknown,
      })
    )
    await bootstrap.performShutdown()
  })

  it('U-W-SCHEDULER: registers the SLA sweep on the maintenance queue', async () => {
    harness.registerModerationSlaScheduler.mockClear()
    const bootstrap = freshProcess()
    await bootstrap.startWorkers()
    expect(harness.registerModerationSlaScheduler).toHaveBeenCalledOnce()
    await bootstrap.performShutdown()
  })

  // Learning path Step 57: Google sign-in.
  // Story 6.17 TEA-14: the general worker registers the orphan Auth user sweep only when
  // ORPHAN_AUTH_USER_SWEEP_ENABLED names it, and never under a local or preview TEST_ENV.
  describe('U-W-ORPHAN-GATE', () => {
    afterEach(() => {
      vi.unstubAllEnvs()
    })

    it.each([
      ['the flag is unset', {}],
      [
        'TEST_ENV is local',
        { ORPHAN_AUTH_USER_SWEEP_ENABLED: 'true', TEST_ENV: 'local' },
      ],
      [
        'TEST_ENV is preview',
        { ORPHAN_AUTH_USER_SWEEP_ENABLED: 'true', TEST_ENV: 'preview' },
      ],
    ])('neither registers nor composes the sweep when %s', async (_label, env) => {
      vi.stubEnv('ORPHAN_AUTH_USER_SWEEP_ENABLED', '')
      vi.stubEnv('TEST_ENV', '')
      vi.stubEnv('VERCEL_ENV', '')
      for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value)
      harness.registerOrphanAuthUserSweepScheduler.mockClear()
      harness.removeOrphanAuthUserSweepScheduler.mockClear()
      const bootstrap = freshProcess()
      await bootstrap.startWorkers()
      expect(harness.registerOrphanAuthUserSweepScheduler).not.toHaveBeenCalled()
      // A flag turned off after a deploy leaves no scheduler behind in Redis.
      expect(harness.removeOrphanAuthUserSweepScheduler).toHaveBeenCalledOnce()
      expect(harness.createCommunityWorkerRuntime).toHaveBeenLastCalledWith(
        expect.not.objectContaining({ orphanAuthUsers: expect.anything() as unknown })
      )
      await bootstrap.performShutdown()
    })

    it('registers and composes the sweep when the flag names the worker', async () => {
      vi.stubEnv('ORPHAN_AUTH_USER_SWEEP_ENABLED', 'true')
      vi.stubEnv('TEST_ENV', '')
      vi.stubEnv('VERCEL_ENV', '')
      harness.registerOrphanAuthUserSweepScheduler.mockClear()
      harness.removeOrphanAuthUserSweepScheduler.mockClear()
      const bootstrap = freshProcess()
      await bootstrap.startWorkers()
      expect(harness.registerOrphanAuthUserSweepScheduler).toHaveBeenCalledOnce()
      expect(harness.removeOrphanAuthUserSweepScheduler).not.toHaveBeenCalled()
      expect(harness.createCommunityWorkerRuntime).toHaveBeenLastCalledWith(
        expect.objectContaining({
          orphanAuthUsers: expect.objectContaining({
            run: expect.any(Function) as unknown,
          }) as unknown,
        })
      )
      await bootstrap.performShutdown()
    })
  })

  // TEA sign-off F-4: the worker refuses a guardian consent policy its deployment may not run,
  // as the API's AppModule does, before it opens a queue or starts telemetry.
  it('U-W-POLICY: exits 1 before starting anything on required_13_15 outside a test environment', async () => {
    vi.stubEnv('GUARDIAN_CONSENT_POLICY', 'required_13_15')
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('TEST_ENV', '')
    harness.initializeOpenTelemetry.mockClear()
    try {
      await freshProcess().startWorkers()
      expect(harness.exit).toHaveBeenCalledWith(1)
      expect(harness.initializeOpenTelemetry).not.toHaveBeenCalled()
      expect(harness.createCommunityWorkerRuntime).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('U-W-OTEL: starts OpenTelemetry and closes it on shutdown', async () => {
    harness.initializeOpenTelemetry.mockClear()
    harness.shutdownOpenTelemetry.mockClear()
    const bootstrap = freshProcess()
    await bootstrap.startWorkers()
    expect(harness.initializeOpenTelemetry).toHaveBeenCalledOnce()
    expect(harness.shutdownOpenTelemetry).not.toHaveBeenCalled()
    await bootstrap.performShutdown()
    expect(harness.shutdownOpenTelemetry).toHaveBeenCalledOnce()
  })

  it('U-W-OTEL: still flushes telemetry when a close rejects, and exits 1', async () => {
    harness.shutdownOpenTelemetry.mockClear()
    const bootstrap = freshProcess()
    await bootstrap.startWorkers()
    harness.shutdownWorkerResources.mockRejectedValueOnce(new Error('redis close failed'))
    await bootstrap.performShutdown()
    expect(harness.shutdownOpenTelemetry).toHaveBeenCalledOnce()
    expect(harness.exit).toHaveBeenCalledWith(1)
  })

  it('waits for community readiness before it has a consumer to shut down', async () => {
    const bootstrap = freshProcess()

    await bootstrap.startWorkers()

    expect(harness.createCommunityWorkerRuntime).toHaveBeenCalledTimes(1)
  })

  it('closes the community runtime on shutdown', async () => {
    const bootstrap = freshProcess()

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
    const bootstrap = freshProcess()

    await bootstrap.startWorkers()
    await bootstrap.performShutdown()

    const resources = shutdownResources()
    await Promise.all(resources.queues.map((queue) => queue.disconnect()))

    expect(harness.communityClose).toHaveBeenCalled()
  })

  it('still hands over the six BullMQ queues it created', async () => {
    const bootstrap = freshProcess()

    await bootstrap.startWorkers()
    await bootstrap.performShutdown()

    // Six queues plus the engagement and screening closeables and the three wardrobe handoff
    // producers (round 4, garment in round 6). A regression that dropped a closeable again
    // would leave fewer.
    expect(shutdownResources().queues).toHaveLength(harness.queueNames.length + 5)
  })

  it('closes the wardrobe processing handoff producers it opened for the hourly job', async () => {
    const bootstrap = freshProcess()

    await bootstrap.startWorkers()
    await bootstrap.performShutdown()
    await Promise.all(shutdownResources().queues.map((queue) => queue.close()))

    expect(harness.garmentHandoffClose).toHaveBeenCalled()
    expect(harness.silhouetteHandoffClose).toHaveBeenCalled()
    expect(harness.paletteHandoffClose).toHaveBeenCalled()
  })
})
