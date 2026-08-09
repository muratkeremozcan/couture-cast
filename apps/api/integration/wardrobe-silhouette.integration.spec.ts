import 'reflect-metadata'
import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { ForbiddenException, PreconditionFailedException } from '@nestjs/common'
import { Worker } from 'bullmq'
import { getRedisConfig, redisOptionsFromConfig } from '../src/config/redis.js'
import {
  formatSilhouetteETag,
  WardrobeSilhouetteService,
} from '../src/modules/wardrobe/wardrobe-silhouette.service.js'
import type { GuardianService } from '../src/modules/guardian/guardian.service.js'
import {
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

describe('4.4 wardrobe silhouette against real PostgreSQL', () => {
  const namespace = `silhouette-it-${randomUUID().slice(0, 8)}`
  let userId: string
  let guardian: StubGuardianService
  let storage: MemoryWardrobeStorage
  let queue: SilhouettePhotoProcessingQueue
  let serviceA: WardrobeSilhouetteService
  let serviceB: WardrobeSilhouetteService

  beforeAll(async () => {
    await probeSchema()
    process.env.WARDROBE_UPLOAD_TOKEN_SECRET = 'a'.repeat(32)
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

  it('4.4-INT-10 returns the virtual default profile with no persisted row', async (context) => {
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

    await expect(
      serviceA.updateSliders(userId, undefined, { heightSlider: 10, buildSlider: 10 })
    ).rejects.toBeInstanceOf(Error)

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
    const { createHash } = await import('node:crypto')
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
        worker.on('completed', (job) => {
          if (job.data.silhouetteProfileId === profileId) {
            clearTimeout(timeout)
            resolve()
          }
        })
        worker.on('failed', (_job, err) => {
          clearTimeout(timeout)
          reject(err)
        })
      })
    } finally {
      await worker.close()
    }

    // Exactly one worker instance processed exactly one job for this
    // profile -- the regression Risk 4.4-R01 exists to prevent is two live
    // consumers splitting jobs so a fraction are silently never moderated.
    expect(processedJobIds).toHaveLength(1)

    const finalRow = await prismaA.silhouetteProfile.findUniqueOrThrow({
      where: { id: profileId },
    })
    expect(finalRow.my_form_status).toBe('ready')
    expect(finalRow.mode).toBe('my_form')
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
})
