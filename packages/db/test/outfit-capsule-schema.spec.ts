import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Pool, type PoolClient } from 'pg'

/**
 * 4.3-DB-001 and 4.3-DB-002.
 *
 * These assertions run the migrated schema instead of reading migration.sql as
 * text. A substring check passes whether or not the DDL was ever applied and
 * whether or not the constraint behaves, so constraints, referential actions,
 * and defaults are exercised against a real PostgreSQL connection here.
 */

const databaseUrl =
  process.env.RLS_TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

const adminPool = new Pool({ connectionString: databaseUrl, max: 4 })

/** Runs `body` inside a transaction that always rolls back, so tests stay isolated. */
const inRolledBackTransaction = async <T>(
  body: (client: PoolClient) => Promise<T>
): Promise<T> => {
  const client = await adminPool.connect()

  try {
    await client.query('BEGIN')
    return await body(client)
  } finally {
    try {
      await client.query('ROLLBACK')
    } catch {
      // Ignore rollback failures so the pooled client is still released.
    }
    client.release()
  }
}

type CapsuleFixture = {
  userId: string
  otherUserId: string
  capsuleId: string
  garmentIds: string[]
  otherGarmentId: string
}

/** Seeds an owner, a second user, a capsule, and garments for both owners. */
const seedCapsuleGraph = async (client: PoolClient): Promise<CapsuleFixture> => {
  const suffix = randomUUID()
  const fixture: CapsuleFixture = {
    userId: `capsule-owner-${suffix}`,
    otherUserId: `capsule-other-${suffix}`,
    capsuleId: `capsule-${suffix}`,
    garmentIds: [`garment-a-${suffix}`, `garment-b-${suffix}`],
    otherGarmentId: `garment-other-${suffix}`,
  }

  for (const [id, email] of [
    [fixture.userId, `owner-${suffix}@example.com`],
    [fixture.otherUserId, `other-${suffix}@example.com`],
  ]) {
    await client.query(
      'INSERT INTO public."User" ("id", "email", "updated_at") VALUES ($1, $2, NOW())',
      [id, email]
    )
  }

  for (const garmentId of fixture.garmentIds) {
    await client.query(
      `INSERT INTO public."GarmentItem" ("id", "user_id", "category", "updated_at")
       VALUES ($1, $2, 'top', NOW())`,
      [garmentId, fixture.userId]
    )
  }

  await client.query(
    `INSERT INTO public."GarmentItem" ("id", "user_id", "category", "updated_at")
     VALUES ($1, $2, 'dress', NOW())`,
    [fixture.otherGarmentId, fixture.otherUserId]
  )

  await client.query(
    `INSERT INTO public."OutfitCapsule"
      ("id", "user_id", "name", "occasions", "updated_at")
     VALUES ($1, $2, $3, $4::"CapsuleOccasion"[], NOW())`,
    [fixture.capsuleId, fixture.userId, 'Seeded capsule', ['casual']]
  )

  return fixture
}

const insertJoin = (
  client: PoolClient,
  fixture: CapsuleFixture,
  overrides: {
    userId?: string
    capsuleId?: string
    garmentId?: string
    garmentOrder?: number
  } = {}
) =>
  client.query(
    `INSERT INTO public."OutfitCapsuleGarment"
      ("id", "user_id", "capsule_id", "garment_id", "garment_order")
     VALUES ($1, $2, $3, $4, $5)
     RETURNING "id"`,
    [
      `join-${randomUUID()}`,
      overrides.userId ?? fixture.userId,
      overrides.capsuleId ?? fixture.capsuleId,
      overrides.garmentId ?? fixture.garmentIds[0],
      overrides.garmentOrder ?? 0,
    ]
  )

describe('outfit capsule schema and migration', () => {
  beforeAll(async () => {
    const client = await adminPool.connect()

    try {
      await client.query('SELECT 1 FROM public."OutfitCapsule" LIMIT 1')
    } catch (error) {
      throw new Error(
        'Outfit capsule schema tests require a migrated target database. Run `npx prisma migrate deploy --schema packages/db/prisma/schema.prisma` before running this suite.',
        { cause: error }
      )
    }

    // The capsule migration gained trigram indexes, the telemetry claim table,
    // and a composite recommendation FK after it was first recorded as applied.
    // A database that ran the earlier revision still reports "up to date", so
    // detect the drift here rather than as unrelated constraint failures below.
    try {
      const drift: string[] = []

      const trigram = await client.query(
        'SELECT 1 FROM pg_extension WHERE extname = $1',
        ['pg_trgm']
      )
      if (trigram.rowCount === 0) drift.push('pg_trgm extension')

      const telemetryClaim = await client.query<{ table: string | null }>(
        'SELECT to_regclass(\'public."CapsuleTelemetryClaim"\')::text AS "table"'
      )
      if (!telemetryClaim.rows[0]?.table) drift.push('CapsuleTelemetryClaim table')

      const compositeFk = await client.query(
        `SELECT 1 FROM pg_constraint
         WHERE conname = 'OutfitRecommendation_capsule_id_user_id_fkey'`
      )
      if (compositeFk.rowCount === 0) {
        drift.push('OutfitRecommendation composite capsule FK')
      }

      if (drift.length > 0) {
        throw new Error(
          `Target database predates the current 20260807080000_add_outfit_capsules migration. Missing: ${drift.join(', ')}. Prisma still reports "up to date" because the migration was recorded before it was extended, so run \`npm run db:reset --workspace @couture/db\` (destructive) or point RLS_TEST_DATABASE_URL at a freshly migrated database.`
        )
      }
    } finally {
      client.release()
    }
  })

  afterAll(async () => {
    await adminPool.end()
  })

  it('4.3-DB-001 applies column defaults for revision, favorite, and profile counters', async () => {
    await inRolledBackTransaction(async (client) => {
      const fixture = await seedCapsuleGraph(client)

      const capsule = await client.query<{
        revision: number
        is_favorite: boolean
        description: string | null
      }>(
        'SELECT "revision", "is_favorite", "description" FROM public."OutfitCapsule" WHERE "id" = $1',
        [fixture.capsuleId]
      )

      expect(capsule.rows).toEqual([
        { revision: 0, is_favorite: false, description: null },
      ])

      await client.query(
        `INSERT INTO public."UserProfile" ("id", "user_id", "display_name", "updated_at")
         VALUES ($1, $2, 'Owner', NOW())`,
        [`profile-${randomUUID()}`, fixture.userId]
      )

      const profile = await client.query<{ capsule_revision: number }>(
        'SELECT "capsule_revision" FROM public."UserProfile" WHERE "user_id" = $1',
        [fixture.userId]
      )
      expect(profile.rows).toEqual([{ capsule_revision: 0 }])

      await client.query(
        `INSERT INTO public."OutfitRecommendation" ("id", "user_id", "scenario", "updated_at")
         VALUES ($1, $2, 'school', NOW())`,
        [`recommendation-${randomUUID()}`, fixture.userId]
      )

      const recommendation = await client.query<{
        capsule_revision: number
        capsule_id: string | null
      }>(
        'SELECT "capsule_revision", "capsule_id" FROM public."OutfitRecommendation" WHERE "user_id" = $1',
        [fixture.userId]
      )
      expect(recommendation.rows).toEqual([{ capsule_revision: 0, capsule_id: null }])
    })
  })

  it('4.3-DB-002 constrains garment_order to the zero-based ten-slot range', async () => {
    await inRolledBackTransaction(async (client) => {
      const fixture = await seedCapsuleGraph(client)

      const lowerBound = await insertJoin(client, fixture, { garmentOrder: 0 })
      expect(lowerBound.rows).toHaveLength(1)

      const upperBound = await insertJoin(client, fixture, {
        garmentId: fixture.garmentIds[1],
        garmentOrder: 9,
      })
      expect(upperBound.rows).toHaveLength(1)
    })

    for (const invalidOrder of [-1, 10]) {
      await inRolledBackTransaction(async (client) => {
        const fixture = await seedCapsuleGraph(client)

        await expect(
          insertJoin(client, fixture, { garmentOrder: invalidOrder })
        ).rejects.toMatchObject({
          code: '23514',
          constraint: 'OutfitCapsuleGarment_garment_order_check',
        })
      })
    }
  })

  it('4.3-DB-002 rejects a duplicate garment within one capsule', async () => {
    await inRolledBackTransaction(async (client) => {
      const fixture = await seedCapsuleGraph(client)

      await insertJoin(client, fixture, { garmentOrder: 0 })

      await expect(
        insertJoin(client, fixture, {
          garmentId: fixture.garmentIds[0],
          garmentOrder: 1,
        })
      ).rejects.toMatchObject({
        code: '23505',
        constraint: 'OutfitCapsuleGarment_capsule_id_garment_id_key',
      })
    })
  })

  it('4.3-DB-002 rejects a duplicate garment_order within one capsule', async () => {
    await inRolledBackTransaction(async (client) => {
      const fixture = await seedCapsuleGraph(client)

      await insertJoin(client, fixture, { garmentOrder: 0 })

      await expect(
        insertJoin(client, fixture, {
          garmentId: fixture.garmentIds[1],
          garmentOrder: 0,
        })
      ).rejects.toMatchObject({
        code: '23505',
        constraint: 'OutfitCapsuleGarment_capsule_id_garment_order_key',
      })
    })
  })

  it('4.3-DB-002 forces the join row to share one owner with its capsule and garment', async () => {
    // A join naming the capsule owner but another user's garment must fail.
    await inRolledBackTransaction(async (client) => {
      const fixture = await seedCapsuleGraph(client)

      await expect(
        insertJoin(client, fixture, { garmentId: fixture.otherGarmentId })
      ).rejects.toMatchObject({
        code: '23503',
        constraint: 'OutfitCapsuleGarment_garment_id_user_id_fkey',
      })
    })

    // A join naming the other user must fail against the capsule composite key.
    await inRolledBackTransaction(async (client) => {
      const fixture = await seedCapsuleGraph(client)

      await expect(
        insertJoin(client, fixture, {
          userId: fixture.otherUserId,
          garmentId: fixture.otherGarmentId,
        })
      ).rejects.toMatchObject({
        code: '23503',
        constraint: 'OutfitCapsuleGarment_capsule_id_user_id_fkey',
      })
    })
  })

  it('4.3-DB-002 cascades join deletion from both the capsule and the garment', async () => {
    await inRolledBackTransaction(async (client) => {
      const fixture = await seedCapsuleGraph(client)
      await insertJoin(client, fixture, { garmentOrder: 0 })

      await client.query('DELETE FROM public."OutfitCapsule" WHERE "id" = $1', [
        fixture.capsuleId,
      ])

      const remaining = await client.query(
        'SELECT "id" FROM public."OutfitCapsuleGarment" WHERE "capsule_id" = $1',
        [fixture.capsuleId]
      )
      expect(remaining.rows).toHaveLength(0)
    })

    await inRolledBackTransaction(async (client) => {
      const fixture = await seedCapsuleGraph(client)
      await insertJoin(client, fixture, { garmentOrder: 0 })

      await client.query('DELETE FROM public."GarmentItem" WHERE "id" = $1', [
        fixture.garmentIds[0],
      ])

      const remaining = await client.query(
        'SELECT "id" FROM public."OutfitCapsuleGarment" WHERE "capsule_id" = $1',
        [fixture.capsuleId]
      )
      expect(remaining.rows).toHaveLength(0)
    })
  })

  it('4.3-DB-002 scopes idempotency keys per owner and releases them on hard delete', async () => {
    await inRolledBackTransaction(async (client) => {
      const fixture = await seedCapsuleGraph(client)
      const sharedKey = randomUUID()

      const insertWithKey = (capsuleId: string, userId: string) =>
        client.query(
          `INSERT INTO public."OutfitCapsule"
            ("id", "user_id", "name", "occasions", "idempotency_key", "updated_at")
           VALUES ($1, $2, $3, $4::"CapsuleOccasion"[], $5, NOW())
           RETURNING "id"`,
          [capsuleId, userId, 'Keyed capsule', ['work'], sharedKey]
        )

      const firstUse = await insertWithKey(`keyed-${randomUUID()}`, fixture.userId)
      expect(firstUse.rows).toHaveLength(1)

      // A second owner may hold the same key value.
      const otherOwnerUse = await insertWithKey(
        `keyed-${randomUUID()}`,
        fixture.otherUserId
      )
      expect(otherOwnerUse.rows).toHaveLength(1)

      await expect(
        insertWithKey(`keyed-${randomUUID()}`, fixture.userId)
      ).rejects.toMatchObject({
        code: '23505',
        constraint: 'OutfitCapsule_user_id_idempotency_key_key',
      })
    })

    // Hard deletion releases the key for intentional later reuse.
    await inRolledBackTransaction(async (client) => {
      const fixture = await seedCapsuleGraph(client)
      const sharedKey = randomUUID()
      const firstCapsuleId = `keyed-${randomUUID()}`

      await client.query(
        `INSERT INTO public."OutfitCapsule"
          ("id", "user_id", "name", "occasions", "idempotency_key", "updated_at")
         VALUES ($1, $2, $3, $4::"CapsuleOccasion"[], $5, NOW())`,
        [firstCapsuleId, fixture.userId, 'Keyed capsule', ['work'], sharedKey]
      )

      await client.query('DELETE FROM public."OutfitCapsule" WHERE "id" = $1', [
        firstCapsuleId,
      ])

      const reuse = await client.query(
        `INSERT INTO public."OutfitCapsule"
          ("id", "user_id", "name", "occasions", "idempotency_key", "updated_at")
         VALUES ($1, $2, $3, $4::"CapsuleOccasion"[], $5, NOW())
         RETURNING "id"`,
        [`keyed-${randomUUID()}`, fixture.userId, 'Reused key', ['work'], sharedKey]
      )
      expect(reuse.rows).toHaveLength(1)
    })
  })

  it('4.3-DB-002 fails loudly when a referenced capsule is deleted without clearing the recommendation', async () => {
    await inRolledBackTransaction(async (client) => {
      const fixture = await seedCapsuleGraph(client)

      await client.query(
        `INSERT INTO public."OutfitRecommendation"
          ("id", "user_id", "scenario", "capsule_id", "updated_at")
         VALUES ($1, $2, 'school', $3, NOW())`,
        [`recommendation-${randomUUID()}`, fixture.userId, fixture.capsuleId]
      )

      // The composite FK is NO ACTION on purpose; deleteCapsule clears the
      // reference in the same transaction, and any other path must error.
      await expect(
        client.query('DELETE FROM public."OutfitCapsule" WHERE "id" = $1', [
          fixture.capsuleId,
        ])
      ).rejects.toMatchObject({
        code: '23503',
        constraint: 'OutfitRecommendation_capsule_id_user_id_fkey',
      })
    })
  })

  it('4.3-DB-001 installs the search, ordering, and lookup indexes the query plans depend on', async () => {
    const client = await adminPool.connect()

    try {
      const indexes = await client.query<{ indexname: string }>(
        `SELECT "indexname" FROM pg_indexes
         WHERE "schemaname" = 'public'
           AND "tablename" IN ('OutfitCapsule', 'OutfitCapsuleGarment', 'OutfitRecommendation')`
      )
      const names = indexes.rows.map((row) => row.indexname)

      expect(names).toEqual(
        expect.arrayContaining([
          'OutfitCapsule_id_user_id_key',
          'OutfitCapsule_user_id_idempotency_key_key',
          'OutfitCapsule_user_id_is_favorite_updated_at_id_idx',
          'OutfitCapsule_user_id_updated_at_idx',
          'OutfitCapsule_user_id_name_idx',
          'OutfitCapsule_name_trgm_idx',
          'OutfitCapsule_description_trgm_idx',
          'OutfitCapsule_occasions_idx',
          'OutfitCapsuleGarment_capsule_id_garment_id_key',
          'OutfitCapsuleGarment_capsule_id_garment_order_key',
          'OutfitCapsuleGarment_garment_id_idx',
          'OutfitRecommendation_capsule_id_idx',
        ])
      )
    } finally {
      client.release()
    }
  })

  it('4.3-DB-001 enables row level security and grants CRUD on both capsule tables', async () => {
    const client = await adminPool.connect()

    try {
      const rls = await client.query<{ relname: string; relrowsecurity: boolean }>(
        `SELECT "relname", "relrowsecurity" FROM pg_class
         WHERE "relname" IN ('OutfitCapsule', 'OutfitCapsuleGarment')
         ORDER BY "relname"`
      )
      expect(rls.rows).toEqual([
        { relname: 'OutfitCapsule', relrowsecurity: true },
        { relname: 'OutfitCapsuleGarment', relrowsecurity: true },
      ])

      const policies = await client.query<{ tablename: string; cmd: string }>(
        `SELECT "tablename", "cmd" FROM pg_policies
         WHERE "tablename" IN ('OutfitCapsule', 'OutfitCapsuleGarment')`
      )
      for (const table of ['OutfitCapsule', 'OutfitCapsuleGarment']) {
        const commands = policies.rows
          .filter((row) => row.tablename === table)
          .map((row) => row.cmd)
          .sort()
        expect(commands).toEqual(['DELETE', 'INSERT', 'SELECT', 'UPDATE'])
      }

      const grants = await client.query<{ table_name: string; privilege_type: string }>(
        `SELECT "table_name", "privilege_type" FROM information_schema.role_table_grants
         WHERE "table_schema" = 'public'
           AND "table_name" IN ('OutfitCapsule', 'OutfitCapsuleGarment')
           AND "grantee" = 'authenticated'`
      )
      for (const table of ['OutfitCapsule', 'OutfitCapsuleGarment']) {
        const privileges = grants.rows
          .filter((row) => row.table_name === table)
          .map((row) => row.privilege_type)
          .sort()
        expect(privileges).toEqual(['DELETE', 'INSERT', 'SELECT', 'UPDATE'])
      }
    } finally {
      client.release()
    }
  })
})
