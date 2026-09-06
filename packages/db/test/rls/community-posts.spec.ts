// Story 6.1 actor matrix for the community tables.
//
// This suite used to assert the opposite of what it asserts now. It proved that
// an authenticated client could read any published LookbookPost row and that an
// author could update their own, which is how the story's two worst defects got
// past review wearing the clothes of passing tests:
//
//   * a cross-user SELECT returned user_id, image_object_path, location_key and
//     moderation_engine_version off someone else's row, ending pseudonymity;
//   * the owner UPDATE policy carried no column restriction, so an author could
//     move their own draft to `published` while writing their own
//     moderation_engine_version — moderation bypass, proven live.
//
// The story's Boundaries forbid both ("Never: Expose cross-user LookbookPost,
// CommunityChallenge, or ModerationEvent table rows to authenticated clients",
// "Never: Permit client-controlled lifecycle fields"), and Postgres RLS is
// row-scoped rather than column-scoped, so no better predicate exists. The
// tables are therefore unreachable from `anon` and `authenticated` entirely,
// and every assertion below is that a client role is refused while the API's
// own privileged connection still works.
import { randomUUID } from 'node:crypto'
import { describe, expect } from 'vitest'
import {
  adminPool,
  buildClaims,
  insertLookbookPost,
  scenarioTest,
  useRlsDatabase,
  withRole,
} from './harness.js'

/** Postgres `insufficient_privilege`: the table is not granted to this role. */
const PERMISSION_DENIED = '42501'

describe.concurrent('community table RLS policies', () => {
  useRlsDatabase()

  scenarioTest(
    '6.1-DB-001 refuses the author a direct read of their own posts, in every status',
    async ({ scenario: seeded }) => {
      const adminClient = await adminPool.connect()
      const postIds = {
        draft: randomUUID(),
        pending: randomUUID(),
        flagged: randomUUID(),
        published: randomUUID(),
      }

      try {
        await insertLookbookPost(adminClient, {
          id: postIds.draft,
          userId: seeded.teenId,
          status: 'draft',
          caption: 'draft post',
          publishedAt: null,
        })
        await insertLookbookPost(adminClient, {
          id: postIds.pending,
          userId: seeded.teenId,
          status: 'pending_review',
          caption: 'pending post',
          publishedAt: null,
        })
        await insertLookbookPost(adminClient, {
          id: postIds.flagged,
          userId: seeded.teenId,
          status: 'flagged',
          caption: 'flagged post',
          publishedAt: null,
        })
        await insertLookbookPost(adminClient, {
          id: postIds.published,
          userId: seeded.teenId,
          status: 'published',
          caption: 'published post',
        })

        // Even the owner reads their own drafts through the API, not through
        // Postgres. An owner-scoped SELECT policy is exactly what carried the
        // owner UPDATE policy alongside it, and the update is the dangerous one.
        await withRole(
          'authenticated',
          buildClaims(seeded.teenEmail, 'teen'),
          async (client) =>
            expect(
              client.query(
                'SELECT "id" FROM public."LookbookPost" WHERE "user_id" = $1',
                [seeded.teenId]
              )
            ).rejects.toMatchObject({ code: PERMISSION_DENIED })
        )
      } finally {
        await adminClient.query(
          'DELETE FROM public."LookbookPost" WHERE "id" = ANY($1::text[])',
          [Object.values(postIds)]
        )
        adminClient.release()
      }
    }
  )

  scenarioTest(
    '6.1-DB-002 refuses an unrelated authenticated user a read of a published post',
    async ({ scenario: seeded }) => {
      const adminClient = await adminPool.connect()
      const publishedPostId = randomUUID()

      try {
        await insertLookbookPost(adminClient, {
          id: publishedPostId,
          userId: seeded.teenId,
          status: 'published',
          caption: 'published post',
          locationKey: 'us-il-chicago',
          moderationEngineVersion: 'engine-1.0.0',
        })

        await withRole(
          'authenticated',
          buildClaims(seeded.otherTeenEmail, 'teen'),
          async (client) =>
            expect(
              client.query(
                `SELECT "user_id", "image_object_path", "location_key", "moderation_engine_version"
                 FROM public."LookbookPost" WHERE "id" = $1`,
                [publishedPostId]
              )
            ).rejects.toMatchObject({ code: PERMISSION_DENIED })
        )

        // The same row over the API's own connection, so this suite proves the
        // table is closed to clients rather than merely broken.
        //
        // That connection is the schema owner, not the `service_role` login:
        // `service_role` holds no grant on any Prisma-managed table in this
        // schema (nor on PremiumEntitlement, GarmentItem or User), because the
        // API reaches Postgres through Prisma on DATABASE_URL. "service_role"
        // in the migration comments names the trust level, not the login.
        const visible = await adminClient.query(
          'SELECT "id", "status" FROM public."LookbookPost" WHERE "id" = $1',
          [publishedPostId]
        )
        expect(visible.rows).toHaveLength(1)
      } finally {
        await adminClient.query('DELETE FROM public."LookbookPost" WHERE "id" = $1', [
          publishedPostId,
        ])
        adminClient.release()
      }
    }
  )

  scenarioTest(
    '6.1-DB-003 forbids cross-user mutation of lookbook posts',
    async ({ scenario: seeded }) => {
      await withRole(
        'authenticated',
        buildClaims(seeded.otherTeenEmail, 'teen'),
        async (client) =>
          expect(
            client.query(
              'UPDATE public."LookbookPost" SET "caption" = \'hacked\' WHERE "id" = $1',
              [seeded.postId]
            )
          ).rejects.toMatchObject({ code: PERMISSION_DENIED })
      )

      await withRole(
        'authenticated',
        buildClaims(seeded.otherTeenEmail, 'teen'),
        async (client) =>
          expect(
            client.query('DELETE FROM public."LookbookPost" WHERE "id" = $1', [
              seeded.postId,
            ])
          ).rejects.toMatchObject({ code: PERMISSION_DENIED })
      )
    }
  )

  scenarioTest(
    '6.1-DB-004 rejects an author self-publishing their own draft with forged moderation provenance',
    async ({ scenario: seeded }) => {
      // The exact statement that succeeded against the previous policy set: one
      // UPDATE moving a draft to `published` and writing its own engine version.
      // Publication is a moderation decision, so the only actor that may write
      // these columns is the API.
      await withRole(
        'authenticated',
        buildClaims(seeded.teenEmail, 'teen'),
        async (client) =>
          expect(
            client.query(
              `UPDATE public."LookbookPost"
                 SET "status" = 'published',
                     "published_at" = NOW(),
                     "moderation_engine_version" = 'forged-9.9'
               WHERE "id" = $1`,
              [seeded.postId]
            )
          ).rejects.toMatchObject({ code: PERMISSION_DENIED })
      )

      const adminClient = await adminPool.connect()
      try {
        const row = await adminClient.query<{
          status: string
          moderation_engine_version: string | null
        }>(
          'SELECT "status", "moderation_engine_version" FROM public."LookbookPost" WHERE "id" = $1',
          [seeded.postId]
        )
        expect(row.rows[0]?.status).toBe('draft')
        expect(row.rows[0]?.moderation_engine_version).not.toBe('forged-9.9')
      } finally {
        adminClient.release()
      }
    }
  )

  scenarioTest(
    '6.1-DB-005 refuses an author a direct INSERT of their own post',
    async ({ scenario: seeded }) => {
      // Submission runs through the API because the API is what enforces the
      // rolling submission cap, guardian consent, and the moderation handoff.
      // A direct INSERT would skip all three.
      await withRole(
        'authenticated',
        buildClaims(seeded.teenEmail, 'teen'),
        async (client) =>
          expect(
            client.query(
              `INSERT INTO public."LookbookPost" ("id", "user_id", "status", "updated_at")
               VALUES ($1, $2, 'published', NOW())`,
              [randomUUID(), seeded.teenId]
            )
          ).rejects.toMatchObject({ code: PERMISSION_DENIED })
      )
    }
  )

  scenarioTest(
    '6.1-DB-006 refuses an authenticated client the editorial challenge calendar',
    async ({ scenario: seeded }) => {
      const adminClient = await adminPool.connect()
      const challengeId = `challenge-${randomUUID()}`

      try {
        // An unstarted, deactivated row: the shape a `USING (true)` read policy
        // leaked, letting any member enumerate editorial plans before launch.
        await adminClient.query(
          `INSERT INTO public."CommunityChallenge"
            ("id", "slug", "starts_at", "ends_at", "time_zone", "copy", "is_active", "updated_at")
           VALUES ($1, $2, NOW() + interval '30 days', NOW() + interval '37 days',
                   'America/Chicago', '{}'::jsonb, false, NOW())`,
          [challengeId, `slug-${challengeId}`]
        )

        await withRole(
          'authenticated',
          buildClaims(seeded.otherTeenEmail, 'teen'),
          async (client) =>
            expect(
              client.query('SELECT "id", "slug" FROM public."CommunityChallenge"')
            ).rejects.toMatchObject({ code: PERMISSION_DENIED })
        )
      } finally {
        await adminClient.query(
          'DELETE FROM public."CommunityChallenge" WHERE "id" = $1',
          [challengeId]
        )
        adminClient.release()
      }
    }
  )

  scenarioTest(
    '6.1-DB-007 refuses every client role the moderation, alias, report and outbox tables',
    async ({ scenario: seeded }) => {
      const tables = [
        'ModerationEvent',
        'CommunityAlias',
        'CommunityPostReport',
        'CommunityModerationOutbox',
      ] as const

      for (const table of tables) {
        await withRole(
          'authenticated',
          buildClaims(seeded.otherTeenEmail, 'teen'),
          async (client) =>
            expect(
              client.query(`SELECT * FROM public."${table}" LIMIT 1`)
            ).rejects.toMatchObject({ code: PERMISSION_DENIED })
        )

        await withRole('anon', null, async (client) =>
          expect(
            client.query(`SELECT * FROM public."${table}" LIMIT 1`)
          ).rejects.toMatchObject({ code: PERMISSION_DENIED })
        )
      }
    }
  )

  scenarioTest(
    '6.1-DB-008 refuses the anonymous role the whole community surface',
    async ({ scenario: seeded }) => {
      await withRole('anon', null, async (client) =>
        expect(
          client.query('SELECT "id" FROM public."LookbookPost" WHERE "id" = $1', [
            seeded.postId,
          ])
        ).rejects.toMatchObject({ code: PERMISSION_DENIED })
      )

      await withRole('anon', null, async (client) =>
        expect(
          client.query('SELECT "id" FROM public."CommunityChallenge"')
        ).rejects.toMatchObject({ code: PERMISSION_DENIED })
      )
    }
  )
})
