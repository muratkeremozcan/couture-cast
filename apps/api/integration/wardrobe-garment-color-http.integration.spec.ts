// Story 7.5 test plan 7.5-INT-001..003: header-gated garment colorFamily over HTTP against real
// PostgreSQL. Risk R1 (legacy strict clients) and R2 (tags persist) at the integration level.
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
  const storage = {
    signReadUrl: vi.fn((path: string) =>
      Promise.resolve(`https://storage.test/${path}?token=signed`)
    ),
  }
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
