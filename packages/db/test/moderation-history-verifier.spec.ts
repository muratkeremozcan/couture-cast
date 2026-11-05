// Learning path Step 53: Immutable moderation history.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-53-immutable-moderation-history
// Story 6.13 owner: `moderation:history:verify` against real catalogs, with one injected fault per check.
// V-CLEAN-NONSUPER, V-CLEAN-SUPER, V-FAULTS, V-READ-ONLY, and the catalog half of D-RESIDUAL-SCHEMA-OWNER.
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Client } from 'pg'
import {
  APP_LOGIN,
  canReachDatabase,
  createEmptySuperuserDatabase,
  createHistoryDatabase,
  dropDatabase,
  type HistoryDatabase,
  migrateAs,
  OWNER_ROLE,
  resolveSuperuserUrl,
} from './support/moderation-history-database.js'

const run = promisify(execFile)
const repoRoot = fileURLToPath(new URL('../../..', import.meta.url))
const TABLE = '"ModerationDecision"'
const FUNCTION = 'private.moderation_history_anonymize(text)'
const MEMBER_LOGIN = 'moderation_probe_member'

async function verify(
  url: string
): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await run(
      'npx',
      ['--no-install', 'tsx', 'scripts/verify-moderation-history.mjs'],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          DATABASE_URL: url,
          NODE_OPTIONS: '--conditions=development',
        },
      }
    )
    return { code: 0, stdout, stderr }
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string }
    return {
      code: failure.code ?? -1,
      stdout: failure.stdout ?? '',
      stderr: failure.stderr ?? '',
    }
  }
}

const failedChecks = (stdout: string) =>
  stdout
    .split('\n')
    .filter((line) => line.startsWith('FAIL '))
    .map((line) => line.slice(5).trim())

const reachable = await canReachDatabase()
const automated = process.env.CI === 'true' || process.env.CI === '1'

describe.runIf(reachable || automated)('moderation:history:verify', () => {
  let database: HistoryDatabase
  let root: Client

  beforeAll(async () => {
    if (!reachable)
      throw new Error(
        'CI is set and the test database is unreachable, so 6.13 stays unproven.'
      )
    database = await createHistoryDatabase()
    root = await database.superuser()
    await root.query(
      `DO $$ BEGIN
         IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${MEMBER_LOGIN}') THEN
           CREATE ROLE ${MEMBER_LOGIN} LOGIN;
         END IF;
       END $$`
    )
    // A run killed inside V-FAULTS leaves its grant, and the role outlives the database.
    await root.query(`REVOKE ${OWNER_ROLE} FROM ${MEMBER_LOGIN}`)
  }, 180_000)

  afterAll(async () => {
    await root?.end().catch(() => undefined)
    await database?.drop()
  })

  it('[P0] V-CLEAN-NONSUPER exits 0 as the non-superuser application role', async () => {
    const result = await verify(database.appUrl)
    expect(result.stderr).toBe('')
    expect(failedChecks(result.stdout)).toEqual([])
    expect(result.code).toBe(0)
  }, 60_000)

  it('[P0] V-CLEAN-SUPER exits 0 as a superuser that migrated the database', async () => {
    const superBase = await resolveSuperuserUrl()
    const { name, url } = await createEmptySuperuserDatabase()
    try {
      await migrateAs(url)
      const result = await verify(url)
      expect(failedChecks(result.stdout)).toEqual([])
      expect(result.code).toBe(0)
    } finally {
      await dropDatabase(superBase, name)
    }
  }, 180_000)

  describe('[P0] V-FAULTS', () => {
    const triggerSql = (name: string, timing: string, scope: string) =>
      `CREATE TRIGGER ${name} BEFORE ${timing} ON ${TABLE} FOR EACH ${scope}
       EXECUTE FUNCTION private.moderation_history_guard()`

    it.each<[string, string, string, string]>([
      [
        'a login granted SET on the owner',
        'no_login_member',
        `GRANT ${OWNER_ROLE} TO ${MEMBER_LOGIN} WITH SET TRUE, INHERIT FALSE`,
        `REVOKE ${OWNER_ROLE} FROM ${MEMBER_LOGIN}`,
      ],
      [
        'a login granted INHERIT on the owner',
        'no_login_member',
        `GRANT ${OWNER_ROLE} TO ${MEMBER_LOGIN} WITH SET FALSE, INHERIT TRUE`,
        `REVOKE ${OWNER_ROLE} FROM ${MEMBER_LOGIN}`,
      ],
      [
        'the update trigger disabled',
        'trigger_update',
        `ALTER TABLE ${TABLE} DISABLE TRIGGER moderation_decision_block_update`,
        `ALTER TABLE ${TABLE} ENABLE TRIGGER moderation_decision_block_update`,
      ],
      [
        'the delete trigger disabled',
        'trigger_delete',
        `ALTER TABLE ${TABLE} DISABLE TRIGGER moderation_decision_block_delete`,
        `ALTER TABLE ${TABLE} ENABLE TRIGGER moderation_decision_block_delete`,
      ],
      [
        'the truncate trigger disabled',
        'trigger_truncate',
        `ALTER TABLE ${TABLE} DISABLE TRIGGER moderation_decision_block_truncate`,
        `ALTER TABLE ${TABLE} ENABLE TRIGGER moderation_decision_block_truncate`,
      ],
      [
        'the update trigger dropped',
        'trigger_update',
        `DROP TRIGGER moderation_decision_block_update ON ${TABLE}`,
        triggerSql('moderation_decision_block_update', 'UPDATE', 'ROW'),
      ],
      [
        'the delete trigger dropped',
        'trigger_delete',
        `DROP TRIGGER moderation_decision_block_delete ON ${TABLE}`,
        triggerSql('moderation_decision_block_delete', 'DELETE', 'ROW'),
      ],
      [
        'the truncate trigger dropped',
        'trigger_truncate',
        `DROP TRIGGER moderation_decision_block_truncate ON ${TABLE}`,
        triggerSql('moderation_decision_block_truncate', 'TRUNCATE', 'STATEMENT'),
      ],
      [
        'UPDATE granted to the application role',
        'connecting_role_grants',
        `GRANT UPDATE ON ${TABLE} TO ${APP_LOGIN}`,
        `REVOKE UPDATE ON ${TABLE} FROM ${APP_LOGIN}`,
      ],
      [
        'DELETE granted to the application role',
        'connecting_role_grants',
        `GRANT DELETE ON ${TABLE} TO ${APP_LOGIN}`,
        `REVOKE DELETE ON ${TABLE} FROM ${APP_LOGIN}`,
      ],
      [
        'TRUNCATE granted to the application role',
        'connecting_role_grants',
        `GRANT TRUNCATE ON ${TABLE} TO ${APP_LOGIN}`,
        `REVOKE TRUNCATE ON ${TABLE} FROM ${APP_LOGIN}`,
      ],
      [
        'SELECT granted to anon',
        'no_other_grantee',
        `GRANT SELECT ON ${TABLE} TO anon`,
        `REVOKE ALL ON ${TABLE} FROM anon`,
      ],
      [
        'SELECT granted to authenticated',
        'no_other_grantee',
        `GRANT SELECT ON ${TABLE} TO authenticated`,
        `REVOKE ALL ON ${TABLE} FROM authenticated`,
      ],
      [
        'SELECT granted to service_role',
        'no_other_grantee',
        `GRANT SELECT ON ${TABLE} TO service_role`,
        `REVOKE ALL ON ${TABLE} FROM service_role`,
      ],
      [
        'SELECT granted to PUBLIC',
        'no_other_grantee',
        `GRANT SELECT ON ${TABLE} TO PUBLIC`,
        `REVOKE ALL ON ${TABLE} FROM PUBLIC`,
      ],
      [
        'EXECUTE granted to PUBLIC',
        'function_execute',
        `GRANT EXECUTE ON FUNCTION ${FUNCTION} TO PUBLIC`,
        `REVOKE ALL ON FUNCTION ${FUNCTION} FROM PUBLIC`,
      ],
      [
        'EXECUTE granted to service_role',
        'function_execute',
        `GRANT EXECUTE ON FUNCTION ${FUNCTION} TO service_role`,
        `REVOKE ALL ON FUNCTION ${FUNCTION} FROM service_role`,
      ],
      [
        'the function owner changed',
        'function_owner',
        `ALTER FUNCTION ${FUNCTION} OWNER TO ${APP_LOGIN}`,
        `ALTER FUNCTION ${FUNCTION} OWNER TO ${OWNER_ROLE}`,
      ],
      [
        'the function made invoker',
        'function_definer',
        `ALTER FUNCTION ${FUNCTION} SECURITY INVOKER`,
        `ALTER FUNCTION ${FUNCTION} SECURITY DEFINER`,
      ],
      [
        'the function search path dropped',
        'function_definer',
        `ALTER FUNCTION ${FUNCTION} RESET search_path`,
        `ALTER FUNCTION ${FUNCTION} SET search_path = pg_catalog, pg_temp`,
      ],
      [
        'CREATE left on public',
        'public_create_revoked',
        `GRANT CREATE ON SCHEMA public TO ${OWNER_ROLE}`,
        `REVOKE CREATE ON SCHEMA public FROM ${OWNER_ROLE}`,
      ],
      [
        'CREATE left on private',
        'private_create_revoked',
        `GRANT CREATE ON SCHEMA private TO ${OWNER_ROLE}`,
        `REVOKE CREATE ON SCHEMA private FROM ${OWNER_ROLE}`,
      ],
      [
        'the owner role lost BYPASSRLS',
        'owner_role_attributes',
        `ALTER ROLE ${OWNER_ROLE} NOBYPASSRLS`,
        `ALTER ROLE ${OWNER_ROLE} BYPASSRLS`,
      ],
      [
        'the application role lost BYPASSRLS',
        'connecting_role_reads_past_rls',
        `ALTER ROLE ${APP_LOGIN} NOBYPASSRLS`,
        `ALTER ROLE ${APP_LOGIN} BYPASSRLS`,
      ],
      [
        'the table renamed away',
        'table_present',
        `ALTER TABLE ${TABLE} RENAME TO moderation_decision_moved`,
        `ALTER TABLE moderation_decision_moved RENAME TO ${TABLE}`,
      ],
    ])(
      'flags %s as %s, and prints no row data',
      async (_name, check, inject, restore) => {
        await root.query(inject)
        try {
          const result = await verify(database.appUrl)
          expect(result.code).toBe(1)
          expect(failedChecks(result.stdout)).toContain(check)
          for (const line of result.stdout.trim().split('\n'))
            expect(line).toMatch(/^(ok {2}|FAIL) [a-z_]+$/)
        } finally {
          await root.query(restore)
        }
        const clean = await verify(database.appUrl)
        expect(failedChecks(clean.stdout)).toEqual([])
      },
      60_000
    )

    it('flags a changed table owner', async () => {
      await root.query(`ALTER TABLE ${TABLE} OWNER TO ${APP_LOGIN}`)
      try {
        const result = await verify(database.appUrl)
        expect(result.code).toBe(1)
        expect(failedChecks(result.stdout)).toContain('table_owner')
      } finally {
        await root.query(`ALTER TABLE ${TABLE} OWNER TO ${OWNER_ROLE}`)
        await root.query(`REVOKE ALL ON ${TABLE} FROM ${APP_LOGIN}`)
        await root.query(`GRANT SELECT, INSERT ON ${TABLE} TO ${APP_LOGIN}`)
      }
      expect(failedChecks((await verify(database.appUrl)).stdout)).toEqual([])
    }, 60_000)
  })

  it('[P1] D-RESIDUAL-SCHEMA-OWNER shows what the application role can do as schema owner', async () => {
    const other = await createHistoryDatabase()
    const app = await other.app()
    try {
      await app.query('DROP FUNCTION private.moderation_history_guard() CASCADE')
      const dropped = await verify(other.appUrl)
      expect(dropped.code).toBe(1)
      expect(failedChecks(dropped.stdout)).toEqual(
        expect.arrayContaining(['trigger_update', 'trigger_delete', 'trigger_truncate'])
      )
      await app.query(`DROP TABLE ${TABLE} CASCADE`)
      await app.query(`CREATE TABLE ${TABLE} (id text)`)
      const replaced = await verify(other.appUrl)
      expect(replaced.code).toBe(1)
      expect(failedChecks(replaced.stdout)).toContain('table_owner')
    } finally {
      await app.end()
      await other.drop()
    }
  }, 180_000)

  it('[P1] V-READ-ONLY sends only catalog reads', async () => {
    const { MODERATION_HISTORY_ENFORCEMENT_CHECKS } = await import(
      '../../../apps/api/src/modules/moderation/moderation-history.enforcement.js'
    )
    expect(MODERATION_HISTORY_ENFORCEMENT_CHECKS.length).toBeGreaterThan(10)
    for (const { sql } of MODERATION_HISTORY_ENFORCEMENT_CHECKS) {
      expect(sql.trim()).toMatch(/^SELECT\b/)
      // Privilege names are data here, so only the statement text outside literals counts.
      const statement = sql.replace(/'[^']*'/g, "''")
      expect(statement).not.toMatch(
        /\b(INSERT|UPDATE|DELETE|TRUNCATE|ALTER|GRANT|REVOKE|DROP)\b/
      )
      expect(sql).not.toMatch(/FROM\s+"(?!ModerationDecision)/)
    }
  })

  it('[P1] V-READ-ONLY names only closed checks when it cannot connect', async () => {
    const result = await verify('postgresql://nobody:secret-password@127.0.0.1:1/none')
    expect(result.code).toBe(2)
    expect(result.stdout + result.stderr).not.toContain('secret-password')
    expect(result.stdout + result.stderr).not.toContain('nobody')
  }, 60_000)
})
