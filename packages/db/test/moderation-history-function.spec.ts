// Learning path Step 53: Immutable moderation history.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-53-immutable-moderation-history
// Story 6.13 owner: the one path that may change a decision row, and the role and grants around it.
import { randomUUID } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import type { Client } from 'pg'
import {
  APP_LOGIN,
  OWNER_ROLE,
  inRollback,
  sqlState,
  takeGuard,
} from './support/moderation-history-database.js'
import {
  enforcementRuns,
  useEnforcementDatabase,
  PERMISSION_DENIED,
  GUARD_REQUIRED,
  ERASED,
} from './support/moderation-history-fixture.js'

describe.runIf(enforcementRuns)('moderation history exception function and role', () => {
  const fixture = useEnforcementDatabase()
  const {
    uniqueId,
    member,
    erasureRequest,
    postReport,
    commentReport,
    decision,
    rawRow,
    row,
  } = fixture
  let app: Client
  let root: Client
  beforeAll(() => {
    ;({ app, root } = fixture.live())
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
})
