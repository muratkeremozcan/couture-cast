// Story 6.11 test owner: the five decisions against a real, migrated Postgres, behind the real guards.
// I-D-RESOLVE-GROUP, -RESOLVE-ORPHAN, -RELEASE-POST, -RELEASE-COMMENT, -RELEASE-REFUSALS,
// -TAKEDOWN-POST, -TAKEDOWN-COMMENT, -TAKEDOWN-TWICE, -ESCALATE, -ALLOWED-PARITY, -DETAIL-READONLY,
// -REVISION-CONTINUITY, -ATOMIC, -AUDIT-SHAPE, -PRIOR-ACTIONS, -HTTP, -SELF-REVIEW, -OPERATOR-SANCTIONED, -HOSTILE, -ACTIONS-COMPAT.
import { randomUUID } from 'node:crypto'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import {
  moderationCaseDetailResponseSchema,
  moderationDecisionActionSchema,
  moderationDecisionResponseSchema,
  type ModerationDecisionAction,
} from '@couture/api-client/contracts/http'
import { CommunityModerationActionsService } from '../src/modules/community/community-moderation.actions.js'
import { checksumTables } from './helpers/moderation-queue-context.js'
import {
  decisionFixtures,
  moderationDecisionsTestContext,
  type DecisionBoot,
} from './helpers/moderation-decisions-seed.js'

const NOW = new Date('2026-11-04T12:00:00.000Z')
const REASON = 'Breaks the community rules.'
const ctx = moderationDecisionsTestContext()
const { prisma, clock, flagValues } = ctx
const fx = decisionFixtures(prisma, clock.now)

let boot: DecisionBoot
const codeOf = (response: { body: unknown }) => (response.body as { code?: string }).code

beforeAll(async () => {
  clock.at(NOW)
  boot = await ctx.bootApp()
}, 120_000)

afterEach(() => {
  clock.at(NOW)
  flagValues.clear()
})

const moderator = async () => boot.staff('moderator', await fx.operator())
const admin = async () => boot.staff('admin', await fx.operator())
const decisions = (where: object) =>
  prisma.moderationDecision.findMany({ where, orderBy: { sequence: 'asc' } })
const auditRows = (userId: string, eventType = 'moderation_decision_applied') =>
  prisma.auditLog.findMany({ where: { user_id: userId, event_type: eventType } })

describe('I-D-RESOLVE-GROUP: resolving a grouped post case', () => {
  it('stamps every report with one time, leaves the target, writes one decision and one audit row', async () => {
    const seeded = await fx.postCase({ reports: 3 })
    const staff = await moderator()
    const response = await staff.decide(seeded.caseId, {
      action: 'resolve',
      reason: REASON,
    })
    expect(response.status).toBe(200)
    const body = moderationDecisionResponseSchema.parse(response.body)
    expect(body.data).toMatchObject({
      caseId: seeded.caseId,
      action: 'resolve',
      decidedAt: NOW.toISOString(),
      firstDecisionAt: NOW.toISOString(),
      caseStatus: 'resolved',
      escalated: false,
      targetStatus: 'published',
      sanction: null,
      replayed: false,
      cacheInvalidation: 'completed',
    })

    const reports = await prisma.communityPostReport.findMany({
      where: { post_id: seeded.postId },
    })
    expect(reports.map((report) => report.resolved_at?.getTime())).toEqual([
      NOW.getTime(),
      NOW.getTime(),
      NOW.getTime(),
    ])
    const post = await prisma.lookbookPost.findUniqueOrThrow({
      where: { id: seeded.postId },
    })
    expect(post.status).toBe('published')
    expect(post.updated_at).toEqual(seeded.post.updated_at)

    const rows = await decisions({ case_key: seeded.caseId })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      sequence: 1,
      source: 'post',
      post_id: seeded.postId,
      action: 'resolve',
      reason: REASON,
      moderator_id: staff.id,
      moderator_role: 'moderator',
      subject_user_id: seeded.author.id,
      is_terminal: true,
    })
    expect([...rows[0]!.report_ids].sort()).toEqual([...seeded.reportIds].sort())

    const events = await prisma.moderationEvent.findMany({
      where: { post_id: seeded.postId, action: 'report_resolved' },
    })
    expect(events).toHaveLength(3)
    for (const event of events) {
      expect(event.reviewed_by_id).toBe(staff.id)
      expect(event.reason).toBe(REASON)
    }
    expect(await auditRows(staff.id)).toHaveLength(1)
  })
})

describe('I-D-RESOLVE-ORPHAN: resolving a case whose target is gone', () => {
  it('stamps an orphan post report and reads the prior action from the decision row', async () => {
    const seeded = await fx.orphanPostCase()
    const staff = await moderator()
    const response = await staff.decide(seeded.caseId, {
      action: 'resolve',
      reason: REASON,
    })
    expect(response.status).toBe(200)
    const report = await prisma.communityPostReport.findUniqueOrThrow({
      where: { id: seeded.reportId },
    })
    expect(report.resolved_at).toEqual(NOW)
    const detail = await staff.detail(seeded.caseId)
    expect(detail.priorActions.map((action) => action.action)).toContain('resolve')
    expect(detail.firstDecisionAt).toBe(NOW.toISOString())
  })

  it('stamps an orphan comment report', async () => {
    const seeded = await fx.orphanCommentCase()
    const staff = await moderator()
    const response = await staff.decide(seeded.caseId, {
      action: 'resolve',
      reason: REASON,
    })
    expect(response.status).toBe(200)
    const report = await prisma.communityCommentReport.findUniqueOrThrow({
      where: { id: seeded.reportId },
    })
    expect(report.resolved_at).toEqual(NOW)
  })
})

describe('I-D-RELEASE-POST: releasing what the screener flagged', () => {
  it('publishes the post and keeps the machine verdict on the record', async () => {
    const seeded = await fx.postCase({
      status: 'flagged',
      moderationReason: 'unsafe_class',
      engineVersion: 'engine-v9',
      screening: true,
    })
    const staff = await moderator()
    const response = await staff.decide(seeded.caseId, {
      action: 'release',
      reason: REASON,
    })
    expect(response.status).toBe(200)
    expect(moderationDecisionResponseSchema.parse(response.body).data.targetStatus).toBe(
      'published'
    )
    const post = await prisma.lookbookPost.findUniqueOrThrow({
      where: { id: seeded.postId },
    })
    expect(post).toMatchObject({
      status: 'published',
      moderation_reason: 'unsafe_class',
      moderation_engine_version: 'engine-v9',
      published_at: NOW,
    })
    const event = await prisma.moderationEvent.findFirstOrThrow({
      where: { post_id: seeded.postId, action: 'released_by_operator' },
    })
    expect(event).toMatchObject({
      reviewed_by_id: staff.id,
      reason: REASON,
      overridden_engine_version: 'engine-v9',
    })
    const reports = await prisma.communityPostReport.findMany({
      where: { post_id: seeded.postId },
    })
    expect(
      reports.every((report) => report.resolved_at?.getTime() === NOW.getTime())
    ).toBe(true)
    const outbox = await prisma.$queryRaw<{ kind: string }[]>`
      SELECT kind FROM "CommunityDomainOutbox" WHERE post_id = ${seeded.postId}`
    expect(outbox.map((row) => row.kind)).toContain('post.published')
  })

  it('returns a post published once to its original feed position', async () => {
    const original = new Date(NOW.getTime() - 86_400_000)
    const seeded = await fx.postCase({ status: 'flagged', publishedAt: original })
    const staff = await moderator()
    expect(
      (await staff.decide(seeded.caseId, { action: 'release', reason: REASON })).status
    ).toBe(200)
    const post = await prisma.lookbookPost.findUniqueOrThrow({
      where: { id: seeded.postId },
    })
    expect(post.published_at).toEqual(original)
  })
})

describe('I-D-RELEASE-COMMENT: releasing a held comment (D4, TEA-04)', () => {
  it('allocates the next sequence on first publication and records engagement once', async () => {
    const seeded = await fx.commentCase({
      status: 'held_for_review',
      screeningReason: 'text_policy_match',
      screeningVersion: 'engine-v2',
    })
    const before = await prisma.lookbookPost.findUniqueOrThrow({
      where: { id: seeded.postId },
    })
    const analyticsBefore = await prisma.communityCommentAnalyticsOutbox.count({
      where: { event_type: 'community_comment_published' },
    })
    const staff = await moderator()
    const response = await staff.decide(seeded.caseId, {
      action: 'release',
      reason: REASON,
    })
    expect(response.status).toBe(200)
    const comment = await prisma.communityComment.findUniqueOrThrow({
      where: { id: seeded.commentId },
    })
    expect(comment).toMatchObject({
      status: 'published',
      publication_sequence: before.comment_publication_sequence + 1,
      screening_reason: null,
      screening_version: 'engine-v2',
      published_at: NOW,
    })
    const after = await prisma.lookbookPost.findUniqueOrThrow({
      where: { id: seeded.postId },
    })
    expect(after.comment_publication_sequence).toBe(
      before.comment_publication_sequence + 1
    )
    expect(
      await prisma.communityCommentAnalyticsOutbox.count({
        where: { event_type: 'community_comment_published' },
      })
    ).toBe(analyticsBefore + 1)
  })

  it('keeps the sequence and fires no second engagement on a comment published before', async () => {
    const seeded = await fx.commentCase({
      status: 'blocked',
      wasPublished: true,
      screeningReason: 'operator_takedown',
    })
    const eventsBefore = await prisma.communityCommentAnalyticsOutbox.count({
      where: { event_type: 'community_comment_published' },
    })
    const staff = await moderator()
    expect(
      (await staff.decide(seeded.caseId, { action: 'release', reason: REASON })).status
    ).toBe(200)
    const comment = await prisma.communityComment.findUniqueOrThrow({
      where: { id: seeded.commentId },
    })
    expect(comment.status).toBe('published')
    expect(comment.publication_sequence).toBe(seeded.comment.publication_sequence)
    expect(comment.published_at).toEqual(seeded.comment.published_at)
    expect(
      await prisma.communityCommentAnalyticsOutbox.count({
        where: { event_type: 'community_comment_published' },
      })
    ).toBe(eventsBefore)
  })

  it('refuses a release while the parent post or the root is hidden, as publication does', async () => {
    const staff = await admin()
    const onHiddenPost = await fx.commentCase({
      status: 'held_for_review',
      postStatus: 'flagged',
    })
    const refused = await staff.decide(onHiddenPost.caseId, {
      action: 'release',
      reason: REASON,
    })
    expect(refused.status).toBe(409)
    expect(refused.body).toMatchObject({ detail: 'author_ineligible' })

    const owner = await fx.member('owner')
    const parent = await fx.post({ authorId: owner.id })
    const root = await fx.comment({
      postId: parent.id,
      authorId: owner.id,
      status: 'blocked',
      wasPublished: true,
    })
    const author = await fx.member('author')
    const reply = await fx.comment({
      postId: parent.id,
      authorId: author.id,
      parentId: root.id,
      status: 'held_for_review',
    })
    await fx.commentReport(reply.id, (await fx.member('reporter')).id)
    const underRoot = await staff.decide(`comment.${reply.id}`, {
      action: 'release',
      reason: REASON,
    })
    expect(underRoot.status).toBe(409)
    expect(underRoot.body).toMatchObject({ detail: 'author_ineligible' })
  })

  it('releases a screening_failed comment', async () => {
    const seeded = await fx.commentCase({
      status: 'screening_failed',
      screeningReason: 'screening_unavailable',
    })
    const staff = await moderator()
    expect(
      (await staff.decide(seeded.caseId, { action: 'release', reason: REASON })).status
    ).toBe(200)
  })
})

describe('I-D-RELEASE-REFUSALS: each refusal comes from a real state and writes nothing (TEA-09)', () => {
  const refused = async (
    caseId: string,
    action: ModerationDecisionAction,
    detail: string
  ) => {
    const staff = await admin()
    const before = await checksumTables(prisma)
    const response = await staff.decide(caseId, { action, reason: REASON })
    expect(response.status, JSON.stringify(response.body)).toBe(409)
    expect(response.body).toMatchObject({ code: 'action_not_applicable', detail })
    expect(await decisions({ case_key: caseId })).toEqual([])
    expect(await checksumTables(prisma)).toEqual(before)
  }

  it('target_not_held on a published post and an author_deleted comment', async () => {
    await refused((await fx.postCase()).caseId, 'release', 'target_not_held')
    await refused(
      (await fx.commentCase({ status: 'author_deleted', wasPublished: true })).caseId,
      'release',
      'target_not_held'
    )
  })

  it('target_erased on an orphan, an anonymized post, a post being erased and an erased comment', async () => {
    await refused((await fx.orphanPostCase()).caseId, 'release', 'target_erased')
    await refused(
      (await fx.postCase({ status: 'flagged', anonymizedAt: NOW })).caseId,
      'release',
      'target_erased'
    )
    await refused(
      (await fx.postCase({ status: 'flagged', erasureRequestedAt: NOW })).caseId,
      'release',
      'target_erased'
    )
    const seeded = await fx.commentCase({ status: 'erased', wasPublished: true })
    await prisma.communityComment.update({
      where: { id: seeded.commentId },
      data: { user_id: null },
    })
    await refused(seeded.caseId, 'release', 'target_erased')
  })

  it('subject_banned when the author has an active ban', async () => {
    const seeded = await fx.postCase({ status: 'flagged' })
    await fx.sanction(seeded.author)
    await refused(seeded.caseId, 'release', 'subject_banned')
  })

  it('author_ineligible when a teen author has no consent left', async () => {
    const author = await fx.teen()
    const seeded = await fx.postCase({ status: 'flagged', author })
    await fx.lapseConsent(author.id)
    await refused(seeded.caseId, 'release', 'author_ineligible')
  })

  it('community_writes_closed when the write flag is off for the author, and when its read fails', async () => {
    const seeded = await fx.postCase({ status: 'flagged' })
    flagValues.set('community_write_enabled', false)
    await refused(seeded.caseId, 'release', 'community_writes_closed')
    flagValues.clear()
    const failing = await fx.postCase({ status: 'flagged' })
    ctx.failFlag('community_write_enabled')
    await refused(failing.caseId, 'release', 'community_writes_closed')
  })
})

describe('I-D-TAKEDOWN-POST: taking down a live post', () => {
  it('flags the post, records the removal, stamps reports and starts no erasure clock', async () => {
    const seeded = await fx.postCase({ reports: 2 })
    const staff = await moderator()
    const response = await staff.decide(seeded.caseId, {
      action: 'takedown',
      reason: REASON,
    })
    expect(response.status).toBe(200)
    expect(moderationDecisionResponseSchema.parse(response.body).data.targetStatus).toBe(
      'flagged'
    )
    const post = await prisma.lookbookPost.findUniqueOrThrow({
      where: { id: seeded.postId },
    })
    expect(post).toMatchObject({
      status: 'flagged',
      moderation_reason: REASON,
      erasure_requested_at: null,
      anonymized_at: null,
    })
    const event = await prisma.moderationEvent.findFirstOrThrow({
      where: { post_id: seeded.postId, action: 'taken_down_by_operator' },
    })
    expect(event).toMatchObject({ reviewed_by_id: staff.id, reason: REASON })
    expect(event.content_snapshot).toBeTruthy()
    const open = await prisma.communityPostReport.count({
      where: { post_id: seeded.postId, resolved_at: null },
    })
    expect(open).toBe(0)
    const outbox = await prisma.$queryRaw<{ kind: string }[]>`
      SELECT kind FROM "CommunityDomainOutbox" WHERE post_id = ${seeded.postId}`
    expect(outbox.map((row) => row.kind)).toContain('post.removed')
  })

  it('takes down a resolved case on new evidence', async () => {
    const seeded = await fx.postCase()
    const staff = await moderator()
    expect(
      (await staff.decide(seeded.caseId, { action: 'resolve', reason: REASON })).status
    ).toBe(200)
    clock.at(new Date(NOW.getTime() + 60_000))
    const response = await staff.decide(seeded.caseId, {
      action: 'takedown',
      reason: REASON,
    })
    expect(response.status).toBe(200)
    const rows = await decisions({ case_key: seeded.caseId })
    expect(rows.map((row) => row.sequence)).toEqual([1, 2])
    expect(rows[1]!.report_ids).toEqual(seeded.reportIds)
  })
})

describe('I-D-TAKEDOWN-COMMENT: taking down a live comment (TEA-04)', () => {
  it('blocks the comment, keeps the body, and removes it from thread and count', async () => {
    const owner = await fx.member('owner')
    const parent = await fx.post({ authorId: owner.id })
    const root = await fx.comment({ postId: parent.id, authorId: owner.id })
    const author = await fx.member('author')
    const reply = await fx.comment({
      postId: parent.id,
      authorId: author.id,
      parentId: root.id,
    })
    const reporter = await fx.member('reporter')
    await fx.commentReport(reply.id, reporter.id)
    const reader = boot.member(owner.id)
    const before = (await reader
      .get(`/api/v1/community/posts/${parent.id}/comments`)
      .expect(200)) as { body: { data: { items: { id: string; replyCount: number }[] } } }
    expect(before.body.data.items.find((item) => item.id === root.id)?.replyCount).toBe(1)

    const staff = await moderator()
    const response = await staff.decide(`comment.${reply.id}`, {
      action: 'takedown',
      reason: REASON,
    })
    expect(response.status, JSON.stringify(response.body)).toBe(200)
    const comment = await prisma.communityComment.findUniqueOrThrow({
      where: { id: reply.id },
    })
    expect(comment).toMatchObject({
      status: 'blocked',
      body: reply.body,
      screening_reason: 'operator_takedown',
      publication_sequence: reply.publication_sequence,
    })
    const after = (await reader
      .get(`/api/v1/community/posts/${parent.id}/comments`)
      .expect(200)) as { body: { data: { items: { id: string; replyCount: number }[] } } }
    expect(after.body.data.items.find((item) => item.id === root.id)?.replyCount).toBe(0)
    const replies = (await reader
      .get(`/api/v1/community/posts/${parent.id}/comments/${root.id}/replies`)
      .expect(200)) as { body: { data: { items: { id: string }[] } } }
    expect(replies.body.data.items.map((item) => item.id)).not.toContain(reply.id)
    const outbox = await prisma.$queryRaw<{ kind: string }[]>`
      SELECT kind FROM "CommunityDomainOutbox" WHERE comment_id = ${reply.id}`
    expect(outbox.map((row) => row.kind)).toContain('comment.removed')
  })
})

describe('I-D-TAKEDOWN-TWICE: a second takedown', () => {
  it('answers target_not_published and leaves the first time alone', async () => {
    const seeded = await fx.postCase()
    const staff = await moderator()
    expect(
      (await staff.decide(seeded.caseId, { action: 'takedown', reason: REASON })).status
    ).toBe(200)
    clock.at(new Date(NOW.getTime() + 60_000))
    const second = await staff.decide(seeded.caseId, {
      action: 'takedown',
      reason: REASON,
    })
    expect(second.status).toBe(409)
    expect(second.body).toMatchObject({
      code: 'action_not_applicable',
      detail: 'target_not_published',
    })
    const detail = await staff.detail(seeded.caseId)
    expect(detail.firstDecisionAt).toBe(NOW.toISOString())
  })
})

describe('I-D-ESCALATE: escalation records a decision and nothing else (D4)', () => {
  it('changes no report, target, due time or queue order, and sends nothing', async () => {
    const seeded = await fx.postCase({ reports: 2 })
    const staff = await moderator()
    const before = await checksumTables(prisma)
    const outboxBefore = await prisma.communityNotificationIntent.count()
    const response = await staff.decide(seeded.caseId, {
      action: 'escalate',
      reason: REASON,
    })
    expect(response.status).toBe(200)
    const data = moderationDecisionResponseSchema.parse(response.body).data
    expect(data).toMatchObject({
      escalated: true,
      firstDecisionAt: null,
      caseStatus: 'open',
    })
    const after = await checksumTables(prisma)
    for (const table of [
      'CommunityPostReport',
      'CommunityCommentReport',
      'LookbookPost',
      'CommunityComment',
    ])
      expect(after[table], table).toBe(before[table])
    expect(await prisma.communityNotificationIntent.count()).toBe(outboxBefore)
    const rows = await decisions({ case_key: seeded.caseId })
    expect(rows[0]).toMatchObject({ action: 'escalate', is_terminal: false })
    const event = await prisma.moderationEvent.findFirstOrThrow({
      where: { post_id: seeded.postId, action: 'escalated_by_operator' },
    })
    expect(event.reviewed_by_id).toBe(staff.id)
    expect(await staff.detail(seeded.caseId)).toMatchObject({
      escalated: true,
      allowedActions: [],
    })
  })

  it('refuses a second escalate, sends a moderator to an admin, and clears on a terminal decision', async () => {
    const seeded = await fx.postCase()
    const staff = await moderator()
    const boss = await admin()
    expect(
      (await staff.decide(seeded.caseId, { action: 'escalate', reason: REASON })).status
    ).toBe(200)
    const again = await staff.decide(seeded.caseId, {
      action: 'escalate',
      reason: REASON,
    })
    expect(again.status).toBe(409)
    expect(again.body).toMatchObject({ detail: 'already_escalated' })
    const terminal = await staff.decide(seeded.caseId, {
      action: 'takedown',
      reason: REASON,
    })
    expect(terminal.status).toBe(403)
    expect(terminal.body).toMatchObject({ code: 'admin_required' })
    const adminView = await boss.detail(seeded.caseId)
    expect(adminView.allowedActions).toEqual(expect.arrayContaining(['takedown']))
    expect(adminView.allowedActions).not.toContain('escalate')
    const applied = await boss.decide(seeded.caseId, {
      action: 'takedown',
      reason: REASON,
    })
    expect(applied.status).toBe(200)
    expect((await boss.detail(seeded.caseId)).escalated).toBe(false)
  })

  it('shows the marker on the queue row', async () => {
    const seeded = await fx.postCase()
    const staff = await moderator()
    await staff.decide(seeded.caseId, { action: 'escalate', reason: REASON })
    const queue = (await staff.get('/api/v1/moderation/cases?limit=50').expect(200)) as {
      body: { data: { items: { caseId: string; escalated: boolean }[] } }
    }
    const row = queue.body.data.items.find((item) => item.caseId === seeded.caseId)
    expect(row?.escalated).toBe(true)
  })
})

describe('I-D-REVISION-CONTINUITY: the response names the state the next read sees', () => {
  it.each([
    ['resolve', {}, 'post'],
    ['takedown', {}, 'post'],
    ['escalate', {}, 'post'],
    ['ban', { ban: { kind: 'temporary', durationDays: 7 } }, 'post'],
    ['ban', { ban: { kind: 'permanent' } }, 'comment'],
    ['takedown', {}, 'comment'],
    ['release', {}, 'held'],
  ] as const)('%s %j on a %s case', async (action, extra, kind) => {
    const seeded =
      kind === 'post'
        ? await fx.postCase({ reports: 2 })
        : kind === 'comment'
          ? await fx.commentCase({ reports: 2 })
          : await fx.commentCase({ status: 'held_for_review' })
    const staff = await admin()
    const response = await staff.decide(seeded.caseId, {
      action,
      reason: REASON,
      ...extra,
    })
    expect(response.status, JSON.stringify(response.body)).toBe(200)
    const data = moderationDecisionResponseSchema.parse(response.body).data
    const detail = await staff.detail(seeded.caseId)
    expect(detail.revision).toBe(data.revision)
    expect(detail.escalated).toBe(data.escalated)
    expect(detail.firstDecisionAt).toBe(data.firstDecisionAt)
    expect(detail.status).toBe(data.caseStatus)
  })
})

describe('I-D-ALLOWED-PARITY: the panel offers exactly what the route accepts (D4)', () => {
  const states = () =>
    [
      ['published post', () => fx.postCase()],
      ['flagged post', () => fx.postCase({ status: 'flagged' })],
      [
        'resolved published post',
        async () => {
          const seeded = await fx.postCase()
          await prisma.communityPostReport.updateMany({
            where: { post_id: seeded.postId },
            data: { resolved_at: NOW },
          })
          return seeded
        },
      ],
      ['withdrawn post', () => fx.postCase({ status: 'withdrawn' })],
      ['published comment', () => fx.commentCase()],
      ['held comment', () => fx.commentCase({ status: 'held_for_review' })],
      ['orphan post', () => fx.orphanPostCase()],
      [
        'banned author',
        async () => {
          const seeded = await fx.postCase({ status: 'flagged' })
          await fx.sanction(seeded.author)
          return seeded
        },
      ],
    ] as const

  it.each(['moderator', 'admin'] as const)(
    'for a %s, across every state, list and enforcement agree',
    async (role) => {
      for (const [label, build] of states()) {
        for (const action of moderationDecisionActionSchema.options) {
          const kinds = action === 'ban' ? (['temporary', 'permanent'] as const) : [null]
          for (const kind of kinds) {
            // A fresh case per probe, because an accepted action changes it.
            const seeded = await build()
            const staff = await (role === 'admin' ? admin() : moderator())
            const detail = await staff.detail(seeded.caseId)
            const listed =
              kind === null
                ? detail.allowedActions.includes(action)
                : detail.banKinds.includes(kind)
            const response = await staff.decide(seeded.caseId, {
              action,
              reason: REASON,
              ...(kind === 'temporary'
                ? { ban: { kind, durationDays: 7 } }
                : kind === 'permanent'
                  ? { ban: { kind } }
                  : {}),
            })
            expect(
              response.status === 200,
              `${role} ${label} ${action} ${kind}: ${JSON.stringify(response.body)}`
            ).toBe(listed)
          }
        }
      }
    },
    240_000
  )
})

describe('I-D-DETAIL-READONLY: the detail stays a read (6.10 D10)', () => {
  it('writes exactly one audit row and nothing else, with the new fields present', async () => {
    const seeded = await fx.postCase()
    const staff = await moderator()
    const before = await checksumTables(prisma)
    const decisionsBefore = await prisma.moderationDecision.count()
    const sanctionsBefore = await prisma.communitySanction.count()
    const response = await staff
      .get(`/api/v1/moderation/cases/${seeded.caseId}`)
      .expect(200)
    moderationCaseDetailResponseSchema.parse(response.body)
    expect(await checksumTables(prisma)).toEqual(before)
    expect(await prisma.moderationDecision.count()).toBe(decisionsBefore)
    expect(await prisma.communitySanction.count()).toBe(sanctionsBefore)
    expect(await auditRows(staff.id, 'moderation_case_viewed')).toHaveLength(1)
  })

  it('still answers 200 with an empty list when the decisions flag read fails (TEA-11)', async () => {
    const seeded = await fx.postCase()
    const staff = await moderator()
    ctx.failFlag('moderation_decisions_enabled')
    expect(await staff.detail(seeded.caseId)).toMatchObject({
      allowedActions: [],
      banKinds: [],
    })
  })

  it('gives an empty list when the decisions flag is off', async () => {
    const seeded = await fx.postCase()
    const staff = await moderator()
    flagValues.set('moderation_decisions_enabled', false)
    expect(await staff.detail(seeded.caseId)).toMatchObject({
      allowedActions: [],
      banKinds: [],
    })
  })
})

describe('I-D-ATOMIC: one decision is one transaction (Boundaries)', () => {
  /** Fails one table's inserts for rows carrying this run, by a trigger the test owns. */
  const failing = async (table: string, work: () => Promise<void>) => {
    await prisma.$executeRawUnsafe(`
      CREATE FUNCTION tea_fail_insert() RETURNS trigger LANGUAGE plpgsql AS $fn$
      BEGIN RAISE EXCEPTION 'injected failure'; END $fn$`)
    await prisma.$executeRawUnsafe(
      `CREATE TRIGGER tea_fail BEFORE INSERT ON "${table}" FOR EACH ROW EXECUTE FUNCTION tea_fail_insert()`
    )
    try {
      await work()
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER tea_fail ON "${table}"`)
      await prisma.$executeRawUnsafe('DROP FUNCTION tea_fail_insert()')
    }
  }

  it.each([
    ['AuditLog', 503],
    ['ModerationDecision', 503],
    ['ModerationEvent', 503],
    ['CommunitySanction', 503],
  ] as const)('rolls everything back when %s fails', async (table, status) => {
    const seeded = await fx.postCase({ reports: 2 })
    const staff = await admin()
    const revision = (await staff.detail(seeded.caseId)).revision
    const before = await checksumTables(prisma)
    const decisionsBefore = await prisma.moderationDecision.count()
    const sanctionsBefore = await prisma.communitySanction.count()
    const auditBefore = await prisma.auditLog.count({
      where: { event_type: 'moderation_decision_applied' },
    })
    ctx.afterCommit.mockClear()
    await failing(table, async () => {
      const response = await staff
        .post(`/api/v1/moderation/cases/${seeded.caseId}/decisions`)
        .send({
          action: 'ban',
          ban: { kind: 'permanent' },
          reason: REASON,
          mutationId: randomUUID(),
          expectedRevision: revision,
        })
      expect(response.status, JSON.stringify(response.body)).toBe(status)
      expect(codeOf(response)).toBe('audit_unavailable')
      expect(JSON.stringify(response.body)).not.toContain(REASON)
    })
    expect(await checksumTables(prisma)).toEqual(before)
    expect(await prisma.moderationDecision.count()).toBe(decisionsBefore)
    expect(await prisma.communitySanction.count()).toBe(sanctionsBefore)
    expect(
      await prisma.auditLog.count({
        where: { event_type: 'moderation_decision_applied' },
      })
    ).toBe(auditBefore)
    expect(ctx.afterCommit).not.toHaveBeenCalled()
  })

  it('rolls a comment case back when its audit row fails', async () => {
    const seeded = await fx.commentCase()
    const staff = await moderator()
    const revision = (await staff.detail(seeded.caseId)).revision
    const before = await checksumTables(prisma)
    await failing('CommunityCommentAudit', async () => {
      const response = await staff
        .post(`/api/v1/moderation/cases/${seeded.caseId}/decisions`)
        .send({
          action: 'takedown',
          reason: REASON,
          mutationId: randomUUID(),
          expectedRevision: revision,
        })
      expect(response.status).toBe(503)
      expect(codeOf(response)).toBe('audit_unavailable')
    })
    expect(await checksumTables(prisma)).toEqual(before)
  })

  it('rolls back and answers 503 for a moderator with no User row', async () => {
    const seeded = await fx.postCase()
    const ghost = boot.staff('moderator', { id: `missing-${randomUUID()}` })
    const expectedRevision = (await (await moderator()).detail(seeded.caseId)).revision
    const before = await checksumTables(prisma)
    const response = await ghost.decide(seeded.caseId, {
      action: 'resolve',
      reason: REASON,
      expectedRevision,
    })
    expect(response.status).toBe(503)
    expect(codeOf(response)).toBe('audit_unavailable')
    expect(await checksumTables(prisma)).toEqual(before)
    expect(await decisions({ case_key: seeded.caseId })).toEqual([])
  })
})

describe('I-D-AUDIT-SHAPE: the attributed audit event (D13)', () => {
  it.each([
    ['resolve', {}, undefined],
    ['takedown', {}, undefined],
    ['escalate', {}, undefined],
    ['ban', { ban: { kind: 'temporary', durationDays: 7 } }, 'temporary'],
  ] as const)('records %s with only the allowed keys', async (action, extra, banKind) => {
    const seeded = await fx.postCase()
    const staff = await moderator()
    const response = await staff.decide(seeded.caseId, {
      action,
      reason: 'Unique reason text 7f3c.',
      ...extra,
    })
    expect(response.status, JSON.stringify(response.body)).toBe(200)
    const data = moderationDecisionResponseSchema.parse(response.body).data
    const rows = await auditRows(staff.id)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.event_data).toEqual({
      decisionId: data.decisionId,
      caseId: seeded.caseId,
      action,
      role: 'moderator',
      ...(banKind ? { banKind } : {}),
    })
    const text = JSON.stringify(rows[0])
    expect(text).not.toContain('Unique reason text')
    expect(text).not.toContain(seeded.author.id)
    expect(text).not.toContain(seeded.author.alias)
  })

  it('names the session identity even when another identity is claimed in the request', async () => {
    const seeded = await fx.postCase()
    const staff = await moderator()
    const revision = (await staff.detail(seeded.caseId)).revision
    const claimed = await fx.operator()
    const response = await staff
      .post(
        `/api/v1/moderation/cases/${seeded.caseId}/decisions?moderatorId=${claimed.id}`
      )
      .set('x-user-id', claimed.id)
      .set('x-moderator-id', claimed.id)
      .send({
        action: 'resolve',
        reason: REASON,
        mutationId: randomUUID(),
        expectedRevision: revision,
      })
    expect(response.status).toBe(200)
    const [row] = await decisions({ case_key: seeded.caseId })
    expect(row!.moderator_id).toBe(staff.id)
    expect(await auditRows(claimed.id)).toEqual([])
  })
})

describe('I-D-PRIOR-ACTIONS: the history reads correctly (D13, TEA-15)', () => {
  it('labels operator rows on a comment case as operator and screener rows as screening', async () => {
    const seeded = await fx.commentCase({
      status: 'blocked',
      screeningReason: 'text_policy_match',
    })
    await prisma.communityCommentAudit.create({
      data: {
        report_id: seeded.reportIds[0]!,
        action: 'blocked',
        reason: 'text_policy_match',
        occurred_at: NOW,
      },
    })
    const staff = await moderator()
    clock.at(new Date(NOW.getTime() + 1000))
    expect(
      (await staff.decide(seeded.caseId, { action: 'release', reason: REASON })).status
    ).toBe(200)
    const detail = await staff.detail(seeded.caseId)
    const kinds = Object.fromEntries(
      detail.priorActions.map((action) => [action.action, action.actorKind])
    )
    expect(kinds.blocked).toBe('screening')
    expect(kinds.released_by_operator).toBe('operator')
    expect(kinds.report_resolved).toBe('operator')
  })

  it('writes the target action once however many reports the comment case has', async () => {
    const seeded = await fx.commentCase({ reports: 3 })
    const staff = await moderator()
    expect(
      (await staff.decide(seeded.caseId, { action: 'takedown', reason: REASON })).status
    ).toBe(200)
    const rows = await prisma.communityCommentAudit.findMany({
      where: { report_id: { in: seeded.reportIds } },
    })
    expect(rows.filter((row) => row.action === 'taken_down_by_operator')).toHaveLength(1)
    expect(rows.filter((row) => row.action === 'report_resolved')).toHaveLength(3)
    expect(rows.filter((row) => row.action === 'blocked')).toEqual([])
  })

  it('still shows the action on a comment case with no open report', async () => {
    const seeded = await fx.commentCase()
    await prisma.communityCommentReport.updateMany({
      where: { comment_id: seeded.commentId },
      data: { resolved_at: NOW },
    })
    const staff = await moderator()
    expect(
      (await staff.decide(seeded.caseId, { action: 'takedown', reason: REASON })).status
    ).toBe(200)
    const detail = await staff.detail(seeded.caseId)
    expect(detail.priorActions.map((action) => action.action)).toContain(
      'taken_down_by_operator'
    )
  })

  it('never shows a ban marker as an operator note', async () => {
    const seeded = await fx.postCase({
      status: 'flagged',
      moderationReason: 'community_ban:some-sanction',
    })
    const staff = await moderator()
    const detail = await staff.detail(seeded.caseId)
    expect(detail.findings?.operatorNote ?? null).toBeNull()
    expect(JSON.stringify(detail)).not.toContain('community_ban:')
  })
})

describe('I-D-HTTP: bodies and headers through the real guards', () => {
  const body = () => ({
    action: 'resolve',
    reason: REASON,
    mutationId: randomUUID(),
    expectedRevision: '0123456789abcdef',
  })
  const appeal = () => ({
    status: 'requested',
    reason: REASON,
    mutationId: randomUUID(),
  })
  const decisionPath = (id: string) => `/api/v1/moderation/cases/${id}/decisions`
  const appealPath = (id: string) => `/api/v1/moderation/sanctions/${id}/appeal`
  const noStore = (response: { headers: Record<string, string> }) =>
    expect(response.headers['cache-control']).toBe('private, no-store')

  it('answers 401 with no token, on both routes', async () => {
    const seeded = await fx.postCase()
    for (const [path, payload] of [
      [decisionPath(seeded.caseId), body()],
      [appealPath('anything'), appeal()],
    ] as const) {
      const response = await boot.anonymous().post(path).send(payload)
      expect(response.status).toBe(401)
      noStore(response)
    }
  })

  it.each(['guardian', 'teen'])(
    'answers %s with one 403 body for real and unknown ids',
    async (role) => {
      const seeded = await fx.postCase()
      const caller = boot.staff(role, await fx.member(role))
      const bodies: string[] = []
      for (const path of [
        decisionPath(seeded.caseId),
        decisionPath('post.unknown'),
        decisionPath('%20nonsense'),
        appealPath('unknown'),
      ]) {
        const response = await caller
          .post(path)
          .send(path.includes('appeal') ? appeal() : body())
        expect(response.status, path).toBe(403)
        noStore(response)
        bodies.push(JSON.stringify(response.body))
      }
      expect(new Set(bodies).size).toBe(1)
      expect(await decisions({ case_key: seeded.caseId })).toEqual([])
    }
  )

  it('keeps a non-moderator from learning the flag state or validation rules', async () => {
    const caller = boot.staff('guardian', await fx.member('guardian'))
    const open = await caller.post(decisionPath('post.x')).send(body())
    flagValues.set('moderation_decisions_enabled', false)
    flagValues.set('moderation_console_enabled', false)
    const closed = await caller.post(decisionPath('post.x')).send({ nonsense: true })
    expect(closed.status).toBe(403)
    expect(closed.body).toEqual(open.body)
    expect(ctx.flags.getFeatureFlag).not.toHaveBeenCalledWith(
      'moderation_decisions_enabled',
      expect.anything()
    )
  })

  it('answers 503 for a moderator with either flag off or a failing read, ahead of input checks', async () => {
    const staff = await moderator()
    flagValues.set('moderation_decisions_enabled', false)
    const off = await staff.post(decisionPath('post.x')).send({ nonsense: true })
    expect(off.status).toBe(503)
    expect(codeOf(off)).toBe('moderation_decisions_disabled')
    noStore(off)
    flagValues.clear()
    flagValues.set('moderation_console_enabled', false)
    const console = await staff.post(decisionPath('post.x')).send({ nonsense: true })
    expect(console.status).toBe(503)
    expect(codeOf(console)).toBe('moderation_console_disabled')
    flagValues.clear()
    ctx.failFlag('moderation_decisions_enabled')
    const failed = await staff.post(appealPath('x')).send(appeal())
    expect(failed.status).toBe(503)
    expect(codeOf(failed)).toBe('moderation_decisions_disabled')
  })

  it('answers 400 invalid_decision with no echo, including a forged moderator', async () => {
    const staff = await moderator()
    const seeded = await fx.postCase()
    const forged = await fx.operator()
    for (const payload of [
      { ...body(), moderatorId: forged.id },
      { ...body(), reason: ' ' },
      { ...body(), reason: 'x'.repeat(1001) },
      { ...body(), reason: 'unsafe_class' },
      { ...body(), action: 'delete' },
    ]) {
      const response = await staff.post(decisionPath(seeded.caseId)).send(payload)
      expect(response.status, JSON.stringify(payload)).toBe(400)
      expect(codeOf(response)).toBe('invalid_decision')
      noStore(response)
      expect(JSON.stringify(response.body)).not.toContain(forged.id)
      expect(JSON.stringify(response.body)).not.toContain('unsafe_class')
    }
    expect(await decisions({ case_key: seeded.caseId })).toEqual([])
  })

  it('answers 404 for an unknown or malformed case with one body', async () => {
    const staff = await moderator()
    const unknown = await staff.post(decisionPath('post.unknown')).send(body())
    const malformed = await staff.post(decisionPath('nonsense')).send(body())
    expect(unknown.status).toBe(404)
    expect(codeOf(unknown)).toBe('case_not_found')
    noStore(unknown)
    expect(malformed.status).toBe(404)
    expect(malformed.body).toEqual(unknown.body)
  })

  it('answers 409 with a current revision on a stale read, marked no-store', async () => {
    const seeded = await fx.postCase()
    const staff = await moderator()
    const response = await staff.post(decisionPath(seeded.caseId)).send(body())
    expect(response.status).toBe(409)
    expect(codeOf(response)).toBe('case_conflict')
    expect((response.body as { currentRevision?: string }).currentRevision).toMatch(
      /^[0-9a-f]{16}$/
    )
    noStore(response)
  })
})

describe('I-D-SELF-REVIEW: nobody rules on their own case (D2)', () => {
  it.each(['moderator', 'admin'] as const)(
    'refuses a %s who wrote the target or filed a report, for every action',
    async (role) => {
      for (const action of moderationDecisionActionSchema.options) {
        const authorStaff = await fx.operator()
        const authored = await fx.postCase({ author: authorStaff })
        const reporterStaff = await fx.operator()
        const reported = await fx.postCase()
        await fx.postReport(reported.postId, reporterStaff.id, {
          resolvedAt: NOW,
        })
        for (const [identity, caseId] of [
          [authorStaff, authored.caseId],
          [reporterStaff, reported.caseId],
        ] as const) {
          const staff = boot.staff(role, identity)
          const detail = await staff.detail(caseId)
          expect(detail.viewerConflict).toBe(true)
          expect(detail.allowedActions).toEqual([])
          const response = await staff.decide(caseId, {
            action,
            reason: REASON,
            ...(action === 'ban' ? { ban: { kind: 'temporary', durationDays: 7 } } : {}),
          })
          expect(response.status, action).toBe(403)
          expect(codeOf(response)).toBe('self_review_refused')
          expect(await decisions({ case_key: caseId })).toEqual([])
        }
      }
    },
    120_000
  )

  it('covers the author of a comment target', async () => {
    const identity = await fx.operator()
    const seeded = await fx.commentCase({ author: identity })
    const response = await boot
      .staff('moderator', identity)
      .decide(seeded.caseId, { action: 'takedown', reason: REASON })
    expect(response.status).toBe(403)
    expect(codeOf(response)).toBe('self_review_refused')
  })
})

describe('I-D-OPERATOR-SANCTIONED: a banned operator cannot act (D2)', () => {
  it('refuses both routes, empties the list and keeps the read routes open', async () => {
    const identity = await fx.operator()
    await fx.sanction(identity)
    const staff = boot.staff('moderator', identity)
    const seeded = await fx.postCase()
    const detail = await staff.detail(seeded.caseId)
    expect(detail.allowedActions).toEqual([])
    const response = await staff.decide(seeded.caseId, {
      action: 'resolve',
      reason: REASON,
    })
    expect(response.status).toBe(403)
    expect(codeOf(response)).toBe('operator_sanctioned')
    const subject = await fx.member('subject')
    const row = await fx.sanction(subject)
    const appeal = await staff
      .post(`/api/v1/moderation/sanctions/${row.id}/appeal`)
      .send({ status: 'requested', reason: REASON, mutationId: randomUUID() })
    expect(appeal.status).toBe(403)
    expect(codeOf(appeal)).toBe('operator_sanctioned')
    await staff.get('/api/v1/moderation/cases').expect(200)
  })

  it('lets the same operator act once the ban expired', async () => {
    const identity = await fx.operator()
    await fx.sanction(identity, { expiresAt: new Date(NOW.getTime() + 1000) })
    const seeded = await fx.postCase()
    clock.at(new Date(NOW.getTime() + 2000))
    ctx.pinWallClock(new Date(NOW.getTime() + 2000))
    try {
      const response = await boot
        .staff('moderator', identity)
        .decide(seeded.caseId, { action: 'resolve', reason: REASON })
      expect(response.status, JSON.stringify(response.body)).toBe(200)
    } finally {
      ctx.unpinWallClock()
    }
  })
})

describe('I-D-HOSTILE: untrusted reason text', () => {
  it('stores it verbatim and keeps it out of AuditLog and the response', async () => {
    const hostile = `<img src=x onerror=alert(1)> ${'A'.repeat(900)}`
    const seeded = await fx.postCase()
    const staff = await moderator()
    const response = await staff.decide(seeded.caseId, {
      action: 'takedown',
      reason: hostile,
    })
    expect(response.status).toBe(200)
    expect(JSON.stringify(response.body)).not.toContain('onerror')
    const [row] = await decisions({ case_key: seeded.caseId })
    expect(row!.reason).toBe(hostile)
    expect(JSON.stringify(row!.response)).not.toContain('onerror')
    const event = await prisma.moderationEvent.findFirstOrThrow({
      where: { post_id: seeded.postId, action: 'taken_down_by_operator' },
    })
    expect(event.reason).toBe(hostile)
    expect(JSON.stringify(await auditRows(staff.id))).not.toContain('onerror')
    const detail = await staff.detail(seeded.caseId)
    expect(
      detail.priorActions.some((action) => action.reason?.includes('<img src=x'))
    ).toBe(true)
  })
})

describe('I-D-ACTIONS-COMPAT: the existing operator methods are unchanged', () => {
  const service = () => new CommunityModerationActionsService(prisma, ctx.flags as never)

  it('keeps their results and rows', async () => {
    const staff = await fx.operator()
    const flagged = await fx.postCase({
      status: 'flagged',
      moderationReason: 'unsafe_class',
    })
    expect(
      await service().releaseFlaggedPost({
        postId: flagged.postId,
        operatorId: staff.id,
        reason: REASON,
      })
    ).toEqual({ released: true })
    expect(
      await service().releaseFlaggedPost({
        postId: flagged.postId,
        operatorId: staff.id,
        reason: REASON,
      })
    ).toEqual({ released: false })

    const live = await fx.postCase()
    expect(
      await service().takeDownPublishedPost({
        postId: live.postId,
        operatorId: staff.id,
        reason: REASON,
      })
    ).toEqual({ takenDown: true })
    expect(
      await prisma.lookbookPost.findUniqueOrThrow({ where: { id: live.postId } })
    ).toMatchObject({ status: 'flagged', moderation_reason: REASON })

    expect(
      await service().resolveReport({
        reportId: live.reportIds[0]!,
        operatorId: staff.id,
        resolution: REASON,
      })
    ).toEqual({ resolved: true })
    expect(
      await service().resolveReport({
        reportId: live.reportIds[0]!,
        operatorId: staff.id,
        resolution: REASON,
      })
    ).toEqual({ resolved: false })
  })

  it('refuses a release for a banned author through the shared access check', async () => {
    const staff = await fx.operator()
    const flagged = await fx.postCase({ status: 'flagged' })
    await fx.sanction(flagged.author)
    expect(
      await service().releaseFlaggedPost({
        postId: flagged.postId,
        operatorId: staff.id,
        reason: REASON,
      })
    ).toEqual({ released: false })
  })
})
