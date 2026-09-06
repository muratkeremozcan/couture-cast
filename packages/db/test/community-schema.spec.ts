// Story 6.1: community feed by climate band.
//
// The schema properties a service bug would erode silently, exercised against a
// real PostgreSQL connection rather than by reading migration.sql as text —
// same shape as planner-schema.spec.ts and its siblings.
//
// The actor matrix for these tables lives in `test/rls/community-posts.spec.ts`;
// what this file pins is the shape underneath it: the two enums, the API-only
// grant and policy posture, the feed indexes the public cursor depends on, the
// cascade choices that decide what survives account erasure, and the challenge
// overlap constraint.
import { randomUUID } from 'node:crypto'
import { afterAll, describe, expect, it } from 'vitest'
import { Pool, type PoolClient } from 'pg'

import { CLIMATE_BANDS } from '../../utils/src/climate-band.ts'
import {
  COMMUNITY_OBJECT_PATH_PATTERN,
  communityObjectPathContainsIdentifier,
} from '../../testing/src/factories/community.factory.ts'
import { buildSeededCommunityObjectPath } from '../prisma/seeds/community-storage.ts'

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

const enumMembers = async (client: PoolClient, typeName: string) => {
  const result = await client.query<{ label: string }>(
    `SELECT e.enumlabel AS label
     FROM pg_enum AS e
     INNER JOIN pg_type AS t ON t.oid = e.enumtypid
     WHERE t.typname = $1
     ORDER BY e.enumsortorder`,
    [typeName]
  )
  return result.rows.map((row) => row.label)
}

/** Every table this story serves through the API and through nothing else. */
const COMMUNITY_TABLES = [
  'LookbookPost',
  'CommunityChallenge',
  'CommunityModerationOutbox',
  'CommunityAlias',
  'CommunityPostReport',
  'ModerationEvent',
] as const

type CommunityFixture = {
  authorId: string
  reporterId: string
  postId: string
  reportId: string
  moderationEventId: string
  challengeId: string
}

const insertUser = async (client: PoolClient, id: string, email: string) => {
  await client.query(
    'INSERT INTO public."User" ("id", "email", "updated_at") VALUES ($1, $2, NOW())',
    [id, email]
  )
}

const seedCommunityGraph = async (client: PoolClient): Promise<CommunityFixture> => {
  const suffix = randomUUID()
  const fixture: CommunityFixture = {
    authorId: `community-author-${suffix}`,
    reporterId: `community-reporter-${suffix}`,
    postId: `community-post-${suffix}`,
    reportId: `community-report-${suffix}`,
    moderationEventId: `community-moderation-${suffix}`,
    challengeId: `community-challenge-${suffix}`,
  }

  await insertUser(client, fixture.authorId, `${fixture.authorId}@example.com`)
  await insertUser(client, fixture.reporterId, `${fixture.reporterId}@example.com`)

  await client.query(
    `INSERT INTO public."CommunityChallenge"
      ("id", "slug", "starts_at", "ends_at", "time_zone", "copy", "is_active", "updated_at")
     VALUES ($1, $2, NOW() - interval '1 day', NOW() + interval '6 days', 'America/Chicago', '{}'::jsonb, false, NOW())`,
    [fixture.challengeId, `slug-${suffix}`]
  )

  await client.query(
    `INSERT INTO public."LookbookPost"
      ("id", "user_id", "status", "caption", "image_object_path", "published_at",
       "alt_text", "alt_text_confirmed_at", "challenge_id", "updated_at")
     VALUES ($1, $2, 'published', 'seeded caption', $3, NOW(),
             'Seeded alt text', NOW(), $4, NOW())`,
    [
      fixture.postId,
      fixture.authorId,
      `community/${fixture.postId}/${suffix.replace(/-/g, '')}.jpg`,
      fixture.challengeId,
    ]
  )

  await client.query(
    `INSERT INTO public."CommunityPostReport"
      ("id", "post_id", "reporter_id", "reason", "content_snapshot", "subject_alias",
       "image_object_path", "sla_due_at")
     VALUES ($1, $2, $3, 'harassment', $4::jsonb, 'driftwood-1a2b', $5, NOW() + interval '24 hours')`,
    [
      fixture.reportId,
      fixture.postId,
      fixture.reporterId,
      JSON.stringify({ caption: 'seeded caption' }),
      `community/${fixture.postId}/${suffix.replace(/-/g, '')}.jpg`,
    ]
  )

  await client.query(
    `INSERT INTO public."ModerationEvent"
      ("id", "post_id", "flagged_by_id", "action", "reason", "subject_alias", "content_snapshot")
     VALUES ($1, $2, $3, 'report', 'seeded moderation event', 'driftwood-1a2b', $4::jsonb)`,
    [
      fixture.moderationEventId,
      fixture.postId,
      fixture.reporterId,
      JSON.stringify({ caption: 'seeded caption' }),
    ]
  )

  return fixture
}

afterAll(async () => {
  await adminPool.end()
})

describe('community schema', () => {
  describe('enum parity', () => {
    it('6.1-DB-010 pins the Prisma ClimateBand enum to the canonical CLIMATE_BANDS tuple', async () => {
      // `packages/utils/src/climate-band.ts` is the one vocabulary; the Zod
      // contract and the Socket.io types import it. The Prisma enum is a
      // hand-maintained duplicate that nothing compared until this assertion, so
      // a band added in one place and forgotten in the other would have surfaced
      // as an unexplained runtime cast failure rather than a failing test.
      await inRolledBackTransaction(async (client) => {
        expect(await enumMembers(client, 'ClimateBand')).toEqual([...CLIMATE_BANDS])
      })
    })

    it('6.1-DB-011 pins CommunityPostStatus to the Design Notes lifecycle, in order', async () => {
      // draft -> uploading -> pending_review -> published | flagged |
      // review_failed -> withdrawn, plus consent_suspended, which hides an
      // already-published post when guardian consent lapses. Without that member
      // a 13-to-15-year-old member's post stays live after consent is revoked.
      await inRolledBackTransaction(async (client) => {
        expect(await enumMembers(client, 'CommunityPostStatus')).toEqual([
          'draft',
          'uploading',
          'pending_review',
          'published',
          'flagged',
          'review_failed',
          'withdrawn',
          'consent_suspended',
        ])
      })
    })

    it('6.1-DB-012 pins CommunityReportReason to the closed contract enum', async () => {
      // Mirrors `communityReportReasonSchema` in
      // packages/api-client/src/contracts/http/community.ts.
      await inRolledBackTransaction(async (client) => {
        expect(await enumMembers(client, 'CommunityReportReason')).toEqual([
          'spam',
          'harassment',
          'inappropriate_content',
          'hate_speech',
          'violence',
          'other',
        ])
      })
    })
  })

  describe('grants and policies', () => {
    it('6.1-DB-013 grants anon and authenticated nothing on any community table', async () => {
      await inRolledBackTransaction(async (client) => {
        const grants = await client.query(
          `SELECT "grantee", "table_name", "privilege_type"
           FROM information_schema.role_table_grants
           WHERE "table_schema" = 'public'
             AND "table_name" = ANY($1::text[])
             AND "grantee" IN ('anon', 'authenticated')`,
          [COMMUNITY_TABLES]
        )
        expect(grants.rows).toEqual([])
      })
    })

    it('6.1-DB-014 enables RLS with zero policies on every community table', async () => {
      await inRolledBackTransaction(async (client) => {
        const rls = await client.query<{ relname: string; relrowsecurity: boolean }>(
          `SELECT "relname", "relrowsecurity" FROM pg_class
           WHERE "relnamespace" = 'public'::regnamespace
             AND "relname" = ANY($1::text[])`,
          [COMMUNITY_TABLES]
        )
        expect(rls.rows).toHaveLength(COMMUNITY_TABLES.length)
        expect(rls.rows.filter((row) => !row.relrowsecurity)).toEqual([])

        const policies = await client.query(
          `SELECT "tablename", "policyname" FROM pg_policies
           WHERE "schemaname" = 'public' AND "tablename" = ANY($1::text[])`,
          [COMMUNITY_TABLES]
        )
        expect(policies.rows).toEqual([])
      })
    })

    it('6.1-DB-015 leaves the community-images bucket private with no client storage policy', async () => {
      // The dropped policy read the owner out of the second path segment, which
      // only worked because the path embedded a user id — and a signed URL
      // carries its path, so every share leaked the author. Signed URLs are
      // minted by the API on service_role instead.
      await inRolledBackTransaction(async (client) => {
        const bucket = await client.query<{ public: boolean }>(
          'SELECT "public" FROM storage.buckets WHERE "id" = \'community-images\''
        )
        expect(bucket.rows).toEqual([{ public: false }])

        const policies = await client.query(
          `SELECT "policyname" FROM pg_policies
           WHERE "schemaname" = 'storage'
             AND "tablename" = 'objects'
             AND "policyname" = 'community_read_authorized'`
        )
        expect(policies.rows).toEqual([])
      })
    })
  })

  describe('feed ordering indexes', () => {
    it('6.1-DB-016 orders both feed indexes by published_at DESC, id DESC', async () => {
      // The public cursor is `published_at,id`. An index on created_at cannot
      // serve it: a post created before moderation and published after it pages
      // in the wrong slot, which is the exact failure the "appears once under
      // published_at,id ordering" acceptance criterion describes.
      await inRolledBackTransaction(async (client) => {
        const indexes = await client.query<{ indexname: string; indexdef: string }>(
          `SELECT "indexname", "indexdef" FROM pg_indexes
           WHERE "schemaname" = 'public' AND "tablename" = 'LookbookPost'
           ORDER BY "indexname"`
        )
        const byName = new Map(indexes.rows.map((row) => [row.indexname, row.indexdef]))

        expect(
          byName.get('LookbookPost_climate_band_status_published_at_id_idx')
        ).toMatch(/\(climate_band, status, published_at DESC, id DESC\)/)
        expect(byName.get('LookbookPost_status_published_at_id_idx')).toMatch(
          /\(status, published_at DESC, id DESC\)/
        )

        // The created_at feed indexes are gone, not merely shadowed.
        expect(byName.has('LookbookPost_climate_band_status_created_at_id_idx')).toBe(
          false
        )
        expect(byName.has('LookbookPost_status_created_at_id_idx')).toBe(false)

        // The sweeps this story adds each need their own access path.
        expect(byName.has('LookbookPost_upload_expires_at_idx')).toBe(true)
        expect(byName.has('LookbookPost_user_id_submitted_at_idx')).toBe(true)
        expect(
          byName.has('LookbookPost_erasure_requested_at_objects_purged_at_idx')
        ).toBe(true)
      })
    })

    it('6.1-DB-032 records when the author confirmed the stored alt text', async () => {
      // The Zod contract's `altTextConfirmed: z.literal(true)` blocks an
      // unconfirmed publish at the HTTP boundary, but a boundary check leaves
      // no trace, so nothing downstream could distinguish confirmed text from
      // an accepted machine suggestion. Nullable, because `draft` and
      // `uploading` rows have nothing to confirm yet.
      await inRolledBackTransaction(async (client) => {
        const fixture = await seedCommunityGraph(client)

        const draftId = `community-post-draft-${randomUUID()}`
        await client.query(
          `INSERT INTO public."LookbookPost" ("id", "user_id", "status", "updated_at")
           VALUES ($1, $2, 'draft', NOW())`,
          [draftId, fixture.authorId]
        )

        const confirmedAt = new Date('2026-09-05T12:00:00.000Z')
        await client.query(
          'UPDATE public."LookbookPost" SET "alt_text_confirmed_at" = $2 WHERE "id" = $1',
          [fixture.postId, confirmedAt]
        )

        const rows = await client.query<{
          id: string
          alt_text_confirmed_at: Date | null
        }>(
          'SELECT "id", "alt_text_confirmed_at" FROM public."LookbookPost" WHERE "id" = ANY($1::text[]) ORDER BY "id"',
          [[draftId, fixture.postId].sort()]
        )

        const byId = new Map(rows.rows.map((row) => [row.id, row.alt_text_confirmed_at]))
        expect(byId.get(draftId)).toBeNull()
        expect(byId.get(fixture.postId)).toEqual(confirmedAt)
      })
    })

    it('6.1-DB-017 rejects a published post with no published_at', async () => {
      await inRolledBackTransaction(async (client) => {
        const fixture = await seedCommunityGraph(client)

        await expect(
          client.query(
            `INSERT INTO public."LookbookPost" ("id", "user_id", "status", "updated_at")
             VALUES ($1, $2, 'published', NOW())`,
            [`community-post-nopub-${randomUUID()}`, fixture.authorId]
          )
        ).rejects.toMatchObject({ code: '23514' })
      })
    })
  })

  describe('report uniqueness', () => {
    it('6.1-DB-035 rejects publishing a post whose alt text was never confirmed', async () => {
      // "Never: Publish unconfirmed alt text." The contract refuses it at the
      // HTTP boundary; this refuses it at the only layer no code path can go
      // around. `publishWithinQuota` stamps the confirmation in the SAME
      // statement that writes the alt text and leaves `draft`, so the ordering
      // this depends on is a statement-level fact rather than a convention.
      await inRolledBackTransaction(async (client) => {
        const fixture = await seedCommunityGraph(client)

        await expect(
          client.query(
            `INSERT INTO public."LookbookPost"
              ("id", "user_id", "status", "published_at", "alt_text", "updated_at")
             VALUES ($1, $2, 'published', NOW(), 'Unconfirmed alt text', NOW())`,
            [`community-post-unconfirmed-${randomUUID()}`, fixture.authorId]
          )
        ).rejects.toMatchObject({ code: '23514' })
      })
    })

    it('6.1-DB-036 allows an unpublished post to carry no confirmation yet', async () => {
      await inRolledBackTransaction(async (client) => {
        const fixture = await seedCommunityGraph(client)

        for (const status of ['draft', 'uploading', 'pending_review']) {
          await client.query(
            `INSERT INTO public."LookbookPost"
              ("id", "user_id", "status", "updated_at")
             VALUES ($1, $2, $3::"CommunityPostStatus", NOW())`,
            [`community-post-${status}-${randomUUID()}`, fixture.authorId, status]
          )
        }
      })
    })

    it('6.1-DB-018 rejects a second report on the same post by the same reporter', async () => {
      await inRolledBackTransaction(async (client) => {
        const fixture = await seedCommunityGraph(client)

        await expect(
          client.query(
            `INSERT INTO public."CommunityPostReport"
              ("id", "post_id", "reporter_id", "reason", "sla_due_at")
             VALUES ($1, $2, $3, 'spam', NOW() + interval '24 hours')`,
            [`community-report-dup-${randomUUID()}`, fixture.postId, fixture.reporterId]
          )
        ).rejects.toMatchObject({ code: '23505' })
      })
    })

    it('6.1-DB-019 keeps ModerationEvent append-only for one actor on one post', async () => {
      // The UNIQUE (post_id, flagged_by_id) that used to sit on this table
      // capped it at one row per actor per post forever, so a second decision by
      // the same reviewer could not be recorded at all. Engine-written rows
      // escaped it only because Postgres treats NULLs as distinct.
      await inRolledBackTransaction(async (client) => {
        const fixture = await seedCommunityGraph(client)

        await client.query(
          `INSERT INTO public."ModerationEvent"
            ("id", "post_id", "flagged_by_id", "action", "reason")
           VALUES ($1, $2, $3, 'reviewed', 'second decision by the same actor')`,
          [`community-moderation-2-${randomUUID()}`, fixture.postId, fixture.reporterId]
        )

        const events = await client.query(
          'SELECT "id" FROM public."ModerationEvent" WHERE "post_id" = $1',
          [fixture.postId]
        )
        expect(events.rows).toHaveLength(2)
      })
    })
  })

  describe('cascades and erasure', () => {
    it('6.1-DB-020 keeps a third party report when the author erases their account', async () => {
      // Proven live before the fix: LookbookPost.user Cascade chained with
      // ModerationEvent.post Cascade meant deleting the author deleted somebody
      // else's abuse report. The audit fact has to outlive its subject.
      await inRolledBackTransaction(async (client) => {
        const fixture = await seedCommunityGraph(client)

        await client.query('DELETE FROM public."User" WHERE "id" = $1', [
          fixture.authorId,
        ])

        const post = await client.query(
          'SELECT "id" FROM public."LookbookPost" WHERE "id" = $1',
          [fixture.postId]
        )
        expect(post.rows).toHaveLength(0)

        const report = await client.query<{
          post_id: string | null
          subject_alias: string | null
          image_object_path: string | null
        }>(
          'SELECT "post_id", "subject_alias", "image_object_path" FROM public."CommunityPostReport" WHERE "id" = $1',
          [fixture.reportId]
        )
        expect(report.rows).toHaveLength(1)
        expect(report.rows[0]?.post_id).toBeNull()
        // The denormalized columns are what make the surviving row worth
        // keeping: who it was about, and where the orphaned object still lives.
        expect(report.rows[0]?.subject_alias).toBe('driftwood-1a2b')
        expect(report.rows[0]?.image_object_path).toContain(
          `community/${fixture.postId}/`
        )

        const moderation = await client.query<{ post_id: string | null }>(
          'SELECT "post_id" FROM public."ModerationEvent" WHERE "id" = $1',
          [fixture.moderationEventId]
        )
        expect(moderation.rows).toHaveLength(1)
        expect(moderation.rows[0]?.post_id).toBeNull()
      })
    })

    it('6.1-DB-021 keeps a post when its challenge is deleted', async () => {
      await inRolledBackTransaction(async (client) => {
        const fixture = await seedCommunityGraph(client)

        await client.query('DELETE FROM public."CommunityChallenge" WHERE "id" = $1', [
          fixture.challengeId,
        ])

        const post = await client.query<{ challenge_id: string | null }>(
          'SELECT "challenge_id" FROM public."LookbookPost" WHERE "id" = $1',
          [fixture.postId]
        )
        expect(post.rows).toHaveLength(1)
        expect(post.rows[0]?.challenge_id).toBeNull()
      })
    })

    it('6.1-DB-022 gives every user at most one alias, and every alias one user', async () => {
      await inRolledBackTransaction(async (client) => {
        const fixture = await seedCommunityGraph(client)
        const suffix = randomUUID()

        await client.query(
          'INSERT INTO public."CommunityAlias" ("id", "user_id", "alias") VALUES ($1, $2, $3)',
          [`alias-${suffix}`, fixture.authorId, `driftwood-${suffix.slice(0, 8)}`]
        )

        await expect(
          client.query(
            'INSERT INTO public."CommunityAlias" ("id", "user_id", "alias") VALUES ($1, $2, $3)',
            [`alias-dup-${suffix}`, fixture.authorId, `otter-${suffix.slice(0, 8)}`]
          )
        ).rejects.toMatchObject({ code: '23505' })
      })
    })
  })

  describe('object paths carry no user id', () => {
    // The same rule `packages/testing/test/community.factory.spec.ts`
    // (6.1-FACTORY-06) holds the factories to, applied to the seed, through the
    // one exported pattern. Split enforcement is what let this defect live: the
    // factory's path was rewritten to drop the user id and the seed's was left
    // as `community/<userId>/lookbook-N.jpg`, so the repository obeyed and broke
    // "Never: Put user IDs in object paths or signed URLs" at the same time,
    // depending on which file you read.

    it('6.1-DB-033 builds seeded paths from the post id and an opaque token', () => {
      const path = buildSeededCommunityObjectPath('lookbook-1')

      expect(path).toMatch(COMMUNITY_OBJECT_PATH_PATTERN)
      expect(path).toMatch(/^community\/lookbook-1\/[a-f0-9]{32}\.png$/)
      // Deterministic, so re-seeding replaces the object rather than orphaning
      // it and leaving an unreferenced blob in the bucket forever.
      expect(buildSeededCommunityObjectPath('lookbook-1')).toBe(path)
      expect(buildSeededCommunityObjectPath('lookbook-2')).not.toBe(path)
    })

    it('6.1-DB-034 keeps every stored object path free of its owner id', async () => {
      // Reads the live table rather than the seed's output, so it covers rows
      // written by the seed, by the factories and by the API alike. A signed URL
      // carries its path, so an owner id in one deanonymizes the author to
      // whoever the URL reaches.
      const client = await adminPool.connect()

      try {
        const rows = await client.query<{
          id: string
          user_id: string
          image_object_path: string | null
        }>(
          `SELECT "id", "user_id", "image_object_path" FROM public."LookbookPost"
           WHERE "image_object_path" IS NOT NULL`
        )

        const leaking = rows.rows.filter((row) =>
          communityObjectPathContainsIdentifier(row.image_object_path ?? '', row.user_id)
        )
        expect(leaking).toEqual([])

        const malformed = rows.rows.filter(
          (row) => !COMMUNITY_OBJECT_PATH_PATTERN.test(row.image_object_path ?? '')
        )
        expect(malformed).toEqual([])
      } finally {
        client.release()
      }
    })
  })

  describe('challenge windows', () => {
    const insertChallenge = (
      client: PoolClient,
      options: {
        id: string
        band: string | null
        startsDays: number
        endsDays: number
        isActive?: boolean
      }
    ) =>
      client.query(
        `INSERT INTO public."CommunityChallenge"
          ("id", "slug", "starts_at", "ends_at", "time_zone", "climate_band", "copy",
           "is_active", "updated_at")
         VALUES (
           $1, $2,
           NOW() + ($3 || ' days')::interval,
           NOW() + ($4 || ' days')::interval,
           'America/Chicago', $5::"ClimateBand", '{}'::jsonb, $6, NOW()
         )`,
        [
          options.id,
          `slug-${options.id}`,
          String(options.startsDays),
          String(options.endsDays),
          options.band,
          options.isActive ?? true,
        ]
      )

    it('6.1-DB-023 rejects a challenge whose window ends before it starts', async () => {
      await inRolledBackTransaction(async (client) => {
        await expect(
          insertChallenge(client, {
            id: `challenge-backwards-${randomUUID()}`,
            band: 'cold_wet',
            startsDays: 7,
            endsDays: 1,
          })
        ).rejects.toMatchObject({ code: '23514' })
      })
    })

    it('6.1-DB-024 rejects two active challenges overlapping on the same band', async () => {
      await inRolledBackTransaction(async (client) => {
        await insertChallenge(client, {
          id: `challenge-a-${randomUUID()}`,
          band: 'cold_wet',
          startsDays: 1,
          endsDays: 8,
        })

        await expect(
          insertChallenge(client, {
            id: `challenge-b-${randomUUID()}`,
            band: 'cold_wet',
            startsDays: 4,
            endsDays: 11,
          })
        ).rejects.toMatchObject({ code: '23P01' })
      })
    })

    it('6.1-DB-025 rejects a global challenge overlapping a band-scoped one', async () => {
      // The case an equality key over the band cannot catch: a NULL band means
      // "every band", so it competes with cold_wet even though '*' and
      // 'cold_wet' are different keys. Modelling each row as the SET of bands it
      // occupies is what makes the constraint see the conflict.
      await inRolledBackTransaction(async (client) => {
        await insertChallenge(client, {
          id: `challenge-band-${randomUUID()}`,
          band: 'cold_wet',
          startsDays: 1,
          endsDays: 8,
        })

        await expect(
          insertChallenge(client, {
            id: `challenge-global-${randomUUID()}`,
            band: null,
            startsDays: 4,
            endsDays: 11,
          })
        ).rejects.toMatchObject({ code: '23P01' })
      })
    })

    it('6.1-DB-026 rejects a band-scoped challenge overlapping a global one', async () => {
      await inRolledBackTransaction(async (client) => {
        await insertChallenge(client, {
          id: `challenge-global-${randomUUID()}`,
          band: null,
          startsDays: 1,
          endsDays: 8,
        })

        await expect(
          insertChallenge(client, {
            id: `challenge-band-${randomUUID()}`,
            band: 'warm_dry',
            startsDays: 4,
            endsDays: 11,
          })
        ).rejects.toMatchObject({ code: '23P01' })
      })
    })

    it('6.1-DB-027 allows overlapping windows on different bands', async () => {
      await inRolledBackTransaction(async (client) => {
        await insertChallenge(client, {
          id: `challenge-cold-${randomUUID()}`,
          band: 'cold_wet',
          startsDays: 1,
          endsDays: 8,
        })

        await insertChallenge(client, {
          id: `challenge-warm-${randomUUID()}`,
          band: 'warm_dry',
          startsDays: 4,
          endsDays: 11,
        })
      })
    })

    it('6.1-DB-028 allows a closed challenge to overlap an active one', async () => {
      // Only active rows participate, so archiving a challenge frees its slot
      // for the next week rather than blocking the calendar forever.
      await inRolledBackTransaction(async (client) => {
        await insertChallenge(client, {
          id: `challenge-active-${randomUUID()}`,
          band: 'cold_wet',
          startsDays: 1,
          endsDays: 8,
        })

        await insertChallenge(client, {
          id: `challenge-closed-${randomUUID()}`,
          band: 'cold_wet',
          startsDays: 4,
          endsDays: 11,
          isActive: false,
        })
      })
    })

    it('6.1-DB-030 refuses a challenge with no IANA time zone', async () => {
      // The Monday-anchored seven-day window is only a fact relative to a zone:
      // one absolute instant is Monday in Auckland and Sunday in Chicago. NOT
      // NULL with no default, so a caller that forgets the zone fails here
      // rather than silently inheriting the server's and opening the challenge
      // on the wrong day for part of its audience.
      await inRolledBackTransaction(async (client) => {
        await expect(
          client.query(
            `INSERT INTO public."CommunityChallenge"
              ("id", "slug", "starts_at", "ends_at", "copy", "is_active", "updated_at")
             VALUES ($1, $2, NOW(), NOW() + interval '7 days', '{}'::jsonb, true, NOW())`,
            [`challenge-nozone-${randomUUID()}`, `slug-nozone-${randomUUID()}`]
          )
        ).rejects.toMatchObject({ code: '23502' })
      })
    })

    it('6.1-DB-031 stores the IANA zone verbatim rather than normalising it', async () => {
      await inRolledBackTransaction(async (client) => {
        const id = `challenge-zone-${randomUUID()}`
        await client.query(
          `INSERT INTO public."CommunityChallenge"
            ("id", "slug", "starts_at", "ends_at", "time_zone", "copy", "is_active", "updated_at")
           VALUES ($1, $2, NOW(), NOW() + interval '7 days', 'Pacific/Auckland', '{}'::jsonb, true, NOW())`,
          [id, `slug-zone-${randomUUID()}`]
        )

        const stored = await client.query<{ time_zone: string }>(
          'SELECT "time_zone" FROM public."CommunityChallenge" WHERE "id" = $1',
          [id]
        )
        expect(stored.rows[0]?.time_zone).toBe('Pacific/Auckland')
      })
    })

    it('6.1-DB-029 allows back-to-back windows that touch but do not overlap', async () => {
      // The range is half-open `[)`, so a challenge that ends exactly when the
      // next begins is legal; a weekly calendar is built out of those.
      await inRolledBackTransaction(async (client) => {
        await insertChallenge(client, {
          id: `challenge-week1-${randomUUID()}`,
          band: 'cold_wet',
          startsDays: 1,
          endsDays: 8,
        })

        await insertChallenge(client, {
          id: `challenge-week2-${randomUUID()}`,
          band: 'cold_wet',
          startsDays: 8,
          endsDays: 15,
        })
      })
    })
  })
})
