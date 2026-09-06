// The category contract every other file in this directory reads from: which tables
// are guardian-shared, which are owner-only, and which are worker-only. A table that
// lands in the wrong array here fails as a matrix gap in one of the sibling files.
import { describe, expect, it } from 'vitest'
import {
  adminPool,
  guardianSharedTables,
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

      for (const tableName of guardianSharedTables) {
        expect(policyMap.get(tableName)).toEqual(
          new Set([
            'authenticated_read_shared_user_data',
            'authenticated_insert_shared_user_data',
            'authenticated_update_shared_user_data',
            'authenticated_delete_shared_user_data',
          ])
        )
      }

      for (const tableName of selfOnlyTables) {
        expect(policyMap.get(tableName)).toEqual(
          new Set([
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
