// Learning path Step 60: Saved looks follow the account.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-60-saved-looks-follow-the-account
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Pool, type PoolClient } from 'pg'

const databaseUrl =
  process.env.RLS_TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54361/postgres'

const adminPool = new Pool({ connectionString: databaseUrl, max: 4 })

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

const buildClaims = (email: string, role = 'teen') => ({
  sub: randomUUID(),
  email,
  email_verified: true,
  role: 'authenticated',
  app_metadata: { role },
})

const withRole = async <T>(
  role: 'authenticated' | 'anon',
  claims: Record<string, unknown> | null,
  run: (client: PoolClient) => Promise<T>
): Promise<T> => {
  const client = await adminPool.connect()
  try {
    await client.query('BEGIN')
    await client.query(`SET LOCAL ROLE ${role}`)
    if (claims) {
      await client.query('SELECT set_config($1, $2, true)', [
        'request.jwt.claims',
        JSON.stringify(claims),
      ])
    }
    return await run(client)
  } finally {
    try {
      await client.query('ROLLBACK')
    } catch {
      // Ignore rollback failures so the pooled client is still released.
    }
    client.release()
  }
}

describe('saved looks schema, cascade, and RLS invariants', () => {
  beforeAll(async () => {
    const client = await adminPool.connect()
    try {
      await client.query('SELECT 1 FROM public."SavedLook" LIMIT 1')
    } catch (error) {
      throw new Error(
        'SavedLook schema tests require a migrated target database. Run `npx prisma migrate deploy --schema packages/db/prisma/schema.prisma` first.',
        { cause: error }
      )
    } finally {
      client.release()
    }
  })

  afterAll(async () => {
    await adminPool.end()
  })

  it('applies revision default, indexes, RLS policies, and authenticated grants', async () => {
    const client = await adminPool.connect()
    try {
      const indexes = await client.query<{ indexname: string }>(
        `SELECT "indexname" FROM pg_indexes
         WHERE "schemaname" = 'public' AND "tablename" = 'SavedLook'`
      )
      expect(indexes.rows.map((r) => r.indexname)).toEqual(
        expect.arrayContaining([
          'SavedLook_id_user_id_key',
          'SavedLook_user_id_idempotency_key_key',
          'SavedLook_user_id_deleted_at_updated_at_id_idx',
          'SavedLook_user_id_source_anchor_garment_id_idx',
        ])
      )

      const rls = await client.query<{ relrowsecurity: boolean }>(
        'SELECT "relrowsecurity" FROM pg_class WHERE "relname" = \'SavedLook\''
      )
      expect(rls.rows).toEqual([{ relrowsecurity: true }])

      const policies = await client.query<{ cmd: string }>(
        'SELECT "cmd" FROM pg_policies WHERE "tablename" = \'SavedLook\''
      )
      expect(policies.rows).toEqual([])

      const grants = await client.query<{ privilege_type: string }>(
        `SELECT "privilege_type" FROM information_schema.role_table_grants
         WHERE "table_schema" = 'public'
           AND "table_name" = 'SavedLook'
           AND "grantee" IN ('authenticated', 'anon')`
      )
      expect(grants.rows).toEqual([])
    } finally {
      client.release()
    }
  })

  it('cascades on User deletion but preserves SavedLook when referenced GarmentItem is deleted', async () => {
    await inRolledBackTransaction(async (client) => {
      const suffix = randomUUID()
      const userId = `sl-user-${suffix}`
      const garmentId = `sl-garment-${suffix}`
      const lookRowId = `sl-look-${suffix}`

      await client.query(
        'INSERT INTO public."User" ("id", "email", "updated_at") VALUES ($1, $2, NOW())',
        [userId, `sl-${suffix}@example.com`]
      )
      await client.query(
        'INSERT INTO public."GarmentItem" ("id", "user_id", "category", "updated_at") VALUES ($1, $2, \'top\', NOW())',
        [garmentId, userId]
      )
      await client.query(
        `INSERT INTO public."SavedLook"
          ("id", "user_id", "source", "look_id", "weather", "anchor_garment_id", "anchor_snapshot", "composition", "swaps", "updated_at")
         VALUES ($1, $2, 'style_piece', 'look-1', 'warm-rainy', $3, $4::jsonb, $5::jsonb, '{}'::jsonb, NOW())`,
        [
          lookRowId,
          userId,
          garmentId,
          JSON.stringify({ garmentId, category: 'top', comfortRange: 'mild' }),
          JSON.stringify([
            { slotIndex: 0, category: 'top', kind: 'garment', itemId: garmentId },
          ]),
        ]
      )

      const defaults = await client.query<{ revision: number }>(
        'SELECT "revision" FROM public."SavedLook" WHERE "id" = $1',
        [lookRowId]
      )
      expect(defaults.rows).toEqual([{ revision: 0 }])

      // Deleting the garment MUST preserve the saved look so missing_garment can be surfaced.
      await client.query('DELETE FROM public."GarmentItem" WHERE "id" = $1', [garmentId])
      const afterGarmentDelete = await client.query<{ id: string }>(
        'SELECT "id" FROM public."SavedLook" WHERE "id" = $1',
        [lookRowId]
      )
      expect(afterGarmentDelete.rows).toEqual([{ id: lookRowId }])

      // Deleting the user MUST cascade-delete the saved look.
      await client.query('DELETE FROM public."User" WHERE "id" = $1', [userId])
      const afterUserDelete = await client.query<{ id: string }>(
        'SELECT "id" FROM public."SavedLook" WHERE "id" = $1',
        [lookRowId]
      )
      expect(afterUserDelete.rows).toHaveLength(0)
    })
  })

  it('scopes idempotency keys per owner and enforces RLS isolation across authenticated and anon roles', async () => {
    const suffix = randomUUID()
    const ownerId = `sl-rls-owner-${suffix}`
    const ownerEmail = `sl-rls-owner-${suffix}@example.com`
    const otherId = `sl-rls-other-${suffix}`
    const otherEmail = `sl-rls-other-${suffix}@example.com`
    const ownerLookId = `sl-rls-look-${suffix}`
    const sharedKey = randomUUID()

    const setupClient = await adminPool.connect()
    try {
      await setupClient.query('BEGIN')
      await setupClient.query(
        'INSERT INTO public."User" ("id", "email", "updated_at") VALUES ($1, $2, NOW()), ($3, $4, NOW())',
        [ownerId, ownerEmail, otherId, otherEmail]
      )
      await setupClient.query(
        `INSERT INTO public."SavedLook"
          ("id", "user_id", "source", "look_id", "weather", "composition", "swaps", "idempotency_key", "updated_at")
         VALUES ($1, $2, 'home_sample', 'sample-1', 'mild-clear', '[{"slotIndex":0,"category":"top","kind":"catalog","itemId":"t1"}]'::jsonb, '{}'::jsonb, $3, NOW())`,
        [ownerLookId, ownerId, sharedKey]
      )
      await setupClient.query('COMMIT')
    } catch (error) {
      await setupClient.query('ROLLBACK')
      throw error
    } finally {
      setupClient.release()
    }

    try {
      // Same owner + same idempotency_key fails with 23505.
      await inRolledBackTransaction(async (client) => {
        await expect(
          client.query(
            `INSERT INTO public."SavedLook"
              ("id", "user_id", "source", "look_id", "weather", "composition", "swaps", "idempotency_key", "updated_at")
             VALUES ($1, $2, 'home_sample', 'sample-2', 'mild-clear', '[{"slotIndex":0,"category":"top","kind":"catalog","itemId":"t1"}]'::jsonb, '{}'::jsonb, $3, NOW())`,
            [`sl-dup-${randomUUID()}`, ownerId, sharedKey]
          )
        ).rejects.toMatchObject({
          code: '23505',
          constraint: 'SavedLook_user_id_idempotency_key_key',
        })
      })

      // Another owner MAY use the same idempotency_key.
      await inRolledBackTransaction(async (client) => {
        const otherInsert = await client.query<{ id: string }>(
          `INSERT INTO public."SavedLook"
            ("id", "user_id", "source", "look_id", "weather", "composition", "swaps", "idempotency_key", "updated_at")
           VALUES ($1, $2, 'home_sample', 'sample-2', 'mild-clear', '[{"slotIndex":0,"category":"top","kind":"catalog","itemId":"t1"}]'::jsonb, '{}'::jsonb, $3, NOW())
           RETURNING "id"`,
          [`sl-other-${randomUUID()}`, otherId, sharedKey]
        )
        expect(otherInsert.rows).toHaveLength(1)
      })

      // Direct PostgREST reads and writes are denied for every client role (API-only table):
      // owner, unrelated member, moderator, and anon all receive 42501.
      for (const [role, claims] of [
        ['authenticated', buildClaims(ownerEmail, 'teen')],
        ['authenticated', buildClaims(otherEmail, 'teen')],
        ['authenticated', buildClaims(`mod-${suffix}@example.com`, 'moderator')],
        ['anon', null],
      ] as const) {
        await withRole(role, claims, async (client) => {
          await client.query('SAVEPOINT sp_select')
          await expect(
            client.query('SELECT "id" FROM public."SavedLook" WHERE "user_id" = $1', [
              ownerId,
            ])
          ).rejects.toMatchObject({ code: '42501' })
          await client.query('ROLLBACK TO SAVEPOINT sp_select')

          await client.query('SAVEPOINT sp_insert')
          await expect(
            client.query(
              `INSERT INTO public."SavedLook"
                ("id", "user_id", "source", "look_id", "weather", "composition", "swaps", "updated_at")
               VALUES ($1, $2, 'home_sample', 'sample-direct', 'mild-clear', '[]'::jsonb, '{}'::jsonb, NOW())`,
              [`sl-direct-${randomUUID()}`, ownerId]
            )
          ).rejects.toMatchObject({ code: '42501' })
          await client.query('ROLLBACK TO SAVEPOINT sp_insert')

          await client.query('SAVEPOINT sp_delete')
          await expect(
            client.query('DELETE FROM public."SavedLook" WHERE "id" = $1', [ownerLookId])
          ).rejects.toMatchObject({ code: '42501' })
          await client.query('ROLLBACK TO SAVEPOINT sp_delete')
        })
      }
    } finally {
      const cleanup = await adminPool.connect()
      try {
        await cleanup.query('DELETE FROM public."User" WHERE "id" IN ($1, $2)', [
          ownerId,
          otherId,
        ])
      } finally {
        cleanup.release()
      }
    }
  })
})
