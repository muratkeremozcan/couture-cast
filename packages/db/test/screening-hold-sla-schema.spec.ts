// Learning path Step 58: Production status and nightly health, production follow-ups.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#production-follow-ups-after-the-project-close
// Production follow-up 2026-11-19 test owner: comment_report_routing_deadline after the 30-minute
// screening hold (migration 20261119110000_screening_hold_sla). The API sets the deadline, and this
// constraint is the last line that refuses a wrong one, so each case below is the database itself.
// The previous constraint pinned every row to 24 hours, which made every 30-minute screening intake
// fail with 23514 until this migration replaced it. A screening row may still carry 24 hours: an
// older build writes it during a delayed deploy or after a rollback, and rows already stored have it.
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

const SCREENING_HOLD_MIGRATION = '20261119110000_screening_hold_sla'
const SEEDED = { member: randomUUID(), screening: randomUUID() }

const MINUTE = 60_000
const HOUR = 60 * MINUTE

/**
 * Timestamps go in as UTC ISO strings, the digits Prisma writes. A JS Date would reach a
 * `timestamp without time zone` column in this process's local time, shifting it across the cutoff.
 */
const utc = (at: Date) => at.toISOString()

/** One comment report with no comment row: the deadline columns are what is under test. */
async function insertReport(
  origin: 'member' | 'screening',
  acceptedAt: string,
  dueAfterMs: number
) {
  const id = randomUUID()
  const accepted = new Date(acceptedAt)
  await db.query(
    `INSERT INTO "CommunityCommentReport"
       (id, reason, origin, accepted_at, routed_at, sla_due_at)
     VALUES ($1, 'inappropriate_content', $2, $3, $3, $4)`,
    [id, origin, utc(accepted), utc(new Date(accepted.getTime() + dueAfterMs))]
  )
  return id
}

const ACCEPTED = '2026-11-25T09:00:00.000Z'
const refused = { code: '23514', constraint: 'comment_report_routing_deadline' }

/** What the previous build stored: 24 hours for both origins. */
async function seedPreviousBuildRows() {
  for (const [origin, id] of Object.entries(SEEDED)) {
    const accepted = new Date('2026-11-18T09:00:00.000Z')
    await db.query(
      `INSERT INTO "CommunityCommentReport"
         (id, reason, origin, accepted_at, routed_at, sla_due_at)
       VALUES ($1, 'inappropriate_content', $2, $3, $3, $4)`,
      [id, origin, utc(accepted), utc(new Date(accepted.getTime() + 24 * HOUR))]
    )
  }
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
  // Rows the previous build wrote exist before the replacement constraint is added, so the
  // migration must validate them; they are seeded just before it runs.
  for (const migration of migrations) {
    if (migration === SCREENING_HOLD_MIGRATION) await seedPreviousBuildRows()
    await db.query(await readFile(resolve(directory, migration, 'migration.sql'), 'utf8'))
  }
  expect(migrations).toContain(SCREENING_HOLD_MIGRATION)
}, 120_000)

afterAll(async () => {
  await db.end()
  await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`)
  await admin.end()
})

describe('comment_report_routing_deadline: screening holds are due in 30 minutes', () => {
  it('validates the rows the previous build stored and lets them be resolved', async () => {
    for (const id of Object.values(SEEDED)) {
      const result = await db.query(
        'UPDATE "CommunityCommentReport" SET resolved_at = $2 WHERE id = $1',
        [id, '2026-11-26T10:00:00.000Z']
      )
      expect(result.rowCount, id).toBe(1)
    }
  })

  it('accepts a member report due 24 hours after acceptance', async () => {
    await expect(insertReport('member', ACCEPTED, 24 * HOUR)).resolves.toBeTruthy()
  })

  it('refuses a member report due 30 minutes after acceptance', async () => {
    await expect(insertReport('member', ACCEPTED, 30 * MINUTE)).rejects.toMatchObject(
      refused
    )
  })

  it('accepts a screening hold due 30 minutes after acceptance', async () => {
    await expect(insertReport('screening', ACCEPTED, 30 * MINUTE)).resolves.toBeTruthy()
  })

  it('accepts and resolves a 24-hour screening hold from an older build, on any date', async () => {
    const id = await insertReport('screening', ACCEPTED, 24 * HOUR)
    const result = await db.query(
      'UPDATE "CommunityCommentReport" SET resolved_at = $2 WHERE id = $1',
      [id, '2026-11-26T10:00:00.000Z']
    )
    expect(result.rowCount).toBe(1)
  })

  it.each([
    ['member', 25 * HOUR],
    ['screening', 31 * MINUTE],
    ['screening', 0],
  ] as const)(
    'refuses a %s deadline that matches neither clock (%i ms)',
    async (origin, ms) => {
      await expect(insertReport(origin, ACCEPTED, ms)).rejects.toMatchObject(refused)
    }
  )

  it('keeps the 5-minute routing bound', async () => {
    const accepted = new Date(ACCEPTED)
    await expect(
      db.query(
        `INSERT INTO "CommunityCommentReport"
           (id, reason, origin, accepted_at, routed_at, sla_due_at)
         VALUES ($1, 'inappropriate_content', 'screening', $2, $3, $4)`,
        [
          randomUUID(),
          utc(accepted),
          utc(new Date(accepted.getTime() + 6 * MINUTE)),
          utc(new Date(accepted.getTime() + 30 * MINUTE)),
        ]
      )
    ).rejects.toMatchObject(refused)
  })
})
