// Story 6.11 test owner: serialization, idempotency and the first decision time against a real, migrated Postgres.
// I-C-CONFLICT, I-C-REPORT-RACE, I-C-WITHDRAW-RACE, I-C-REPLAY-RACE, I-C-RETRY, I-C-RETRY-MOVED, I-C-KEY-REUSE,
// I-C-KEY-SCOPE, I-C-FIRST-DECISION, I-C-FIRST-ESCALATE, I-C-RESOLVED-AT, I-C-REKEY, I-C-BAN-RACE, I-C-DB-BACKSTOP,
// I-C-DEADLOCK, I-C-SPLIT-READ, I-C-RECIPROCAL-BAN, I-C-ERASE-IN-FLIGHT.
// Interleavings are forced with a lock held from a second connection.
// pg_stat_activity confirms each waiter before the lock is released, so no test sleeps.
import { randomUUID } from 'node:crypto'
import { type Prisma } from '@prisma/client'
import { Client } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  moderationCasesResponseSchema,
  moderationDecisionErrorCodeSchema,
  moderationDecisionErrorSchema,
  moderationDecisionResponseSchema,
  type ModerationDecisionAction,
} from '@couture/api-client/contracts/http'
import { CommunityRepository } from '../src/modules/community/community.repository.js'
import {
  communityPrivacyTransaction,
  guardCommunityPost,
} from '../src/modules/community/community-privacy.js'
import { ModerationDecisionsRepository } from '../src/modules/moderation/moderation-decisions.repository.js'
import { ModerationQueueRepository } from '../src/modules/moderation/moderation-queue.repository.js'
import { checksumTables } from './helpers/moderation-queue-context.js'
import {
  banMarker,
  decisionFixtures,
  moderationDecisionsTestContext,
  type DecisionBoot,
  type DecisionFixtures,
  type DecisionRequest,
} from './helpers/moderation-decisions-seed.js'

vi.setConfig({ testTimeout: 30_000 })

const NOW = new Date('2026-11-04T12:00:00.000Z')
const MINUTE_MS = 60_000
const REASON = 'Breaks the community rules.'
const SEVEN_DAY_BAN = { kind: 'temporary', durationDays: 7 } as const
const STALE_REVISION = 'ffffffffffffffff'
/** Below the 30 s test timeout, so a missing waiter fails with its own message. */
const WAITER_DEADLINE_MS = 15_000

const ctx = moderationDecisionsTestContext()
const { prisma, clock, flagValues } = ctx
const fx = decisionFixtures(prisma, clock.now)

type Staff = ReturnType<DecisionBoot['staff']>
type DecisionResponse = Awaited<ReturnType<Staff['decide']>>
type HeldConnection = Client

let boot: DecisionBoot
let repository: ModerationDecisionsRepository
let monitor: Client

beforeAll(async () => {
  clock.at(NOW)
  boot = await ctx.bootApp()
  repository = boot.app.get(ModerationDecisionsRepository)
  monitor = new Client({ connectionString: ctx.database.url })
  await monitor.connect()
}, 120_000)

afterAll(async () => {
  await monitor.end()
})

afterEach(() => {
  clock.at(NOW)
  flagValues.clear()
})

const moderator = async () => boot.staff('moderator', await fx.operator())
const admin = async () => boot.staff('admin', await fx.operator())
const after = (minutes: number) => new Date(NOW.getTime() + minutes * MINUTE_MS)

const applied = (response: DecisionResponse) => {
  expect(response.status, JSON.stringify(response.body)).toBe(200)
  return moderationDecisionResponseSchema.parse(response.body).data
}
const refusal = (response: DecisionResponse) =>
  moderationDecisionErrorSchema.parse(response.body)

type AppliedBody = ReturnType<typeof applied>

/** The stored response. `replayed` and `cacheInvalidation` are measured per request (TEA-13). */
function storedPart(body: AppliedBody): Partial<AppliedBody> {
  const stored: Partial<AppliedBody> = { ...body }
  delete stored.replayed
  delete stored.cacheInvalidation
  return stored
}

function expectReplayOf(actual: AppliedBody, original: AppliedBody, message?: string) {
  expect(actual.replayed, message).toBe(true)
  expect(storedPart(actual), message).toEqual(storedPart(original))
}

const decisionsOf = (caseId: string) =>
  prisma.moderationDecision.findMany({
    where: { case_key: caseId },
    orderBy: { sequence: 'asc' },
  })
const auditCount = (userId: string) =>
  prisma.auditLog.count({
    where: { user_id: userId, event_type: 'moderation_decision_applied' },
  })
const postReports = (postId: string) =>
  prisma.communityPostReport.findMany({
    where: { post_id: postId },
    orderBy: { id: 'asc' },
  })
const postStatus = async (postId: string) =>
  (await prisma.lookbookPost.findUniqueOrThrow({ where: { id: postId } })).status

/** Every table a decision can write, the decision tables and `AuditLog` included. */
async function fullChecksum(): Promise<Record<string, string>> {
  const result = await checksumTables(prisma)
  for (const table of [
    'ModerationDecision',
    'CommunitySanction',
    'AuditLog',
    'CommunityReaction',
  ]) {
    const rows = await prisma.$queryRawUnsafe<{ count: bigint; digest: string | null }[]>(
      `SELECT count(*)::bigint AS count, md5(coalesce(string_agg(t::text, '|' ORDER BY t::text), '')) AS digest FROM "${table}" t`
    )
    result[table] = `${rows[0]!.count}:${rows[0]!.digest}`
  }
  return result
}

/** A second connection with one open transaction, always ended when the work returns. */
async function withHeldConnection<T>(
  work: (held: HeldConnection) => Promise<T>
): Promise<T> {
  const held = new Client({ connectionString: ctx.database.url })
  await held.connect()
  await held.query('BEGIN')
  try {
    return await work(held)
  } finally {
    await held.query('ROLLBACK')
    await held.end()
  }
}

const holdCaseLock = (held: HeldConnection, caseId: string) =>
  held.query('SELECT pg_advisory_xact_lock(hashtext($1::text))', [
    `moderation_case:${caseId}`,
  ])
const holdPostRows = (held: HeldConnection, postIds: readonly string[]) =>
  held.query(
    'SELECT id FROM "LookbookPost" WHERE id = ANY($1::text[]) ORDER BY id FOR UPDATE',
    [[...postIds]]
  )
const holdPostGuard = (held: HeldConnection, postId: string) =>
  held.query('SELECT community_privacy_guards(ARRAY[]::text[], ARRAY[$1::text], true)', [
    postId,
  ])
const holdSubjectGuard = (held: HeldConnection, memberId: string) =>
  held.query('SELECT community_privacy_guards(ARRAY[$1::text], ARRAY[]::text[], true)', [
    memberId,
  ])

/** The sessions of this database a lock holds back, by the statement each one is waiting on. */
async function blockedStatements(): Promise<string[]> {
  const { rows } = await monitor.query<{ query: string }>(
    `SELECT query FROM pg_stat_activity
     WHERE datname = current_database() AND cardinality(pg_blocking_pids(pid)) > 0`
  )
  return rows.map((row) => row.query)
}

/** Bounded, and each pass is one database round trip. */
async function waitForBlocked(count: number): Promise<string[]> {
  const deadline = performance.now() + WAITER_DEADLINE_MS
  for (;;) {
    const blocked = await blockedStatements()
    if (blocked.length >= count) return blocked
    if (performance.now() > deadline)
      throw new Error(`expected ${count} blocked sessions, saw ${blocked.length}`)
  }
}

/** Report intake as both intake routes run it: the post row lock, then the insert, uncommitted. */
async function openPostReportInsert(
  held: HeldConnection,
  postId: string,
  reporterId: string
): Promise<string> {
  await holdPostRows(held, [postId])
  const id = `${fx.runId}-race-${randomUUID()}`
  await held.query(
    `INSERT INTO "CommunityPostReport" (id, post_id, reporter_id, reason, sla_due_at, created_at)
     VALUES ($1, $2, $3, 'harassment', $4::timestamp, $5::timestamp)`,
    [id, postId, reporterId, after(24 * 60).toISOString(), NOW.toISOString()]
  )
  return id
}

async function openCommentReportInsert(
  held: HeldConnection,
  postId: string,
  commentId: string,
  reporterId: string
): Promise<string> {
  await holdPostRows(held, [postId])
  const id = `${fx.runId}-race-${randomUUID()}`
  await held.query(
    `INSERT INTO "CommunityCommentReport" (id, comment_id, reporter_id, reason, accepted_at, routed_at, sla_due_at)
     VALUES ($1, $2, $3, 'harassment', $4::timestamp, $4::timestamp, $5::timestamp)`,
    [id, commentId, reporterId, NOW.toISOString(), after(24 * 60).toISOString()]
  )
  return id
}

/** Erasure's effect on a case: the post goes under its privacy guard and the reports lose `post_id`. */
const erasePost = (postId: string) =>
  communityPrivacyTransaction(prisma, async (tx) => {
    await guardCommunityPost(tx, postId)
    await tx.lookbookPost.delete({ where: { id: postId } })
  })

const reportPost = (reporterId: string, postId: string) =>
  boot
    .member(reporterId)
    .post(`/api/v1/community/posts/${postId}/report`)
    .send({ reason: 'harassment' })
const reportComment = (reporterId: string, postId: string, commentId: string) =>
  boot
    .member(reporterId)
    .post(`/api/v1/community/posts/${postId}/comments/${commentId}/report`)
    .send({ reason: 'harassment' })
const withdrawPost = (authorId: string, postId: string) =>
  boot.member(authorId).post(`/api/v1/community/posts/${postId}/withdraw`).send({})
const deleteComment = (authorId: string, postId: string, commentId: string) =>
  boot.member(authorId).delete(`/api/v1/community/posts/${postId}/comments/${commentId}`)

type ConflictAction = 'resolve' | 'takedown' | 'ban'
const decisionOf = (action: ConflictAction): DecisionRequest =>
  action === 'ban'
    ? { action, reason: REASON, ban: SEVEN_DAY_BAN }
    : { action, reason: REASON }

describe('I-C-CONFLICT: two moderators on one reading', () => {
  const ACTIONS: ConflictAction[] = ['resolve', 'takedown', 'ban']
  const PAIRS = ACTIONS.flatMap((first) =>
    ACTIONS.map((second) => [first, second] as const)
  )

  it.each(PAIRS)(
    '%s then %s: the first applies, the second gets case_conflict and leaves nothing behind',
    async (firstAction, secondAction) => {
      const seeded = await fx.postCase({ reports: 2 })
      const winner = await moderator()
      const loser = await moderator()
      const { revision } = await winner.detail(seeded.caseId)

      const [first, second] = await withHeldConnection(async (held) => {
        await holdCaseLock(held, seeded.caseId)
        // Advisory waiters queue in order, so the first sent is the first to read.
        const firstPending = winner.decide(seeded.caseId, {
          ...decisionOf(firstAction),
          expectedRevision: revision,
        })
        await waitForBlocked(1)
        const secondPending = loser.decide(seeded.caseId, {
          ...decisionOf(secondAction),
          expectedRevision: revision,
        })
        await waitForBlocked(2)
        await held.query('COMMIT')
        return Promise.all([firstPending, secondPending])
      })

      expect(applied(first).action).toBe(firstAction)
      expect(second.status).toBe(409)
      const refused = refusal(second)
      expect(refused.code).toBe('case_conflict')
      expect(refused.currentRevision).toBe((await winner.detail(seeded.caseId)).revision)
      expect(refused.currentRevision).not.toBe(revision)

      const rows = await decisionsOf(seeded.caseId)
      expect(rows.map((row) => [row.sequence, row.action, row.moderator_id])).toEqual([
        [1, firstAction, winner.id],
      ])
      expect(await auditCount(winner.id)).toBe(1)
      expect(await auditCount(loser.id)).toBe(0)
      expect(
        await prisma.moderationEvent.count({ where: { reviewed_by_id: loser.id } })
      ).toBe(0)
      expect(
        await prisma.communitySanction.count({ where: { user_id: seeded.author.id } })
      ).toBe(firstAction === 'ban' ? 1 : 0)
      expect(await postStatus(seeded.postId)).toBe(
        firstAction === 'resolve' ? 'published' : 'flagged'
      )
      expect(
        (await postReports(seeded.postId)).map((report) => report.resolved_at)
      ).toEqual([NOW, NOW])
    },
    60_000
  )

  it('holds for a comment case too', async () => {
    const seeded = await fx.commentCase()
    const winner = await moderator()
    const loser = await moderator()
    const { revision } = await winner.detail(seeded.caseId)
    const [first, second] = await withHeldConnection(async (held) => {
      await holdCaseLock(held, seeded.caseId)
      const firstPending = winner.decide(seeded.caseId, {
        action: 'takedown',
        reason: REASON,
        expectedRevision: revision,
      })
      await waitForBlocked(1)
      const secondPending = loser.decide(seeded.caseId, {
        action: 'resolve',
        reason: REASON,
        expectedRevision: revision,
      })
      await waitForBlocked(2)
      await held.query('COMMIT')
      return Promise.all([firstPending, secondPending])
    })
    expect(applied(first).targetStatus).toBe('blocked')
    expect(refusal(second).code).toBe('case_conflict')
    expect((await decisionsOf(seeded.caseId)).map((row) => row.action)).toEqual([
      'takedown',
    ])
    expect(await auditCount(loser.id)).toBe(0)
  })
})

describe('I-C-REPORT-RACE: a report commits while a decision waits (TEA-01, S-3)', () => {
  it('refuses a post decision and leaves the new report open', async () => {
    const seeded = await fx.postCase({ reports: 2 })
    const reporter = await fx.member('reporter')
    const staff = await moderator()
    const { revision } = await staff.detail(seeded.caseId)

    const { response, newReportId } = await withHeldConnection(async (held) => {
      const inserted = await openPostReportInsert(held, seeded.postId, reporter.id)
      const pending = staff.decide(seeded.caseId, {
        action: 'resolve',
        reason: REASON,
        expectedRevision: revision,
      })
      const waiting = await waitForBlocked(1)
      expect(waiting[0]).toMatch(/LookbookPost.*FOR UPDATE/s)
      await held.query('COMMIT')
      return { response: await pending, newReportId: inserted }
    })

    expect(response.status).toBe(409)
    const refused = refusal(response)
    expect(refused.code).toBe('case_conflict')
    expect(refused.currentRevision).not.toBe(revision)

    const reports = await postReports(seeded.postId)
    expect(reports).toHaveLength(3)
    expect(reports.map((report) => report.resolved_at)).toEqual([null, null, null])
    expect(reports.map((report) => report.id)).toContain(newReportId)
    expect(await decisionsOf(seeded.caseId)).toEqual([])
    expect(await auditCount(staff.id)).toBe(0)

    // The reading the refusal named is the case as it now stands, so a reload can decide.
    const reloaded = await staff.detail(seeded.caseId)
    expect(reloaded.revision).toBe(refused.currentRevision)
    applied(
      await staff.decide(seeded.caseId, {
        action: 'resolve',
        reason: REASON,
        expectedRevision: reloaded.revision,
      })
    )
    expect(
      (await postReports(seeded.postId)).map((report) => report.resolved_at)
    ).toEqual([NOW, NOW, NOW])
  })

  it('refuses a comment decision, whose intake locks the parent post row', async () => {
    const seeded = await fx.commentCase({ reports: 2 })
    const reporter = await fx.member('reporter')
    const staff = await moderator()
    const { revision } = await staff.detail(seeded.caseId)

    const { response, newReportId } = await withHeldConnection(async (held) => {
      const inserted = await openCommentReportInsert(
        held,
        seeded.postId,
        seeded.commentId,
        reporter.id
      )
      const pending = staff.decide(seeded.caseId, {
        action: 'takedown',
        reason: REASON,
        expectedRevision: revision,
      })
      const waiting = await waitForBlocked(1)
      expect(waiting[0]).toMatch(/LookbookPost.*FOR UPDATE/s)
      await held.query('COMMIT')
      return { response: await pending, newReportId: inserted }
    })

    expect(response.status).toBe(409)
    const refused = refusal(response)
    expect(refused.code).toBe('case_conflict')
    expect(refused.currentRevision).not.toBe(revision)

    const reports = await prisma.communityCommentReport.findMany({
      where: { comment_id: seeded.commentId },
    })
    expect(reports).toHaveLength(3)
    expect(reports.map((report) => report.resolved_at)).toEqual([null, null, null])
    expect(reports.map((report) => report.id)).toContain(newReportId)
    const comment = await prisma.communityComment.findUniqueOrThrow({
      where: { id: seeded.commentId },
    })
    expect(comment.status).toBe('published')
    expect(await decisionsOf(seeded.caseId)).toEqual([])
    expect(await auditCount(staff.id)).toBe(0)
  })

  it('refuses when the real post report route wins the row ahead of the decision', async () => {
    const seeded = await fx.postCase()
    const reporter = await fx.member('reporter')
    const staff = await moderator()
    const { revision } = await staff.detail(seeded.caseId)

    const [report, decision] = await withHeldConnection(async (held) => {
      await holdPostRows(held, [seeded.postId])
      const reportPending = Promise.resolve(reportPost(reporter.id, seeded.postId))
      await waitForBlocked(1)
      const decisionPending = staff.decide(seeded.caseId, {
        action: 'resolve',
        reason: REASON,
        expectedRevision: revision,
      })
      await waitForBlocked(2)
      await held.query('COMMIT')
      return Promise.all([reportPending, decisionPending])
    })

    expect(report.status).toBe(200)
    expect(refusal(decision).code).toBe('case_conflict')
    const fresh = await prisma.communityPostReport.findFirstOrThrow({
      where: { post_id: seeded.postId, reporter_id: reporter.id },
    })
    expect(fresh.resolved_at).toBeNull()
    expect((await postReports(seeded.postId)).map((row) => row.resolved_at)).toEqual([
      null,
      null,
    ])
  })

  it('refuses when the real comment report route wins the row ahead of the decision', async () => {
    const seeded = await fx.commentCase()
    const reporter = await fx.member('reporter')
    const staff = await moderator()
    const { revision } = await staff.detail(seeded.caseId)

    const [report, decision] = await withHeldConnection(async (held) => {
      await holdPostRows(held, [seeded.postId])
      const reportPending = Promise.resolve(
        reportComment(reporter.id, seeded.postId, seeded.commentId)
      )
      await waitForBlocked(1)
      const decisionPending = staff.decide(seeded.caseId, {
        action: 'resolve',
        reason: REASON,
        expectedRevision: revision,
      })
      await waitForBlocked(2)
      await held.query('COMMIT')
      return Promise.all([reportPending, decisionPending])
    })

    expect(report.status).toBe(200)
    expect(refusal(decision).code).toBe('case_conflict')
    const stamps = await prisma.communityCommentReport.findMany({
      where: { comment_id: seeded.commentId },
    })
    expect(stamps.map((row) => row.resolved_at)).toEqual([null, null])
  })
})

describe('I-C-WITHDRAW-RACE: the author moves the case between read and submit', () => {
  it('refuses a decision on a reading taken before the post was withdrawn', async () => {
    const seeded = await fx.postCase()
    const staff = await moderator()
    const { revision } = await staff.detail(seeded.caseId)
    expect((await withdrawPost(seeded.author.id, seeded.postId)).status).toBe(200)

    const response = await staff.decide(seeded.caseId, {
      action: 'resolve',
      reason: REASON,
      expectedRevision: revision,
    })
    expect(response.status).toBe(409)
    const refused = refusal(response)
    expect(refused.code).toBe('case_conflict')
    expect(refused.currentRevision).not.toBe(revision)
    expect(await postStatus(seeded.postId)).toBe('withdrawn')
    expect((await postReports(seeded.postId)).map((row) => row.resolved_at)).toEqual([
      null,
    ])
    expect(await decisionsOf(seeded.caseId)).toEqual([])
  })

  it('refuses a decision queued behind an in-flight withdrawal', async () => {
    const seeded = await fx.postCase()
    const staff = await moderator()
    const { revision } = await staff.detail(seeded.caseId)

    const [withdrawal, decision] = await withHeldConnection(async (held) => {
      await holdPostGuard(held, seeded.postId)
      const withdrawing = Promise.resolve(withdrawPost(seeded.author.id, seeded.postId))
      await waitForBlocked(1)
      const deciding = staff.decide(seeded.caseId, {
        action: 'takedown',
        reason: REASON,
        expectedRevision: revision,
      })
      await waitForBlocked(2)
      await held.query('COMMIT')
      return Promise.all([withdrawing, deciding])
    })

    expect(withdrawal.status).toBe(200)
    expect(refusal(decision).code).toBe('case_conflict')
    expect(await postStatus(seeded.postId)).toBe('withdrawn')
    expect(await decisionsOf(seeded.caseId)).toEqual([])
  })

  it('refuses a decision on a reading taken before the comment was deleted', async () => {
    const seeded = await fx.commentCase()
    const staff = await moderator()
    const { revision } = await staff.detail(seeded.caseId)
    expect(
      (await deleteComment(seeded.author.id, seeded.postId, seeded.commentId)).status
    ).toBe(200)

    const response = await staff.decide(seeded.caseId, {
      action: 'resolve',
      reason: REASON,
      expectedRevision: revision,
    })
    expect(refusal(response).code).toBe('case_conflict')
    expect(refusal(response).currentRevision).not.toBe(revision)
    const report = await prisma.communityCommentReport.findUniqueOrThrow({
      where: { id: seeded.reportIds[0] },
    })
    expect(report.resolved_at).toBeNull()
    expect(await decisionsOf(seeded.caseId)).toEqual([])
  })

  it('refuses a decision queued behind an in-flight comment deletion', async () => {
    const seeded = await fx.commentCase()
    const staff = await moderator()
    const { revision } = await staff.detail(seeded.caseId)

    const [deletion, decision] = await withHeldConnection(async (held) => {
      await holdPostGuard(held, seeded.postId)
      const deleting = Promise.resolve(
        deleteComment(seeded.author.id, seeded.postId, seeded.commentId)
      )
      await waitForBlocked(1)
      const deciding = staff.decide(seeded.caseId, {
        action: 'takedown',
        reason: REASON,
        expectedRevision: revision,
      })
      await waitForBlocked(2)
      await held.query('COMMIT')
      return Promise.all([deleting, deciding])
    })

    expect(deletion.status).toBe(200)
    expect(refusal(decision).code).toBe('case_conflict')
    const comment = await prisma.communityComment.findUniqueOrThrow({
      where: { id: seeded.commentId },
    })
    expect(comment.status).toBe('author_deleted')
    expect(await decisionsOf(seeded.caseId)).toEqual([])
  })
})

describe('I-C-REPLAY-RACE: parallel sends of one key (TEA-12)', () => {
  it.each<[string, DecisionRequest]>([
    ['resolve', { action: 'resolve', reason: REASON }],
    ['ban', { action: 'ban', reason: REASON, ban: SEVEN_DAY_BAN }],
  ])(
    'ten sends of one %s give one row and nine replays with equal bodies',
    async (_name, input) => {
      const seeded = await fx.postCase({ reports: 2 })
      const staff = await moderator()
      const { revision } = await staff.detail(seeded.caseId)
      const mutationId = randomUUID()

      const responses = await withHeldConnection(async (held) => {
        await holdCaseLock(held, seeded.caseId)
        const pending = Array.from({ length: 10 }, () =>
          staff.decide(seeded.caseId, {
            ...input,
            mutationId,
            expectedRevision: revision,
          })
        )
        await waitForBlocked(2)
        await held.query('COMMIT')
        return Promise.all(pending)
      })

      const bodies = responses.map(applied)
      expect(bodies.filter((body) => !body.replayed)).toHaveLength(1)
      expect(bodies.filter((body) => body.replayed)).toHaveLength(9)
      const original = bodies.find((body) => !body.replayed)!
      for (const body of bodies) expect(storedPart(body)).toEqual(storedPart(original))

      const rows = await decisionsOf(seeded.caseId)
      expect(rows.map((row) => row.mutation_id)).toEqual([mutationId])
      expect(await auditCount(staff.id)).toBe(1)
      expect(
        await prisma.communitySanction.count({ where: { user_id: seeded.author.id } })
      ).toBe(input.action === 'ban' ? 1 : 0)
    },
    60_000
  )

  it('sends one key to two cases at once past both checks: a real key violation gives idempotency_mismatch', async () => {
    const left = await fx.postCase()
    const right = await fx.postCase()
    const staff = await moderator()
    const mutationId = randomUUID()
    const revisions = [
      (await staff.detail(left.caseId)).revision,
      (await staff.detail(right.caseId)).revision,
    ]
    const lookups = vi.spyOn(repository, 'findByMutation')
    try {
      const responses = await withHeldConnection(async (held) => {
        // Each request holds its own case lock and has read no row for the key, so only the unique index stops the second.
        await holdPostRows(held, [left.postId, right.postId])
        const pending = [
          staff.decide(left.caseId, {
            action: 'resolve',
            reason: REASON,
            mutationId,
            expectedRevision: revisions[0],
          }),
          staff.decide(right.caseId, {
            action: 'resolve',
            reason: REASON,
            mutationId,
            expectedRevision: revisions[1],
          }),
        ]
        await waitForBlocked(2)
        await held.query('COMMIT')
        return Promise.all(pending)
      })

      expect(responses.map((response) => response.status).sort()).toEqual([200, 409])
      const winner = responses.find((response) => response.status === 200)!
      const loser = responses.find((response) => response.status === 409)!
      expect(refusal(loser).code).toBe('idempotency_mismatch')
      expect(applied(winner).replayed).toBe(false)
      // Two checks in the transactions and one more from the recover path.
      expect(lookups).toHaveBeenCalledTimes(3)

      const winnerCase = applied(winner).caseId === left.caseId ? left : right
      const loserCase = winnerCase === left ? right : left
      expect(
        (await decisionsOf(winnerCase.caseId)).map((row) => row.mutation_id)
      ).toEqual([mutationId])
      expect(await decisionsOf(loserCase.caseId)).toEqual([])
      expect((await postReports(loserCase.postId)).map((row) => row.resolved_at)).toEqual(
        [null]
      )
      expect(await auditCount(staff.id)).toBe(1)
    } finally {
      lookups.mockRestore()
    }
  })

  it('replays when a key violation meets a row of the same payload, read in a new transaction', async () => {
    const seeded = await fx.postCase()
    const staff = await moderator()
    const { revision } = await staff.detail(seeded.caseId)
    const mutationId = randomUUID()
    let stored: unknown
    const spy = vi.spyOn(repository, 'insertDecision').mockImplementation(((
      tx: Prisma.TransactionClient,
      data: Prisma.ModerationDecisionUncheckedCreateInput
    ) => {
      stored = data.response
      // Committed from outside, so the transaction's own insert meets a real unique violation.
      return prisma.moderationDecision
        .create({
          data: { ...data, id: randomUUID(), sequence: data.sequence + 1, post_id: null },
        })
        .then(() => tx.moderationDecision.create({ data }))
    }) as never)
    try {
      const response = await staff.decide(seeded.caseId, {
        action: 'resolve',
        reason: REASON,
        mutationId,
        expectedRevision: revision,
      })
      const body = applied(response)
      expect(body.replayed).toBe(true)
      expect({ decisionId: body.decisionId }).toEqual({
        decisionId: (stored as { decisionId: string }).decisionId,
      })
      // The transaction rolled back, so the stamp and the audit row went with it.
      expect((await postReports(seeded.postId)).map((row) => row.resolved_at)).toEqual([
        null,
      ])
      expect(await auditCount(staff.id)).toBe(0)
      expect((await decisionsOf(seeded.caseId)).map((row) => row.sequence)).toEqual([2])
    } finally {
      spy.mockRestore()
    }
  })
})

describe('I-C-RETRY: the same key and payload', () => {
  it.each<[string, DecisionRequest]>([
    ['resolve', { action: 'resolve', reason: REASON }],
    ['takedown', { action: 'takedown', reason: REASON }],
    ['escalate', { action: 'escalate', reason: REASON }],
    ['ban', { action: 'ban', reason: REASON, ban: SEVEN_DAY_BAN }],
  ])('returns the stored %s and writes nothing', async (_name, input) => {
    const seeded = await fx.postCase({ reports: 2 })
    const staff = await moderator()
    const { revision } = await staff.detail(seeded.caseId)
    const mutationId = randomUUID()
    const first = applied(
      await staff.decide(seeded.caseId, {
        ...input,
        mutationId,
        expectedRevision: revision,
      })
    )
    expect(first.replayed).toBe(false)

    const before = await fullChecksum()
    clock.at(after(30))
    const retried = applied(
      await staff.decide(seeded.caseId, {
        ...input,
        mutationId,
        expectedRevision: revision,
      })
    )
    expectReplayOf(retried, first)
    expect(retried.decidedAt).toBe(NOW.toISOString())
    expect(await fullChecksum()).toEqual(before)
  })
})

describe('I-C-RETRY-MOVED: a retry beats everything that moved since (D6)', () => {
  it('replays after another moderator decided, ahead of 409', async () => {
    const seeded = await fx.postCase()
    const staff = await moderator()
    const other = await moderator()
    const { revision } = await staff.detail(seeded.caseId)
    const mutationId = randomUUID()
    const input = {
      action: 'resolve',
      reason: REASON,
      mutationId,
      expectedRevision: revision,
    } as const
    const first = applied(await staff.decide(seeded.caseId, input))

    await fx.postReport(seeded.postId, (await fx.member('reporter')).id)
    applied(await other.decide(seeded.caseId, { action: 'takedown', reason: REASON }))
    expect(await staff.detail(seeded.caseId)).not.toMatchObject({ revision })

    expectReplayOf(applied(await staff.decide(seeded.caseId, input)), first)
    expect(await decisionsOf(seeded.caseId)).toHaveLength(2)
  })

  it('replays with a stale revision, while a new key on that revision conflicts', async () => {
    const seeded = await fx.postCase()
    const staff = await moderator()
    const mutationId = randomUUID()
    const first = applied(
      await staff.decide(seeded.caseId, { action: 'resolve', reason: REASON, mutationId })
    )
    expectReplayOf(
      applied(
        await staff.decide(seeded.caseId, {
          action: 'resolve',
          reason: REASON,
          mutationId,
          expectedRevision: STALE_REVISION,
        })
      ),
      first
    )

    const fresh = await staff.decide(seeded.caseId, {
      action: 'takedown',
      reason: REASON,
      expectedRevision: STALE_REVISION,
    })
    expect(refusal(fresh).code).toBe('case_conflict')
  })

  it('replays after the case re-keyed, ahead of 404', async () => {
    const seeded = await fx.postCase({ reports: 2 })
    const staff = await moderator()
    const { revision } = await staff.detail(seeded.caseId)
    const mutationId = randomUUID()
    const input = {
      action: 'takedown',
      reason: REASON,
      mutationId,
      expectedRevision: revision,
    } as const
    const first = applied(await staff.decide(seeded.caseId, input))

    await erasePost(seeded.postId)

    const before = await fullChecksum()
    expectReplayOf(applied(await staff.decide(seeded.caseId, input)), first)
    expect(await fullChecksum()).toEqual(before)

    const fresh = await staff.decide(seeded.caseId, {
      action: 'resolve',
      reason: REASON,
      expectedRevision: revision,
    })
    expect(fresh.status).toBe(404)
    expect(refusal(fresh).code).toBe('case_not_found')
  })

  it('replays after the moderator gained a conflict, ahead of 403 self_review_refused', async () => {
    const seeded = await fx.postCase()
    const staff = await moderator()
    const { revision } = await staff.detail(seeded.caseId)
    const mutationId = randomUUID()
    const input = {
      action: 'resolve',
      reason: REASON,
      mutationId,
      expectedRevision: revision,
    } as const
    const first = applied(await staff.decide(seeded.caseId, input))

    await fx.postReport(seeded.postId, staff.id)

    expectReplayOf(applied(await staff.decide(seeded.caseId, input)), first)
    const fresh = await staff.decide(seeded.caseId, {
      action: 'takedown',
      reason: REASON,
      expectedRevision: revision,
    })
    expect(fresh.status).toBe(403)
    expect(refusal(fresh).code).toBe('self_review_refused')
  })

  it('replays after an admin became a moderator, ahead of 403 admin_required', async () => {
    const seeded = await fx.postCase()
    const identity = await fx.operator()
    const asAdmin = boot.staff('admin', identity)
    const asModerator = boot.staff('moderator', identity)
    const { revision } = await asAdmin.detail(seeded.caseId)
    const mutationId = randomUUID()
    const input = {
      action: 'ban',
      reason: REASON,
      ban: { kind: 'permanent' },
      mutationId,
      expectedRevision: revision,
    } as const
    const first = applied(await asAdmin.decide(seeded.caseId, input))

    expectReplayOf(applied(await asModerator.decide(seeded.caseId, input)), first)
    const fresh = await asModerator.decide(seeded.caseId, {
      action: 'ban',
      reason: REASON,
      ban: { kind: 'permanent' },
      expectedRevision: revision,
    })
    expect(fresh.status).toBe(403)
    expect(refusal(fresh).code).toBe('admin_required')
  })

  it('replays after the moderator was sanctioned, ahead of 403 operator_sanctioned', async () => {
    const seeded = await fx.postCase()
    const staff = await moderator()
    const { revision } = await staff.detail(seeded.caseId)
    const mutationId = randomUUID()
    const input = {
      action: 'resolve',
      reason: REASON,
      mutationId,
      expectedRevision: revision,
    } as const
    const first = applied(await staff.decide(seeded.caseId, input))

    await fx.sanction(staff)

    expectReplayOf(applied(await staff.decide(seeded.caseId, input)), first)
    const fresh = await staff.decide(seeded.caseId, {
      action: 'takedown',
      reason: REASON,
      expectedRevision: revision,
    })
    expect(fresh.status).toBe(403)
    expect(refusal(fresh).code).toBe('operator_sanctioned')
  })
})

describe('I-C-KEY-REUSE: one key, another request (TEA-12)', () => {
  const OTHER_REASON = 'A different note about the same content.'

  async function bannedCase() {
    const seeded = await fx.postCase()
    const staff = await admin()
    const { revision } = await staff.detail(seeded.caseId)
    const mutationId = randomUUID()
    const first = applied(
      await staff.decide(seeded.caseId, {
        action: 'ban',
        reason: REASON,
        ban: SEVEN_DAY_BAN,
        mutationId,
        expectedRevision: revision,
      })
    )
    return { seeded, staff, revision, mutationId, first }
  }

  it.each<[string, Omit<DecisionRequest, 'mutationId' | 'expectedRevision'>]>([
    ['action', { action: 'takedown', reason: REASON }],
    ['reason', { action: 'ban', reason: OTHER_REASON, ban: SEVEN_DAY_BAN }],
    [
      'ban duration',
      { action: 'ban', reason: REASON, ban: { kind: 'temporary', durationDays: 30 } },
    ],
    ['ban kind', { action: 'ban', reason: REASON, ban: { kind: 'permanent' } }],
  ])('answers idempotency_mismatch for a different %s', async (_name, input) => {
    const { seeded, staff, revision, mutationId } = await bannedCase()
    const before = await fullChecksum()
    const response = await staff.decide(seeded.caseId, {
      ...input,
      mutationId,
      expectedRevision: revision,
    })
    expect(response.status).toBe(409)
    expect(refusal(response).code).toBe('idempotency_mismatch')
    expect(await fullChecksum()).toEqual(before)
  })

  it('answers idempotency_mismatch for a different case', async () => {
    const { staff, mutationId } = await bannedCase()
    const other = await fx.postCase()
    const { revision } = await staff.detail(other.caseId)
    const before = await fullChecksum()
    const response = await staff.decide(other.caseId, {
      action: 'ban',
      reason: REASON,
      ban: SEVEN_DAY_BAN,
      mutationId,
      expectedRevision: revision,
    })
    expect(refusal(response).code).toBe('idempotency_mismatch')
    expect(await fullChecksum()).toEqual(before)
  })

  it('answers idempotency_mismatch on the appeal route for a key the decision route used', async () => {
    const { seeded, staff, mutationId, first } = await bannedCase()
    expect(first.sanction).not.toBeNull()
    const before = await fullChecksum()
    const response = await staff.appeal(first.sanction!.sanctionId, {
      status: 'requested',
      reason: REASON,
      mutationId,
    })
    expect(response.status).toBe(409)
    expect((response.body as { code: string }).code).toBe('idempotency_mismatch')
    expect(await fullChecksum()).toEqual(before)
    expect(await decisionsOf(seeded.caseId)).toHaveLength(1)
  })

  it('answers idempotency_mismatch on the decision route for a key the appeal route used', async () => {
    const { first } = await bannedCase()
    const staff = await moderator()
    const mutationId = randomUUID()
    const appeal = await staff.appeal(first.sanction!.sanctionId, {
      status: 'requested',
      reason: REASON,
      mutationId,
    })
    expect(appeal.status).toBe(200)

    const other = await fx.postCase()
    const { revision } = await staff.detail(other.caseId)
    const before = await fullChecksum()
    const response = await staff.decide(other.caseId, {
      action: 'resolve',
      reason: REASON,
      mutationId,
      expectedRevision: revision,
    })
    expect(refusal(response).code).toBe('idempotency_mismatch')
    expect(await fullChecksum()).toEqual(before)
  })

  it('replays when only the whitespace around the reason differs', async () => {
    const { seeded, staff, revision, mutationId, first } = await bannedCase()
    const before = await fullChecksum()
    const response = await staff.decide(seeded.caseId, {
      action: 'ban',
      reason: `   ${REASON}\n\t `,
      ban: SEVEN_DAY_BAN,
      mutationId,
      expectedRevision: revision,
    })
    expectReplayOf(applied(response), first)
    expect(await fullChecksum()).toEqual(before)
  })
})

describe('I-C-KEY-SCOPE: what a key belongs to', () => {
  it('treats the same UUID from another moderator as a new decision', async () => {
    const seeded = await fx.postCase()
    const first = await moderator()
    const second = await moderator()
    const mutationId = randomUUID()
    const input = { action: 'resolve', reason: REASON, mutationId } as const

    expect(applied(await first.decide(seeded.caseId, input)).replayed).toBe(false)
    await fx.postReport(seeded.postId, (await fx.member('reporter')).id)
    const body = applied(await second.decide(seeded.caseId, input))
    expect(body.replayed).toBe(false)

    const rows = await decisionsOf(seeded.caseId)
    expect(rows.map((row) => [row.sequence, row.moderator_id, row.mutation_id])).toEqual([
      [1, first.id, mutationId],
      [2, second.id, mutationId],
    ])
  })

  it('stores nothing for a conflicted request, so the key applies after a reload', async () => {
    const seeded = await fx.postCase()
    const staff = await moderator()
    const mutationId = randomUUID()
    const conflicted = await staff.decide(seeded.caseId, {
      action: 'resolve',
      reason: REASON,
      mutationId,
      expectedRevision: STALE_REVISION,
    })
    expect(refusal(conflicted).code).toBe('case_conflict')
    expect(await decisionsOf(seeded.caseId)).toEqual([])

    const body = applied(
      await staff.decide(seeded.caseId, { action: 'resolve', reason: REASON, mutationId })
    )
    expect(body.replayed).toBe(false)
    expect((await decisionsOf(seeded.caseId)).map((row) => row.mutation_id)).toEqual([
      mutationId,
    ])
  })

  it('stores nothing for a refused request, so the key applies when the case allows it', async () => {
    const seeded = await fx.postCase({
      status: 'flagged',
      moderationReason: 'unsafe_class',
      engineVersion: 'engine-v9',
    })
    const staff = await moderator()
    const mutationId = randomUUID()
    const input = { action: 'release', reason: REASON, mutationId } as const

    flagValues.set('community_write_enabled', false)
    const refused = await staff.decide(seeded.caseId, input)
    expect(refused.status).toBe(409)
    expect(refusal(refused)).toMatchObject({
      code: 'action_not_applicable',
      detail: 'community_writes_closed',
    })
    expect(await decisionsOf(seeded.caseId)).toEqual([])

    flagValues.delete('community_write_enabled')
    const body = applied(await staff.decide(seeded.caseId, input))
    expect(body.replayed).toBe(false)
    expect(body.targetStatus).toBe('published')
  })

  it('stores nothing for a role refusal, so the key applies for the admin who holds it next', async () => {
    const seeded = await fx.postCase()
    const identity = await fx.operator()
    const mutationId = randomUUID()
    const input = {
      action: 'ban',
      reason: REASON,
      ban: { kind: 'permanent' },
      mutationId,
    } as const
    const refused = await boot.staff('moderator', identity).decide(seeded.caseId, input)
    expect(refusal(refused).code).toBe('admin_required')
    expect(
      applied(await boot.staff('admin', identity).decide(seeded.caseId, input)).replayed
    ).toBe(false)
  })
})

describe('I-C-FIRST-DECISION: the first effective decision holds (D7, S-5)', () => {
  it('keeps T1 and each report keeps the time of the decision that stamped it', async () => {
    const T1 = after(10)
    const T2 = after(20)
    const T3 = after(30)
    const seeded = await fx.postCase({ reports: 2 })
    const staff = await moderator()

    clock.at(T1)
    const resolved = applied(
      await staff.decide(seeded.caseId, { action: 'resolve', reason: REASON })
    )
    expect(resolved.firstDecisionAt).toBe(T1.toISOString())

    const reporter = await fx.member('reporter')
    const newReport = await fx.postReport(seeded.postId, reporter.id)

    clock.at(T2)
    const mutationId = randomUUID()
    const { revision } = await staff.detail(seeded.caseId)
    const takedownInput = {
      action: 'takedown',
      reason: REASON,
      mutationId,
      expectedRevision: revision,
    } as const
    const takenDown = applied(await staff.decide(seeded.caseId, takedownInput))
    expect(takenDown.decidedAt).toBe(T2.toISOString())
    expect(takenDown.firstDecisionAt).toBe(T1.toISOString())

    clock.at(after(25))
    const retried = applied(await staff.decide(seeded.caseId, takedownInput))
    expectReplayOf(retried, takenDown)

    clock.at(T3)
    const banned = applied(
      await staff.decide(seeded.caseId, {
        action: 'ban',
        reason: REASON,
        ban: SEVEN_DAY_BAN,
      })
    )
    expect(banned.decidedAt).toBe(T3.toISOString())
    expect(banned.firstDecisionAt).toBe(T1.toISOString())

    expect((await staff.detail(seeded.caseId)).firstDecisionAt).toBe(T1.toISOString())
    const stamps = new Map(
      (await postReports(seeded.postId)).map((row) => [row.id, row.resolved_at])
    )
    for (const id of seeded.reportIds) expect(stamps.get(id)).toEqual(T1)
    expect(stamps.get(newReport.id)).toEqual(T2)
  })
})

describe('I-C-FIRST-ESCALATE: only a terminal decision counts (D7, S-5)', () => {
  it('leaves firstDecisionAt empty through escalate, a refusal and a replay, then takes the resolve time', async () => {
    const T1 = after(10)
    const T2 = after(40)
    const seeded = await fx.postCase({ reports: 2 })
    const staff = await moderator()
    const boss = await admin()

    clock.at(T1)
    const { revision } = await staff.detail(seeded.caseId)
    const mutationId = randomUUID()
    const escalateInput = {
      action: 'escalate',
      reason: REASON,
      mutationId,
      expectedRevision: revision,
    } as const
    const escalated = applied(await staff.decide(seeded.caseId, escalateInput))
    expect(escalated.firstDecisionAt).toBeNull()
    expect(escalated.escalated).toBe(true)
    expect((await staff.detail(seeded.caseId)).firstDecisionAt).toBeNull()

    clock.at(after(20))
    const refused = await staff.decide(seeded.caseId, {
      action: 'resolve',
      reason: REASON,
    })
    expect(refused.status).toBe(403)
    expect(refusal(refused).code).toBe('admin_required')
    expect((await boss.detail(seeded.caseId)).firstDecisionAt).toBeNull()

    clock.at(after(30))
    const replayed = applied(await staff.decide(seeded.caseId, escalateInput))
    expect(replayed.replayed).toBe(true)
    expect(replayed.firstDecisionAt).toBeNull()
    expect((await boss.detail(seeded.caseId)).firstDecisionAt).toBeNull()
    expect((await postReports(seeded.postId)).map((row) => row.resolved_at)).toEqual([
      null,
      null,
    ])

    clock.at(T2)
    const resolved = applied(
      await boss.decide(seeded.caseId, { action: 'resolve', reason: REASON })
    )
    expect(resolved.firstDecisionAt).toBe(T2.toISOString())
    expect((await boss.detail(seeded.caseId)).firstDecisionAt).toBe(T2.toISOString())
    expect((await postReports(seeded.postId)).map((row) => row.resolved_at)).toEqual([
      T2,
      T2,
    ])
  })
})

/** A small deterministic generator, so a failure names its seed and step and reproduces exactly. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let mixed = state
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1)
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61)
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296
  }
}

describe('I-C-RESOLVED-AT: random sequences never move a stamp (D7, S-5)', () => {
  const SEED = 611
  const STEPS = 200
  const ALLOWED_REFUSALS = new Set([
    'admin_required',
    'case_conflict',
    'action_not_applicable',
  ])

  type PropertyCase = {
    caseId: string
    addReport: () => Promise<string>
    /** report id to its stamp, as the model expects it. */
    stamps: Map<string, string | null>
    firstDecisionAt: string | null
    lastRevision: string | null
  }
  type Applied = {
    staff: Staff
    target: PropertyCase
    input: DecisionRequest
    body: ReturnType<typeof applied>
  }

  it('holds over a seeded run of decisions, retries and new reports', async () => {
    const random = seededRandom(SEED)
    const pick = <T>(items: readonly T[]): T =>
      items[Math.floor(random() * items.length)]!
    const label = (step: number) => `seed ${SEED} step ${step}`

    const cases: PropertyCase[] = []
    for (let index = 0; index < 3; index++) {
      const post = await fx.postCase()
      cases.push({
        caseId: post.caseId,
        addReport: async () =>
          (await fx.postReport(post.postId, (await fx.member('reporter')).id)).id,
        stamps: new Map(post.reportIds.map((id) => [id, null])),
        firstDecisionAt: null,
        lastRevision: null,
      })
      const comment = await fx.commentCase()
      cases.push({
        caseId: comment.caseId,
        addReport: async () =>
          (await fx.commentReport(comment.commentId, (await fx.member('reporter')).id))
            .id,
        stamps: new Map(comment.reportIds.map((id) => [id, null])),
        firstDecisionAt: null,
        lastRevision: null,
      })
    }
    const operators = [await admin(), await admin(), await moderator()]
    const history: Applied[] = []
    const tally = { terminal: 0, escalate: 0, refused: 0, retried: 0, reported: 0 }

    const randomDecision = (): DecisionRequest => {
      const action = pick<ModerationDecisionAction>([
        'resolve',
        'resolve',
        'resolve',
        'takedown',
        'takedown',
        'release',
        'release',
        'escalate',
        'escalate',
        'ban',
      ])
      if (action !== 'ban') return { action, reason: `${REASON} ${action}` }
      return {
        action,
        reason: `${REASON} ban`,
        ban: pick([{ kind: 'permanent' }, SEVEN_DAY_BAN]),
      }
    }

    const assertStamps = async (step: number) => {
      const rows = [
        ...(await prisma.communityPostReport.findMany({
          where: { id: { startsWith: fx.runId } },
          select: { id: true, resolved_at: true },
        })),
        ...(await prisma.communityCommentReport.findMany({
          where: { id: { startsWith: fx.runId } },
          select: { id: true, resolved_at: true },
        })),
      ]
      const actual = new Map(
        rows.map((row) => [row.id, row.resolved_at?.toISOString() ?? null])
      )
      for (const target of cases)
        for (const [id, stamp] of target.stamps)
          expect(actual.get(id), `${label(step)} report ${id}`).toBe(stamp)
    }

    try {
      for (let step = 0; step < STEPS; step++) {
        const at = after(step + 1)
        clock.at(at)
        ctx.pinWallClock(at)
        const target = pick(cases)
        const roll = random()

        if (roll < 0.15) {
          target.stamps.set(await target.addReport(), null)
          tally.reported++
        } else if (roll < 0.3 && history.length > 0) {
          const prior = pick(history)
          const retried = applied(
            await prior.staff.decide(prior.target.caseId, {
              ...prior.input,
              expectedRevision: STALE_REVISION,
            })
          )
          expectReplayOf(retried, prior.body, label(step))
          tally.retried++
        } else {
          const staff = pick(operators)
          const input: DecisionRequest = {
            ...randomDecision(),
            mutationId: randomUUID(),
          }
          const fresh = await staff.detail(target.caseId)
          const useStale = roll < 0.4 && target.lastRevision !== null
          const response = await staff.decide(target.caseId, {
            ...input,
            expectedRevision: useStale ? target.lastRevision! : fresh.revision,
          })
          target.lastRevision = fresh.revision
          expect(
            response.status,
            `${label(step)} ${JSON.stringify(response.body)}`
          ).toBeLessThan(500)
          if (response.status === 200) {
            const body = applied(response)
            if (input.action !== 'escalate') {
              target.firstDecisionAt ??= at.toISOString()
              for (const [id, stamp] of target.stamps)
                if (stamp === null) target.stamps.set(id, at.toISOString())
              tally.terminal++
            } else {
              tally.escalate++
            }
            expect(body.firstDecisionAt, label(step)).toBe(target.firstDecisionAt)
            history.push({ staff, target, input, body })
          } else {
            const code = refusal(response).code
            expect(ALLOWED_REFUSALS.has(code), `${label(step)} ${code}`).toBe(true)
            tally.refused++
          }
          const detail = await operators[0]!.detail(target.caseId)
          expect(detail.firstDecisionAt, label(step)).toBe(target.firstDecisionAt)
        }
        await assertStamps(step)
      }
    } finally {
      ctx.unpinWallClock()
    }

    // The run must have exercised each branch, or it proved nothing.
    expect(tally.terminal).toBeGreaterThan(15)
    expect(tally.escalate).toBeGreaterThan(3)
    expect(tally.refused).toBeGreaterThan(10)
    expect(tally.retried).toBeGreaterThan(10)
    expect(tally.reported).toBeGreaterThan(10)

    for (const target of cases) {
      const rows = await decisionsOf(target.caseId)
      const terminal = rows
        .filter((row) => row.is_terminal)
        .map((row) => row.decided_at.getTime())
      expect(
        terminal.length > 0 ? new Date(Math.min(...terminal)).toISOString() : null
      ).toBe(target.firstDecisionAt)
    }
  }, 120_000)
})

describe('I-C-REKEY: an erased post splits the case by report (D5, TEA-14)', () => {
  it('keeps each orphan its history by overlap, and the old id is gone', async () => {
    const T1 = after(10)
    const T2 = after(20)
    const T3 = after(30)
    const seeded = await fx.postCase({ reports: 2 })
    const staff = await moderator()
    const boss = await admin()

    clock.at(T1)
    applied(await staff.decide(seeded.caseId, { action: 'resolve', reason: REASON }))
    const late = await fx.postReport(seeded.postId, (await fx.member('reporter')).id)
    clock.at(T2)
    applied(await staff.decide(seeded.caseId, { action: 'escalate', reason: REASON }))

    clock.at(after(25))
    await erasePost(seeded.postId)

    const oldDetail = await boss.get(`/api/v1/moderation/cases/${seeded.caseId}`)
    expect(oldDetail.status).toBe(404)
    const oldDecision = await boss.decide(seeded.caseId, {
      action: 'resolve',
      reason: REASON,
      expectedRevision: STALE_REVISION,
    })
    expect(oldDecision.status).toBe(404)
    expect(refusal(oldDecision).code).toBe('case_not_found')

    // The rows outlive the re-key and keep the key they were written under.
    const rows = await decisionsOf(seeded.caseId)
    expect(rows.map((row) => row.action)).toEqual(['resolve', 'escalate'])
    expect(rows.every((row) => row.post_id === null)).toBe(true)

    for (const reportId of seeded.reportIds) {
      const detail = await boss.detail(`orphan-post.${reportId}`)
      expect(detail.firstDecisionAt).toBe(T1.toISOString())
      expect(detail.escalated).toBe(true)
      expect(detail.priorActions.map((action) => action.action)).toEqual(
        expect.arrayContaining(['resolve', 'escalate']) as unknown
      )
    }
    const lateCase = `orphan-post.${late.id}`
    const lateDetail = await boss.detail(lateCase)
    expect(lateDetail.firstDecisionAt).toBeNull()
    expect(lateDetail.escalated).toBe(true)
    expect(lateDetail.priorActions.map((action) => action.action)).toContain('escalate')
    expect(lateDetail.allowedActions).toContain('resolve')

    const queue = moderationCasesResponseSchema.parse(
      (await boss.get('/api/v1/moderation/cases?limit=50')).body
    ).data.items
    expect(queue.find((item) => item.caseId === lateCase)?.escalated).toBe(true)

    // A moderator stays behind the escalation an orphan inherited.
    const refused = await staff.decide(lateCase, { action: 'resolve', reason: REASON })
    expect(refusal(refused).code).toBe('admin_required')

    clock.at(T3)
    const body = applied(
      await boss.decide(lateCase, { action: 'resolve', reason: REASON })
    )
    expect(body.firstDecisionAt).toBe(T3.toISOString())
    const newRows = await decisionsOf(lateCase)
    expect(newRows.map((row) => [row.sequence, row.action])).toEqual([[1, 'resolve']])
    expect(newRows[0]!.report_ids).toEqual([late.id])

    const afterResolve = await boss.detail(lateCase)
    expect(afterResolve.firstDecisionAt).toBe(T3.toISOString())
    expect(afterResolve.escalated).toBe(false)
    // The older orphans keep their first decision, however the new key moved on.
    expect(
      (await boss.detail(`orphan-post.${seeded.reportIds[0]}`)).firstDecisionAt
    ).toBe(T1.toISOString())
    const stamped = await prisma.communityPostReport.findUniqueOrThrow({
      where: { id: seeded.reportIds[0] },
    })
    expect(stamped.resolved_at).toEqual(T1)
  })
})

describe('I-C-BAN-RACE: one member banned from two cases at once (D5)', () => {
  async function memberWithTwoCases() {
    const author = await fx.member('author')
    const left = await fx.postCase({ author })
    const right = await fx.postCase({ author })
    const pendingPost = await fx.post({ authorId: author.id, status: 'pending_review' })
    const thirdParty = await fx.post({ authorId: (await fx.member('owner')).id })
    const pendingComment = await fx.comment({
      postId: thirdParty.id,
      authorId: author.id,
      status: 'pending_screening',
    })
    return { author, left, right, pendingPost, pendingComment }
  }

  it('lets the first temporary ban apply and answers already_banned to the second', async () => {
    const { author, left, right, pendingPost, pendingComment } =
      await memberWithTwoCases()
    const first = await moderator()
    const second = await moderator()
    const revisions = [
      (await first.detail(left.caseId)).revision,
      (await second.detail(right.caseId)).revision,
    ]

    const responses = await withHeldConnection(async (held) => {
      await holdSubjectGuard(held, author.id)
      const pending = [
        first.decide(left.caseId, {
          action: 'ban',
          reason: REASON,
          ban: SEVEN_DAY_BAN,
          expectedRevision: revisions[0],
        }),
        second.decide(right.caseId, {
          action: 'ban',
          reason: REASON,
          ban: SEVEN_DAY_BAN,
          expectedRevision: revisions[1],
        }),
      ]
      await waitForBlocked(2)
      await held.query('COMMIT')
      return Promise.all(pending)
    })

    expect(responses.map((response) => response.status).sort()).toEqual([200, 409])
    const winnerIndex = responses.findIndex((response) => response.status === 200)
    const winner = responses[winnerIndex]!
    const loser = responses[1 - winnerIndex]!
    const winnerCase = winnerIndex === 0 ? left : right
    const loserCase = winnerIndex === 0 ? right : left
    expect(refusal(loser)).toMatchObject({
      code: 'action_not_applicable',
      detail: 'already_banned',
    })

    const body = applied(winner)
    const sanctions = await prisma.communitySanction.findMany({
      where: { user_id: author.id },
    })
    expect(sanctions.map((row) => row.id)).toEqual([body.sanction!.sanctionId])
    expect(sanctions[0]!.lifted_at).toBeNull()
    expect(sanctions[0]!.case_key).toBe(winnerCase.caseId)

    // Hidden once: one marker on what the ban holds, and the loser's own target left alone.
    const marker = banMarker(body.sanction!.sanctionId)
    expect(await postStatus(winnerCase.postId)).toBe('flagged')
    expect(await postStatus(loserCase.postId)).toBe('published')
    const heldPost = await prisma.lookbookPost.findUniqueOrThrow({
      where: { id: pendingPost.id },
    })
    expect(heldPost).toMatchObject({ status: 'flagged', moderation_reason: marker })
    const heldComment = await prisma.communityComment.findUniqueOrThrow({
      where: { id: pendingComment.id },
    })
    expect(heldComment).toMatchObject({
      status: 'held_for_review',
      screening_reason: marker,
    })

    expect(await decisionsOf(loserCase.caseId)).toEqual([])
    expect((await postReports(loserCase.postId)).map((row) => row.resolved_at)).toEqual([
      null,
    ])
    expect(ctx.sessions.invalidateUserSessions).toHaveBeenCalledTimes(1)
  })

  it('keeps one active row when two admins race permanent bans, and the loser reads the moved case', async () => {
    const { author, left, right } = await memberWithTwoCases()
    const first = await admin()
    const second = await admin()
    const revisions = [
      (await first.detail(left.caseId)).revision,
      (await second.detail(right.caseId)).revision,
    ]
    const responses = await withHeldConnection(async (held) => {
      await holdSubjectGuard(held, author.id)
      const pending = [
        first.decide(left.caseId, {
          action: 'ban',
          reason: REASON,
          ban: { kind: 'permanent' },
          expectedRevision: revisions[0],
        }),
        second.decide(right.caseId, {
          action: 'ban',
          reason: REASON,
          ban: { kind: 'permanent' },
          expectedRevision: revisions[1],
        }),
      ]
      await waitForBlocked(2)
      await held.query('COMMIT')
      return Promise.all(pending)
    })

    expect(responses.map((response) => response.status).sort()).toEqual([200, 409])
    const winnerIndex = responses.findIndex((response) => response.status === 200)
    const loser = responses[1 - winnerIndex]!
    const loserCase = winnerIndex === 0 ? right : left
    // A permanent ban hides the loser's target too, so its revision moved first (TEA-08).
    expect(refusal(loser).code).toBe('case_conflict')

    const sanctions = await prisma.communitySanction.findMany({
      where: { user_id: author.id, lifted_at: null },
    })
    expect(sanctions).toHaveLength(1)
    expect(await decisionsOf(loserCase.caseId)).toEqual([])
    expect((await postReports(loserCase.postId)).map((row) => row.resolved_at)).toEqual([
      null,
    ])
  })
})

/**
 * Runs `work` once, right after the first read of a case through either repository.
 * The hook does not care which read comes second, so a GET that reads once still runs it once.
 */
function afterFirstCaseRead(work: () => Promise<void>) {
  const queue: ModerationQueueRepository = boot.app.get(ModerationQueueRepository)
  // `bind` answers `any` under this tsconfig, so each original keeps its signature by name.
  const queueLoad = queue.loadCase.bind(queue) as ModerationQueueRepository['loadCase']
  const decisionLoad = repository.loadCase.bind(
    repository
  ) as ModerationDecisionsRepository['loadCase']
  let fired = false
  const once = async () => {
    if (fired) return
    fired = true
    await work()
  }
  const spies = [
    vi
      .spyOn(queue, 'loadCase')
      .mockImplementation(async (...args: Parameters<typeof queueLoad>) => {
        const loaded = await queueLoad(...args)
        await once()
        return loaded
      }),
    vi
      .spyOn(repository, 'loadCase')
      .mockImplementation(async (...args: Parameters<typeof decisionLoad>) => {
        const loaded = await decisionLoad(...args)
        await once()
        return loaded
      }),
  ]
  return {
    fired: () => fired,
    restore: () => spies.forEach((spy) => spy.mockRestore()),
  }
}

describe('I-C-SPLIT-READ: a report commits inside the GET (D5)', () => {
  /** Whatever the GET returned, a decision on its revision may only touch the reports it displayed. */
  async function decideOnSplitRead(params: {
    caseId: string
    firstReportId: string
    firstReporterAlias: string
    lateReporterAlias: string
    commitLateReport: () => Promise<string>
    loadStamps: () => Promise<{ id: string; resolved: boolean }[]>
  }) {
    const staff = await moderator()
    let lateReportId = ''
    const hook = afterFirstCaseRead(async () => {
      lateReportId = await params.commitLateReport()
    })
    const detail = await staff.detail(params.caseId).finally(hook.restore)
    expect(hook.fired(), 'the case read never ran, so nothing interleaved').toBe(true)

    const shown = detail.reporters.map((reporter) => reporter.identity.alias)
    expect(shown).toContain(params.firstReporterAlias)
    const lateShown = shown.includes(params.lateReporterAlias)
    const displayed = lateShown
      ? [params.firstReportId, lateReportId]
      : [params.firstReportId]

    const response = await staff.decide(params.caseId, {
      action: 'resolve',
      reason: REASON,
      expectedRevision: detail.revision,
    })

    const rows = await decisionsOf(params.caseId)
    const stamps = await params.loadStamps()
    const touched = new Set([
      ...rows.flatMap((row) => row.report_ids),
      ...stamps.filter((stamp) => stamp.resolved).map((stamp) => stamp.id),
    ])
    expect(
      [...touched].filter((id) => !displayed.includes(id)),
      'reports the decision touched that the GET never displayed'
    ).toEqual([])

    if (lateShown) {
      applied(response)
      expect(rows.flatMap((row) => row.report_ids).sort()).toEqual([...displayed].sort())
      return
    }
    expect(response.status, JSON.stringify(response.body)).toBe(409)
    expect(refusal(response).code).toBe('case_conflict')
    expect(rows).toEqual([])
    expect(stamps).toEqual(
      expect.arrayContaining([{ id: lateReportId, resolved: false }]) as unknown
    )
  }

  it('never stamps a post report the GET did not display', async () => {
    const seeded = await fx.postCase()
    const late = await fx.member('reporter')
    await decideOnSplitRead({
      caseId: seeded.caseId,
      firstReportId: seeded.reportIds[0]!,
      firstReporterAlias: seeded.reporters[0]!.alias,
      lateReporterAlias: late.alias,
      commitLateReport: () =>
        withHeldConnection(async (held) => {
          const id = await openPostReportInsert(held, seeded.postId, late.id)
          await held.query('COMMIT')
          return id
        }),
      loadStamps: async () =>
        (await postReports(seeded.postId)).map((report) => ({
          id: report.id,
          resolved: report.resolved_at !== null,
        })),
    })
  })

  it('never stamps a comment report the GET did not display', async () => {
    const seeded = await fx.commentCase()
    const late = await fx.member('reporter')
    await decideOnSplitRead({
      caseId: seeded.caseId,
      firstReportId: seeded.reportIds[0]!,
      firstReporterAlias: seeded.reporters[0]!.alias,
      lateReporterAlias: late.alias,
      commitLateReport: () =>
        withHeldConnection(async (held) => {
          const id = await openCommentReportInsert(
            held,
            seeded.postId,
            seeded.commentId,
            late.id
          )
          await held.query('COMMIT')
          return id
        }),
      loadStamps: async () =>
        (
          await prisma.communityCommentReport.findMany({
            where: { comment_id: seeded.commentId },
          })
        ).map((report) => ({ id: report.id, resolved: report.resolved_at !== null })),
    })
  })
})

describe('I-C-RECIPROCAL-BAN: two operators ban each other at once (D2, D5)', () => {
  /** The two-key form of the advisory lock the test holds and the trigger waits on. */
  const GATE_KEY = [6110, 2] as const
  /** Below the 7 s decision transaction timeout, so a held request is still alive at release. */
  const GATE_DEADLINE_MS = 5_000

  /** Holds every `CommunitySanction` insert until the work commits `gate`, by a trigger the test owns. */
  async function withSanctionGate<T>(
    work: (gate: HeldConnection) => Promise<T>
  ): Promise<T> {
    await prisma.$executeRawUnsafe(`
      CREATE FUNCTION tea_gate_sanction() RETURNS trigger LANGUAGE plpgsql AS $fn$
      BEGIN PERFORM pg_advisory_xact_lock_shared(${GATE_KEY[0]}, ${GATE_KEY[1]}); RETURN NEW; END $fn$`)
    await prisma.$executeRawUnsafe(
      'CREATE TRIGGER tea_gate_sanction BEFORE INSERT ON "CommunitySanction" FOR EACH ROW EXECUTE FUNCTION tea_gate_sanction()'
    )
    try {
      return await withHeldConnection(async (gate) => {
        await gate.query('SELECT pg_advisory_xact_lock($1::int, $2::int)', [...GATE_KEY])
        return work(gate)
      })
    } finally {
      await prisma.$executeRawUnsafe(
        'DROP TRIGGER tea_gate_sanction ON "CommunitySanction"'
      )
      await prisma.$executeRawUnsafe('DROP FUNCTION tea_gate_sanction()')
    }
  }

  /** Sessions waiting on the held gate, and every other session a lock holds back. */
  async function lockWaiters(): Promise<{ atGate: number; elsewhere: number }> {
    const { rows } = await monitor.query<{ at_gate: string; blocked: string }>(
      `SELECT
         (SELECT count(*) FROM pg_locks
          WHERE locktype = 'advisory' AND NOT granted AND objsubid = 2
            AND classid = $1::int::oid AND objid = $2::int::oid
            AND database = (SELECT oid FROM pg_database WHERE datname = current_database())
         )::text AS at_gate,
         (SELECT count(*) FROM pg_stat_activity
          WHERE datname = current_database() AND cardinality(pg_blocking_pids(pid)) > 0
         )::text AS blocked`,
      [...GATE_KEY]
    )
    const atGate = Number(rows[0]!.at_gate)
    return { atGate, elsewhere: Number(rows[0]!.blocked) - atGate }
  }

  /** Bounded, and each pass is one database round trip. False at the deadline, so the caller still releases. */
  async function pollWaiters(
    reached: (waiters: { atGate: number; elsewhere: number }) => boolean
  ): Promise<boolean> {
    const deadline = performance.now() + GATE_DEADLINE_MS
    while (performance.now() < deadline) {
      if (reached(await lockWaiters())) return true
    }
    return false
  }

  /** Each operator wrote a reported post and reads the other's, with unrelated reporters and no shared engagement. */
  async function reciprocalPair() {
    const authorA = await fx.member('operator')
    const authorB = await fx.member('operator')
    const postA = await fx.postCase({ author: authorA })
    const postB = await fx.postCase({ author: authorB })
    const staffA = boot.staff('moderator', authorA)
    const staffB = boot.staff('moderator', authorB)
    return {
      sides: [
        {
          staff: staffA,
          target: postB,
          revision: (await staffA.detail(postB.caseId)).revision,
        },
        {
          staff: staffB,
          target: postA,
          revision: (await staffB.detail(postA.caseId)).revision,
        },
      ] as const,
    }
  }

  type ReciprocalSides = Awaited<ReturnType<typeof reciprocalPair>>['sides']

  const sendBans = (sides: ReciprocalSides) =>
    sides.map((side) =>
      side.staff.decide(side.target.caseId, {
        action: 'ban',
        reason: REASON,
        ban: SEVEN_DAY_BAN,
        expectedRevision: side.revision,
      })
    )

  it('applies one ban and answers operator_sanctioned to the other when both pass their first reads', async () => {
    const { sides } = await reciprocalPair()

    const { responses, forced } = await withSanctionGate(async (gate) => {
      const pending = sendBans(sides)
      // Both at the insert is the unserialized shape. One at the insert and one behind a lock is the serialized shape.
      const forced = await pollWaiters(
        ({ atGate, elsewhere }) => atGate === 2 || (atGate === 1 && elsewhere >= 1)
      )
      await gate.query('COMMIT')
      return { responses: await Promise.all(pending), forced }
    })

    expect(forced, 'the two bans never reached the forced interleaving').toBe(true)
    expect(
      responses.map((response) => response.status).sort(),
      JSON.stringify(responses.map((response) => response.body as unknown))
    ).toEqual([200, 403])
    const winnerIndex = responses.findIndex((response) => response.status === 200)
    const winner = sides[winnerIndex]!
    const loser = sides[1 - winnerIndex]!
    expect(refusal(responses[1 - winnerIndex]!).code).toBe('operator_sanctioned')

    const active = await prisma.communitySanction.findMany({
      where: {
        user_id: { in: sides.map((side) => side.staff.id) },
        lifted_at: null,
      },
    })
    expect(active.map((row) => row.user_id)).toEqual([loser.staff.id])
    expect(
      (await decisionsOf(winner.target.caseId)).map((row) => [
        row.action,
        row.moderator_id,
      ])
    ).toEqual([['ban', winner.staff.id]])

    expect(await decisionsOf(loser.target.caseId)).toEqual([])
    expect(
      await prisma.moderationDecision.count({ where: { moderator_id: loser.staff.id } })
    ).toBe(0)
    expect(await auditCount(loser.staff.id)).toBe(0)
    expect(await postStatus(loser.target.postId)).toBe('published')
    expect(
      (await postReports(loser.target.postId)).map((report) => report.resolved_at)
    ).toEqual([null])
  })

  it('never lets both apply over ten unforced rounds with fresh operators', async () => {
    for (let round = 0; round < 10; round++) {
      const { sides } = await reciprocalPair()
      const responses = await Promise.all(sendBans(sides))
      const message = `round ${round}: ${JSON.stringify(
        responses.map((response) => [response.status, response.body as unknown])
      )}`
      expect(responses.map((response) => response.status).sort(), message).toEqual([
        200, 403,
      ])
      const loserIndex = responses.findIndex((response) => response.status === 403)
      expect(refusal(responses[loserIndex]!).code, message).toBe('operator_sanctioned')
      expect(
        await prisma.communitySanction.count({
          where: {
            user_id: { in: sides.map((side) => side.staff.id) },
            lifted_at: null,
          },
        }),
        message
      ).toBe(1)
      expect(await decisionsOf(sides[loserIndex]!.target.caseId), message).toEqual([])
    }
  })

  it('holds an appeal step behind an in-flight ban of its operator, then answers operator_sanctioned', async () => {
    const authorA = await fx.member('operator')
    const reported = await fx.postCase({ author: authorA })
    const staffA = boot.staff('moderator', authorA)
    const staffB = await moderator()
    const unrelated = await fx.sanction(await fx.member('member'))
    const revision = (await staffB.detail(reported.caseId)).revision

    const { ban, appeal, banHeld, appealWaited } = await withSanctionGate(
      async (gate) => {
        const banPending = staffB.decide(reported.caseId, {
          action: 'ban',
          reason: REASON,
          ban: SEVEN_DAY_BAN,
          expectedRevision: revision,
        })
        const banHeld = await pollWaiters(({ atGate }) => atGate === 1)

        let appealSettled = false
        const appealPending = staffA
          .appeal(unrelated.id, { status: 'requested', reason: REASON })
          .then((response) => {
            appealSettled = true
            return response
          })
        const appealWaited = await pollWaiters(
          ({ elsewhere }) => elsewhere >= 1 || appealSettled
        ).then((reached) => reached && !appealSettled)

        await gate.query('COMMIT')
        const [ban, appeal] = await Promise.all([banPending, appealPending])
        return { ban, appeal, banHeld, appealWaited }
      }
    )

    expect(banHeld, 'the ban never reached the sanction insert').toBe(true)
    applied(ban)
    expect(appeal.status, JSON.stringify(appeal.body)).toBe(403)
    expect(refusal(appeal).code).toBe('operator_sanctioned')
    expect(appealWaited, 'the appeal step did not wait on the in-flight ban').toBe(true)

    expect(
      await prisma.moderationDecision.count({ where: { moderator_id: staffA.id } })
    ).toBe(0)
    expect(
      await prisma.auditLog.count({
        where: { user_id: staffA.id, event_type: 'moderation_appeal_recorded' },
      })
    ).toBe(0)
    const sanctionAfter = await prisma.communitySanction.findUniqueOrThrow({
      where: { id: unrelated.id },
    })
    expect(sanctionAfter.appeal_status).toBe('not_requested')
  })
})

describe('I-C-ERASE-IN-FLIGHT: erasure lands while a decision takes its locks (D5)', () => {
  /** Erases right after the decision's first case read, then expects the closed answer and no record. */
  async function decideThroughErasure(
    seeded: { caseId: string; postId: string; author: { id: string } },
    decision: Pick<DecisionRequest, 'action' | 'ban'>
  ) {
    const staff = await moderator()
    const { revision } = await staff.detail(seeded.caseId)
    ctx.afterCommit.mockClear()
    const hook = afterFirstCaseRead(() => erasePost(seeded.postId))
    const response = await staff
      .decide(seeded.caseId, { ...decision, reason: REASON, expectedRevision: revision })
      .finally(hook.restore)
    expect(hook.fired(), 'the decision never read the case').toBe(true)
    expect(
      await prisma.lookbookPost.findUnique({ where: { id: seeded.postId } })
    ).toBeNull()

    const body = JSON.stringify(response.body)
    expect(response.status, body).toBe(404)
    const closed = moderationDecisionErrorSchema.safeParse(response.body)
    expect(closed.success, body).toBe(true)
    expect(closed.data?.code, body).toBe('case_not_found')

    expect(await decisionsOf(seeded.caseId)).toEqual([])
    expect(await auditCount(staff.id)).toBe(0)
    expect(
      await prisma.moderationEvent.count({ where: { reviewed_by_id: staff.id } })
    ).toBe(0)
    expect(
      await prisma.communitySanction.count({ where: { user_id: seeded.author.id } })
    ).toBe(0)
    expect(ctx.afterCommit).not.toHaveBeenCalled()
  }

  it.each([
    ['resolve', { action: 'resolve' }],
    ['ban', { action: 'ban', ban: SEVEN_DAY_BAN }],
  ] as const)(
    'answers case_not_found to a %s on the erased post',
    async (_name, decision) => {
      const seeded = await fx.postCase()
      await decideThroughErasure(seeded, decision)
      const reports = await prisma.communityPostReport.findMany({
        where: { id: { in: seeded.reportIds } },
      })
      expect(reports.map((report) => [report.post_id, report.resolved_at])).toEqual([
        [null, null],
      ])
    }
  )

  it('answers case_not_found to a takedown of a comment whose post was erased', async () => {
    const seeded = await fx.commentCase()
    await decideThroughErasure(seeded, { action: 'takedown' })
    const reports = await prisma.communityCommentReport.findMany({
      where: { id: { in: seeded.reportIds } },
    })
    expect(reports.map((report) => [report.comment_id, report.resolved_at])).toEqual([
      [null, null],
    ])
  })
})

describe('I-C-DB-BACKSTOP: the unique index holds without the case lock (D5)', () => {
  it('maps a real duplicate sequence on a case with no other lock to case_conflict', async () => {
    // An orphan has no post row and no guard, so with the case lock stubbed nothing else serializes its deciders.
    const seeded = await fx.orphanPostCase()
    const first = await moderator()
    const second = await moderator()
    const { revision } = await first.detail(seeded.caseId)
    const lockCase = vi.spyOn(repository, 'lockCase').mockResolvedValue(undefined)
    const inserts = vi.spyOn(repository, 'insertDecision')
    try {
      const responses = await withHeldConnection(async (held) => {
        // Both read the same revision, then meet this row at the stamp.
        await held.query(
          'SELECT id FROM "CommunityPostReport" WHERE id = $1 FOR UPDATE',
          [seeded.reportId]
        )
        const pending = [
          first.decide(seeded.caseId, {
            action: 'resolve',
            reason: REASON,
            expectedRevision: revision,
          }),
          second.decide(seeded.caseId, {
            action: 'resolve',
            reason: REASON,
            expectedRevision: revision,
          }),
        ]
        await waitForBlocked(2)
        await held.query('COMMIT')
        return Promise.all(pending)
      })

      expect(responses.map((response) => response.status).sort()).toEqual([200, 409])
      const loser = responses.find((response) => response.status === 409)!
      const refused = refusal(loser)
      expect(refused.code).toBe('case_conflict')
      // Both reached the insert, so the code came from the index and not from the revision read.
      expect(inserts).toHaveBeenCalledTimes(2)
      expect(inserts.mock.calls.map(([, data]) => data.sequence)).toEqual([1, 1])
      expect(refused.currentRevision).toBe((await first.detail(seeded.caseId)).revision)

      const rows = await decisionsOf(seeded.caseId)
      expect(rows.map((row) => row.sequence)).toEqual([1])
      const winnerId = rows[0]!.moderator_id
      const loserId = winnerId === first.id ? second.id : first.id
      expect(await auditCount(winnerId!)).toBe(1)
      expect(await auditCount(loserId)).toBe(0)
      expect(
        await prisma.moderationEvent.count({ where: { reviewed_by_id: loserId } })
      ).toBe(0)
    } finally {
      lockCase.mockRestore()
      inserts.mockRestore()
    }
  })

  it('rolls a takedown back when a row of the same sequence lands from outside', async () => {
    const seeded = await fx.postCase({ reports: 2 })
    const staff = await moderator()
    const { revision } = await staff.detail(seeded.caseId)
    const lockCase = vi.spyOn(repository, 'lockCase').mockResolvedValue(undefined)
    const spy = vi.spyOn(repository, 'insertDecision').mockImplementation(((
      tx: Prisma.TransactionClient,
      data: Prisma.ModerationDecisionUncheckedCreateInput
    ) =>
      prisma.moderationDecision
        .create({
          data: {
            case_key: data.case_key,
            sequence: data.sequence,
            source: data.source,
            report_ids: [],
            action: 'escalate',
            reason: 'Landed from outside.',
            moderator_role: 'admin',
            mutation_id: randomUUID(),
            payload_hash: 'intruder',
            response: {},
            is_terminal: false,
            decided_at: NOW,
          },
        })
        .then(() => tx.moderationDecision.create({ data }))) as never)
    try {
      const response = await staff.decide(seeded.caseId, {
        action: 'takedown',
        reason: REASON,
        expectedRevision: revision,
      })
      expect(response.status).toBe(409)
      const refused = refusal(response)
      expect(refused.code).toBe('case_conflict')
      expect(refused.currentRevision).toBe((await staff.detail(seeded.caseId)).revision)
      expect(refused.currentRevision).not.toBe(revision)

      expect(await postStatus(seeded.postId)).toBe('published')
      expect((await postReports(seeded.postId)).map((row) => row.resolved_at)).toEqual([
        null,
        null,
      ])
      expect(await auditCount(staff.id)).toBe(0)
      expect(
        await prisma.moderationEvent.count({ where: { reviewed_by_id: staff.id } })
      ).toBe(0)
      expect((await decisionsOf(seeded.caseId)).map((row) => row.reason)).toEqual([
        'Landed from outside.',
      ])
    } finally {
      lockCase.mockRestore()
      spy.mockRestore()
    }
  })

  it('still gives one winner on a live post, whose row lock serializes without the case lock', async () => {
    const seeded = await fx.postCase()
    const first = await moderator()
    const second = await moderator()
    const { revision } = await first.detail(seeded.caseId)
    const lockCase = vi.spyOn(repository, 'lockCase').mockResolvedValue(undefined)
    try {
      const responses = await Promise.all([
        first.decide(seeded.caseId, {
          action: 'takedown',
          reason: REASON,
          expectedRevision: revision,
        }),
        second.decide(seeded.caseId, {
          action: 'resolve',
          reason: REASON,
          expectedRevision: revision,
        }),
      ])
      expect(responses.map((response) => response.status).sort()).toEqual([200, 409])
      expect(refusal(responses.find((r) => r.status === 409)!).code).toBe('case_conflict')
      expect(await decisionsOf(seeded.caseId)).toHaveLength(1)
    } finally {
      lockCase.mockRestore()
    }
  })
})

// This row cannot force 40P01.
// It drives every lock path of one member at once and proves what must hold whatever the scheduler does.
// The retry itself is proved in community-privacy.spec.ts, which raises 40P01 directly.
describe('I-C-DEADLOCK: mixed load on one member (D5)', () => {
  const ATTEMPTS = 3
  const LOAD_ACTIONS: DecisionRequest[] = [
    { action: 'resolve', reason: REASON },
    { action: 'takedown', reason: REASON },
    { action: 'ban', reason: REASON, ban: SEVEN_DAY_BAN },
    { action: 'escalate', reason: REASON },
    { action: 'resolve', reason: REASON },
  ]

  it('finishes with closed results and stays inside three attempts per decision', async () => {
    const author = await fx.member('author')
    const posts: Awaited<ReturnType<DecisionFixtures['postCase']>>[] = []
    for (let index = 0; index < 3; index++) posts.push(await fx.postCase({ author }))
    const comments: Awaited<ReturnType<DecisionFixtures['commentCase']>>[] = []
    for (let index = 0; index < 2; index++)
      comments.push(await fx.commentCase({ author }))
    const staff = await admin()

    const decisionPlan = await Promise.all(
      [...posts, ...comments].map(async (seeded, index) => ({
        caseId: seeded.caseId,
        input: {
          ...LOAD_ACTIONS[index % LOAD_ACTIONS.length]!,
          expectedRevision: (await staff.detail(seeded.caseId)).revision,
        },
      }))
    )
    const reporter = await fx.member('reporter')
    const lockCalls = vi.spyOn(repository, 'lockCase')
    const erasure = new CommunityRepository(prisma)

    try {
      const [decisions, reports, withdrawal] = await Promise.all([
        Promise.all(decisionPlan.map(({ caseId, input }) => staff.decide(caseId, input))),
        // Nine requests in all, no more than the pool of 9 vitest.config.ts pins, so no transaction waits out maxWait.
        // Only the first post and the first comment race a report, because a report moves the revision.
        Promise.all([
          Promise.resolve(reportPost(reporter.id, posts[0]!.postId)),
          Promise.resolve(
            reportComment(reporter.id, comments[0]!.postId, comments[0]!.commentId)
          ),
        ]),
        Promise.resolve(withdrawPost(author.id, posts[0]!.postId)),
        erasure.requestErasureForUser(author.id, NOW),
      ])

      const closedCodes = moderationDecisionErrorCodeSchema.options as readonly string[]
      for (const response of decisions) {
        const message = JSON.stringify(response.body)
        expect(response.status, message).toBeLessThan(500)
        if (response.status !== 200)
          expect(closedCodes, message).toContain(refusal(response).code)
      }
      for (const response of [...reports, withdrawal])
        expect(response.status, JSON.stringify(response.body)).toBeLessThan(500)

      const attempts = new Map<string, number>()
      for (const [, caseKey] of lockCalls.mock.calls)
        attempts.set(caseKey, (attempts.get(caseKey) ?? 0) + 1)
      expect(attempts.size).toBe(decisionPlan.length)
      for (const [caseKey, count] of attempts)
        expect(count, caseKey).toBeLessThanOrEqual(ATTEMPTS)

      // Nothing is left holding a lock, and the record agrees with the answers.
      expect(await blockedStatements()).toEqual([])
      const appliedCount = decisions.filter((response) => response.status === 200).length
      // Erasure moves no post status and nothing else touches the revision of the second post.
      expect(appliedCount).toBeGreaterThanOrEqual(1)
      const rows = await prisma.moderationDecision.count({
        where: { case_key: { in: decisionPlan.map(({ caseId }) => caseId) } },
      })
      expect(rows).toBe(appliedCount)
      expect(
        await prisma.communitySanction.count({
          where: { user_id: author.id, lifted_at: null },
        })
      ).toBeLessThanOrEqual(1)
      const authored = await prisma.lookbookPost.findMany({
        where: { user_id: author.id },
        select: { erasure_requested_at: true },
      })
      expect(authored.every((post) => post.erasure_requested_at !== null)).toBe(true)
    } finally {
      lockCalls.mockRestore()
    }
  }, 90_000)
})
