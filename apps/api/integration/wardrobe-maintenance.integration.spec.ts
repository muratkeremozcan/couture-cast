// Learning path Step 58: Image uploads straight to storage.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#image-uploads-straight-to-storage
//
// Production follow-up 2026-11-19 (review round 6, Codex C5-4, C5-5, C5-6 and C5-7): the hourly
// wardrobe maintenance against real PostgreSQL and, for the garment job handoff, a real BullMQ
// queue. A double cannot carry what these prove: the capture query's ordering in SQL, the held
// key obligation surviving a lost write acknowledgement through a release and a purge, a
// completed job id that BullMQ keeps and that turns a plain re-enqueue into a no-op, and a
// palette row an older API instance wrote with no attempt.
import 'reflect-metadata'
import { createHash, randomUUID } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import { Queue, QueueEvents, Worker } from 'bullmq'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { queueConfigs } from '../src/config/queues.js'
import { getRedisConfig, redisOptionsFromConfig } from '../src/config/redis.js'
import { PaletteAnalysisProcessor } from '../src/modules/commerce/palette-analysis.processor.js'
import { FixturePaletteAnalysisEngine } from '../src/modules/commerce/fixture-palette-analysis.engine.js'
import type { TelemetryService } from '../src/modules/telemetry/telemetry.service.js'
import { WardrobeColorProcessor } from '../src/modules/wardrobe/wardrobe-color.processor.js'
import {
  PROCESSING_HANDOFF_GRACE_MS,
  reenqueueStrandedProcessing,
} from '../src/modules/wardrobe/wardrobe-processing-handoff.js'
import {
  WardrobeProcessingQueue,
  type GarmentColorProcessingJob,
} from '../src/modules/wardrobe/wardrobe-processing.queue.js'
import { WardrobeRetentionService } from '../src/modules/wardrobe/wardrobe-retention.service.js'
import { WardrobeObjectDeletionOutbox } from '../src/modules/wardrobe/wardrobe-object-deletion.outbox.js'
import type {
  BoundedDownload,
  StagedUploadPage,
} from '../src/modules/wardrobe/wardrobe-storage.adapter.js'
import { deleteMembers } from './helpers/privacy-guards.js'

const databaseUrl =
  process.env.INTEGRATION_TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } })

let schemaReady = false

async function probeSchema(): Promise<void> {
  try {
    await prisma.$queryRaw`SELECT held_source_object_path, held_source_cleanup_until, processing_deferred_at FROM "GarmentItem" LIMIT 1`
    schemaReady = true
  } catch {
    schemaReady = false
    // eslint-disable-next-line no-console
    console.warn(
      '[wardrobe-maintenance.integration] Skipped: PostgreSQL is missing the 2026-11-19 ' +
        'round 6 schema. Run `npm run db:migrate` to execute this suite.'
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

const namespace = `wardrobe-maint-it-${randomUUID().slice(0, 8)}`
/** Per run, so a worker sharing this Redis (the E2E stack's color worker) never claims a job. */
const queueName = `${namespace}-color-extraction`
const redisOptions = redisOptionsFromConfig(getRedisConfig())
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')

/** The bucket as a map; `publishOnce` refuses an occupied key the way storage does. */
class MemoryBucket {
  readonly objects = new Map<string, Buffer>()
  readonly removed: string[] = []
  /** Writes the next `publishOnce` and then fails, as a lost acknowledgement does. */
  loseNextWriteAck = false
  /**
   * Fails the next `publishOnce` before its bytes land, and keeps them for `landDeferredWrite`:
   * a capture transaction that timed out while storage was still applying the write.
   */
  deferNextWrite = false
  private deferred: (() => void) | null = null

  landDeferredWrite(): void {
    this.deferred?.()
    this.deferred = null
  }

  download(objectPath: string): Promise<Buffer> {
    const bytes = this.objects.get(objectPath)
    return bytes ? Promise.resolve(bytes) : Promise.reject(new Error('missing'))
  }
  downloadBounded(objectPath: string): Promise<BoundedDownload> {
    const bytes = this.objects.get(objectPath)
    return Promise.resolve(bytes ? { status: 'present', bytes } : { status: 'missing' })
  }
  publishOnce(objectPath: string, bytes: Buffer): Promise<'created' | 'exists'> {
    if (this.objects.has(objectPath)) return Promise.resolve('exists')
    if (this.deferNextWrite) {
      this.deferNextWrite = false
      this.deferred = () => this.objects.set(objectPath, Buffer.from(bytes))
      return Promise.reject(
        new Error('transaction timed out while storage applied the write')
      )
    }
    this.objects.set(objectPath, Buffer.from(bytes))
    if (this.loseNextWriteAck) {
      this.loseNextWriteAck = false
      return Promise.reject(new Error('write acknowledgement lost'))
    }
    return Promise.resolve('created')
  }
  remove(paths: string[]): Promise<void> {
    for (const path of paths) {
      this.objects.delete(path)
      this.removed.push(path)
    }
    return Promise.resolve()
  }
  listStagedUploads(): Promise<StagedUploadPage> {
    return Promise.resolve({ objects: [], nextCursor: null })
  }
}

describe('wardrobe maintenance against real PostgreSQL (upload review round 6)', () => {
  let userId: string
  let bucket: MemoryBucket
  let retention: WardrobeRetentionService

  beforeAll(async () => {
    await probeSchema()
  })

  beforeEach(async () => {
    if (!schemaReady) return
    const user = await prisma.user.create({
      data: { email: `${namespace}-${randomUUID().slice(0, 8)}@synthetic.test` },
    })
    userId = user.id
    bucket = new MemoryBucket()
    retention = new WardrobeRetentionService(
      prisma,
      bucket as never,
      {
        invalidateUserCache: () => Promise.resolve(true),
      } as never
    )
  })

  afterEach(async () => {
    if (!schemaReady) return
    // Only this test's own outbox rows: the database is shared with other suites.
    await prisma.wardrobeObjectDeletion.deleteMany({
      where: { object_path: { contains: userId } },
    })
  })

  afterAll(async () => {
    if (schemaReady) {
      const members = { user: { email: { startsWith: namespace } } }
      await prisma.paletteInsights.deleteMany({ where: members })
      await prisma.garmentItem.deleteMany({ where: members })
      // A purge writes an immutable AuditLog row (DELETE raises by trigger, and the relation is
      // RESTRICT), so a member whose garment was purged stays, as in the palette suite.
      await deleteMembers(prisma, {
        email: { startsWith: namespace },
        audit_logs: { none: {} },
      })
    }
    await prisma.$disconnect()
  })

  /** A pending garment under legal hold whose declaration matches `declared`. */
  async function heldPendingGarment(declared: Buffer, createdAt: Date) {
    const garmentId = randomUUID()
    const sessionId = randomUUID()
    await prisma.garmentItem.create({
      data: {
        id: garmentId,
        user_id: userId,
        object_path: `wardrobe/${userId}/${garmentId}.jpg`,
        upload_session_id: sessionId,
        upload_status: 'pending_upload',
        retention_status: 'legal_hold',
        mime_type: 'image/jpeg',
        file_size_bytes: declared.length,
        content_sha256: sha(declared),
        upload_expires_at: new Date(createdAt.getTime() + 15 * 60 * 1000),
        created_at: createdAt,
      },
    })
    return {
      garmentId,
      staging: `staging/${userId}/garment/${sessionId}.jpg`,
      held: `held/${userId}/${garmentId}.jpg`,
    }
  }

  /**
   * Every maintenance pass here is scoped to this test's member, as the outbox drains are: the
   * database is shared, and another suite's rows must never be captured or re-enqueued here.
   *
   * Codex C5-5: capture always read the oldest twenty uncaptured held rows, so twenty held
   * allocations whose bytes never arrived kept a valid twenty-first source from ever being read.
   * Capture now takes the least recently checked first (never checked first), in SQL.
   */
  it('reaches a capturable held source behind a full page of garments with no staged bytes', async (context) => {
    if (!requireSchema(context)) return
    // Older than any held row another suite could have left, so this page is the oldest.
    const base = new Date('2000-01-01T00:00:00.000Z')
    for (let index = 0; index < 20; index += 1) {
      await heldPendingGarment(
        Buffer.from(`never staged ${index}`),
        new Date(base.getTime() + index)
      )
    }
    const declared = Buffer.from('the twenty-first source')
    const capturable = await heldPendingGarment(declared, new Date(base.getTime() + 100))
    bucket.objects.set(capturable.staging, declared)

    const own = { userIds: [userId] }
    await retention.captureHeldSources(new Date('2000-01-02T00:00:00.000Z'), own)
    const firstPass = await prisma.garmentItem.findMany({
      where: { user_id: userId, held_source_capture_outcome: 'missing' },
    })
    expect(firstPass).toHaveLength(20)
    expect(bucket.objects.has(capturable.held)).toBe(false)

    await retention.captureHeldSources(new Date('2000-01-02T01:00:00.000Z'), own)

    expect(bucket.objects.get(capturable.held)).toEqual(declared)
    await expect(
      prisma.garmentItem.findUniqueOrThrow({ where: { id: capturable.garmentId } })
    ).resolves.toMatchObject({
      held_source_sha256: sha(declared),
      held_source_object_path: capturable.held,
      held_source_capture_outcome: 'captured',
    })
  })

  /**
   * Codex C5-3 (accepted residual) and C5-4: a capture whose write landed but whose
   * acknowledgement was lost never recorded a digest, so a later purge omitted the held key and
   * cleared the MIME type needed to rebuild it. The key is now recorded on the row before the
   * write, the outcome is left for the operator, and the purge after release removes the copy
   * and clears every held column.
   */
  it('removes a held copy whose write acknowledgement was lost once the hold is released and the garment purged', async (context) => {
    if (!requireSchema(context)) return
    const declared = Buffer.from('held source bytes')
    const garment = await heldPendingGarment(declared, new Date())
    bucket.objects.set(garment.staging, declared)
    bucket.loseNextWriteAck = true

    expect(await retention.captureHeldSources(new Date(), { userIds: [userId] })).toBe(0)
    expect(bucket.objects.has(garment.held)).toBe(true)
    await expect(
      prisma.garmentItem.findUniqueOrThrow({ where: { id: garment.garmentId } })
    ).resolves.toMatchObject({
      held_source_sha256: null,
      held_source_object_path: garment.held,
      held_source_capture_outcome: 'failed',
    })

    await prisma.garmentItem.update({
      where: { id: garment.garmentId },
      data: { retention_status: 'active' },
    })
    await retention.requestDeletion(userId, garment.garmentId)

    expect(bucket.objects.has(garment.held)).toBe(false)
    expect(bucket.removed).toContain(garment.held)
    // Final review F-4, F-5: the key stays on the row while its removal repeats until the
    // capture's horizon, and is cleared once the removal settles past it.
    await expect(
      prisma.garmentItem.findUniqueOrThrow({ where: { id: garment.garmentId } })
    ).resolves.toMatchObject({
      content_sha256: null,
      mime_type: null,
      held_source_sha256: null,
      held_source_captured_at: null,
      held_source_object_path: garment.held,
    })
    await drainHeld(garment.held, pastHorizon())
    await expect(
      prisma.garmentItem.findUniqueOrThrow({ where: { id: garment.garmentId } })
    ).resolves.toMatchObject({
      held_source_object_path: null,
      held_source_cleanup_until: null,
    })
  })

  /** Drains only this test's held key, as of `now`. */
  function drainHeld(heldKey: string, now: Date) {
    return new WardrobeObjectDeletionOutbox(prisma, bucket).drainDue(now, {
      objectPaths: [heldKey],
    })
  }

  /** A moment past the 24-hour horizon of a capture that ran now. */
  function pastHorizon() {
    return new Date(Date.now() + 25 * 60 * 60 * 1000)
  }

  /**
   * Final review F-4: the capture transaction timed out while storage was still applying the
   * copy. The release removed the key while it was still absent; the copy landed afterwards.
   * The horizon recorded before the write keeps the removal repeating, so the next drain
   * removes the late copy, and the removal settles only past the horizon.
   */
  it('removes a held copy that lands after the release removed its still-absent key', async (context) => {
    if (!requireSchema(context)) return
    const declared = Buffer.from('held source bytes, landing late')
    const garment = await heldPendingGarment(declared, new Date())
    bucket.objects.set(garment.staging, declared)
    bucket.deferNextWrite = true
    const own = { userIds: [userId] }

    expect(await retention.captureHeldSources(new Date(), own)).toBe(0)
    const obligated = await prisma.garmentItem.findUniqueOrThrow({
      where: { id: garment.garmentId },
    })
    expect(obligated.held_source_object_path).toBe(garment.held)
    expect(obligated.held_source_cleanup_until!.getTime()).toBeGreaterThan(
      Date.now() + 23 * 60 * 60 * 1000
    )

    await prisma.garmentItem.update({
      where: { id: garment.garmentId },
      data: { retention_status: 'active' },
    })
    expect(await retention.releaseUnheldCopies(own)).toBe(1)
    expect(bucket.removed).toEqual([garment.held])
    // A second hourly release leaves the key to the outbox row that owns it.
    expect(await retention.releaseUnheldCopies(own)).toBe(0)

    bucket.landDeferredWrite()
    expect(bucket.objects.has(garment.held)).toBe(true)

    await drainHeld(garment.held, new Date(Date.now() + 16 * 60 * 1000))
    expect(bucket.objects.has(garment.held)).toBe(false)
    expect(bucket.removed).toEqual([garment.held, garment.held])

    await drainHeld(garment.held, pastHorizon())
    await expect(
      prisma.wardrobeObjectDeletion.count({ where: { object_path: garment.held } })
    ).resolves.toBe(0)
    await expect(
      prisma.garmentItem.findUniqueOrThrow({ where: { id: garment.garmentId } })
    ).resolves.toMatchObject({ held_source_object_path: null })
  })

  /**
   * Final review F-5: a hold reapplied before the release's removal settled makes the outbox
   * drop its row and keep the copy. The key stays on the garment, so releasing the hold again
   * removes the copy with no capture in between.
   */
  it('removes the copy after a hold is reapplied and released again before the removal settled', async (context) => {
    if (!requireSchema(context)) return
    const declared = Buffer.from('held source bytes, held twice')
    const garment = await heldPendingGarment(declared, new Date())
    bucket.objects.set(garment.staging, declared)
    const own = { userIds: [userId] }
    expect(await retention.captureHeldSources(new Date(), own)).toBe(1)

    await prisma.garmentItem.update({
      where: { id: garment.garmentId },
      data: { retention_status: 'active' },
    })
    expect(await retention.releaseUnheldCopies(own)).toBe(1)
    expect(bucket.objects.has(garment.held)).toBe(false)
    // The removal repeats until the horizon; meanwhile a write lands and the hold returns.
    bucket.objects.set(garment.held, declared)
    await prisma.garmentItem.update({
      where: { id: garment.garmentId },
      data: { retention_status: 'legal_hold' },
    })
    await drainHeld(garment.held, new Date(Date.now() + 16 * 60 * 1000))
    await expect(
      prisma.wardrobeObjectDeletion.count({ where: { object_path: garment.held } })
    ).resolves.toBe(0)
    expect(bucket.objects.has(garment.held)).toBe(true)

    await prisma.garmentItem.update({
      where: { id: garment.garmentId },
      data: { retention_status: 'active' },
    })
    expect(await retention.releaseUnheldCopies(own)).toBe(1)

    expect(bucket.objects.has(garment.held)).toBe(false)
  })

  it('stores a digest mismatch where the operator reads it, and writes nothing', async (context) => {
    if (!requireSchema(context)) return
    const garment = await heldPendingGarment(Buffer.from('declared'), new Date())
    bucket.objects.set(garment.staging, Buffer.from('a later generation'))

    expect(await retention.captureHeldSources(new Date(), { userIds: [userId] })).toBe(0)

    expect(bucket.objects.has(garment.held)).toBe(false)
    const row = await prisma.garmentItem.findUniqueOrThrow({
      where: { id: garment.garmentId },
    })
    expect(row.held_source_capture_outcome).toBe('digest_mismatch')
    expect(row.held_source_checked_at).not.toBeNull()
    expect(row.held_source_object_path).toBeNull()
  })

  /**
   * Codex C5-6: an API instance from before the attempt column can start a wardrobe analysis
   * after the migration ran, writing processing with no attempt. The new worker skips its job
   * and the handoff skipped the row, so the member saw an analysis in progress for good. The
   * maintenance handoff now assigns a durable attempt under a guarded update, enqueues it, and
   * that job completes the analysis; the old job still exits without writing.
   */
  it('recovers a wardrobe analysis an old API instance started with no attempt', async (context) => {
    if (!requireSchema(context)) return
    const profile = await prisma.paletteProfile.create({
      data: {
        user_id: userId,
        consent_granted_at: new Date(),
        source: 'wardrobe',
        status: 'processing',
      },
    })
    // Written by the old instance past the handoff grace period.
    await prisma.$executeRaw`UPDATE "PaletteProfile" SET updated_at = now() - interval '1 hour' WHERE id = ${profile.id}`

    const enqueued: [string, string][] = []
    const publishers = {
      garment: { enqueue: () => Promise.resolve() },
      silhouette: { enqueue: () => Promise.resolve() },
      palette: {
        enqueue: (profileId: string, attemptId: string) => {
          enqueued.push([profileId, attemptId])
          return Promise.resolve()
        },
      },
    }
    await reenqueueStrandedProcessing(prisma, publishers, new Date(), {
      userIds: [userId],
    })

    const assigned = await prisma.paletteProfile.findUniqueOrThrow({
      where: { id: profile.id },
    })
    expect(assigned.analysis_attempt_id).toMatch(/^[0-9a-f-]{36}$/)
    expect(assigned.processing_job_enqueued_at).not.toBeNull()
    expect(enqueued.filter(([id]) => id === profile.id)).toEqual([
      [profile.id, assigned.analysis_attempt_id],
    ])

    process.env.PALETTE_ANALYSIS_ENGINE = 'fixture'
    process.env.ALLOW_TEST_ONLY_SECRETS = 'true'
    const processor = new PaletteAnalysisProcessor(
      prisma,
      bucket as never,
      new FixturePaletteAnalysisEngine(),
      { captureEvent: () => Promise.resolve() } as unknown as TelemetryService
    )
    // The old instance's job names no attempt and still exits without writing.
    await processor.process(profile.id, null)
    await expect(
      prisma.paletteProfile.findUniqueOrThrow({ where: { id: profile.id } })
    ).resolves.toMatchObject({ status: 'processing' })

    await processor.process(profile.id, assigned.analysis_attempt_id)
    const finished = await prisma.paletteProfile.findUniqueOrThrow({
      where: { id: profile.id },
    })
    expect(finished.status).not.toBe('processing')
  })

  /**
   * Codex C5-7: a hold that lands before the color job runs makes the worker decline the
   * garment, and the job completes; BullMQ keeps its id (the garment id) for seven days, so a
   * plain re-enqueue after release is a no-op and the garment sat in processing. The worker now
   * records the deferral and clears the marker, and the handoff enqueues a job id derived from
   * it once the garment is active again. The queue here is real.
   */
  it('finishes a garment a hold deferred once the hold is released, on a real queue', async (context) => {
    if (!requireSchema(context)) return
    const found = queueConfigs.find((config) => config.name === 'color-extraction')
    if (!found) throw new Error('color-extraction queue configuration is missing')
    const producer = new WardrobeProcessingQueue({
      name: queueName,
      options: found.options,
    })
    const color = new WardrobeColorProcessor(prisma, bucket as never)
    const worker = new Worker<GarmentColorProcessingJob>(
      queueName,
      async (job) => {
        await color.process(job.data.garmentId)
      },
      { connection: redisOptions }
    )
    const events = new QueueEvents(queueName, { connection: redisOptions })
    const inspector = new Queue(queueName, { connection: redisOptions })
    try {
      await events.waitUntilReady()
      const garmentId = randomUUID()
      const objectPath = `wardrobe/${userId}/${garmentId}.jpg`
      bucket.objects.set(objectPath, Buffer.from('not an image; the hex falls back'))
      await prisma.garmentItem.create({
        data: {
          id: garmentId,
          user_id: userId,
          object_path: objectPath,
          upload_status: 'processing',
          retention_status: 'legal_hold',
          committed_at: new Date(Date.now() - PROCESSING_HANDOFF_GRACE_MS - 60_000),
          processing_job_enqueued_at: new Date(),
        },
      })

      // The commit's job runs while the hold stands: declined, recorded, marker cleared.
      const firstDone = new Promise<void>((resolve) => {
        events.on('completed', ({ jobId }) => {
          if (jobId === garmentId) resolve()
        })
      })
      await producer.enqueue(garmentId)
      await firstDone
      const deferred = await prisma.garmentItem.findUniqueOrThrow({
        where: { id: garmentId },
      })
      expect(deferred).toMatchObject({
        upload_status: 'processing',
        processing_job_enqueued_at: null,
      })
      expect(deferred.processing_deferred_at).not.toBeNull()
      // The mechanism the finding names: the first job's id is kept as completed.
      expect(await (await inspector.getJob(garmentId))?.getState()).toBe('completed')

      // The operator releases the hold; the hourly handoff picks the garment up.
      await prisma.garmentItem.update({
        where: { id: garmentId },
        data: { retention_status: 'active' },
      })
      const recoveryJobId = `${garmentId}__deferred-${deferred.processing_deferred_at!.getTime()}`
      const recovered = new Promise<void>((resolve) => {
        events.on('completed', ({ jobId }) => {
          if (jobId === recoveryJobId) resolve()
        })
      })
      const noop = { enqueue: () => Promise.resolve() }
      await reenqueueStrandedProcessing(
        prisma,
        { garment: producer, silhouette: noop, palette: noop },
        new Date(),
        { userIds: [userId] }
      )
      await recovered

      const finished = await prisma.garmentItem.findUniqueOrThrow({
        where: { id: garmentId },
      })
      expect(finished.upload_status).toBe('awaiting_tags')
      expect(finished.processing_job_enqueued_at).not.toBeNull()
    } finally {
      await worker.close()
      await events.close()
      await inspector.obliterate({ force: true }).catch(() => undefined)
      await inspector.close()
      await producer.onModuleDestroy()
    }
  })
})
