// Learning path Step 53: Immutable moderation history.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-53-immutable-moderation-history
// Story 6.13 owner: the database and the rows the enforcement specs share. Each spec file gets its own
// throwaway database, and the rows are written the way the application role writes them.
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll } from 'vitest'
import type { Client } from 'pg'
import {
  canReachDatabase,
  createHistoryDatabase,
  type HistoryDatabase,
} from './moderation-history-database.js'

export const PERMISSION_DENIED = '42501'
export const GUARD_REQUIRED = '23514'
export const ERASED = '[erased]'
export const DECIDED_AT = new Date('2026-06-01T12:00:00.000Z')

const reachable = await canReachDatabase()
// A laptop with no database skips this suite, and CI with no database is a failed run.
const automated = process.env.CI === 'true' || process.env.CI === '1'

/** For `describe.runIf`: skips where the proof cannot run, and fails in CI, where it must. */
export const enforcementRuns = reachable || automated

/** Call inside the describe. `live()` holds the connections, which exist once `beforeAll` has run. */
export function useEnforcementDatabase() {
  let database: HistoryDatabase
  let app: Client
  let root: Client
  let sequence = 0

  const uniqueId = (prefix: string) => `${prefix}-${randomUUID()}`

  async function member(prefix = 'member'): Promise<string> {
    const id = uniqueId(prefix)
    await root.query(
      'INSERT INTO "User" (id, email, updated_at) VALUES ($1, $2, now())',
      [id, `${id}@example.test`]
    )
    return id
  }

  async function erasureRequest(memberId: string, requestedBy: string | null = null) {
    const id = randomUUID()
    await root.query(
      `INSERT INTO "ModerationErasureRequest" (id, member_id, requested_by, requested_at)
       VALUES ($1, $2, $3, now())`,
      [id, memberId, requestedBy]
    )
    return id
  }

  async function postReport(reporter: string | null) {
    const id = uniqueId('report')
    await root.query(
      `INSERT INTO "CommunityPostReport" (id, reporter_id, reason, sla_due_at)
       VALUES ($1, $2, 'inappropriate_content', now())`,
      [id, reporter]
    )
    return id
  }

  async function commentReport(reporter: string | null) {
    const id = uniqueId('comment-report')
    await root.query(
      `INSERT INTO "CommunityCommentReport"
         (id, reporter_id, reason, accepted_at, routed_at, sla_due_at)
       VALUES ($1, $2, 'inappropriate_content', now(), now(), now() + interval '24 hours')`,
      [id, reporter]
    )
    return id
  }

  async function post(author: string) {
    const id = uniqueId('post')
    await root.query(
      `INSERT INTO "LookbookPost" (id, user_id, status, updated_at)
       VALUES ($1, $2, 'draft', now())`,
      [id, author]
    )
    return id
  }

  async function decision(
    patch: Partial<{
      subject: string | null
      moderator: string | null
      alias: string | null
      reportIds: string[]
      post: string | null
      reason: string
    }> = {}
  ) {
    const id = uniqueId('decision')
    sequence += 1
    await app.query(
      `INSERT INTO "ModerationDecision"
         (id, case_key, sequence, source, post_id, report_ids, action, reason, moderator_id,
          moderator_role, subject_user_id, subject_alias, mutation_id, payload_hash, response,
          is_terminal, decided_at)
       VALUES ($1, $2, $3, 'post', $4, $5, 'resolve', $6, $7, 'moderator', $8, $9, $10, 'hash',
         '{"kept":true}', true, $11)`,
      [
        id,
        `post.${id}`,
        sequence,
        patch.post ?? null,
        patch.reportIds ?? [],
        patch.reason ?? 'The original rationale',
        patch.moderator ?? null,
        patch.subject ?? null,
        patch.alias ?? null,
        randomUUID(),
        DECIDED_AT,
      ]
    )
    return id
  }

  /** Commits `work`, and rolls back on failure so one failed test leaves this connection usable. */
  async function committed(client: Client, work: () => Promise<unknown>) {
    await client.query('BEGIN')
    try {
      await work()
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    }
  }

  /** The whole row and its tuple version, so even a same-value rewrite shows. */
  const rawRow = async (id: string) =>
    (
      await root.query<{ doc: string; version: string }>(
        `SELECT row_to_json(d)::text AS doc, xmin::text AS version
         FROM "ModerationDecision" d WHERE id = $1`,
        [id]
      )
    ).rows[0]

  const row = async (id: string) =>
    (
      await root.query<Record<string, unknown>>(
        'SELECT * FROM "ModerationDecision" WHERE id = $1',
        [id]
      )
    ).rows[0]!

  beforeAll(async () => {
    if (!reachable)
      throw new Error(
        'CI is set and the test database is unreachable, so 6.13 stays unproven.'
      )
    database = await createHistoryDatabase()
    app = await database.app()
    root = await database.superuser()
  }, 180_000)

  afterAll(async () => {
    await app?.end().catch(() => undefined)
    await root?.end().catch(() => undefined)
    await database?.drop()
  })

  return {
    live: () => ({ database, app, root }),
    uniqueId,
    member,
    erasureRequest,
    postReport,
    commentReport,
    post,
    decision,
    committed,
    rawRow,
    row,
  }
}
