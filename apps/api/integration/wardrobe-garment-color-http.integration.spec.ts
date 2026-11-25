// Story 7.5 test plan 7.5-INT-001..003: header-gated garment colorFamily over HTTP against real
// PostgreSQL. Risk R1 (legacy strict clients) and R2 (tags persist) at the integration level.
// 7.5-INT-004..007 (Codex P2.1, P2.2): an editor's `expected` tags refuse a stale Done or Undo
// inside the transaction, and a committed edit answers 200 even when its photo cannot be signed.
// Learning path Step 63: Garment detail and tag edit.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-63-garment-detail-and-tag-edit
import 'reflect-metadata'
import { randomUUID } from 'node:crypto'
import { Test } from '@nestjs/testing'
import { PrismaClient } from '@prisma/client'
import request from 'supertest'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import {
  GARMENT_TAGS_CHANGED_MESSAGE,
  garmentItemSchema,
  garmentItemWithColorSchema,
  WARDROBE_GARMENT_COLOR_HEADER,
} from '@couture/api-client/contracts/http'
import { buildGarmentObjectPath, colorFamilyFromHex } from '@couture/utils'
import { AccessTokenIdentityService } from '../src/modules/auth/access-token-identity.service.js'
import { GuardianConsentStateService } from '../src/modules/auth/guardian-consent-state.service.js'
import { GuardianService } from '../src/modules/guardian/guardian.service.js'
import { WardrobeController } from '../src/modules/wardrobe/wardrobe.controller.js'
import { WardrobeRetentionService } from '../src/modules/wardrobe/wardrobe-retention.service.js'
import { WardrobeService } from '../src/modules/wardrobe/wardrobe.service.js'
import { listenHttpApp } from '../src/testing/loopback-http-app.js'
import { isolatedCommunityDatabase } from './helpers/isolated-community-database.js'

vi.mock('../src/workers/base.worker.js', () => ({
  defaultWorkerOptions: () => ({}),
  createWorker: () => ({
    on: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
    client: Promise.resolve({
      set: vi.fn().mockResolvedValue('OK'),
      del: vi.fn().mockResolvedValue(1),
    }),
  }),
}))

const database = isolatedCommunityDatabase()
const prisma = new PrismaClient({ datasources: { db: { url: database.url } } })
const namespace = `wardrobe-color-${randomUUID()}`
const BLUE_HEX = '#1e3cc8'
const LEGACY_KEYS = Object.keys(garmentItemSchema.shape).sort()

const record = z.record(z.string(), z.unknown())
/** The garments of a list response, as plain objects so key sets can be compared. */
const listOf = (body: unknown) => z.object({ data: z.array(record) }).parse(body).data
/** The garment of a single-garment response. */
const itemOf = (body: unknown) => z.object({ data: record }).parse(body).data

const storage = {
  signReadUrl: vi.fn((path: string) =>
    Promise.resolve(`https://storage.test/${path}?token=signed`)
  ),
}

let api: ReturnType<typeof request>
let closeApp: () => Promise<void>

async function member() {
  const user = await prisma.user.create({
    data: {
      email: `${namespace}-${randomUUID()}@synthetic.test`,
      profile: {
        create: {
          birthdate: new Date('1990-01-01T00:00:00Z'),
          preferences: { compliance: { accountStatus: 'active' } },
        },
      },
    },
  })
  return { userId: user.id, auth: `Bearer test-token:guardian:${user.id}` }
}

async function readyGarment(userId: string, dominantHex: string | null) {
  const id = randomUUID()
  await prisma.garmentItem.create({
    data: {
      id,
      user_id: userId,
      object_path: buildGarmentObjectPath(userId, id, 'png'),
      mime_type: 'image/png',
      file_size_bytes: 2048,
      category: 'top',
      material: 'cotton',
      comfort_range: 'mild',
      upload_status: 'ready',
      retention_status: 'active',
      tags_confirmed_at: new Date('2026-11-01T00:00:00Z'),
      committed_at: new Date('2026-11-01T00:00:00Z'),
      ...(dominantHex ? { color_palette: { dominant: dominantHex } } : {}),
    },
  })
  return id
}

beforeAll(async () => {
  await database.migrate()
  const consent = new GuardianConsentStateService(prisma)
  const guardian = new GuardianService({ capture: vi.fn() }, prisma, consent, {
    invalidateUserSessions: vi.fn().mockResolvedValue(undefined),
  } as never)
  const service = new WardrobeService(
    prisma,
    { captureEvent: vi.fn().mockResolvedValue(undefined) } as never,
    guardian,
    storage as never,
    {} as never,
    { invalidateUserCache: vi.fn().mockResolvedValue(true) } as never
  )
  const module = await Test.createTestingModule({
    controllers: [WardrobeController],
    providers: [
      { provide: WardrobeService, useValue: service },
      { provide: WardrobeRetentionService, useValue: {} },
      { provide: GuardianService, useValue: guardian },
      { provide: GuardianConsentStateService, useValue: consent },
      {
        provide: AccessTokenIdentityService,
        useValue: new AccessTokenIdentityService(prisma),
      },
    ],
  }).compile()
  const app = module.createNestApplication()
  app.useLogger(false)
  api = request(await listenHttpApp(app))
  closeApp = () => app.close()
}, 60_000)

afterEach(() => vi.unstubAllEnvs())

afterAll(async () => {
  try {
    await closeApp?.()
    await prisma.$disconnect()
  } finally {
    await database.drop()
  }
})

describe('7.5 garment colorFamily over HTTP (pg17)', () => {
  it('[P0] [7.5-INT-001] keeps the legacy keys without the header and adds colorFamily with it', async () => {
    vi.stubEnv('TEST_ENV', 'local')
    const owner = await member()
    const blueId = await readyGarment(owner.userId, BLUE_HEX)
    const unknownId = await readyGarment(owner.userId, null)

    const legacy = await api
      .get('/api/v1/wardrobe/garments')
      .set('Authorization', owner.auth)
    expect(legacy.status).toBe(200)
    expect(listOf(legacy.body)).toHaveLength(2)
    for (const garment of listOf(legacy.body)) {
      expect(Object.keys(garment).sort()).toEqual(LEGACY_KEYS)
      expect(() => garmentItemSchema.parse(garment)).not.toThrow()
    }

    // Only the exact value 1 opts in.
    for (const value of ['0', 'true', 'yes']) {
      const notOptedIn = await api
        .get('/api/v1/wardrobe/garments')
        .set('Authorization', owner.auth)
        .set(WARDROBE_GARMENT_COLOR_HEADER, value)
      expect(notOptedIn.status).toBe(200)
      expect(listOf(notOptedIn.body)[0]).not.toHaveProperty('colorFamily')
    }

    const opted = await api
      .get('/api/v1/wardrobe/garments')
      .set('Authorization', owner.auth)
      .set(WARDROBE_GARMENT_COLOR_HEADER, '1')
    expect(opted.status).toBe(200)
    const byId = new Map(
      listOf(opted.body).map((garment) => {
        const parsed = garmentItemWithColorSchema.parse(garment)
        return [parsed.id, parsed]
      })
    )
    expect(colorFamilyFromHex(BLUE_HEX)).toBe('blue')
    expect(byId.get(blueId)).toMatchObject({ colorFamily: 'blue' })
    expect(byId.get(unknownId)).toMatchObject({ colorFamily: null })
  })

  it('[P0] [7.5-INT-002] PATCH tags with the header returns the new tags and colorFamily, and they read back', async () => {
    vi.stubEnv('TEST_ENV', 'local')
    const owner = await member()
    const garmentId = await readyGarment(owner.userId, BLUE_HEX)

    const patched = await api
      .patch(`/api/v1/wardrobe/garments/${garmentId}/tags`)
      .set('Authorization', owner.auth)
      .set(WARDROBE_GARMENT_COLOR_HEADER, '1')
      .send({ category: 'outerwear', material: 'wool', comfortRange: 'cold' })
    expect(patched.status).toBe(200)
    expect(garmentItemWithColorSchema.parse(itemOf(patched.body))).toMatchObject({
      id: garmentId,
      category: 'outerwear',
      material: 'wool',
      comfortRange: 'cold',
      colorFamily: 'blue',
      status: 'ready',
    })

    const cleared = await api
      .patch(`/api/v1/wardrobe/garments/${garmentId}/tags`)
      .set('Authorization', owner.auth)
      .send({ category: 'outerwear', material: null, comfortRange: 'cold' })
    expect(cleared.status).toBe(200)
    expect(Object.keys(itemOf(cleared.body)).sort()).toEqual(LEGACY_KEYS)
    expect(itemOf(cleared.body).material).toBeNull()

    const reread = await api
      .get('/api/v1/wardrobe/garments')
      .set('Authorization', owner.auth)
      .set(WARDROBE_GARMENT_COLOR_HEADER, '1')
    expect(listOf(reread.body)).toEqual([
      expect.objectContaining({
        id: garmentId,
        category: 'outerwear',
        material: null,
        comfortRange: 'cold',
        colorFamily: 'blue',
      }),
    ])
  })

  it('[P1] [7.5-INT-003] refuses another member PATCH with the header and leaves the tags untouched', async () => {
    vi.stubEnv('TEST_ENV', 'local')
    const owner = await member()
    const intruder = await member()
    const garmentId = await readyGarment(owner.userId, BLUE_HEX)

    const refused = await api
      .patch(`/api/v1/wardrobe/garments/${garmentId}/tags`)
      .set('Authorization', intruder.auth)
      .set(WARDROBE_GARMENT_COLOR_HEADER, '1')
      .send({ category: 'bottom', material: 'denim', comfortRange: 'warm' })
    expect(refused.status).toBe(404)
    expect(refused.body).not.toHaveProperty('data')

    const stored = await prisma.garmentItem.findUniqueOrThrow({
      where: { id: garmentId },
    })
    expect(stored).toMatchObject({
      category: 'top',
      material: 'cotton',
      comfort_range: 'mild',
    })
  })
})

describe('7.5 stale edits and signing outages over HTTP (pg17)', () => {
  const tagsPath = (id: string) => `/api/v1/wardrobe/garments/${id}/tags`
  const seen = { category: 'top', material: 'cotton', comfortRange: 'mild' } as const

  async function storedTags(garmentId: string) {
    const row = await prisma.garmentItem.findUniqueOrThrow({ where: { id: garmentId } })
    return {
      category: row.category,
      material: row.material,
      comfortRange: row.comfort_range,
    }
  }

  it('[P0] [7.5-INT-004] refuses a Done whose expected tags another edit already changed', async () => {
    vi.stubEnv('TEST_ENV', 'local')
    const owner = await member()
    const garmentId = await readyGarment(owner.userId, BLUE_HEX)

    // Another device saves first, from the same starting tags.
    const first = await api
      .patch(tagsPath(garmentId))
      .set('Authorization', owner.auth)
      .send({ category: 'top', material: 'wool', comfortRange: 'mild', expected: seen })
    expect(first.status).toBe(200)

    const stale = await api
      .patch(tagsPath(garmentId))
      .set('Authorization', owner.auth)
      .set(WARDROBE_GARMENT_COLOR_HEADER, '1')
      .send({ category: 'top', material: 'cotton', comfortRange: 'cold', expected: seen })
    expect(stale.status).toBe(409)
    expect(stale.body).toMatchObject({
      statusCode: 409,
      message: GARMENT_TAGS_CHANGED_MESSAGE,
    })
    expect(await storedTags(garmentId)).toEqual({
      category: 'top',
      material: 'wool',
      comfortRange: 'mild',
    })
  })

  it('[P0] [7.5-INT-005] refuses a stale Undo and applies a current one', async () => {
    vi.stubEnv('TEST_ENV', 'local')
    const owner = await member()
    const garmentId = await readyGarment(owner.userId, BLUE_HEX)
    const saved = { category: 'top', material: 'wool', comfortRange: 'cold' } as const
    expect(
      (
        await api
          .patch(tagsPath(garmentId))
          .set('Authorization', owner.auth)
          .send({ ...saved, expected: seen })
      ).status
    ).toBe(200)
    // A later edit lands before the Undo of the first one.
    expect(
      (
        await api
          .patch(tagsPath(garmentId))
          .set('Authorization', owner.auth)
          .send({ ...saved, comfortRange: 'hot', expected: saved })
      ).status
    ).toBe(200)

    const staleUndo = await api
      .patch(tagsPath(garmentId))
      .set('Authorization', owner.auth)
      .send({ ...seen, expected: saved })
    expect(staleUndo.status).toBe(409)
    expect(staleUndo.body).toMatchObject({ message: GARMENT_TAGS_CHANGED_MESSAGE })
    expect(await storedTags(garmentId)).toEqual({ ...saved, comfortRange: 'hot' })

    const currentUndo = await api
      .patch(tagsPath(garmentId))
      .set('Authorization', owner.auth)
      .send({ ...saved, expected: { ...saved, comfortRange: 'hot' } })
    expect(currentUndo.status).toBe(200)
    expect(await storedTags(garmentId)).toEqual(saved)
  })

  it('[P1] [7.5-INT-006] a stale expected wins over an unchanged request, and a request without expected applies as before', async () => {
    vi.stubEnv('TEST_ENV', 'local')
    const owner = await member()
    const garmentId = await readyGarment(owner.userId, BLUE_HEX)

    // CodeRabbit: the editor's view is checked first, so a stale editor learns the tags
    // changed even when its request happens to equal the stored row.
    const unchanged = await api
      .patch(tagsPath(garmentId))
      .set('Authorization', owner.auth)
      .send({ ...seen, expected: { ...seen, material: 'linen' } })
    expect(unchanged.status).toBe(409)
    expect(unchanged.body).toMatchObject({ message: GARMENT_TAGS_CHANGED_MESSAGE })

    const current = await api
      .patch(tagsPath(garmentId))
      .set('Authorization', owner.auth)
      .send({ ...seen, expected: seen })
    expect(current.status).toBe(200)

    const legacy = await api
      .patch(tagsPath(garmentId))
      .set('Authorization', owner.auth)
      .send({ category: 'dress', material: null, comfortRange: 'warm' })
    expect(legacy.status).toBe(200)
    expect(await storedTags(garmentId)).toEqual({
      category: 'dress',
      material: null,
      comfortRange: 'warm',
    })
  })

  it('[P0] [7.5-INT-007] answers the committed tags without a photo when signing fails after the write', async () => {
    vi.stubEnv('TEST_ENV', 'local')
    const owner = await member()
    const garmentId = await readyGarment(owner.userId, BLUE_HEX)
    storage.signReadUrl.mockRejectedValueOnce(new Error('storage unavailable'))

    const saved = await api
      .patch(tagsPath(garmentId))
      .set('Authorization', owner.auth)
      .set(WARDROBE_GARMENT_COLOR_HEADER, '1')
      .send({ category: 'top', material: 'wool', comfortRange: 'cold', expected: seen })

    expect(saved.status).toBe(200)
    expect(garmentItemWithColorSchema.parse(itemOf(saved.body))).toMatchObject({
      id: garmentId,
      material: 'wool',
      comfortRange: 'cold',
      colorFamily: 'blue',
      imageAccess: null,
    })
    expect(await storedTags(garmentId)).toEqual({
      category: 'top',
      material: 'wool',
      comfortRange: 'cold',
    })
  })
})
