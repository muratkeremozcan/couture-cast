// Learning path Step 53: Immutable moderation history.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-53-immutable-moderation-history
// Story 6.13 test owner: everything an operator can do across the step that deletes a post and orphans its reports.
// I-P-DECIDE, I-P-THREE, I-P-CHAIN, I-P-APPEAL, I-P-CONFLICT, I-P-WINDOW, I-P-OWN-COMMENT, I-P-LIVE-AFTER-COMMENTER,
// I-P-ACCOUNT, I-P-SCREENING, I-P-RACE.
//
// A post's deletion re-keys each of its reports to its own orphan case and removes the rows a later step would
// read for the subject and the sibling reports. Each scenario here puts an action after that step and then asks
// what the next erasure finds, because the gaps this file exists for only appear in that order.
import { randomUUID } from 'node:crypto'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { CommunityCommentsProcessor } from '../src/modules/community/community-comments.processor.js'
import {
  COMMUNITY_ERASURE_LATE_WRITE_WINDOW_MS,
  CommunityMaintenanceService,
} from '../src/modules/community/community-maintenance.service.js'
import {
  communityPrivacyTransaction,
  guardCommunitySubject,
} from '../src/modules/community/community-privacy.js'
import { InMemoryCommunityStorage } from '../src/modules/community/community-storage.fake.js'
import type { DecisionBoot } from './helpers/moderation-decisions-seed.js'
import {
  erase,
  ERASED_REASON,
  IDENTITY_ALLOW_LIST,
  runInOrder,
  scanForIdentity,
} from './helpers/moderation-history-seed.js'
import { useModerationHistoryRoutes } from './helpers/moderation-history-route-context.js'

vi.setConfig({ testTimeout: 120_000 })

const NOW = new Date('2026-11-05T12:00:00.000Z')
const HOUR_MS = 3_600_000
const WORLD_SPACING_MS = 14 * 24 * HOUR_MS

const routes = useModerationHistoryRoutes()
const { ctx, prisma, clock, flagValues, fx, exportAs, codeOf } = routes
let boot: DecisionBoot
let worlds = 0

beforeAll(async () => {
  clock.at(NOW)
  flagValues.set('moderation_history_enabled', true)
  boot = await ctx.bootApp()
}, 120_000)

beforeEach(() => {
  flagValues.set('moderation_history_enabled', true)
})

const sweepAt = (at: Date) =>
  new CommunityMaintenanceService(
    prisma,
    new InMemoryCommunityStorage()
  ).sweepErasureRequests(at)

async function assertCompleted(memberId: string) {
  const request = await prisma.moderationErasureRequest.findUniqueOrThrow({
    where: { member_id: memberId },
  })
  expect(request.completed_at).not.toBeNull()
}

/** Runs a request's sweeps to completion and returns a time past them for the next step. */
async function finishErasure(memberId: string, at: Date): Promise<Date> {
  const window = new Date(at.getTime() + COMMUNITY_ERASURE_LATE_WRITE_WINDOW_MS)
  await sweepAt(window)
  await sweepAt(new Date(window.getTime() + 30_000))
  await assertCompleted(memberId)
  const next = new Date(window.getTime() + HOUR_MS)
  clock.at(next)
  return next
}

async function eraseToCompletion(memberId: string, at: Date): Promise<Date> {
  await erase(prisma, memberId, at)
  return finishErasure(memberId, at)
}

const reportPost = async (reporter: string, postId: string, details?: string) => {
  const filed = await boot
    .member(reporter)
    .post(`/api/v1/community/posts/${postId}/report`)
    .send({ reason: 'harassment', ...(details ? { details } : {}) })
  expect(filed.status, JSON.stringify(filed.body)).toBe(200)
  return prisma.communityPostReport.findFirstOrThrow({
    where: { reporter_id: reporter, post_id: postId },
  })
}

const reportComment = async (reporter: string, postId: string, commentId: string) => {
  const filed = await boot
    .member(reporter)
    .post(`/api/v1/community/posts/${postId}/comments/${commentId}/report`)
    .send({ reason: 'harassment' })
  expect(filed.status, JSON.stringify(filed.body)).toBe(200)
  return prisma.communityCommentReport.findFirstOrThrow({
    where: { reporter_id: reporter, comment_id: commentId },
  })
}

/** One post with one comment, reported by the routes members use. Each world has its own stretch of the clock. */
async function world() {
  const start = new Date(NOW.getTime() + ++worlds * WORLD_SPACING_MS)
  clock.at(start)
  const author = await fx.member('author')
  const commenter = await fx.member('commenter')
  const commentReporter = await fx.member('comment-reporter')
  const commentSibling = await fx.member('comment-sibling')
  const postReporter = await fx.member('post-reporter')
  const postSibling = await fx.member('post-sibling')
  const moderator = await fx.operator()
  const post = await fx.post({ authorId: author.id })
  const comment = await fx.comment({
    postId: post.id,
    authorId: commenter.id,
    body: `comment-body-${randomUUID()}`,
  })
  const postReport = await reportPost(postReporter.id, post.id)
  const commentReport = await reportComment(commentReporter.id, post.id, comment.id)
  const fixed = {
    start,
    post,
    comment,
    postCase: `post.${post.id}`,
    commentCase: `comment.${comment.id}`,
    orphanPost: `orphan-post.${postReport.id}`,
    orphanComment: `orphan-comment.${commentReport.id}`,
    members: {
      author,
      commenter,
      commentReporter,
      commentSibling,
      postReporter,
      postSibling,
      moderator,
    },
  }
  return {
    ...fixed,
    /** Files the second report on each target, so a test can choose which side of a decision it lands on. */
    fileSiblings: async () => {
      const onPost = await reportPost(postSibling.id, post.id)
      const onComment = await reportComment(commentSibling.id, post.id, comment.id)
      return {
        orphanPostSibling: `orphan-post.${onPost.id}`,
        orphanCommentSibling: `orphan-comment.${onComment.id}`,
      }
    },
  }
}

type World = Awaited<ReturnType<typeof world>>
type Role = keyof World['members']
type Target = 'post' | 'comment'

const words = (label: string) => `operator-words-${label}-${randomUUID()}`
const started = (seeded: World) => new Date(seeded.start.getTime() + HOUR_MS)
const staffOf = (member: { id: string }) => boot.staff('admin', member)

async function mustDecide(
  operator: { id: string },
  caseId: string,
  input: { action: string; reason: string; ban?: { kind: string } }
) {
  const answered = await staffOf(operator).decide(caseId, input as never)
  expect(
    answered.status,
    `${input.action} on ${caseId}: ${JSON.stringify(answered.body)}`
  ).toBe(200)
  return answered
}

const actionInput = (action: string, reason: string) => ({
  action,
  reason,
  ...(action === 'ban' ? { ban: { kind: 'permanent' } } : {}),
})

/** A moderator's erasure keeps a row's words and an operator's `AuditLog` rows keep their id, as I-S-MATRIX reads them. */
async function expectNoIdentity(ids: string[], operator: boolean) {
  const hits = (await scanForIdentity(prisma, ids)).filter(
    (hit) => !IDENTITY_ALLOW_LIST.has(hit) && !(operator && hit === 'AuditLog.user_id')
  )
  expect(hits).toEqual([])
}

async function expectWords(canary: string, gone: boolean) {
  const hits = (await scanForIdentity(prisma, [canary])).filter(
    (hit) => !IDENTITY_ALLOW_LIST.has(hit)
  )
  if (gone) expect(hits, `${canary} should be gone`).toEqual([])
  else expect(hits, `${canary} is still evidence`).toContain('ModerationDecision.reason')
}

async function expectExportHasWords(caseId: string, canary: string, present: boolean) {
  const reader = await fx.operator()
  const bundle = await exportAs(
    { id: reader.id, role: 'admin' },
    { scope: 'case', caseId }
  )
  expect(bundle.status, JSON.stringify(bundle.body)).toBe(200)
  expect(JSON.stringify(bundle.body).includes(canary)).toBe(present)
}

const LATER_ROLES: Role[] = [
  'commenter',
  'commentReporter',
  'commentSibling',
  'postReporter',
  'postSibling',
  'moderator',
]

type Timing = 'before' | 'window' | 'orphaned'

/**
 * Whose erasure takes an operator's words with it. A decision on a live target joins every report on it and names
 * its author. Once the author's erasure is requested the post no longer names them, and their words have gone,
 * so words written from then on are about no one that erasure can still reach: they answer to the reports they
 * rest on. After the post goes, the case is one report. A comment still has its author, whom the report's own link
 * names, so the commenter's erasure reaches words about their comment on every side of this step.
 */
function wordsLeaveWith(timing: Timing, target: Target): Role[] | 'with-the-author' {
  if (target === 'comment')
    return timing === 'orphaned'
      ? ['commenter', 'commentReporter']
      : ['commenter', 'commentReporter', 'commentSibling']
  if (timing === 'before') return 'with-the-author'
  return timing === 'window' ? ['postReporter', 'postSibling'] : ['postReporter']
}

const CELLS = (['before', 'window', 'orphaned'] as Timing[]).flatMap((timing) =>
  (['post', 'comment'] as Target[]).flatMap((target) =>
    (timing === 'orphaned'
      ? ['resolve', 'escalate']
      : ['resolve', 'escalate', 'takedown', 'ban']
    ).flatMap((action) =>
      timing === 'window' && target === 'post' && action === 'ban'
        ? []
        : LATER_ROLES.map((then) => [timing, target, action, then] as const)
    )
  )
)

describe('I-P-DECIDE: an operator acts on either side of the orphaning step, then each other person is erased', () => {
  it('refuses a ban of an author whose erasure is under way', async () => {
    const seeded = await world()
    await erase(prisma, seeded.members.author.id, started(seeded))
    const answered = await staffOf(seeded.members.moderator).decide(
      seeded.postCase,
      actionInput('ban', 'A ban rationale.') as never
    )
    expect([answered.status, codeOf(answered)]).toEqual([409, 'action_not_applicable'])
  })

  it.each(CELLS)('%s, on the %s, %s, then %s', async (timing, target, action, then) => {
    const seeded = await world()
    await seeded.fileSiblings()
    const canary = words(`${timing}-${target}-${action}`)
    const live = target === 'post' ? seeded.postCase : seeded.commentCase
    const orphan = target === 'post' ? seeded.orphanPost : seeded.orphanComment
    const caseId = timing === 'orphaned' ? orphan : live
    const input = actionInput(action, canary)
    const authorId = seeded.members.author.id
    let at = started(seeded)
    if (timing === 'before') {
      await mustDecide(seeded.members.moderator, caseId, input)
      at = await eraseToCompletion(authorId, at)
    } else if (timing === 'window') {
      await erase(prisma, authorId, at)
      clock.at(new Date(at.getTime() + 60_000))
      await mustDecide(seeded.members.moderator, caseId, input)
      at = await finishErasure(authorId, at)
    } else {
      at = await eraseToCompletion(authorId, at)
      await mustDecide(seeded.members.moderator, caseId, input)
    }

    await eraseToCompletion(seeded.members[then].id, at)

    const leaves = wordsLeaveWith(timing, target)
    const gone = leaves === 'with-the-author' || leaves.includes(then)
    await expectWords(canary, gone)
    await expectExportHasWords(orphan, canary, !gone)
    await expectNoIdentity([authorId, seeded.members[then].id], then === 'moderator')
    const rows = await prisma.moderationDecision.findMany({
      where: { reason: gone ? ERASED_REASON : canary, case_key: caseId },
    })
    expect(rows.length).toBeGreaterThanOrEqual(1)
  })
})

const THREE = (
  [
    'commenter',
    'commentReporter',
    'commentSibling',
    'postReporter',
    'postSibling',
  ] as Role[]
).flatMap((first) =>
  (['post', 'comment'] as Target[]).flatMap((target) =>
    LATER_ROLES.filter((last) => last !== first).map(
      (last) => [first, target, last] as const
    )
  )
)

describe('I-P-THREE: one person leaves, the post goes, an operator decides, another person leaves', () => {
  it.each(THREE)('%s, then the %s decided, then %s', async (first, target, last) => {
    const seeded = await world()
    await seeded.fileSiblings()
    const canary = words(`three-${first}-${target}`)
    const caseId = target === 'post' ? seeded.orphanPost : seeded.orphanComment
    let at = await eraseToCompletion(seeded.members[first].id, started(seeded))
    at = await eraseToCompletion(seeded.members.author.id, at)
    await mustDecide(await fx.operator(), caseId, actionInput('resolve', canary))

    await eraseToCompletion(seeded.members[last].id, at)

    const leaves = wordsLeaveWith('orphaned', target) as Role[]
    await expectWords(canary, leaves.includes(last))
    await expectNoIdentity(
      [seeded.members.author.id, seeded.members[first].id, seeded.members[last].id],
      last === 'moderator'
    )
  })
})

describe('I-P-CHAIN: an escalation before the post goes and a decision after it', () => {
  it.each([
    ['comment', 'commenter', true, true],
    ['comment', 'commentReporter', true, true],
    ['comment', 'commentSibling', true, false],
    ['comment', 'postReporter', false, false],
    ['post', 'postReporter', true, true],
    ['post', 'postSibling', true, false],
    ['post', 'commenter', true, false],
  ] as const)('%s, then %s', async (target, then, firstGone, secondGone) => {
    const seeded = await world()
    await seeded.fileSiblings()
    const before = words('chain-before')
    const after = words('chain-after')
    await mustDecide(
      seeded.members.moderator,
      target === 'post' ? seeded.postCase : seeded.commentCase,
      actionInput('escalate', before)
    )
    const at = await eraseToCompletion(seeded.members.author.id, started(seeded))
    await mustDecide(
      await fx.operator(),
      target === 'post' ? seeded.orphanPost : seeded.orphanComment,
      actionInput('resolve', after)
    )
    await eraseToCompletion(seeded.members[then].id, at)
    await expectWords(before, firstGone)
    await expectWords(after, secondGone)
  })
})

describe('I-P-APPEAL: an appeal decided after the post of the banned comment has gone', () => {
  async function bannedCommenter() {
    const seeded = await world()
    await seeded.fileSiblings()
    const banned = await mustDecide(
      seeded.members.moderator,
      seeded.commentCase,
      actionInput('ban', 'A ban rationale.')
    )
    const sanctionId = (banned.body as { data: { sanction: { sanctionId: string } } })
      .data.sanction.sanctionId
    const asked = await staffOf(await fx.operator()).appeal(sanctionId, {
      status: 'requested',
      reason: 'Asked.',
    })
    expect(asked.status, JSON.stringify(asked.body)).toBe(200)
    return { seeded, sanctionId }
  }

  it.each([
    ['commenter', true],
    ['commentReporter', true],
    ['commentSibling', true],
    ['postReporter', false],
    ['moderator', false],
  ] as const)(
    'keeps or removes the appeal words when %s is erased',
    async (then, gone) => {
      const { seeded, sanctionId } = await bannedCommenter()
      const at = await eraseToCompletion(seeded.members.author.id, started(seeded))
      const canary = words('appeal')
      const decided = await staffOf(await fx.operator()).appeal(sanctionId, {
        status: 'upheld',
        reason: canary,
      })
      expect(decided.status, JSON.stringify(decided.body)).toBe(200)
      await eraseToCompletion(seeded.members[then].id, at)
      await expectWords(canary, gone)
    }
  )

  it('decides an appeal first requested after the post has gone', async () => {
    const seeded = await world()
    const banned = await mustDecide(
      seeded.members.moderator,
      seeded.commentCase,
      actionInput('ban', 'A ban rationale.')
    )
    const sanctionId = (banned.body as { data: { sanction: { sanctionId: string } } })
      .data.sanction.sanctionId
    const at = await eraseToCompletion(seeded.members.author.id, started(seeded))
    const admin = staffOf(await fx.operator())
    const asked = words('asked')
    const canary = words('upheld')
    const requested = await admin.appeal(sanctionId, {
      status: 'requested',
      reason: asked,
    })
    expect(requested.status, JSON.stringify(requested.body)).toBe(200)
    const upheld = await admin.appeal(sanctionId, { status: 'upheld', reason: canary })
    expect(upheld.status, JSON.stringify(upheld.body)).toBe(200)
    await eraseToCompletion(seeded.members.commenter.id, at)
    await expectWords(asked, true)
    await expectWords(canary, true)
  })

  // A ban takes the comment down, so no report can be filed after it: every reporter is on the origin decision.
  it.each(['commentReporter', 'commentSibling'] as const)(
    'refuses %s as the appeal decider once the post has gone',
    async (who) => {
      const { seeded, sanctionId } = await bannedCommenter()
      await eraseToCompletion(seeded.members.author.id, started(seeded))
      const answered = await staffOf(seeded.members[who]).appeal(sanctionId, {
        status: 'upheld',
        reason: 'Self review.',
      })
      expect([answered.status, codeOf(answered)]).toEqual([403, 'self_review_refused'])
    }
  )
})

const POST_SIDE: Role[] = ['postReporter', 'postSibling']
const COMMENT_SIDE: Role[] = ['commenter', 'commentReporter', 'commentSibling']
type Viewer = Role | 'neutral'
type Variant = 'undecided' | 'joined' | 'late' | 'decided-after'
const VIEWERS: Viewer[] = [...POST_SIDE, ...COMMENT_SIDE, 'neutral']
const CONFLICT_CELLS = (
  ['undecided', 'joined', 'late', 'decided-after'] as Variant[]
).flatMap((variant) => VIEWERS.map((viewer) => [variant, viewer] as const))

/** The range answer: nothing of a conflicted side, the one decision of a free side, and an exact count. */
async function expectRangeWithholds(
  seeded: World,
  who: { id: string; role: string },
  conflicted: { post: boolean; comment: boolean },
  decided: boolean
) {
  const range = await exportAs(who, {
    scope: 'range',
    from: seeded.start.toISOString(),
    to: new Date(seeded.start.getTime() + WORLD_SPACING_MS - HOUR_MS).toISOString(),
  })
  expect(range.status, JSON.stringify(range.body)).toBe(200)
  const body = range.body as {
    decisions: { caseId: string }[]
    counts: { withheldForConflict: number }
  }
  const visible = body.decisions.map((row) => row.caseId)
  const shown = (keys: string[]) => visible.filter((id) => keys.includes(id)).length
  const expectedShown = (isConflicted: boolean) => (decided && !isConflicted ? 1 : 0)
  expect(shown([seeded.postCase, seeded.orphanPost])).toBe(expectedShown(conflicted.post))
  expect(shown([seeded.commentCase, seeded.orphanComment])).toBe(
    expectedShown(conflicted.comment)
  )
  expect(body.counts.withheldForConflict).toBe(
    decided && (conflicted.post || conflicted.comment) ? 1 : 0
  )
}

/**
 * A conflict is about the person and the target, so it reads the same on all of a target's orphan cases, and
 * however a decision did or did not link them. The two sides of one post stay separate, as they are before it goes.
 */
describe('I-P-CONFLICT: every surface answers for every viewer on every orphan case', () => {
  it.each(CONFLICT_CELLS)('%s, viewed by %s', async (variant, viewer) => {
    const seeded = await world()
    const neutral = await fx.operator()
    const decideLive = async () => {
      await mustDecide(neutral, seeded.postCase, actionInput('escalate', 'Post words.'))
      await mustDecide(
        neutral,
        seeded.commentCase,
        actionInput('escalate', 'Comment words.')
      )
    }
    if (variant === 'late') await decideLive()
    const siblings = await seeded.fileSiblings()
    if (variant === 'joined') await decideLive()
    await eraseToCompletion(seeded.members.author.id, started(seeded))
    if (variant === 'decided-after') {
      await mustDecide(neutral, seeded.orphanPost, actionInput('resolve', 'Post words.'))
      await mustDecide(
        neutral,
        seeded.orphanComment,
        actionInput('resolve', 'Comment words.')
      )
    }

    const identity = viewer === 'neutral' ? await fx.operator() : seeded.members[viewer]
    const staff = staffOf(identity)
    const who = { id: identity.id, role: 'admin' }
    const conflicted = {
      post: POST_SIDE.includes(viewer as Role),
      comment: COMMENT_SIDE.includes(viewer as Role),
    }
    const cases: [string, Target][] = [
      [seeded.orphanPost, 'post'],
      [siblings.orphanPostSibling, 'post'],
      [seeded.orphanComment, 'comment'],
      [siblings.orphanCommentSibling, 'comment'],
    ]
    for (const [caseId, side] of cases) {
      const expected = conflicted[side]
      const label = `${caseId} on the ${side} side`
      expect((await staff.detail(caseId)).viewerConflict, label).toBe(expected)
      const exported = await exportAs(who, { scope: 'case', caseId })
      expect([exported.status, codeOf(exported)], label).toEqual(
        expected ? [403, 'self_review_refused'] : [200, undefined]
      )
      if (expected) {
        const before = await prisma.moderationDecision.count({
          where: { case_key: caseId },
        })
        const answered = await staff.decide(caseId, {
          action: 'resolve',
          reason: 'Self review.',
        })
        expect([answered.status, codeOf(answered)], label).toEqual([
          403,
          'self_review_refused',
        ])
        expect(
          await prisma.moderationDecision.count({ where: { case_key: caseId } })
        ).toBe(before)
      }
    }

    await expectRangeWithholds(seeded, who, conflicted, variant !== 'undecided')
  })
})

describe('I-P-WINDOW: a member cannot file against a post whose author has asked to leave', () => {
  it('answers 404, and leaves nothing of the post or the comment afterwards', async () => {
    const seeded = await world()
    const caption = `caption-canary-${randomUUID()}`
    const body = `comment-canary-${randomUUID()}`
    await prisma.lookbookPost.update({
      where: { id: seeded.post.id },
      data: { caption },
    })
    await prisma.communityComment.update({
      where: { id: seeded.comment.id },
      data: { body },
    })
    const at = started(seeded)
    await erase(prisma, seeded.members.author.id, at)
    clock.at(new Date(at.getTime() + 60_000))
    // Members can no longer reach the post, so nothing new can name it once its author has asked to leave.
    const lateOnPost = await boot
      .member(seeded.members.postSibling.id)
      .post(`/api/v1/community/posts/${seeded.post.id}/report`)
      .send({ reason: 'harassment' })
    const lateOnComment = await boot
      .member(seeded.members.commentSibling.id)
      .post(
        `/api/v1/community/posts/${seeded.post.id}/comments/${seeded.comment.id}/report`
      )
      .send({ reason: 'harassment' })
    expect([lateOnPost.status, lateOnComment.status]).toEqual([404, 404])
    const next = await finishErasure(seeded.members.author.id, at)
    expect(await scanForIdentity(prisma, [caption])).toEqual([])
    await eraseToCompletion(seeded.members.commenter.id, next)
    expect(await scanForIdentity(prisma, [body])).toEqual([])
    await expectNoIdentity([seeded.members.author.id, seeded.members.commenter.id], false)
  })
})

describe('I-P-OWN-COMMENT: the author commented on their own post, and that comment was reported', () => {
  it('leaves nothing of the comment, whichever case decides it', async () => {
    const seeded = await world()
    const body = `own-comment-canary-${randomUUID()}`
    const own = await fx.comment({
      postId: seeded.post.id,
      authorId: seeded.members.author.id,
      body,
    })
    const report = await reportComment(
      seeded.members.commentSibling.id,
      seeded.post.id,
      own.id
    )
    const at = await eraseToCompletion(seeded.members.author.id, started(seeded))
    expect(await scanForIdentity(prisma, [body])).toEqual([])
    const canary = words('own-comment')
    await mustDecide(
      seeded.members.moderator,
      `orphan-comment.${report.id}`,
      actionInput('resolve', canary)
    )
    await eraseToCompletion(seeded.members.commentSibling.id, at)
    await expectWords(canary, true)
  })
})

describe('I-P-LIVE-AFTER-COMMENTER: the commenter leaves, then an operator decides the live comment case', () => {
  it.each([
    ['commentReporter', true],
    ['commentSibling', true],
    ['postReporter', false],
  ] as const)('then the post goes, then %s', async (then, gone) => {
    const seeded = await world()
    await seeded.fileSiblings()
    let at = await eraseToCompletion(seeded.members.commenter.id, started(seeded))
    const canary = words('live-after-commenter')
    await mustDecide(
      seeded.members.moderator,
      seeded.commentCase,
      actionInput('resolve', canary)
    )
    at = await eraseToCompletion(seeded.members.author.id, at)
    await eraseToCompletion(seeded.members[then].id, at)
    await expectWords(canary, gone)
  })
})

describe('I-P-ACCOUNT: the post goes with its author account, with no erasure request', () => {
  async function deleteAccount(memberId: string) {
    await communityPrivacyTransaction(prisma, async (tx) => {
      await guardCommunitySubject(tx, memberId)
      await tx.userProfile.deleteMany({ where: { user_id: memberId } })
      await tx.comfortPreferences.deleteMany({ where: { user_id: memberId } })
      await tx.user.delete({ where: { id: memberId } })
    })
  }

  it('removes the words of an orphan comment decision with the commenter', async () => {
    const seeded = await world()
    await deleteAccount(seeded.members.author.id)
    const canary = words('account')
    await mustDecide(
      seeded.members.moderator,
      seeded.orphanComment,
      actionInput('resolve', canary)
    )
    await eraseToCompletion(seeded.members.commenter.id, started(seeded))
    await expectWords(canary, true)
  })

  it('keeps the conflict on the sibling report', async () => {
    const seeded = await world()
    const siblings = await seeded.fileSiblings()
    await deleteAccount(seeded.members.author.id)
    const detail = await staffOf(seeded.members.postReporter).detail(
      siblings.orphanPostSibling
    )
    expect(detail.viewerConflict).toBe(true)
  })
})

describe('I-P-SCREENING: a comment screening reported, so no member filed the report', () => {
  async function screened() {
    const seeded = await world()
    const processor = new CommunityCommentsProcessor(prisma, {} as never) as unknown as {
      intake: (
        tx: unknown,
        commentId: string,
        action: string,
        reason: string
      ) => Promise<void>
    }
    await prisma.$transaction((tx) =>
      processor.intake(tx, seeded.comment.id, 'screening_flagged', 'text_policy_match')
    )
    const report = await prisma.communityCommentReport.findFirstOrThrow({
      where: { comment_id: seeded.comment.id, origin: 'screening' },
    })
    return { seeded, report }
  }

  it('removes the words of the orphan decision with the commenter', async () => {
    const { seeded, report } = await screened()
    expect(report.comment_author_id).toBe(seeded.members.commenter.id)
    const canary = words('screening')
    const at = await eraseToCompletion(seeded.members.author.id, started(seeded))
    await mustDecide(
      seeded.members.moderator,
      `orphan-comment.${report.id}`,
      actionInput('resolve', canary)
    )
    await eraseToCompletion(seeded.members.commenter.id, at)
    await expectWords(canary, true)
  })

  it('keeps the commenter out of the decision on that orphan case', async () => {
    const { seeded, report } = await screened()
    await eraseToCompletion(seeded.members.author.id, started(seeded))
    const answered = await staffOf(seeded.members.commenter).decide(
      `orphan-comment.${report.id}`,
      { action: 'resolve', reason: 'Self review.' }
    )
    expect([answered.status, codeOf(answered)]).toEqual([403, 'self_review_refused'])
  })
})

describe('I-P-RACE: an orphan comment decision meets its commenter erasure', () => {
  async function orphaned() {
    const seeded = await world()
    const at = await eraseToCompletion(seeded.members.author.id, started(seeded))
    const staff = staffOf(seeded.members.moderator)
    const expectedRevision = (await staff.detail(seeded.orphanComment)).revision
    const canary = words('race')
    const decide = () =>
      Promise.resolve(
        staff.decide(seeded.orphanComment, {
          action: 'resolve',
          reason: canary,
          expectedRevision,
        })
      )
    return { seeded, at, canary, decide }
  }

  it('takes the words of a decision already running', async () => {
    const { seeded, at, canary, decide } = await orphaned()
    const commenter = seeded.members.commenter.id
    const [answered] = await runInOrder(
      prisma,
      ctx.database.url,
      'AuditLog',
      decide,
      () => eraseToCompletion(commenter, at)
    )
    expect(answered.status, JSON.stringify(answered.body)).toBe(200)
    await sweepAt(new Date(at.getTime() + 80 * HOUR_MS))
    await expectWords(canary, true)
    await expectNoIdentity([commenter], false)
  })

  it('stores no subject on a decision that waited behind the erasure', async () => {
    const { seeded, at, canary, decide } = await orphaned()
    const commenter = seeded.members.commenter.id
    const [, answered] = await runInOrder(
      prisma,
      ctx.database.url,
      'ModerationErasureRequest',
      () => erase(prisma, commenter, at),
      decide
    )
    expect(answered.status, JSON.stringify(answered.body)).toBe(200)
    const row = await prisma.moderationDecision.findFirstOrThrow({
      where: { case_key: seeded.orphanComment },
    })
    expect(row).toMatchObject({ subject_user_id: null, reason: canary })
    await expectNoIdentity([commenter], false)
  })
})
