import '../load-env'
import path from 'node:path'
import type { Queue, Worker } from 'bullmq'
import { allowsTestOnlySecrets } from '../config/runtime-environment'
import { createQueues } from '../config/queues'
import { createBaseLogger } from '../logger/pino.config.js'
import { FashionClipTaggingEngine } from '../modules/wardrobe/fashion-clip-tagging.engine'
import { FixtureGarmentTaggingEngine } from '../modules/wardrobe/fixture-garment-tagging.engine'
import type { GarmentTaggingEngine } from '../modules/wardrobe/garment-tagging.engine'
import { garmentColorProcessingJobSchema } from '../modules/wardrobe/wardrobe-processing.queue'
import { WardrobeColorProcessor } from '../modules/wardrobe/wardrobe-color.processor'
import { SupabaseWardrobeStorageAdapter } from '../modules/wardrobe/wardrobe-storage.adapter'
import { createWorker, defaultWorkerOptions } from './base.worker'
import { disconnectPrismaClient, getPrismaClient } from './prisma'
import { shutdownWorkerResources } from './shutdown-resources'

const logger = createBaseLogger().child({ feature: 'wardrobe-worker' })
const workers: Worker[] = []
const queues: Queue[] = []

export async function createTaggingEngine(): Promise<GarmentTaggingEngine> {
  const requestedEngine = process.env.GARMENT_TAGGING_ENGINE?.trim() || 'fashion-clip'
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
  const engine = new FashionClipTaggingEngine(configuredModelDir)
  await engine.ensureReady()
  logger.info({ engine: requestedEngine }, 'Garment tagging engine is ready')
  return engine
}

async function startWardrobeWorker() {
  try {
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
        {
          ...defaultWorkerOptions(1),
        }
      )
    )

    logger.info('Dedicated wardrobe worker started for color-extraction at concurrency 1')
  } catch (err) {
    logger.error(err, 'Failed to start dedicated wardrobe worker')
    process.exit(1)
  }
}

async function performShutdown() {
  logger.info('Shutting down dedicated wardrobe worker...')
  let exitCode = 0
  try {
    await shutdownWorkerResources({
      workers,
      queues,
      redisClients: [],
      disconnectPrisma: disconnectPrismaClient,
    })
  } catch (err) {
    logger.error(err, 'Error closing wardrobe worker resources')
    exitCode = 1
  } finally {
    process.exit(exitCode)
  }
}

let shutdownPromise: Promise<void> | undefined

function shutdown(): Promise<void> {
  shutdownPromise ??= performShutdown()
  return shutdownPromise
}

if (require.main === module) {
  process.on('SIGTERM', () => void shutdown())
  process.on('SIGINT', () => void shutdown())

  void startWardrobeWorker()
}
