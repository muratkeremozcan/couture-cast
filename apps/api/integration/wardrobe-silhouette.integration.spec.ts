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
} from '@nestjs/common'
import { Queue, Worker } from 'bullmq'
import { getRedisConfig, redisOptionsFromConfig } from '../src/config/redis.js'
import {
  formatSilhouetteETag,
  WardrobeSilhouetteService,
} from '../src/modules/wardrobe/wardrobe-silhouette.service.js'
import type { GuardianService } from '../src/modules/guardian/guardian.service.js'
import {
  buildSilhouettePhotoJobId,
  SilhouettePhotoProcessingQueue,
  silhouettePhotoProcessingJobSchema,
} from '../src/modules/wardrobe/silhouette-photo-processing.queue.js'
import { SilhouettePhotoProcessor } from '../src/modules/wardrobe/silhouette-photo.processor.js'
import { buildFixtureSilhouettePhoto } from '../src/modules/wardrobe/fixture-silhouette-photo-moderation.engine.js'
import type { WardrobeStorage } from '../src/modules/wardrobe/wardrobe-storage.adapter.js'
import type { SilhouettePhotoModerationEngine } from '../src/modules/wardrobe/silhouette-photo-moderation.engine.js'

/**
 * Real-PostgreSQL (and, for the moderation-review handoff, real Redis)
 * coverage for the silhouette sliders and "My Form" pipeline.
 *
 * Risk 4.4-R01: two live consumers on moderation-review would silently drop
 * a fraction of jobs. The `4.4-INT-15` case runs one real BullMQ Worker
 * against the real queue and proves the job is actually processed
 * end-to-end (the row transitions), not just enqueued.
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
 * Redis, unlike the database, is not scoped per test *or* per run: the
 * `moderation-review` queue survives process exit, so a job left behind by
 * an aborted or failed earlier run is still waiting when the next run
 * starts, and the first `Worker` to come up consumes it -- inflating
 * `4.4-INT-15`'s "exactly one job" assertion with a job that has nothing to
 * do with this run. In-test draining alone cannot fix that (the run that
 * leaked the job is already over), so every run starts from an empty queue.
 * Only this suite touches `moderation-review`, so clearing it is safe.
 */
async function clearModerationQueue(): Promise<void> {
  const queue = new Queue('moderation-review', {
    connection: redisOptionsFromConfig(getRedisConfig()),
  })
  try {
    await queue.obliterate({ force: true })
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn(
      '[wardrobe-silhouette.integration] Could not clear the moderation-review queue; ' +
        'real-Redis cases may be affected by leftover jobs.',
      error
    )
  } finally {
    // Never let tidying up the probe connection fail `beforeAll` itself:
    // that would take down all eight cases, including the six that need no
    // Redis at all, over a queue this hook only ever tries to tidy.
    await queue.close().catch(() => undefined)
  }
}

/**
 * `moderation-review` is a real, persistent Redis-backed queue, so any test
 * that enqueues a job (any successful `commitMyForm`) must drain it before
 * finishing -- an un-drained job otherwise sits in Redis and gets picked up
 * by whichever *other* test's `Worker` happens to run next, breaking that
 * test's "exactly one job" assertion. This starts one short-lived real
 * `Worker`, waits for the specific profile's job to complete, and closes.
 */
async function drainModerationJob(
  prisma: PrismaClient,
  storage: WardrobeStorage,
  profileId: string
): Promise<void> {
  const redisOptions = redisOptionsFromConfig(getRedisConfig())
  const engine: SilhouettePhotoModerationEngine = {
    moderate: () => Promise.resolve({ outcome: 'ready' as const }),
  }
  const processor = new SilhouettePhotoProcessor(prisma, storage, engine)

  const worker = new Worker<{ silhouetteProfileId: string }>(
    'moderation-review',
    async (job) => {
      const data = silhouettePhotoProcessingJobSchema.parse(job.data)
      await processor.process(data.silhouetteProfileId)
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

class MemoryWardrobeStorage implements WardrobeStorage {
  uploaded = new Map<string, Buffer>()
  removed: string[] = []

  upload(objectPath: string, bytes: Buffer, _mimeType: string): Promise<void> {
    void _mimeType
    this.uploaded.set(objectPath, bytes)
    return Promise.resolve()
  }
  download(objectPath: string): Promise<Buffer> {
    const bytes = this.uploaded.get(objectPath)
    if (!bytes) return Promise.reject(new Error(`no stored bytes for ${objectPath}`))
    return Promise.resolve(bytes)
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
 * `moderation-review` is a real, shared BullMQ queue on the developer's and
 * CI's real Redis. Every job this suite enqueues must be removed again before
 * the test ends: BullMQ retains completed jobs for `JOB_RETENTION_SECONDS`
 * (7 days), so an undrained job is shared external state that outlives the
 * run, and any leftover job is picked up by the next test's worker, which
 * subscribes to the queue name rather than to a single job.
 */
async function removeModerationJob(jobId: string): Promise<void> {
  const queue = new Queue('moderation-review', {
    connection: redisOptionsFromConfig(getRedisConfig()),
  })
  try {
    await queue.remove(jobId)
  } finally {
    await queue.close()
  }
}

describe('4.4 wardrobe silhouette against real PostgreSQL', () => {
  const namespace = `silhouette-it-${randomUUID().slice(0, 8)}`
  // Captured so `afterAll` can restore it: `process.env` is a real Node
  // global, not something vitest's per-file isolation resets on its own for
  // a plain assignment (unlike `vi.stubEnv`, which this repo's other
  // `WARDROBE_UPLOAD_TOKEN_SECRET`-mutating specs -- `wardrobe-upload-
  // token.spec.ts`, `wardrobe.service.regression.spec.ts`,
  // `wardrobe.service.failure-paths.spec.ts` -- all use for exactly this
  // reason). Leaving this set would otherwise let this suite's secret leak
  // into whichever spec file the test runner happens to execute next in the
  // same worker.
  const originalUploadTokenSecret = process.env.WARDROBE_UPLOAD_TOKEN_SECRET
  let userId: string
  let guardian: StubGuardianService
  let storage: MemoryWardrobeStorage
  let queue: SilhouettePhotoProcessingQueue
  let serviceA: WardrobeSilhouetteService
  let serviceB: WardrobeSilhouetteService

  beforeAll(async () => {
    await probeSchema()
    process.env.WARDROBE_UPLOAD_TOKEN_SECRET = 'a'.repeat(32)
    if (schemaReady) await clearModerationQueue()
  })

  beforeEach(async () => {
    if (!schemaReady) return

    const user = await prismaA.user.create({
      data: { email: `${namespace}-${randomUUID().slice(0, 8)}@synthetic.test` },
    })
    userId = user.id

    guardian = new StubGuardianService()
    storage = new MemoryWardrobeStorage()
    queue = new SilhouettePhotoProcessingQueue()
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
    // Direct assignment, not `= undefined`: that would coerce to the
    // *string* `"undefined"` rather than deleting the key, leaving a
    // truthy-but-bogus value behind for whichever spec runs next.
    if (originalUploadTokenSecret === undefined) {
      delete process.env.WARDROBE_UPLOAD_TOKEN_SECRET
    } else {
      process.env.WARDROBE_UPLOAD_TOKEN_SECRET = originalUploadTokenSecret
    }

    if (!schemaReady) {
      await prismaA.$disconnect()
      await prismaB.$disconnect()
      return
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
    await prismaA.user.deleteMany({ where: { email: { contains: namespace } } })
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
    // equivalent `4.4-INT-05` assertion exactly.
    await expect(
      serviceA.updateSliders(userId, undefined, { heightSlider: 10, buildSlider: 10 })
    ).rejects.toBeInstanceOf(HttpException)

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

    const image = buildFixtureSilhouettePhoto('ready')
    const sha256 = createHash('sha256').update(image).digest('hex')

    const uploadUrlResult = await serviceA.createMyFormUploadUrl(
      userId,
      'guardian',
      {
        fileSizeBytes: image.length,
        mimeType: 'image/png',
        sha256,
        widthPx: 300,
        heightPx: 800,
      },
      randomUUID()
    )
    expect(uploadUrlResult.replayed).toBe(false)

    // The image bytes never actually decode as PNG here (they're a fixture
    // marker), so this test exercises the pipeline at the service/queue/
    // worker seam using a storage+validation double rather than a real
    // Sharp-decodable photo; `wardrobe-silhouette-image-validation.spec.ts`
    // and `silhouette-photo-moderation.engine.spec.ts` already cover real
    // decode/heuristic behavior in isolation.
    await prismaA.silhouetteProfile.update({
      where: { user_id: userId },
      data: {
        my_form_status: 'bytes_uploaded',
      },
    })
    await storage.upload(
      (await prismaA.silhouetteProfile.findUniqueOrThrow({ where: { user_id: userId } }))
        .my_form_object_path!,
      image,
      'image/png'
    )

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

    const profileId = (
      await prismaA.silhouetteProfile.findUniqueOrThrow({ where: { user_id: userId } })
    ).id

    const expectedJobId = buildSilhouettePhotoJobId(
      profileId,
      uploadUrlResult.response.data.uploadSessionId
    )

    const redisOptions = redisOptionsFromConfig(getRedisConfig())
    const processedJobIds: string[] = []
    const engine: SilhouettePhotoModerationEngine = {
      moderate: () => Promise.resolve({ outcome: 'ready' as const }),
    }
    const processor = new SilhouettePhotoProcessor(prismaA, storage, engine)

    const worker = new Worker<{ silhouetteProfileId: string }>(
      'moderation-review',
      async (job) => {
        const data = silhouettePhotoProcessingJobSchema.parse(job.data)
        processedJobIds.push(job.id ?? 'unknown')
        await processor.process(data.silhouetteProfileId)
      },
      { connection: redisOptions, concurrency: 1 }
    )

    try {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error('job did not complete in time')),
          10_000
        )
        // Both listeners filter on this test's own job. The worker subscribes
        // to the shared `moderation-review` queue name, so an unrelated job
        // left behind by another suite would otherwise resolve this promise
        // early or reject the test with a failure that is not ours.
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
  }, 15_000)

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

    const bullQueue = new Queue('moderation-review', {
      connection: redisOptionsFromConfig(getRedisConfig()),
    })
    const enqueuedJobIds: string[] = []

    try {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const image = buildFixtureSilhouettePhoto('ready')
        const uploadUrlResult = await serviceA.createMyFormUploadUrl(
          userId,
          'guardian',
          {
            fileSizeBytes: image.length,
            mimeType: 'image/png',
            sha256: createHash('sha256').update(image).digest('hex'),
            widthPx: 300,
            heightPx: 800,
          },
          randomUUID()
        )
        await prismaA.silhouetteProfile.update({
          where: { user_id: userId },
          data: { my_form_status: 'bytes_uploaded' },
        })
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
        my_form_object_path: `${namespace}/${randomUUID()}.png`,
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

    const image = buildFixtureSilhouettePhoto('ready')
    const sha256 = createHash('sha256').update(image).digest('hex')

    const uploadUrlResult = await serviceA.createMyFormUploadUrl(
      userId,
      'guardian',
      {
        fileSizeBytes: image.length,
        mimeType: 'image/png',
        sha256,
        widthPx: 300,
        heightPx: 800,
      },
      randomUUID()
    )
    await prismaA.silhouetteProfile.update({
      where: { user_id: userId },
      data: { my_form_status: 'bytes_uploaded' },
    })
    await storage.upload(
      (await prismaA.silhouetteProfile.findUniqueOrThrow({ where: { user_id: userId } }))
        .my_form_object_path!,
      image,
      'image/png'
    )

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
    // Assumes no other consumer processes this profile's job before this
    // assertion runs -- e.g. `npm run start:workers:wardrobe` pointed at the
    // same Redis would flip the row to `ready` and bump the revision out
    // from under this. Same shared-external-state class as everywhere else
    // in this file; harmless in CI/local test runs where no such worker is
    // started, but don't run this suite alongside a live wardrobe worker.
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
})
