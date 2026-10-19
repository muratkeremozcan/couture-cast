import { randomUUID } from 'node:crypto'
import { Queue, type Job, type Worker } from 'bullmq'
import { describe, expect, it, vi } from 'vitest'
import { DefaultCommunityModerationEngine } from '../src/modules/community/community-moderation.engine.js'
import { createCommunityModerationWorker } from '../src/modules/community/community-moderation.worker.js'
import { COMMUNITY_COMMENT_JOB } from '../src/modules/community/community-moderation.queue.js'
import { InMemoryCommunityStorage } from '../src/modules/community/community-storage.fake.js'
import { getRedisConfig, redisOptionsFromConfig } from '../src/config/redis.js'
import { commentsTestContext } from './helpers/community-comments-context.js'

const { prisma, flags, namespace, input, fixture, create } = commentsTestContext()
const COMMENT_COUNT = 10

type Completion = { kind: string; elapsedMs: number; processingMs: number }

/** Resolve once the worker has completed `expected` jobs; reject on the first failure. */
function waitForCompletions(worker: Worker, expected: number): Promise<Completion[]> {
  const completions: Completion[] = []
  return new Promise((resolve, reject) => {
    worker.on('completed', (job) => {
      completions.push({
        kind: job.name === COMMUNITY_COMMENT_JOB ? 'comment' : 'image',
        elapsedMs: job.finishedOn! - job.timestamp,
        processingMs: job.finishedOn! - job.processedOn!,
      })
      if (completions.length === expected) resolve(completions)
    })
    worker.on('failed', (_job, error) => reject(error))
  })
}

describe('Story 6.4 mixed workload measurement', () => {
  // Opt-in developer-machine resource measurement with the real TensorFlow model, not a CI budget certificate; run `npm run community:screening:measure:comments`, which writes apps/api/.cache/community-screening/comments-mixed-workload.json.
  it.runIf(process.env.RUN_COMMENT_RESOURCE_MEASUREMENT === 'true')(
    'measures mixed real-model image/comment work on the existing single worker',
    async () => {
      const { writeFile, mkdir } = await import('node:fs/promises')
      const { createHash } = await import('node:crypto')
      const sharp = (await import('sharp')).default
      const { TensorflowNsfwImageScreener } = await import(
        '../src/modules/community/tensorflow-nsfw-image-screener.js'
      )
      const { COMMUNITY_MODERATION_JOB, COMMUNITY_MODERATION_QUEUE } = await import(
        '../src/modules/community/community-moderation.queue.js'
      )
      const { COMMUNITY_MODERATION_CONCURRENCY } = await import(
        '../src/modules/community/community-moderation.worker.js'
      )
      const screener = new TensorflowNsfwImageScreener()
      await screener.ensureReady()
      const realEngine = new DefaultCommunityModerationEngine(screener)
      const actor = await fixture(),
        image = await fixture()
      const bytes = await sharp({
        create: { width: 512, height: 512, channels: 3, background: '#b0a090' },
      })
        .jpeg()
        .toBuffer()
      const objectPath = `synthetic-measurement/${randomUUID()}.jpg`
      await prisma.lookbookPost.update({
        where: { id: image.postId },
        data: {
          status: 'pending_review',
          image_object_path: objectPath,
          image_byte_size: bytes.length,
          image_content_type: 'image/jpeg',
          image_checksum: createHash('sha256').update(bytes).digest('hex'),
        },
      })
      const storage = new InMemoryCommunityStorage()
      storage.put(objectPath, bytes)
      const pending: Awaited<ReturnType<typeof create>>[] = []
      for (let index = 0; index < COMMENT_COUNT; index++)
        pending.push(
          await create(
            actor.userId,
            actor.postId,
            input(`Synthetic rainy day layers ${index}.`)
          )
        )
      const connection = redisOptionsFromConfig(getRedisConfig())
      const queue = new Queue(`${namespace}-measurement`, { connection })
      await queue.pause()
      const imageJob = await queue.add(COMMUNITY_MODERATION_JOB, {
        postId: image.postId,
        uploadSessionId: randomUUID(),
        platform: 'web',
      })
      const comments: Job[] = []
      for (const comment of pending)
        comments.push(
          await queue.add(COMMUNITY_COMMENT_JOB, { commentId: comment.id, generation: 0 })
        )
      const redis = await queue.client
      const jobBytes = await Promise.all(
        comments.map((job) => redis.memory('USAGE', queue.toKey(job.id!)))
      )
      const baseline = process.resourceUsage()
      const worker = createCommunityModerationWorker(
        {
          prisma,
          featureFlags: flags,
          storage,
          engine: realEngine,
          telemetryService: { captureEvent: vi.fn() } as never,
        },
        { connection },
        queue.name
      )
      try {
        const complete = waitForCompletions(worker, COMMENT_COUNT + 1)
        await worker.waitUntilReady()
        await queue.resume()
        const completions = await complete
        expect(
          await prisma.communityComment.count({
            where: { id: { in: pending.map((row) => row.id) }, status: 'published' },
          })
        ).toBe(COMMENT_COUNT)
        const usage = process.resourceUsage()
        const evidence = {
          profile:
            'developer machine, real pinned TensorFlow model, real Redis/PostgreSQL, one image followed by ten text comments; Vitest process RSS',
          queue: COMMUNITY_MODERATION_QUEUE,
          concurrency: COMMUNITY_MODERATION_CONCURRENCY,
          additionalWorkerProcesses: 0,
          commentJobBytes: jobBytes,
          commentPayloadBytes: comments.map((job) =>
            Buffer.byteLength(JSON.stringify(job.data))
          ),
          imageJobBytes: await redis.memory('USAGE', queue.toKey(imageJob.id!)),
          completions,
          peakProcessRssMiB: usage.maxRSS / 1024,
          cpuUserMs: (usage.userCPUTime - baseline.userCPUTime) / 1000,
          cpuSystemMs: (usage.systemCPUTime - baseline.systemCPUTime) / 1000,
        }
        await mkdir('.cache/community-screening', { recursive: true })
        await writeFile(
          '.cache/community-screening/comments-mixed-workload.json',
          JSON.stringify(evidence, null, 2) + '\n'
        )
        console.info('comment_mixed_workload_evidence', evidence)
      } finally {
        await worker.close()
        await queue.obliterate({ force: true })
        await queue.close()
        await screener.close()
      }
    },
    60_000
  )
})
