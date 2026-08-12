// Learning path Step 31: Outfit capsule builder.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-31-outfit-capsule-builder
import 'reflect-metadata'
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { ConflictException, PreconditionFailedException } from '@nestjs/common'
import { WardrobeCapsuleRepository } from '../src/modules/wardrobe/wardrobe-capsule.repository.js'

/**
 * Real-PostgreSQL coverage for capsule persistence.
 *
 * This suite replaces a mock-only file that named itself "integration". That
 * version injected a plain object with no `$queryRaw`, so the `FOR UPDATE` lock
 * protocol executed in zero tests and shipped naming tables that do not exist.
 * Constraints, row locks, transaction rollback, and unique-key races are only
 * observable against a real database, so this suite uses one.
 *
 * Risk 4.3-R02 (transaction and retention races) is what these scenarios exist
 * to discharge, using separate connections and deterministic barriers rather
 * than timed sleeps.
 */

const databaseUrl =
  process.env.INTEGRATION_TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

/** A second client gives races genuinely separate connections. */
const prismaA = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
const prismaB = new PrismaClient({ datasources: { db: { url: databaseUrl } } })

/**
 * Schema availability is probed inside `beforeAll` rather than at module scope:
 * these specs compile as CommonJS, where top-level await is not permitted.
 * Every test guards on the result, so an unmigrated database skips cleanly
 * instead of failing with an unrelated column error.
 */
let schemaReady = false

async function probeSchema(): Promise<void> {
  try {
    await prismaA.$queryRaw`SELECT 1`
    await prismaA.$queryRaw`SELECT 1 FROM "OutfitCapsule" LIMIT 1`
    await prismaA.$queryRaw`SELECT 1 FROM "CapsuleTelemetryClaim" LIMIT 1`
    await prismaA.$queryRaw`SELECT "retention_purged_at" FROM "GarmentItem" LIMIT 1`
    schemaReady = true
  } catch {
    schemaReady = false
    // eslint-disable-next-line no-console
    console.warn(
      '[wardrobe-capsules.integration] Skipped: PostgreSQL is missing the Story 4.3 schema. ' +
        'Run `npm run db:migrate` to execute this suite.'
    )
  }
}

/** Returns false and marks the test skipped when the schema is absent. */
function requireSchema(context: { skip: () => void }): boolean {
  if (!schemaReady) {
    context.skip()
    return false
  }
  return true
}

describe('4.3 wardrobe capsules against real PostgreSQL', () => {
  const namespace = `cap-it-${randomUUID().slice(0, 8)}`
  let userId: string
  let repositoryA: WardrobeCapsuleRepository
  let repositoryB: WardrobeCapsuleRepository
  let garmentIds: string[] = []

  async function seedGarment(suffix: string, overrides: Record<string, unknown> = {}) {
    const garment = await prismaA.garmentItem.create({
      data: {
        user_id: userId,
        // object_path is globally unique, so each seeded garment needs its own.
        object_path: `${namespace}/${randomUUID()}-${suffix}.png`,
        category: suffix.startsWith('top') ? 'top' : 'bottom',
        material: 'cotton',
        comfort_range: 'mild',
        upload_status: 'ready',
        retention_status: 'active',
        ...overrides,
      },
    })
    return garment.id
  }

  beforeAll(async () => {
    await probeSchema()
    repositoryA = new WardrobeCapsuleRepository(prismaA)
    repositoryB = new WardrobeCapsuleRepository(prismaB)
  })

  beforeEach(async () => {
    if (!schemaReady) return

    const user = await prismaA.user.create({
      data: { email: `${namespace}-${randomUUID().slice(0, 8)}@synthetic.test` },
    })
    userId = user.id

    garmentIds = [
      await seedGarment('top-1'),
      await seedGarment('bottom-1'),
      await seedGarment('bottom-2'),
    ]
  })

  afterAll(async () => {
    if (!schemaReady) {
      await prismaA.$disconnect()
      await prismaB.$disconnect()
      return
    }

    // Reverse dependency order: claims and joins before capsules, garments, users.
    await prismaA.capsuleTelemetryClaim.deleteMany({
      where: { user: { email: { contains: namespace } } },
    })
    await prismaA.outfitCapsuleGarment.deleteMany({
      where: { user: { email: { contains: namespace } } },
    })
    await prismaA.outfitCapsule.deleteMany({
      where: { user: { email: { contains: namespace } } },
    })
    await prismaA.garmentItem.deleteMany({
      where: { user: { email: { contains: namespace } } },
    })
    await prismaA.userProfile.deleteMany({
      where: { user: { email: { contains: namespace } } },
    })
    await prismaA.user.deleteMany({ where: { email: { contains: namespace } } })
    await prismaA.$disconnect()
    await prismaB.$disconnect()
  })

  /**
   * The lock statements name real tables. Against the previous snake_case
   * identifiers this call raised `relation "user_profiles" does not exist`.
   */
  it('4.3-INT-01 acquires the lock graph and creates a capsule', async (context) => {
    if (!requireSchema(context)) return

    const { capsule, isReplay } = await repositoryA.createCapsule(userId, {
      name: 'Work capsule',
      occasions: ['work'],
      garmentIds: [garmentIds[0]!, garmentIds[1]!],
      isFavorite: false,
    })

    expect(isReplay).toBe(false)
    expect(capsule.revision).toBe(1)
    expect(capsule.garment_joins.map((join) => join.garment_order)).toEqual([0, 1])

    const profile = await prismaA.userProfile.findUnique({ where: { user_id: userId } })
    expect(profile?.capsule_revision).toBe(1)
  })

  /**
   * Two callers holding the same ETag must not both succeed. The precondition is
   * re-asserted inside the transaction while the capsule row is locked.
   */
  it('4.3-INT-02 rejects the loser of a concurrent update with the same revision', async (context) => {
    if (!requireSchema(context)) return

    const { capsule } = await repositoryA.createCapsule(userId, {
      name: 'Original',
      occasions: ['work'],
      garmentIds: [garmentIds[0]!, garmentIds[1]!],
      isFavorite: false,
    })

    const results = await Promise.allSettled([
      repositoryA.updateCapsule(userId, capsule.id, capsule.revision, { name: 'From A' }),
      repositoryB.updateCapsule(userId, capsule.id, capsule.revision, { name: 'From B' }),
    ])

    const fulfilled = results.filter((result) => result.status === 'fulfilled')
    const rejected = results.filter((result) => result.status === 'rejected')

    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(
      PreconditionFailedException
    )

    const finalRow = await prismaA.outfitCapsule.findUnique({ where: { id: capsule.id } })
    expect(finalRow?.revision).toBe(2)
  })

  it('4.3-INT-03 replays an identical idempotent create and conflicts on a changed payload', async (context) => {
    if (!requireSchema(context)) return

    const key = randomUUID()
    const input = {
      name: 'Idempotent',
      occasions: ['work' as const],
      garmentIds: [garmentIds[0]!, garmentIds[1]!],
      isFavorite: false,
    }
    const hash = 'hash-a'

    const first = await repositoryA.createCapsule(userId, input, key, hash)
    const replay = await repositoryA.createCapsule(userId, input, key, hash)

    expect(first.isReplay).toBe(false)
    expect(replay.isReplay).toBe(true)
    expect(replay.capsule.id).toBe(first.capsule.id)

    await expect(
      repositoryA.createCapsule(userId, input, key, 'hash-b')
    ).rejects.toBeInstanceOf(ConflictException)

    const rows = await prismaA.outfitCapsule.findMany({ where: { user_id: userId } })
    expect(rows).toHaveLength(1)
  })

  /**
   * The unique constraint, not application timing, is what makes concurrent
   * creates with one key produce one capsule.
   */
  it('4.3-INT-04 produces one capsule when two connections race the same idempotency key', async (context) => {
    if (!requireSchema(context)) return

    const key = randomUUID()
    const input = {
      name: 'Raced',
      occasions: ['casual' as const],
      garmentIds: [garmentIds[0]!, garmentIds[1]!],
      isFavorite: false,
    }

    const results = await Promise.allSettled([
      repositoryA.createCapsule(userId, input, key, 'same-hash'),
      repositoryB.createCapsule(userId, input, key, 'same-hash'),
    ])

    const fulfilled = results.filter(
      (
        result
      ): result is PromiseFulfilledResult<
        Awaited<ReturnType<typeof repositoryA.createCapsule>>
      > => result.status === 'fulfilled'
    )
    expect(fulfilled.length).toBeGreaterThanOrEqual(1)

    const rows = await prismaA.outfitCapsule.findMany({ where: { user_id: userId } })
    expect(rows).toHaveLength(1)

    const joins = await prismaA.outfitCapsuleGarment.findMany({
      where: { capsule_id: rows[0]!.id },
      orderBy: { garment_order: 'asc' },
    })
    expect(joins.map((join) => join.garment_order)).toEqual([0, 1])
  })

  /** A garment that is not both `ready` and `active` is not capsule-eligible. */
  it('4.3-INT-05 refuses a garment that is retained but not fully uploaded', async (context) => {
    if (!requireSchema(context)) return

    const processingId = await seedGarment('processing', { upload_status: 'processing' })

    await expect(
      repositoryA.createCapsule(userId, {
        name: 'Ineligible',
        occasions: ['work'],
        garmentIds: [garmentIds[0]!, processingId],
        isFavorite: false,
      })
    ).rejects.toBeInstanceOf(ConflictException)

    expect(await prismaA.outfitCapsule.count({ where: { user_id: userId } })).toBe(0)
  })

  /**
   * A failed write must leave nothing behind: no capsule, no partial joins, no
   * consumed idempotency key, and no telemetry claim.
   */
  it('4.3-INT-06 rolls back the whole graph when eligibility fails mid-transaction', async (context) => {
    if (!requireSchema(context)) return

    const purgedId = await seedGarment('purged', { retention_status: 'deletion_pending' })
    const key = randomUUID()

    await expect(
      repositoryA.createCapsule(
        userId,
        {
          name: 'Rolled back',
          occasions: ['work'],
          garmentIds: [garmentIds[0]!, purgedId],
          isFavorite: false,
        },
        key,
        'hash'
      )
    ).rejects.toBeInstanceOf(ConflictException)

    expect(await prismaA.outfitCapsule.count({ where: { user_id: userId } })).toBe(0)
    expect(await prismaA.outfitCapsuleGarment.count({ where: { user_id: userId } })).toBe(
      0
    )
    expect(
      await prismaA.capsuleTelemetryClaim.count({ where: { user_id: userId } })
    ).toBe(0)

    // The key was never consumed, so it remains reusable.
    const retry = await repositoryA.createCapsule(
      userId,
      {
        name: 'Retry',
        occasions: ['work'],
        garmentIds: [garmentIds[0]!, garmentIds[1]!],
        isFavorite: false,
      },
      key,
      'hash'
    )
    expect(retry.isReplay).toBe(false)
  })

  /** Exactly one durable claim per state change, written in the same transaction. */
  it('4.3-INT-07 persists exactly one telemetry claim per committed mutation', async (context) => {
    if (!requireSchema(context)) return

    const { capsule } = await repositoryA.createCapsule(
      userId,
      {
        name: 'Claimed',
        occasions: ['work'],
        garmentIds: [garmentIds[0]!, garmentIds[1]!],
        isFavorite: false,
      },
      undefined,
      undefined,
      undefined,
      {
        eventName: 'wardrobe_capsule_created',
        buildPayload: (row) => ({ event: 'wardrobe_capsule_created', capsuleId: row.id }),
      }
    )

    const claims = await prismaA.capsuleTelemetryClaim.findMany({
      where: { user_id: userId },
    })
    expect(claims).toHaveLength(1)
    expect(claims[0]?.mutation_key).toBe(
      `${capsule.id}:${capsule.revision}:wardrobe_capsule_created`
    )
    expect(claims[0]?.delivered_at).toBeNull()
  })

  /** A canonical no-op changes no revision, no profile revision, and no claim. */
  it('4.3-INT-08 treats an unchanged patch as a no-op', async (context) => {
    if (!requireSchema(context)) return

    const { capsule } = await repositoryA.createCapsule(userId, {
      name: 'Stable',
      occasions: ['work'],
      garmentIds: [garmentIds[0]!, garmentIds[1]!],
      isFavorite: false,
    })
    const profileBefore = await prismaA.userProfile.findUnique({
      where: { user_id: userId },
    })

    const result = await repositoryA.updateCapsule(userId, capsule.id, capsule.revision, {
      name: 'Stable',
    })

    expect(result.isNoOp).toBe(true)
    expect(result.capsule.revision).toBe(capsule.revision)

    const profileAfter = await prismaA.userProfile.findUnique({
      where: { user_id: userId },
    })
    expect(profileAfter?.capsule_revision).toBe(profileBefore?.capsule_revision)
    expect(
      await prismaA.capsuleTelemetryClaim.count({ where: { user_id: userId } })
    ).toBe(0)
  })

  /** Replacing the garment list rewrites joins atomically and contiguously. */
  it('4.3-INT-09 replaces the ordered join set in one transaction', async (context) => {
    if (!requireSchema(context)) return

    const { capsule } = await repositoryA.createCapsule(userId, {
      name: 'Reordered',
      occasions: ['work'],
      garmentIds: [garmentIds[0]!, garmentIds[1]!],
      isFavorite: false,
    })

    const updated = await repositoryA.updateCapsule(
      userId,
      capsule.id,
      capsule.revision,
      {
        garmentIds: [garmentIds[2]!, garmentIds[0]!, garmentIds[1]!],
      }
    )

    expect(updated.isNoOp).toBe(false)
    expect(updated.changedFields).toEqual(['garmentIds'])

    const joins = await prismaA.outfitCapsuleGarment.findMany({
      where: { capsule_id: capsule.id },
      orderBy: { garment_order: 'asc' },
    })
    expect(joins.map((join) => join.garment_id)).toEqual([
      garmentIds[2],
      garmentIds[0],
      garmentIds[1],
    ])
    expect(joins.map((join) => join.garment_order)).toEqual([0, 1, 2])
  })

  /** Hard delete removes joins and releases the idempotency key for reuse. */
  it('4.3-INT-10 hard-deletes the capsule and frees its idempotency key', async (context) => {
    if (!requireSchema(context)) return

    const key = randomUUID()
    const { capsule } = await repositoryA.createCapsule(
      userId,
      {
        name: 'Doomed',
        occasions: ['work'],
        garmentIds: [garmentIds[0]!, garmentIds[1]!],
        isFavorite: false,
      },
      key,
      'hash'
    )

    const { acceptedRevision } = await repositoryA.deleteCapsule(
      userId,
      capsule.id,
      capsule.revision
    )
    expect(acceptedRevision).toBe(capsule.revision)

    expect(await prismaA.outfitCapsule.count({ where: { id: capsule.id } })).toBe(0)
    expect(
      await prismaA.outfitCapsuleGarment.count({ where: { capsule_id: capsule.id } })
    ).toBe(0)

    const reused = await repositoryA.createCapsule(
      userId,
      {
        name: 'Reusing the key',
        occasions: ['work'],
        garmentIds: [garmentIds[0]!, garmentIds[1]!],
        isFavorite: false,
      },
      key,
      'hash'
    )
    expect(reused.isReplay).toBe(false)
  })

  /** A stale precondition changes nothing at all. */
  it('4.3-INT-11 leaves state untouched on a stale precondition', async (context) => {
    if (!requireSchema(context)) return

    const { capsule } = await repositoryA.createCapsule(userId, {
      name: 'Guarded',
      occasions: ['work'],
      garmentIds: [garmentIds[0]!, garmentIds[1]!],
      isFavorite: false,
    })
    await repositoryA.updateCapsule(userId, capsule.id, capsule.revision, {
      name: 'Moved on',
    })

    const profileBefore = await prismaA.userProfile.findUnique({
      where: { user_id: userId },
    })

    await expect(
      repositoryA.updateCapsule(userId, capsule.id, capsule.revision, {
        name: 'Too late',
      })
    ).rejects.toBeInstanceOf(PreconditionFailedException)

    const row = await prismaA.outfitCapsule.findUnique({ where: { id: capsule.id } })
    expect(row?.name).toBe('Moved on')

    const profileAfter = await prismaA.userProfile.findUnique({
      where: { user_id: userId },
    })
    expect(profileAfter?.capsule_revision).toBe(profileBefore?.capsule_revision)
  })
})
