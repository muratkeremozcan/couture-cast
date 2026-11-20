// Story 4.4 Task 8 step 1 owner: real-PostgreSQL and real-Redis integration coverage in apps/api/integration/wardrobe-silhouette.integration.spec.ts
// Learning path Step 32: Wardrobe onboarding and silhouette setup.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-32-wardrobe-onboarding-and-silhouette-setup
// Learning path Step 58: Image uploads straight to storage.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#image-uploads-straight-to-storage
import 'reflect-metadata'
import { createHash, randomUUID } from 'node:crypto'
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  onTestFinished,
} from 'vitest'
import { PrismaClient } from '@prisma/client'
import {
  ConflictException,
  ForbiddenException,
  HttpException,
  PreconditionFailedException,
  UnprocessableEntityException,
} from '@nestjs/common'
import { Queue, Worker } from 'bullmq'
import IORedis from 'ioredis'
import sharp from 'sharp'
import { queueConfigs } from '../src/config/queues.js'
import { getRedisConfig, redisOptionsFromConfig } from '../src/config/redis.js'
import {
  formatSilhouetteETag,
  WardrobeSilhouetteService,
} from '../src/modules/wardrobe/wardrobe-silhouette.service.js'
import type { GuardianService } from '../src/modules/guardian/guardian.service.js'
import {
  buildSilhouettePhotoJobId,
  SILHOUETTE_PHOTO_PROCESSING_QUEUE,
  SilhouettePhotoProcessingQueue,
  silhouettePhotoProcessingJobSchema,
  silhouetteSessionFromJobId,
} from '../src/modules/wardrobe/silhouette-photo-processing.queue.js'
import { SilhouettePhotoProcessor } from '../src/modules/wardrobe/silhouette-photo.processor.js'
import {
  WARDROBE_OBJECT_CACHE_CONTROL,
  type BoundedDownload,
  type StagedUploadPage,
  type WardrobeStorage,
  type WardrobeUploadSession,
} from '../src/modules/wardrobe/wardrobe-storage.adapter.js'
import {
  STAGED_UPLOAD_RETENTION_MS,
  WardrobeRetentionService,
} from '../src/modules/wardrobe/wardrobe-retention.service.js'
import type { SilhouettePhotoModerationEngine } from '../src/modules/wardrobe/silhouette-photo-moderation.engine.js'
import { WardrobeObjectDeletionOutbox } from '../src/modules/wardrobe/wardrobe-object-deletion.outbox.js'
import {
  AMBIGUOUS_PUBLICATION_HORIZON_MS,
  REPEATING_REMOVAL_INTERVAL_MS,
} from '../src/modules/wardrobe/wardrobe-publication.js'
import { deleteMembers } from './helpers/privacy-guards.js'

/**
 * Real-PostgreSQL (and, for the moderation-review handoff, real Redis)
 * coverage for the silhouette sliders and "My Form" pipeline.
 *
 * Risk 4.4-R01: two live consumers on moderation-review would silently drop
 * a fraction of jobs. The `4.4-INT-15` case runs one real BullMQ Worker
 * against a real queue and proves the job is actually processed end-to-end
 * (the row transitions), not just enqueued. The queue carries a per-run name
 * for the reason given at `queueName` below.
 *
 * Risk 4.4-R02: revision-precondition races, same technique as the
 * onboarding suite (two Prisma connections, real advisory-lock
 * serialization).
 */

const databaseUrl =
  process.env.INTEGRATION_TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

const prismaA = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
const prismaB = new PrismaClient({ datasources: { db: { url: databaseUrl } } })

let schemaReady = false

async function probeSchema(): Promise<void> {
  try {
    await prismaA.$queryRaw`SELECT 1`
    await prismaA.$queryRaw`SELECT 1 FROM "SilhouetteProfile" LIMIT 1`
    schemaReady = true
  } catch {
    schemaReady = false
    // eslint-disable-next-line no-console
    console.warn(
      '[wardrobe-silhouette.integration] Skipped: PostgreSQL is missing the Story 4.4 schema. ' +
        'Run `npm run db:migrate` to execute this suite.'
    )
  }
}

function requireSchema(context: { skip: () => void }): boolean {
  if (!schemaReady) {
    context.skip()
    return false
  }
  return true
}

/**
 * THE QUEUE NAME IS PER RUN, not the production `moderation-review`.
 *
 * BullMQ hands a job to whichever Worker subscribed to the queue name claims it
 * first, in any process on the Redis, and this suite shares its local Redis
 * with the end-to-end stack: `start-api-e2e-with-workers.mjs` starts
 * `wardrobe.bootstrap.js`, which consumes `moderation-review` at concurrency 10
 * with the real Supabase storage adapter. Measured on 2026-09-08 with that
 * worker live alongside this file: it claimed the jobs first, `4.4-INT-17`'s
 * drain never saw its job complete and failed on its 10 s hook timeout, and
 * `4.4-INT-15` took 3,156 ms in place of ~100 ms because it only got the job
 * back on BullMQ's second retry. Alone, the file passes in under a second,
 * which is why this read as a load flake. The community pipeline suite
 * namespaces its queue for the same reason; this suite now does too, through
 * the producer's own binding seam so `4.4-INT-18` still exercises the real
 * `enqueue`.
 *
 * `wardrobe.bootstrap.spec.ts` keeps the production fact this name used to
 * carry: exactly one consumer is registered on `moderation-review`.
 */
const QUEUE_NAME_PREFIX = 'silhouette-it-'
const QUEUE_NAME_SUFFIX = `-${SILHOUETTE_PHOTO_PROCESSING_QUEUE}`
const namespace = `${QUEUE_NAME_PREFIX}${randomUUID().slice(0, 8)}`
const queueName = `${namespace}${QUEUE_NAME_SUFFIX}`
const redisOptions = redisOptionsFromConfig(getRedisConfig())

function productionQueueOptions() {
  const found = queueConfigs.find((c) => c.name === SILHOUETTE_PHOTO_PROCESSING_QUEUE)
  if (!found) throw new Error('moderation-review queue configuration is missing')
  return found.options
}

/**
 * Redis is not scoped per run: a per-run queue that a killed or timed-out run
 * never obliterated stays in Redis for good, and because nothing would ever
 * look for it again it would accumulate silently. `afterAll` is the primary
 * cleanup; this reaps what an earlier run left behind, so the suite heals
 * itself the way `community-lifecycle`'s `reapPreviousRuns` does for rows.
 *
 * Scoped to this suite's own naming scheme and nothing else: the SCAN pattern
 * carries both the prefix and the suffix, and the current run's name is
 * excluded, so it cannot reach a production queue or another suite's.
 */
async function reapPreviousRunQueues(): Promise<void> {
  const redis = new IORedis(redisOptions)
  try {
    const stale = new Set<string>()
    let cursor = '0'
    do {
      const [next, keys] = await redis.scan(
        cursor,
        'MATCH',
        `bull:${QUEUE_NAME_PREFIX}*${QUEUE_NAME_SUFFIX}:meta`,
        'COUNT',
        200
      )
      cursor = next
      for (const key of keys) {
        const name = key.slice('bull:'.length, -':meta'.length)
        if (name !== queueName) stale.add(name)
      }
    } while (cursor !== '0')

    for (const name of stale) {
      const queue = new Queue(name, { connection: redisOptions })
      try {
        await queue.obliterate({ force: true })
      } finally {
        await queue.close().catch(() => undefined)
      }
    }
  } catch (error) {
    // Never let tidying up fail `beforeAll` itself: that would take down all
    // nine cases, including the six that need no Redis at all.
    // eslint-disable-next-line no-console
    console.warn(
      '[wardrobe-silhouette.integration] Could not reap queues left by earlier runs.',
      error
    )
  } finally {
    await redis.quit().catch(() => undefined)
  }
}

/**
 * Any test that enqueues a job (any successful `commitMyForm`) drains it before
 * finishing, so the job is processed by THIS file's storage double rather than
 * left for whichever Worker in this file comes up next. This starts one
 * short-lived real `Worker`, waits for the specific profile's job to complete,
 * and closes.
 */
async function drainModerationJob(
  prisma: PrismaClient,
  storage: WardrobeStorage,
  profileId: string
): Promise<void> {
  const engine: SilhouettePhotoModerationEngine = {
    moderate: () => Promise.resolve({ outcome: 'ready' as const }),
  }
  const processor = new SilhouettePhotoProcessor(prisma, storage, engine)

  const worker = new Worker<{ silhouetteProfileId: string }>(
    queueName,
    async (job) => {
      const data = silhouettePhotoProcessingJobSchema.parse(job.data)
      await processor.process(
        data.silhouetteProfileId,
        silhouetteSessionFromJobId({ id: job.id, data })
      )
    },
    { connection: redisOptions, concurrency: 1 }
  )

  let lastConnectionError: unknown
  // BullMQ swallows an unhandled 'error' into console.error, and this
  // repo's Redis config sets maxRetriesPerRequest: null, so a down Redis
  // never rejects -- it just hangs until the timeout below fires with no
  // clue why. Capture the last error so the timeout message says something
  // useful instead of a bare "job did not complete in time".
  worker.on('error', (error) => {
    lastConnectionError = error
  })

  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(
          lastConnectionError instanceof Error
            ? new Error(`job did not complete in time: ${lastConnectionError.message}`)
            : new Error('job did not complete in time')
        )
      }, 10_000)
      worker.on('completed', (job) => {
        if (job.data.silhouetteProfileId === profileId) {
          clearTimeout(timeout)
          resolve()
        }
      })
      // Filter on the same profile the `completed` handler does: this Worker
      // is a consumer on a shared queue, so a stray job's failure must not
      // be reported as this test's failure. Also wait for the final retry
      // attempt (defaultJobOptions configures attempts: 3 with backoff) --
      // 'failed' fires on every attempt, and rejecting on attempt 1 would
      // abandon a job BullMQ has already re-queued into 'delayed', leaking
      // it right back into Redis for the next run to trip over.
      worker.on('failed', (job, err) => {
        if (job?.data.silhouetteProfileId !== profileId) return
        const attempts = job.opts.attempts ?? 1
        if (job.attemptsMade < attempts) return
        clearTimeout(timeout)
        reject(err)
      })
    })
  } finally {
    await worker.close()
  }
}

class StubGuardianService {
  allowed = true
  assertWardrobeUploadAllowed(): Promise<void> {
    if (!this.allowed) {
      return Promise.reject(new ForbiddenException('GUARDIAN_CONSENT_REQUIRED'))
    }
    return Promise.resolve()
  }
}

/**
 * Storage the way Supabase serves a signed upload in round 4: one object per signed URL, signed
 * without upsert (the first write to a staging key wins, a repeated PUT is refused as a
 * duplicate, and an occupied key cannot be signed again), and a token that keeps working after
 * its object is removed. The client PUTs to the URL allocation hands out (`clientPut`), never
 * through the API; commit reads the staged object back through the byte ceiling, verifies it and
 * writes the verified buffer to the final path itself (`publish`), with server-owned metadata.
 *
 * Round 4 hooks let a test hold a commit inside its storage I/O: `beforeDownload` and
 * `beforePublish` run first and may block, and `publishAnswerLost` makes a publish that landed
 * answer with an error, the way a dropped acknowledgement does.
 */
class MemoryWardrobeStorage implements WardrobeStorage {
  uploaded = new Map<string, Buffer>()
  removed: string[] = []
  /** What `publish` wrote: the server-owned type and cache policy of each final object. */
  readonly published = new Map<string, { contentType: string; cacheControl: string }>()
  readonly createdAt = new Map<string, Date>()
  private readonly signedPaths = new Map<string, string>()
  downloads = 0
  publishes = 0
  beforeDownload: (() => Promise<void>) | null = null
  beforePublish: (() => Promise<void>) | null = null
  publishAnswerLost = false

  createUploadSession(objectPath: string): Promise<WardrobeUploadSession> {
    if (this.uploaded.has(objectPath)) {
      return Promise.reject(new ConflictException('UPLOAD_BYTES_PRESENT'))
    }
    const uploadUrl = `https://storage.test/storage/v1/object/upload/sign/wardrobe-images/${objectPath}?token=${randomUUID()}`
    this.signedPaths.set(uploadUrl, objectPath)
    return Promise.resolve({
      uploadUrl,
      uploadToken: randomUUID(),
      tokenExpiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
    })
  }
  /** A client PUT of `bytes` to a signed upload URL; a key that holds bytes refuses it. */
  clientPut(uploadUrl: string, bytes: Buffer): Promise<void> {
    const objectPath = this.signedPaths.get(uploadUrl)
    if (!objectPath) return Promise.reject(new Error('upload URL was never signed'))
    if (this.uploaded.has(objectPath)) return Promise.reject(new Error('Duplicate'))
    this.uploaded.set(objectPath, bytes)
    this.createdAt.set(objectPath, new Date())
    return Promise.resolve()
  }
  async publish(objectPath: string, bytes: Buffer, contentType: string): Promise<void> {
    this.publishes += 1
    if (this.beforePublish) await this.beforePublish()
    this.uploaded.set(objectPath, Buffer.from(bytes))
    this.createdAt.set(objectPath, new Date())
    this.published.set(objectPath, {
      contentType,
      cacheControl: WARDROBE_OBJECT_CACHE_CONTROL,
    })
    if (this.publishAnswerLost) throw new Error('publish acknowledgement lost')
  }
  publishOnce(
    objectPath: string,
    bytes: Buffer,
    contentType: string
  ): Promise<'created' | 'exists'> {
    if (this.uploaded.has(objectPath)) return Promise.resolve('exists')
    this.uploaded.set(objectPath, Buffer.from(bytes))
    this.createdAt.set(objectPath, new Date())
    this.published.set(objectPath, {
      contentType,
      cacheControl: WARDROBE_OBJECT_CACHE_CONTROL,
    })
    return Promise.resolve('created')
  }
  listStagedUploads(
    limit: number,
    cursor: string | null = null
  ): Promise<StagedUploadPage> {
    const staged = [...this.uploaded.keys()]
      .filter((objectPath) => objectPath.startsWith('staging/'))
      .map((objectPath) => ({ objectPath, createdAt: this.createdAt.get(objectPath)! }))
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    const start = cursor ? Number(cursor) : 0
    const objects = staged.slice(start, start + limit)
    const next = start + objects.length
    return Promise.resolve({
      objects,
      nextCursor: next < staged.length ? String(next) : null,
    })
  }
  download(objectPath: string): Promise<Buffer> {
    const bytes = this.uploaded.get(objectPath)
    if (!bytes) return Promise.reject(new Error(`no stored bytes for ${objectPath}`))
    return Promise.resolve(bytes)
  }
  async downloadBounded(objectPath: string, maxBytes: number): Promise<BoundedDownload> {
    this.downloads += 1
    if (this.beforeDownload) await this.beforeDownload()
    const bytes = this.uploaded.get(objectPath)
    if (!bytes) return { status: 'missing' }
    if (bytes.length > maxBytes) return { status: 'too_large' }
    return { status: 'present', bytes }
  }
  remove(objectPaths: string[]): Promise<void> {
    this.removed.push(...objectPaths)
    for (const path of objectPaths) this.uploaded.delete(path)
    return Promise.resolve()
  }
  signReadUrl(objectPath: string): Promise<string> {
    return Promise.resolve(`https://storage.test/${objectPath}`)
  }
}

/**
 * A real, decodable portrait photo: commit now verifies the stored bytes (size, sniffed type,
 * sha256, dimensions, portrait framing) before anything is enqueued.
 */
async function portraitPhoto(): Promise<{
  bytes: Buffer
  declaration: {
    fileSizeBytes: number
    mimeType: 'image/png'
    sha256: string
    widthPx: number
    heightPx: number
  }
}> {
  const bytes = await sharp({
    create: {
      width: 300,
      height: 800,
      channels: 3,
      background: { r: 200, g: 210, b: 220 },
    },
  })
    .png()
    .toBuffer()
  return {
    bytes,
    declaration: {
      fileSizeBytes: bytes.length,
      mimeType: 'image/png',
      sha256: createHash('sha256').update(bytes).digest('hex'),
      widthPx: 300,
      heightPx: 800,
    },
  }
}

/**
 * Every job this suite enqueues is removed again before the test ends: BullMQ
 * retains completed jobs for `JOB_RETENTION_SECONDS` (7 days), and a leftover
 * job is picked up by the next test's worker, which subscribes to the queue
 * name rather than to a single job.
 */
async function removeModerationJob(jobId: string): Promise<void> {
  const queue = new Queue(queueName, { connection: redisOptions })
  try {
    await queue.remove(jobId)
  } finally {
    await queue.close()
  }
}

describe('4.4 wardrobe silhouette against real PostgreSQL', () => {
  let userId: string
  let guardian: StubGuardianService
  let storage: MemoryWardrobeStorage
  let queue: SilhouettePhotoProcessingQueue
  let serviceA: WardrobeSilhouetteService
  let serviceB: WardrobeSilhouetteService

  beforeAll(async () => {
    await probeSchema()
    if (schemaReady) await reapPreviousRunQueues()
  })

  beforeEach(async () => {
    if (!schemaReady) return

    const user = await prismaA.user.create({
      data: { email: `${namespace}-${randomUUID().slice(0, 8)}@synthetic.test` },
    })
    userId = user.id

    guardian = new StubGuardianService()
    storage = new MemoryWardrobeStorage()
    // The production job options (attempts, backoff, retention) on a per-run
    // name: `4.4-INT-15`'s retry gate and `4.4-INT-18`'s dedupe both read them.
    queue = new SilhouettePhotoProcessingQueue({
      name: queueName,
      options: productionQueueOptions(),
    })
    serviceA = new WardrobeSilhouetteService(
      prismaA,
      guardian as unknown as GuardianService,
      storage as unknown as never,
      queue
    )
    serviceB = new WardrobeSilhouetteService(
      prismaB,
      guardian as unknown as GuardianService,
      storage as unknown as never,
      queue
    )
  })

  afterAll(async () => {
    if (!schemaReady) {
      await prismaA.$disconnect()
      await prismaB.$disconnect()
      return
    }
    // The per-run queue's keys would otherwise outlive the run in Redis.
    const ownQueue = new Queue(queueName, { connection: redisOptions })
    try {
      await ownQueue.obliterate({ force: true })
    } finally {
      await ownQueue.close().catch(() => undefined)
    }
    await prismaA.$disconnect()
    await prismaB.$disconnect()
  })

  afterEach(async () => {
    if (!schemaReady) return
    // `beforeEach` constructs a fresh queue per test; `getQueue()` lazily
    // opens a real ioredis connection on first `enqueue`, and nothing else
    // in this file (there is no Nest module here) ever calls
    // `onModuleDestroy()` to close it.
    await queue.onModuleDestroy()
    await prismaA.moderationEvent.deleteMany({
      where: { silhouette_profile: { user: { email: { contains: namespace } } } },
    })
    await prismaA.eventEnvelope.deleteMany({
      where: { user: { email: { contains: namespace } } },
    })
    await prismaA.silhouetteProfile.deleteMany({
      where: { user: { email: { contains: namespace } } },
    })
    await prismaA.guardianConsent.deleteMany({
      where: { teen: { email: { contains: namespace } } },
    })
    await deleteMembers(prismaA, { email: { contains: namespace } })
  })

  // Numbered 19, not 10: the onboarding suite's `4.4-INT-10` (crash-replay
  // telemetry) already owns that id, and both suites share the same
  // `4.4-INT-*` id space referenced from the story's dev agent record and
  // any test-ID-based traceability tooling -- two different tests claiming
  // the same id is a real collision, not just a cosmetic clash.
  it('4.4-INT-19 returns the virtual default profile with no persisted row', async (context) => {
    if (!requireSchema(context)) return

    const { response, etag } = await serviceA.getProfile(userId)
    expect(response.data).toEqual({
      mode: 'default_mannequin',
      heightSlider: null,
      buildSlider: null,
      myForm: null,
      revision: 0,
      updatedAt: new Date(0).toISOString(),
    })
    expect(etag).toBe(formatSilhouetteETag(userId, 0))

    // Proves the "no persisted row" half of this test's own name against the
    // real database, not just the service's virtual-default return value --
    // mirrors the onboarding suite's `4.4-INT-01` sibling assertion.
    const row = await prismaA.silhouetteProfile.findUnique({ where: { user_id: userId } })
    expect(row).toBeNull()
  })

  it('4.4-INT-11 saves sliders, always reverting mode to default_mannequin', async (context) => {
    if (!requireSchema(context)) return

    const created = await serviceA.updateSliders(
      userId,
      formatSilhouetteETag(userId, 0),
      {
        heightSlider: 40,
        buildSlider: 60,
      }
    )
    expect(created.response.data).toMatchObject({
      mode: 'default_mannequin',
      heightSlider: 40,
      buildSlider: 60,
      revision: 1,
    })

    const replay = await serviceA.updateSliders(userId, formatSilhouetteETag(userId, 1), {
      heightSlider: 40,
      buildSlider: 60,
    })
    expect(replay.isNoOp).toBe(true)
    expect(replay.response.data.revision).toBe(1)
  })

  it('4.4-INT-12 rejects a stale slider write and requires If-Match', async (context) => {
    if (!requireSchema(context)) return

    // `toBeInstanceOf(HttpException)`, not the generic `Error`: `HttpException`
    // is a subclass of `Error`, so the looser assertion would still pass if a
    // regression changed `parseSilhouetteIfMatchHeader` to throw an unrelated
    // error instead of the documented 428. Mirrors the onboarding suite's
    // equivalent `4.4-INT-05` assertion exactly. Also pin the status code
    // itself: an `HttpException` subclass check alone would still pass if a
    // regression changed the thrown status away from the documented 428.
    let missingIfMatchError: unknown
    try {
      await serviceA.updateSliders(userId, undefined, {
        heightSlider: 10,
        buildSlider: 10,
      })
    } catch (error) {
      missingIfMatchError = error
    }
    expect(missingIfMatchError).toBeInstanceOf(HttpException)
    expect((missingIfMatchError as HttpException).getStatus()).toBe(428)

    await serviceA.updateSliders(userId, formatSilhouetteETag(userId, 0), {
      heightSlider: 10,
      buildSlider: 10,
    })
    await expect(
      serviceA.updateSliders(userId, formatSilhouetteETag(userId, 0), {
        heightSlider: 20,
        buildSlider: 20,
      })
    ).rejects.toBeInstanceOf(PreconditionFailedException)
  })

  /** Risk 4.4-R02, mirrors the onboarding suite's concurrent-PATCH case. */
  it('4.4-INT-13 serializes two concurrent slider writes with no lost update', async (context) => {
    if (!requireSchema(context)) return

    await serviceA.updateSliders(userId, formatSilhouetteETag(userId, 0), {
      heightSlider: 10,
      buildSlider: 10,
    })

    const results = await Promise.allSettled([
      serviceA.updateSliders(userId, formatSilhouetteETag(userId, 1), {
        heightSlider: 20,
        buildSlider: 20,
      }),
      serviceB.updateSliders(userId, formatSilhouetteETag(userId, 1), {
        heightSlider: 30,
        buildSlider: 30,
      }),
    ])

    const fulfilled = results.filter((r) => r.status === 'fulfilled')
    const rejected = results.filter((r) => r.status === 'rejected')
    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(
      PreconditionFailedException
    )

    const row = await prismaA.silhouetteProfile.findUniqueOrThrow({
      where: { user_id: userId },
    })
    expect(row.revision).toBe(2)
  })

  it('4.4-INT-14 declines to allocate an upload session when guardian consent is required', async (context) => {
    if (!requireSchema(context)) return
    guardian.allowed = false

    await expect(
      serviceA.createMyFormUploadUrl(
        userId,
        'teen',
        {
          fileSizeBytes: 100,
          mimeType: 'image/png',
          sha256: '0'.repeat(64),
          widthPx: 300,
          heightPx: 800,
        },
        randomUUID()
      )
    ).rejects.toBeInstanceOf(ForbiddenException)
  })

  it('4.4-INT-15 runs the full My Form pipeline end to end through a real BullMQ worker', async (context) => {
    if (!requireSchema(context)) return

    const photo = await portraitPhoto()

    const uploadUrlResult = await serviceA.createMyFormUploadUrl(
      userId,
      'guardian',
      photo.declaration,
      randomUUID()
    )
    expect(uploadUrlResult.replayed).toBe(false)

    // The client PUTs straight to the signed storage URL; the session stays pending_upload
    // until commit finds and verifies the object. The moderation engine below is a double:
    // `silhouette-photo-moderation.engine.spec.ts` covers the real heuristic in isolation.
    await storage.clientPut(uploadUrlResult.response.data.uploadUrl, photo.bytes)

    const commitResult = await serviceA.commitMyForm(
      userId,
      'guardian',
      {
        uploadSessionId: uploadUrlResult.response.data.uploadSessionId,
        confirmsBasewearGuidance: true,
      },
      randomUUID()
    )
    expect(commitResult.response.data.myForm?.status).toBe('processing')
    // Round 3 (Codex C2-1, C2-9): the client wrote a staging key; commit published the verified
    // bytes to the tracked final path with server-owned metadata, then released staging.
    const committedRow = await prismaA.silhouetteProfile.findUniqueOrThrow({
      where: { user_id: userId },
    })
    expect(storage.uploaded.get(committedRow.my_form_object_path!)).toEqual(photo.bytes)
    expect(storage.published.get(committedRow.my_form_object_path!)).toEqual({
      contentType: 'image/png',
      cacheControl: 'private, max-age=0',
    })
    expect(
      [...storage.uploaded.keys()].filter((key) => key.startsWith('staging/'))
    ).toEqual([])
    // The released staging key's outbox row is gone once storage confirmed the removal.
    await expect(
      prismaA.wardrobeObjectDeletion.count({
        where: { object_path: { startsWith: `staging/${userId}/` } },
      })
    ).resolves.toBe(0)

    const profileId = committedRow.id

    const expectedJobId = buildSilhouettePhotoJobId(
      profileId,
      uploadUrlResult.response.data.uploadSessionId
    )

    const processedJobIds: string[] = []
    const engine: SilhouettePhotoModerationEngine = {
      moderate: () => Promise.resolve({ outcome: 'ready' as const }),
    }
    const processor = new SilhouettePhotoProcessor(prismaA, storage, engine)

    const worker = new Worker<{ silhouetteProfileId: string }>(
      queueName,
      async (job) => {
        const data = silhouettePhotoProcessingJobSchema.parse(job.data)
        processedJobIds.push(job.id ?? 'unknown')
        await processor.process(
          data.silhouetteProfileId,
          silhouetteSessionFromJobId({ id: job.id, data })
        )
      },
      { connection: redisOptions, concurrency: 1 }
    )

    try {
      await new Promise<void>((resolve, reject) => {
        // 10s was tight enough to time out under this file's own 15s test
        // budget purely from CPU/IO contention when the FULL `integration/`
        // suite runs (every file's own Nest app, Redis connection, and
        // BullMQ worker competing for the same machine): the job itself
        // completes in ~1s when this file runs alone (see the isolated
        // timing note above `it(...)`'s own timeout below). 20s keeps this a
        // fail-fast safety net -- a genuinely stuck job still fails well
        // inside a normal test run -- without flaking on load this file does
        // not control.
        const timeout = setTimeout(
          () => reject(new Error('job did not complete in time')),
          20_000
        )
        // Both listeners filter on this test's own job. The worker subscribes
        // to the queue name, so a job another test in this file enqueued and
        // has not drained yet would otherwise resolve this promise early or
        // reject the test with a failure that is not ours.
        worker.on('completed', (job) => {
          if (job.id === expectedJobId) {
            clearTimeout(timeout)
            resolve()
          }
        })
        // Also wait for the final attempt, matching drainModerationJob's
        // gate: defaultJobOptions configures attempts: 3 with backoff, and
        // 'failed' fires per attempt, so rejecting on attempt 1 would fail
        // this test even when the job goes on to succeed on a later retry.
        worker.on('failed', (job, err) => {
          if (job?.id !== expectedJobId) return
          const attempts = job.opts.attempts ?? 1
          if (job.attemptsMade < attempts) return
          clearTimeout(timeout)
          reject(err)
        })
      })
    } finally {
      await worker.close()
      await removeModerationJob(expectedJobId)
    }

    // Exactly one worker instance processed exactly one job for this
    // profile -- the regression Risk 4.4-R01 exists to prevent is two live
    // consumers splitting jobs so a fraction are silently never moderated.
    // Counted by job id rather than by array length so a stray job from
    // another suite cannot turn this into a flake.
    expect(processedJobIds.filter((id) => id === expectedJobId)).toHaveLength(1)

    const finalRow = await prismaA.silhouetteProfile.findUniqueOrThrow({
      where: { id: profileId },
    })
    expect(finalRow.my_form_status).toBe('ready')
    expect(finalRow.mode).toBe('my_form')
  }, 25_000)

  /**
   * Regression for the BullMQ job-id collision. `SilhouetteProfile` is one row
   * per user, so its id is stable across My Form re-uploads; keying the job on
   * the profile id alone meant BullMQ refused the second commit's job for the
   * whole 7-day retention window and the profile sat in `processing` forever.
   * Runs against real Redis because the drop is a Redis-side behavior a double
   * cannot reproduce.
   */
  it('4.4-INT-18 enqueues a distinct job for a second My Form commit on the same profile', async (context) => {
    if (!requireSchema(context)) return

    const bullQueue = new Queue(queueName, { connection: redisOptions })
    const enqueuedJobIds: string[] = []

    try {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const photo = await portraitPhoto()
        const uploadUrlResult = await serviceA.createMyFormUploadUrl(
          userId,
          'guardian',
          photo.declaration,
          randomUUID()
        )
        await storage.clientPut(uploadUrlResult.response.data.uploadUrl, photo.bytes)
        await serviceA.commitMyForm(
          userId,
          'guardian',
          {
            uploadSessionId: uploadUrlResult.response.data.uploadSessionId,
            confirmsBasewearGuidance: true,
          },
          randomUUID()
        )

        const profile = await prismaA.silhouetteProfile.findUniqueOrThrow({
          where: { user_id: userId },
        })
        enqueuedJobIds.push(
          buildSilhouettePhotoJobId(
            profile.id,
            uploadUrlResult.response.data.uploadSessionId
          )
        )

        // The second attempt models the user deleting and re-uploading: the
        // profile row (and therefore its id) survives, only the upload session
        // is new.
        if (attempt === 0) {
          await prismaA.silhouetteProfile.update({
            where: { user_id: userId },
            data: { my_form_status: null, my_form_commit_idempotency_key: null },
          })
        }
      }

      expect(enqueuedJobIds[0]).not.toBe(enqueuedJobIds[1])
      const jobs = await Promise.all(enqueuedJobIds.map((id) => bullQueue.getJob(id)))
      expect(jobs.map((job) => job?.id)).toEqual(enqueuedJobIds)
    } finally {
      for (const jobId of enqueuedJobIds) {
        await bullQueue.remove(jobId).catch(() => undefined)
      }
      await bullQueue.close()
    }
  }, 15_000)

  it('4.4-INT-16 hard-deletes the My Form photo and reverts to default_mannequin', async (context) => {
    if (!requireSchema(context)) return

    await prismaA.silhouetteProfile.create({
      data: {
        user_id: userId,
        mode: 'my_form',
        // The member's own My Form path: delete removes nothing a path column names otherwise.
        my_form_object_path: `wardrobe/${userId}/silhouette/${randomUUID()}.png`,
        my_form_status: 'ready',
        revision: 3,
      },
    })
    const objectPath = (
      await prismaA.silhouetteProfile.findUniqueOrThrow({ where: { user_id: userId } })
    ).my_form_object_path!
    storage.uploaded.set(objectPath, Buffer.from('bytes'))

    const { response } = await serviceA.deleteMyForm(
      userId,
      formatSilhouetteETag(userId, 3)
    )

    expect(response.data).toMatchObject({
      mode: 'default_mannequin',
      myForm: null,
      revision: 4,
    })
    expect(storage.removed).toContain(objectPath)
    // Recorded with the delete and cleared once storage confirmed it (round 3, Codex C2-4).
    await expect(
      prismaA.wardrobeObjectDeletion.count({ where: { object_path: objectPath } })
    ).resolves.toBe(0)

    const row = await prismaA.silhouetteProfile.findUniqueOrThrow({
      where: { user_id: userId },
    })
    expect(row.my_form_object_path).toBeNull()
    expect(row.my_form_status).toBeNull()
  })

  /**
   * Flagged by Task 7 (Pact)'s review: commitMyForm must distinguish a
   * fresh commit from an idempotent replay the same way
   * createMyFormUploadUrl already does, so the controller can return 200 on
   * replay instead of always 201.
   */
  it('4.4-INT-17 replays an identical commit idempotently and conflicts on a reused key with a different session', async (context) => {
    if (!requireSchema(context)) return

    const photo = await portraitPhoto()

    const uploadUrlResult = await serviceA.createMyFormUploadUrl(
      userId,
      'guardian',
      photo.declaration,
      randomUUID()
    )
    await storage.clientPut(uploadUrlResult.response.data.uploadUrl, photo.bytes)

    const commitKey = randomUUID()
    const first = await serviceA.commitMyForm(
      userId,
      'guardian',
      {
        uploadSessionId: uploadUrlResult.response.data.uploadSessionId,
        confirmsBasewearGuidance: true,
      },
      commitKey
    )

    const profileId = (
      await prismaA.silhouetteProfile.findUniqueOrThrow({ where: { user_id: userId } })
    ).id

    // That commit enqueued a real `moderation-review` job. Register the drain
    // *before* asserting anything: `onTestFinished` still runs after the whole
    // test body (so the background worker cannot advance the row's revision
    // ahead of the replay assertion below), but unlike a trailing statement it
    // also runs when an assertion throws. A failing assertion must not leave
    // the job in Redis, where it would survive this run and be consumed by
    // 4.4-INT-15's Worker on the next one, turning one real failure into a
    // confusing second one.
    onTestFinished(() => drainModerationJob(prismaA, storage, profileId))

    expect(first.replayed).toBe(false)

    const replay = await serviceA.commitMyForm(
      userId,
      'guardian',
      {
        uploadSessionId: uploadUrlResult.response.data.uploadSessionId,
        confirmsBasewearGuidance: true,
      },
      commitKey
    )
    expect(replay.replayed).toBe(true)
    // Nothing else can process this profile's job before this assertion runs:
    // the queue name is this run's own, so a live wardrobe worker on the same
    // Redis (the end-to-end stack starts one) never sees it. Before the name
    // was namespaced that worker flipped the row and bumped the revision.
    expect(replay.response.data.revision).toBe(first.response.data.revision)

    // Asserting the exception type too, not just the message: the whole point
    // of this change is status-code fidelity, and only `ConflictException`
    // maps to the 409 the contract registers for a reused key.
    const reuseError = await serviceA
      .commitMyForm(
        userId,
        'guardian',
        {
          uploadSessionId: uploadUrlResult.response.data.uploadSessionId,
          confirmsBasewearGuidance: true,
        },
        randomUUID()
      )
      .then(
        () => null,
        (error: unknown) => error
      )
    expect(reuseError).toBeInstanceOf(ConflictException)
    expect(reuseError).toMatchObject({ message: 'IDEMPOTENCY_KEY_REUSED' })
  }, 15_000)

  /**
   * Bytes go straight to storage, so commit can arrive before them. The session must stay
   * open for the retry, and the row must not move until the object is there.
   */
  it('4.4-INT-20 keeps a session pending when commit runs before the bytes land, then commits once they do', async (context) => {
    if (!requireSchema(context)) return

    const photo = await portraitPhoto()
    const uploadUrlResult = await serviceA.createMyFormUploadUrl(
      userId,
      'guardian',
      photo.declaration,
      randomUUID()
    )
    const commitInput = {
      uploadSessionId: uploadUrlResult.response.data.uploadSessionId,
      confirmsBasewearGuidance: true as const,
    }

    const early = await serviceA
      .commitMyForm(userId, 'guardian', commitInput, randomUUID())
      .then(
        () => null,
        (error: unknown) => error
      )
    expect(early).toBeInstanceOf(ConflictException)
    expect(early).toMatchObject({ message: 'UPLOAD_BYTES_MISSING' })
    const pendingRow = await prismaA.silhouetteProfile.findUniqueOrThrow({
      where: { user_id: userId },
    })
    expect(pendingRow.my_form_status).toBe('pending_upload')
    expect(pendingRow.my_form_commit_idempotency_key).toBeNull()

    await storage.clientPut(uploadUrlResult.response.data.uploadUrl, photo.bytes)
    const committed = await serviceA.commitMyForm(
      userId,
      'guardian',
      commitInput,
      randomUUID()
    )
    onTestFinished(() => drainModerationJob(prismaA, storage, pendingRow.id))

    expect(committed.response.data.myForm?.status).toBe('processing')
  }, 15_000)

  it('4.4-INT-21 rejects and removes stored bytes that do not match the declaration', async (context) => {
    if (!requireSchema(context)) return

    const photo = await portraitPhoto()
    const uploadUrlResult = await serviceA.createMyFormUploadUrl(
      userId,
      'guardian',
      photo.declaration,
      randomUUID()
    )
    // Same size and PNG signature as declared, one byte changed: only the sha256 can catch it.
    const tampered = Buffer.from(photo.bytes)
    tampered[tampered.length - 20] = (tampered[tampered.length - 20]! + 1) % 256
    await storage.clientPut(uploadUrlResult.response.data.uploadUrl, tampered)
    const stagingKey = `staging/${userId}/silhouette/${uploadUrlResult.response.data.uploadSessionId}.png`
    expect(storage.uploaded.has(stagingKey)).toBe(true)

    const rejected = await serviceA
      .commitMyForm(
        userId,
        'guardian',
        {
          uploadSessionId: uploadUrlResult.response.data.uploadSessionId,
          confirmsBasewearGuidance: true,
        },
        randomUUID()
      )
      .then(
        () => null,
        (error: unknown) => error
      )

    expect(rejected).toBeInstanceOf(UnprocessableEntityException)
    expect(rejected).toMatchObject({ message: 'IMAGE_CHECKSUM_MISMATCH' })
    expect(storage.removed).toEqual([stagingKey])
    expect(storage.uploaded.size).toBe(0)
    // Review round 1, 2026-11-19 (Codex 3): the session ends, so a correction needs a fresh
    // allocation and key, and a validator still running for this one finds no session to act on.
    const row = await prismaA.silhouetteProfile.findUniqueOrThrow({
      where: { user_id: userId },
    })
    expect(row.my_form_status).toBeNull()
    expect(row.my_form_upload_session_id).toBeNull()
    expect(row.my_form_object_path).toBeNull()
    const stale = await serviceA
      .commitMyForm(
        userId,
        'guardian',
        {
          uploadSessionId: uploadUrlResult.response.data.uploadSessionId,
          confirmsBasewearGuidance: true,
        },
        randomUUID()
      )
      .then(
        () => null,
        (error: unknown) => error
      )
    expect(stale).toMatchObject({ message: 'UPLOAD_SESSION_NOT_FOUND' })
    expect(storage.removed).toEqual([stagingKey])
  })

  /**
   * Review round 1, 2026-11-19 (Codex 2, lens 2): a signed URL keeps working for its 2-hour
   * token after its session is replaced or deleted. Signed URLs only ever name a staging key,
   * so a late write can never put a photo back at a tracked, readable path, and the hourly
   * sweep removes it once no commit can claim it.
   */
  for (const ending of ['replaced', 'deleted'] as const) {
    it(`4.4-INT-22 keeps a late write after the session was ${ending} in staging until the sweep removes it`, async (context) => {
      if (!requireSchema(context)) return

      const photo = await portraitPhoto()
      const first = await serviceA.createMyFormUploadUrl(
        userId,
        'guardian',
        photo.declaration,
        randomUUID()
      )
      if (ending === 'replaced') {
        await serviceA.createMyFormUploadUrl(
          userId,
          'guardian',
          photo.declaration,
          randomUUID()
        )
      } else {
        const revision = (
          await prismaA.silhouetteProfile.findUniqueOrThrow({
            where: { user_id: userId },
          })
        ).revision
        await serviceA.deleteMyForm(userId, formatSilhouetteETag(userId, revision))
      }

      // The first session's URL still writes, the way a 2-hour storage token does.
      await storage.clientPut(first.response.data.uploadUrl, photo.bytes)

      const lateKey = `staging/${userId}/silhouette/${first.response.data.uploadSessionId}.png`
      expect([...storage.uploaded.keys()]).toEqual([lateKey])
      const row = await prismaA.silhouetteProfile.findUniqueOrThrow({
        where: { user_id: userId },
      })
      expect(row.my_form_object_path).not.toBe(lateKey)
      expect(row.my_form_upload_session_id).not.toBe(first.response.data.uploadSessionId)
      // Nothing the API serves can reach it: the late write is no member's tracked photo.
      expect(
        (await serviceA.getProfile(userId)).response.data.myForm?.imageAccess ?? null
      ).toBeNull()

      const retention = new WardrobeRetentionService(
        prismaA,
        storage as unknown as never,
        {
          invalidateUserCache: () => Promise.resolve(true),
        }
      )
      // Within the window a slow PUT may still be landing, so the sweep keeps it.
      await expect(retention.purgeStaleStagedUploads(new Date())).resolves.toBe(0)
      await expect(
        retention.purgeStaleStagedUploads(
          new Date(Date.now() + STAGED_UPLOAD_RETENTION_MS + 1000)
        )
      ).resolves.toBe(1)
      expect(storage.uploaded.size).toBe(0)
      expect(storage.removed).toContain(lateKey)
    })
  }

  /**
   * A gate a test opens by hand: `entered` settles once the guarded call reaches the gate, and
   * the call proceeds only after `open()`.
   */
  function gate(): {
    hook: () => Promise<void>
    entered: Promise<void>
    open: () => void
  } {
    let markEntered: () => void = () => undefined
    let release: () => void = () => undefined
    const entered = new Promise<void>((resolve) => {
      markEntered = resolve
    })
    const opened = new Promise<void>((resolve) => {
      release = resolve
    })
    return {
      hook: () => {
        markEntered()
        return opened
      },
      entered,
      open: () => release(),
    }
  }

  /**
   * Round 4 (Codex C3-1): two commits of one session under the same key. The first claims the
   * session's publication in PostgreSQL before any storage I/O; the second, on its own
   * connection, finds that live claim and answers 409 UPLOAD_IN_PROGRESS without reading or
   * writing storage. Once the owner has finished, a same-key retry replays its outcome and never
   * publishes, so no second write of the final key can land after a later purge.
   */
  it('4.4-INT-23 answers a concurrent commit UPLOAD_IN_PROGRESS without touching storage, then replays the owner', async (context) => {
    if (!requireSchema(context)) return

    const photo = await portraitPhoto()
    const allocation = await serviceA.createMyFormUploadUrl(
      userId,
      'guardian',
      photo.declaration,
      randomUUID()
    )
    await storage.clientPut(allocation.response.data.uploadUrl, photo.bytes)
    const commitInput = {
      uploadSessionId: allocation.response.data.uploadSessionId,
      confirmsBasewearGuidance: true as const,
    }
    const commitKey = randomUUID()
    const download = gate()
    storage.beforeDownload = download.hook

    const owner = serviceA.commitMyForm(userId, 'guardian', commitInput, commitKey)
    await download.entered
    storage.beforeDownload = null

    const concurrent = await serviceB
      .commitMyForm(userId, 'guardian', commitInput, commitKey)
      .then(
        () => null,
        (error: unknown) => error
      )
    expect(concurrent).toBeInstanceOf(ConflictException)
    expect(concurrent).toMatchObject({ message: 'UPLOAD_IN_PROGRESS' })
    expect(storage.downloads).toBe(1)
    expect(storage.publishes).toBe(0)

    download.open()
    const committed = await owner
    const profile = await prismaA.silhouetteProfile.findUniqueOrThrow({
      where: { user_id: userId },
    })
    onTestFinished(() => drainModerationJob(prismaA, storage, profile.id))
    expect(committed.replayed).toBe(false)
    expect(committed.response.data.myForm?.status).toBe('processing')
    expect(profile.my_form_publish_attempt_id).toBeNull()
    expect(profile.my_form_processing_job_enqueued_at).not.toBeNull()

    const retried = await serviceB.commitMyForm(
      userId,
      'guardian',
      commitInput,
      commitKey
    )
    expect(retried.replayed).toBe(true)
    expect(storage.downloads).toBe(1)
    expect(storage.publishes).toBe(1)
  }, 15_000)

  /**
   * Round 5 (Codex C4-5): the member deletes My Form while a commit is publishing. The delete
   * locks the profile row, sees the live claim, removes the session's keys at once and records
   * a removal that repeats every 15 minutes until 24 hours after the claim started. The publish
   * lands after the delete and its acknowledgement is lost, so the commit never reaches
   * compensation; the next repeat removes the photo, and the row settles only past the horizon.
   * Round 4 waited for the lease and settled after one removal.
   */
  it('4.4-INT-24 removes a publish that lands after a delete with its answer lost on the next repeat, settling after the horizon', async (context) => {
    if (!requireSchema(context)) return

    const photo = await portraitPhoto()
    const allocation = await serviceA.createMyFormUploadUrl(
      userId,
      'guardian',
      photo.declaration,
      randomUUID()
    )
    await storage.clientPut(allocation.response.data.uploadUrl, photo.bytes)
    const sessionId = allocation.response.data.uploadSessionId
    const finalKey = `wardrobe/${userId}/silhouette/${sessionId}.png`
    const stagingKey = `staging/${userId}/silhouette/${sessionId}.png`
    onTestFinished(async () => {
      await prismaA.wardrobeObjectDeletion.deleteMany({
        where: { object_path: { in: [finalKey, stagingKey] } },
      })
    })
    const publish = gate()
    storage.beforePublish = publish.hook
    storage.publishAnswerLost = true

    const commit = serviceA
      .commitMyForm(
        userId,
        'guardian',
        { uploadSessionId: sessionId, confirmsBasewearGuidance: true },
        randomUUID()
      )
      .then(
        () => null,
        (error: unknown) => error
      )
    await publish.entered
    const claimed = await prismaA.silhouetteProfile.findUniqueOrThrow({
      where: { user_id: userId },
    })
    expect(claimed.my_form_publish_attempt_id).not.toBeNull()
    const horizon = new Date(
      claimed.my_form_publish_started_at!.getTime() + AMBIGUOUS_PUBLICATION_HORIZON_MS
    )

    const deletedAt = Date.now()
    await serviceB.deleteMyForm(userId, formatSilhouetteETag(userId, claimed.revision))
    // Both keys were removed at once; the final had not landed yet.
    expect(storage.removed).toEqual([finalKey, stagingKey])
    expect(storage.uploaded.has(stagingKey)).toBe(false)
    publish.open()
    expect(await commit).toMatchObject({ message: 'publish acknowledgement lost' })

    // The late write landed after the delete. Both rows repeat until the horizon.
    expect(storage.uploaded.has(finalKey)).toBe(true)
    const repeating = await prismaA.wardrobeObjectDeletion.findMany({
      where: { object_path: { in: [finalKey, stagingKey] } },
      orderBy: { object_path: 'asc' },
    })
    expect(repeating.map((row) => [row.object_path, row.repeat_until])).toEqual([
      [stagingKey, horizon],
      [finalKey, horizon],
    ])

    // Scoped to this test's keys: the database is shared, and other rows are not this test's
    // to settle.
    const outbox = new WardrobeObjectDeletionOutbox(prismaA, storage)
    const ownKeys = { objectPaths: [finalKey, stagingKey] }
    const nextRepeat = new Date(deletedAt + REPEATING_REMOVAL_INTERVAL_MS + 1000)
    await outbox.drainDue(nextRepeat, ownKeys)
    expect(storage.uploaded.has(finalKey)).toBe(false)
    expect(
      await prismaA.wardrobeObjectDeletion.count({
        where: { object_path: { in: [finalKey, stagingKey] } },
      })
    ).toBe(2)

    await outbox.drainDue(new Date(horizon.getTime() + 60 * 60 * 1000), ownKeys)
    expect(storage.uploaded.has(finalKey)).toBe(false)
    expect(storage.uploaded.has(stagingKey)).toBe(false)
    expect(
      await prismaA.wardrobeObjectDeletion.count({
        where: { object_path: { in: [finalKey, stagingKey] } },
      })
    ).toBe(0)
  }, 15_000)

  /**
   * Round 4 (Codex C3-5): the queue refuses the job after the claim moved the photo to
   * processing. The row stays processing with no handoff marker (no rollback), and the member's
   * same-key retry enqueues the job under its deterministic id and records the handoff.
   */
  it('4.4-INT-25 re-enqueues on the same-key retry after the enqueue failed, recording the handoff', async (context) => {
    if (!requireSchema(context)) return

    let refuseNext = true
    const flakyQueue = {
      enqueue: (profileId: string, sessionId: string) => {
        if (refuseNext) {
          refuseNext = false
          return Promise.reject(new Error('redis unavailable'))
        }
        return queue.enqueue(profileId, sessionId)
      },
    }
    const service = new WardrobeSilhouetteService(
      prismaA,
      guardian as unknown as GuardianService,
      storage as unknown as never,
      flakyQueue as unknown as SilhouettePhotoProcessingQueue
    )
    const photo = await portraitPhoto()
    const allocation = await service.createMyFormUploadUrl(
      userId,
      'guardian',
      photo.declaration,
      randomUUID()
    )
    await storage.clientPut(allocation.response.data.uploadUrl, photo.bytes)
    const commitInput = {
      uploadSessionId: allocation.response.data.uploadSessionId,
      confirmsBasewearGuidance: true as const,
    }
    const commitKey = randomUUID()

    await expect(
      service.commitMyForm(userId, 'guardian', commitInput, commitKey)
    ).rejects.toThrow('redis unavailable')
    const stranded = await prismaA.silhouetteProfile.findUniqueOrThrow({
      where: { user_id: userId },
    })
    expect(stranded.my_form_status).toBe('processing')
    expect(stranded.my_form_upload_session_id).toBe(commitInput.uploadSessionId)
    expect(stranded.my_form_processing_job_enqueued_at).toBeNull()

    const retried = await service.commitMyForm(userId, 'guardian', commitInput, commitKey)
    onTestFinished(() => drainModerationJob(prismaA, storage, stranded.id))
    expect(retried.replayed).toBe(true)
    const handedOff = await prismaA.silhouetteProfile.findUniqueOrThrow({
      where: { user_id: userId },
    })
    expect(handedOff.my_form_processing_job_enqueued_at).not.toBeNull()
    const bullQueue = new Queue(queueName, { connection: redisOptions })
    try {
      const job = await bullQueue.getJob(
        buildSilhouettePhotoJobId(stranded.id, commitInput.uploadSessionId)
      )
      expect(job?.data).toEqual({ silhouetteProfileId: stranded.id })
    } finally {
      await bullQueue.close()
    }
    expect(storage.publishes).toBe(1)
  }, 15_000)

  /**
   * Coordinator follow-up 2 (round 4): a commit's publication claim is a row update. While the
   * claiming transaction still holds the row lock, a delete on a second connection must wait on
   * its `FOR UPDATE`; once the claim commits, the delete sees it, removes the session's keys at
   * once and records them as a removal that repeats until 24 hours after the claim started
   * (round 5, Codex C4-5).
   */
  it('4.4-INT-26 makes a delete wait for a commit holding the claim and the row lock, then removes its keys and repeats the removal', async (context) => {
    if (!requireSchema(context)) return

    const photo = await portraitPhoto()
    const allocation = await serviceA.createMyFormUploadUrl(
      userId,
      'guardian',
      photo.declaration,
      randomUUID()
    )
    const sessionId = allocation.response.data.uploadSessionId
    const finalKey = `wardrobe/${userId}/silhouette/${sessionId}.png`
    const stagingKey = `staging/${userId}/silhouette/${sessionId}.png`
    onTestFinished(async () => {
      await prismaA.wardrobeObjectDeletion.deleteMany({
        where: { object_path: { in: [finalKey, stagingKey] } },
      })
    })

    const claimStartedAt = new Date()
    const held = gate()
    const claim = prismaA.$transaction(
      async (tx) => {
        const claimed = await tx.silhouetteProfile.updateMany({
          where: {
            user_id: userId,
            my_form_upload_session_id: sessionId,
            my_form_status: 'pending_upload',
          },
          data: {
            my_form_publish_attempt_id: randomUUID(),
            my_form_publish_started_at: claimStartedAt,
          },
        })
        expect(claimed.count).toBe(1)
        // Holds the transaction, and with it the row lock, until the test opens the gate.
        await held.hook()
      },
      { timeout: 20_000 }
    )
    await held.entered

    const deleted = serviceB.deleteMyForm(userId, '*')
    await waitForRowLockWait(prismaA, 'SilhouetteProfile')
    // Still waiting: nothing is recorded or removed while the claim's transaction is open.
    expect(
      await prismaA.wardrobeObjectDeletion.count({
        where: { object_path: { in: [finalKey, stagingKey] } },
      })
    ).toBe(0)

    held.open()
    await claim
    await deleted

    const horizon = new Date(claimStartedAt.getTime() + AMBIGUOUS_PUBLICATION_HORIZON_MS)
    const repeating = await prismaA.wardrobeObjectDeletion.findMany({
      where: { object_path: { in: [finalKey, stagingKey] } },
      orderBy: { object_path: 'asc' },
    })
    expect(repeating.map((row) => [row.object_path, row.repeat_until])).toEqual([
      [stagingKey, horizon],
      [finalKey, horizon],
    ])
    expect(storage.removed).toContain(finalKey)
    expect(storage.removed).toContain(stagingKey)
  }, 20_000)
})

/**
 * Resolves once another backend is blocked on a row lock of `table` taken with `FOR UPDATE`, as
 * Postgres itself reports it; a bounded poll on that condition, never a fixed sleep.
 */
async function waitForRowLockWait(prisma: PrismaClient, table: string): Promise<void> {
  const deadline = Date.now() + 10_000
  for (;;) {
    const waiting = await prisma.$queryRaw<{ count: bigint }[]>`
      SELECT count(*)::bigint AS count FROM pg_stat_activity
      WHERE wait_event_type = 'Lock'
        AND query LIKE ${`%"${table}"%FOR UPDATE%`}`
    if (Number(waiting[0]?.count ?? 0) > 0) return
    if (Date.now() > deadline) throw new Error(`no backend waited on a ${table} row lock`)
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}
