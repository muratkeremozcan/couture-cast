// Learning path Step 40: Community screening release gate and hosted worker.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-40-community-screening-release-gate-and-hosted-worker
// Story 6.2b review (RF13): a worker that dies while a job is screening.
//
// The restart drill proves a job queued while no worker ran completes once one
// comes back. It does not cover a job that was ACTIVE when its worker died: that
// job holds a lock, no worker will take it until the lock expires and a stalled
// check returns it to `waiting`, and meanwhile the stale-review sweep fails any
// post still in `pending_review` 15 minutes after it got there. With the
// stalled check at 600 seconds the job could come back after the sweep had
// already failed its post.
//
// This runs the real recovery path against real Redis and PostgreSQL: a child
// process takes the job with the community worker's options and is killed with
// SIGKILL mid-screening, then a new worker built by
// `createCommunityModerationWorker` with the same options must finish the post
// before the sweep would have fired. Every duration that decides recovery (the
// lock, the stalled check and the sweep deadline) is scaled down by the same
// factor through the worker's options; the idle block stays at its production
// 300 seconds, so the test also shows that a requeued job wakes a blocked
// worker.
import 'reflect-metadata'
import { spawn, type ChildProcess } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import path from 'node:path'
import { PrismaClient } from '@prisma/client'
import { Queue, type Worker } from 'bullmq'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { buildLookbookPostCreateInput, createLookbookPost } from '@couture/testing'
import type { TelemetryService } from '../src/modules/telemetry/telemetry.service.js'
import { FixtureCommunityModerationEngine } from '../src/modules/community/community-moderation.engine.js'
import { InMemoryCommunityStorage } from '../src/modules/community/community-storage.fake.js'
import { STALE_PENDING_REVIEW_MINUTES } from '../src/modules/community/community-maintenance.service.js'
import { buildCommunityModerationJobId } from '../src/modules/community/community-moderation.queue.js'
import {
  COMMUNITY_MODERATION_LOCK_DURATION_MS,
  COMMUNITY_MODERATION_STALLED_INTERVAL_MS,
  communityModerationWorkerOptions,
  createCommunityModerationWorker,
} from '../src/modules/community/community-moderation.worker.js'
import { getRedisConfig, redisOptionsFromConfig } from '../src/config/redis.js'
import { disconnectPrismaClient } from '../src/workers/prisma.js'

const databaseUrl =
  process.env.INTEGRATION_TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
const telemetry = {
  captureEvent: vi.fn().mockResolvedValue(undefined),
} as unknown as TelemetryService

/** Production durations divided by this run the same race 60 times faster. */
const SCALE = 60
const lockDuration = COMMUNITY_MODERATION_LOCK_DURATION_MS / SCALE
const stalledInterval = COMMUNITY_MODERATION_STALLED_INTERVAL_MS / SCALE
const sweepDeadlineMs = (STALE_PENDING_REVIEW_MINUTES * 60_000) / SCALE

const namespace = `community-crash-${randomUUID().slice(0, 8)}`
const queueName = `${namespace}-moderation`
const crashWorkerScript = path.join(__dirname, 'support/community-crash-worker.mjs')

let schemaReady = false

async function probeSchema(): Promise<void> {
  try {
    await prisma.$queryRaw`SELECT 1 FROM "LookbookPost" LIMIT 1`
    await prisma.$queryRaw`SELECT 1 FROM "CommunityModerationOutbox" LIMIT 1`
    schemaReady = true
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn(
      '[community-moderation-crash-recovery] Skipped: could not query the community schema. Underlying error:',
      error
    )
  }
}

/** A post in `pending_review` whose bytes are in the storage double. */
async function createPendingPost(storage: InMemoryCommunityStorage) {
  const jpegBytes = await sharp({
    create: { width: 512, height: 640, channels: 3, background: '#c8b4a0' },
  })
    .jpeg()
    .toBuffer()
  const user = await prisma.user.create({
    data: {
      email: `${namespace}-${randomUUID().slice(0, 8)}@synthetic.test`,
      profile: {
        create: {
          birthdate: new Date('1990-01-01'),
          preferences: { compliance: { accountStatus: 'active' } },
        },
      },
    },
  })
  const postId = `crash-${randomUUID()}`
  const uploadSessionId = randomUUID()
  const objectPath = `community/${postId}/${uploadSessionId}.jpg`
  const fixture = createLookbookPost({
    id: postId,
    userId: user.id,
    status: 'pending_review',
    caption: 'A camel coat for a cold morning',
    altText: 'Full length photo of a camel coat outfit',
    imageObjectPath: objectPath,
    imageContentType: 'image/jpeg',
    imageChecksum: createHash('sha256').update(jpegBytes).digest('hex'),
    imageByteSize: jpegBytes.length,
    publishedAt: null,
    submittedAt: new Date(),
  })
  await prisma.lookbookPost.create({ data: buildLookbookPostCreateInput(fixture) })
  storage.put(objectPath, jpegBytes)
  return { postId, uploadSessionId }
}

/** Resolves with the first stdout line from `child` that starts with `prefix`. */
function lineFrom(child: ChildProcess, prefix: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let buffered = ''
    child.stdout?.on('data', (chunk: Buffer) => {
      buffered += chunk.toString('utf8')
      const line = buffered.split('\n').find((candidate) => candidate.startsWith(prefix))
      if (line) resolve(line)
    })
    child.once('exit', (code) =>
      reject(new Error(`crash worker exited (${String(code)}) before "${prefix}"`))
    )
  })
}

beforeAll(probeSchema)

afterAll(async () => {
  if (schemaReady) {
    const owned = { user: { email: { startsWith: namespace } } }
    await prisma.moderationEvent.deleteMany({ where: { post: owned } })
    await prisma.communityModerationOutbox.deleteMany({ where: { post: owned } })
    await prisma.lookbookPost.deleteMany({ where: owned })
    await prisma.communityAlias.deleteMany({ where: owned })
    await prisma.userProfile.deleteMany({
      where: { user: { email: { startsWith: namespace } } },
    })
    await prisma.user.deleteMany({ where: { email: { startsWith: namespace } } })
    await prisma.jobFailure.deleteMany({ where: { queue_name: queueName } })
  }
  await prisma.$disconnect()
  await disconnectPrismaClient()
})

describe('6.2b community moderation crash recovery', () => {
  let queue: Queue | undefined
  let worker: Worker | undefined
  let crashed: ChildProcess | undefined

  afterAll(async () => {
    crashed?.kill('SIGKILL')
    await worker?.close()
    await queue?.obliterate({ force: true }).catch(() => undefined)
    await queue?.close()
  })

  it('6.2b-INT-001 finishes a job whose worker was killed mid-screening before the stale-review sweep', async (context) => {
    if (!schemaReady) {
      context.skip()
      return
    }
    // The ordering the production numbers guarantee, at test scale.
    expect(stalledInterval).toBeGreaterThanOrEqual(lockDuration)
    const connection = redisOptionsFromConfig(getRedisConfig())
    const scaled = { connection, lockDuration, stalledInterval }
    const storage = new InMemoryCommunityStorage()
    const { postId, uploadSessionId } = await createPendingPost(storage)

    queue = new Queue(queueName, { connection })
    crashed = spawn(
      process.execPath,
      [
        crashWorkerScript,
        queueName,
        JSON.stringify(communityModerationWorkerOptions(scaled)),
      ],
      { stdio: ['ignore', 'pipe', 'inherit'] }
    )
    await lineFrom(crashed, 'ready')
    const jobId = buildCommunityModerationJobId(postId, uploadSessionId)
    await queue.add(
      'community-moderation-screening',
      { postId, uploadSessionId },
      { jobId, attempts: 3, backoff: { type: 'exponential', delay: 1000 } }
    )
    await lineFrom(crashed, `screening ${jobId}`)

    // The worker dies holding the job: no completion, no failure, no unlock.
    const exited = new Promise((resolve) => crashed?.once('exit', resolve))
    crashed.kill('SIGKILL')
    await exited
    const crashedAt = Date.now()
    expect(await queue.getJobState(jobId)).toBe('active')

    worker = createCommunityModerationWorker(
      {
        prisma,
        storage,
        telemetryService: telemetry,
        featureFlags: { getFeatureFlag: () => Promise.resolve(true) } as never,
        engine: new FixtureCommunityModerationEngine({
          textOutcome: { passed: true, reasons: [] },
          imageOutcome: { passed: true, reasons: [], disposition: 'pass' },
        }),
      },
      scaled,
      queueName
    )
    const completed = new Promise<number>((resolve) =>
      worker?.on('completed', (job) => {
        if (job.id === jobId) resolve(Date.now())
      })
    )

    const completedAt = await Promise.race([
      completed,
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error('the job did not complete inside the scaled sweep')),
          sweepDeadlineMs
        )
      ),
    ])
    expect(completedAt - crashedAt).toBeLessThan(sweepDeadlineMs)
    const post = await prisma.lookbookPost.findUniqueOrThrow({ where: { id: postId } })
    expect(post.status).toBe('published')
    // The stall did not use up an attempt.
    expect((await queue.getJob(jobId))?.attemptsMade).toBe(1)
  }, 60_000)
})
