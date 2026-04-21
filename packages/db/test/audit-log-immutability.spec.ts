import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Pool, type PoolClient } from 'pg'

const databaseUrl =
  process.env.RLS_TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

const adminPool = new Pool({
  connectionString: databaseUrl,
  max: 2,
})

describe.sequential('audit log immutability', () => {
  beforeAll(async () => {
    let client: PoolClient | undefined

    try {
      client = await adminPool.connect()
      await client.query('SELECT 1 FROM public."AuditLog" LIMIT 1')
    } catch (error) {
      throw new Error(
        'Audit log immutability tests require a migrated target database. Run `npx prisma migrate deploy --schema packages/db/prisma/schema.prisma` against the DB before running this suite.',
        { cause: error }
      )
    } finally {
      client?.release()
    }
  })

  afterAll(async () => {
    await adminPool.end()
  })

  it('enables RLS with an admin-only read policy and no authenticated mutation policies', async () => {
    const client = await adminPool.connect()

    try {
      const [rlsState, policies] = await Promise.all([
        client.query<{
          rls_enabled: boolean
          rls_forced: boolean
        }>(
          `SELECT c.relrowsecurity AS rls_enabled, c.relforcerowsecurity AS rls_forced
           FROM pg_class AS c
           INNER JOIN pg_namespace AS n ON n.oid = c.relnamespace
           WHERE n.nspname = 'public'
             AND c.relname = 'AuditLog'`
        ),
        client.query<{
          policy_name: string
          command: string
        }>(
          `SELECT policyname AS policy_name, cmd AS command
           FROM pg_policies
           WHERE schemaname = 'public'
             AND tablename = 'AuditLog'`
        ),
      ])

      expect(rlsState.rows).toEqual([{ rls_enabled: true, rls_forced: true }])
      expect(policies.rows).toEqual([
        {
          policy_name: 'authenticated_read_audit_log',
          command: 'SELECT',
        },
      ])
    } finally {
      client.release()
    }
  })

  it('blocks direct UPDATE and DELETE statements against persisted audit rows', async () => {
    const client = await adminPool.connect()
    const suffix = randomUUID()
    const userId = `audit-user-${suffix}`
    const logId = `audit-log-${suffix}`

    try {
      await client.query('BEGIN')
      await client.query(
        'INSERT INTO public."User" ("id", "email", "updated_at") VALUES ($1, $2, NOW())',
        [userId, `${userId}@example.com`]
      )
      await client.query(
        `INSERT INTO public."AuditLog"
          ("id", "user_id", "event_type", "event_data", "timestamp", "ip_address")
         VALUES ($1, $2, $3, $4::jsonb, NOW(), $5)`,
        [
          logId,
          userId,
          'consent_granted',
          JSON.stringify({
            guardian_id: 'guardian-audit-spec',
            teen_id: userId,
            ip_address: '203.0.113.200',
            timestamp: new Date().toISOString(),
          }),
          '203.0.113.200',
        ]
      )

      await client.query('SAVEPOINT audit_before_update')
      await expect(
        client.query('UPDATE public."AuditLog" SET "event_type" = $1 WHERE "id" = $2', [
          'consent_revoked',
          logId,
        ])
      ).rejects.toMatchObject({
        code: '42501',
      })
      await client.query('ROLLBACK TO SAVEPOINT audit_before_update')

      await client.query('SAVEPOINT audit_before_delete')
      await expect(
        client.query('DELETE FROM public."AuditLog" WHERE "id" = $1', [logId])
      ).rejects.toMatchObject({
        code: '42501',
      })
      await client.query('ROLLBACK TO SAVEPOINT audit_before_delete')
    } finally {
      await client.query('ROLLBACK')
      client.release()
    }
  })
})
