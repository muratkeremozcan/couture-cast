// Learning path Step 53: Immutable moderation history.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-53-immutable-moderation-history
// Story 6.13 owner: the database proof for immutable moderation history. Every statement that must be
// refused runs as a login with the application role's attributes, on a database that login migrated,
// because a superuser skips the privilege layer. Row comparison reads `xmin` too, so a rewrite that
// restores the same values still fails.
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Client } from 'pg'
import {
  appLoginUrl,
  canReachDatabase,
  createEmptyDatabase,
  createHistoryDatabase,
  dropDatabase,
  type HistoryDatabase,
  APP_LOGIN,
  migrateAs,
  NO_BYPASS_LOGIN,
  OWNER_ROLE,
  resolveSuperuserUrl,
  inRollback,
  sqlState,
  takeGuard,
} from './support/moderation-history-database.js'

const PERMISSION_DENIED = '42501'
const GUARD_REQUIRED = '23514'
const ERASED = '[erased]'
const DECIDED_AT = new Date('2026-06-01T12:00:00.000Z')

const reachable = await canReachDatabase()
// A laptop with no database skips this suite, and CI with no database is a failed run.
const automated = process.env.CI === 'true' || process.env.CI === '1'

describe.runIf(reachable || automated)('moderation history enforcement', () => {
  let database: HistoryDatabase
  let app: Client
  let root: Client
  let sequence = 0

  const uniqueId = (prefix: string) => `${prefix}-${randomUUID()}`

  async function member(prefix = 'member'): Promise<string> {
    const id = uniqueId(prefix)
    await root.query(
      'INSERT INTO "User" (id, email, updated_at) VALUES ($1, $2, now())',
      [id, `${id}@example.test`]
    )
    return id
  }

  async function erasureRequest(memberId: string, requestedBy: string | null = null) {
    const id = randomUUID()
    await root.query(
      `INSERT INTO "ModerationErasureRequest" (id, member_id, requested_by, requested_at)
       VALUES ($1, $2, $3, now())`,
      [id, memberId, requestedBy]
    )
    return id
  }

  async function postReport(reporter: string | null) {
    const id = uniqueId('report')
    await root.query(
      `INSERT INTO "CommunityPostReport" (id, reporter_id, reason, sla_due_at)
       VALUES ($1, $2, 'inappropriate_content', now())`,
      [id, reporter]
    )
    return id
  }

  async function commentReport(reporter: string | null) {
    const id = uniqueId('comment-report')
    await root.query(
      `INSERT INTO "CommunityCommentReport"
         (id, reporter_id, reason, accepted_at, routed_at, sla_due_at)
       VALUES ($1, $2, 'inappropriate_content', now(), now(), now() + interval '24 hours')`,
      [id, reporter]
    )
    return id
  }

  async function post(author: string) {
    const id = uniqueId('post')
    await root.query(
      `INSERT INTO "LookbookPost" (id, user_id, status, updated_at)
       VALUES ($1, $2, 'draft', now())`,
      [id, author]
    )
    return id
  }

  async function decision(
    patch: Partial<{
      subject: string | null
      moderator: string | null
      alias: string | null
      reportIds: string[]
      post: string | null
      reason: string
    }> = {}
  ) {
    const id = uniqueId('decision')
    sequence += 1
    await app.query(
      `INSERT INTO "ModerationDecision"
         (id, case_key, sequence, source, post_id, report_ids, action, reason, moderator_id,
          moderator_role, subject_user_id, subject_alias, mutation_id, payload_hash, response,
          is_terminal, decided_at)
       VALUES ($1, $2, $3, 'post', $4, $5, 'resolve', $6, $7, 'moderator', $8, $9, $10, 'hash',
         '{"kept":true}', true, $11)`,
      [
        id,
        `post.${id}`,
        sequence,
        patch.post ?? null,
        patch.reportIds ?? [],
        patch.reason ?? 'The original rationale',
        patch.moderator ?? null,
        patch.subject ?? null,
        patch.alias ?? null,
        randomUUID(),
        DECIDED_AT,
      ]
    )
    return id
  }

  /** The whole row and its tuple version, so even a same-value rewrite shows. */
  const rawRow = async (id: string) =>
    (
      await root.query<{ doc: string; version: string }>(
        `SELECT row_to_json(d)::text AS doc, xmin::text AS version
         FROM "ModerationDecision" d WHERE id = $1`,
        [id]
      )
    ).rows[0]

  const row = async (id: string) =>
    (
      await root.query<Record<string, unknown>>(
        'SELECT * FROM "ModerationDecision" WHERE id = $1',
        [id]
      )
    ).rows[0]!

  beforeAll(async () => {
    if (!reachable)
      throw new Error(
        'CI is set and the test database is unreachable, so 6.13 stays unproven.'
      )
    database = await createHistoryDatabase()
    app = await database.app()
    root = await database.superuser()
  }, 180_000)

  afterAll(async () => {
    await app?.end().catch(() => undefined)
    await root?.end().catch(() => undefined)
    await database?.drop()
  })

  describe('refused for every role', () => {
    it.each([
      'id',
      'case_key',
      'sequence',
      'source',
      'post_id',
      'comment_id',
      'report_ids',
      'action',
      'reason',
      'moderator_id',
      'moderator_role',
      'subject_user_id',
      'subject_alias',
      'mutation_id',
      'payload_hash',
      'response',
      'is_terminal',
      'decided_at',
      'anonymized_at',
    ])(
      '[P0] D-IMM-UPDATE refuses an UPDATE of %s and the row is byte-identical',
      async (column) => {
        const id = await decision()
        const before = await rawRow(id)
        const state = await inRollback(app, () =>
          sqlState(
            app,
            `UPDATE "ModerationDecision" SET ${column} = ${column} WHERE id = $1`,
            [id]
          )
        )
        expect(state).toBe(PERMISSION_DENIED)
        expect(await rawRow(id)).toEqual(before)
      }
    )

    it('[P0] D-IMM-DELETE refuses a DELETE and the row is byte-identical', async () => {
      const id = await decision()
      const before = await rawRow(id)
      expect(
        await inRollback(app, () =>
          sqlState(app, 'DELETE FROM "ModerationDecision" WHERE id = $1', [id])
        )
      ).toBe(PERMISSION_DENIED)
      expect(await rawRow(id)).toEqual(before)
    })

    it('[P0] D-IMM-TRUNCATE refuses a TRUNCATE and the row count stays', async () => {
      const id = await decision()
      const before = await rawRow(id)
      expect(
        await inRollback(app, () => sqlState(app, 'TRUNCATE "ModerationDecision"'))
      ).toBe(PERMISSION_DENIED)
      expect(await rawRow(id)).toEqual(before)
    })

    describe.each(['anon', 'authenticated', 'service_role'])(
      '[P0] D-IMM-CLIENT-ROLES for %s',
      (role) => {
        it.each([
          ['SELECT', 'SELECT id FROM "ModerationDecision" LIMIT 1'],
          [
            'INSERT',
            `INSERT INTO "ModerationDecision" (id, case_key, sequence, source, action, reason,
               moderator_role, mutation_id, payload_hash, response, is_terminal, decided_at)
             VALUES ('x', 'x', 1, 'post', 'resolve', 'r', 'moderator', gen_random_uuid(), 'h', '{}',
               true, now())`,
          ],
          ['UPDATE', 'UPDATE "ModerationDecision" SET reason = \'x\''],
          ['DELETE', 'DELETE FROM "ModerationDecision"'],
          ['TRUNCATE', 'TRUNCATE "ModerationDecision"'],
          ['EXECUTE', "SELECT private.moderation_history_anonymize('x')"],
        ])('refuses %s', async (_verb, statement) => {
          const state = await inRollback(root, async () => {
            await root.query(`SET LOCAL ROLE ${role}`)
            return sqlState(root, statement)
          })
          expect(state).toBe(PERMISSION_DENIED)
        })
      }
    )

    it('[P0] D-IMM-CLIENT-ROLES holds no table privilege for any client role, under default privileges', async () => {
      const { rows } = await root.query(
        `SELECT grantee, privilege_type FROM information_schema.role_table_grants
         WHERE table_name = 'ModerationDecision'
           AND grantee IN ('PUBLIC', 'anon', 'authenticated', 'service_role')`
      )
      expect(rows).toEqual([])
      // Proves the revoke had something to remove: a table created now would get these grants.
      await root.query('BEGIN')
      try {
        await root.query(`SET LOCAL ROLE ${APP_LOGIN}`)
        await root.query('CREATE TABLE default_privilege_probe (id integer)')
        const probe = await root.query(
          `SELECT grantee FROM information_schema.role_table_grants
           WHERE table_name = 'default_privilege_probe' AND grantee = 'service_role'`
        )
        expect(probe.rowCount).toBeGreaterThan(0)
      } finally {
        await root.query('ROLLBACK')
      }
    })

    it.each([
      ['UPDATE', 'UPDATE "ModerationDecision" SET reason = \'x\''],
      ['DELETE', 'DELETE FROM "ModerationDecision"'],
      ['TRUNCATE', 'TRUNCATE "ModerationDecision" CASCADE'],
    ])('[P0] D-IMM-SUPERUSER hits the trigger on %s', async (_verb, statement) => {
      const id = await decision()
      const before = await rawRow(id)
      expect(await inRollback(root, () => sqlState(root, statement))).toBe(
        PERMISSION_DENIED
      )
      expect(await rawRow(id)).toEqual(before)
    })

    it.each([
      ['DISABLE TRIGGER', 'ALTER TABLE "ModerationDecision" DISABLE TRIGGER ALL'],
      ['DROP TRIGGER', null],
      ['ALTER OWNER', `ALTER TABLE "ModerationDecision" OWNER TO ${APP_LOGIN}`],
      ['RENAME', 'ALTER TABLE "ModerationDecision" RENAME TO stolen'],
      ['ADD COLUMN', 'ALTER TABLE "ModerationDecision" ADD COLUMN stolen text'],
      [
        'DROP CONSTRAINT',
        'ALTER TABLE "ModerationDecision" DROP CONSTRAINT "ModerationDecision_pkey"',
      ],
      [
        'CREATE RULE',
        'CREATE RULE stolen AS ON UPDATE TO "ModerationDecision" DO INSTEAD NOTHING',
      ],
      ['CREATE POLICY', 'CREATE POLICY stolen ON "ModerationDecision" USING (true)'],
      ['SET ROLE', `SET ROLE ${OWNER_ROLE}`],
    ])('[P0] D-IMM-BYPASS refuses %s', async (name, statement) => {
      let sql = statement
      if (name === 'DROP TRIGGER') {
        const { rows } = await root.query<{ tgname: string }>(
          `SELECT tgname FROM pg_trigger
           WHERE tgrelid = '"ModerationDecision"'::regclass AND NOT tgisinternal LIMIT 1`
        )
        expect(rows[0]).toBeDefined()
        sql = `DROP TRIGGER ${rows[0]!.tgname} ON "ModerationDecision"`
      }
      expect(await inRollback(app, () => sqlState(app, sql!))).toBe(PERMISSION_DENIED)
    })

    // A plain image refuses this setting. Supabase's image admits it for `postgres`, and there it
    // switches the triggers off, which is why the privilege layer has to hold alone (TEA-24).
    it('[P0] D-IMM-BYPASS holds under session_replication_role, whether or not it can be set', async () => {
      const id = await decision()
      const before = await rawRow(id)
      await inRollback(app, async () => {
        const setting = await sqlState(
          app,
          'SET LOCAL session_replication_role = replica'
        )
        expect(['ok', PERMISSION_DENIED]).toContain(setting)
        for (const statement of [
          'UPDATE "ModerationDecision" SET reason = \'x\'',
          'DELETE FROM "ModerationDecision"',
          'TRUNCATE "ModerationDecision"',
        ])
          expect(await sqlState(app, statement)).toBe(PERMISSION_DENIED)
      })
      expect(await rawRow(id)).toEqual(before)
    })

    it.each(['User', 'LookbookPost', 'CommunityComment'])(
      '[P0] D-IMM-CASCADE-TRUNCATE refuses TRUNCATE "%s" CASCADE and every row stays',
      async (table) => {
        const id = await decision()
        const before = await rawRow(id)
        expect(
          await inRollback(app, () => sqlState(app, `TRUNCATE "${table}" CASCADE`))
        ).toBe(PERMISSION_DENIED)
        expect(await rawRow(id)).toEqual(before)
      }
    )

    it('[P0] D-IMM-INSERT inserts with RETURNING, reads back, and a child sanction passes its key', async () => {
      const subject = await member('subject')
      const id = uniqueId('decision')
      const { rows } = await app.query<{ id: string }>(
        `INSERT INTO "ModerationDecision"
           (id, case_key, sequence, source, report_ids, action, reason, moderator_role,
            subject_user_id, mutation_id, payload_hash, response, is_terminal, decided_at)
         VALUES ($1, $2, 1, 'post', '{}', 'ban', 'Rationale here', 'moderator', $3,
           gen_random_uuid(), 'hash', '{}', true, now())
         RETURNING id`,
        [id, `post.${id}`, subject]
      )
      expect(rows).toEqual([{ id }])
      await app.query(
        `INSERT INTO "CommunitySanction" (id, user_id, decision_id, case_key, kind, created_at)
         VALUES ($1, $2, $3, $4, 'permanent', now())`,
        [uniqueId('sanction'), subject, id, `post.${id}`]
      )
      const read = await app.query('SELECT 1 FROM "ModerationDecision" WHERE id = $1', [
        id,
      ])
      expect(read.rowCount).toBe(1)
    })

    it('[P0] D-IMM-PRISMA runs the ORM statement shapes as the application role', async () => {
      const { PrismaClient } = await import('@prisma/client')
      const prisma = new PrismaClient({ datasourceUrl: database.appUrl })
      try {
        const id = uniqueId('decision')
        const created = await prisma.moderationDecision.create({
          data: {
            id,
            case_key: `post.${id}`,
            sequence: 1,
            source: 'post',
            report_ids: [],
            action: 'resolve',
            reason: 'Through the client.',
            moderator_role: 'moderator',
            mutation_id: randomUUID(),
            payload_hash: 'hash',
            response: {},
            is_terminal: true,
            decided_at: DECIDED_AT,
          },
        })
        expect(created.anonymized_at).toBeNull()
        expect(
          await prisma.moderationDecision.findUniqueOrThrow({ where: { id } })
        ).toEqual(created)
        await expect(
          prisma.moderationDecision.update({ where: { id }, data: { reason: 'x' } })
        ).rejects.toThrow()
        await expect(
          prisma.moderationDecision.delete({ where: { id } })
        ).rejects.toThrow()
        await expect(prisma.moderationDecision.deleteMany()).rejects.toThrow()
      } finally {
        await prisma.$disconnect()
      }
    })

    it('[P2] D-IMM-REPLICA-LIMIT pins that a superuser in replica mode skips the trigger', async () => {
      const id = await decision()
      const state = await inRollback(root, async () => {
        await root.query('SET LOCAL session_replication_role = replica')
        return sqlState(
          root,
          'UPDATE "ModerationDecision" SET reason = \'x\' WHERE id = $1',
          [id]
        )
      })
      expect(state).toBe('ok')
    })

    it('[P1] D-RESIDUAL-SCHEMA-OWNER pins what schema ownership still allows, with UPDATE refused', async () => {
      await inRollback(app, async () => {
        expect(
          await sqlState(app, 'DROP FUNCTION private.moderation_history_guard() CASCADE')
        ).toBe('ok')
        const { rows } = await app.query<{ count: string }>(
          `SELECT count(*) FROM pg_trigger
           WHERE tgrelid = '"ModerationDecision"'::regclass AND NOT tgisinternal`
        )
        expect(rows[0]?.count).toBe('0')
        expect(
          await sqlState(app, 'UPDATE "ModerationDecision" SET reason = \'x\'')
        ).toBe(PERMISSION_DENIED)
      })
      await inRollback(app, async () => {
        expect(await sqlState(app, 'DROP TABLE "ModerationDecision" CASCADE')).toBe('ok')
      })
      const { rowCount } = await root.query(
        'SELECT 1 FROM pg_class WHERE oid = \'"ModerationDecision"\'::regclass'
      )
      expect(rowCount).toBe(1)
    })
  })

  describe('the foreign key exception', () => {
    const others = (doc: Record<string, unknown>, ...skip: string[]) =>
      Object.fromEntries(Object.entries(doc).filter(([key]) => !skip.includes(key)))

    it('[P0] D-EX-FK-USER nulls the subject and leaves every other column', async () => {
      const subject = await member('subject')
      const id = await decision({ subject, alias: 'Kept Alias' })
      const before = await row(id)
      await app.query('BEGIN')
      await takeGuard(app, subject)
      await app.query('DELETE FROM "User" WHERE id = $1', [subject])
      await app.query('COMMIT')
      const after = await row(id)
      expect(after.subject_user_id).toBeNull()
      expect(after.anonymized_at).toBeNull()
      expect(after.reason).toBe('The original rationale')
      expect(others(after, 'subject_user_id')).toEqual(others(before, 'subject_user_id'))
    })

    it('[P0] D-EX-FK-MOD nulls the moderator and leaves every other column', async () => {
      const moderator = await member('moderator')
      const id = await decision({ moderator })
      const before = await row(id)
      await app.query('BEGIN')
      await takeGuard(app, moderator)
      await app.query('DELETE FROM "User" WHERE id = $1', [moderator])
      await app.query('COMMIT')
      const after = await row(id)
      expect(after.moderator_id).toBeNull()
      expect(others(after, 'moderator_id')).toEqual(others(before, 'moderator_id'))
    })

    it('[P0] D-EX-FK-TARGET nulls the post and leaves every other column', async () => {
      const author = await member('author')
      const postId = await post(author)
      const id = await decision({ post: postId })
      const before = await row(id)
      await app.query('BEGIN')
      await app.query(
        'SELECT community_privacy_guards(ARRAY[]::text[], ARRAY[$1], true)',
        [postId]
      )
      await app.query('DELETE FROM "LookbookPost" WHERE id = $1', [postId])
      await app.query('COMMIT')
      const after = await row(id)
      expect(after.post_id).toBeNull()
      expect(others(after, 'post_id')).toEqual(others(before, 'post_id'))
    })

    it('[P1] D-EX-RENAME refuses a User id rename with a decision, and allows one without', async () => {
      const named = await member('renamed-with')
      await decision({ subject: named })
      const free = await member('renamed-without')
      const refused = await inRollback(app, async () => {
        await takeGuard(app, named)
        return sqlState(app, 'UPDATE "User" SET id = $1 WHERE id = $2', [
          uniqueId('new'),
          named,
        ])
      })
      expect(refused).toBe(PERMISSION_DENIED)
      const allowed = await inRollback(app, async () => {
        await takeGuard(app, free)
        return sqlState(app, 'UPDATE "User" SET id = $1 WHERE id = $2', [
          uniqueId('new'),
          free,
        ])
      })
      expect(allowed).toBe('ok')
    })
  })

  describe('the owner path', () => {
    const asOwnerState = (statement: string, values: unknown[] = []) =>
      database.asOwner((owner) =>
        inRollback(owner, () => sqlState(owner, statement, values))
      )

    /** A refusal only counts if the owner path can do what it is allowed. Rolled back, so harmless. */
    const expectOwnerPathOpen = async (id: string) =>
      expect(
        await asOwnerState(
          'UPDATE "ModerationDecision" SET anonymized_at = \'2026-11-05\' WHERE id = $1',
          [id]
        )
      ).toBe('ok')

    it.each([
      ['id', "'other'"],
      ['case_key', "'post.other'"],
      ['sequence', 'sequence + 1000000'],
      ['source', "'comment'"],
      ['report_ids', "ARRAY['other']"],
      ['action', "'release'"],
      ['moderator_role', "'admin'"],
      ['subject_alias', "'Other Alias'"],
      ['mutation_id', 'gen_random_uuid()'],
      ['payload_hash', "'other'"],
      ['response', '\'{"other":true}\''],
      ['is_terminal', 'NOT is_terminal'],
      ['decided_at', "decided_at + interval '1 day'"],
    ])('[P0] D-EX-OWNER-FROZEN refuses a change to %s', async (column, value) => {
      const id = await decision({ alias: 'Alias' })
      await expectOwnerPathOpen(id)
      const before = await rawRow(id)
      expect(
        await asOwnerState(
          `UPDATE "ModerationDecision" SET ${column} = ${value} WHERE id = $1`,
          [id]
        )
      ).toBe(PERMISSION_DENIED)
      expect(await rawRow(id)).toEqual(before)
    })

    it.each(['moderator_id', 'subject_user_id', 'post_id', 'comment_id'])(
      '[P0] D-EX-OWNER-IDENTITY refuses a new value in %s, from a value and from null',
      async (column) => {
        const { rows } = await root.query<{ id: string }>('SELECT id FROM "User" LIMIT 1')
        const someUser = rows[0]?.id ?? (await member('someone'))
        const target =
          column === 'post_id'
            ? await post(someUser)
            : column === 'comment_id'
              ? null
              : await member('target')
        const fromNull = await decision()
        await expectOwnerPathOpen(fromNull)
        const state =
          target === null
            ? await asOwnerState(
                'UPDATE "ModerationDecision" SET comment_id = \'no-such-comment\' WHERE id = $1',
                [fromNull]
              )
            : await asOwnerState(
                `UPDATE "ModerationDecision" SET ${column} = $1 WHERE id = $2`,
                [target, fromNull]
              )
        expect(state).toBe(PERMISSION_DENIED)

        if (column === 'subject_user_id' || column === 'moderator_id') {
          const holder = await member('holder')
          const held = await decision(
            column === 'subject_user_id' ? { subject: holder } : { moderator: holder }
          )
          expect(
            await asOwnerState(
              `UPDATE "ModerationDecision" SET ${column} = $1 WHERE id = $2`,
              [target, held]
            )
          ).toBe(PERMISSION_DENIED)
        }
      }
    )

    it('[P0] D-EX-OWNER-REASON allows only the constant, and only with anonymized_at set', async () => {
      const id = await decision()
      expect(
        await asOwnerState(
          'UPDATE "ModerationDecision" SET reason = \'free text\' WHERE id = $1',
          [id]
        )
      ).toBe(PERMISSION_DENIED)
      expect(
        await asOwnerState('UPDATE "ModerationDecision" SET reason = $1 WHERE id = $2', [
          ERASED,
          id,
        ])
      ).toBe(PERMISSION_DENIED)
      expect(
        await asOwnerState(
          'UPDATE "ModerationDecision" SET reason = \'free\', anonymized_at = now() WHERE id = $1',
          [id]
        )
      ).toBe(PERMISSION_DENIED)
      await database.asOwner((owner) =>
        owner.query(
          'UPDATE "ModerationDecision" SET reason = $1, anonymized_at = \'2026-11-05\' WHERE id = $2',
          [ERASED, id]
        )
      )
      expect((await row(id)).reason).toBe(ERASED)
      expect(
        await asOwnerState(
          'UPDATE "ModerationDecision" SET reason = \'restored\' WHERE id = $1',
          [id]
        )
      ).toBe(PERMISSION_DENIED)
    })

    it('[P0] D-EX-OWNER-TIMESTAMP moves anonymized_at from null once', async () => {
      const id = await decision()
      await database.asOwner((owner) =>
        owner.query(
          'UPDATE "ModerationDecision" SET anonymized_at = \'2026-11-05\' WHERE id = $1',
          [id]
        )
      )
      expect(
        await asOwnerState(
          'UPDATE "ModerationDecision" SET anonymized_at = \'2026-11-06\' WHERE id = $1',
          [id]
        )
      ).toBe(PERMISSION_DENIED)
      expect(
        await asOwnerState(
          'UPDATE "ModerationDecision" SET anonymized_at = NULL WHERE id = $1',
          [id]
        )
      ).toBe(PERMISSION_DENIED)
    })

    it('[P0] D-EX-OWNER-DELETE refuses DELETE and TRUNCATE for the owner', async () => {
      const id = await decision()
      await expectOwnerPathOpen(id)
      expect(
        await asOwnerState('DELETE FROM "ModerationDecision" WHERE id = $1', [id])
      ).toBe(PERMISSION_DENIED)
      expect(await asOwnerState('TRUNCATE "ModerationDecision" CASCADE')).toBe(
        PERMISSION_DENIED
      )
    })

    it('[P1] D-EX-NEW-COLUMN refuses a column a later migration adds', async () => {
      const id = await decision()
      await database.asOwner((owner) =>
        inRollback(owner, async () => {
          await owner.query(
            'ALTER TABLE "ModerationDecision" ADD COLUMN later_column text'
          )
          expect(
            await sqlState(
              owner,
              'UPDATE "ModerationDecision" SET later_column = \'x\' WHERE id = $1',
              [id]
            )
          ).toBe(PERMISSION_DENIED)
        })
      )
    })

    it('[P0] D-EX-NO-SPOOF grants nothing to a setting, and reads none in the guard', async () => {
      const id = await decision()
      const state = await inRollback(app, async () => {
        await app.query("SELECT set_config('moderation.history.exception', 'on', true)")
        await app.query(`SELECT set_config('app.role', '${OWNER_ROLE}', true)`)
        return sqlState(
          app,
          'UPDATE "ModerationDecision" SET reason = \'x\' WHERE id = $1',
          [id]
        )
      })
      expect(state).toBe(PERMISSION_DENIED)
      const { rows } = await root.query<{ prosrc: string }>(
        `SELECT prosrc FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'private' AND p.proname = 'moderation_history_guard'`
      )
      expect(rows).toHaveLength(1)
      expect(rows[0]!.prosrc).toMatch(/current_user/)
      expect(rows[0]!.prosrc).not.toMatch(
        /current_setting|session_user|pg_trigger_depth/i
      )
    })
  })

  describe('the exception function', () => {
    const anonymize = (client: Client, memberId: string) =>
      client.query<{ moderation_history_anonymize: number }>(
        'SELECT private.moderation_history_anonymize($1)',
        [memberId]
      )

    /** Runs the function the way the erasure transaction does, and commits. */
    async function eraseFor(memberId: string): Promise<number> {
      await app.query('BEGIN')
      try {
        await takeGuard(app, memberId)
        const { rows } = await anonymize(app, memberId)
        await app.query('COMMIT')
        return rows[0]!.moderation_history_anonymize
      } catch (error) {
        await app.query('ROLLBACK')
        throw error
      }
    }

    const callState = (memberId: string, guardFor: string | null) =>
      inRollback(app, async () => {
        if (guardFor) await takeGuard(app, guardFor)
        return sqlState(app, 'SELECT private.moderation_history_anonymize($1)', [
          memberId,
        ])
      })

    const setPrivacyVersion = (value: number) =>
      root.query(
        'UPDATE "CommunityRuntimeCapability" SET privacy_version = $1 WHERE id = 1',
        [value]
      )

    it('[P0] D-FN-NO-REQUEST refuses inside the guard with no request row, and changes nothing', async () => {
      const subject = await member('subject')
      const id = await decision({ subject })
      const before = await rawRow(id)
      expect(await callState(subject, subject)).toBe(PERMISSION_DENIED)
      expect(await rawRow(id)).toEqual(before)
    })

    it.each([0, 1])(
      '[P0] D-FN-NO-GUARD refuses at privacy_version %i with a request row and no guard',
      async (version) => {
        const subject = await member('subject')
        await erasureRequest(subject)
        const id = await decision({ subject })
        const before = await rawRow(id)
        const { rows } = await root.query<{ privacy_version: number }>(
          'SELECT privacy_version FROM "CommunityRuntimeCapability" WHERE id = 1'
        )
        const original = rows[0]!.privacy_version
        await setPrivacyVersion(version)
        try {
          expect(await callState(subject, null)).toBe(GUARD_REQUIRED)
          expect(await rawRow(id)).toEqual(before)
        } finally {
          await setPrivacyVersion(original)
        }
      }
    )

    it('[P0] D-FN-NO-GUARD holds because the migrated default is 0, the production value', async () => {
      const { rows } = await root.query<{ privacy_version: number }>(
        'SELECT privacy_version FROM "CommunityRuntimeCapability" WHERE id = 1'
      )
      expect(rows[0]?.privacy_version).toBe(0)
    })

    it('[P0] D-FN-WRONG-GUARD refuses while holding only another member guard', async () => {
      const subject = await member('subject')
      const other = await member('other')
      await erasureRequest(subject)
      const id = await decision({ subject })
      const before = await rawRow(id)
      expect(await callState(subject, other)).toBe(GUARD_REQUIRED)
      expect(await rawRow(id)).toEqual(before)
    })

    it('[P0] D-FN-ACL pins owner, definer, search path and the only grantee', async () => {
      const { rows } = await root.query<{
        owner: string
        prosecdef: boolean
        proconfig: string[] | null
        grantees: string[]
      }>(
        `SELECT pg_get_userbyid(p.proowner) AS owner, p.prosecdef, p.proconfig,
           ARRAY(
             SELECT coalesce(r.rolname::text, 'PUBLIC')
             FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
             LEFT JOIN pg_roles r ON r.oid = a.grantee
             WHERE a.privilege_type = 'EXECUTE' ORDER BY 1
           ) AS grantees
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'private' AND p.proname = 'moderation_history_anonymize'`
      )
      expect(rows).toHaveLength(1)
      expect(rows[0]!.owner).toBe(OWNER_ROLE)
      expect(rows[0]!.prosecdef).toBe(true)
      expect(rows[0]!.proconfig?.join(',')).toMatch(/search_path=/)
      expect(rows[0]!.grantees.filter((name) => name !== OWNER_ROLE)).toEqual([APP_LOGIN])
    })

    it('[P0] D-FN-REPLACED-DEPENDENCY never runs a routine the application role can replace', async () => {
      const subject = await member('subject')
      await erasureRequest(subject)
      const id = await decision({ subject })
      await inRollback(app, async () => {
        await app.query(`
          CREATE OR REPLACE FUNCTION community_require_guard(namespace integer, subject text)
          RETURNS void LANGUAGE plpgsql AS $evil$
          BEGIN
            ALTER TABLE "ModerationDecision" DISABLE TRIGGER USER;
            UPDATE "ModerationDecision" SET action = 'release';
            ALTER TABLE "ModerationDecision" ENABLE TRIGGER USER;
          END $evil$
        `)
        await takeGuard(app, subject)
        await anonymize(app, subject)
        const { rows } = await app.query<{ action: string }>(
          'SELECT action::text FROM "ModerationDecision" WHERE id = $1',
          [id]
        )
        expect(rows[0]?.action).toBe('resolve')
      })
    })

    it('[P0] D-FN-RLS-VISIBLE sees rows behind RLS with zero policies and returns the true count', async () => {
      const reporter = await member('reporter')
      await erasureRequest(reporter)
      const reportId = await postReport(reporter)
      const id = await decision({ reportIds: [reportId] })
      const { rows } = await root.query<{ table: string; rls: boolean }>(
        `SELECT relname AS table, relrowsecurity AS rls FROM pg_class
         WHERE relname IN ('ModerationErasureRequest', 'CommunityPostReport') ORDER BY 1`
      )
      expect(rows.map((entry) => entry.rls)).toEqual([true, true])
      expect(await eraseFor(reporter)).toBe(1)
      expect((await row(id)).reason).toBe(ERASED)
    })

    it('[P0] D-FN-SUBJECT clears the subject, redacts the reason and leaves every other column', async () => {
      const subject = await member('subject')
      await erasureRequest(subject)
      const id = await decision({ subject, alias: 'Kept Alias' })
      const before = await row(id)
      expect(await eraseFor(subject)).toBe(1)
      const after = await row(id)
      expect(after.subject_user_id).toBeNull()
      expect(after.reason).toBe(ERASED)
      expect(after.anonymized_at).toBeInstanceOf(Date)
      const changed = ['subject_user_id', 'reason', 'anonymized_at']
      expect(
        Object.fromEntries(
          Object.entries(after).filter(([key]) => !changed.includes(key))
        )
      ).toEqual(
        Object.fromEntries(
          Object.entries(before).filter(([key]) => !changed.includes(key))
        )
      )
    })

    it.each([
      ['post', postReport],
      ['comment', commentReport],
    ] as const)(
      '[P0] D-FN-REPORTER redacts on an overlap with a %s report and keeps the third-party subject',
      async (_kind, file) => {
        const reporter = await member('reporter')
        const thirdParty = await member('third-party')
        await erasureRequest(reporter)
        const reportId = await file(reporter)
        const id = await decision({ subject: thirdParty, reportIds: [reportId] })
        expect(await eraseFor(reporter)).toBe(1)
        const after = await row(id)
        expect(after.reason).toBe(ERASED)
        expect(after.subject_user_id).toBe(thirdParty)
        expect(after.anonymized_at).toBeInstanceOf(Date)
      }
    )

    it('[P0] D-FN-MODERATOR clears the moderator and keeps role and reason', async () => {
      const moderator = await member('moderator')
      await erasureRequest(moderator)
      const id = await decision({ moderator })
      expect(await eraseFor(moderator)).toBe(1)
      const after = await row(id)
      expect(after.moderator_id).toBeNull()
      expect(after.moderator_role).toBe('moderator')
      expect(after.reason).toBe('The original rationale')
      expect(after.anonymized_at).toBeInstanceOf(Date)
    })

    it('[P1] D-FN-ALIAS-MATCH treats a null-subject row with the member alias as the member', async () => {
      const subject = await member('subject')
      const alias = `Alias ${randomUUID()}`
      await root.query(
        'INSERT INTO "CommunityAlias" (id, user_id, alias) VALUES ($1, $2, $3)',
        [uniqueId('alias'), subject, alias]
      )
      await erasureRequest(subject)
      const id = await decision({ subject: null, alias })
      const unrelated = await decision({ subject: null, alias: `Other ${randomUUID()}` })
      expect(await eraseFor(subject)).toBe(1)
      expect((await row(id)).reason).toBe(ERASED)
      expect((await row(unrelated)).reason).toBe('The original rationale')
    })

    it('[P0] D-FN-CROSS-MEMBER keeps the first timestamp when a second erasure touches the row', async () => {
      const moderator = await member('moderator')
      const subject = await member('subject')
      await erasureRequest(moderator)
      await erasureRequest(subject)
      const id = await decision({ moderator, subject })
      await eraseFor(moderator)
      const first = await row(id)
      expect(first.reason).toBe('The original rationale')
      expect(first.anonymized_at).toBeInstanceOf(Date)
      await eraseFor(subject)
      const second = await row(id)
      expect(second.reason).toBe(ERASED)
      expect(second.anonymized_at).toEqual(first.anonymized_at)
    })

    it('[P0] D-FN-IDEMPOTENT returns 0 on a rerun, changes no row and raises nothing', async () => {
      const subject = await member('subject')
      await erasureRequest(subject)
      const id = await decision({ subject })
      expect(await eraseFor(subject)).toBe(1)
      const before = await rawRow(id)
      expect(await eraseFor(subject)).toBe(0)
      expect(await rawRow(id)).toEqual(before)
    })

    it('[P0] D-FN-AUDIT writes one row with exact keys only with a requester and changed rows', async () => {
      const admin = await member('admin')
      const subject = await member('subject')
      const requestId = await erasureRequest(subject, admin)
      await decision({ subject })
      const audit = () =>
        root.query<{ user_id: string; event_data: Record<string, unknown> }>(
          `SELECT user_id, event_data FROM "AuditLog"
           WHERE event_type = 'moderation_history_anonymized' AND user_id = $1`,
          [admin]
        )
      await eraseFor(subject)
      const first = await audit()
      expect(first.rows).toEqual([
        { user_id: admin, event_data: { erasureRequestId: requestId, decisions: 1 } },
      ])
      await eraseFor(subject)
      expect((await audit()).rowCount).toBe(1)

      const quiet = await member('no-requester')
      await erasureRequest(quiet, null)
      await decision({ subject: quiet })
      const { rows: beforeRows } = await root.query<{ count: string }>(
        'SELECT count(*) FROM "AuditLog" WHERE event_type = \'moderation_history_anonymized\''
      )
      expect(await eraseFor(quiet)).toBe(1)
      const { rows: afterRows } = await root.query<{ count: string }>(
        'SELECT count(*) FROM "AuditLog" WHERE event_type = \'moderation_history_anonymized\''
      )
      expect(afterRows[0]?.count).toBe(beforeRows[0]?.count)
    })

    it('[P1] D-FN-UTC stamps UTC on a session in another time zone', async () => {
      const subject = await member('subject')
      await erasureRequest(subject)
      const id = await decision({ subject })
      await app.query("SET TIME ZONE 'America/Chicago'")
      try {
        await eraseFor(subject)
      } finally {
        await app.query("SET TIME ZONE 'UTC'")
      }
      // `pg` reads a timestamp without time zone as local time, so read it as text here.
      const { rows } = await root.query<{ stamped: string; utc: string }>(
        `SELECT to_char(anonymized_at, 'YYYY-MM-DD"T"HH24:MI') AS stamped,
                to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI') AS utc
         FROM "ModerationDecision" WHERE id = $1`,
        [id]
      )
      const drift = Math.abs(
        Date.parse(`${rows[0]!.stamped}Z`) - Date.parse(`${rows[0]!.utc}Z`)
      )
      expect(drift).toBeLessThanOrEqual(5 * 60_000)
    })
  })

  describe('role and schema', () => {
    it('[P0] D-ROLE-ATTRS pins the owner role attributes', async () => {
      const { rows } = await root.query(
        `SELECT rolcanlogin, rolbypassrls, rolsuper, rolcreaterole, rolcreatedb
         FROM pg_roles WHERE rolname = $1`,
        [OWNER_ROLE]
      )
      expect(rows).toEqual([
        {
          rolcanlogin: false,
          rolbypassrls: true,
          rolsuper: false,
          rolcreaterole: false,
          rolcreatedb: false,
        },
      ])
    })

    it('[P0] D-ROLE-MEMBERS leaves the migrating role with ADMIN alone, and no login with SET or INHERIT', async () => {
      const { rows } = await root.query<{
        member: string
        set_option: boolean
        inherit_option: boolean
      }>(
        `SELECT r.rolname AS member, m.set_option, m.inherit_option
         FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.member
         WHERE m.roleid = $1::regrole AND r.rolcanlogin`,
        [OWNER_ROLE]
      )
      expect(rows.filter((entry) => entry.set_option || entry.inherit_option)).toEqual([])
    })

    it('[P0] D-ROLE-GRANTS pins the exact grants of the owner role', async () => {
      const tables = await root.query<{ table_name: string; privilege_type: string }>(
        `SELECT table_name, privilege_type FROM information_schema.role_table_grants
         WHERE grantee = $1 AND table_name <> 'ModerationDecision'
         ORDER BY table_name, privilege_type`,
        [OWNER_ROLE]
      )
      expect(tables.rows).toEqual([
        { table_name: 'AuditLog', privilege_type: 'INSERT' },
        { table_name: 'CommunityAlias', privilege_type: 'SELECT' },
        { table_name: 'CommunityCommentReport', privilege_type: 'SELECT' },
        { table_name: 'CommunityPostReport', privilege_type: 'SELECT' },
        { table_name: 'ModerationErasureRequest', privilege_type: 'SELECT' },
      ])
      const schemas = await root.query<{
        schema: string
        usage: boolean
        create: boolean
      }>(
        `SELECT n.nspname AS schema,
           has_schema_privilege($1, n.oid, 'USAGE') AS usage,
           has_schema_privilege($1, n.oid, 'CREATE') AS create
         FROM pg_namespace n WHERE n.nspname IN ('public', 'private') ORDER BY 1`,
        [OWNER_ROLE]
      )
      expect(schemas.rows).toEqual([
        { schema: 'private', usage: true, create: false },
        { schema: 'public', usage: true, create: false },
      ])
      const functions = await root.query<{ name: string }>(
        `SELECT p.proname AS name FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public' AND has_function_privilege($1, p.oid, 'EXECUTE')
           AND p.proname LIKE 'community_%guard%'`,
        [OWNER_ROLE]
      )
      expect(functions.rows).toEqual([])
    })

    it('[P0] D-ROLE-GRANTS gives the application role SELECT and INSERT alone', async () => {
      const { rows } = await root.query<{ privilege: string }>(
        `SELECT a.privilege_type AS privilege
         FROM pg_class c, aclexplode(c.relacl) a
         WHERE c.oid = '"ModerationDecision"'::regclass AND a.grantee = $1::regrole
         ORDER BY 1`,
        [APP_LOGIN]
      )
      expect(rows.map((entry) => entry.privilege)).toEqual(['INSERT', 'SELECT'])
    })

    it('[P0] D-RLS holds the request table to RLS, zero policies and zero client grants', async () => {
      const state = await root.query(
        `SELECT relrowsecurity, relforcerowsecurity FROM pg_class
         WHERE oid = '"ModerationErasureRequest"'::regclass`
      )
      expect(state.rows).toEqual([{ relrowsecurity: true, relforcerowsecurity: false }])
      const policies = await root.query(
        `SELECT 1 FROM pg_policies
         WHERE tablename IN ('ModerationErasureRequest', 'ModerationDecision')`
      )
      expect(policies.rowCount).toBe(0)
      const grants = await root.query(
        `SELECT grantee FROM information_schema.role_table_grants
         WHERE table_name = 'ModerationErasureRequest'
           AND grantee IN ('PUBLIC', 'anon', 'authenticated', 'service_role')`
      )
      expect(grants.rows).toEqual([])
    })

    it('[P1] D-SCHEMA adds the column, and SET NULL keys on the request row', async () => {
      const column = await root.query(
        `SELECT data_type, is_nullable FROM information_schema.columns
         WHERE table_name = 'ModerationDecision' AND column_name = 'anonymized_at'`
      )
      expect(column.rows).toEqual([
        { data_type: 'timestamp without time zone', is_nullable: 'YES' },
      ])
      const keys = await root.query<{ column: string; action: string }>(
        `SELECT a.attname AS column, c.confdeltype AS action
         FROM pg_constraint c
         JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
         WHERE c.conrelid = '"ModerationErasureRequest"'::regclass AND c.contype = 'f'
         ORDER BY 1`
      )
      expect(keys.rows).toEqual([
        { column: 'member_id', action: 'n' },
        { column: 'requested_by', action: 'n' },
      ])
      const unique = await root.query(
        `SELECT 1 FROM pg_indexes
         WHERE tablename = 'ModerationErasureRequest' AND indexdef LIKE '%UNIQUE%member_id%'`
      )
      expect(unique.rowCount).toBe(1)
    })
  })

  describe('[P0] D-COMMENT-AUDIT: the one change the append-only comment audit admits', () => {
    const auditRow = async () => {
      const reportId = await commentReport(null)
      const id = uniqueId('audit')
      await root.query(
        `INSERT INTO "CommunityCommentAudit" (id, report_id, action, reason)
         VALUES ($1, $2, 'operator_takedown', 'The original rationale')`,
        [id, reportId]
      )
      return id
    }
    const set = (id: string, clause: string) =>
      inRollback(app, () =>
        sqlState(app, `UPDATE "CommunityCommentAudit" SET ${clause} WHERE id = $1`, [id])
      )

    it('admits reason to the constant, and it is durable', async () => {
      const id = await auditRow()
      await app.query('UPDATE "CommunityCommentAudit" SET reason = $1 WHERE id = $2', [
        ERASED,
        id,
      ])
      const { rows } = await root.query<{ reason: string; action: string }>(
        'SELECT reason, action FROM "CommunityCommentAudit" WHERE id = $1',
        [id]
      )
      expect(rows).toEqual([{ reason: ERASED, action: 'operator_takedown' }])
    })

    it.each([
      ['free text in reason', "reason = 'rewritten'"],
      [
        'the constant, with the action changed too',
        `reason = '${ERASED}', action = 'other'`,
      ],
      ['the action', "action = 'other'"],
      ['the time', "occurred_at = occurred_at + interval '1 day'"],
      ['the report', 'report_id = NULL'],
    ])('refuses %s', async (_name, clause) => {
      expect(await set(await auditRow(), clause)).toBe(GUARD_REQUIRED)
    })

    it('refuses to move a redacted reason back', async () => {
      const id = await auditRow()
      await app.query('UPDATE "CommunityCommentAudit" SET reason = $1 WHERE id = $2', [
        ERASED,
        id,
      ])
      expect(await set(id, "reason = 'restored'")).toBe(GUARD_REQUIRED)
    })

    it('refuses DELETE', async () => {
      const id = await auditRow()
      expect(
        await inRollback(app, () =>
          sqlState(app, 'DELETE FROM "CommunityCommentAudit" WHERE id = $1', [id])
        )
      ).toBe(GUARD_REQUIRED)
    })
  })

  describe('migration', () => {
    it('[P0] D-MIG-NONSUPER applied the whole chain as a login that is no superuser', async () => {
      const { rows } = await app.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
        'SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user'
      )
      expect(rows).toEqual([{ rolsuper: false, rolbypassrls: true }])
      const owner = await root.query<{ owner: string }>(
        `SELECT pg_get_userbyid(relowner) AS owner FROM pg_class
         WHERE oid = '"ModerationDecision"'::regclass`
      )
      expect(owner.rows).toEqual([{ owner: OWNER_ROLE }])
    })

    it('[P0] D-MIG-LACKS-BYPASS fails visibly with no partial state', async () => {
      const superBase = await resolveSuperuserUrl()
      const name = await createEmptyDatabase(NO_BYPASS_LOGIN)
      try {
        await expect(migrateAs(appLoginUrl(name, NO_BYPASS_LOGIN))).rejects.toThrow(
          /immutable_moderation_history/
        )
        const { Client } = await import('pg')
        const check = new Client({
          connectionString: new URL(`/${name}`, superBase).toString(),
        })
        await check.connect()
        try {
          const owner = await check.query<{ owner: string }>(
            `SELECT pg_get_userbyid(relowner) AS owner FROM pg_class
             WHERE oid = '"ModerationDecision"'::regclass`
          )
          expect(owner.rows).toEqual([{ owner: NO_BYPASS_LOGIN }])
          const column = await check.query(
            `SELECT 1 FROM information_schema.columns
             WHERE table_name = 'ModerationDecision' AND column_name = 'anonymized_at'`
          )
          expect(column.rowCount).toBe(0)
        } finally {
          await check.end()
        }
      } finally {
        await dropDatabase(superBase, name)
      }
    }, 120_000)

    it('[P1] D-MIG-ROLE-EXISTS migrates a second database and repairs a role that lost BYPASSRLS', async () => {
      const superBase = await resolveSuperuserUrl()
      await root.query(`ALTER ROLE ${OWNER_ROLE} NOBYPASSRLS`)
      const name = await createEmptyDatabase()
      try {
        await migrateAs(appLoginUrl(name))
        const { rows } = await root.query<{ rolbypassrls: boolean }>(
          'SELECT rolbypassrls FROM pg_roles WHERE rolname = $1',
          [OWNER_ROLE]
        )
        expect(rows).toEqual([{ rolbypassrls: true }])
      } finally {
        await root.query(`ALTER ROLE ${OWNER_ROLE} BYPASSRLS`)
        await dropDatabase(superBase, name)
      }
    }, 120_000)

    it('[P1] D-MIG-CONCURRENT finishes two real deploys on two databases in one cluster', async () => {
      const superBase = await resolveSuperuserUrl()
      const names = [await createEmptyDatabase(), await createEmptyDatabase()]
      try {
        await Promise.all(names.map((name) => migrateAs(appLoginUrl(name))))
        const { rows } = await root.query<{ set_option: boolean }>(
          `SELECT m.set_option FROM pg_auth_members m
           WHERE m.roleid = $1::regrole AND m.member = $2::regrole`,
          [OWNER_ROLE, APP_LOGIN]
        )
        expect(rows.every((entry) => entry.set_option === false)).toBe(true)
        const { Client } = await import('pg')
        for (const name of names) {
          const check = new Client({ connectionString: appLoginUrl(name) })
          await check.connect()
          try {
            const owner = await check.query<{ owner: string }>(
              `SELECT pg_get_userbyid(relowner) AS owner FROM pg_class
               WHERE oid = '"ModerationDecision"'::regclass`
            )
            expect(owner.rows).toEqual([{ owner: OWNER_ROLE }])
          } finally {
            await check.end()
          }
        }
      } finally {
        for (const name of names) await dropDatabase(superBase, name)
      }
    }, 180_000)

    it('[P1] D-MIG-RESET applies again after a reset drops public and leaves private', async () => {
      const superBase = await resolveSuperuserUrl()
      const name = await createEmptyDatabase()
      const { Client } = await import('pg')
      try {
        await migrateAs(appLoginUrl(name))
        const login = new Client({ connectionString: appLoginUrl(name) })
        await login.connect()
        try {
          await login.query('DROP SCHEMA public CASCADE')
          await login.query('CREATE SCHEMA public')
          await login.query(`
            ALTER DEFAULT PRIVILEGES IN SCHEMA public
              GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated, service_role;
          `)
        } finally {
          await login.end()
        }
        await migrateAs(appLoginUrl(name))
        const check = new Client({ connectionString: appLoginUrl(name) })
        await check.connect()
        try {
          const owner = await check.query<{ owner: string }>(
            `SELECT pg_get_userbyid(relowner) AS owner FROM pg_class
             WHERE oid = '"ModerationDecision"'::regclass`
          )
          expect(owner.rows).toEqual([{ owner: OWNER_ROLE }])
          const triggers = await check.query<{ count: string }>(
            `SELECT count(*) FROM pg_trigger
             WHERE tgrelid = '"ModerationDecision"'::regclass AND NOT tgisinternal AND tgenabled <> 'D'`
          )
          expect(triggers.rows).toEqual([{ count: '3' }])
        } finally {
          await check.end()
        }
      } finally {
        await dropDatabase(superBase, name)
      }
    }, 180_000)
  })
})
