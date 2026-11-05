// Story 6.13 owner: the catalog checks behind `npm run moderation:history:verify` and the daily drift log, in `apps/api/src/modules/moderation/moderation-history.enforcement.ts`.
// This file has no imports on purpose: the script runs it through `tsx`, and the community worker image bundles it.

const OWNER = 'moderation_history_owner'
const TABLE = 'to_regclass(\'public."ModerationDecision"\')'

/** The table's ACL as rows. Read from `relacl` because `has_table_privilege` answers true for a superuser. */
const tableAcl = `
  SELECT acl.grantee, acl.privilege_type
  FROM pg_catalog.pg_class c
  CROSS JOIN LATERAL pg_catalog.aclexplode(coalesce(c.relacl, pg_catalog.acldefault('r', c.relowner))) AS acl
  WHERE c.oid = ${TABLE}`

const functionRow = (name: string) => `
  SELECT p.*
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'private' AND p.proname = '${name}'`

const triggerEnabled = (name: string, type: string) => `
  SELECT EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger t
    JOIN pg_catalog.pg_proc p ON p.oid = t.tgfoid
    WHERE t.tgrelid = ${TABLE}
      AND t.tgname = '${name}'
      AND t.tgenabled = 'O'
      AND p.proname = 'moderation_history_guard'
      AND (t.tgtype::int & ${type}) <> 0
  ) AS ok`

const schemaWithoutCreate = (schema: string) => `
  SELECT NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_namespace n
    CROSS JOIN LATERAL pg_catalog.aclexplode(n.nspacl) AS acl
    WHERE n.nspname = '${schema}'
      AND acl.privilege_type = 'CREATE'
      AND acl.grantee = (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = '${OWNER}')
  ) AS ok`

/**
 * One closed name per fact, each query answering one boolean `ok`. Every statement reads the catalog,
 * and the output holds names only, so a run can go in any log.
 */
export const MODERATION_HISTORY_ENFORCEMENT_CHECKS = Object.freeze([
  {
    name: 'table_present',
    sql: `SELECT ${TABLE} IS NOT NULL AS ok`,
  },
  {
    name: 'table_owner',
    sql: `SELECT EXISTS (
      SELECT 1 FROM pg_catalog.pg_class c
      WHERE c.oid = ${TABLE} AND pg_catalog.pg_get_userbyid(c.relowner) = '${OWNER}'
    ) AS ok`,
  },
  {
    name: 'owner_role_attributes',
    sql: `SELECT EXISTS (
      SELECT 1 FROM pg_catalog.pg_roles
      WHERE rolname = '${OWNER}' AND NOT rolcanlogin AND rolbypassrls
        AND NOT rolsuper AND NOT rolcreaterole AND NOT rolcreatedb
    ) AS ok`,
  },
  {
    name: 'no_login_member',
    sql: `SELECT NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_auth_members m
      JOIN pg_catalog.pg_roles r ON r.oid = m.member
      WHERE m.roleid = (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = '${OWNER}')
        AND (m.set_option OR m.inherit_option)
    ) AS ok`,
  },
  {
    name: 'trigger_update',
    sql: triggerEnabled('moderation_decision_block_update', '16'),
  },
  {
    name: 'trigger_delete',
    sql: triggerEnabled('moderation_decision_block_delete', '8'),
  },
  {
    name: 'trigger_truncate',
    sql: triggerEnabled('moderation_decision_block_truncate', '32'),
  },
  {
    name: 'connecting_role_grants',
    sql: `SELECT coalesce(
      (SELECT array_agg(a.privilege_type::text ORDER BY a.privilege_type::text)
       FROM (${tableAcl}) a
       WHERE a.grantee = (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = current_user)
         AND current_user <> '${OWNER}'),
      ARRAY[]::text[]
    ) = ARRAY['INSERT', 'SELECT'] AS ok`,
  },
  {
    name: 'no_other_grantee',
    sql: `SELECT NOT EXISTS (
      SELECT 1 FROM (${tableAcl}) a
      WHERE a.grantee NOT IN (
        SELECT oid FROM pg_catalog.pg_roles WHERE rolname IN ('${OWNER}', current_user)
      )
    ) AS ok`,
  },
  {
    name: 'connecting_role_reads_past_rls',
    sql: `SELECT EXISTS (
      SELECT 1 FROM pg_catalog.pg_roles
      WHERE rolname = current_user AND (rolsuper OR rolbypassrls)
    ) AS ok`,
  },
  {
    name: 'function_owner',
    sql: `SELECT count(*) = 3 AND bool_and(pg_catalog.pg_get_userbyid(f.proowner) = '${OWNER}') AS ok
      FROM pg_catalog.pg_proc f
      JOIN pg_catalog.pg_namespace n ON n.oid = f.pronamespace
      WHERE n.nspname = 'private'
        AND f.proname IN (
          'moderation_history_guard',
          'moderation_history_require_guard',
          'moderation_history_anonymize'
        )`,
  },
  {
    name: 'function_definer',
    sql: `SELECT coalesce(bool_and(
        f.prosecdef AND f.proconfig @> ARRAY['search_path=pg_catalog, pg_temp']
      ), false) AS ok
      FROM (${functionRow('moderation_history_anonymize')}) f`,
  },
  {
    name: 'function_execute',
    sql: `SELECT NOT EXISTS (
      SELECT 1 FROM (${functionRow('moderation_history_anonymize')}) f
      CROSS JOIN LATERAL pg_catalog.aclexplode(coalesce(f.proacl, pg_catalog.acldefault('f', f.proowner))) AS acl
      WHERE acl.grantee NOT IN (
        SELECT oid FROM pg_catalog.pg_roles WHERE rolname IN ('${OWNER}', current_user)
      )
    ) AS ok`,
  },
  {
    // The other half of the check above: without this grant every erasure fails while the rest stays green.
    name: 'function_execute_granted',
    sql: `SELECT coalesce((
      SELECT pg_catalog.has_function_privilege(current_user, f.oid, 'EXECUTE')
      FROM (${functionRow('moderation_history_anonymize')}) f
    ), false) AS ok`,
  },
  { name: 'public_create_revoked', sql: schemaWithoutCreate('public') },
  { name: 'private_create_revoked', sql: schemaWithoutCreate('private') },
] as const)

export type ModerationHistoryEnforcementCheck =
  (typeof MODERATION_HISTORY_ENFORCEMENT_CHECKS)[number]['name']

/** Runs every check on the caller's connection and returns the names that failed. */
export async function failedModerationHistoryChecks(
  query: (sql: string) => Promise<readonly { ok: boolean | null }[]>
): Promise<ModerationHistoryEnforcementCheck[]> {
  const failed: ModerationHistoryEnforcementCheck[] = []
  for (const check of MODERATION_HISTORY_ENFORCEMENT_CHECKS) {
    const rows = await query(check.sql)
    if (rows[0]?.ok !== true) failed.push(check.name)
  }
  return failed
}
