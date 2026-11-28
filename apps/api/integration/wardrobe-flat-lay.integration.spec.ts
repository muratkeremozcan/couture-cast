// Learning path Step 86: Several garments from one flat-lay photo.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-86-several-garments-from-one-flat-lay-photo
import 'reflect-metadata'
import { createHash, randomUUID } from 'node:crypto'
import type { NextFunction, Request, Response } from 'express'
import { Test } from '@nestjs/testing'
import { PrismaClient } from '@prisma/client'
import {
  flatLayConfirmResponseSchema,
  flatLayReviewResponseSchema,
  type FlatLayReview,
  type FlatLaySelection,
} from '@couture/api-client/contracts/http'
import sharp from 'sharp'
import request from 'supertest'
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { configureApp, JSON_BODY_LIMIT_BYTES } from '../src/bootstrap/configure-app.js'
import type * as PinoConfig from '../src/logger/pino.config.js'
import { AccessTokenIdentityService } from '../src/modules/auth/access-token-identity.service.js'
import { GuardianConsentStateService } from '../src/modules/auth/guardian-consent-state.service.js'
import { GuardianService } from '../src/modules/guardian/guardian.service.js'
import { RitualService } from '../src/modules/personalization/ritual.service.js'
import { TelemetryService } from '../src/modules/telemetry/telemetry.service.js'
import { FlatLayController } from '../src/modules/wardrobe/flat-lay.controller.js'
import {
  FlatLayDetector,
  type FlatLayDetection,
} from '../src/modules/wardrobe/flat-lay-detector.js'
import { FlatLayService } from '../src/modules/wardrobe/flat-lay.service.js'
import { WardrobeProcessingQueue } from '../src/modules/wardrobe/wardrobe-processing.queue.js'
import { PUBLISH_CLAIM_LEASE_MS } from '../src/modules/wardrobe/wardrobe-publication.js'
import { SupabaseWardrobeStorageAdapter } from '../src/modules/wardrobe/wardrobe-storage.adapter.js'
import { WardrobeRetentionService } from '../src/modules/wardrobe/wardrobe-retention.service.js'
import { WardrobeService } from '../src/modules/wardrobe/wardrobe.service.js'
import { listenHttpApp } from '../src/testing/loopback-http-app.js'
import { isolatedCommunityDatabase } from './helpers/isolated-community-database.js'

const path = '/api/v1/wardrobe/flat-lay'
const reviewLifetimeMs = 15 * 60_000
const exifArtist = 'synthetic-private-flat-lay-artist'
const database = isolatedCommunityDatabase()
const prisma = new PrismaClient({ datasources: { db: { url: database.url } } })
const detect = vi.fn<(photo: Buffer) => Promise<FlatLayDetection>>()
const objects = new Map<string, { bytes: Buffer; contentType: string }>()
const { logLines } = vi.hoisted(() => ({ logLines: [] as string[] }))
vi.mock('../src/logger/pino.config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof PinoConfig>()
  return {
    ...actual,
    createBaseLogger: (options: Parameters<typeof actual.createBaseLogger>[0] = {}) =>
      actual.createBaseLogger({
        ...options,
        env: { LOG_LEVEL: 'trace' },
        destination: { write: (line: string) => logLines.push(line) },
      }),
  }
})
const rawConfirmBodies: (Buffer | undefined)[] = []
const write = (objectPath: string, bytes: Buffer, contentType: string) => {
  objects.set(objectPath, { bytes: Buffer.from(bytes), contentType })
}
const publish = (objectPath: string, bytes: Buffer, contentType: string) => {
  write(objectPath, bytes, contentType)
  return Promise.resolve()
}
const storage = {
  createUploadSession: vi.fn(),
  publish: vi.fn(publish),
  publishOnce: vi.fn((objectPath: string, bytes: Buffer, contentType: string) => {
    if (objects.has(objectPath)) return Promise.resolve('exists' as const)
    write(objectPath, bytes, contentType)
    return Promise.resolve('created' as const)
  }),
  remove: vi.fn((objectPaths: string[]) => {
    for (const objectPath of objectPaths) objects.delete(objectPath)
    return Promise.resolve()
  }),
  signReadUrl: vi.fn((objectPath: string) =>
    Promise.resolve(`https://storage.test/${objectPath}`)
  ),
}

type ReviewedItem = FlatLayReview['items'][number]
type Confirmation = FlatLaySelection['items'][number]

let api: ReturnType<typeof request>
let closeApp: (() => Promise<void>) | undefined
let photo: Buffer
let topMask: Buffer
let bottomMask: Buffer
let removedMask: Buffer

async function member() {
  const user = await prisma.user.create({
    data: {
      email: `${randomUUID()}@synthetic.test`,
      profile: {
        create: {
          birthdate: new Date('1990-01-01T00:00:00Z'),
          preferences: { compliance: { accountStatus: 'active' } },
        },
      },
    },
  })
  return { id: user.id, auth: `Bearer test-token:guardian:${user.id}` }
}

const review = (auth: string) =>
  api
    .post(`${path}/review`)
    .set('Authorization', auth)
    .attach('photo', photo, {
      filename: `${exifArtist}.jpg`,
      contentType: 'image/jpeg',
    })

const confirm = (auth: string, items: Confirmation[]) =>
  api.post(`${path}/confirm`).set('Authorization', auth).send({ items })

function confirmation(
  { id, mask, token }: ReviewedItem,
  category: Confirmation['tags']['category']
): Confirmation {
  return { id, mask, token, tags: { category } }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

const saved = (userId: string) =>
  prisma.garmentItem.findMany({
    where: { user_id: userId },
    select: { id: true, category: true, object_path: true, committed_at: true },
  })

async function imageMask(background: string) {
  return sharp({ create: { width: 254, height: 254, channels: 4, background } })
    .extend({ top: 1, right: 1, bottom: 1, left: 1, background: '#00000000' })
    .webp({ lossless: true })
    .toBuffer()
}

async function texturedMask() {
  // Fixed high-detail pixels keep the positive confirmation above the generic JSON limit.
  const width = 254
  const height = 254
  const pixels = createHash('shake256', { outputLength: width * height * 3 })
    .update('flat-lay-textured-mask')
    .digest()
  return sharp(pixels, { raw: { width, height, channels: 3 } })
    .ensureAlpha()
    .extend({ top: 1, right: 1, bottom: 1, left: 1, background: '#00000000' })
    .webp({ lossless: true })
    .toBuffer()
}

beforeAll(async () => {
  await database.migrate()
  vi.stubEnv('TEST_ENV', 'local')
  vi.stubEnv('ANALYTICS_ID_SECRET', 'synthetic-flat-lay-signing-test-key')
  ;[photo, topMask, bottomMask, removedMask] = await Promise.all([
    sharp({ create: { width: 256, height: 256, channels: 3, background: '#e6e1d6' } })
      .withExif({ IFD0: { Artist: exifArtist } })
      .jpeg()
      .toBuffer(),
    texturedMask(),
    imageMask('#304694'),
    imageMask('#3b7444'),
  ])
  const consent = new GuardianConsentStateService(prisma)
  const guardian = new GuardianService({ capture: vi.fn() }, prisma, consent, {
    invalidateUserSessions: vi.fn().mockResolvedValue(undefined),
  } as never)
  const module = await Test.createTestingModule({
    controllers: [FlatLayController],
    providers: [
      FlatLayService,
      WardrobeService,
      { provide: FlatLayDetector, useValue: { detect } },
      { provide: PrismaClient, useValue: prisma },
      { provide: SupabaseWardrobeStorageAdapter, useValue: storage },
      {
        provide: TelemetryService,
        useValue: { captureEvent: vi.fn().mockResolvedValue(undefined) },
      },
      { provide: WardrobeProcessingQueue, useValue: {} },
      {
        provide: RitualService,
        useValue: { invalidateUserCache: vi.fn().mockResolvedValue(true) },
      },
      { provide: GuardianService, useValue: guardian },
      { provide: GuardianConsentStateService, useValue: consent },
      {
        provide: AccessTokenIdentityService,
        useValue: new AccessTokenIdentityService(prisma),
      },
    ],
  }).compile()
  const app = module.createNestApplication({ bodyParser: false })
  app.useLogger(false)
  configureApp(app)
  app.use((req: Request & { rawBody?: Buffer }, _res: Response, next: NextFunction) => {
    if (req.path === `${path}/confirm`) rawConfirmBodies.push(req.rawBody)
    next()
  })
  closeApp = () => app.close()
  api = request(await listenHttpApp(app))
}, 60_000)

beforeEach(() => {
  vi.clearAllMocks()
  storage.publish.mockImplementation(publish)
  objects.clear()
  logLines.length = 0
  rawConfirmBodies.length = 0
  detect.mockResolvedValue({
    kind: 'accepted',
    items: [
      { bytes: topMask, category: 'top' },
      { bytes: bottomMask, category: 'bottom' },
      { bytes: removedMask, category: 'shoes' },
    ],
  })
})

afterEach(() => vi.useRealTimers())

afterAll(async () => {
  vi.unstubAllEnvs()
  try {
    await closeApp?.()
    await prisma.$disconnect()
  } finally {
    await database.drop()
  }
})

describe('CC-7.29 flat-lay review and confirmation over HTTP', () => {
  it('[P0] [7.29-REJECT] refuses missing, oversized, or malformed input before the detector or storage', async () => {
    const owner = await member()
    const missing = await api.post(`${path}/review`).set('Authorization', owner.auth)
    const oversized = await api
      .post(`${path}/review`)
      .set('Authorization', owner.auth)
      .attach('photo', Buffer.alloc(4 * 1024 * 1024 + 1), {
        filename: 'oversized.jpg',
        contentType: 'image/jpeg',
      })
    const missingItems = await confirm(owner.auth, [])

    expect([missing.status, oversized.status, missingItems.status]).toEqual([
      422, 413, 400,
    ])
    expect(missing.body).toMatchObject({ message: 'FLAT_LAY_UNCERTAIN' })
    expect(missingItems.body).toMatchObject({ message: 'FLAT_LAY_INVALID' })
    expect(detect).not.toHaveBeenCalled()
    expect(objects.size).toBe(0)
    expect(await saved(owner.id)).toEqual([])
  })

  it.each([
    { kind: 'person', message: 'FLAT_LAY_PERSON' },
    { kind: 'uncertain', message: 'FLAT_LAY_UNCERTAIN' },
  ] as const)(
    '[P0] [7.29-REJECT] refuses $kind before any photo write',
    async ({ kind, message }) => {
      const owner = await member()
      detect.mockResolvedValueOnce({ kind })

      const rejected = await review(owner.auth)

      expect(rejected.status).toBe(422)
      expect(rejected.body).toMatchObject({ message })
      expect(rejected.body).not.toHaveProperty('items')
      expect(rejected.headers['cache-control']).toContain('no-store')
      expect(detect).toHaveBeenCalledExactlyOnceWith(photo)
      expect(storage.createUploadSession).not.toHaveBeenCalled()
      expect(objects.size).toBe(0)
      expect(await saved(owner.id)).toEqual([])
    }
  )

  it('[P1] [7.29-REJECT] gives the same member a retryable busy response while another member can review', async () => {
    const owner = await member()
    const other = await member()
    const started = deferred<void>()
    const release = deferred<FlatLayDetection>()
    detect.mockImplementationOnce(() => {
      started.resolve()
      return release.promise
    })
    const first = review(owner.auth).then((response) => response)

    try {
      await Promise.race([
        started.promise,
        first.then(({ status }) => {
          throw new Error(`Review ended before detection (${status})`)
        }),
      ])
      const overlapping = await review(owner.auth)
      const independent = await review(other.auth)

      expect(overlapping.status).toBe(429)
      expect(overlapping.body).toMatchObject({ message: 'FLAT_LAY_BUSY' })
      expect(overlapping.headers['cache-control']).toContain('no-store')
      expect(independent.status).toBe(200)
      expect(flatLayReviewResponseSchema.parse(independent.body).items).toHaveLength(3)
      expect(detect).toHaveBeenCalledTimes(2)
      expect(objects.size).toBe(0)
    } finally {
      release.resolve({ kind: 'uncertain' })
      await first
    }

    const retried = await review(owner.auth)
    expect(retried.status).toBe(200)
    expect(flatLayReviewResponseSchema.parse(retried.body).items).toHaveLength(3)
    expect(detect).toHaveBeenCalledTimes(3)
  })

  it('[P1] [7.29-REJECT] surfaces detector saturation as 429 without publishing a photo', async () => {
    const owner = await member()
    detect.mockResolvedValueOnce({ kind: 'busy' })

    const saturated = await review(owner.auth)

    expect(saturated.status).toBe(429)
    expect(saturated.body).toMatchObject({ message: 'FLAT_LAY_BUSY' })
    expect(saturated.headers['cache-control']).toContain('no-store')
    expect(objects.size).toBe(0)
    expect(await saved(owner.id)).toEqual([])
  })

  it('[P0] [7.29-PRIVATE] binds a mask to its member, item, and signed bytes', async () => {
    const owner = await member()
    const other = await member()
    const staged = await review(owner.auth)
    expect(staged.status).toBe(200)
    expect(staged.headers['cache-control']).toContain('no-store')
    const { items } = flatLayReviewResponseSchema.parse(staged.body)
    expect(items.map(({ category }) => category)).toEqual(['top', 'bottom', 'shoes'])
    expect(objects.size).toBe(0)
    expect(await saved(owner.id)).toEqual([])

    const first = confirmation(items[0]!, 'top')
    const wrongMember = await confirm(other.auth, [first])
    const wrongItem = await confirm(owner.auth, [{ ...first, id: items[1]!.id }])
    const wrongBytes = await confirm(owner.auth, [
      first,
      { ...confirmation(items[1]!, 'bottom'), mask: items[2]!.mask },
    ])
    const duplicate = await confirm(owner.auth, [first, first])
    const malformed = await confirm(owner.auth, [{ ...first, token: 'invalid-format' }])
    const otherReview = flatLayReviewResponseSchema.parse((await review(owner.auth)).body)
    const mixed = await confirm(owner.auth, [
      first,
      confirmation(otherReview.items[0]!, 'top'),
    ])

    for (const rejected of [
      wrongMember,
      wrongItem,
      wrongBytes,
      duplicate,
      malformed,
      mixed,
    ]) {
      expect(rejected.status).toBe(400)
      expect(rejected.body).toMatchObject({ message: 'FLAT_LAY_INVALID' })
    }
    expect(objects.size).toBe(0)
    expect(await saved(owner.id)).toEqual([])
    expect(await saved(other.id)).toEqual([])
  })

  it('[P0] [7.29-PURGE] rejects the same mask after the 15-minute review expires', async () => {
    const owner = await member()
    const startedAt = new Date('2026-11-28T14:30:00.000Z')
    vi.setSystemTime(startedAt)
    const staged = await review(owner.auth)
    expect(staged.status).toBe(200)
    const { items, expiresAt } = flatLayReviewResponseSchema.parse(staged.body)
    expect(Date.parse(expiresAt) - startedAt.getTime()).toBe(reviewLifetimeMs)

    vi.setSystemTime(new Date(startedAt.getTime() + reviewLifetimeMs + 1000))
    const expired = await confirm(owner.auth, [confirmation(items[0]!, 'top')])

    expect(expired.status).toBe(400)
    expect(expired.body).toMatchObject({ message: 'FLAT_LAY_INVALID' })
    expect(objects.size).toBe(0)
    expect(await saved(owner.id)).toEqual([])
  })

  it('[P0] [7.29-REPLAY] saves only kept masks and replays the committed IDs', async () => {
    const owner = await member()
    const staged = await review(owner.auth)
    expect(staged.status).toBe(200)
    const { items } = flatLayReviewResponseSchema.parse(staged.body)
    expect(items).toHaveLength(3)
    const kept: Confirmation[] = [
      confirmation(items[0]!, 'outerwear'),
      {
        ...confirmation(items[1]!, 'bottom'),
        tags: { category: 'bottom', comfortRange: 'mild' },
      },
    ]
    expect(Buffer.byteLength(JSON.stringify({ items: kept }))).toBeGreaterThan(
      JSON_BODY_LIMIT_BYTES
    )
    expect(objects.size).toBe(0)

    const first = await confirm(owner.auth, kept)
    expect(first.status).toBe(200)
    const { garments } = flatLayConfirmResponseSchema.parse(first.body)
    expect(garments).toMatchObject([
      {
        category: 'outerwear',
        comfortRange: null,
        status: 'awaiting_tags',
        tagsConfirmedAt: null,
      },
      { category: 'bottom', comfortRange: 'mild', status: 'ready' },
    ])
    expect(garments[1]?.tagsConfirmedAt).toEqual(expect.any(String))
    const firstIds = garments.map(({ id }) => id)
    expect(new Set(firstIds).size).toBe(2)
    const replay = await confirm(owner.auth, kept)
    expect(replay.status).toBe(200)
    expect(
      flatLayConfirmResponseSchema.parse(replay.body).garments.map(({ id }) => id)
    ).toEqual(firstIds)

    expect(rawConfirmBodies).toEqual([undefined, undefined])
    const editedReplay = await confirm(owner.auth, [
      confirmation(items[0]!, 'top'),
      kept[1]!,
    ])
    expect(editedReplay.status).toBe(400)
    expect(editedReplay.body).toMatchObject({ message: 'FLAT_LAY_INVALID' })
    const subsetReplay = await confirm(owner.auth, [kept[0]!])
    expect(subsetReplay.status).toBe(400)
    expect(subsetReplay.body).toMatchObject({ message: 'FLAT_LAY_INVALID' })
    const inventory = await saved(owner.id)
    expect(inventory.map(({ id }) => id).sort()).toEqual([...firstIds].sort())
    expect(inventory.every(({ committed_at }) => committed_at !== null)).toBe(true)
    expect(inventory.map(({ category }) => category).sort()).toEqual([
      'bottom',
      'outerwear',
    ])
    expect(objects.size).toBe(2)
    expect(storage.publish).toHaveBeenCalledTimes(2)
    expect(storage.createUploadSession).not.toHaveBeenCalled()
    const expectedMasks = new Map([
      ['outerwear', topMask],
      ['bottom', bottomMask],
    ])
    for (const garment of inventory) {
      const stored = objects.get(garment.object_path!)
      expect(stored?.contentType).toBe('image/webp')
      expect(stored?.bytes).toEqual(expectedMasks.get(garment.category!))
      const metadata = await sharp(stored!.bytes).metadata()
      expect(metadata.exif).toBeUndefined()
      expect(metadata.xmp).toBeUndefined()
    }
    expect((await sharp(photo).metadata()).exif).toBeDefined()
    const logs = logLines.join('\n')
    expect(logs).toContain(`${path}/review`)
    expect(logs).toContain(`${path}/confirm`)
    expect(logs).not.toContain(exifArtist)
    for (const item of items) {
      expect(logs).not.toContain(item.mask)
      expect(logs).not.toContain(item.token)
    }
  })

  it('[P0] [7.29-REPLAY] resumes a partial confirmation after the publication lease', async () => {
    const owner = await member()
    const startedAt = new Date('2026-11-28T15:00:00.000Z')
    vi.setSystemTime(startedAt)
    const staged = await review(owner.auth)
    expect(staged.status).toBe(200)
    const { items } = flatLayReviewResponseSchema.parse(staged.body)
    const kept = [confirmation(items[0]!, 'top'), confirmation(items[1]!, 'bottom')]
    storage.publish.mockImplementation((objectPath, bytes, contentType) => {
      if (bytes.equals(bottomMask))
        return Promise.reject(new Error('Synthetic storage timeout'))
      return publish(objectPath, bytes, contentType)
    })

    const partiallySaved = await confirm(owner.auth, kept)
    expect(partiallySaved.status).toBe(500)
    const committed = (await saved(owner.id)).filter(
      ({ committed_at }) => committed_at !== null
    )
    expect(committed.map(({ id }) => id)).toEqual([items[0]!.id])
    expect(objects.size).toBe(1)

    storage.publish.mockClear().mockImplementation(publish)
    vi.setSystemTime(new Date(startedAt.getTime() + PUBLISH_CLAIM_LEASE_MS + 1000))
    const resumed = await confirm(owner.auth, kept)

    expect(resumed.status).toBe(200)
    expect(
      flatLayConfirmResponseSchema.parse(resumed.body).garments.map(({ id }) => id)
    ).toEqual([items[0]!.id, items[1]!.id])
    expect(storage.publish).toHaveBeenCalledOnce()
    expect(
      (await saved(owner.id)).filter(({ committed_at }) => committed_at !== null)
    ).toHaveLength(2)
    expect(objects.size).toBe(2)
  })

  it('[P0] [7.29-PURGE] durably schedules an ambiguous final write and purges it at review expiry', async () => {
    const owner = await member()
    const startedAt = new Date('2026-11-28T15:00:00.000Z')
    vi.setSystemTime(startedAt)
    const staged = await review(owner.auth)
    expect(staged.status).toBe(200)
    const { items, expiresAt } = flatLayReviewResponseSchema.parse(staged.body)
    let obligationBeforeWrite: { reason: string; not_before: Date } | null = null
    let unfinishedKey = ''
    storage.publish.mockImplementation(async (objectPath, bytes, contentType) => {
      if (!bytes.equals(bottomMask)) return publish(objectPath, bytes, contentType)
      unfinishedKey = objectPath
      obligationBeforeWrite = await prisma.wardrobeObjectDeletion.findUnique({
        where: { object_path: objectPath },
      })
      await publish(objectPath, bytes, contentType)
      throw new Error('Synthetic lost storage acknowledgement')
    })
    const result = await confirm(owner.auth, [
      confirmation(items[0]!, null),
      confirmation(items[1]!, 'bottom'),
    ])
    expect(result.status).toBe(500)
    const savedPiece = await prisma.garmentItem.findUniqueOrThrow({
      where: { id: items[0]!.id },
    })
    expect(savedPiece).toMatchObject({ category: null, upload_status: 'awaiting_tags' })
    expect(obligationBeforeWrite).toMatchObject({
      reason: 'flat_lay_unfinished',
      not_before: new Date(expiresAt),
    })
    expect(
      await prisma.wardrobeObjectDeletion.findUnique({
        where: { object_path: savedPiece.object_path! },
      })
    ).toBeNull()
    expect(objects.has(unfinishedKey)).toBe(true)

    const retention = new WardrobeRetentionService(prisma, storage as never, {
      invalidateUserCache: vi.fn().mockResolvedValue(true),
    })
    const justBeforeExpiry = new Date(Date.parse(expiresAt) - 1)
    await retention.drainDeletions(justBeforeExpiry)
    expect(objects.has(unfinishedKey)).toBe(true)
    await retention.drainDeletions(new Date(expiresAt))

    expect(objects.has(unfinishedKey)).toBe(false)
    expect(objects.has(savedPiece.object_path!)).toBe(true)
    expect(storage.remove).toHaveBeenCalledWith([unfinishedKey])
  })

  it('[P0] [7.29-PURGE] refuses to commit a stale publication after cleanup removes its object', async () => {
    const owner = await member()
    vi.setSystemTime(new Date('2026-11-28T15:00:00.000Z'))
    const staged = await review(owner.auth)
    expect(staged.status).toBe(200)
    const { items, expiresAt } = flatLayReviewResponseSchema.parse(staged.body)
    const written = deferred<string>()
    const response = deferred<void>()
    storage.publish.mockImplementationOnce(async (objectPath, bytes, contentType) => {
      await publish(objectPath, bytes, contentType)
      written.resolve(objectPath)
      await response.promise
    })
    const completing = confirm(owner.auth, [confirmation(items[0]!, 'top')]).then(
      (result) => result
    )
    const retention = new WardrobeRetentionService(prisma, storage as never, {
      invalidateUserCache: vi.fn().mockResolvedValue(true),
    })

    try {
      const objectPath = await Promise.race([
        written.promise,
        completing.then(({ status }) => {
          throw new Error(`Confirmation ended before publication (${status})`)
        }),
      ])
      expect(objects.has(objectPath)).toBe(true)
      const expiry = new Date(expiresAt)
      vi.setSystemTime(expiry)
      await retention.drainDeletions(expiry)
      expect(objects.has(objectPath)).toBe(false)
      expect(storage.remove).toHaveBeenCalledWith([objectPath])
    } finally {
      response.resolve()
      await completing
    }

    const stale = await completing
    expect(stale.status).toBe(409)
    expect(stale.body).toMatchObject({ message: 'UPLOAD_ALREADY_CLAIMED' })
    expect(
      (await saved(owner.id)).filter(({ committed_at }) => committed_at !== null)
    ).toEqual([])
    expect(objects.size).toBe(0)
  })
})
