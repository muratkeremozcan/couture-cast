/* eslint-disable @typescript-eslint/unbound-method -- assertions read vi.fn() members off their mock object, which is the established pattern for these suites. */
import {
  BadRequestException,
  NotFoundException,
  PreconditionFailedException,
} from '@nestjs/common'
import { Prisma, type PrismaClient } from '@prisma/client'
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import {
  CAPSULE_CHANGED_FIELD_ORDER,
  WardrobeCapsuleRepository,
  type CapsuleWithGarmentJoins,
} from './wardrobe-capsule.repository.js'

const OWNER = 'user-1'
const CAPSULE_ID = 'capsule-1'
const IDEMPOTENCY_KEY = 'a2b6e1f0-9c3d-4a71-8b52-6f4d0e7c1a93' // gitleaks:allow

function garmentJoin(garmentId: string, order: number) {
  return {
    garment_id: garmentId,
    garment_order: order,
    garment: { id: garmentId, upload_status: 'ready', retention_status: 'active' },
  }
}

function capsuleRow(overrides: Record<string, unknown> = {}): CapsuleWithGarmentJoins {
  return {
    id: CAPSULE_ID,
    user_id: OWNER,
    name: 'Work',
    description: 'Office',
    occasions: ['work', 'casual'],
    is_favorite: false,
    revision: 3,
    idempotency_key: null,
    idempotency_payload_hash: null,
    created_at: new Date('2026-08-05T10:00:00Z'),
    updated_at: new Date('2026-08-05T10:00:00Z'),
    garment_joins: [garmentJoin('garment-1', 0), garmentJoin('garment-2', 1)],
    ...overrides,
  } as unknown as CapsuleWithGarmentJoins
}

function knownRequestError(code: string, target?: string | string[]) {
  return new Prisma.PrismaClientKnownRequestError('constraint failed', {
    code,
    clientVersion: '6.19.0',
    meta: target === undefined ? undefined : { target },
  })
}

type Harness = ReturnType<typeof createHarness>

function createHarness() {
  const db = {
    userProfile: { upsert: vi.fn(), update: vi.fn() },
    outfitCapsule: {
      create: vi.fn(),
      findFirst: vi.fn().mockResolvedValue(null),
      findFirstOrThrow: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      update: vi.fn(),
      delete: vi.fn(),
    },
    outfitCapsuleGarment: { createMany: vi.fn(), deleteMany: vi.fn() },
    outfitRecommendation: { updateMany: vi.fn() },
    garmentItem: { findMany: vi.fn() },
    auditLog: { create: vi.fn() },
    capsuleTelemetryClaim: { create: vi.fn() },
    $queryRaw: vi.fn(),
    $transaction: vi.fn(),
  }
  db.$transaction.mockImplementation(
    async (callback: (tx: unknown) => Promise<unknown>) => callback(db)
  )
  // Every eligibility check passes unless a test says otherwise.
  db.garmentItem.findMany.mockImplementation(
    ({ where }: { where: { id: { in: string[] } } }) =>
      Promise.resolve(where.id.in.map((id) => ({ id })))
  )

  return {
    db,
    repository: new WardrobeCapsuleRepository(db as unknown as PrismaClient),
  }
}

const telemetry = {
  eventName: 'wardrobe_capsule_created' as const,
  buildPayload: vi.fn(() => ({ event: 'analytics' })),
}

const auditActor = { actorUserId: 'guardian-1', actorRole: 'guardian' as const }

function lockedTables({ db }: Harness): string[] {
  return db.$queryRaw.mock.calls.map((call) =>
    (call[0] as { raw?: string[] } & string[])[0]!.trim()
  )
}

describe('WardrobeCapsuleRepository', () => {
  let harness: Harness

  beforeEach(() => {
    vi.clearAllMocks()
    harness = createHarness()
  })

  describe('createCapsule', () => {
    const input = {
      name: '  Work Capsule  ',
      description: '   ',
      occasions: ['work' as const],
      garmentIds: ['garment-1', 'garment-2'],
      isFavorite: true,
    }

    /** A duplicate id would silently collapse the join set and reorder the capsule. */
    it('rejects duplicate garment ids before opening a transaction', async () => {
      const { db, repository } = harness

      await expect(
        repository.createCapsule(OWNER, { ...input, garmentIds: ['g-1', 'g-1'] })
      ).rejects.toThrow(BadRequestException)
      expect(db.$transaction).not.toHaveBeenCalled()
    })

    it('persists canonical values, joins in order, and the analytics claim', async () => {
      const { db, repository } = harness
      db.outfitCapsule.create.mockResolvedValue({ id: CAPSULE_ID })
      db.outfitCapsule.findFirstOrThrow.mockResolvedValue(capsuleRow({ revision: 1 }))

      const result = await repository.createCapsule(
        OWNER,
        input,
        IDEMPOTENCY_KEY,
        'hash-1',
        auditActor,
        telemetry
      )

      expect(result.isReplay).toBe(false)
      expect(db.outfitCapsule.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          user_id: OWNER,
          name: 'Work Capsule',
          // A whitespace-only description is stored as null, never as ''.
          description: null,
          is_favorite: true,
          revision: 1,
          idempotency_key: IDEMPOTENCY_KEY,
          idempotency_payload_hash: 'hash-1',
        }) as unknown,
      })
      expect(db.outfitCapsuleGarment.createMany).toHaveBeenCalledWith({
        data: [
          {
            user_id: OWNER,
            capsule_id: CAPSULE_ID,
            garment_id: 'garment-1',
            garment_order: 0,
          },
          {
            user_id: OWNER,
            capsule_id: CAPSULE_ID,
            garment_id: 'garment-2',
            garment_order: 1,
          },
        ],
      })
      expect(db.userProfile.update).toHaveBeenCalledWith({
        where: { user_id: OWNER },
        data: { capsule_revision: { increment: 1 } },
      })
      expect(db.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          user_id: OWNER,
          event_type: 'wardrobe_capsule_mutated',
          event_data: expect.objectContaining({
            action: 'create',
            actorRole: 'guardian',
          }) as unknown,
        }) as unknown,
      })
      expect(db.capsuleTelemetryClaim.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          mutation_key: `${CAPSULE_ID}:1:wardrobe_capsule_created`,
        }) as unknown,
      })
    })

    /**
     * Story 4.3 requires a fixed lock order so capsule mutation and retention
     * cannot deadlock against each other.
     */
    it('locks the owner profile before the garments it is about to attach', async () => {
      const { db, repository } = harness
      db.outfitCapsule.create.mockResolvedValue({ id: CAPSULE_ID })
      db.outfitCapsule.findFirstOrThrow.mockResolvedValue(capsuleRow({ revision: 1 }))

      await repository.createCapsule(OWNER, input)

      const locks = lockedTables(harness)
      expect(locks[0]).toContain('"UserProfile"')
      expect(locks[1]).toContain('"GarmentItem"')
    })

    it('writes neither an audit record nor a claim when neither is requested', async () => {
      const { db, repository } = harness
      db.outfitCapsule.create.mockResolvedValue({ id: CAPSULE_ID })
      db.outfitCapsule.findFirstOrThrow.mockResolvedValue(capsuleRow({ revision: 1 }))

      await repository.createCapsule(OWNER, input)

      expect(db.auditLog.create).not.toHaveBeenCalled()
      expect(db.capsuleTelemetryClaim.create).not.toHaveBeenCalled()
    })

    /** A garment still uploading or pending deletion must not enter a capsule. */
    it('rejects a capsule containing an ineligible garment', async () => {
      const { db, repository } = harness
      db.garmentItem.findMany.mockResolvedValue([{ id: 'garment-1' }])

      await expect(repository.createCapsule(OWNER, input)).rejects.toThrow(
        'GARMENT_NOT_CAPSULE_ELIGIBLE'
      )
      expect(db.outfitCapsule.create).not.toHaveBeenCalled()
    })

    it('replays the stored capsule for a matching idempotent retry', async () => {
      const { db, repository } = harness
      db.outfitCapsule.findFirst.mockResolvedValue(
        capsuleRow({ idempotency_payload_hash: 'hash-1' })
      )

      const result = await repository.createCapsule(
        OWNER,
        input,
        IDEMPOTENCY_KEY,
        'hash-1'
      )

      expect(result.isReplay).toBe(true)
      expect(db.$transaction).not.toHaveBeenCalled()
    })

    /** Reusing a key for a different payload is a client bug, not a retry. */
    it('rejects a reused idempotency key carrying a different payload', async () => {
      const { db, repository } = harness
      db.outfitCapsule.findFirst.mockResolvedValue(
        capsuleRow({ idempotency_payload_hash: 'hash-1' })
      )

      await expect(
        repository.createCapsule(OWNER, input, IDEMPOTENCY_KEY, 'hash-2')
      ).rejects.toThrow('IDEMPOTENCY_KEY_REUSED')
    })

    /** Two concurrent retries race past the pre-check; the loser reads the winner's row. */
    it('replays the winner after losing the idempotency-key race', async () => {
      const { db, repository } = harness
      db.$transaction.mockRejectedValue(
        knownRequestError('P2002', ['user_id', 'idempotency_key'])
      )
      db.outfitCapsule.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(capsuleRow({ idempotency_payload_hash: 'hash-1' }))

      const result = await repository.createCapsule(
        OWNER,
        input,
        IDEMPOTENCY_KEY,
        'hash-1'
      )

      expect(result.isReplay).toBe(true)
    })

    it('rejects the race loser whose payload does not match the winner', async () => {
      const { db, repository } = harness
      db.$transaction.mockRejectedValue(
        knownRequestError('P2002', 'capsule_idempotency_key_unique')
      )
      db.outfitCapsule.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(capsuleRow({ idempotency_payload_hash: 'other' }))

      await expect(
        repository.createCapsule(OWNER, input, IDEMPOTENCY_KEY, 'hash-1')
      ).rejects.toThrow('IDEMPOTENCY_KEY_REUSED')
    })

    /**
     * Disguising an unrelated unique violation as key reuse would hide a real bug
     * behind a 409 that clients are told to retry.
     */
    const unrelatedViolations: [string, string[] | undefined][] = [
      ['a different unique constraint', ['user_id', 'name']],
      ['an unreported constraint target', undefined],
    ]

    it.each(unrelatedViolations)('rethrows a P2002 raised by %s', async (_l, target) => {
      const { db, repository } = harness
      const error = knownRequestError('P2002', target)
      db.$transaction.mockRejectedValue(error)

      await expect(
        repository.createCapsule(OWNER, input, IDEMPOTENCY_KEY, 'hash-1')
      ).rejects.toBe(error)
    })

    it('rethrows a non-unique database failure untouched', async () => {
      const { db, repository } = harness
      const error = knownRequestError('P2003')
      db.$transaction.mockRejectedValue(error)

      await expect(
        repository.createCapsule(OWNER, input, IDEMPOTENCY_KEY, 'hash-1')
      ).rejects.toBe(error)
    })
  })

  describe('listCapsules', () => {
    function capturedWhere(findMany: Mock): Record<string, unknown> {
      return (findMany.mock.calls[0]?.[0] as { where: Record<string, unknown> }).where
    }

    it('scopes every query to the owner and returns the total alongside the page', async () => {
      const { db, repository } = harness
      db.outfitCapsule.findMany.mockResolvedValue([capsuleRow()])
      db.outfitCapsule.count.mockResolvedValue(7)

      const result = await repository.listCapsules(OWNER, { limit: 20, offset: 0 })

      expect(result.total).toBe(7)
      expect(result.items).toHaveLength(1)
      expect(capturedWhere(db.outfitCapsule.findMany)).toMatchObject({ user_id: OWNER })
    })

    /** LIKE metacharacters in a search term must match literally, not as wildcards. */
    it('escapes LIKE metacharacters in the search term', async () => {
      const { db, repository } = harness

      await repository.listCapsules(OWNER, { q: ' 100%_off ', limit: 20, offset: 0 })

      expect(capturedWhere(db.outfitCapsule.findMany).OR).toEqual([
        { name: { contains: '100\\%\\_off', mode: 'insensitive' } },
        { description: { contains: '100\\%\\_off', mode: 'insensitive' } },
      ])
    })

    /** A whitespace-only `q` is an omitted filter, not one matching every row. */
    it('ignores a whitespace-only search term', async () => {
      const { db, repository } = harness

      await repository.listCapsules(OWNER, { q: '   ', limit: 20, offset: 0 })

      expect(capturedWhere(db.outfitCapsule.findMany)).not.toHaveProperty('OR')
    })

    /**
     * A garment filter and a comfort filter may be satisfied by different
     * garments, so they must be independent `some` clauses rather than one
     * conjunction on a single join row.
     */
    it('applies garment and comfort filters as independent join clauses', async () => {
      const { db, repository } = harness

      await repository.listCapsules(OWNER, {
        garmentId: 'garment-9',
        comfortRange: 'cold',
        occasion: 'work',
        isFavorite: true,
        limit: 20,
        offset: 0,
      })

      const where = capturedWhere(db.outfitCapsule.findMany)
      expect(where.occasions).toEqual({ has: 'work' })
      expect(where.is_favorite).toBe(true)
      expect(where.AND).toEqual([
        {
          garment_joins: {
            some: {
              garment_id: 'garment-9',
              garment: { upload_status: 'ready', retention_status: 'active' },
            },
          },
        },
        {
          garment_joins: {
            some: {
              garment: {
                upload_status: 'ready',
                retention_status: 'active',
                comfort_range: 'cold',
              },
            },
          },
        },
      ])
    })
  })

  describe('findCapsuleById', () => {
    it('scopes the lookup to the owner', async () => {
      const { db, repository } = harness
      db.outfitCapsule.findFirst.mockResolvedValue(capsuleRow())

      await repository.findCapsuleById(OWNER, CAPSULE_ID)

      expect(db.outfitCapsule.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: CAPSULE_ID, user_id: OWNER },
        })
      )
    })
  })

  describe('updateCapsule', () => {
    it('rejects duplicate garment ids before opening a transaction', async () => {
      const { db, repository } = harness

      await expect(
        repository.updateCapsule(OWNER, CAPSULE_ID, null, {
          garmentIds: ['g-1', 'g-1'],
        })
      ).rejects.toThrow(BadRequestException)
      expect(db.$transaction).not.toHaveBeenCalled()
    })

    it('reports a missing capsule as not found', async () => {
      const { db, repository } = harness
      db.outfitCapsule.findFirst.mockResolvedValue(null)

      await expect(
        repository.updateCapsule(OWNER, CAPSULE_ID, null, { name: 'New' })
      ).rejects.toThrow(NotFoundException)
    })

    /**
     * The precondition is re-checked under the row lock. Checking it before the
     * transaction cannot stop a lost update, because two callers holding the same
     * ETag would both pass an unlocked check.
     */
    it('fails the precondition when the locked row moved on', async () => {
      const { db, repository } = harness
      db.outfitCapsule.findFirst.mockResolvedValue(capsuleRow({ revision: 5 }))

      await expect(
        repository.updateCapsule(OWNER, CAPSULE_ID, 4, { name: 'New' })
      ).rejects.toThrow(PreconditionFailedException)
      expect(db.outfitCapsule.update).not.toHaveBeenCalled()
    })

    /** Resending the values already stored is not a change and must not bump the revision. */
    it('treats a canonically identical patch as a no-op', async () => {
      const { db, repository } = harness
      db.outfitCapsule.findFirst.mockResolvedValue(capsuleRow())

      const result = await repository.updateCapsule(
        OWNER,
        CAPSULE_ID,
        3,
        {
          name: '  Work  ',
          description: 'Office',
          occasions: ['casual', 'work'],
          isFavorite: false,
          garmentIds: ['garment-1', 'garment-2'],
        },
        auditActor,
        telemetry
      )

      expect(result.isNoOp).toBe(true)
      expect(result.changedFields).toEqual([])
      expect(db.outfitCapsule.update).not.toHaveBeenCalled()
      expect(db.userProfile.update).not.toHaveBeenCalled()
      expect(db.capsuleTelemetryClaim.create).not.toHaveBeenCalled()
    })

    it('reports changed fields in the canonical analytics order', async () => {
      const { db, repository } = harness
      db.outfitCapsule.findFirst.mockResolvedValue(capsuleRow())
      db.outfitCapsule.update.mockResolvedValue(capsuleRow({ revision: 4 }))

      const result = await repository.updateCapsule(OWNER, CAPSULE_ID, 3, {
        isFavorite: true,
        garmentIds: ['garment-2', 'garment-1'],
        occasions: ['formal'],
        description: 'Studio',
        name: 'Weekend',
      })

      expect(result.changedFields).toEqual([...CAPSULE_CHANGED_FIELD_ORDER])
      expect(result.isNoOp).toBe(false)
    })

    /** Reordering the same garments is a real change to the capsule. */
    it('detects a reorder of an otherwise identical garment list', async () => {
      const { db, repository } = harness
      db.outfitCapsule.findFirst.mockResolvedValue(capsuleRow())
      db.outfitCapsule.update.mockResolvedValue(capsuleRow({ revision: 4 }))

      const result = await repository.updateCapsule(OWNER, CAPSULE_ID, null, {
        garmentIds: ['garment-2', 'garment-1'],
      })

      expect(result.changedFields).toEqual(['garmentIds'])
      expect(db.outfitCapsuleGarment.deleteMany).toHaveBeenCalledWith({
        where: { capsule_id: CAPSULE_ID, user_id: OWNER },
      })
      expect(db.outfitCapsuleGarment.createMany).toHaveBeenCalledWith({
        data: [
          {
            user_id: OWNER,
            capsule_id: CAPSULE_ID,
            garment_id: 'garment-2',
            garment_order: 0,
          },
          {
            user_id: OWNER,
            capsule_id: CAPSULE_ID,
            garment_id: 'garment-1',
            garment_order: 1,
          },
        ],
      })
    })

    /**
     * Eligibility is revalidated even for a metadata-only edit, so a capsule that
     * has since acquired a purged garment cannot be carried forward.
     */
    it('revalidates existing garments on a metadata-only edit', async () => {
      const { db, repository } = harness
      db.outfitCapsule.findFirst.mockResolvedValue(capsuleRow())
      db.garmentItem.findMany.mockResolvedValue([{ id: 'garment-1' }])

      await expect(
        repository.updateCapsule(OWNER, CAPSULE_ID, null, { name: 'Weekend' })
      ).rejects.toThrow('GARMENT_NOT_CAPSULE_ELIGIBLE')
      expect(db.outfitCapsule.update).not.toHaveBeenCalled()
    })

    /** Both the incoming and the outgoing garments must be locked, or a removed
     * garment could change retention state mid-transaction. */
    it('locks the union of the current and requested garments', async () => {
      const { db, repository } = harness
      db.outfitCapsule.findFirst.mockResolvedValue(capsuleRow())
      db.outfitCapsule.update.mockResolvedValue(capsuleRow({ revision: 4 }))

      await repository.updateCapsule(OWNER, CAPSULE_ID, null, {
        garmentIds: ['garment-3'],
      })

      const garmentLock = db.$queryRaw.mock.calls.find((call) =>
        (call[0] as string[])[0]!.includes('"GarmentItem"')
      )
      const lockedIds = (garmentLock?.[1] as { values: unknown[] }).values
      expect(lockedIds).toEqual(['garment-1', 'garment-2', 'garment-3'])
    })

    it('bumps the profile revision and records the audit trail on a real change', async () => {
      const { db, repository } = harness
      db.outfitCapsule.findFirst.mockResolvedValue(capsuleRow())
      db.outfitCapsule.update.mockResolvedValue(capsuleRow({ revision: 4 }))

      await repository.updateCapsule(
        OWNER,
        CAPSULE_ID,
        3,
        { name: 'Weekend' },
        auditActor,
        { ...telemetry, eventName: 'wardrobe_capsule_updated' }
      )

      expect(db.outfitCapsule.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id_user_id: { id: CAPSULE_ID, user_id: OWNER } },
          data: expect.objectContaining({
            name: 'Weekend',
            revision: { increment: 1 },
          }) as unknown,
        })
      )
      expect(db.userProfile.update).toHaveBeenCalledTimes(1)
      expect(db.capsuleTelemetryClaim.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          mutation_key: `${CAPSULE_ID}:4:wardrobe_capsule_updated`,
        }) as unknown,
      })
    })
  })

  describe('setFavoriteStatus', () => {
    it('is a no-op when the capsule already holds the requested state', async () => {
      const { db, repository } = harness
      db.outfitCapsule.findFirst.mockResolvedValue(capsuleRow({ is_favorite: true }))

      const result = await repository.setFavoriteStatus(OWNER, CAPSULE_ID, null, true)

      expect(result.isNoOp).toBe(true)
      expect(db.outfitCapsule.update).not.toHaveBeenCalled()
      expect(db.userProfile.update).not.toHaveBeenCalled()
    })

    it('flips the flag, bumps the revision, and claims the event', async () => {
      const { db, repository } = harness
      db.outfitCapsule.findFirst.mockResolvedValue(capsuleRow({ is_favorite: false }))
      db.outfitCapsule.update.mockResolvedValue(
        capsuleRow({ is_favorite: true, revision: 4 })
      )

      const result = await repository.setFavoriteStatus(
        OWNER,
        CAPSULE_ID,
        3,
        true,
        auditActor,
        { ...telemetry, eventName: 'wardrobe_capsule_favorite_changed' }
      )

      expect(result.isNoOp).toBe(false)
      expect(db.outfitCapsule.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            is_favorite: true,
            revision: { increment: 1 },
          }) as unknown,
        })
      )
      expect(db.capsuleTelemetryClaim.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          mutation_key: `${CAPSULE_ID}:4:wardrobe_capsule_favorite_changed`,
        }) as unknown,
      })
    })

    it('fails the precondition when the locked revision differs', async () => {
      const { db, repository } = harness
      db.outfitCapsule.findFirst.mockResolvedValue(capsuleRow({ revision: 9 }))

      await expect(
        repository.setFavoriteStatus(OWNER, CAPSULE_ID, 3, true)
      ).rejects.toThrow(PreconditionFailedException)
    })
  })

  describe('deleteCapsule', () => {
    /**
     * Recommendations outlive the capsule they were built from, so the reference
     * is detached rather than cascading the delete into a user's history.
     */
    it('detaches recommendations, drops the joins, and returns the final revision', async () => {
      const { db, repository } = harness
      db.outfitCapsule.findFirst.mockResolvedValue(capsuleRow({ revision: 6 }))

      const result = await repository.deleteCapsule(OWNER, CAPSULE_ID, 6, auditActor, {
        ...telemetry,
        eventName: 'wardrobe_capsule_deleted',
      })

      expect(result.acceptedRevision).toBe(6)
      expect(db.outfitRecommendation.updateMany).toHaveBeenCalledWith({
        where: { capsule_id: CAPSULE_ID, user_id: OWNER },
        data: { capsule_id: null },
      })
      expect(db.outfitCapsuleGarment.deleteMany).toHaveBeenCalledWith({
        where: { capsule_id: CAPSULE_ID, user_id: OWNER },
      })
      expect(db.outfitCapsule.delete).toHaveBeenCalledWith({
        where: { id_user_id: { id: CAPSULE_ID, user_id: OWNER } },
      })
      // The claim survives the row it describes, so it carries no capsule FK.
      expect(db.capsuleTelemetryClaim.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          mutation_key: `${CAPSULE_ID}:6:wardrobe_capsule_deleted`,
        }) as unknown,
      })
    })

    it('reports a missing capsule as not found without deleting anything', async () => {
      const { db, repository } = harness
      db.outfitCapsule.findFirst.mockResolvedValue(null)

      await expect(repository.deleteCapsule(OWNER, CAPSULE_ID, null)).rejects.toThrow(
        NotFoundException
      )
      expect(db.outfitCapsule.delete).not.toHaveBeenCalled()
    })

    it('fails the precondition when the locked revision differs', async () => {
      const { db, repository } = harness
      db.outfitCapsule.findFirst.mockResolvedValue(capsuleRow({ revision: 6 }))

      await expect(repository.deleteCapsule(OWNER, CAPSULE_ID, 5)).rejects.toThrow(
        PreconditionFailedException
      )
    })
  })
})
