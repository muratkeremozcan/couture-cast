// Learning path Step 53: Immutable moderation history.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-53-immutable-moderation-history
// Story 6.13 owner: the migration itself, as the login that runs it, on one database and on two.
// D-MIG-ROLE-EXISTS moves a cluster-wide role, which is safe because this workspace runs one file at a time.
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { Client } from 'pg'
import {
  appLoginUrl,
  createEmptyDatabase,
  dropDatabase,
  APP_LOGIN,
  migrateAs,
  NO_BYPASS_LOGIN,
  OWNER_ROLE,
  resolveSuperuserUrl,
  type HistoryDatabase,
} from './support/moderation-history-database.js'
import {
  enforcementRuns,
  useEnforcementDatabase,
} from './support/moderation-history-fixture.js'

describe.runIf(enforcementRuns)('moderation history migration', () => {
  const fixture = useEnforcementDatabase()
  let database: HistoryDatabase
  let app: Client
  let root: Client
  beforeAll(() => {
    ;({ database, app, root } = fixture.live())
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

    it('[P1] D-MIG-ROLE-RACE lets the second of two first deploys pass a role created under it', async () => {
      // The cluster role already exists here, so the real migrations above never reach this path. The
      // statement is the shipped one with another name, and the order is forced: the second session
      // has already passed `IF NOT EXISTS` when the first commits.
      const race = `mh_race_${randomUUID().replaceAll('-', '').slice(0, 16)}`
      const migration = readFileSync(
        fileURLToPath(
          new URL(
            '../prisma/migrations/20261105150000_immutable_moderation_history/migration.sql',
            import.meta.url
          )
        ),
        'utf8'
      )
      const statement = /DO \$\$\s*BEGIN\s*IF NOT EXISTS[\s\S]*?END \$\$;/.exec(
        migration
      )?.[0]
      expect(statement).toContain('duplicate_object')
      const create = statement!.replaceAll(OWNER_ROLE, race)
      const first = await database.app()
      const second = await database.app()
      try {
        await first.query('BEGIN')
        await first.query(create)
        const waiting = second.query(create)
        await vi.waitFor(
          async () => {
            const { rows } = await root.query<{ blocked: number }>(
              `SELECT count(*)::int AS blocked FROM pg_stat_activity
               WHERE datname = current_database() AND wait_event_type = 'Lock'`
            )
            expect(rows[0]!.blocked).toBeGreaterThan(0)
          },
          { timeout: 15_000, interval: 25 }
        )
        await first.query('COMMIT')
        await expect(waiting).resolves.toBeDefined()
        const { rows } = await root.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [
          race,
        ])
        expect(rows).toHaveLength(1)
      } finally {
        await first.query('ROLLBACK').catch(() => undefined)
        await first.end()
        await second.end()
        await root.query(`DROP ROLE IF EXISTS ${race}`)
      }
    }, 60_000)

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
