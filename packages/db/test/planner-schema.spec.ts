// Story 5.5: premium 7-day outfit planner.
import { randomUUID } from 'node:crypto'
import { afterAll, describe, expect, it } from 'vitest'
import { Pool, type PoolClient } from 'pg'

/**
 * Story 5.5 Task 3: the planner schema, exercised against a real PostgreSQL
 * connection rather than by reading migration.sql as text.
 *
 * The properties pinned here are the ones a service bug would silently erode:
 *
 *   * `PlannerDayPlan` is unique on (user_id, location_id, plan_date) --
 *     Decision 4's one-cache-row-per-day identity.
 *   * The composite FK to SavedLocation(id, user_id) makes it structurally
 *     impossible for a planner row to reference another user's saved
 *     location, mirroring OutfitCapsuleGarment -> GarmentItem(id, user_id).
 *   * Both FKs cascade: account deletion AND saved-location deletion each
 *     remove the planner rows that depend on them (AC 8).
 *   * `plan_payload` is untyped Json at the schema layer -- the internal
 *     strict Zod schema and ownership re-check live in the service, so a
 *     malformed or stale payload is still an ordinary row the schema will
 *     store and delete without complaint.
 *
 * Actor-matrix coverage lives in `test/rls/planner.spec.ts`, which owns the
 * selfOnlyTables category this table registers in.
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

type PlannerFixture = {
  userId: string
  locationId: string
  planId: string
}

const insertUser = async (client: PoolClient, id: string, email: string) => {
  await client.query(
    'INSERT INTO public."User" ("id", "email", "updated_at") VALUES ($1, $2, NOW())',
    [id, email]
  )
}

const insertSavedLocation = async (
  client: PoolClient,
  id: string,
  userId: string,
  isPrimary = true
): Promise<void> => {
  // Only one primary location per user (SavedLocation_one_primary_per_user_key),
  // so a second location for the same user must be seeded non-primary.
  await client.query(
    `INSERT INTO public."SavedLocation"
      ("id", "user_id", "label", "location_key", "latitude", "longitude", "timezone", "is_primary", "sort_order", "updated_at")
     VALUES ($1, $2, 'Home', $3, 41.878, -87.63, 'America/Chicago', $4, 0, NOW())`,
    [id, userId, `location-${id}`, isPrimary]
  )
}

const seedPlannerGraph = async (client: PoolClient): Promise<PlannerFixture> => {
  const suffix = randomUUID()
  const fixture: PlannerFixture = {
    userId: `planner-owner-${suffix}`,
    locationId: `planner-location-${suffix}`,
    planId: `planner-day-plan-${suffix}`,
  }

  await insertUser(client, fixture.userId, `planner-owner-${suffix}@example.com`)
  await insertSavedLocation(client, fixture.locationId, fixture.userId)

  await client.query(
    `INSERT INTO public."PlannerDayPlan"
      ("id", "user_id", "location_id", "plan_date", "locale", "dependency_fingerprint", "plan_payload", "updated_at")
     VALUES ($1, $2, $3, CURRENT_DATE, 'en-US', 'fingerprint-1', '{}'::jsonb, NOW())`,
    [fixture.planId, fixture.userId, fixture.locationId]
  )

  return fixture
}

afterAll(async () => {
  await adminPool.end()
})

describe('planner schema', () => {
  describe('new enums', () => {
    it('5.5-DB-020 pins PlannerOutfitSource to exactly its shipped members', async () => {
      const client = await adminPool.connect()

      try {
        const result = await client.query<{ label: string }>(
          `SELECT e.enumlabel AS label
           FROM pg_enum AS e
           INNER JOIN pg_type AS t ON t.oid = e.enumtypid
           WHERE t.typname = 'PlannerOutfitSource'
           ORDER BY e.enumsortorder`
        )
        expect(result.rows.map((row) => row.label)).toEqual(['generated', 'reshuffled'])
      } finally {
        client.release()
      }
    })
  })

  describe('PlannerDayPlan: one row per (user, location, date)', () => {
    it('5.5-DB-021 rejects a duplicate (user_id, location_id, plan_date) row', async () => {
      await inRolledBackTransaction(async (client) => {
        const fixture = await seedPlannerGraph(client)

        await expect(
          client.query(
            `INSERT INTO public."PlannerDayPlan"
              ("id", "user_id", "location_id", "plan_date", "locale", "dependency_fingerprint", "plan_payload", "updated_at")
             VALUES ($1, $2, $3, CURRENT_DATE, 'en-US', 'fingerprint-2', '{}'::jsonb, NOW())`,
            [`planner-dup-${randomUUID()}`, fixture.userId, fixture.locationId]
          )
        ).rejects.toMatchObject({ code: '23505' })
      })
    })

    it('5.5-DB-022 allows the same date across two different saved locations', async () => {
      await inRolledBackTransaction(async (client) => {
        const fixture = await seedPlannerGraph(client)
        const secondLocationId = `planner-location-2-${randomUUID()}`
        await insertSavedLocation(client, secondLocationId, fixture.userId, false)

        await client.query(
          `INSERT INTO public."PlannerDayPlan"
            ("id", "user_id", "location_id", "plan_date", "locale", "dependency_fingerprint", "plan_payload", "updated_at")
           VALUES ($1, $2, $3, CURRENT_DATE, 'en-US', 'fingerprint-3', '{}'::jsonb, NOW())`,
          [`planner-other-location-${randomUUID()}`, fixture.userId, secondLocationId]
        )
      })
    })

    it('5.5-DB-023 rejects a location_id that does not belong to the given user', async () => {
      await inRolledBackTransaction(async (client) => {
        const fixture = await seedPlannerGraph(client)
        const strangerId = `planner-stranger-${randomUUID()}`
        await insertUser(client, strangerId, `${strangerId}@example.com`)

        // The composite FK to SavedLocation(id, user_id) is what makes this
        // fail: `fixture.locationId` exists, but not paired with `strangerId`.
        await expect(
          client.query(
            `INSERT INTO public."PlannerDayPlan"
              ("id", "user_id", "location_id", "plan_date", "locale", "dependency_fingerprint", "plan_payload", "updated_at")
             VALUES ($1, $2, $3, CURRENT_DATE, 'en-US', 'fingerprint-4', '{}'::jsonb, NOW())`,
            [`planner-cross-user-${randomUUID()}`, strangerId, fixture.locationId]
          )
        ).rejects.toMatchObject({ code: '23503' })
      })
    })
  })

  describe('grants and policies', () => {
    it('5.5-DB-025 grants authenticated exactly the four owner verbs on PlannerDayPlan, and anon none', async () => {
      await inRolledBackTransaction(async (client) => {
        const grants = await client.query<{ grantee: string; privilege_type: string }>(
          `SELECT "grantee", "privilege_type" FROM information_schema.role_table_grants
           WHERE "table_schema" = 'public'
             AND "table_name" = 'PlannerDayPlan'
             AND "grantee" IN ('authenticated', 'anon')`
        )

        const authenticated = grants.rows
          .filter((row) => row.grantee === 'authenticated')
          .map((row) => row.privilege_type)
          .sort()
        expect(authenticated).toEqual(['DELETE', 'INSERT', 'SELECT', 'UPDATE'])
        expect(authenticated).toHaveLength(4)

        expect(grants.rows.filter((row) => row.grantee === 'anon')).toHaveLength(0)
      })
    })

    it('5.5-DB-026 enables row level security and carries the four owner policies on PlannerDayPlan', async () => {
      await inRolledBackTransaction(async (client) => {
        const rls = await client.query<{ relrowsecurity: boolean }>(
          `SELECT "relrowsecurity" FROM pg_class
           WHERE "relnamespace" = 'public'::regnamespace
             AND "relname" = 'PlannerDayPlan'`
        )
        expect(rls.rows).toEqual([{ relrowsecurity: true }])

        const policies = await client.query<{ policyname: string; cmd: string }>(
          `SELECT "policyname", "cmd" FROM pg_policies
           WHERE "schemaname" = 'public'
             AND "tablename" = 'PlannerDayPlan'`
        )
        expect(policies.rows.map((row) => row.cmd).sort()).toEqual([
          'DELETE',
          'INSERT',
          'SELECT',
          'UPDATE',
        ])
        expect(policies.rows.map((row) => row.policyname).sort()).toEqual([
          'authenticated_delete_own_user_data',
          'authenticated_insert_own_user_data',
          'authenticated_read_own_user_data',
          'authenticated_update_own_user_data',
        ])
      })
    })
  })

  describe('cascades', () => {
    it('5.5-DB-027 cascades away with the account on user erasure', async () => {
      await inRolledBackTransaction(async (client) => {
        const fixture = await seedPlannerGraph(client)

        await client.query('DELETE FROM public."User" WHERE "id" = $1', [fixture.userId])

        const remaining = await client.query(
          'SELECT "id" FROM public."PlannerDayPlan" WHERE "id" = $1',
          [fixture.planId]
        )
        expect(remaining.rows).toHaveLength(0)
      })
    })

    it('5.5-DB-028 cascades away with the saved location on location deletion', async () => {
      await inRolledBackTransaction(async (client) => {
        const fixture = await seedPlannerGraph(client)

        await client.query('DELETE FROM public."SavedLocation" WHERE "id" = $1', [
          fixture.locationId,
        ])

        const remaining = await client.query(
          'SELECT "id" FROM public."PlannerDayPlan" WHERE "id" = $1',
          [fixture.planId]
        )
        expect(remaining.rows).toHaveLength(0)
      })
    })

    it('5.5-DB-029 stores and then cleanly removes a row with a malformed plan_payload', async () => {
      // The schema itself has no opinion on the JSON shape -- the internal
      // strict Zod schema and ownership re-check live in PlannerService, so
      // a malformed payload is still an ordinary row here.
      await inRolledBackTransaction(async (client) => {
        const fixture = await seedPlannerGraph(client)
        const malformedId = `planner-malformed-${randomUUID()}`

        await client.query(
          `INSERT INTO public."PlannerDayPlan"
            ("id", "user_id", "location_id", "plan_date", "locale", "dependency_fingerprint", "plan_payload", "updated_at")
           VALUES ($1, $2, $3, CURRENT_DATE + 1, 'en-US', 'fingerprint-malformed', $4::jsonb, NOW())`,
          [
            malformedId,
            fixture.userId,
            fixture.locationId,
            JSON.stringify({ not: 'a valid plan' }),
          ]
        )

        const deleted = await client.query(
          'DELETE FROM public."PlannerDayPlan" WHERE "id" = $1 RETURNING "id"',
          [malformedId]
        )
        expect(deleted.rows).toEqual([{ id: malformedId }])
      })
    })
  })
})
