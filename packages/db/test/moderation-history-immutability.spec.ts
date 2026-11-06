// Learning path Step 53: Immutable moderation history.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-53-immutable-moderation-history
// Story 6.13 owner: the database proof for immutable moderation history. Every statement that must be
// refused runs as a login with the application role's attributes, on a database that login migrated,
// because a superuser skips the privilege layer. Row comparison reads `xmin` too, so a rewrite that
// restores the same values still fails.
import { randomUUID } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import type { Client } from 'pg'
import {
  APP_LOGIN,
  OWNER_ROLE,
  inRollback,
  sqlState,
  takeGuard,
  type HistoryDatabase,
} from './support/moderation-history-database.js'
import {
  enforcementRuns,
  useEnforcementDatabase,
  PERMISSION_DENIED,
  ERASED,
  DECIDED_AT,
} from './support/moderation-history-fixture.js'

describe.runIf(enforcementRuns)('moderation history enforcement', () => {
  const fixture = useEnforcementDatabase()
  const { uniqueId, member, post, decision, committed, rawRow, row } = fixture
  let database: HistoryDatabase
  let app: Client
  let root: Client
  beforeAll(() => {
    ;({ database, app, root } = fixture.live())
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
        // The message names the layer: the guard raises the same SQLSTATE, so the code alone cannot
        // tell a refused privilege from a trigger on an image that keeps its triggers on.
        for (const statement of [
          'UPDATE "ModerationDecision" SET reason = \'x\'',
          'DELETE FROM "ModerationDecision"',
          'TRUNCATE "ModerationDecision"',
        ]) {
          await app.query('SAVEPOINT refused')
          await expect(app.query(statement)).rejects.toThrow(
            /^permission denied for table/
          )
          await app.query('ROLLBACK TO SAVEPOINT refused')
        }
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
      await committed(app, async () => {
        await takeGuard(app, subject)
        await app.query('DELETE FROM "User" WHERE id = $1', [subject])
      })
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
      await committed(app, async () => {
        await takeGuard(app, moderator)
        await app.query('DELETE FROM "User" WHERE id = $1', [moderator])
      })
      const after = await row(id)
      expect(after.moderator_id).toBeNull()
      expect(others(after, 'moderator_id')).toEqual(others(before, 'moderator_id'))
    })

    it('[P0] D-EX-FK-TARGET nulls the post and leaves every other column', async () => {
      const author = await member('author')
      const postId = await post(author)
      const id = await decision({ post: postId })
      const before = await row(id)
      await committed(app, async () => {
        await app.query(
          'SELECT community_privacy_guards(ARRAY[]::text[], ARRAY[$1], true)',
          [postId]
        )
        await app.query('DELETE FROM "LookbookPost" WHERE id = $1', [postId])
      })
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
      // On the application role the privilege refuses first, so only the superuser reaches the guard.
      for (const client of [app, root]) {
        const state = await inRollback(client, async () => {
          await client.query(
            "SELECT set_config('moderation.history.exception', 'on', true)"
          )
          await client.query(`SELECT set_config('app.role', '${OWNER_ROLE}', true)`)
          return sqlState(
            client,
            'UPDATE "ModerationDecision" SET reason = \'x\' WHERE id = $1',
            [id]
          )
        })
        expect(state).toBe(PERMISSION_DENIED)
      }
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
})
