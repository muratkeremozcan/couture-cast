// Learning path Step 53: Immutable moderation history.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-53-immutable-moderation-history
// Story 6.13 test owner: what one erasure leaves for the next, and operators who are themselves erased.
// I-S-MATRIX, I-S-COMMENT-LINK, I-S-CONCURRENT; I-O-RACE-DECISION, I-O-RACE-APPEAL, I-O-AFTER, I-O-SUBJECT;
// I-O-SIBLING-CONFLICT. The routes this boot does not serve are in `moderation-history-route-period`.
//
// Every setup here goes through the real routes and the real sweep, because the gaps this file exists for
// sat between steps that each passed alone: a sweep that deleted the only link a later erasure needed.
import { randomUUID } from 'node:crypto'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  COMMUNITY_ERASURE_LATE_WRITE_WINDOW_MS,
  CommunityMaintenanceService,
} from '../src/modules/community/community-maintenance.service.js'
import { CommunityCommentsProcessor } from '../src/modules/community/community-comments.processor.js'
import {
  communityPrivacyTransaction,
  guardCommunitySubject,
} from '../src/modules/community/community-privacy.js'
import { InMemoryCommunityStorage } from '../src/modules/community/community-storage.fake.js'
import {
  decisionFixtures,
  moderationDecisionsTestContext,
  type DecisionBoot,
} from './helpers/moderation-decisions-seed.js'
import {
  ERASED_REASON,
  erase,
  holdBarrier,
  IDENTITY_ALLOW_LIST,
  installTrigger,
  scanForIdentity,
  waitForBarrierWaiter,
} from './helpers/moderation-history-seed.js'

vi.setConfig({ testTimeout: 120_000 })

const NOW = new Date('2026-11-05T12:00:00.000Z')
const HOUR_MS = 3_600_000

const ctx = moderationDecisionsTestContext()
const { prisma, clock, flagValues } = ctx
const fx = decisionFixtures(prisma, clock.now)
let boot: DecisionBoot

beforeAll(async () => {
  clock.at(NOW)
  flagValues.set('moderation_history_enabled', true)
  boot = await ctx.bootApp()
}, 120_000)

afterEach(() => {
  vi.restoreAllMocks()
  clock.at(NOW)
  flagValues.set('moderation_history_enabled', true)
})

const codeOf = (response: { body: unknown }) => (response.body as { code?: string }).code

/** Erases and sweeps to completion, and returns a time past it for the next step. */
async function eraseToCompletion(memberId: string, at: Date): Promise<Date> {
  const service = new CommunityMaintenanceService(prisma, new InMemoryCommunityStorage())
  await erase(prisma, memberId, at)
  const window = new Date(at.getTime() + COMMUNITY_ERASURE_LATE_WRITE_WINDOW_MS)
  await service.sweepErasureRequests(window)
  await service.sweepErasureRequests(new Date(window.getTime() + 30_000))
  const request = await prisma.moderationErasureRequest.findUniqueOrThrow({
    where: { member_id: memberId },
  })
  expect(request.completed_at).not.toBeNull()
  return new Date(window.getTime() + HOUR_MS)
}

const sweepAt = (at: Date) =>
  new CommunityMaintenanceService(
    prisma,
    new InMemoryCommunityStorage()
  ).sweepErasureRequests(at)

/** One live world, built by the same routes a member and a moderator use. */
async function world() {
  const run = randomUUID().slice(0, 8)
  const canaries = {
    caption: `caption-canary-${run}`,
    altText: `alt-canary-${run}`,
    body: `comment-body-canary-${run}`,
    details: `report-details-canary-${run}`,
    postWords: `post-decision-canary-${run}`,
    commentWords: `comment-decision-canary-${run}`,
  }
  const author = await fx.member('author')
  const commenter = await fx.member('commenter')
  const commentReporter = await fx.member('comment-reporter')
  const postReporter = await fx.member('post-reporter')
  const moderator = await fx.operator()
  const post = await fx.post({ authorId: author.id })
  await prisma.lookbookPost.update({
    where: { id: post.id },
    data: { caption: canaries.caption, alt_text: canaries.altText },
  })
  const comment = await fx.comment({
    postId: post.id,
    authorId: commenter.id,
    body: canaries.body,
  })
  const filedPost = await boot
    .member(postReporter.id)
    .post(`/api/v1/community/posts/${post.id}/report`)
    .send({ reason: 'harassment', details: canaries.details })
  expect(filedPost.status, JSON.stringify(filedPost.body)).toBe(200)
  const filedComment = await boot
    .member(commentReporter.id)
    .post(`/api/v1/community/posts/${post.id}/comments/${comment.id}/report`)
    .send({ reason: 'harassment' })
  expect(filedComment.status, JSON.stringify(filedComment.body)).toBe(200)
  const staff = boot.staff('moderator', moderator)
  const decidedPost = await staff.decide(`post.${post.id}`, {
    action: 'resolve',
    reason: canaries.postWords,
  })
  expect(decidedPost.status, JSON.stringify(decidedPost.body)).toBe(200)
  const decidedComment = await staff.decide(`comment.${comment.id}`, {
    action: 'resolve',
    reason: canaries.commentWords,
  })
  expect(decidedComment.status, JSON.stringify(decidedComment.body)).toBe(200)
  return {
    canaries,
    post,
    comment,
    members: { author, commenter, commentReporter, postReporter, moderator },
  }
}

type Role = 'author' | 'commenter' | 'commentReporter' | 'postReporter' | 'moderator'
const ROLES: Role[] = [
  'author',
  'commenter',
  'commentReporter',
  'postReporter',
  'moderator',
]
const ORDERED_PAIRS = ROLES.flatMap((first) =>
  ROLES.filter((second) => second !== first).map(
    (second) => [first, second] as [Role, Role]
  )
)

/** Which words leave when which person does. A moderator's own erasure keeps words about someone else. */
const GONE_WITH: Record<keyof Awaited<ReturnType<typeof world>>['canaries'], Role[]> = {
  caption: ['author'],
  altText: ['author'],
  body: ['commenter'],
  details: ['postReporter'],
  postWords: ['author', 'postReporter'],
  commentWords: ['commenter', 'commentReporter'],
}

/** An operator's `AuditLog` rows keep their id: that table is immutable, and exports read it as null. */
const allowed = (hit: string, operator: boolean) =>
  IDENTITY_ALLOW_LIST.has(hit) || (operator && hit === 'AuditLog.user_id')

describe('I-S-MATRIX: every ordered pair of erasures', () => {
  it.each(ORDERED_PAIRS)('leaves nothing after %s then %s', async (first, second) => {
    const seeded = await world()
    let at = new Date(NOW.getTime() + HOUR_MS)
    at = await eraseToCompletion(seeded.members[first].id, at)
    await eraseToCompletion(seeded.members[second].id, at)

    const erased = [first, second]
    const unexpected = (
      await scanForIdentity(prisma, [seeded.members[first].id, seeded.members[second].id])
    ).filter((hit) => !allowed(hit, erased.includes('moderator')))
    expect(unexpected).toEqual([])

    for (const [name, leavesWith] of Object.entries(GONE_WITH)) {
      const canary = seeded.canaries[name as keyof typeof seeded.canaries]
      const hits = (await scanForIdentity(prisma, [canary])).filter(
        (hit) => !IDENTITY_ALLOW_LIST.has(hit)
      )
      if (leavesWith.some((role) => erased.includes(role)))
        expect(hits, `${name} should be gone`).toEqual([])
      else if (name.endsWith('Words'))
        expect(hits, `${name} is still evidence`).toContain('ModerationDecision.reason')
    }

    // The record itself stays: nothing here may have taken the decisions with the identity.
    expect(
      await prisma.moderationDecision.count({
        where: {
          case_key: { in: [`post.${seeded.post.id}`, `comment.${seeded.comment.id}`] },
        },
      })
    ).toBe(2)
  })
})

describe('I-S-COMMENT-LINK: a comment report outlives its post, and its author can still be found', () => {
  async function reportedComment(body: string) {
    const parentAuthor = await fx.member('parent-author')
    const commenter = await fx.member('commenter')
    const reporter = await fx.member('reporter')
    const post = await fx.post({ authorId: parentAuthor.id })
    const comment = await fx.comment({ postId: post.id, authorId: commenter.id, body })
    const filed = await boot
      .member(reporter.id)
      .post(`/api/v1/community/posts/${post.id}/comments/${comment.id}/report`)
      .send({ reason: 'harassment' })
    expect(filed.status, JSON.stringify(filed.body)).toBe(200)
    const report = await prisma.communityCommentReport.findFirstOrThrow({
      where: { reporter_id: reporter.id },
    })
    expect(JSON.stringify(report.content_snapshot)).toContain(body)
    return { parentAuthor, commenter, reporter, post, comment, report }
  }

  it('removes the body when the commenter is erased after the post, with no decision', async () => {
    const body = `I am Alice at 123 Test Street ${randomUUID()}`
    const seeded = await reportedComment(body)
    let at = new Date(NOW.getTime() + HOUR_MS)
    at = await eraseToCompletion(seeded.parentAuthor.id, at)
    const orphan = await prisma.communityCommentReport.findUniqueOrThrow({
      where: { id: seeded.report.id },
    })
    expect(orphan.comment_id).toBeNull()
    // The commenter is still a member, so their words stay as evidence until they ask.
    expect(JSON.stringify(orphan.content_snapshot)).toContain(body)

    await eraseToCompletion(seeded.commenter.id, at)
    const kept = await prisma.communityCommentReport.findUniqueOrThrow({
      where: { id: seeded.report.id },
    })
    expect(kept.content_snapshot).toBeNull()
    expect(await scanForIdentity(prisma, [body])).toEqual([])
  })

  it('removes the body when the commenter is erased after the post, with a decision', async () => {
    const body = `I am Bob at 456 Test Street ${randomUUID()}`
    const seeded = await reportedComment(body)
    const decided = await boot
      .staff('moderator', await fx.operator())
      .decide(`comment.${seeded.comment.id}`, {
        action: 'resolve',
        reason: 'Words about the comment.',
      })
    expect(decided.status, JSON.stringify(decided.body)).toBe(200)
    let at = new Date(NOW.getTime() + HOUR_MS)
    at = await eraseToCompletion(seeded.parentAuthor.id, at)
    await eraseToCompletion(seeded.commenter.id, at)
    expect(await scanForIdentity(prisma, [body])).toEqual([])
    const [row] = await prisma.moderationDecision.findMany({
      where: { report_ids: { has: seeded.report.id } },
    })
    expect(row).toMatchObject({ subject_user_id: null, reason: ERASED_REASON })
  })

  it('also finds the author of a comment that screening reported', async () => {
    const body = `I am Carol at 789 Test Street ${randomUUID()}`
    const parentAuthor = await fx.member('parent-author')
    const commenter = await fx.member('commenter')
    const post = await fx.post({ authorId: parentAuthor.id })
    const comment = await fx.comment({
      postId: post.id,
      authorId: commenter.id,
      body,
    })
    const processor = new CommunityCommentsProcessor(prisma, {} as never) as unknown as {
      intake: (
        tx: unknown,
        commentId: string,
        action: string,
        reason: string
      ) => Promise<void>
    }
    await prisma.$transaction((tx) =>
      processor.intake(tx, comment.id, 'screening_flagged', 'text_policy_match')
    )
    const report = await prisma.communityCommentReport.findFirstOrThrow({
      where: { comment_id: comment.id, origin: 'screening' },
    })
    let at = new Date(NOW.getTime() + HOUR_MS)
    at = await eraseToCompletion(parentAuthor.id, at)
    await eraseToCompletion(commenter.id, at)
    const kept = await prisma.communityCommentReport.findUniqueOrThrow({
      where: { id: report.id },
    })
    expect(kept.content_snapshot).toBeNull()
    expect(await scanForIdentity(prisma, [body])).toEqual([])
  })

  it('clears the words and the link when the commenter account is deleted directly', async () => {
    const body = `Deleted with the account ${randomUUID()}`
    const seeded = await reportedComment(body)
    await eraseToCompletion(seeded.parentAuthor.id, new Date(NOW.getTime() + HOUR_MS))
    const before = await prisma.communityCommentReport.findUniqueOrThrow({
      where: { id: seeded.report.id },
    })
    expect(before).toMatchObject({
      comment_id: null,
      comment_author_id: seeded.commenter.id,
    })

    await communityPrivacyTransaction(prisma, async (tx) => {
      await guardCommunitySubject(tx, seeded.commenter.id)
      await tx.userProfile.deleteMany({ where: { user_id: seeded.commenter.id } })
      await tx.comfortPreferences.deleteMany({ where: { user_id: seeded.commenter.id } })
      await tx.user.delete({ where: { id: seeded.commenter.id } })
    })

    const kept = await prisma.communityCommentReport.findUniqueOrThrow({
      where: { id: seeded.report.id },
    })
    expect(kept).toMatchObject({ content_snapshot: null, comment_author_id: null })
    expect(await scanForIdentity(prisma, [body])).toEqual([])
  })

  it('leaves another commenter on the same post alone', async () => {
    const body = `Someone else entirely ${randomUUID()}`
    const seeded = await reportedComment(body)
    const other = await fx.member('other-commenter')
    const otherBody = `Still a member ${randomUUID()}`
    const otherComment = await fx.comment({
      postId: seeded.post.id,
      authorId: other.id,
      body: otherBody,
    })
    const filed = await boot
      .member(seeded.reporter.id)
      .post(
        `/api/v1/community/posts/${seeded.post.id}/comments/${otherComment.id}/report`
      )
      .send({ reason: 'harassment' })
    expect(filed.status, JSON.stringify(filed.body)).toBe(200)
    let at = new Date(NOW.getTime() + HOUR_MS)
    at = await eraseToCompletion(seeded.parentAuthor.id, at)
    await eraseToCompletion(seeded.commenter.id, at)
    expect(await scanForIdentity(prisma, [body])).toEqual([])
    expect(await scanForIdentity(prisma, [otherBody])).toContain(
      'CommunityCommentReport.content_snapshot'
    )
  })
})

describe('I-S-CONCURRENT', () => {
  it('finishes two erasures of one case in both start orders, with no deadlock', async () => {
    for (const flip of [false, true]) {
      const seeded = await fx.postCase({ reports: 1 })
      const ids = [seeded.author.id, seeded.reporters[0]!.id]
      if (flip) ids.reverse()
      await Promise.all(ids.map((id) => erase(prisma, id, NOW)))
      const report = await prisma.communityPostReport.findUniqueOrThrow({
        where: { id: seeded.reportIds[0]! },
      })
      expect(report.reporter_id).toBeNull()
    }
  })
})

/**
 * Holds `first` at a barrier inside its transaction and starts `second`, then waits until the database
 * reports `second` blocked or `second` has finished, and only then lets `first` go. Waiting for "blocked"
 * alone would report a missing lock as a timeout, and what matters is the state the race leaves.
 * The decision's barrier is on its audit row, in the same transaction after the decision row: the
 * application role owns `AuditLog` and cannot put a trigger on `ModerationDecision` on the real image.
 */
async function inOrder<A, B>(
  table: 'AuditLog' | 'ModerationErasureRequest',
  first: () => Promise<A>,
  second: () => Promise<B>
): Promise<[A, B]> {
  const key = 800_000 + Math.floor(Math.random() * 90_000)
  const release = await holdBarrier(ctx.database.url, key)
  const remove = await installTrigger(
    prisma,
    table,
    'BEFORE INSERT',
    `PERFORM pg_advisory_xact_lock(${key});`
  )
  try {
    const running = first()
    running.catch(() => undefined)
    await waitForBarrierWaiter(prisma, key)
    let finished = false
    const following = second()
    following.then(
      () => {
        finished = true
      },
      () => {
        finished = true
      }
    )
    await vi.waitFor(
      async () => {
        if (finished) return
        const rows = await prisma.$queryRaw<{ waiting: number }[]>`
          SELECT count(*)::int AS waiting FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock'`
        expect(rows[0]!.waiting).toBeGreaterThanOrEqual(2)
      },
      { timeout: 15_000, interval: 25 }
    )
    await release()
    return await Promise.all([running, following])
  } finally {
    await release()
    await remove()
  }
}

async function liftableSanction() {
  const author = await fx.member('banned')
  const seeded = await fx.postCase({ author })
  const banned = await boot.staff('admin', await fx.operator()).decide(seeded.caseId, {
    action: 'ban',
    reason: 'A ban rationale.',
    ban: { kind: 'permanent' },
  })
  expect(banned.status, JSON.stringify(banned.body)).toBe(200)
  const sanctionId = (banned.body as { data: { sanction: { sanctionId: string } } }).data
    .sanction.sanctionId
  const requested = await boot.staff('admin', await fx.operator()).appeal(sanctionId, {
    status: 'requested',
    reason: 'The member asked for a review.',
  })
  expect(requested.status, JSON.stringify(requested.body)).toBe(200)
  return { sanctionId, seeded }
}

describe('I-O: an operator who is erased', () => {
  describe('I-O-RACE-DECISION', () => {
    it('strips a decision already running when its moderator is erased', async () => {
      const seeded = await fx.postCase()
      const moderator = await fx.operator()
      const staff = boot.staff('moderator', moderator)
      const expectedRevision = (await staff.detail(seeded.caseId)).revision
      const [answered] = await inOrder(
        'AuditLog',
        () =>
          Promise.resolve(
            staff.decide(seeded.caseId, {
              action: 'resolve',
              reason: 'Words.',
              expectedRevision,
            })
          ),
        () => eraseToCompletion(moderator.id, NOW)
      )
      expect(answered.status, JSON.stringify(answered.body)).toBe(200)
      await sweepAt(new Date(NOW.getTime() + 80 * HOUR_MS))
      const rows = await prisma.moderationDecision.findMany({
        where: { case_key: seeded.caseId },
      })
      expect(rows).toHaveLength(1)
      expect(rows[0]!.moderator_id).toBeNull()
      expect(rows[0]!.anonymized_at).not.toBeNull()
    })

    it('refuses a decision that waited behind its moderator erasure', async () => {
      const seeded = await fx.postCase()
      const moderator = await fx.operator()
      const staff = boot.staff('moderator', moderator)
      const expectedRevision = (await staff.detail(seeded.caseId)).revision
      const [, answered] = await inOrder(
        'ModerationErasureRequest',
        () => erase(prisma, moderator.id, NOW),
        () =>
          Promise.resolve(
            staff.decide(seeded.caseId, {
              action: 'resolve',
              reason: 'Words.',
              expectedRevision,
            })
          )
      )
      expect([answered.status, codeOf(answered)]).toEqual([403, 'operator_sanctioned'])
      expect(
        await prisma.moderationDecision.count({ where: { case_key: seeded.caseId } })
      ).toBe(0)
    })
  })

  describe('I-O-RACE-APPEAL', () => {
    it('strips an appeal step already running when its moderator is erased', async () => {
      const { sanctionId, seeded } = await liftableSanction()
      const moderator = await fx.operator()
      const staff = boot.staff('admin', moderator)
      const before = await prisma.moderationDecision.count({
        where: { case_key: seeded.caseId },
      })
      const [answered] = await inOrder(
        'AuditLog',
        () =>
          Promise.resolve(
            staff.appeal(sanctionId, { status: 'upheld', reason: 'Words.' })
          ),
        () => eraseToCompletion(moderator.id, NOW)
      )
      expect(answered.status, JSON.stringify(answered.body)).toBe(200)
      await sweepAt(new Date(NOW.getTime() + 80 * HOUR_MS))
      const rows = await prisma.moderationDecision.findMany({
        where: { case_key: seeded.caseId },
        orderBy: { sequence: 'desc' },
      })
      expect(rows).toHaveLength(before + 1)
      expect(rows[0]!.moderator_id).toBeNull()
    })

    it('refuses an appeal step that waited behind its moderator erasure', async () => {
      const { sanctionId, seeded } = await liftableSanction()
      const moderator = await fx.operator()
      const staff = boot.staff('admin', moderator)
      const before = await prisma.moderationDecision.count({
        where: { case_key: seeded.caseId },
      })
      const [, answered] = await inOrder(
        'ModerationErasureRequest',
        () => erase(prisma, moderator.id, NOW),
        () =>
          Promise.resolve(
            staff.appeal(sanctionId, { status: 'upheld', reason: 'Words.' })
          )
      )
      expect([answered.status, codeOf(answered)]).toEqual([403, 'operator_sanctioned'])
      expect(
        await prisma.moderationDecision.count({ where: { case_key: seeded.caseId } })
      ).toBe(before)
    })
  })

  describe('I-O-AFTER: every moderation route, once the erasure has completed', () => {
    async function erasedOperator(role: 'moderator' | 'admin') {
      const operator = await fx.operator()
      await eraseToCompletion(operator.id, NOW)
      return { operator, staff: boot.staff(role, operator) }
    }

    it('refuses a decision, writing no decision, event or audit row', async () => {
      const seeded = await fx.postCase()
      const reader = boot.staff('moderator', await fx.operator())
      const expectedRevision = (await reader.detail(seeded.caseId)).revision
      const { operator, staff } = await erasedOperator('moderator')
      const answered = await staff.decide(seeded.caseId, {
        action: 'resolve',
        reason: 'Words.',
        expectedRevision,
      })
      expect([answered.status, codeOf(answered)]).toEqual([403, 'operator_sanctioned'])
      expect(
        await prisma.moderationDecision.count({ where: { case_key: seeded.caseId } })
      ).toBe(0)
      expect(
        await prisma.moderationEvent.count({ where: { reviewed_by_id: operator.id } })
      ).toBe(0)
      expect(
        await prisma.auditLog.count({
          where: { user_id: operator.id, event_type: 'moderation_decision_applied' },
        })
      ).toBe(0)
    })

    it('refuses an appeal step', async () => {
      const { sanctionId, seeded } = await liftableSanction()
      const before = await prisma.moderationDecision.count({
        where: { case_key: seeded.caseId },
      })
      const { staff } = await erasedOperator('admin')
      const answered = await staff.appeal(sanctionId, {
        status: 'upheld',
        reason: 'Words.',
      })
      expect([answered.status, codeOf(answered)]).toEqual([403, 'operator_sanctioned'])
      expect(
        await prisma.moderationDecision.count({ where: { case_key: seeded.caseId } })
      ).toBe(before)
    })
  })

  describe('I-O-SUBJECT: one person as moderator, reporter and subject', () => {
    it('keeps words about others, removes words about them, and leaves no id', async () => {
      const person = await fx.member('moderator-who-posts')
      const elsewhere = await fx.postCase()
      const aboutOthers = `About someone else ${randomUUID()}`
      const made = await boot.staff('moderator', person).decide(elsewhere.caseId, {
        action: 'resolve',
        reason: aboutOthers,
      })
      expect(made.status, JSON.stringify(made.body)).toBe(200)
      const own = await fx.postCase({ author: person })
      const aboutThem = `About this person ${randomUUID()}`
      const received = await boot
        .staff('moderator', await fx.operator())
        .decide(own.caseId, { action: 'resolve', reason: aboutThem })
      expect(received.status, JSON.stringify(received.body)).toBe(200)
      const third = await fx.post({ authorId: (await fx.member('third')).id })
      const filed = await boot
        .member(person.id)
        .post(`/api/v1/community/posts/${third.id}/report`)
        .send({ reason: 'harassment', details: `Filed by them ${person.id}` })
      expect(filed.status, JSON.stringify(filed.body)).toBe(200)

      await eraseToCompletion(person.id, NOW)

      const hits = (await scanForIdentity(prisma, [person.id])).filter(
        (hit) => !allowed(hit, true)
      )
      expect(hits).toEqual([])
      const authored = await prisma.moderationDecision.findFirstOrThrow({
        where: { case_key: elsewhere.caseId },
      })
      expect(authored).toMatchObject({ moderator_id: null, reason: aboutOthers })
      const about = await prisma.moderationDecision.findFirstOrThrow({
        where: { report_ids: { hasSome: own.reportIds } },
      })
      expect(about).toMatchObject({ subject_user_id: null, reason: ERASED_REASON })
      expect(await scanForIdentity(prisma, [aboutThem])).toEqual([])
    })
  })
})

describe('I-O-SIBLING-CONFLICT: the reports a decision joined, once the post is gone', () => {
  async function joined(role: 'moderator' | 'admin', action: 'resolve' | 'escalate') {
    const seeded = await fx.postCase({ reports: 2 })
    const decided = await boot
      .staff('moderator', await fx.operator())
      .decide(seeded.caseId, { action, reason: 'Words.' })
    expect(decided.status, JSON.stringify(decided.body)).toBe(200)
    await eraseToCompletion(seeded.author.id, NOW)
    return {
      staff: boot.staff(role, seeded.reporters[0]!),
      caseId: `orphan-post.${seeded.reportIds[1]!}`,
    }
  }

  it('marks the other report as a conflict on the case read', async () => {
    const { staff, caseId } = await joined('moderator', 'resolve')
    expect((await staff.detail(caseId)).viewerConflict).toBe(true)
  })

  it('refuses a decision on the other report', async () => {
    const { staff, caseId } = await joined('admin', 'escalate')
    const { revision } = await staff.detail(caseId)
    const answered = await staff.decide(caseId, {
      action: 'resolve',
      reason: 'Words.',
      expectedRevision: revision,
    })
    expect([answered.status, codeOf(answered)]).toEqual([403, 'self_review_refused'])
  })
})
