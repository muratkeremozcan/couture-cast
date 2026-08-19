// Learning path Step 35: Premium theme switcher.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-35-premium-theme-switcher
import { randomUUID } from 'node:crypto'
import { afterAll, describe, expect, it } from 'vitest'
import { Pool, type PoolClient } from 'pg'

/**
 * Story 5.3 Task 1: the premium theme preference schema, exercised against a
 * real PostgreSQL connection rather than by reading migration.sql as text.
 *
 * The properties pinned here are the ones a service bug would silently erode:
 *
 *   * `theme` is NULLABLE, and NULL is the Default selection. Reset is an
 *     upsert to NULL, never a DELETE (Decision 8), so a schema that made the
 *     column NOT NULL would force the delete-on-reset implementation the story
 *     explicitly refuses.
 *   * `user_id` is UNIQUE — one row per user. Without it a "reset" would leave
 *     two rows and the read path would have to pick a winner.
 *   * The FK cascades on user delete. The preference is cosmetic and carries no
 *     financial or audit value, so it leaves with the account rather than
 *     surviving as an unattributed row the way BillingEvent does.
 *   * The enum carries exactly the three shipped palettes: no `default`/`none`
 *     member (that is what NULL is for) and no `spring_bloom` (marked future in
 *     the UX spec).
 *
 * Policy and actor-matrix coverage for this table lives in
 * `rls-policies.spec.ts`, which owns the owner-only category it registers in.
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

type ThemeFixture = {
  userId: string
  preferenceId: string
}

const insertThemePreference = async (
  client: PoolClient,
  id: string,
  userId: string,
  theme: string | null
) => {
  await client.query(
    `INSERT INTO public."PremiumThemePreference"
      ("id", "user_id", "theme", "updated_at")
     VALUES ($1, $2, $3::"PremiumThemeKey", NOW())`,
    [id, userId, theme]
  )
}

const seedThemeGraph = async (client: PoolClient): Promise<ThemeFixture> => {
  const suffix = randomUUID()
  const fixture: ThemeFixture = {
    userId: `theme-owner-${suffix}`,
    preferenceId: `theme-preference-${suffix}`,
  }

  await client.query(
    'INSERT INTO public."User" ("id", "email", "updated_at") VALUES ($1, $2, NOW())',
    [fixture.userId, `theme-owner-${suffix}@example.com`]
  )

  await insertThemePreference(
    client,
    fixture.preferenceId,
    fixture.userId,
    'jewel_radiance'
  )

  return fixture
}

afterAll(async () => {
  await adminPool.end()
})

describe('premium theme preference schema', () => {
  describe('PremiumThemeKey enum', () => {
    it('5.3-DB-010 carries exactly the three shipped palettes', async () => {
      // No `default`/`none` member: an absent selection is already spelled by a
      // NULL theme, and two spellings of one fact is the trap 5.2 named. No
      // `spring_bloom` either — the UX spec marks it future.
      const client = await adminPool.connect()

      try {
        const result = await client.query<{ label: string }>(
          `SELECT e.enumlabel AS label
           FROM pg_enum AS e
           INNER JOIN pg_type AS t ON t.oid = e.enumtypid
           WHERE t.typname = 'PremiumThemeKey'
           ORDER BY e.enumsortorder`
        )

        expect(result.rows.map((row) => row.label)).toEqual([
          'jewel_radiance',
          'autumn_umber',
          'winter_metallic',
        ])
      } finally {
        client.release()
      }
    })

    it('5.3-DB-010b rejects a palette key the enum does not define', async () => {
      await inRolledBackTransaction(async (client) => {
        const suffix = randomUUID()
        await client.query(
          'INSERT INTO public."User" ("id", "email", "updated_at") VALUES ($1, $2, NOW())',
          [`theme-unknown-${suffix}`, `theme-unknown-${suffix}@example.com`]
        )

        await expect(
          insertThemePreference(
            client,
            `theme-unknown-pref-${suffix}`,
            `theme-unknown-${suffix}`,
            'spring_bloom'
          )
        ).rejects.toMatchObject({ code: '22P02' })
      })
    })
  })

  describe('theme nullability', () => {
    it('5.3-DB-011 accepts NULL as the Default selection', async () => {
      await inRolledBackTransaction(async (client) => {
        const suffix = randomUUID()
        await client.query(
          'INSERT INTO public."User" ("id", "email", "updated_at") VALUES ($1, $2, NOW())',
          [`theme-null-${suffix}`, `theme-null-${suffix}@example.com`]
        )

        await insertThemePreference(
          client,
          `theme-null-pref-${suffix}`,
          `theme-null-${suffix}`,
          null
        )

        const stored = await client.query<{ theme: string | null }>(
          'SELECT "theme" FROM public."PremiumThemePreference" WHERE "id" = $1',
          [`theme-null-pref-${suffix}`]
        )
        expect(stored.rows).toHaveLength(1)
        expect(stored.rows[0]?.theme).toBeNull()
      })
    })

    it('5.3-DB-011b resets to Default with an UPDATE, leaving the row in place', async () => {
      // Decision 8's write path: PUT { theme: null } upserts to NULL and must
      // never delete. A NOT NULL column would make that impossible to express,
      // so this is the schema-level guard for the service-level rule.
      await inRolledBackTransaction(async (client) => {
        const fixture = await seedThemeGraph(client)

        const updated = await client.query<{ theme: string | null }>(
          `UPDATE public."PremiumThemePreference"
             SET "theme" = NULL, "updated_at" = NOW()
           WHERE "id" = $1
           RETURNING "theme"`,
          [fixture.preferenceId]
        )
        expect(updated.rows).toEqual([{ theme: null }])

        const surviving = await client.query(
          'SELECT "id" FROM public."PremiumThemePreference" WHERE "user_id" = $1',
          [fixture.userId]
        )
        expect(surviving.rows).toEqual([{ id: fixture.preferenceId }])
      })
    })
  })

  describe('one row per user', () => {
    it('5.3-DB-012 rejects a second preference row for the same user', async () => {
      await inRolledBackTransaction(async (client) => {
        const fixture = await seedThemeGraph(client)

        await expect(
          insertThemePreference(
            client,
            `theme-dup-${randomUUID()}`,
            fixture.userId,
            'autumn_umber'
          )
        ).rejects.toMatchObject({ code: '23505' })
      })
    })
  })

  /**
   * Grants and policies, asserted here rather than left to `rls-policies.spec.ts`.
   *
   * That file owns the ACTOR matrix: who can see whose row. It proves nothing about the
   * PRIVILEGE BREADTH underneath, and the two fail differently. A table with correct
   * policies and no `GRANT` denies everyone including the owner; a table with the
   * grants and no policies exposes every row to every signed-in client. `authenticated`
   * is checked against the exact four verbs `private.can_manage_self_row` is written
   * for, and `anon` against nothing at all — this is a per-user preference, so an
   * unauthenticated client has no business reaching the table before RLS is consulted.
   * Same assertions `commerce-schema.spec.ts` makes for `CommercePreference`, which is
   * this table's template.
   */
  describe('grants and policies', () => {
    it('5.3-DB-014 grants authenticated exactly the four owner verbs, and anon none', async () => {
      await inRolledBackTransaction(async (client) => {
        const grants = await client.query<{
          grantee: string
          privilege_type: string
        }>(
          `SELECT "grantee", "privilege_type" FROM information_schema.role_table_grants
           WHERE "table_schema" = 'public'
             AND "table_name" = 'PremiumThemePreference'
             AND "grantee" IN ('authenticated', 'anon')`
        )

        const authenticated = grants.rows
          .filter((row) => row.grantee === 'authenticated')
          .map((row) => row.privilege_type)
          .sort()
        expect(authenticated).toEqual(['DELETE', 'INSERT', 'SELECT', 'UPDATE'])

        // No TRUNCATE, no REFERENCES, no TRIGGER: the four verbs above are the
        // whole of what a client may do, and a wider grant is a finding.
        expect(authenticated).toHaveLength(4)

        expect(grants.rows.filter((row) => row.grantee === 'anon')).toHaveLength(0)
      })
    })

    it('5.3-DB-015 enables row level security and carries one policy per verb', async () => {
      await inRolledBackTransaction(async (client) => {
        // Both catalog lookups are schema-qualified. `pg_class.relname` and
        // `pg_policies.tablename` are unique per schema, not per database, so an
        // unqualified name would happily match a same-named relation somewhere
        // else on the search path and prove the assertion about the wrong table.
        const rls = await client.query<{ relrowsecurity: boolean }>(
          `SELECT "relrowsecurity" FROM pg_class
           WHERE "relnamespace" = 'public'::regnamespace
             AND "relname" = 'PremiumThemePreference'`
        )
        expect(rls.rows).toEqual([{ relrowsecurity: true }])

        const policies = await client.query<{ policyname: string; cmd: string }>(
          `SELECT "policyname", "cmd" FROM pg_policies
           WHERE "schemaname" = 'public'
             AND "tablename" = 'PremiumThemePreference'`
        )
        expect(policies.rows.map((row) => row.cmd).sort()).toEqual([
          'DELETE',
          'INSERT',
          'SELECT',
          'UPDATE',
        ])
        // The names are load-bearing: rls-policies.spec.ts asserts every
        // selfOnlyTables member carries this exact set, so a rename fails there.
        expect(policies.rows.map((row) => row.policyname).sort()).toEqual([
          'authenticated_delete_own_user_data',
          'authenticated_insert_own_user_data',
          'authenticated_read_own_user_data',
          'authenticated_update_own_user_data',
        ])
      })
    })
  })

  describe('user erasure', () => {
    it('5.3-DB-013 cascades the preference away with the account', async () => {
      // Unlike BillingEvent, a palette choice carries no financial or audit
      // value, so there is nothing to preserve as an unattributed row.
      await inRolledBackTransaction(async (client) => {
        const fixture = await seedThemeGraph(client)

        await client.query('DELETE FROM public."User" WHERE "id" = $1', [fixture.userId])

        const remaining = await client.query(
          'SELECT "id" FROM public."PremiumThemePreference" WHERE "id" = $1',
          [fixture.preferenceId]
        )
        expect(remaining.rows).toHaveLength(0)
      })
    })
  })
})
