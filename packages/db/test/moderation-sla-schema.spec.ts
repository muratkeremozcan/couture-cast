// Story 6.12 test owner: what the database itself guarantees about the SLA alert tables.
// D-SCHEMA: the unique key that makes a retry harmless, closed values, the deliverable index, and
// no column that could hold member content. D-RLS: enabled with zero policies.
// The role privileges live in `rls/moderation-queue.spec.ts`, which iterates the same table list.
import { randomUUID } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const directory = resolve(__dirname, '../prisma/migrations')
const source =
  process.env.RLS_TEST_DATABASE_URL ??
  process.env.INTEGRATION_TEST_DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const name = `tea_community_${randomUUID().replaceAll('-', '')}`
const target = new URL(source)
target.pathname = `/${name}`
const admin = new Client({ connectionString: source })
const db = new Client({ connectionString: target.toString() })

const VALID = {
  id: 'a1',
  dedupe_key: 'sla:post:r1:at_risk',
  kind: 'at_risk',
  case_key: 'post.p1',
  source: 'post',
  anchor_report_id: 'r1',
  risk: 'low',
  sla_due_at: '2026-11-05T12:00:00Z',
  detected_at: '2026-11-05T12:00:00Z',
  next_attempt_at: '2026-11-05T12:00:00Z',
}

async function insertAlert(overrides: Record<string, unknown> = {}) {
  const row = { ...VALID, id: randomUUID(), dedupe_key: randomUUID(), ...overrides }
  const columns = Object.keys(row)
  await db.query(
    `INSERT INTO "ModerationSlaAlert" (${columns.map((column) => `"${column}"`).join(', ')})
     VALUES (${columns.map((_column, index) => `$${index + 1}`).join(', ')})`,
    Object.values(row)
  )
}

beforeAll(async () => {
  await admin.connect()
  await admin.query(`CREATE DATABASE "${name}" TEMPLATE template0`)
  await db.connect()
  // Same auth.jwt contract and client default grants as pr-checks.yml.
  await db.query(`
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $fn$
      SELECT coalesce(
        nullif(current_setting('request.jwt.claim', true), ''),
        nullif(current_setting('request.jwt.claims', true), '')
      )::jsonb
    $fn$;
    GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public
      GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
  `)
  const migrations = (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
  for (const migration of migrations)
    await db.query(await readFile(resolve(directory, migration, 'migration.sql'), 'utf8'))
}, 120_000)

afterAll(async () => {
  await db.end()
  await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`)
  await admin.end()
})

describe('D-SCHEMA: ModerationSlaAlert', () => {
  it('refuses a second row with one dedupe key at the database', async () => {
    await insertAlert({ dedupe_key: 'sla:post:dup:at_risk' })
    await expect(
      insertAlert({ dedupe_key: 'sla:post:dup:at_risk' })
    ).rejects.toMatchObject({
      code: '23505',
    })
  })

  it.each([
    ['kind', 'drill'],
    ['delivery', 'sent'],
    ['source', 'wardrobe'],
    ['risk', 'critical'],
    ['last_error_code', 'teapot'],
  ])('refuses %s = %s', async (column, value) => {
    await expect(insertAlert({ [column]: value })).rejects.toMatchObject({
      code: expect.stringMatching(/^(22P02|23514)$/) as string,
    })
  })

  it('accepts every closed failure code, interrupted included', async () => {
    for (const code of [
      'timeout',
      'network',
      'http_3xx',
      'http_4xx',
      'http_5xx',
      'invalid_config',
      'interrupted',
    ])
      await expect(insertAlert({ last_error_code: code })).resolves.toBeUndefined()
  })

  it('holds a partial index on deliverable rows', async () => {
    const { rows } = await db.query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes
       WHERE tablename = 'ModerationSlaAlert' AND indexdef LIKE '%next_attempt_at%'`
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]!.indexdef).toMatch(/WHERE .*delivery.* = 'pending'/)
  })

  it('has exactly the D4 columns, so no column can hold member content or the webhook URL', async () => {
    const { rows } = await db.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'ModerationSlaAlert'
       ORDER BY column_name`
    )
    expect(rows.map((row) => row.column_name)).toEqual(
      [
        'id',
        'dedupe_key',
        'kind',
        'case_key',
        'source',
        'anchor_report_id',
        'risk',
        'sla_due_at',
        'decision_id',
        'detected_at',
        'delivery',
        'attempts',
        'next_attempt_at',
        'lease_until',
        'last_error_code',
        'delivered_at',
        'failure_escalated_at',
      ].sort()
    )
  })

  it('has no foreign key, so report, decision and erasure changes never touch an alert row', async () => {
    const { rows } = await db.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM pg_constraint
       WHERE contype = 'f'
         AND (conrelid = 'public."ModerationSlaAlert"'::regclass
           OR conrelid = 'public."ModerationSlaMonitor"'::regclass)`
    )
    expect(rows[0]!.count).toBe('0')
  })
})

describe('D-SCHEMA: ModerationSlaMonitor', () => {
  it('holds one closed channel value', async () => {
    await expect(
      db.query(
        "INSERT INTO \"ModerationSlaMonitor\" (id, last_sweep_at, channel) VALUES ('x', now(), 'pager')"
      )
    ).rejects.toMatchObject({ code: '23514' })
  })
})

describe('D-RLS: both tables are API-only', () => {
  it.each(['ModerationSlaAlert', 'ModerationSlaMonitor'])(
    '%s has RLS on and zero policies',
    async (table) => {
      const { rows } = await db.query<{ enabled: boolean; policies: string }>(
        `SELECT c.relrowsecurity AS enabled,
          (SELECT count(*)::text FROM pg_policies p WHERE p.tablename = $1) AS policies
         FROM pg_class c WHERE c.oid = format('public.%I', $1::text)::regclass`,
        [table]
      )
      expect(rows[0]).toEqual({ enabled: true, policies: '0' })
    }
  )
})
