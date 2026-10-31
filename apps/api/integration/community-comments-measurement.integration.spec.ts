// Learning path Step 42: Screened threaded comments.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-42-screened-threaded-comments
import { randomUUID } from 'node:crypto'
import { fork } from 'node:child_process'
import { resolve } from 'node:path'
import { Queue, type Job } from 'bullmq'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { COMMUNITY_COMMENT_JOB } from '../src/modules/community/community-moderation.queue.js'
import modelManifest from '../model-manifests/community-nsfw-mobilenet-v2-mid-nsfwjs-4.3.0.json'
import { getRedisConfig, redisOptionsFromConfig } from '../src/config/redis.js'
import { commentsTestContext } from './helpers/community-comments-context.js'

const { prisma, database, namespace, input, fixture, create } = commentsTestContext()
const COMMENT_COUNT = 10

const reportSchema = z.object({
  type: z.literal('report'),
  executedFrom: z.literal('compiled dist under plain node'),
  coldStartupMs: z.number().nonnegative(),
  backend: z.literal('wasm'),
  modelHash: z.string().min(1),
  imageSha256: z.string().regex(/^[a-f0-9]{64}$/),
  completions: z
    .array(
      z.object({
        kind: z.enum(['image', 'comment']),
        elapsedMs: z.number().nonnegative(),
        processingMs: z.number().nonnegative(),
      })
    )
    .length(COMMENT_COUNT + 1),
  peakProcessRssMiB: z.number().positive(),
  cpuUserMs: z.number().nonnegative(),
  cpuSystemMs: z.number().nonnegative(),
})

function measuredWorker(config: {
  queue: string
  objectPath: string
  imageBase64: string
}) {
  const child = fork(
    resolve(__dirname, '../../../scripts/lib/community-comment-measurement-worker.mjs'),
    [],
    {
      execArgv: [],
      env: {
        ...process.env,
        NODE_OPTIONS: '',
        LOG_LEVEL: 'fatal',
        DISABLE_FILE_LOGS: 'true',
      },
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    }
  )
  let ready!: () => void
  let refuseReady!: (error: Error) => void
  const readiness = new Promise<void>((resolve, reject) => {
    ready = resolve
    refuseReady = reject
  })
  let report: z.infer<typeof reportSchema> | undefined
  const completed = new Promise<z.infer<typeof reportSchema>>((resolve, reject) => {
    child.on('message', (message: unknown) => {
      if (z.object({ type: z.literal('ready') }).safeParse(message).success) ready()
      const parsed = reportSchema.safeParse(message)
      if (parsed.success) report = parsed.data
    })
    child.on('error', (error) => {
      refuseReady(error)
      reject(error)
    })
    child.once('exit', (code) => {
      const error = new Error('Compiled measurement worker exited without complete proof')
      refuseReady(error)
      if (code === 0 && report) resolve(report)
      else reject(error)
    })
  })
  void completed.catch(() => undefined)
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()))
  child.send({ ...config, databaseUrl: database.url, expected: COMMENT_COUNT + 1 })
  return {
    readiness,
    completed,
    close: async () => {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
      await exited
    },
  }
}

describe('Story 6.4 mixed workload measurement', () => {
  // The mandatory CI lane enables this real-model test after building the worker.
  it.runIf(process.env.RUN_COMMENT_RESOURCE_MEASUREMENT === 'true')(
    'measures mixed real-model image/comment work on the existing single worker',
    async () => {
      const { writeFile, mkdir } = await import('node:fs/promises')
      const { createHash } = await import('node:crypto')
      const sharp = (await import('sharp')).default
      const { COMMUNITY_MODERATION_JOB, COMMUNITY_MODERATION_QUEUE } = await import(
        '../src/modules/community/community-moderation.queue.js'
      )
      const { COMMUNITY_MODERATION_CONCURRENCY } = await import(
        '../src/modules/community/community-moderation.worker.js'
      )
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
      const worker = measuredWorker({
        queue: queue.name,
        objectPath,
        imageBase64: bytes.toString('base64'),
      })
      try {
        await worker.readiness
        await queue.resume()
        const report = await worker.completed
        expect(
          await prisma.communityComment.count({
            where: { id: { in: pending.map((row) => row.id) }, status: 'published' },
          })
        ).toBe(COMMENT_COUNT)
        const budgets = {
          coldStartupMs: modelManifest.performance.absoluteCeilings.coldStartupMs,
          processingMs:
            modelManifest.performance.absoluteCeilings.outerScreeningCeilingMs,
          peakResidentMiB: modelManifest.performance.absoluteCeilings.peakResidentMib,
          // Fixed ten-comment fixture: ID plus generation, with room for Redis bookkeeping.
          commentPayloadBytes: 256,
          commentJobBytes: 1024,
        }
        expect(report.coldStartupMs).toBeLessThanOrEqual(budgets.coldStartupMs)
        expect(report.peakProcessRssMiB).toBeLessThanOrEqual(budgets.peakResidentMiB)
        expect(report.imageSha256).toBe(createHash('sha256').update(bytes).digest('hex'))
        expect(report.completions.map((row) => row.kind)).toEqual([
          'image',
          ...Array<string>(COMMENT_COUNT).fill('comment'),
        ])
        for (const row of report.completions)
          expect(row.processingMs).toBeLessThanOrEqual(budgets.processingMs)
        const payloadBytes = comments.map((job) =>
          Buffer.byteLength(JSON.stringify(job.data))
        )
        for (const size of payloadBytes)
          expect(size).toBeLessThanOrEqual(budgets.commentPayloadBytes)
        for (const size of jobBytes) {
          expect(size).toEqual(expect.any(Number))
          expect(size).toBeLessThanOrEqual(budgets.commentJobBytes)
        }
        const evidence = {
          profile:
            'CI regression measurement, compiled pinned model, real Redis/PostgreSQL, fixed image followed by ten fixed comments',
          queue: COMMUNITY_MODERATION_QUEUE,
          concurrency: COMMUNITY_MODERATION_CONCURRENCY,
          additionalWorkerProcesses: 0,
          budgets,
          commentJobBytes: jobBytes,
          commentPayloadBytes: payloadBytes,
          imageJobBytes: await redis.memory('USAGE', queue.toKey(imageJob.id!)),
          ...report,
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
      }
    },
    60_000
  )
})
