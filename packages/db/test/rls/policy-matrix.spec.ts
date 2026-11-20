// The category contract every other file in this directory reads from: which tables
// are guardian-shared, which are owner-only, and which are worker-only. A table that
// lands in the wrong array here fails as a matrix gap in one of the sibling files.
// Learning path Step 58: Image uploads straight to storage.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#image-uploads-straight-to-storage
import { describe, expect, it } from 'vitest'
import {
  adminPool,
  guardianSharedTables,
  memberReadOnlyTables,
  memberWritePrivileges,
  ownerOrGlobalReadTables,
  selfOnlyTables,
  useRlsDatabase,
  workerOnlyTables,
} from './harness.js'

describe.concurrent('guardian-aware RLS policies', () => {
  useRlsDatabase()

  it('enables RLS and installs the expected policy sets', async () => {
    const targetTables = [
      ...guardianSharedTables,
      ...selfOnlyTables,
      ...ownerOrGlobalReadTables,
      'GuardianConsent',
      'telemetry_events',
    ]
    const client = await adminPool.connect()

    try {
      const rlsState = await client.query<{
        table_name: string
        rls_enabled: boolean
      }>(
        `SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled
         FROM pg_class AS c
         INNER JOIN pg_namespace AS n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public'
           AND c.relname = ANY($1::text[])`,
        [targetTables]
      )

      expect(rlsState.rows).toHaveLength(targetTables.length)
      expect(rlsState.rows.every((row) => row.rls_enabled)).toBe(true)

      const policies = await client.query<{
        table_name: string
        policy_name: string
      }>(
        `SELECT tablename AS table_name, policyname AS policy_name
         FROM pg_policies
         WHERE schemaname = 'public'
           AND tablename = ANY($1::text[])`,
        [targetTables]
      )

      const policyMap = new Map<string, Set<string>>()

      for (const row of policies.rows) {
        const existing = policyMap.get(row.table_name) ?? new Set<string>()
        existing.add(row.policy_name)
        policyMap.set(row.table_name, existing)
      }

      const readOnly = new Set<string>(memberReadOnlyTables)

      for (const tableName of guardianSharedTables) {
        expect(policyMap.get(tableName), tableName).toEqual(
          readOnly.has(tableName)
            ? new Set(['authenticated_read_shared_user_data'])
            : new Set([
                'authenticated_read_shared_user_data',
                'authenticated_insert_shared_user_data',
                'authenticated_update_shared_user_data',
                'authenticated_delete_shared_user_data',
              ])
        )
      }

      for (const tableName of selfOnlyTables) {
        expect(policyMap.get(tableName), tableName).toEqual(
          readOnly.has(tableName)
            ? new Set(['authenticated_read_own_user_data'])
            : new Set([
                'authenticated_read_own_user_data',
                'authenticated_insert_own_user_data',
                'authenticated_update_own_user_data',
                'authenticated_delete_own_user_data',
              ])
        )
      }

      expect(policyMap.get('EventEnvelope')).toEqual(
        new Set(['authenticated_read_own_or_global_events'])
      )

      expect(policyMap.get('GuardianConsent')).toEqual(
        new Set(['authenticated_read_guardian_consent'])
      )

      expect(policyMap.get('telemetry_events')).toEqual(
        new Set([
          'authenticated_read_own_telemetry',
          'authenticated_insert_telemetry',
          'service_role_insert_telemetry',
        ])
      )
    } finally {
      client.release()
    }
  })

  // Production follow-up 2026-11-19: these rows hold the storage paths the API's service role
  // reads, moves and deletes, so no client role may write them at all.
  it('grants no client role a write on the member read-only wardrobe tables', async () => {
    const client = await adminPool.connect()

    try {
      const grants = await client.query<{
        grantee: string
        table_name: string
        privilege_type: string
      }>(
        `SELECT grantee, table_name, privilege_type
         FROM information_schema.role_table_grants
         WHERE table_schema = 'public'
           AND table_name = ANY($1::text[])
           AND grantee = ANY($2::text[])
           AND privilege_type = ANY($3::text[])`,
        [memberReadOnlyTables, ['anon', 'authenticated'], memberWritePrivileges]
      )
      expect(grants.rows).toEqual([])

      const reads = await client.query<{ table_name: string }>(
        `SELECT table_name
         FROM information_schema.role_table_grants
         WHERE table_schema = 'public'
           AND table_name = ANY($1::text[])
           AND grantee = 'authenticated'
           AND privilege_type = 'SELECT'
         ORDER BY table_name`,
        [memberReadOnlyTables]
      )
      expect(reads.rows.map((row) => row.table_name)).toEqual(
        [...memberReadOnlyTables].sort()
      )

      // The catalog query above sees only grants naming the role. Effective privileges also
      // come through PUBLIC and inherited roles, and TRUNCATE has no row policy to stop it, so
      // ask Postgres what each client role can actually do.
      const effective = await client.query<{
        role: string
        table_name: string
        privilege: string
        held: boolean
      }>(
        `SELECT r.role, t.table_name, p.privilege,
                has_table_privilege(r.role, format('public.%I', t.table_name), p.privilege) AS held
         FROM unnest($1::text[]) AS t(table_name)
         CROSS JOIN unnest($2::text[]) AS r(role)
         CROSS JOIN unnest($3::text[]) AS p(privilege)
         ORDER BY 1, 2, 3`,
        [
          memberReadOnlyTables,
          ['anon', 'authenticated'],
          [...memberWritePrivileges, 'SELECT'],
        ]
      )
      expect(effective.rows).toHaveLength(memberReadOnlyTables.length * 2 * 5)
      for (const row of effective.rows) {
        const expected = row.role === 'authenticated' && row.privilege === 'SELECT'
        expect(row.held, `${row.role} ${row.privilege} on ${row.table_name}`).toBe(
          expected
        )
      }
    } finally {
      client.release()
    }
  })

  it('keeps worker-only tables unreachable from every client role', async () => {
    // RLS on, zero policies, zero grants to anon and authenticated. All three
    // are needed: a grant with no policy denies by default only while RLS is
    // enabled, and hosted Supabase provisioning normally grants ALL on public
    // tables to both client roles, so an un-enabled table there is wide open
    // even though the same table looks closed against local Supabase, which
    // ships no such default ACL.
    //
    // Story 6.1 put the entire community surface in this category rather than
    // giving LookbookPost a published-read policy; see the comment on
    // `workerOnlyTables` in harness.ts for why no row-level predicate can do
    // that job.
    const privateTables = workerOnlyTables
    const client = await adminPool.connect()

    try {
      const rlsState = await client.query<{
        table_name: string
        rls_enabled: boolean
      }>(
        `SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled
         FROM pg_class AS c
         INNER JOIN pg_namespace AS n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public'
           AND c.relname = ANY($1::text[])`,
        [privateTables]
      )

      expect(rlsState.rows).toHaveLength(privateTables.length)
      expect(rlsState.rows.every((row) => row.rls_enabled)).toBe(true)

      const policies = await client.query(
        `SELECT policyname
         FROM pg_policies
         WHERE schemaname = 'public'
           AND tablename = ANY($1::text[])`,
        [privateTables]
      )
      expect(policies.rows).toEqual([])

      const clientGrants = await client.query(
        `SELECT grantee, table_name, privilege_type
         FROM information_schema.role_table_grants
         WHERE table_schema = 'public'
           AND table_name = ANY($1::text[])
           AND grantee = ANY($2::text[])`,
        [privateTables, ['anon', 'authenticated']]
      )
      expect(clientGrants.rows).toEqual([])
    } finally {
      client.release()
    }
  })
})
