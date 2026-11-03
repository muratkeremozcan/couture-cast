// Learning path Step 50: Moderator queue and case detail.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-50-moderator-queue-and-case-detail
// Story 6.10 test owner: no direct database client reads or writes any table a moderation read
// path touches (epics.md AC3, D-RLS-DENIED), and no client forges or reads the case-view audit log
// (D-RLS-AUDIT).
//
// The table list is not written here. The queue repository exports MODERATION_QUEUE_READ_TABLES
// and a unit test pins its SQL to that list, so a table added to a query cannot reach production
// without passing through this proof.
import { randomUUID } from 'node:crypto'
import { describe, expect } from 'vitest'
import { MODERATION_QUEUE_READ_TABLES } from '../../../../apps/api/src/modules/moderation/moderation-queue-tables.ts'
import {
  adminPool,
  buildClaims,
  scenarioTest,
  useRlsDatabase,
  withRole,
} from './harness.js'

/** Postgres `insufficient_privilege`. `anon` may also be refused at the schema first. */
const PERMISSION_DENIED = '42501'
const CLIENT_ROLES = ['anon', 'authenticated'] as const
const PRIVILEGES = [
  'SELECT',
  'INSERT',
  'UPDATE',
  'DELETE',
  'TRUNCATE',
  'REFERENCES',
  'TRIGGER',
]

describe.concurrent('moderation queue read set RLS', () => {
  useRlsDatabase()

  scenarioTest(
    'D-RLS-DENIED lists the tables the moderation routes read and none is empty or duplicated',
    async () => {
      expect(MODERATION_QUEUE_READ_TABLES.length).toBeGreaterThanOrEqual(7)
      expect(new Set(MODERATION_QUEUE_READ_TABLES).size).toBe(
        MODERATION_QUEUE_READ_TABLES.length
      )
      const client = await adminPool.connect()
      try {
        for (const table of MODERATION_QUEUE_READ_TABLES) {
          const { rows } = await client.query<{ present: boolean }>(
            'SELECT to_regclass($1) IS NOT NULL AS present',
            [`public."${table}"`]
          )
          expect(rows[0]?.present, `${table} must exist`).toBe(true)
        }
      } finally {
        client.release()
      }
    }
  )

  scenarioTest(
    'D-RLS-DENIED holds no table privilege for anon or authenticated on any table the routes read',
    async () => {
      const client = await adminPool.connect()
      try {
        for (const table of MODERATION_QUEUE_READ_TABLES)
          for (const role of CLIENT_ROLES)
            for (const privilege of PRIVILEGES) {
              const { rows } = await client.query<{ granted: boolean }>(
                'SELECT has_table_privilege($1, $2, $3) AS granted',
                [role, `public."${table}"`, privilege]
              )
              expect(rows[0]?.granted, `${role} ${privilege} on ${table}`).toBe(false)
            }
      } finally {
        client.release()
      }
    }
  )

  scenarioTest(
    'D-RLS-DENIED refuses a live SELECT, INSERT, UPDATE and DELETE from anon and authenticated',
    async ({ scenario }) => {
      for (const table of MODERATION_QUEUE_READ_TABLES)
        for (const role of CLIENT_ROLES) {
          const claims =
            role === 'anon' ? null : buildClaims(scenario.teenEmail, 'moderator')
          for (const statement of [
            `SELECT * FROM public."${table}" LIMIT 1`,
            `INSERT INTO public."${table}" DEFAULT VALUES`,
            `UPDATE public."${table}" SET id = id WHERE false`,
            `DELETE FROM public."${table}" WHERE false`,
          ])
            await withRole(role, claims, async (client) =>
              expect(
                client.query(statement),
                `${role}: ${statement}`
              ).rejects.toMatchObject({
                code: PERMISSION_DENIED,
              })
            )
        }
    }
  )

  scenarioTest(
    'D-RLS-DENIED keeps a moderator or admin claim from opening the tables: the API role is the only reader',
    async ({ scenario }) => {
      for (const claimedRole of ['moderator', 'admin'])
        for (const table of MODERATION_QUEUE_READ_TABLES)
          await withRole(
            'authenticated',
            buildClaims(scenario.teenEmail, claimedRole),
            async (client) =>
              expect(
                client.query(`SELECT * FROM public."${table}" LIMIT 1`)
              ).rejects.toMatchObject({
                code: PERMISSION_DENIED,
              })
          )
    }
  )
})

describe.concurrent('case-view audit log RLS', () => {
  scenarioTest(
    'D-RLS-AUDIT refuses a forged moderation_case_viewed row from a client',
    async ({ scenario }) => {
      for (const role of CLIENT_ROLES) {
        const claims =
          role === 'anon' ? null : buildClaims(scenario.teenEmail, 'moderator')
        await withRole(role, claims, async (client) =>
          expect(
            client.query(
              `INSERT INTO public."AuditLog" ("id", "user_id", "event_type", "event_data")
               VALUES ($1, $2, 'moderation_case_viewed', '{}'::jsonb)`,
              [randomUUID(), scenario.teenId]
            )
          ).rejects.toMatchObject({ code: PERMISSION_DENIED })
        )
      }
    }
  )

  scenarioTest(
    'D-RLS-AUDIT hides the rows from members, shows moderators only the three-key row, and freezes them',
    async ({ scenario }) => {
      // AuditLog.user_id is a RESTRICT foreign key and the rows are immutable, so this user and
      // its row stay behind on purpose. The scenario's own users are cleaned up as usual.
      const userId = `audit-user-${randomUUID()}`
      const id = `audit-${randomUUID()}`
      const admin = await adminPool.connect()
      try {
        await admin.query(
          'INSERT INTO public."User" ("id", "email", "updated_at") VALUES ($1, $2, NOW())',
          [userId, `${userId}@example.com`]
        )
        await admin.query(
          `INSERT INTO public."AuditLog" ("id", "user_id", "event_type", "event_data")
           VALUES ($1, $2, 'moderation_case_viewed', '{"caseId":"post.x","source":"post","role":"moderator"}'::jsonb)`,
          [id, userId]
        )
        const read = (email: string, claimedRole: string) =>
          withRole('authenticated', buildClaims(email, claimedRole), async (client) =>
            client.query<{ event_data: Record<string, unknown> }>(
              'SELECT "event_data" FROM public."AuditLog" WHERE "id" = $1',
              [id]
            )
          )
        for (const memberRole of ['teen', 'guardian'])
          expect(
            (await read(scenario.teenEmail, memberRole)).rows,
            memberRole
          ).toHaveLength(0)

        // The existing policy (private.is_admin_actor) lets moderator and admin claims read the
        // log. The row holds only the case id, source and role, so no case content is exposed.
        const visible = (await read(scenario.teenEmail, 'moderator')).rows
        expect(visible).toHaveLength(1)
        expect(Object.keys(visible[0]?.event_data ?? {}).sort()).toEqual([
          'caseId',
          'role',
          'source',
        ])

        for (const claimedRole of ['teen', 'moderator'])
          await withRole(
            'authenticated',
            buildClaims(scenario.teenEmail, claimedRole),
            async (client) => {
              // Row-level security leaves no UPDATE or DELETE policy, so the statement either
              // is refused or touches zero rows. Both leave the row as it was.
              for (const statement of [
                'UPDATE public."AuditLog" SET "event_type" = \'x\' WHERE "id" = $1',
                'DELETE FROM public."AuditLog" WHERE "id" = $1',
              ]) {
                const outcome = await client.query(statement, [id]).then(
                  (result) => ({ rowCount: result.rowCount }),
                  (error: { code?: string }) => ({ code: error.code })
                )
                expect([{ rowCount: 0 }, { code: PERMISSION_DENIED }]).toContainEqual(
                  outcome
                )
              }
            }
          )
        const intact = await admin.query(
          'SELECT "event_type" FROM public."AuditLog" WHERE "id" = $1',
          [id]
        )
        expect(intact.rows).toEqual([{ event_type: 'moderation_case_viewed' }])
        // Even the privileged API connection cannot rewrite or remove a row once written.
        await expect(
          admin.query(
            'UPDATE public."AuditLog" SET "event_type" = \'x\' WHERE "id" = $1',
            [id]
          )
        ).rejects.toThrow(/immutable/i)
        await expect(
          admin.query('DELETE FROM public."AuditLog" WHERE "id" = $1', [id])
        ).rejects.toThrow(/immutable/i)
      } finally {
        admin.release()
      }
    }
  )
})
