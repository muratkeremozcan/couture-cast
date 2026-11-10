import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { afterAll, describe, expect, it } from 'vitest'
import { Pool, type PoolClient } from 'pg'
import { SEEDED_FEATURE_FLAGS } from '../prisma/seeds/feature-flags.js'
import { workerOnlyTables } from './rls/harness.js'

/**
 * Story 6.14 D1: the complimentary access grant table, exercised against a real
 * PostgreSQL connection. Scenario ids come from
 * `_bmad-output/test-artifacts/test-design/cc614-complimentary-access-test-design.md`.
 *
 * The table sits beside the RevenueCat mirror so billing can never expire a grant. What
 * this file pins is what a service bug would silently erode: one active grant per member,
 * a revoke that is all or nothing, reasons that are never blank, an erased operator that
 * leaves no identity, and a table no client role can reach.
 */

const databaseUrl =
  process.env.RLS_TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

const adminPool = new Pool({ connectionString: databaseUrl, max: 4 })

const TABLE = 'ComplimentaryAccessGrant'

afterAll(async () => {
  await adminPool.end()
})

/** Runs `body` inside a transaction that always rolls back, so tests stay isolated. */
const inRolledBackTransaction = async <T>(
  body: (client: PoolClient) => Promise<T>
): Promise<T> => {
  const client = await adminPool.connect()
  try {
    await client.query('BEGIN')
    return await body(client)
  } finally {
    try {
      await client.query('ROLLBACK')
    } catch {
      // Ignore rollback failures so the pooled client is still released.
    }
    client.release()
  }
}

/** Runs one statement under a savepoint and returns its SQLSTATE, or null on success. */
const sqlState = async (
  client: PoolClient,
  sql: string,
  params: unknown[] = []
): Promise<string | null> => {
  await client.query('SAVEPOINT probe')
  try {
    await client.query(sql, params)
    await client.query('RELEASE SAVEPOINT probe')
    return null
  } catch (error) {
    await client.query('ROLLBACK TO SAVEPOINT probe')
    return (error as { code?: string }).code ?? 'unknown'
  }
}

const insertUser = async (client: PoolClient, label: string): Promise<string> => {
  const id = `cc614-${label}-${randomUUID()}`
  await client.query(
    'INSERT INTO public."User" ("id", "email", "updated_at") VALUES ($1, $2, NOW())',
    [id, `${id}@example.test`]
  )
  return id
}

type GrantInput = {
  memberId: string
  reason?: string
  grantedById?: string | null
  revokedAt?: string | null
  revokedById?: string | null
  revokeReason?: string | null
}

const INSERT_GRANT = `INSERT INTO public."ComplimentaryAccessGrant"
  ("id", "member_id", "reason", "granted_by_id", "revoked_at", "revoked_by_id", "revoke_reason")
  VALUES ($1, $2, $3, $4, $5::timestamp, $6, $7)`

const grantParams = (input: GrantInput, id = randomUUID()) => [
  id,
  input.memberId,
  input.reason ?? 'family tester',
  input.grantedById ?? null,
  input.revokedAt ?? null,
  input.revokedById ?? null,
  input.revokeReason ?? null,
]

const insertGrant = async (client: PoolClient, input: GrantInput): Promise<string> => {
  const id = randomUUID()
  await client.query(INSERT_GRANT, grantParams(input, id))
  return id
}

const tryGrant = (client: PoolClient, input: GrantInput) =>
  sqlState(client, INSERT_GRANT, grantParams(input))

const NOW = '2026-11-10T12:00:00.000Z'

describe('complimentary access grant schema (Story 6.14 D1)', () => {
  it('D-TABLE-SHAPE: has exactly the D1 columns with their types and nullability', async () => {
    const { rows } = await adminPool.query<{
      column_name: string
      data_type: string
      is_nullable: string
    }>(
      `SELECT column_name, data_type, is_nullable
         FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1
        ORDER BY column_name`,
      [TABLE]
    )
    expect(rows).toEqual([
      {
        column_name: 'granted_at',
        data_type: 'timestamp without time zone',
        is_nullable: 'NO',
      },
      { column_name: 'granted_by_id', data_type: 'text', is_nullable: 'YES' },
      { column_name: 'id', data_type: 'text', is_nullable: 'NO' },
      { column_name: 'member_id', data_type: 'text', is_nullable: 'NO' },
      { column_name: 'reason', data_type: 'text', is_nullable: 'NO' },
      { column_name: 'revoke_reason', data_type: 'text', is_nullable: 'YES' },
      {
        column_name: 'revoked_at',
        data_type: 'timestamp without time zone',
        is_nullable: 'YES',
      },
      { column_name: 'revoked_by_id', data_type: 'text', is_nullable: 'YES' },
    ])
  })

  it('D-TABLE-SHAPE: member cascades with the User row, both operator columns set null', async () => {
    const { rows } = await adminPool.query<{
      column: string
      on_delete: string
      target: string
    }>(
      `SELECT a.attname AS column,
              CASE c.confdeltype WHEN 'c' THEN 'cascade' WHEN 'n' THEN 'set null'
                                 WHEN 'r' THEN 'restrict' WHEN 'a' THEN 'no action' ELSE 'other' END AS on_delete,
              c.confrelid::regclass::text AS target
         FROM pg_constraint c
         JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
        WHERE c.conrelid = 'public."ComplimentaryAccessGrant"'::regclass AND c.contype = 'f'
        ORDER BY a.attname`
    )
    expect(rows).toEqual([
      { column: 'granted_by_id', on_delete: 'set null', target: '"User"' },
      { column: 'member_id', on_delete: 'cascade', target: '"User"' },
      { column: 'revoked_by_id', on_delete: 'set null', target: '"User"' },
    ])
  })

  it('D-UNIQ-ACTIVE: a second unrevoked grant for one member raises 23505', async () => {
    await inRolledBackTransaction(async (client) => {
      const member = await insertUser(client, 'uniq')
      await insertGrant(client, { memberId: member })
      expect(await tryGrant(client, { memberId: member })).toBe('23505')
    })
  })

  it('D-UNIQ-ACTIVE: revoked history plus one new active grant is accepted, and other members are independent', async () => {
    await inRolledBackTransaction(async (client) => {
      const member = await insertUser(client, 'history')
      const other = await insertUser(client, 'other')
      const admin = await insertUser(client, 'admin')
      const revoked = {
        memberId: member,
        grantedById: admin,
        revokedAt: NOW,
        revokedById: admin,
        revokeReason: 'tester left',
      }
      expect(await tryGrant(client, revoked)).toBeNull()
      expect(await tryGrant(client, revoked)).toBeNull()
      expect(await tryGrant(client, { memberId: member, grantedById: admin })).toBeNull()
      expect(await tryGrant(client, { memberId: other, grantedById: admin })).toBeNull()
      const { rows } = await client.query<{ total: string; active: string }>(
        `SELECT count(*)::text AS total, count(*) FILTER (WHERE revoked_at IS NULL)::text AS active
           FROM public."ComplimentaryAccessGrant" WHERE member_id = $1`,
        [member]
      )
      expect(rows[0]).toEqual({ total: '3', active: '1' })
    })
  })

  it('D-UNIQ-ACTIVE: the active-member index is unique and partial on revoked_at IS NULL', async () => {
    const { rows } = await adminPool.query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = $1 AND indexdef ILIKE 'CREATE UNIQUE INDEX%'
          AND indexname <> $2`,
      [TABLE, `${TABLE}_pkey`]
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]!.indexdef).toMatch(/\(member_id\) WHERE \(revoked_at IS NULL\)$/)
  })

  it('D-CHECK-REVOKE-SET: revoked_at and revoke_reason are set together or not at all', async () => {
    await inRolledBackTransaction(async (client) => {
      const member = await insertUser(client, 'revoke-set')
      const admin = await insertUser(client, 'revoke-admin')
      expect(
        await tryGrant(client, { memberId: member, revokedAt: NOW, revokedById: admin })
      ).toBe('23514')
      expect(
        await tryGrant(client, {
          memberId: member,
          revokedById: admin,
          revokeReason: 'ended',
        })
      ).toBe('23514')
      expect(await tryGrant(client, { memberId: member, revokeReason: 'ended' })).toBe(
        '23514'
      )
    })
  })

  it('D-CHECK-ERASED-REVOKER: a revoked row may lose its revoker; an active row may not name one', async () => {
    await inRolledBackTransaction(async (client) => {
      const member = await insertUser(client, 'erased-revoker')
      const admin = await insertUser(client, 'erased-admin')
      expect(
        await tryGrant(client, {
          memberId: member,
          revokedAt: NOW,
          revokedById: null,
          revokeReason: 'ended',
        })
      ).toBeNull()
      expect(await tryGrant(client, { memberId: member, revokedById: admin })).toBe(
        '23514'
      )
    })
  })

  it('D-CHECK-REASON-LEN: reason must be 1 to 200 characters after trimming', async () => {
    await inRolledBackTransaction(async (client) => {
      const member = await insertUser(client, 'reason')
      const admin = await insertUser(client, 'reason-admin')
      const outcomes: Record<string, string | null> = {}
      const cases: Record<string, string> = {
        empty: '',
        blank: '   ',
        whitespace: '\t\n ',
        over: 'x'.repeat(201),
        one: 'x',
        max: 'y'.repeat(200),
      }
      for (const [name, reason] of Object.entries(cases)) {
        // Revoked rows so the accepted cases never collide on the active index.
        outcomes[name] = await tryGrant(client, {
          memberId: member,
          reason,
          revokedAt: NOW,
          revokedById: admin,
          revokeReason: 'probe',
        })
      }
      expect(outcomes).toEqual({
        empty: '23514',
        blank: '23514',
        // JS trim() removes tabs and newlines; a plain btrim() check only strips spaces.
        whitespace: '23514',
        over: '23514',
        one: null,
        max: null,
      })
    })
  })

  it('D-CHECK-REASON-LEN: revoke_reason must be 1 to 200 characters after trimming', async () => {
    await inRolledBackTransaction(async (client) => {
      const member = await insertUser(client, 'revoke-reason')
      const admin = await insertUser(client, 'revoke-reason-admin')
      const outcomes: Record<string, string | null> = {}
      const cases: Record<string, string> = {
        empty: '',
        blank: '   ',
        whitespace: '\t\n ',
        over: 'x'.repeat(201),
        one: 'x',
        max: 'y'.repeat(200),
      }
      for (const [name, revokeReason] of Object.entries(cases)) {
        outcomes[name] = await tryGrant(client, {
          memberId: member,
          revokedAt: NOW,
          revokedById: admin,
          revokeReason,
        })
      }
      expect(outcomes).toEqual({
        empty: '23514',
        blank: '23514',
        // JS trim() removes tabs and newlines; a plain btrim() check only strips spaces.
        whitespace: '23514',
        over: '23514',
        one: null,
        max: null,
      })
    })
  })

  it('D-RLS-WORKER-ONLY: RLS is on with zero policies', async () => {
    const { rows } = await adminPool.query<{ rls: boolean; policies: string }>(
      `SELECT c.relrowsecurity AS rls,
              (SELECT count(*)::text FROM pg_policies p
                WHERE p.schemaname = 'public' AND p.tablename = $1) AS policies
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = $1`,
      [TABLE]
    )
    expect(rows).toEqual([{ rls: true, policies: '0' }])
  })

  it('D-RLS-WORKER-ONLY: anon, authenticated and service_role hold no privilege on the table', async () => {
    const privileges = [
      'SELECT',
      'INSERT',
      'UPDATE',
      'DELETE',
      'TRUNCATE',
      'REFERENCES',
      'TRIGGER',
    ]
    const { rows } = await adminPool.query<{
      role: string
      privilege: string
      held: boolean
    }>(
      `SELECT r.rolname AS role, p.privilege,
              has_table_privilege(r.rolname, 'public."ComplimentaryAccessGrant"', p.privilege) AS held
         FROM pg_roles r CROSS JOIN unnest($1::text[]) AS p(privilege)
        WHERE r.rolname IN ('anon', 'authenticated', 'service_role')
        ORDER BY r.rolname, p.privilege`,
      [privileges]
    )
    expect(
      rows.map((row) => row.role).filter((role, i, all) => all.indexOf(role) === i)
    ).toEqual(['anon', 'authenticated', 'service_role'])
    expect(rows.filter((row) => row.held)).toEqual([])
    const grants = await adminPool.query(
      `SELECT grantee, privilege_type FROM information_schema.role_table_grants
        WHERE table_schema = 'public' AND table_name = $1
          AND grantee IN ('PUBLIC', 'anon', 'authenticated', 'service_role')`,
      [TABLE]
    )
    expect(grants.rows).toEqual([])
  })

  it('D-RLS-WORKER-ONLY: the table is registered as worker-only and in test cleanup', () => {
    expect(workerOnlyTables).toContain(TABLE)
    const cleanup = readFileSync(
      new URL('../../testing/src/cleanup.ts', import.meta.url),
      'utf8'
    )
    expect(cleanup).toMatch(/complimentaryAccessGrant\.deleteMany\(/)
  })

  it('D-RLS-ANON-DENIED: authenticated select, insert, update and delete each answer 42501', async () => {
    await inRolledBackTransaction(async (client) => {
      const member = await insertUser(client, 'rls')
      const grantId = await insertGrant(client, { memberId: member })
      await client.query("SELECT set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ sub: member, role: 'authenticated' }),
      ])
      await client.query('SET LOCAL ROLE authenticated')
      const outcomes = {
        select: await sqlState(client, 'SELECT * FROM public."ComplimentaryAccessGrant"'),
        insert: await sqlState(client, INSERT_GRANT, grantParams({ memberId: member })),
        update: await sqlState(
          client,
          'UPDATE public."ComplimentaryAccessGrant" SET reason = \'self\' WHERE id = $1',
          [grantId]
        ),
        delete: await sqlState(
          client,
          'DELETE FROM public."ComplimentaryAccessGrant" WHERE id = $1',
          [grantId]
        ),
      }
      await client.query('RESET ROLE')
      expect(outcomes).toEqual({
        select: '42501',
        insert: '42501',
        update: '42501',
        delete: '42501',
      })
    })
  })

  it('D-CASCADE-USER: deleting the member User row removes every grant row for them', async () => {
    await inRolledBackTransaction(async (client) => {
      const member = await insertUser(client, 'cascade')
      const admin = await insertUser(client, 'cascade-admin')
      await insertGrant(client, {
        memberId: member,
        grantedById: admin,
        revokedAt: NOW,
        revokedById: admin,
        revokeReason: 'ended',
      })
      await insertGrant(client, { memberId: member, grantedById: admin })
      await client.query('DELETE FROM public."User" WHERE id = $1', [member])
      const { rows } = await client.query(
        'SELECT id FROM public."ComplimentaryAccessGrant" WHERE member_id = $1',
        [member]
      )
      expect(rows).toEqual([])
    })
  })

  it('D-SETNULL-GRANTER: deleting the operator User row nulls granted_by_id and revoked_by_id', async () => {
    await inRolledBackTransaction(async (client) => {
      const member = await insertUser(client, 'setnull')
      const admin = await insertUser(client, 'setnull-admin')
      const grantId = await insertGrant(client, {
        memberId: member,
        grantedById: admin,
        revokedAt: NOW,
        revokedById: admin,
        revokeReason: 'ended',
      })
      await client.query('DELETE FROM public."User" WHERE id = $1', [admin])
      const { rows } = await client.query(
        `SELECT member_id, granted_by_id, revoked_by_id, revoke_reason
           FROM public."ComplimentaryAccessGrant" WHERE id = $1`,
        [grantId]
      )
      expect(rows).toEqual([
        {
          member_id: member,
          granted_by_id: null,
          revoked_by_id: null,
          revoke_reason: 'ended',
        },
      ])
    })
  })

  it('D-SEED-FLAG: the seed writes complimentary_access_enabled true', () => {
    expect(
      SEEDED_FEATURE_FLAGS.filter((flag) => flag.key === 'complimentary_access_enabled')
    ).toEqual([{ key: 'complimentary_access_enabled', value: true }])
  })
})
