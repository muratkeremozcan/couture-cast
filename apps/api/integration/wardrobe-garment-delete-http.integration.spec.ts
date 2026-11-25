// Story 7.6 test plan 7.6-INT-001..007: garment delete and the usage read over HTTP against real
// PostgreSQL, with the hourly retention sweep and the release trigger
// (`garment_hold_release_honours_deletion`) running for real. Risks R3 (legal hold), R4 (a
// released or purge-deferred row stays out of every reader), R5 (usage counts), R6 (no IDOR),
// R10 (a purge that throws after the flip still answers 204) and R11 (saved looks and capsules
// follow the delete). Storage is an in-memory bucket; everything else is the production code.
// Learning path Step 64: Garment delete.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-64-garment-delete
import 'reflect-metadata'
import { randomUUID } from 'node:crypto'
import { Test } from '@nestjs/testing'
import { PrismaClient } from '@prisma/client'
import request from 'supertest'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import {
  garmentListResponseSchema,
  garmentUsageResponseSchema,
} from '@couture/api-client/contracts/http'
import { buildGarmentObjectPath } from '@couture/utils'
import { AccessTokenIdentityService } from '../src/modules/auth/access-token-identity.service.js'
import { GuardianConsentStateService } from '../src/modules/auth/guardian-consent-state.service.js'
import { GuardianService } from '../src/modules/guardian/guardian.service.js'
import { RitualService } from '../src/modules/personalization/ritual.service.js'
import { WardrobeCapsuleRepository } from '../src/modules/wardrobe/wardrobe-capsule.repository.js'
import { WardrobeController } from '../src/modules/wardrobe/wardrobe.controller.js'
import { WardrobeGarmentRemovalController } from '../src/modules/wardrobe/wardrobe-garment-removal.controller.js'
import { WardrobeRetentionService } from '../src/modules/wardrobe/wardrobe-retention.service.js'
import { WardrobeSavedLookController } from '../src/modules/wardrobe/wardrobe-saved-look.controller.js'
import { WardrobeSavedLookService } from '../src/modules/wardrobe/wardrobe-saved-look.service.js'
import { WardrobeService } from '../src/modules/wardrobe/wardrobe.service.js'
import { birthdateForAge } from '../src/testing/birthdate.js'
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

// The hourly sweep reads every row of its database, so this suite owns a whole one.
const database = isolatedCommunityDatabase()
const prisma = new PrismaClient({ datasources: { db: { url: database.url } } })
const namespace = `wardrobe-delete-${randomUUID()}`

/** The bucket as a map: what a purge removed is gone, what a hold keeps stays. */
class MemoryBucket {
  readonly objects = new Set<string>()
  signReadUrl(path: string): Promise<string> {
    return Promise.resolve(`https://storage.test/${path}?token=signed`)
  }
  remove(paths: string[]): Promise<void> {
    for (const path of paths) this.objects.delete(path)
    return Promise.resolve()
  }
  downloadBounded(): Promise<{ status: 'missing' }> {
    return Promise.resolve({ status: 'missing' })
  }
  publishOnce(): Promise<'created'> {
    return Promise.resolve('created')
  }
  listStagedUploads(): Promise<{ objects: never[]; nextCursor: null }> {
    return Promise.resolve({ objects: [], nextCursor: null })
  }
}

const bucket = new MemoryBucket()
let retention: WardrobeRetentionService
let capsules: WardrobeCapsuleRepository
let api: ReturnType<typeof request>
let closeApp: () => Promise<void>

const savedLookListSchema = z.object({
  data: z.array(
    z.object({ id: z.string(), availabilityStatus: z.string() }).passthrough()
  ),
})

async function member(
  role: 'guardian' | 'teen' = 'guardian',
  accountStatus: 'active' | 'pending_guardian_consent' | 'suspended' = 'active'
) {
  const user = await prisma.user.create({
    data: {
      email: `${namespace}-${randomUUID()}@synthetic.test`,
      profile: {
        create: {
          birthdate:
            role === 'teen' ? birthdateForAge(15) : new Date('1990-01-01T00:00:00Z'),
          preferences: { compliance: { accountStatus } },
        },
      },
    },
  })
  return { userId: user.id, auth: `Bearer test-token:${role}:${user.id}` }
}

async function readyGarment(
  userId: string,
  category: 'top' | 'bottom' | 'shoes' = 'top',
  retentionStatus: 'active' | 'legal_hold' = 'active',
  uploadStatus: 'ready' | 'awaiting_tags' = 'ready'
) {
  const id = randomUUID()
  const objectPath = buildGarmentObjectPath(userId, id, 'png')
  await prisma.garmentItem.create({
    data: {
      id,
      user_id: userId,
      object_path: objectPath,
      mime_type: 'image/png',
      file_size_bytes: 2048,
      category,
      material: 'cotton',
      comfort_range: 'mild',
      upload_status: uploadStatus,
      retention_status: retentionStatus,
      tags_confirmed_at: new Date('2026-11-01T00:00:00Z'),
      committed_at: new Date('2026-11-01T00:00:00Z'),
    },
  })
  bucket.objects.add(objectPath)
  return { id, objectPath }
}

/** A saved look holding `slotIds` in its composition and `anchorId` as its anchor. */
async function savedLook(
  userId: string,
  anchorId: string,
  slotIds: readonly string[],
  deletedAt: Date | null = null
) {
  const look = await prisma.savedLook.create({
    data: {
      user_id: userId,
      source: 'style_piece',
      look_id: `look-${randomUUID().slice(0, 8)}`,
      weather: 'mild',
      anchor_garment_id: anchorId,
      anchor_snapshot: { garmentId: anchorId, category: 'top', comfortRange: 'mild' },
      composition: slotIds.map((itemId, slotIndex) => ({
        slotIndex,
        category: slotIndex === 0 ? 'top' : 'bottom',
        kind: 'garment',
        itemId,
      })),
      swaps: {},
      deleted_at: deletedAt,
    },
  })
  return look.id
}

async function capsule(userId: string, garmentIds: readonly string[]) {
  const created = await prisma.outfitCapsule.create({
    data: {
      user_id: userId,
      name: `Capsule ${randomUUID().slice(0, 6)}`,
      occasions: ['work'],
      garment_joins: {
        create: garmentIds.map((garment_id, garment_order) => ({
          user_id: userId,
          garment_id,
          garment_order,
        })),
      },
    },
  })
  return created.id
}

async function listedIds(auth: string) {
  const response = await api.get('/api/v1/wardrobe/garments').set('Authorization', auth)
  expect(response.status).toBe(200)
  return garmentListResponseSchema.parse(response.body).data.map((garment) => garment.id)
}

async function savedLookStatuses(auth: string) {
  const response = await api
    .get('/api/v1/wardrobe/saved-looks')
    .set('Authorization', auth)
  expect(response.status).toBe(200)
  return Object.fromEntries(
    savedLookListSchema
      .parse(response.body)
      .data.map((look) => [look.id, look.availabilityStatus])
  )
}

const row = (id: string) => prisma.garmentItem.findUniqueOrThrow({ where: { id } })

/**
 * The real Ritual over this database: one saved location with no stored weather (TEST_ENV local
 * lets the service write its synthetic snapshot), and Redis as a map the test can clear.
 */
function ritualFor(userId: string) {
  const cache = new Map<string, string>()
  const ritual = new RitualService(
    prisma,
    {
      getLatestWeather: () => Promise.resolve({ status: 'unavailable', data: null }),
    } as never,
    {
      listLocations: () =>
        Promise.resolve([
          {
            id: `location-${userId}`,
            label: 'Home',
            city: 'Chicago',
            locationKey: `ritual-home-${userId}`,
            latitude: 41.88,
            longitude: -87.63,
            timezone: 'America/Chicago',
            isPrimary: true,
          },
        ]),
    } as never,
    {
      get: (key: string) => Promise.resolve(cache.get(key) ?? null),
      set: (key: string, value: string) => {
        cache.set(key, value)
        return Promise.resolve('OK')
      },
    } as never,
    { capture: vi.fn() } as never
  )
  const garmentIds = async () =>
    (await ritual.getOrCreateRitual(userId)).outfits.flatMap(
      (outfit) => outfit.garmentIds
    )
  return { cache, garmentIds }
}

/** Capsule creation validates garment eligibility in the repository, under the shared locks. */
const canBuildCapsuleFrom = async (userId: string, garmentIds: string[]) =>
  capsules
    .createCapsule(userId, { name: 'Eligibility probe', occasions: ['work'], garmentIds })
    .then(
      () => true,
      () => false
    )

beforeAll(async () => {
  await database.migrate()
  const consent = new GuardianConsentStateService(prisma)
  const guardian = new GuardianService({ capture: vi.fn() }, prisma, consent, {
    invalidateUserSessions: vi.fn().mockResolvedValue(undefined),
  } as never)
  const wardrobe = new WardrobeService(
    prisma,
    { captureEvent: vi.fn().mockResolvedValue(undefined) } as never,
    guardian,
    bucket as never,
    {} as never,
    { invalidateUserCache: vi.fn().mockResolvedValue(true) } as never
  )
  retention = new WardrobeRetentionService(
    prisma,
    bucket as never,
    {
      invalidateUserCache: () => Promise.resolve(true),
    } as never
  )
  capsules = new WardrobeCapsuleRepository(prisma)
  const module = await Test.createTestingModule({
    controllers: [
      WardrobeController,
      WardrobeGarmentRemovalController,
      WardrobeSavedLookController,
    ],
    providers: [
      { provide: WardrobeService, useValue: wardrobe },
      { provide: WardrobeRetentionService, useValue: retention },
      {
        provide: WardrobeSavedLookService,
        useValue: new WardrobeSavedLookService(prisma, bucket as never, consent),
      },
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

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

afterAll(async () => {
  try {
    await closeApp?.()
    await prisma.$disconnect()
  } finally {
    await database.drop()
  }
})

describe('7.6 garment delete over HTTP (pg17)', () => {
  it('[P0] [7.6-INT-001] deletes an unused garment: usage 0/0, 204, gone from the list, purged', async () => {
    vi.stubEnv('TEST_ENV', 'local')
    const owner = await member()
    const garment = await readyGarment(owner.userId)

    const usage = await api
      .get(`/api/v1/wardrobe/garments/${garment.id}/usage`)
      .set('Authorization', owner.auth)
    expect(usage.status).toBe(200)
    expect(usage.headers['cache-control']).toBe('private, no-store')
    expect(garmentUsageResponseSchema.parse(usage.body)).toEqual({
      garmentId: garment.id,
      savedLookCount: 0,
      capsuleCount: 0,
    })

    const removed = await api
      .delete(`/api/v1/wardrobe/garments/${garment.id}`)
      .set('Authorization', owner.auth)
    expect(removed.status).toBe(204)
    expect(await listedIds(owner.auth)).not.toContain(garment.id)
    expect(await row(garment.id)).toMatchObject({
      retention_status: 'deletion_pending',
      retention_trigger: 'user_deleted_garment',
      object_path: null,
      upload_status: 'failed',
      failure_code: 'DELETED',
    })
    expect((await row(garment.id)).retention_purged_at).toBeInstanceOf(Date)
    expect(bucket.objects.has(garment.objectPath)).toBe(false)

    // After the purge the usage read answers as for a garment that never existed.
    const after = await api
      .get(`/api/v1/wardrobe/garments/${garment.id}/usage`)
      .set('Authorization', owner.auth)
    expect(after.status).toBe(404)
    expect(after.body).toMatchObject({ message: 'GARMENT_NOT_FOUND' })
  })

  it('[P0] [7.6-INT-002] counts saved looks by anchor or slot once each, skips deleted looks, and counts capsules', async () => {
    vi.stubEnv('TEST_ENV', 'local')
    const owner = await member()
    const top = await readyGarment(owner.userId, 'top')
    const bottom = await readyGarment(owner.userId, 'bottom')
    // Anchor and slot in one look: counts once.
    await savedLook(owner.userId, top.id, [top.id, bottom.id])
    // A slot only, anchored on another piece.
    await savedLook(owner.userId, bottom.id, [top.id, bottom.id])
    // A look the member deleted never counts.
    await savedLook(owner.userId, top.id, [top.id], new Date())
    // A look that holds only the other piece never counts.
    await savedLook(owner.userId, bottom.id, [bottom.id])
    await capsule(owner.userId, [top.id, bottom.id])

    const usage = await api
      .get(`/api/v1/wardrobe/garments/${top.id}/usage`)
      .set('Authorization', owner.auth)
    expect(usage.status).toBe(200)
    expect(garmentUsageResponseSchema.parse(usage.body)).toEqual({
      garmentId: top.id,
      savedLookCount: 2,
      capsuleCount: 1,
    })
  })

  it('[P0] [7.6-INT-003] after the delete the saved looks read missing_garment and the capsule loses the piece', async () => {
    vi.stubEnv('TEST_ENV', 'local')
    const owner = await member()
    const top = await readyGarment(owner.userId, 'top')
    const bottom = await readyGarment(owner.userId, 'bottom')
    const anchored = await savedLook(owner.userId, top.id, [top.id, bottom.id])
    const slotted = await savedLook(owner.userId, bottom.id, [top.id, bottom.id])
    const untouched = await savedLook(owner.userId, bottom.id, [bottom.id])
    const capsuleId = await capsule(owner.userId, [top.id, bottom.id])
    const capsuleBefore = await prisma.outfitCapsule.findUniqueOrThrow({
      where: { id: capsuleId },
    })
    expect(await savedLookStatuses(owner.auth)).toEqual({
      [anchored]: 'ready',
      [slotted]: 'ready',
      [untouched]: 'ready',
    })

    const removed = await api
      .delete(`/api/v1/wardrobe/garments/${top.id}`)
      .set('Authorization', owner.auth)
    expect(removed.status).toBe(204)

    expect(await savedLookStatuses(owner.auth)).toEqual({
      [anchored]: 'missing_garment',
      [slotted]: 'missing_garment',
      [untouched]: 'ready',
    })
    // The capsule keeps the join (CC-4.3 repair flow) and its revision moves once.
    const capsuleAfter = await prisma.outfitCapsule.findUniqueOrThrow({
      where: { id: capsuleId },
      include: { garment_joins: { include: { garment: true } } },
    })
    expect(capsuleAfter.revision).toBe(capsuleBefore.revision + 1)
    expect(
      capsuleAfter.garment_joins.map((join) => [
        join.garment_id,
        join.garment.retention_status,
      ])
    ).toEqual(
      expect.arrayContaining([
        [top.id, 'deletion_pending'],
        [bottom.id, 'active'],
      ])
    )
    expect(await canBuildCapsuleFrom(owner.userId, [top.id, bottom.id])).toBe(false)
  })

  it('[P0] [7.6-INT-004] under a legal hold answers 204, records the request and keeps the hold and the bytes', async () => {
    vi.stubEnv('TEST_ENV', 'local')
    const owner = await member()
    const held = await readyGarment(owner.userId, 'top', 'legal_hold')

    const removed = await api
      .delete(`/api/v1/wardrobe/garments/${held.id}`)
      .set('Authorization', owner.auth)
    // Nothing tells the member about the hold (D4).
    expect(removed.status).toBe(204)
    expect(removed.text).toBe('')
    const recorded = await row(held.id)
    expect(recorded).toMatchObject({
      retention_status: 'legal_hold',
      retention_trigger: 'user_deleted_garment',
      object_path: held.objectPath,
      upload_status: 'ready',
      retention_purged_at: null,
    })
    expect(recorded.deletion_requested_at).toBeInstanceOf(Date)
    const heldUsage = await api
      .get(`/api/v1/wardrobe/garments/${held.id}/usage`)
      .set('Authorization', owner.auth)
    expect(heldUsage.status).toBe(404)
    expect(heldUsage.body).toMatchObject({ message: 'GARMENT_NOT_FOUND' })

    // A repeat records nothing new: the first request time stands.
    const repeat = await api
      .delete(`/api/v1/wardrobe/garments/${held.id}`)
      .set('Authorization', owner.auth)
    expect(repeat.status).toBe(204)
    expect((await row(held.id)).deletion_requested_at).toEqual(
      recorded.deletion_requested_at
    )

    await retention.purgeExpiredAndDeletedGarments()
    expect(await row(held.id)).toMatchObject({
      retention_status: 'legal_hold',
      object_path: held.objectPath,
      retention_purged_at: null,
    })
    expect(bucket.objects.has(held.objectPath)).toBe(true)
    expect(await listedIds(owner.auth)).not.toContain(held.id)
  })

  it('[P0] [7.6-INT-005] releasing a hold with a recorded request lands deletion_pending everywhere, and the sweep purges it', async () => {
    vi.stubEnv('TEST_ENV', 'local')
    const owner = await member()
    const held = await readyGarment(owner.userId, 'top', 'legal_hold')
    const bottom = await readyGarment(owner.userId, 'bottom')
    // A held piece the member never asked to delete.
    const keptHeld = await readyGarment(owner.userId, 'shoes', 'legal_hold')
    const look = await savedLook(owner.userId, held.id, [held.id, bottom.id])
    const removed = await api
      .delete(`/api/v1/wardrobe/garments/${held.id}`)
      .set('Authorization', owner.auth)
    expect(removed.status).toBe(204)
    const firstRequestedAt = (await row(held.id)).deletion_requested_at
    expect(firstRequestedAt).toBeInstanceOf(Date)

    // The operator's release, as a plain update of the column (the runbook's path).
    await prisma.garmentItem.update({
      where: { id: held.id },
      data: { retention_status: 'active' },
    })
    await prisma.garmentItem.update({
      where: { id: keptHeld.id },
      data: { retention_status: 'active' },
    })

    // The trigger turned the release into deletion_pending; a plain release stays active.
    expect((await row(held.id)).retention_status).toBe('deletion_pending')
    expect((await row(keptHeld.id)).retention_status).toBe('active')
    const listed = await listedIds(owner.auth)
    expect(listed).not.toContain(held.id)
    expect(listed).toContain(keptHeld.id)
    expect(await savedLookStatuses(owner.auth)).toEqual({ [look]: 'missing_garment' })
    expect(await canBuildCapsuleFrom(owner.userId, [held.id, bottom.id])).toBe(false)
    const usage = await api
      .get(`/api/v1/wardrobe/garments/${held.id}/usage`)
      .set('Authorization', owner.auth)
    expect(usage.status).toBe(404)

    // A repeat request before the sweep keeps the first recorded request (Codex P3-3).
    const repeated = await api
      .delete(`/api/v1/wardrobe/garments/${held.id}`)
      .set('Authorization', owner.auth)
    expect(repeated.status).toBe(204)
    expect(await row(held.id)).toMatchObject({
      deletion_requested_at: firstRequestedAt,
      retention_trigger: 'user_deleted_garment',
    })

    await retention.purgeExpiredAndDeletedGarments()
    const purged = await row(held.id)
    expect(purged).toMatchObject({
      object_path: null,
      failure_code: 'DELETED',
      deletion_requested_at: firstRequestedAt,
    })
    expect(purged.retention_purged_at).toBeInstanceOf(Date)
    expect(bucket.objects.has(held.objectPath)).toBe(false)
    expect(bucket.objects.has(keptHeld.objectPath)).toBe(true)
  })

  /**
   * Codex P2-4 (D4): a recommendation made before the hold must not outlive a held deletion. Once
   * the release turns the row into `deletion_pending`, neither the cached Ritual nor the persisted
   * recommendation names the piece, before or after the sweep purges it.
   */
  it.each([
    // The Redis entry stays, so the next read meets the cache.
    ['the cached Ritual', (_cache: Map<string, string>) => undefined],
    // Redis misses, so the next read meets the persisted recommendation.
    ['the persisted recommendation', (cache: Map<string, string>) => cache.clear()],
  ] as const)(
    '[P0] [7.6-INT-009] after a held deletion is released, %s no longer names the piece',
    async (_path, choosePath) => {
      vi.stubEnv('TEST_ENV', 'local')
      const owner = await member()
      // A standalone wardrobe: no capsule, so no capsule revision moves.
      const garments = [
        await readyGarment(owner.userId, 'top'),
        await readyGarment(owner.userId, 'bottom'),
        await readyGarment(owner.userId, 'shoes'),
      ]
      const ritual = ritualFor(owner.userId)
      const before = await ritual.garmentIds()
      const target = garments.find((garment) => before.includes(garment.id))
      expect(target).toBeDefined()
      const targetId = target!.id
      choosePath(ritual.cache)
      expect(
        await prisma.outfitRecommendation.count({ where: { user_id: owner.userId } })
      ).toBeGreaterThan(0)

      await prisma.garmentItem.update({
        where: { id: targetId },
        data: { retention_status: 'legal_hold' },
      })
      const removed = await api
        .delete(`/api/v1/wardrobe/garments/${targetId}`)
        .set('Authorization', owner.auth)
      expect(removed.status).toBe(204)
      await prisma.garmentItem.update({
        where: { id: targetId },
        data: { retention_status: 'active' },
      })
      expect((await row(targetId)).retention_status).toBe('deletion_pending')

      expect(await ritual.garmentIds()).not.toContain(targetId)

      await retention.purgeExpiredAndDeletedGarments()
      expect((await row(targetId)).retention_purged_at).toBeInstanceOf(Date)
      ritual.cache.clear()
      expect(await ritual.garmentIds()).not.toContain(targetId)
    }
  )

  it('[P0] [7.6-INT-006] a purge that fails after the flip still answers 204, and the next sweep finishes it', async () => {
    vi.stubEnv('TEST_ENV', 'local')
    const owner = await member()
    const garment = await readyGarment(owner.userId)
    // Fault at the purge transaction once; the flip before it commits for real.
    const purge = vi
      .spyOn(
        retention as unknown as { purgeGarment: (garment: unknown) => Promise<void> },
        'purgeGarment'
      )
      .mockRejectedValueOnce(new Error('transaction timed out'))

    const removed = await api
      .delete(`/api/v1/wardrobe/garments/${garment.id}`)
      .set('Authorization', owner.auth)
    expect(removed.status).toBe(204)
    expect(purge).toHaveBeenCalledTimes(1)
    expect(await row(garment.id)).toMatchObject({
      retention_status: 'deletion_pending',
      object_path: garment.objectPath,
      retention_purged_at: null,
    })
    expect(await listedIds(owner.auth)).not.toContain(garment.id)
    expect(bucket.objects.has(garment.objectPath)).toBe(true)
    const pendingUsage = await api
      .get(`/api/v1/wardrobe/garments/${garment.id}/usage`)
      .set('Authorization', owner.auth)
    expect(pendingUsage.status).toBe(404)

    await retention.purgeExpiredAndDeletedGarments()
    const purged = await row(garment.id)
    expect(purged).toMatchObject({ object_path: null, failure_code: 'DELETED' })
    expect(purged.retention_purged_at).toBeInstanceOf(Date)
    expect(bucket.objects.has(garment.objectPath)).toBe(false)

    // A repeat after the purge is still a success for the member and changes nothing.
    const repeat = await api
      .delete(`/api/v1/wardrobe/garments/${garment.id}`)
      .set('Authorization', owner.auth)
    expect(repeat.status).toBe(204)
    // Nothing is re-stamped: the purge time, the request time and its trigger stand.
    expect(await row(garment.id)).toMatchObject({
      retention_purged_at: purged.retention_purged_at,
      deletion_requested_at: purged.deletion_requested_at,
      retention_trigger: purged.retention_trigger,
    })
  })

  it('[P1] [7.6-INT-007] another member can neither read the usage nor delete the garment', async () => {
    vi.stubEnv('TEST_ENV', 'local')
    const owner = await member()
    const intruder = await member()
    const garment = await readyGarment(owner.userId)
    await capsule(owner.userId, [garment.id])

    const usage = await api
      .get(`/api/v1/wardrobe/garments/${garment.id}/usage`)
      .set('Authorization', intruder.auth)
    const unknown = await api
      .get(`/api/v1/wardrobe/garments/${randomUUID()}/usage`)
      .set('Authorization', intruder.auth)
    // Same answer as a garment that does not exist: nothing about the owner leaks.
    expect(usage.status).toBe(404)
    expect(usage.body).toEqual(unknown.body)
    // The owner's own piece that is not ready yet answers the same way (D3).
    const tagging = await readyGarment(owner.userId, 'top', 'active', 'awaiting_tags')
    const notReady = await api
      .get(`/api/v1/wardrobe/garments/${tagging.id}/usage`)
      .set('Authorization', owner.auth)
    expect(notReady.status).toBe(404)
    expect(notReady.body).toEqual(unknown.body)

    const removed = await api
      .delete(`/api/v1/wardrobe/garments/${garment.id}`)
      .set('Authorization', intruder.auth)
    expect(removed.status).toBe(204)
    expect(await row(garment.id)).toMatchObject({
      retention_status: 'active',
      deletion_requested_at: null,
      object_path: garment.objectPath,
    })
    expect(await listedIds(owner.auth)).toContain(garment.id)
    expect(bucket.objects.has(garment.objectPath)).toBe(true)
  })

  it('[P0] [7.6-INT-008] a guardian-pending teen can delete and read usage; uploads stay blocked; a suspended account cannot', async () => {
    vi.stubEnv('TEST_ENV', 'local')
    // The shipped policy is off, which lets a pending teen through every guard. Consent is
    // required here so the upload route refuses the teen and the removal routes prove D8.
    vi.stubEnv('GUARDIAN_CONSENT_POLICY', 'required_13_15')
    const teen = await member('teen', 'pending_guardian_consent')
    const garment = await readyGarment(teen.userId)

    // D8: a member can always delete their own data, consent or not.
    const usage = await api
      .get(`/api/v1/wardrobe/garments/${garment.id}/usage`)
      .set('Authorization', teen.auth)
    expect(usage.status).toBe(200)
    expect(garmentUsageResponseSchema.parse(usage.body)).toMatchObject({
      savedLookCount: 0,
      capsuleCount: 0,
    })
    const removed = await api
      .delete(`/api/v1/wardrobe/garments/${garment.id}`)
      .set('Authorization', teen.auth)
    expect(removed.status).toBe(204)
    expect((await row(garment.id)).retention_purged_at).toBeInstanceOf(Date)
    expect(bucket.objects.has(garment.objectPath)).toBe(false)

    // The upload-consent check still guards every other wardrobe route.
    const upload = await api
      .post('/api/v1/wardrobe/upload-url')
      .set('Authorization', teen.auth)
      .set('Idempotency-Key', randomUUID())
      .send({})
    expect(upload.status).toBe(403)

    const suspended = await member('teen', 'suspended')
    const kept = await readyGarment(suspended.userId)
    const refused = await api
      .delete(`/api/v1/wardrobe/garments/${kept.id}`)
      .set('Authorization', suspended.auth)
    expect([401, 403]).toContain(refused.status)
    expect(await row(kept.id)).toMatchObject({
      retention_status: 'active',
      deletion_requested_at: null,
      object_path: kept.objectPath,
    })
  })
})
