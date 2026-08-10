import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Pool, type PoolClient } from 'pg'

/**
 * 4.4-DB-001 and 4.4-DB-002.
 *
 * These assertions run the migrated schema instead of reading migration.sql
 * as text (Story 4.3's review found and fixed exactly that shortcut).
 * Defaults, uniqueness, cascades, indexes, policies, and grants are all
 * exercised against a real PostgreSQL connection.
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

type UserFixture = { userId: string; otherUserId: string }

const seedUsers = async (client: PoolClient): Promise<UserFixture> => {
  const suffix = randomUUID()
  const fixture: UserFixture = {
    userId: `wardrobe-onboarding-owner-${suffix}`,
    otherUserId: `wardrobe-onboarding-other-${suffix}`,
  }

  for (const [id, email] of [
    [fixture.userId, `onboarding-owner-${suffix}@example.com`],
    [fixture.otherUserId, `onboarding-other-${suffix}@example.com`],
  ]) {
    await client.query(
      'INSERT INTO public."User" ("id", "email", "updated_at") VALUES ($1, $2, NOW())',
      [id, email]
    )
  }

  return fixture
}

describe('wardrobe onboarding and silhouette schema and migration', () => {
  beforeAll(async () => {
    const client = await adminPool.connect()

    try {
      await client.query('SELECT 1 FROM public."WardrobeOnboardingState" LIMIT 1')
      await client.query('SELECT 1 FROM public."SilhouetteProfile" LIMIT 1')
    } catch (error) {
      throw new Error(
        'Wardrobe onboarding schema tests require a migrated target database. Run `npx prisma migrate deploy --schema packages/db/prisma/schema.prisma` before running this suite.',
        { cause: error }
      )
    } finally {
      client.release()
    }
  })

  afterAll(async () => {
    await adminPool.end()
  })

  it('4.4-DB-001 applies column defaults for a fresh onboarding state row', async () => {
    await inRolledBackTransaction(async (client) => {
      const fixture = await seedUsers(client)

      await client.query(
        `INSERT INTO public."WardrobeOnboardingState" ("id", "user_id", "updated_at")
         VALUES ($1, $2, NOW())`,
        [`onboarding-${randomUUID()}`, fixture.userId]
      )

      const row = await client.query<{
        status: string
        current_step: string
        used_starter_wardrobe: boolean
        garments_captured_count: number
        started_at: Date | null
        completed_at: Date | null
        revision: number
      }>(
        `SELECT "status", "current_step", "used_starter_wardrobe",
                "garments_captured_count", "started_at", "completed_at", "revision"
         FROM public."WardrobeOnboardingState" WHERE "user_id" = $1`,
        [fixture.userId]
      )

      expect(row.rows).toEqual([
        {
          status: 'not_started',
          current_step: 'permission',
          used_starter_wardrobe: false,
          garments_captured_count: 0,
          started_at: null,
          completed_at: null,
          revision: 0,
        },
      ])
    })
  })

  it('4.4-DB-001 applies column defaults for a fresh silhouette profile row', async () => {
    await inRolledBackTransaction(async (client) => {
      const fixture = await seedUsers(client)

      await client.query(
        `INSERT INTO public."SilhouetteProfile" ("id", "user_id", "updated_at")
         VALUES ($1, $2, NOW())`,
        [`silhouette-${randomUUID()}`, fixture.userId]
      )

      const row = await client.query<{
        mode: string
        height_slider: number | null
        build_slider: number | null
        my_form_status: string | null
        my_form_retention_status: string
        revision: number
      }>(
        `SELECT "mode", "height_slider", "build_slider", "my_form_status",
                "my_form_retention_status", "revision"
         FROM public."SilhouetteProfile" WHERE "user_id" = $1`,
        [fixture.userId]
      )

      expect(row.rows).toEqual([
        {
          mode: 'default_mannequin',
          height_slider: null,
          build_slider: null,
          my_form_status: null,
          my_form_retention_status: 'active',
          revision: 0,
        },
      ])
    })
  })

  it('4.4-DB-002 enforces one onboarding-state row per user', async () => {
    await inRolledBackTransaction(async (client) => {
      const fixture = await seedUsers(client)

      await client.query(
        `INSERT INTO public."WardrobeOnboardingState" ("id", "user_id", "updated_at")
         VALUES ($1, $2, NOW())`,
        [`onboarding-${randomUUID()}`, fixture.userId]
      )

      await expect(
        client.query(
          `INSERT INTO public."WardrobeOnboardingState" ("id", "user_id", "updated_at")
           VALUES ($1, $2, NOW())`,
          [`onboarding-second-${randomUUID()}`, fixture.userId]
        )
      ).rejects.toMatchObject({
        code: '23505',
        constraint: 'WardrobeOnboardingState_user_id_key',
      })
    })
  })

  it('4.4-DB-002 enforces one silhouette-profile row per user', async () => {
    await inRolledBackTransaction(async (client) => {
      const fixture = await seedUsers(client)

      await client.query(
        `INSERT INTO public."SilhouetteProfile" ("id", "user_id", "updated_at")
         VALUES ($1, $2, NOW())`,
        [`silhouette-${randomUUID()}`, fixture.userId]
      )

      await expect(
        client.query(
          `INSERT INTO public."SilhouetteProfile" ("id", "user_id", "updated_at")
           VALUES ($1, $2, NOW())`,
          [`silhouette-second-${randomUUID()}`, fixture.userId]
        )
      ).rejects.toMatchObject({
        code: '23505',
        constraint: 'SilhouetteProfile_user_id_key',
      })
    })
  })

  it('4.4-DB-002 scopes my_form_object_path and upload_session_id uniqueness globally, like GarmentItem', async () => {
    await inRolledBackTransaction(async (client) => {
      const fixture = await seedUsers(client)
      const sharedPath = `wardrobe/${fixture.userId}/silhouette/${randomUUID()}.jpg`

      await client.query(
        `INSERT INTO public."SilhouetteProfile"
          ("id", "user_id", "my_form_object_path", "updated_at")
         VALUES ($1, $2, $3, NOW())`,
        [`silhouette-${randomUUID()}`, fixture.userId, sharedPath]
      )

      await expect(
        client.query(
          `INSERT INTO public."SilhouetteProfile"
            ("id", "user_id", "my_form_object_path", "updated_at")
           VALUES ($1, $2, $3, NOW())`,
          [`silhouette-${randomUUID()}`, fixture.otherUserId, sharedPath]
        )
      ).rejects.toMatchObject({
        code: '23505',
        constraint: 'SilhouetteProfile_my_form_object_path_key',
      })
    })

    await inRolledBackTransaction(async (client) => {
      const fixture = await seedUsers(client)
      const sharedSessionId = `upload-session-${randomUUID()}`

      await client.query(
        `INSERT INTO public."SilhouetteProfile"
          ("id", "user_id", "my_form_upload_session_id", "updated_at")
         VALUES ($1, $2, $3, NOW())`,
        [`silhouette-${randomUUID()}`, fixture.userId, sharedSessionId]
      )

      await expect(
        client.query(
          `INSERT INTO public."SilhouetteProfile"
            ("id", "user_id", "my_form_upload_session_id", "updated_at")
           VALUES ($1, $2, $3, NOW())`,
          [`silhouette-${randomUUID()}`, fixture.otherUserId, sharedSessionId]
        )
      ).rejects.toMatchObject({
        code: '23505',
        constraint: 'SilhouetteProfile_my_form_upload_session_id_key',
      })
    })
  })

  it('4.4-DB-002 cascades user deletion to both onboarding state and silhouette profile', async () => {
    await inRolledBackTransaction(async (client) => {
      const fixture = await seedUsers(client)

      await client.query(
        `INSERT INTO public."WardrobeOnboardingState" ("id", "user_id", "updated_at")
         VALUES ($1, $2, NOW())`,
        [`onboarding-${randomUUID()}`, fixture.userId]
      )
      await client.query(
        `INSERT INTO public."SilhouetteProfile" ("id", "user_id", "updated_at")
         VALUES ($1, $2, NOW())`,
        [`silhouette-${randomUUID()}`, fixture.userId]
      )

      await client.query('DELETE FROM public."User" WHERE "id" = $1', [fixture.userId])

      const remainingOnboarding = await client.query(
        'SELECT "id" FROM public."WardrobeOnboardingState" WHERE "user_id" = $1',
        [fixture.userId]
      )
      expect(remainingOnboarding.rows).toHaveLength(0)

      const remainingSilhouette = await client.query(
        'SELECT "id" FROM public."SilhouetteProfile" WHERE "user_id" = $1',
        [fixture.userId]
      )
      expect(remainingSilhouette.rows).toHaveLength(0)
    })
  })

  it('4.4-DB-002 nulls ModerationEvent.silhouette_profile_id when the profile is deleted', async () => {
    await inRolledBackTransaction(async (client) => {
      const fixture = await seedUsers(client)
      const silhouetteId = `silhouette-${randomUUID()}`

      await client.query(
        `INSERT INTO public."SilhouetteProfile" ("id", "user_id", "updated_at")
         VALUES ($1, $2, NOW())`,
        [silhouetteId, fixture.userId]
      )

      const eventId = `moderation-${randomUUID()}`
      await client.query(
        `INSERT INTO public."ModerationEvent"
          ("id", "silhouette_profile_id", "action", "reason", "created_at")
         VALUES ($1, $2, 'flagged', 'privacy_violation', NOW())`,
        [eventId, silhouetteId]
      )

      await client.query('DELETE FROM public."SilhouetteProfile" WHERE "id" = $1', [
        silhouetteId,
      ])

      const event = await client.query<{ silhouette_profile_id: string | null }>(
        'SELECT "silhouette_profile_id" FROM public."ModerationEvent" WHERE "id" = $1',
        [eventId]
      )
      expect(event.rows).toEqual([{ silhouette_profile_id: null }])
    })
  })

  it('4.4-DB-001 installs the lookup and expiry-sweep indexes both tables depend on', async () => {
    const client = await adminPool.connect()

    try {
      const indexes = await client.query<{ indexname: string }>(
        `SELECT "indexname" FROM pg_indexes
         WHERE "schemaname" = 'public'
           AND "tablename" IN ('WardrobeOnboardingState', 'SilhouetteProfile')`
      )
      const names = indexes.rows.map((row) => row.indexname)

      expect(names).toEqual(
        expect.arrayContaining([
          'WardrobeOnboardingState_user_id_key',
          'WardrobeOnboardingState_user_id_idx',
          'SilhouetteProfile_user_id_key',
          'SilhouetteProfile_my_form_object_path_key',
          'SilhouetteProfile_my_form_upload_session_id_key',
          'SilhouetteProfile_user_id_idx',
          'SilhouetteProfile_user_id_my_form_status_my_form_upload_exp_idx',
        ])
      )
    } finally {
      client.release()
    }
  })

  it('4.4-DB-001 enables row level security and grants CRUD on both tables', async () => {
    const client = await adminPool.connect()

    try {
      const rls = await client.query<{ relname: string; relrowsecurity: boolean }>(
        `SELECT "relname", "relrowsecurity" FROM pg_class
         WHERE "relname" IN ('WardrobeOnboardingState', 'SilhouetteProfile')
         ORDER BY "relname"`
      )
      expect(rls.rows).toEqual([
        { relname: 'SilhouetteProfile', relrowsecurity: true },
        { relname: 'WardrobeOnboardingState', relrowsecurity: true },
      ])

      const policies = await client.query<{ tablename: string; cmd: string }>(
        `SELECT "tablename", "cmd" FROM pg_policies
         WHERE "tablename" IN ('WardrobeOnboardingState', 'SilhouetteProfile')`
      )
      for (const table of ['WardrobeOnboardingState', 'SilhouetteProfile']) {
        const commands = policies.rows
          .filter((row) => row.tablename === table)
          .map((row) => row.cmd)
          .sort()
        expect(commands).toEqual(['DELETE', 'INSERT', 'SELECT', 'UPDATE'])
      }

      const grants = await client.query<{ table_name: string; privilege_type: string }>(
        `SELECT "table_name", "privilege_type" FROM information_schema.role_table_grants
         WHERE "table_schema" = 'public'
           AND "table_name" IN ('WardrobeOnboardingState', 'SilhouetteProfile')
           AND "grantee" = 'authenticated'`
      )
      for (const table of ['WardrobeOnboardingState', 'SilhouetteProfile']) {
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
