import 'reflect-metadata'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { PrismaClient } from '@prisma/client'
import { z } from 'zod'

// The fixture driver stays outside the measured process. Load the same compiled modules
// as the deployed worker so Vitest and its transforms cannot inflate the memory reading.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const load = (name) =>
  import(pathToFileURL(path.join(root, 'apps/api/dist/src', name)).href)
const configSchema = z
  .object({
    databaseUrl: z
      .string()
      .url()
      .refine((value) => /^\/tea_community_[a-f0-9]{32}$/.test(new URL(value).pathname)),
    queue: z.string().regex(/^comments-[a-f0-9-]{36}-measurement$/),
    objectPath: z.string().regex(/^synthetic-measurement\/[a-f0-9-]{36}\.jpg$/),
    imageBase64: z.string().max(10000),
    expected: z.literal(11),
  })
  .strict()

async function main() {
  if (!process.send) throw new Error('Measurement requires its fixture driver IPC')
  const config = configSchema.parse(
    await new Promise((resolve) => process.once('message', resolve))
  )
  const { TensorflowNsfwImageScreener } = await load(
    'modules/community/tensorflow-nsfw-image-screener.js'
  )
  const { DefaultCommunityModerationEngine } = await load(
    'modules/community/community-moderation.engine.js'
  )
  const { createCommunityModerationWorker } = await load(
    'modules/community/community-moderation.worker.js'
  )
  const { InMemoryCommunityStorage } = await load(
    'modules/community/community-storage.fake.js'
  )
  const { getRedisConfig, redisOptionsFromConfig } = await load('config/redis.js')
  const image = Buffer.from(config.imageBase64, 'base64')
  const storage = new InMemoryCommunityStorage()
  storage.put(config.objectPath, image)
  const prisma = new PrismaClient({ datasourceUrl: config.databaseUrl })
  const screener = new TensorflowNsfwImageScreener()
  let worker
  let report
  try {
    const coldStarted = performance.now()
    const readiness = await screener.ensureReady()
    const coldStartupMs = performance.now() - coldStarted
    const baseline = process.resourceUsage()
    const completions = []
    const completed = new Promise((resolve, reject) => {
      worker = createCommunityModerationWorker(
        {
          prisma,
          featureFlags: { getFeatureFlag: async () => true },
          storage,
          engine: new DefaultCommunityModerationEngine(screener),
          telemetryService: { captureEvent: async () => undefined },
        },
        { connection: redisOptionsFromConfig(getRedisConfig()) },
        config.queue
      )
      worker.on('error', reject)
      worker.on('failed', (_job, error) => reject(error))
      worker.on('completed', (job) => {
        completions.push({
          kind: job.name === 'community-comment-screening' ? 'comment' : 'image',
          elapsedMs: job.finishedOn - job.timestamp,
          processingMs: job.finishedOn - job.processedOn,
        })
        if (completions.length === config.expected) resolve()
      })
    })
    void completed.catch(() => undefined)
    await worker.waitUntilReady()
    process.send({ type: 'ready' })
    await completed
    const usage = process.resourceUsage()
    report = {
      type: 'report',
      executedFrom: 'compiled dist under plain node',
      coldStartupMs,
      backend: readiness.backend,
      modelHash: readiness.modelHash,
      imageSha256: createHash('sha256').update(image).digest('hex'),
      completions,
      cpuUserMs: (usage.userCPUTime - baseline.userCPUTime) / 1000,
      cpuSystemMs: (usage.systemCPUTime - baseline.systemCPUTime) / 1000,
    }
  } finally {
    await worker?.close()
    await screener.close()
    await prisma.$disconnect()
  }
  process.send({ ...report, peakProcessRssMiB: process.resourceUsage().maxRSS / 1024 })
}

const deadline = setTimeout(() => {
  console.error('compiled_comment_measurement_deadline')
  process.exit(1)
}, 55_000)
deadline.unref()
try {
  await main()
} catch (error) {
  console.error(
    'compiled_comment_measurement_failed',
    error instanceof Error ? error.name : 'unknown'
  )
  process.exitCode = 1
} finally {
  clearTimeout(deadline)
  process.disconnect?.()
}
