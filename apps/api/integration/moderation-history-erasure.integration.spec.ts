// Learning path Step 53: Immutable moderation history.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-53-immutable-moderation-history
// Story 6.13 test owner: account erasure on real Postgres, at the moment of the request.
// I-E-SUBJECT, -REPORTER, -MODERATOR, -HISTORY-INTACT, -ATOMIC, -ORDER, -REPLAY, -REQUESTED-BY, -NO-REMINT,
// -LOCKED-OUT, -WITHDRAW-KEEPS, -THIRD-PARTY-TEXT, -SANCTION, -DECIDE-AFTER, -CONSOLE-AFTER, -MUTATION-REPLAY,
// -RACE-SUBJECT, -RACE-REPORTER, -SWEEP-GUARD-GONE
import { randomUUID } from 'node:crypto'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { buildCommunityObjectPath } from '@couture/utils'
import { moderationDecisionResponseSchema } from '@couture/api-client/contracts/http'
import { generateCommunityAuthorAlias } from '../src/modules/community/community-alias.js'
import { memberIdentityRemains } from '../src/modules/community/community-erasure.js'
import { CommunityRepository } from '../src/modules/community/community.repository.js'
import {
  decisionFixtures,
  moderationDecisionsTestContext,
  type DecisionBoot,
} from './helpers/moderation-decisions-seed.js'
import {
  ERASED_REASON,
  erase,
  holdBarrier,
  waitForLockWaiters,
  installTrigger,
  seedDecision,
  seedErasableMember,
  waitForBarrierWaiter,
} from './helpers/moderation-history-seed.js'

vi.setConfig({ testTimeout: 60_000 })

const NOW = new Date('2026-11-05T12:00:00.000Z')
const LATER = new Date('2026-11-06T12:00:00.000Z')
const REASON = 'Breaks the community rules.'
const ctx = moderationDecisionsTestContext()
const { prisma, clock } = ctx
const fx = decisionFixtures(prisma, clock.now)

let boot: DecisionBoot
const moderator = async () => boot.staff('moderator', await fx.operator())

beforeAll(async () => {
  clock.at(NOW)
  boot = await ctx.bootApp()
}, 120_000)

afterEach(() => clock.at(NOW))

describe('I-E-SUBJECT: a member with decisions, reports, an alias and a ban', () => {
  it('leaves no id in a decision, report or event, no text in a snapshot, no alias and no sanction', async () => {
    const seeded = await seedErasableMember(prisma, fx, NOW)
    await erase(prisma, seeded.member.id, NOW)

    const decision = await prisma.moderationDecision.findUniqueOrThrow({
      where: { id: seeded.decision.id },
    })
    expect(decision.subject_user_id).toBeNull()
    expect(decision.reason).toBe(ERASED_REASON)
    expect(decision.anonymized_at).not.toBeNull()
    expect(decision.subject_alias).toBe(seeded.member.alias)

    const report = await prisma.communityPostReport.findUniqueOrThrow({
      where: { id: seeded.report.id },
    })
    expect(JSON.stringify(report.content_snapshot)).not.toContain(seeded.canaries.caption)
    expect(JSON.stringify(report.content_snapshot)).not.toContain(seeded.canaries.altText)
    expect(report.content_snapshot).toEqual({
      locale: 'en-US',
      climateBand: 'temperate_dry',
      capturedAt: NOW.toISOString(),
    })

    const event = await prisma.moderationEvent.findUniqueOrThrow({
      where: { id: seeded.event.id },
    })
    expect(event.flagged_by_id).toBeNull()
    expect(JSON.stringify(event.content_snapshot)).not.toContain(seeded.canaries.caption)

    expect(
      await prisma.communityAlias.findUnique({ where: { user_id: seeded.member.id } })
    ).toBeNull()
    expect(
      await prisma.communitySanction.findUnique({ where: { id: seeded.sanction.id } })
    ).toBeNull()

    const filed = await prisma.communityPostReport.findUniqueOrThrow({
      where: { id: seeded.filed.id },
    })
    expect(filed.reporter_id).toBeNull()
    expect(filed.details).toBeNull()

    const request = await prisma.moderationErasureRequest.findUniqueOrThrow({
      where: { member_id: seeded.member.id },
    })
    expect(request.requested_at).toEqual(NOW)
    expect(request.completed_at).toBeNull()
  })

  it('[I-E-THIRD-PARTY-TEXT] keeps a third party details, and leaves another post snapshot alone', async () => {
    const seeded = await seedErasableMember(prisma, fx, NOW)
    const untouched = await fx.postCase({ author: seeded.thirdParty })
    const before = await prisma.communityPostReport.findUniqueOrThrow({
      where: { id: untouched.reportIds[0]! },
    })
    await erase(prisma, seeded.member.id, NOW)
    const report = await prisma.communityPostReport.findUniqueOrThrow({
      where: { id: seeded.report.id },
    })
    expect(report.details).toBe(seeded.canaries.thirdPartyDetails)
    expect(report.reporter_id).toBe(seeded.thirdParty.id)
    expect(
      await prisma.communityPostReport.findUniqueOrThrow({
        where: { id: untouched.reportIds[0]! },
      })
    ).toEqual(before)
  })
})

describe('U-SNAPSHOT-STRIP, U-S-REPAIR-NO-WORK', () => {
  it('drops any key but the three, an unknown one included, and leaves no snapshot alone', async () => {
    const seeded = await seedErasableMember(prisma, fx, NOW)
    await prisma.communityPostReport.update({
      where: { id: seeded.report.id },
      data: {
        content_snapshot: {
          caption: 'x',
          futureTextField: seeded.canaries.caption,
          locale: 'en-US',
          climateBand: 'temperate_dry',
          capturedAt: NOW.toISOString(),
        },
      },
    })
    await erase(prisma, seeded.member.id, NOW)
    const report = await prisma.communityPostReport.findUniqueOrThrow({
      where: { id: seeded.report.id },
    })
    expect(Object.keys(report.content_snapshot as object).sort()).toEqual([
      'capturedAt',
      'climateBand',
      'locale',
    ])
  })

  it('reports no identity left after erasure, so the sweep takes no guard, and sees a late row', async () => {
    const seeded = await seedErasableMember(prisma, fx, NOW)
    await erase(prisma, seeded.member.id, NOW)
    expect(await memberIdentityRemains(prisma, seeded.member.id)).toBe(false)
    await seedDecision(prisma, {
      caseKey: `post.late-${seeded.post.id}`,
      at: LATER,
      subjectId: seeded.member.id,
    })
    expect(await memberIdentityRemains(prisma, seeded.member.id)).toBe(true)
  })
})

describe('I-E-OPERATOR-COPIES: the words copied out of a decision', () => {
  it('redacts the event, the comment audit and the post, on the request', async () => {
    const seeded = await seedErasableMember(prisma, fx, NOW)
    const words = seeded.decision.reason
    await erase(prisma, seeded.member.id, NOW)
    const event = await prisma.moderationEvent.findUniqueOrThrow({
      where: { id: seeded.operatorEvent.id },
    })
    expect(event.reason).toBe(ERASED_REASON)
    const post = await prisma.lookbookPost.findUniqueOrThrow({
      where: { id: seeded.post.id },
    })
    expect(post.moderation_reason).toBeNull()
    expect(JSON.stringify(event)).not.toContain(words)
  })

  it('redacts a comment audit reason on the case', async () => {
    const seeded = await fx.commentCase({ reports: 1 })
    const reporter = seeded.reporters[0]!
    const words = 'Words quoting the reporter, on a comment case.'
    await seedDecision(prisma, {
      caseKey: seeded.caseId,
      at: NOW,
      subjectId: seeded.author.id,
      commentId: seeded.commentId,
      reportIds: seeded.reportIds,
      reason: words,
    })
    const audit = await prisma.communityCommentAudit.create({
      data: {
        report_id: seeded.reportIds[0]!,
        action: 'operator_takedown',
        reason: words,
      },
    })
    await erase(prisma, reporter.id, NOW)
    expect(
      (await prisma.communityCommentAudit.findUniqueOrThrow({ where: { id: audit.id } }))
        .reason
    ).toBe(ERASED_REASON)
  })

  it('still reaches the copy when an earlier erasure already nulled its reviewer', async () => {
    const seeded = await seedErasableMember(prisma, fx, NOW)
    await erase(prisma, seeded.operator.id, NOW)
    expect(
      (
        await prisma.moderationEvent.findUniqueOrThrow({
          where: { id: seeded.operatorEvent.id },
        })
      ).reviewed_by_id
    ).toBeNull()
    await erase(prisma, seeded.member.id, NOW)
    expect(
      (
        await prisma.moderationEvent.findUniqueOrThrow({
          where: { id: seeded.operatorEvent.id },
        })
      ).reason
    ).toBe(ERASED_REASON)
  })

  it('leaves the same words alone on a case that has nothing to do with this member', async () => {
    const seeded = await seedErasableMember(prisma, fx, NOW)
    const words = seeded.decision.reason
    const other = await fx.postCase()
    const operator = await fx.operator()
    const live = await prisma.moderationEvent.create({
      data: {
        post_id: other.postId,
        reviewed_by_id: operator.id,
        action: 'report_resolved',
        reason: words,
        created_at: NOW,
      },
    })
    const orphan = await prisma.moderationEvent.create({
      data: {
        post_id: null,
        reviewed_by_id: operator.id,
        subject_alias: `${fx.runId}-someone-else`,
        action: 'report_resolved',
        reason: words,
        created_at: NOW,
      },
    })
    const audit = await prisma.communityCommentAudit.create({
      data: { report_id: null, action: 'operator_takedown', reason: words },
    })
    await erase(prisma, seeded.member.id, NOW)
    for (const id of [live.id, orphan.id])
      expect(
        (await prisma.moderationEvent.findUniqueOrThrow({ where: { id } })).reason
      ).toBe(words)
    expect(
      (await prisma.communityCommentAudit.findUniqueOrThrow({ where: { id: audit.id } }))
        .reason
    ).toBe(words)
  })

  it('keeps a moderator own words when only that moderator is erased', async () => {
    const seeded = await seedErasableMember(prisma, fx, NOW)
    await erase(prisma, seeded.operator.id, NOW)
    const event = await prisma.moderationEvent.findUniqueOrThrow({
      where: { id: seeded.operatorEvent.id },
    })
    expect(event.reason).toBe(seeded.decision.reason)
    expect(event.reviewed_by_id).toBeNull()
  })
})

describe('I-E-REPORTER: a member who filed reports', () => {
  it('nulls reporter and details, keeps the case open and actionable, and redacts the decision', async () => {
    const seeded = await fx.postCase({ reports: 2 })
    const reporter = seeded.reporters[0]!
    await prisma.communityPostReport.update({
      where: { id: seeded.reportIds[0]! },
      data: { details: 'I saw this on my feed.' },
    })
    const staff = await moderator()
    const escalated = await staff.decide(seeded.caseId, {
      action: 'escalate',
      reason: REASON,
    })
    expect(escalated.status).toBe(200)

    await erase(prisma, reporter.id, NOW)

    const report = await prisma.communityPostReport.findUniqueOrThrow({
      where: { id: seeded.reportIds[0]! },
    })
    expect(report.reporter_id).toBeNull()
    expect(report.details).toBeNull()
    expect(report.resolved_at).toBeNull()

    const [decision] = await prisma.moderationDecision.findMany({
      where: { case_key: seeded.caseId },
    })
    expect(decision!.reason).toBe(ERASED_REASON)
    expect(decision!.subject_user_id).toBe(seeded.author.id)
    expect(decision!.action).toBe('escalate')

    const detail = await staff.detail(seeded.caseId)
    expect(detail.reporters.some((entry) => entry.identity.state === 'erased')).toBe(true)
    const admin = boot.staff('admin', await fx.operator())
    const resolved = await admin.decide(seeded.caseId, {
      action: 'resolve',
      reason: REASON,
    })
    expect(resolved.status).toBe(200)
  })

  it('[I-E-ORDER] still finds a comment report, which `eraseCommunityComments` nulls later', async () => {
    const seeded = await fx.commentCase({ reports: 1 })
    const reporter = seeded.reporters[0]!
    const decision = await seedDecision(prisma, {
      caseKey: seeded.caseId,
      at: NOW,
      subjectId: seeded.author.id,
      commentId: seeded.commentId,
      reportIds: seeded.reportIds,
    })
    await erase(prisma, reporter.id, NOW)
    const after = await prisma.moderationDecision.findUniqueOrThrow({
      where: { id: decision.id },
    })
    expect(after.reason).toBe(ERASED_REASON)
    const report = await prisma.communityCommentReport.findUniqueOrThrow({
      where: { id: seeded.reportIds[0]! },
    })
    expect(report.reporter_id).toBeNull()
  })
})

describe('I-E-MODERATOR: a member who decided cases', () => {
  it('nulls the moderator, keeps role and reason, and leaves other moderators rows alone', async () => {
    const seeded = await fx.postCase()
    const first = await fx.operator()
    const second = await fx.operator()
    const theirs = await seedDecision(prisma, {
      caseKey: seeded.caseId,
      at: NOW,
      sequence: 1,
      moderatorId: first.id,
      subjectId: seeded.author.id,
      reportIds: seeded.reportIds,
      reason: 'The first moderator wrote this.',
    })
    const others = await seedDecision(prisma, {
      caseKey: seeded.caseId,
      at: NOW,
      sequence: 2,
      moderatorId: second.id,
      subjectId: seeded.author.id,
      reportIds: seeded.reportIds,
      reason: 'The second moderator wrote this.',
    })
    await erase(prisma, first.id, NOW)
    const after = await prisma.moderationDecision.findUniqueOrThrow({
      where: { id: theirs.id },
    })
    expect(after.moderator_id).toBeNull()
    expect(after.moderator_role).toBe('moderator')
    expect(after.reason).toBe('The first moderator wrote this.')
    expect(after.subject_user_id).toBe(seeded.author.id)
    expect(after.anonymized_at).not.toBeNull()
    expect(
      await prisma.moderationDecision.findUniqueOrThrow({ where: { id: others.id } })
    ).toEqual(others)
  })
})

describe('I-E-HISTORY-INTACT', () => {
  it('keeps action, time, role, sequence and firstDecisionAt on the real read path', async () => {
    const seeded = await fx.postCase()
    const staff = await moderator()
    const escalated = await staff.decide(seeded.caseId, {
      action: 'escalate',
      reason: REASON,
    })
    expect(escalated.status).toBe(200)
    clock.at(new Date(NOW.getTime() + 60_000))
    const admin = boot.staff('admin', await fx.operator())
    const resolved = await admin.decide(seeded.caseId, {
      action: 'resolve',
      reason: REASON,
    })
    expect(resolved.status).toBe(200)
    const capture = async () => {
      const rows = await prisma.moderationDecision.findMany({
        where: { case_key: seeded.caseId },
        orderBy: { sequence: 'asc' },
        select: {
          id: true,
          case_key: true,
          sequence: true,
          source: true,
          report_ids: true,
          action: true,
          moderator_role: true,
          subject_alias: true,
          mutation_id: true,
          payload_hash: true,
          response: true,
          is_terminal: true,
          decided_at: true,
        },
      })
      const detail = await staff.detail(seeded.caseId)
      return { rows, firstDecisionAt: detail.firstDecisionAt }
    }
    const before = await capture()
    expect(before.firstDecisionAt).toBe(new Date(NOW.getTime() + 60_000).toISOString())
    await erase(prisma, seeded.author.id, LATER)
    expect(await capture()).toEqual(before)
  })
})

describe('I-E-ATOMIC', () => {
  it.each([
    ['CommunityPostReport', 'BEFORE UPDATE'],
    ['ModerationEvent', 'BEFORE UPDATE'],
    ['CommunitySanction', 'BEFORE DELETE'],
    ['CommunityAlias', 'BEFORE DELETE'],
    ['ModerationErasureRequest', 'BEFORE INSERT'],
  ])(
    'rolls everything back when %s fails, and a retry succeeds',
    async (table, timing) => {
      const seeded = await seedErasableMember(prisma, fx, NOW)
      const decision = await prisma.moderationDecision.findUniqueOrThrow({
        where: { id: seeded.decision.id },
      })
      const remove = await installTrigger(
        prisma,
        table,
        timing,
        "RAISE EXCEPTION 'injected fault' USING ERRCODE = 'XX000';"
      )
      try {
        await expect(erase(prisma, seeded.member.id, NOW)).rejects.toThrow()
      } finally {
        await remove()
      }
      expect(
        await prisma.moderationErasureRequest.findUnique({
          where: { member_id: seeded.member.id },
        })
      ).toBeNull()
      expect(
        await prisma.moderationDecision.findUniqueOrThrow({ where: { id: decision.id } })
      ).toEqual(decision)
      expect(
        await prisma.communityAlias.findUnique({ where: { user_id: seeded.member.id } })
      ).not.toBeNull()
      expect(
        await prisma.communitySanction.findUnique({ where: { id: seeded.sanction.id } })
      ).not.toBeNull()
      const filed = await prisma.communityPostReport.findUniqueOrThrow({
        where: { id: seeded.filed.id },
      })
      expect(filed.reporter_id).toBe(seeded.member.id)

      await erase(prisma, seeded.member.id, NOW)
      expect(
        await prisma.moderationErasureRequest.findUnique({
          where: { member_id: seeded.member.id },
        })
      ).not.toBeNull()
    }
  )
})

describe('I-E-REPLAY', () => {
  it('keeps the first row and clock, and can run again safely', async () => {
    const seeded = await seedErasableMember(prisma, fx, NOW)
    await erase(prisma, seeded.member.id, NOW)
    const first = await prisma.moderationErasureRequest.findUniqueOrThrow({
      where: { member_id: seeded.member.id },
    })
    await erase(prisma, seeded.member.id, LATER)
    expect(
      await prisma.moderationErasureRequest.findUniqueOrThrow({
        where: { member_id: seeded.member.id },
      })
    ).toEqual(first)
    const post = await prisma.lookbookPost.findUniqueOrThrow({
      where: { id: seeded.post.id },
    })
    expect(post.erasure_requested_at).toEqual(NOW)
  })
})

describe('I-E-REQUESTED-BY', () => {
  it('nulls requested_by when the admin who asked is later erased', async () => {
    const admin = await fx.operator()
    const target = await fx.member('target')
    await erase(prisma, target.id, NOW, admin.id)
    expect(
      (
        await prisma.moderationErasureRequest.findUniqueOrThrow({
          where: { member_id: target.id },
        })
      ).requested_by
    ).toBe(admin.id)
    await erase(prisma, admin.id, LATER)
    expect(
      (
        await prisma.moderationErasureRequest.findUniqueOrThrow({
          where: { member_id: target.id },
        })
      ).requested_by
    ).toBeNull()
  })
})

describe('I-E-NO-REMINT', () => {
  it('creates no alias after erasure, through any resolver', async () => {
    const seeded = await seedErasableMember(prisma, fx, NOW)
    await erase(prisma, seeded.member.id, NOW)
    const repository = new CommunityRepository(prisma)
    expect(
      await repository.resolveAlias(seeded.member.id, generateCommunityAuthorAlias)
    ).toBeNull()
    const aliases = await repository.resolveAliases(
      [seeded.member.id],
      generateCommunityAuthorAlias
    )
    expect(aliases.get(seeded.member.id) ?? null).toBeNull()
    expect(
      await prisma.communityAlias.findUnique({ where: { user_id: seeded.member.id } })
    ).toBeNull()
  })

  it('still mints for a member with no erasure', async () => {
    const seeded = await fx.operator()
    const repository = new CommunityRepository(prisma)
    expect(
      await repository.resolveAlias(seeded.id, generateCommunityAuthorAlias)
    ).toEqual(expect.any(String))
  })
})

describe('I-E-LOCKED-OUT', () => {
  it('denies an erased member allocate, publish, report, comment and reaction, and writes nothing', async () => {
    const seeded = await seedErasableMember(prisma, fx, NOW)
    // Allocate mints the upload session before the draft's transaction refuses the member.
    Object.assign(ctx.storage, {
      createUploadSession: () =>
        Promise.resolve({ signedUrl: 'https://storage.test/upload', token: 'token' }),
    })
    const target = await fx.post({ authorId: seeded.thirdParty.id })
    // A draft with a live upload session, which is the one post a member could still try to publish.
    const draftId = randomUUID()
    const uploadSessionId = randomUUID()
    const draftPath = buildCommunityObjectPath(draftId, uploadSessionId, 'jpg')
    await prisma.lookbookPost.create({
      data: {
        id: draftId,
        user_id: seeded.member.id,
        status: 'draft',
        image_object_path: draftPath,
        upload_expires_at: new Date(Date.now() + 3_600_000),
      },
    })
    Object.assign(ctx.storage, {
      signReadUrls: (paths: string[]) =>
        Promise.resolve(
          new Map(paths.map((path) => [path, 'https://storage.test/read']))
        ),
    })
    await erase(prisma, seeded.member.id, NOW)
    const member = boot.member(seeded.member.id)
    const before = await prisma.communityPostReport.count({
      where: { reporter_id: seeded.member.id },
    })
    expect(before).toBe(0)

    const postsBefore = await prisma.lookbookPost.count({
      where: { user_id: seeded.member.id },
    })
    const answers = {
      report: await member.post(`/api/v1/community/posts/${target.id}/report`).send({
        reason: 'harassment',
      }),
      reaction: await member
        .put(`/api/v1/community/posts/${target.id}/reaction`)
        .set('x-couture-platform', 'web')
        .send({ selection: 'love', mutationId: randomUUID(), baseRevision: 0 }),
      comment: await member.post(`/api/v1/community/posts/${target.id}/comments`).send({
        mutationId: randomUUID(),
        body: 'A new comment',
        locale: 'en-US',
        parentId: null,
      }),
      allocate: await member
        .post('/api/v1/community/posts/allocate')
        .set('Idempotency-Key', randomUUID())
        .send({
          locale: 'en-US',
          contentType: 'image/jpeg',
          byteSize: 1000,
          sha256: 'a'.repeat(64),
          widthPx: 512,
          heightPx: 640,
        }),
    }
    for (const [route, answer] of Object.entries(answers))
      expect([
        route,
        answer.status,
        (answer.body as { message?: string }).message,
      ]).toEqual([route, 403, expect.stringMatching(/^Community account unavailable/)])
    // A draft with a live session, the one post a member could still try to move.
    const publish = await member
      .post('/api/v1/community/posts/publish')
      .set('Idempotency-Key', randomUUID())
      .send({
        postId: draftId,
        uploadSessionId,
        altText: 'An outfit on a sunny day',
        altTextConfirmed: true,
        caption: null,
        locale: 'en-US',
      })
    expect([publish.status, (publish.body as { message?: string }).message]).toEqual([
      403,
      expect.stringMatching(/^Community account unavailable/),
    ])
    expect(
      await prisma.lookbookPost.findUniqueOrThrow({
        where: { id: draftId },
        select: { status: true, submitted_at: true },
      })
    ).toEqual({ status: 'draft', submitted_at: null })
    expect(
      await prisma.lookbookPost.count({ where: { user_id: seeded.member.id } })
    ).toBe(postsBefore)
    expect(
      await prisma.communityReaction.count({ where: { user_id: seeded.member.id } })
    ).toBe(0)

    expect(
      await prisma.communityPostReport.count({ where: { reporter_id: seeded.member.id } })
    ).toBe(0)
    expect(
      await prisma.communityComment.count({ where: { user_id: seeded.member.id } })
    ).toBe(0)
    expect(
      await prisma.communityAlias.findUnique({ where: { user_id: seeded.member.id } })
    ).toBeNull()
  })
})

describe('I-E-WITHDRAW-KEEPS', () => {
  it('keeps snapshot, identity and decision through a plain withdrawal', async () => {
    const seeded = await seedErasableMember(prisma, fx, NOW)
    const repository = new CommunityRepository(prisma)
    const before = await prisma.moderationDecision.findUniqueOrThrow({
      where: { id: seeded.decision.id },
    })
    const report = await prisma.communityPostReport.findUniqueOrThrow({
      where: { id: seeded.report.id },
    })
    await repository.withdrawPostAndRequestErasure(seeded.post.id, NOW)
    expect(
      await prisma.moderationDecision.findUniqueOrThrow({
        where: { id: seeded.decision.id },
      })
    ).toEqual(before)
    expect(
      await prisma.communityPostReport.findUniqueOrThrow({
        where: { id: seeded.report.id },
      })
    ).toEqual(report)
    expect(
      await prisma.moderationErasureRequest.findUnique({
        where: { member_id: seeded.member.id },
      })
    ).toBeNull()
    expect(
      await prisma.communityAlias.findUnique({ where: { user_id: seeded.member.id } })
    ).not.toBeNull()
  })
})

describe('I-E-SANCTION', () => {
  it('removes an active ban, keeps its decision, and leaves the ban-hold sweep nothing to do', async () => {
    const seeded = await seedErasableMember(prisma, fx, NOW)
    await erase(prisma, seeded.member.id, NOW)
    expect(
      await prisma.communitySanction.count({ where: { user_id: seeded.member.id } })
    ).toBe(0)
    const kept = await prisma.moderationDecision.findUniqueOrThrow({
      where: { id: seeded.decision.id },
    })
    expect(kept.action).toBe('ban')
    const { CommunityMaintenanceService } = await import(
      '../src/modules/community/community-maintenance.service.js'
    )
    const service = new CommunityMaintenanceService(prisma, {
      remove: () => Promise.resolve(),
    } as never)
    await expect(service.sweepExpiredBanHolds(LATER)).resolves.toEqual({
      subjects: 0,
      posts: 0,
      comments: 0,
    })
  })
})

describe('I-E-DECIDE-AFTER, I-E-CONSOLE-AFTER, I-E-MUTATION-REPLAY: the case after the request', () => {
  it('stores a null subject and refuses a ban while the post row remains', async () => {
    const seeded = await fx.postCase()
    await erase(prisma, seeded.author.id, NOW)
    const staff = boot.staff('admin', await fx.operator())

    const ban = await staff.decide(seeded.caseId, {
      action: 'ban',
      reason: REASON,
      ban: { kind: 'permanent' },
    })
    expect(ban.status).toBe(409)
    expect(JSON.stringify(ban.body)).toContain('author_ineligible')
    expect(
      await prisma.communitySanction.count({ where: { user_id: seeded.author.id } })
    ).toBe(0)

    const resolve = await staff.decide(seeded.caseId, {
      action: 'resolve',
      reason: REASON,
    })
    expect(resolve.status).toBe(200)
    const [row] = await prisma.moderationDecision.findMany({
      where: { case_key: seeded.caseId },
    })
    expect(row!.subject_user_id).toBeNull()
    expect(row!.reason).toBe(REASON)
  })

  it('labels a redacted reason and offers no appeal on the case detail', async () => {
    const seeded = await fx.postCase()
    const staff = boot.staff('admin', await fx.operator())
    const banned = await staff.decide(seeded.caseId, {
      action: 'ban',
      reason: REASON,
      ban: { kind: 'permanent' },
    })
    expect(banned.status).toBe(200)
    await erase(prisma, seeded.author.id, NOW)
    const detail = await staff.detail(seeded.caseId)
    expect(JSON.stringify(detail)).not.toContain(ERASED_REASON)
    // A live post reads its prior actions from events, and the decision row answers for an orphan.
    const prior = detail.priorActions.find(
      (entry) => entry.action === 'banned_by_operator'
    )
    expect(prior).toMatchObject({ reason: null, reasonRemoved: true })
    expect(JSON.stringify(detail)).not.toContain(REASON)
    expect(detail.subjectStanding?.allowedAppealSteps ?? []).toEqual([])
    expect(detail.subjectStanding?.sanction ?? null).toBeNull()
  })

  it('returns the stored response for the same mutation after anonymization, with no user id in it', async () => {
    const seeded = await fx.postCase()
    const staff = await moderator()
    const mutationId = randomUUID()
    const detail = await staff.detail(seeded.caseId)
    const first = await staff.decide(seeded.caseId, {
      action: 'resolve',
      reason: REASON,
      mutationId,
      expectedRevision: detail.revision,
    })
    expect(first.status).toBe(200)
    await erase(prisma, seeded.author.id, NOW)
    const again = await staff.decide(seeded.caseId, {
      action: 'resolve',
      reason: REASON,
      mutationId,
      expectedRevision: detail.revision,
    })
    expect(again.status).toBe(200)
    const body = (response: { body: unknown }) =>
      moderationDecisionResponseSchema.parse(response.body).data
    expect(body(again).decisionId).toBe(body(first).decisionId)
    expect(body(again).replayed).toBe(true)
    const [row] = await prisma.moderationDecision.findMany({
      where: { case_key: seeded.caseId },
    })
    expect(JSON.stringify(row!.response)).not.toContain(seeded.author.id)
  })
})

describe('races, with the order forced by a barrier', () => {
  const barrierBody = (key: number) => `PERFORM pg_advisory_xact_lock(${key});`

  /**
   * Holds `first` at a barrier inside its transaction, starts `second` and waits until the database
   * reports it blocked behind `first`, then lets both finish. A second that does not wait fails here.
   */
  async function inForcedOrder<A, B>(
    table: 'ModerationDecision' | 'ModerationErasureRequest',
    first: () => Promise<A>,
    second: () => Promise<B>
  ): Promise<[A, B]> {
    const key = 900_000 + Math.floor(Math.random() * 90_000)
    const release = await holdBarrier(ctx.database.url, key)
    const remove = await installTrigger(prisma, table, 'BEFORE INSERT', barrierBody(key))
    try {
      const running = first()
      running.catch(() => undefined)
      await waitForBarrierWaiter(prisma, key)
      const blocked = second()
      blocked.catch(() => undefined)
      await waitForLockWaiters(prisma, 2)
      await release()
      return await Promise.all([running, blocked])
    } finally {
      await release()
      await remove()
    }
  }

  const decide = async (caseId: string, action: 'escalate' | 'resolve') => {
    const staff = await moderator()
    const expectedRevision = (await staff.detail(caseId)).revision
    return () =>
      Promise.resolve(staff.decide(caseId, { action, reason: REASON, expectedRevision }))
  }

  it('[I-E-RACE-REPORTER] redacts a decision that was running when a reporter was erased', async () => {
    const seeded = await fx.postCase()
    const decision = await decide(seeded.caseId, 'escalate')
    const [answered] = await inForcedOrder('ModerationDecision', decision, () =>
      erase(prisma, seeded.reporters[0]!.id, NOW)
    )
    expect(answered.status).toBe(200)
    const rows = await prisma.moderationDecision.findMany({
      where: { case_key: seeded.caseId },
    })
    expect(rows).toHaveLength(1)
    expect(rows[0]!.reason).toBe(ERASED_REASON)
  })

  it('[I-E-RACE-REPORTER] lets a decision run after a reporter erasure with no deadlock', async () => {
    const seeded = await fx.postCase({ reports: 2 })
    const decision = await decide(seeded.caseId, 'resolve')
    const [, answered] = await inForcedOrder(
      'ModerationErasureRequest',
      () => erase(prisma, seeded.reporters[0]!.id, NOW),
      decision
    )
    expect(answered.status).toBe(200)
    const report = await prisma.communityPostReport.findUniqueOrThrow({
      where: { id: seeded.reportIds[0]! },
    })
    expect(report.reporter_id).toBeNull()
    const rows = await prisma.moderationDecision.findMany({
      where: { case_key: seeded.caseId },
    })
    expect(rows).toHaveLength(1)
    expect(rows[0]!.reason).toBe(REASON)
  })

  it('[I-E-RACE-SUBJECT] strips a decision that was running when its subject was erased', async () => {
    const seeded = await fx.postCase()
    const decision = await decide(seeded.caseId, 'resolve')
    const [answered] = await inForcedOrder('ModerationDecision', decision, () =>
      erase(prisma, seeded.author.id, NOW)
    )
    expect(answered.status).toBe(200)
    const rows = await prisma.moderationDecision.findMany({
      where: { case_key: seeded.caseId },
    })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ subject_user_id: null, reason: ERASED_REASON })
  })

  it('[I-E-RACE-SUBJECT] stores no subject on a decision that waited behind the erasure', async () => {
    const seeded = await fx.postCase()
    const decision = await decide(seeded.caseId, 'resolve')
    const [, answered] = await inForcedOrder(
      'ModerationErasureRequest',
      () => erase(prisma, seeded.author.id, NOW),
      decision
    )
    expect(answered.status).toBe(200)
    const rows = await prisma.moderationDecision.findMany({
      where: { case_key: seeded.caseId },
    })
    expect(rows).toHaveLength(1)
    expect(rows[0]!.subject_user_id).toBeNull()
  })
})

describe('I-E-SWEEP-GUARD-GONE', () => {
  it('runs repair after CommunitySubject was deleted', async () => {
    const seeded = await seedErasableMember(prisma, fx, NOW)
    await erase(prisma, seeded.member.id, NOW)
    expect(
      await prisma.communitySubject.findUnique({ where: { member_id: seeded.member.id } })
    ).toBeNull()
    const late = await seedDecision(prisma, {
      caseKey: `post.late-${seeded.post.id}`,
      at: LATER,
      subjectId: seeded.member.id,
    })
    const { CommunityMaintenanceService } = await import(
      '../src/modules/community/community-maintenance.service.js'
    )
    const service = new CommunityMaintenanceService(prisma, {
      remove: () => Promise.resolve(),
    } as never)
    await service.sweepErasureRequests(LATER)
    const after = await prisma.moderationDecision.findUniqueOrThrow({
      where: { id: late.id },
    })
    expect(after.subject_user_id).toBeNull()
    expect(after.reason).toBe(ERASED_REASON)
  })
})
