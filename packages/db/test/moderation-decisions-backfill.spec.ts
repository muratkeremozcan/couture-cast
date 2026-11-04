// Story 6.11 test owner: the decision tables' database guarantees and the screening backfill.
// D-BACKFILL applies every earlier migration, seeds the old shape, then applies the 6.11 migration,
// which is the only way to prove what it does to rows that already exist in production.
import { randomUUID } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const MIGRATION = '20261104120000_moderation_decisions'
const directory = resolve(__dirname, '../prisma/migrations')
const source =
  process.env.RLS_TEST_DATABASE_URL ??
  process.env.INTEGRATION_TEST_DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const name = `tea_community_${randomUUID().replaceAll('-', '')}`
const target = new URL(source)
target.pathname = `/${name}`

const admin = new Client({ connectionString: source })
const db = new Client({ connectionString: target.toString() })
const FLAGGED_AT = new Date('2026-10-01T12:00:00.000Z')
const DAY_MS = 86_400_000

async function member(id: string) {
  await db.query('INSERT INTO "User" (id, email, updated_at) VALUES ($1, $2, now())', [
    id,
    `${id}@example.test`,
  ])
}

async function post(
  id: string,
  userId: string,
  status: string,
  extra: { erasure?: boolean; anonymized?: boolean; published?: boolean } = {}
) {
  await db.query(
    `INSERT INTO "LookbookPost"
       (id, user_id, status, moderation_reason, erasure_requested_at, anonymized_at,
        published_at, alt_text_confirmed_at, updated_at)
     VALUES ($1, $2, $3::"CommunityPostStatus", 'unsafe_class', $4, $5, $6, $6, now())`,
    [
      id,
      userId,
      status,
      extra.erasure ? FLAGGED_AT : null,
      extra.anonymized ? FLAGGED_AT : null,
      extra.published || status === 'published' ? FLAGGED_AT : null,
    ]
  )
}

async function event(postId: string, action: string, at: Date, extra: object = {}) {
  await db.query(
    `INSERT INTO "ModerationEvent"
       (id, post_id, action, reason, content_snapshot, image_object_path, created_at)
     VALUES ($1, $2, $3, 'r', $4, 'community/p/o.jpg', $5)`,
    [randomUUID(), postId, action, JSON.stringify({ caption: postId, ...extra }), at]
  )
}

async function commentReport(id: string, commentId: string, auditAction: string) {
  await db.query(
    `INSERT INTO "CommunityCommentReport"
       (id, comment_id, reporter_id, reason, accepted_at, routed_at, sla_due_at)
     VALUES ($1, $2, NULL, 'inappropriate_content', $3, $3, $4)`,
    [id, commentId, FLAGGED_AT, new Date(FLAGGED_AT.getTime() + DAY_MS)]
  )
  await db.query(
    `INSERT INTO "CommunityCommentAudit" (id, report_id, action, reason, occurred_at)
     VALUES ($1, $2, $3, 'r', $4)`,
    [randomUUID(), id, auditAction, FLAGGED_AT]
  )
}

const canReach = async () => {
  const probe = new Client({ connectionString: source, connectionTimeoutMillis: 2000 })
  try {
    await probe.connect()
    return true
  } catch {
    return false
  } finally {
    await probe.end().catch(() => undefined)
  }
}

const reachable = await canReach()
// A laptop with no database skips this suite, and CI with no database is a failed run.
const automated = process.env.CI === 'true' || process.env.CI === '1'

describe.runIf(reachable || automated)('moderation decisions database', () => {
  beforeAll(async () => {
    if (!reachable)
      throw new Error(
        `CI is set and ${target.hostname}:${target.port} is unreachable, so the decision table guarantees would go unproven.`
      )
    await admin.connect()
    await admin.query(`CREATE DATABASE "${name}" TEMPLATE template0`)
    await db.connect()
    await db.query(`
      CREATE SCHEMA auth;
      CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $fn$
        SELECT coalesce(
          nullif(current_setting('request.jwt.claim', true), ''),
          nullif(current_setting('request.jwt.claims', true), '')
        )::jsonb
      $fn$;
      GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
    `)
    const all = (await readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
    const index = all.indexOf(MIGRATION)
    expect(index, 'the 6.11 migration exists').toBeGreaterThan(0)
    for (const migration of all.slice(0, index))
      await db.query(
        await readFile(resolve(directory, migration, 'migration.sql'), 'utf8')
      )

    // The old shape, as production holds it before the migration.
    await member('author')
    await member('canary-user-1')
    await member('reporter')
    await db.query(
      "INSERT INTO \"CommunityAlias\" (id, user_id, alias) VALUES ('alias-author', 'author', 'Quiet Fox')"
    )

    await post('flagged-plain', 'author', 'flagged')
    await event('flagged-plain', 'flagged', FLAGGED_AT)

    await post('flagged-then-operator', 'author', 'flagged')
    await event('flagged-then-operator', 'flagged', FLAGGED_AT)
    await event(
      'flagged-then-operator',
      'released_by_operator',
      new Date(FLAGGED_AT.getTime() + 1000)
    )
    await event(
      'flagged-then-operator',
      'taken_down_by_operator',
      new Date(FLAGGED_AT.getTime() + 2000)
    )

    await post('flagged-then-note', 'author', 'flagged')
    await event('flagged-then-note', 'flagged', FLAGGED_AT)
    await event(
      'flagged-then-note',
      'report_resolved',
      new Date(FLAGGED_AT.getTime() + 1000)
    )

    await post('flagged-reported', 'author', 'flagged')
    await event('flagged-reported', 'flagged', FLAGGED_AT)
    await db.query(
      `INSERT INTO "CommunityPostReport"
         (id, post_id, reporter_id, reason, sla_due_at, created_at)
       VALUES ('member-report', 'flagged-reported', 'reporter', 'spam', $1, $2)`,
      [new Date(FLAGGED_AT.getTime() + DAY_MS), FLAGGED_AT]
    )

    await post('flagged-no-event', 'author', 'flagged')
    await post('review-failed', 'author', 'review_failed')
    await event('review-failed', 'flagged', FLAGGED_AT)
    await post('flagged-canary', 'canary-user-1', 'flagged')
    await event('flagged-canary', 'flagged', FLAGGED_AT)
    await post('flagged-erasing', 'author', 'flagged', { erasure: true })
    await event('flagged-erasing', 'flagged', FLAGGED_AT)
    await post('flagged-anonymized', 'author', 'flagged', { anonymized: true })
    await event('flagged-anonymized', 'flagged', FLAGGED_AT)
    await post('live', 'author', 'published')
    await event('live', 'flagged', FLAGGED_AT)

    await db.query(
      `INSERT INTO "CommunityComment"
         (id, post_id, user_id, body, locale, status, publication_sequence, published_at,
          platform, updated_at)
       VALUES ('held', 'live', 'author', 'Held body', 'en-US', 'held_for_review', NULL, NULL,
               'web', now()),
              ('reported', 'live', 'author', 'Live body', 'en-US', 'published', 1, $1,
               'web', now())`,
      [FLAGGED_AT]
    )
    await commentReport('screen-held', 'held', 'held_for_review')
    await commentReport('screen-blocked', 'held', 'blocked')
    await commentReport('screen-failed', 'held', 'screening_failed')
    await commentReport('erased-member-reporter', 'reported', 'reported')

    await db.query(await readFile(resolve(directory, MIGRATION, 'migration.sql'), 'utf8'))
  }, 120_000)

  afterAll(async () => {
    if (!reachable) return
    await db.end().catch(() => undefined)
    await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`)
    await admin.end()
  })

  const postReports = async (postId: string) =>
    (
      await db.query<{
        reporter_id: string | null
        reason: string
        origin: string
        created_at: Date
        sla_due_at: Date
        resolved_at: Date | null
        subject_alias: string | null
        image_object_path: string | null
        content_snapshot: { caption?: string } | null
      }>('SELECT * FROM "CommunityPostReport" WHERE post_id = $1', [postId])
    ).rows

  describe('D-BACKFILL: screening intake for existing rows (D11, TEA-16)', () => {
    it('gives a flagged post one screening report due 24 hours after its flag', async () => {
      const rows = await postReports('flagged-plain')
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({
        reporter_id: null,
        reason: 'inappropriate_content',
        origin: 'screening',
        resolved_at: null,
        subject_alias: 'Quiet Fox',
        image_object_path: 'community/p/o.jpg',
        content_snapshot: { caption: 'flagged-plain' },
      })
      expect(rows[0]!.created_at.getTime()).toBe(FLAGGED_AT.getTime())
      expect(rows[0]!.sla_due_at.getTime()).toBe(FLAGGED_AT.getTime() + DAY_MS)
    })

    it('ignores an event that changes no status when finding the newest one', async () => {
      expect(await postReports('flagged-then-note')).toHaveLength(1)
    })

    it.each([
      ['an operator verdict is newer than the flag', 'flagged-then-operator'],
      ['no flagged event exists', 'flagged-no-event'],
      ['the post is review_failed', 'review-failed'],
      ['the author is a canary', 'flagged-canary'],
      ['erasure is requested', 'flagged-erasing'],
      ['the post is anonymized', 'flagged-anonymized'],
      ['the post is live', 'live'],
    ])('files nothing when %s', async (_label, postId) => {
      expect(await postReports(postId)).toEqual([])
    })

    it('keeps the existing member report on a flagged post and adds none', async () => {
      const rows = await postReports('flagged-reported')
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ reporter_id: 'reporter', origin: 'member' })
    })

    it.each(['screen-held', 'screen-blocked', 'screen-failed'])(
      'marks %s as screening from its audit action',
      async (id) => {
        const { rows } = await db.query<{ origin: string }>(
          'SELECT origin FROM "CommunityCommentReport" WHERE id = $1',
          [id]
        )
        expect(rows[0]?.origin).toBe('screening')
      }
    )

    it('keeps a null-reporter report that began as a member report as member', async () => {
      const { rows } = await db.query<{ origin: string }>(
        'SELECT origin FROM "CommunityCommentReport" WHERE id = \'erased-member-reporter\''
      )
      expect(rows[0]?.origin).toBe('member')
    })
  })

  describe('D-CONSTRAINTS: the database backstops (D5, D6, D7, D8)', () => {
    const NOW = new Date('2026-11-04T12:00:00.000Z')
    let sequence = 100
    const decision = async (
      patch: Partial<{
        id: string
        caseKey: string
        sequence: number
        moderator: string | null
        mutation: string
      }> = {}
    ) => {
      const id = patch.id ?? randomUUID()
      await db.query(
        `INSERT INTO "ModerationDecision"
           (id, case_key, sequence, source, report_ids, action, reason, moderator_id,
            moderator_role, mutation_id, payload_hash, response, is_terminal, decided_at)
         VALUES ($1, $2, $3, 'post', '{}', 'ban', 'r', $4, 'admin', $5, 'h', '{}', true, $6)`,
        [
          id,
          patch.caseKey ?? `post.${randomUUID()}`,
          patch.sequence ?? ++sequence,
          patch.moderator === undefined ? 'reporter' : patch.moderator,
          patch.mutation ?? randomUUID(),
          NOW,
        ]
      )
      return id
    }
    const sanction = async (
      decisionId: string,
      kind: 'temporary' | 'permanent',
      patch: { user?: string; expiresAt?: Date | null; liftedAt?: Date | null } = {}
    ) => {
      await db.query(
        `INSERT INTO "CommunitySanction"
           (id, user_id, decision_id, case_key, kind, expires_at, lifted_at, created_at)
         VALUES ($1, $2, $3, 'post.x', $4::"CommunitySanctionKind", $5, $6, $7)`,
        [
          randomUUID(),
          patch.user ?? 'author',
          decisionId,
          kind,
          patch.expiresAt === undefined
            ? kind === 'temporary'
              ? new Date(NOW.getTime() + DAY_MS)
              : null
            : patch.expiresAt,
          patch.liftedAt ?? null,
          NOW,
        ]
      )
    }
    const violation = (code: string, constraint?: string): unknown =>
      expect.objectContaining({ code, ...(constraint ? { constraint } : {}) }) as unknown

    it('refuses a second decision at the same case sequence', async () => {
      const caseKey = `post.${randomUUID()}`
      await decision({ caseKey, sequence: 1 })
      await expect(decision({ caseKey, sequence: 1 })).rejects.toEqual(
        violation('23505', 'ModerationDecision_case_key_sequence_key')
      )
      await expect(decision({ caseKey, sequence: 2 })).resolves.toBeTruthy()
    })

    it('scopes the idempotency key to the moderator', async () => {
      const mutation = randomUUID()
      await decision({ mutation })
      await expect(decision({ mutation })).rejects.toEqual(
        violation('23505', 'ModerationDecision_moderator_id_mutation_id_key')
      )
      await expect(decision({ mutation, moderator: 'author' })).resolves.toBeTruthy()
    })

    it('ties kind to expiry', async () => {
      await expect(
        sanction(await decision(), 'temporary', { expiresAt: null })
      ).rejects.toEqual(violation('23514', 'CommunitySanction_kind_matches_expiry'))
      await expect(
        sanction(await decision(), 'permanent', { expiresAt: NOW })
      ).rejects.toEqual(violation('23514', 'CommunitySanction_kind_matches_expiry'))
      await expect(
        sanction(await decision(), 'temporary', { expiresAt: NOW })
      ).rejects.toEqual(violation('23514', 'CommunitySanction_kind_matches_expiry'))
    })

    it('holds one sanction per decision and one unlifted permanent per member', async () => {
      await member('sanction-member')
      const user = 'sanction-member'
      const first = await decision()
      await sanction(first, 'permanent', { user })
      await expect(sanction(first, 'temporary', { user })).rejects.toEqual(
        violation('23505', 'CommunitySanction_decision_id_key')
      )
      await expect(sanction(await decision(), 'permanent', { user })).rejects.toEqual(
        violation('23505', 'CommunitySanction_one_unlifted_permanent_idx')
      )
      await db.query('UPDATE "CommunitySanction" SET lifted_at = $1 WHERE user_id = $2', [
        NOW,
        user,
      ])
      await expect(
        sanction(await decision(), 'permanent', { user })
      ).resolves.toBeUndefined()
    })

    it('allows a temporary row beside an unlifted permanent, which the API refuses instead', async () => {
      await member('temporary-member')
      await sanction(await decision(), 'permanent', { user: 'temporary-member' })
      await expect(
        sanction(await decision(), 'temporary', { user: 'temporary-member' })
      ).resolves.toBeUndefined()
    })

    it('defaults origin to member on both report tables and appeal status to not_requested', async () => {
      const { rows } = await db.query<{
        table_name: string
        column_name: string
        column_default: string
      }>(
        `SELECT table_name, column_name, column_default FROM information_schema.columns
         WHERE (table_name IN ('CommunityPostReport', 'CommunityCommentReport') AND column_name = 'origin')
            OR (table_name = 'CommunitySanction' AND column_name = 'appeal_status')
         ORDER BY table_name`
      )
      expect(rows.map((row) => row.column_default)).toEqual([
        '\'member\'::"CommunityReportOrigin"',
        '\'member\'::"CommunityReportOrigin"',
        '\'not_requested\'::"CommunitySanctionAppealStatus"',
      ])
    })

    it('cascades a sanction with its member and keeps the decision with a null subject', async () => {
      await member('erased-member')
      const id = await decision()
      await db.query(
        "UPDATE \"ModerationDecision\" SET subject_user_id = 'erased-member', subject_alias = 'Kept Alias' WHERE id = $1",
        [id]
      )
      await sanction(id, 'temporary', { user: 'erased-member' })
      await db.query('BEGIN')
      try {
        await db.query(
          "SELECT community_privacy_guards(ARRAY['erased-member'], ARRAY[]::text[], true)"
        )
        await db.query('DELETE FROM "User" WHERE id = \'erased-member\'')
        await db.query('COMMIT')
      } catch (error) {
        await db.query('ROLLBACK')
        throw error
      }
      const left = await db.query(
        'SELECT 1 FROM "CommunitySanction" WHERE decision_id = $1',
        [id]
      )
      expect(left.rowCount).toBe(0)
      const { rows } = await db.query<{
        subject_user_id: string | null
        subject_alias: string
      }>(
        'SELECT subject_user_id, subject_alias FROM "ModerationDecision" WHERE id = $1',
        [id]
      )
      expect(rows[0]).toEqual({ subject_user_id: null, subject_alias: 'Kept Alias' })
    })

    it('enables RLS with zero policies on both tables', async () => {
      const { rows } = await db.query<{ relname: string; relrowsecurity: boolean }>(
        `SELECT relname, relrowsecurity FROM pg_class
         WHERE relname IN ('ModerationDecision', 'CommunitySanction') ORDER BY relname`
      )
      expect(rows).toEqual([
        { relname: 'CommunitySanction', relrowsecurity: true },
        { relname: 'ModerationDecision', relrowsecurity: true },
      ])
      const policies = await db.query(
        "SELECT 1 FROM pg_policies WHERE tablename IN ('ModerationDecision', 'CommunitySanction')"
      )
      expect(policies.rowCount).toBe(0)
    })

    it('leaves the client roles no privilege on either table', async () => {
      for (const table of ['ModerationDecision', 'CommunitySanction'])
        for (const role of ['anon', 'authenticated'])
          for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) {
            const { rows } = await db.query<{ granted: boolean }>(
              'SELECT has_table_privilege($1, $2, $3) AS granted',
              [role, `public."${table}"`, privilege]
            )
            expect(rows[0]?.granted, `${role} ${privilege} ${table}`).toBe(false)
          }
    })
  })
})
