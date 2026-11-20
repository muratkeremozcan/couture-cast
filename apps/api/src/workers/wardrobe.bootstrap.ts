import '../load-env'
import path from 'node:path'
import type { Queue, Worker } from 'bullmq'
import Redis from 'ioredis'
import { allowsTestOnlySecrets } from '../config/runtime-environment'
import { createQueues } from '../config/queues'
import { getRedisConfig, redisOptionsFromConfig } from '../config/redis'
import { createBaseLogger } from '../logger/pino.config.js'
import { FixtureGarmentTaggingEngine } from '../modules/wardrobe/fixture-garment-tagging.engine'
import type { GarmentTaggingEngine } from '../modules/wardrobe/garment-tagging.engine'
import { ManualGarmentTaggingEngine } from '../modules/wardrobe/manual-garment-tagging.engine'
import { invalidateRitualCacheForUser } from '../modules/personalization/ritual-cache'
import { WardrobeRetentionService } from '../modules/wardrobe/wardrobe-retention.service'
import {
  garmentColorProcessingJobSchema,
  WardrobeProcessingQueue,
} from '../modules/wardrobe/wardrobe-processing.queue'
import { WardrobeColorProcessor } from '../modules/wardrobe/wardrobe-color.processor'
import { FixtureSilhouettePhotoModerationEngine } from '../modules/wardrobe/fixture-silhouette-photo-moderation.engine'
import { HeuristicSilhouettePhotoModerationEngine } from '../modules/wardrobe/heuristic-silhouette-photo-moderation.engine'
import type { SilhouettePhotoModerationEngine } from '../modules/wardrobe/silhouette-photo-moderation.engine'
import {
  SilhouettePhotoProcessingQueue,
  silhouettePhotoProcessingJobSchema,
  silhouetteSessionFromJobId,
} from '../modules/wardrobe/silhouette-photo-processing.queue'
import { SilhouettePhotoProcessor } from '../modules/wardrobe/silhouette-photo.processor'
import { SupabaseWardrobeStorageAdapter } from '../modules/wardrobe/wardrobe-storage.adapter'
import { FixturePaletteAnalysisEngine } from '../modules/commerce/fixture-palette-analysis.engine'
import { HeuristicPaletteAnalysisEngine } from '../modules/commerce/heuristic-palette-analysis.engine'
import type { PaletteAnalysisEngine } from '../modules/commerce/palette-analysis.engine'
import {
  PaletteAnalysisProcessingQueue,
  paletteAnalysisProcessingJobSchema,
  paletteAttemptFromJobId,
} from '../modules/commerce/palette-analysis-processing.queue'
import { PaletteAnalysisProcessor } from '../modules/commerce/palette-analysis.processor'
import { TelemetryService } from '../modules/telemetry/telemetry.service'
import { PostHogService } from '../posthog/posthog.service'
import { createWorker } from './base.worker'
import {
  HOSTED_WORKER_CONCURRENCY,
  IDLE_DRAIN_DELAY_SECONDS,
  hostedWorkerOptions,
} from './idle-worker-options'
import { createWardrobeMaintenanceProcessor } from './maintenance.processor'
import { registerWardrobeMaintenanceSchedulers } from './maintenance.scheduler'
import { disconnectPrismaClient, getPrismaClient } from './prisma'
import { shutdownWorkerResources, type ShutdownQueue } from './shutdown-resources'
import { wardrobeMaintenanceEnabled } from './wardrobe-maintenance'
import { resolveGuardianConsentPolicy } from '../modules/auth/guardian-consent-policy.js'

const logger = createBaseLogger().child({ feature: 'wardrobe-worker' })
const workers: Worker[] = []
const queues: ShutdownQueue[] = []
const redisClients: Redis[] = []

export async function createTaggingEngine(): Promise<GarmentTaggingEngine> {
  const requestedEngine = process.env.GARMENT_TAGGING_ENGINE?.trim() || 'fashion-clip'
  if (requestedEngine === 'manual') {
    // No model, no onnxruntime, no transformers: the hosted service cannot hold the model. The
    // garment reaches `awaiting_tags` with no suggestions and the member chooses the tags.
    logger.info(
      { engine: requestedEngine },
      'Using garment tagging engine: no model is loaded and members choose the tags'
    )
    return new ManualGarmentTaggingEngine()
  }
  if (requestedEngine === 'fixture') {
    if (!allowsTestOnlySecrets()) {
      throw new Error(
        'GARMENT_TAGGING_ENGINE=fixture is forbidden outside test environments'
      )
    }
    logger.info({ engine: requestedEngine }, 'Using garment tagging engine')
    return new FixtureGarmentTaggingEngine()
  }
  if (requestedEngine !== 'fashion-clip') {
    throw new Error(`Unsupported GARMENT_TAGGING_ENGINE value: ${requestedEngine}`)
  }

  const configuredModelDir = process.env.GARMENT_TAGGING_MODEL_DIR?.trim()
  if (configuredModelDir && !path.isAbsolute(configuredModelDir)) {
    throw new Error('GARMENT_TAGGING_MODEL_DIR must be an absolute path')
  }
  if (!configuredModelDir && !allowsTestOnlySecrets()) {
    throw new Error(
      'GARMENT_TAGGING_MODEL_DIR is required for the production wardrobe worker'
    )
  }

  logger.info(
    { engine: requestedEngine, modelDir: configuredModelDir },
    'Initializing garment tagging engine'
  )
  // Loaded only here, so a worker on `manual` never reads the engine module, let alone the model.
  const { FashionClipTaggingEngine } = await import(
    '../modules/wardrobe/fashion-clip-tagging.engine.js'
  )
  const engine = new FashionClipTaggingEngine(configuredModelDir)
  await engine.ensureReady()
  logger.info({ engine: requestedEngine }, 'Garment tagging engine is ready')
  return engine
}

export function createSilhouetteModerationEngine(): SilhouettePhotoModerationEngine {
  const requestedEngine = process.env.SILHOUETTE_MODERATION_ENGINE?.trim() || 'heuristic'
  if (requestedEngine === 'fixture') {
    if (!allowsTestOnlySecrets()) {
      throw new Error(
        'SILHOUETTE_MODERATION_ENGINE=fixture is forbidden outside test environments'
      )
    }
    logger.info({ engine: requestedEngine }, 'Using silhouette moderation engine')
    return new FixtureSilhouettePhotoModerationEngine()
  }
  if (requestedEngine !== 'heuristic') {
    throw new Error(`Unsupported SILHOUETTE_MODERATION_ENGINE value: ${requestedEngine}`)
  }
  logger.info({ engine: requestedEngine }, 'Using silhouette moderation engine')
  return new HeuristicSilhouettePhotoModerationEngine()
}

/**
 * `storage_error` and `timeout` are both genuine processing faults that
 * propagate out of `SilhouettePhotoProcessor.process` (decision 5). This
 * codebase has no more precise signal than the error shape itself to
 * distinguish them at final-attempt exhaustion, so a recognizable
 * timeout/abort signature classifies as `timeout` and everything else
 * classifies as `storage_error`.
 */
export function classifySilhouetteProcessingFailure(
  error: unknown
): 'timeout' | 'storage_error' {
  if (error instanceof Error) {
    const name = error.name.toLowerCase()
    const message = error.message.toLowerCase()
    if (
      name.includes('timeout') ||
      name === 'aborterror' ||
      message.includes('timeout') ||
      message.includes('timed out')
    ) {
      return 'timeout'
    }
  }
  return 'storage_error'
}

/** Story 5.4 Task 6: identical shape to {@link classifySilhouetteProcessingFailure}. */
export function classifyPaletteProcessingFailure(
  error: unknown
): 'timeout' | 'storage_error' {
  return classifySilhouetteProcessingFailure(error)
}

export function createPaletteAnalysisEngine(): PaletteAnalysisEngine {
  const requestedEngine = process.env.PALETTE_ANALYSIS_ENGINE?.trim() || 'heuristic'
  if (requestedEngine === 'fixture') {
    if (!allowsTestOnlySecrets()) {
      throw new Error(
        'PALETTE_ANALYSIS_ENGINE=fixture is forbidden outside test environments'
      )
    }
    logger.info({ engine: requestedEngine }, 'Using palette analysis engine')
    return new FixturePaletteAnalysisEngine()
  }
  if (requestedEngine !== 'heuristic') {
    throw new Error(`Unsupported PALETTE_ANALYSIS_ENGINE value: ${requestedEngine}`)
  }
  logger.info({ engine: requestedEngine }, 'Using palette analysis engine')
  return new HeuristicPaletteAnalysisEngine()
}

/**
 * The wardrobe-only maintenance worker (`WARDROBE_MAINTENANCE_ENABLED=true`): the `maintenance`
 * queue's one consumer on this Redis, routing the retention purge and the deletion drain, with
 * their two schedulers. Hand-wired like the general worker (Nest DI does not work under tsx).
 *
 * The retention service re-enqueues stranded processing garments and photos through the three
 * handoff producers, which open their Redis connection on the first re-enqueue; the ritual cache
 * client is the one connection this adds, and it sends no command while idle.
 */
async function startWardrobeMaintenance(
  prisma: ReturnType<typeof getPrismaClient>,
  startedQueues: Queue[]
) {
  const maintenanceQueue = startedQueues.find((queue) => queue.name === 'maintenance')
  if (!maintenanceQueue) {
    throw new Error('Required maintenance queue was not created')
  }
  const redisConfig = getRedisConfig()
  const ritualCacheRedis = new Redis(redisConfig.url, {
    ...redisOptionsFromConfig(redisConfig),
  })
  redisClients.push(ritualCacheRedis)

  const garmentHandoff = new WardrobeProcessingQueue()
  const silhouetteHandoff = new SilhouettePhotoProcessingQueue()
  const paletteHandoff = new PaletteAnalysisProcessingQueue()
  queues.push(
    {
      close: () => garmentHandoff.onModuleDestroy(),
      disconnect: () => garmentHandoff.onModuleDestroy(),
    },
    {
      close: () => silhouetteHandoff.onModuleDestroy(),
      disconnect: () => silhouetteHandoff.onModuleDestroy(),
    },
    {
      close: () => paletteHandoff.onModuleDestroy(),
      disconnect: () => paletteHandoff.onModuleDestroy(),
    }
  )

  const processor = createWardrobeMaintenanceProcessor({
    wardrobeRetention: new WardrobeRetentionService(
      prisma,
      new SupabaseWardrobeStorageAdapter(),
      {
        invalidateUserCache: (userId: string) =>
          invalidateRitualCacheForUser(ritualCacheRedis, userId),
      },
      { garment: garmentHandoff, silhouette: silhouetteHandoff, palette: paletteHandoff }
    ),
    logger: logger.child({ feature: 'wardrobe-maintenance' }),
  })

  await registerWardrobeMaintenanceSchedulers(maintenanceQueue)
  // Serial on purpose, as in the general worker: both sweeps are batched scans.
  workers.push(createWorker('maintenance', processor, hostedWorkerOptions()))
}

export async function startWardrobeWorker() {
  try {
    // Refuse to start on a guardian consent policy this deployment may not run, as the API's
    // AppModule does (TEA sign-off F-4).
    resolveGuardianConsentPolicy()
    const startedQueues = createQueues()
    queues.push(...startedQueues)
    const colorExtractionQueue = startedQueues.find(
      (queue) => queue.name === 'color-extraction'
    )

    if (!colorExtractionQueue) {
      throw new Error('Required color-extraction queue was not created')
    }

    const prisma = getPrismaClient()
    const taggingEngine = await createTaggingEngine()
    const wardrobeProcessor = new WardrobeColorProcessor(
      prisma,
      new SupabaseWardrobeStorageAdapter(),
      taggingEngine
    )

    workers.push(
      createWorker(
        'color-extraction',
        async (job) => {
          const data = garmentColorProcessingJobSchema.parse(job.data)
          try {
            await wardrobeProcessor.process(data.garmentId)
          } catch (error) {
            const maxAttempts = job.opts.attempts ?? 1
            if (job.attemptsMade + 1 >= maxAttempts) {
              await wardrobeProcessor.markFailed(data.garmentId)
            }
            throw error
          }
        },
        hostedWorkerOptions()
      )
    )

    const moderationReviewQueue = startedQueues.find(
      (queue) => queue.name === 'moderation-review'
    )
    if (!moderationReviewQueue) {
      throw new Error('Required moderation-review queue was not created')
    }

    const silhouetteProcessor = new SilhouettePhotoProcessor(
      prisma,
      new SupabaseWardrobeStorageAdapter(),
      createSilhouetteModerationEngine()
    )

    workers.push(
      // One job at a time on the hosted service (0.2 vCPU, 512 MB), which also bounds the rate
      // the placeholder's limiter (workers/bootstrap.ts) used to cap.
      createWorker(
        'moderation-review',
        async (job) => {
          const data = silhouettePhotoProcessingJobSchema.parse(job.data)
          // The job's own session, carried through failure handling too.
          const uploadSessionId = silhouetteSessionFromJobId({ id: job.id, data })
          try {
            await silhouetteProcessor.process(data.silhouetteProfileId, uploadSessionId)
          } catch (error) {
            const maxAttempts = job.opts.attempts ?? 1
            if (job.attemptsMade + 1 >= maxAttempts) {
              await silhouetteProcessor.markFailed(
                data.silhouetteProfileId,
                classifySilhouetteProcessingFailure(error),
                uploadSessionId
              )
            }
            throw error
          }
        },
        hostedWorkerOptions()
      )
    )

    const paletteAnalysisQueue = startedQueues.find(
      (queue) => queue.name === 'palette-analysis'
    )
    if (!paletteAnalysisQueue) {
      throw new Error('Required palette-analysis queue was not created')
    }

    // Nest DI does not work under tsx in this repository, so hand-wire
    // (Decision 12). This is the process that already owns
    // SupabaseWardrobeStorageAdapter and the image-processing concurrency
    // policy, which is why palette analysis is registered here rather than
    // in bootstrap.ts.
    const telemetryService = new TelemetryService(prisma, new PostHogService())
    const paletteProcessor = new PaletteAnalysisProcessor(
      prisma,
      new SupabaseWardrobeStorageAdapter(),
      createPaletteAnalysisEngine(),
      telemetryService
    )

    workers.push(
      createWorker(
        'palette-analysis',
        async (job) => {
          const data = paletteAnalysisProcessingJobSchema.parse(job.data)
          // The job's own analysis attempt, carried through failure handling too.
          const attemptId = paletteAttemptFromJobId({ id: job.id, data })
          try {
            await paletteProcessor.process(data.paletteProfileId, attemptId)
          } catch (error) {
            const maxAttempts = job.opts.attempts ?? 1
            if (job.attemptsMade + 1 >= maxAttempts) {
              await paletteProcessor.markFailed(
                data.paletteProfileId,
                classifyPaletteProcessingFailure(error),
                attemptId
              )
            }
            throw error
          }
        },
        hostedWorkerOptions()
      )
    )

    if (wardrobeMaintenanceEnabled()) {
      await startWardrobeMaintenance(prisma, startedQueues)
    }

    // The queues this process consumes, for the operator who is checking that nothing else
    // consumes them on the same Redis.
    logger.info(
      {
        consumes: workers.map((worker) => worker.name),
        concurrency: HOSTED_WORKER_CONCURRENCY,
        maintenance: wardrobeMaintenanceEnabled(),
        taggingEngine: process.env.GARMENT_TAGGING_ENGINE?.trim() || 'fashion-clip',
        drainDelaySeconds: IDLE_DRAIN_DELAY_SECONDS,
      },
      `Dedicated wardrobe worker started, consuming ${workers.map((worker) => worker.name).join(', ')} at concurrency ${HOSTED_WORKER_CONCURRENCY}`
    )
  } catch (err) {
    logger.error(err, 'Failed to start dedicated wardrobe worker')
    await shutdown(1)
  }
}

/** Under the hosted launcher's 25-second deadline and Northflank's 30-second grace period. */
export const WARDROBE_SHUTDOWN_TIMEOUT_MS = 20_000

async function performShutdown(requestedExitCode = 0) {
  logger.info('Shutting down dedicated wardrobe worker...')
  let exitCode = requestedExitCode
  try {
    await shutdownWorkerResources(
      {
        workers,
        queues,
        redisClients,
        disconnectPrisma: disconnectPrismaClient,
      },
      { timeoutMs: WARDROBE_SHUTDOWN_TIMEOUT_MS }
    )
  } catch (err) {
    logger.error(err, 'Error closing wardrobe worker resources')
    exitCode = 1
  } finally {
    process.exit(exitCode)
  }
}

let shutdownPromise: Promise<void> | undefined

function shutdown(exitCode = 0): Promise<void> {
  shutdownPromise ??= performShutdown(exitCode)
  return shutdownPromise
}

/** The hosted launcher (`scripts/start-wardrobe-worker-production.mjs`) calls this on SIGTERM. */
export function shutdownWardrobeWorker(): Promise<void> {
  return shutdown()
}

if (require.main === module) {
  process.on('SIGTERM', () => void shutdown())
  process.on('SIGINT', () => void shutdown())

  void startWardrobeWorker()
}
