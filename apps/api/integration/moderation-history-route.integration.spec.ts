// Learning path Step 53: Immutable moderation history.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-53-immutable-moderation-history
// Story 6.13 test owner: both routes through the real module, real guards and real HTTP, on real Postgres.
// A-ER-ADMIN, A-ER-AUDIT, A-ER-REPLAY, A-ER-ROLES, A-ER-UNKNOWN, A-X-APPEAL, A-X-AUDIT-FAIL, A-X-AUDIT-ONE, A-X-CANARY, A-X-CASE, A-X-ERASED, A-X-HOSTILE, A-X-MOD-ERASED, A-X-REKEY, A-X-SELF, A-X-UNKNOWN
import { randomUUID } from 'node:crypto'
import request from 'supertest'
import { describe, expect, it, vi } from 'vitest'
import { moderationErasureResponseSchema } from '@couture/api-client/contracts/http'
import { InMemoryCommunityStorage } from '../src/modules/community/community-storage.fake.js'
import {
  COMMUNITY_ERASURE_LATE_WRITE_WINDOW_MS,
  CommunityMaintenanceService,
} from '../src/modules/community/community-maintenance.service.js'
import {
  erase,
  ERASED_REASON,
  installTrigger,
  seedDecision,
  seedErasableMember,
} from './helpers/moderation-history-seed.js'
import {
  NOW,
  ERASURE,
  DAY,
  recomputeDigest,
  useModerationHistoryRoutes,
} from './helpers/moderation-history-route-context.js'

vi.setConfig({ testTimeout: 120_000 })

const { prisma, fx, serverUrl, operator, postAs, exportAs, codeOf, parsed, auditCount } =
  useModerationHistoryRoutes()

describe('POST /erasure-requests', () => {
  it('[A-ER-ADMIN] answers 201 with a deadline exactly 72 hours on', async () => {
    const admin = await operator('admin')
    const target = await fx.member('target')
    const response = await postAs(ERASURE, 'admin', admin.id).send({
      memberId: target.id,
    })
    expect(response.status).toBe(201)
    expect(response.headers['cache-control']).toBe('private, no-store')
    const { data } = moderationErasureResponseSchema.parse(response.body)
    expect(data.replayed).toBe(false)
    expect(Date.parse(data.deadlineAt) - Date.parse(data.requestedAt)).toBe(
      72 * 60 * 60 * 1000
    )
    const row = await prisma.moderationErasureRequest.findUniqueOrThrow({
      where: { member_id: target.id },
    })
    expect(row).toMatchObject({
      id: data.requestId,
      requested_by: admin.id,
      completed_at: null,
    })
  })

  it('[A-ER-REPLAY] answers 200 with the first row and the same deadline', async () => {
    const admin = await operator('admin')
    const second = await operator('admin')
    const target = await fx.member('target')
    const first = await postAs(ERASURE, 'admin', admin.id).send({ memberId: target.id })
    await new Promise((resolve) => setTimeout(resolve, 20))
    const again = await postAs(ERASURE, 'admin', second.id).send({ memberId: target.id })
    expect(again.status).toBe(200)
    const before = moderationErasureResponseSchema.parse(first.body).data
    expect(moderationErasureResponseSchema.parse(again.body).data).toEqual({
      ...before,
      replayed: true,
    })
    expect(await auditCount('moderation_erasure_requested', second.id)).toBe(0)
    const row = await prisma.moderationErasureRequest.findUniqueOrThrow({
      where: { member_id: target.id },
    })
    expect(row.requested_by).toBe(admin.id)
  })

  it('[A-ER-ROLES] refuses a moderator with admin_required, and every other role as 6.10 does', async () => {
    const target = await fx.member('target')
    const moderator = await operator('moderator')
    const refused = await postAs(ERASURE, 'moderator', moderator.id).send({
      memberId: target.id,
    })
    expect(refused.status).toBe(403)
    expect(codeOf(refused)).toBe('admin_required')
    for (const role of ['guardian', 'teen']) {
      const someone = await operator(role)
      const response = await postAs(ERASURE, role, someone.id).send({
        memberId: target.id,
      })
      expect(response.status).toBe(403)
      expect(codeOf(response)).toBeUndefined()
    }
    const anonymous = await request(serverUrl())
      .post(ERASURE)
      .send({ memberId: target.id })
    expect(anonymous.status).toBe(401)
    expect(
      await prisma.moderationErasureRequest.findUnique({
        where: { member_id: target.id },
      })
    ).toBeNull()
  })

  it('[A-ER-UNKNOWN] answers 404 member_not_found, with no row and no audit', async () => {
    const admin = await operator('admin')
    const response = await postAs(ERASURE, 'admin', admin.id).send({
      memberId: 'no-such-member',
    })
    expect(response.status).toBe(404)
    expect(codeOf(response)).toBe('member_not_found')
    expect(await auditCount('moderation_erasure_requested', admin.id)).toBe(0)
    expect(
      await prisma.moderationErasureRequest.findUnique({
        where: { member_id: 'no-such-member' },
      })
    ).toBeNull()
  })

  it('[A-ER-UNKNOWN] answers 400 invalid_request for a bad body', async () => {
    const admin = await operator('admin')
    const response = await postAs(ERASURE, 'admin', admin.id).send({ memberId: '' })
    expect(response.status).toBe(400)
    expect(codeOf(response)).toBe('invalid_request')
  })

  it('[A-ER-AUDIT] commits one audit row with the erasure, with no member id in any new row', async () => {
    const admin = await operator('admin')
    const seeded = await seedErasableMember(prisma, fx, NOW)
    const response = await postAs(ERASURE, 'admin', admin.id).send({
      memberId: seeded.member.id,
    })
    expect(response.status).toBe(201)
    const { data } = moderationErasureResponseSchema.parse(response.body)
    const rows = await prisma.auditLog.findMany({
      where: { user_id: admin.id },
      orderBy: { timestamp: 'asc' },
    })
    expect(rows.map((row) => row.event_type).sort()).toEqual([
      'moderation_erasure_requested',
      'moderation_history_anonymized',
    ])
    const requested = rows.find(
      (row) => row.event_type === 'moderation_erasure_requested'
    )!
    expect(requested.event_data).toEqual({ requestId: data.requestId, role: 'admin' })
    expect(JSON.stringify(rows)).not.toContain(seeded.member.id)
    expect(JSON.stringify(rows)).not.toContain(seeded.member.alias)
  })

  it('[A-ER-AUDIT] rolls the whole request back when the audit write fails', async () => {
    const admin = await operator('admin')
    const seeded = await seedErasableMember(prisma, fx, NOW)
    const remove = await installTrigger(
      prisma,
      'AuditLog',
      'BEFORE INSERT',
      "IF NEW.event_type = 'moderation_erasure_requested' THEN RAISE EXCEPTION 'injected' USING ERRCODE = 'XX000'; END IF;"
    )
    try {
      const response = await postAs(ERASURE, 'admin', admin.id).send({
        memberId: seeded.member.id,
      })
      expect(response.status).toBe(503)
      expect(codeOf(response)).toBe('audit_unavailable')
    } finally {
      await remove()
    }
    expect(
      await prisma.moderationErasureRequest.findUnique({
        where: { member_id: seeded.member.id },
      })
    ).toBeNull()
    const decision = await prisma.moderationDecision.findUniqueOrThrow({
      where: { id: seeded.decision.id },
    })
    expect(decision.subject_user_id).toBe(seeded.member.id)
  })
})

describe('POST /evidence-exports: one case', () => {
  it('[A-X-CASE] downloads a strict attachment holding the decision, reports, audit and alerts', async () => {
    const moderator = await operator('moderator')
    const seeded = await seedErasableMember(prisma, fx, NOW)
    await prisma.auditLog.create({
      data: {
        user_id: seeded.operator.id,
        event_type: 'moderation_decision_applied',
        event_data: {
          decisionId: seeded.decision.id,
          caseId: `post.${seeded.post.id}`,
          action: 'ban',
          role: 'moderator',
        },
      },
    })
    await prisma.moderationSlaAlert.create({
      data: {
        dedupe_key: `sla:post:${seeded.report.id}:breached`,
        kind: 'breached',
        case_key: `post.${seeded.post.id}`,
        source: 'post',
        anchor_report_id: seeded.report.id,
        risk: 'medium',
        sla_due_at: NOW,
        detected_at: NOW,
        delivery: 'delivered',
        next_attempt_at: NOW,
        delivered_at: NOW,
      },
    })
    const response = await exportAs(moderator, {
      scope: 'case',
      caseId: `post.${seeded.post.id}`,
    })
    expect(response.status).toBe(200)
    expect(response.headers['cache-control']).toBe('private, no-store')
    const bundle = parsed(response)
    expect(response.headers['content-disposition']).toBe(
      `attachment; filename="moderation-evidence-${bundle.exportId}.json"`
    )
    expect(bundle.scope).toEqual({ scope: 'case', caseId: `post.${seeded.post.id}` })
    expect(bundle.decisions.map((row) => row.decisionId)).toEqual([seeded.decision.id])
    expect(bundle.decisions[0]).toMatchObject({
      moderatorId: seeded.operator.id,
      moderatorRole: 'moderator',
      subjectAlias: seeded.member.alias,
      reasonRemoved: false,
    })
    expect(bundle.reports.map((row) => row.reportId)).toEqual([seeded.report.id])
    expect(bundle.reports[0]).toMatchObject({ origin: 'member', reporterState: 'member' })
    expect(bundle.auditEvents).toEqual([
      {
        eventType: 'moderation_decision_applied',
        occurredAt: expect.any(String) as string,
        actorId: seeded.operator.id,
        role: 'moderator',
        action: 'ban',
      },
    ])
    expect(bundle.alerts).toHaveLength(1)
    expect(bundle.counts).toEqual({
      decisions: 1,
      reports: 1,
      auditEvents: 1,
      alerts: 1,
      withheldForConflict: 0,
    })
  })

  it('[A-X-CANARY] holds no excluded value anywhere in the raw bytes', async () => {
    const moderator = await operator('moderator')
    const admin = await operator('admin')
    const seeded = await seedErasableMember(prisma, fx, NOW)
    const decision = await prisma.moderationDecision.findUniqueOrThrow({
      where: { id: seeded.decision.id },
    })
    const ip = `198.51.100.${Math.floor(Math.random() * 200) + 1}`
    await prisma.auditLog.create({
      data: {
        user_id: seeded.operator.id,
        event_type: 'moderation_decision_applied',
        ip_address: ip,
        event_data: {
          decisionId: seeded.decision.id,
          caseId: `post.${seeded.post.id}`,
          action: 'ban',
          role: 'moderator',
          secretCanary: 'event-data-canary',
        },
      },
    })
    const author = await prisma.user.findUniqueOrThrow({
      where: { id: seeded.member.id },
    })
    const reporter = await prisma.user.findUniqueOrThrow({
      where: { id: seeded.thirdParty.id },
    })
    const needles = [
      seeded.member.id,
      seeded.thirdParty.id,
      author.email,
      reporter.email,
      seeded.canaries.thirdPartyDetails,
      seeded.canaries.altText,
      seeded.post.id + '/',
      decision.mutation_id,
      decision.payload_hash,
      ip,
      'event-data-canary',
    ]
    const check = (text: string) => {
      for (const needle of needles) expect(text, needle).not.toContain(needle)
    }
    const single = await exportAs(moderator, {
      scope: 'case',
      caseId: `post.${seeded.post.id}`,
    })
    expect(single.status).toBe(200)
    check(single.text)
    const range = await exportAs(admin, {
      scope: 'range',
      from: new Date(NOW.getTime() - DAY).toISOString(),
      to: new Date(NOW.getTime() + DAY).toISOString(),
    })
    expect(range.status).toBe(200)
    check(range.text)
  })

  it('[A-X-AUDIT-ONE] writes exactly one row, whose digest is the bundle digest and recomputes', async () => {
    const moderator = await operator('moderator')
    const seeded = await seedErasableMember(prisma, fx, NOW)
    const caseId = `post.${seeded.post.id}`
    const response = await exportAs(moderator, { scope: 'case', caseId })
    const bundle = parsed(response)
    expect(recomputeDigest(bundle)).toBe(bundle.sha256)
    const rows = await prisma.auditLog.findMany({
      where: { user_id: moderator.id, event_type: 'moderation_evidence_exported' },
    })
    expect(rows).toHaveLength(1)
    expect(rows[0]!.event_data).toEqual({
      exportId: bundle.exportId,
      scope: 'case',
      caseId,
      counts: bundle.counts,
      sha256: bundle.sha256,
      role: 'moderator',
    })
    const text = JSON.stringify(rows[0])
    expect(text).not.toContain(seeded.member.id)
    expect(text).not.toContain(seeded.thirdParty.id)
    expect(text).not.toContain(seeded.member.alias)
    expect(text).not.toContain(seeded.canaries.caption)
  })

  it('[A-X-AUDIT-FAIL] answers 503 audit_unavailable with no bundle bytes', async () => {
    const moderator = await operator('moderator')
    const seeded = await fx.postCase()
    const remove = await installTrigger(
      prisma,
      'AuditLog',
      'BEFORE INSERT',
      "IF NEW.event_type = 'moderation_evidence_exported' THEN RAISE EXCEPTION 'injected' USING ERRCODE = 'XX000'; END IF;"
    )
    try {
      const response = await exportAs(moderator, { scope: 'case', caseId: seeded.caseId })
      expect(response.status).toBe(503)
      expect(codeOf(response)).toBe('audit_unavailable')
      expect((response.body as { decisions?: unknown }).decisions).toBeUndefined()
      expect(response.headers['content-disposition']).toBeUndefined()
    } finally {
      await remove()
    }
  })

  it('[A-X-SELF] refuses an author and a reporter, with no audit row', async () => {
    const seeded = await fx.postCase()
    const reporter = seeded.reporters[0]!
    for (const who of [
      { id: seeded.author.id, role: 'moderator' },
      { id: reporter.id, role: 'moderator' },
      { id: reporter.id, role: 'admin' },
    ]) {
      const response = await exportAs(who, { scope: 'case', caseId: seeded.caseId })
      expect(response.status).toBe(403)
      expect(codeOf(response)).toBe('self_review_refused')
      expect(await auditCount('moderation_evidence_exported', who.id)).toBe(0)
    }
  })

  it('[A-X-SELF] refuses a moderator named as the subject of a decision on an orphaned case', async () => {
    const commenterStaff = await fx.operator()
    const owner = await fx.member('owner')
    const parent = await fx.post({ authorId: owner.id })
    const reporter = await fx.member('reporter')
    const comment = await fx.comment({ postId: parent.id, authorId: commenterStaff.id })
    const report = await fx.commentReport(comment.id, reporter.id)
    await seedDecision(prisma, {
      caseKey: `comment.${comment.id}`,
      at: NOW,
      subjectId: commenterStaff.id,
      commentId: comment.id,
      reportIds: [report.id],
    })
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT community_privacy_guards(ARRAY[]::text[], ARRAY[${parent.id}]::text[], true)`
      await tx.communityComment.delete({ where: { id: comment.id } })
    })
    const response = await exportAs(
      { id: commenterStaff.id, role: 'moderator' },
      { scope: 'case', caseId: `orphan-comment.${report.id}` }
    )
    expect(response.status).toBe(403)
    expect(codeOf(response)).toBe('self_review_refused')
  })

  it('[A-X-UNKNOWN] answers 404 with no audit row', async () => {
    const moderator = await operator('moderator')
    const response = await exportAs(moderator, {
      scope: 'case',
      caseId: 'post.no-such-post',
    })
    expect(response.status).toBe(404)
    expect(codeOf(response)).toBe('case_not_found')
    expect(await auditCount('moderation_evidence_exported', moderator.id)).toBe(0)
  })

  it('[A-X-APPEAL] exports a case whose history holds appeal steps', async () => {
    const moderator = await operator('moderator')
    const seeded = await fx.postCase()
    for (const [sequence, action] of [
      [1, 'ban'],
      [2, 'appeal_requested'],
      [3, 'appeal_overturned'],
    ] as const)
      await prisma.moderationDecision.create({
        data: {
          case_key: seeded.caseId,
          sequence,
          source: 'post',
          post_id: seeded.postId,
          report_ids: seeded.reportIds,
          action,
          reason: 'An appeal rationale.',
          moderator_role: 'moderator',
          mutation_id: randomUUID(),
          payload_hash: 'seeded',
          response: {},
          is_terminal: action === 'ban',
          decided_at: NOW,
        },
      })
    const response = await exportAs(moderator, { scope: 'case', caseId: seeded.caseId })
    expect(response.status).toBe(200)
    expect(parsed(response).decisions.map((row) => row.action)).toEqual([
      'ban',
      'appeal_requested',
      'appeal_overturned',
    ])
  })

  it('[A-X-HOSTILE] returns markup in a reason as a plain JSON string', async () => {
    const moderator = await operator('moderator')
    const seeded = await fx.postCase()
    const hostile = '<script>alert(1)</script> "quoted" \\ {"x":1}'
    await seedDecision(prisma, {
      caseKey: seeded.caseId,
      at: NOW,
      postId: seeded.postId,
      reportIds: seeded.reportIds,
      reason: hostile,
    })
    const response = await exportAs(moderator, { scope: 'case', caseId: seeded.caseId })
    expect(response.headers['content-type']).toMatch(/application\/json/)
    expect(parsed(response).decisions[0]!.reason).toBe(hostile)
  })
})

describe('POST /evidence-exports: an erased case', () => {
  async function completeErasure(memberId: string, storage: InMemoryCommunityStorage) {
    const service = new CommunityMaintenanceService(prisma, storage)
    const atWindow = new Date(NOW.getTime() + COMMUNITY_ERASURE_LATE_WRITE_WINDOW_MS)
    await service.sweepErasureRequests(atWindow)
    await service.sweepErasureRequests(new Date(atWindow.getTime() + 30_000))
    const row = await prisma.moderationErasureRequest.findUniqueOrThrow({
      where: { member_id: memberId },
    })
    expect(row.completed_at).not.toBeNull()
  }

  it('[A-X-ERASED] marks a removed reason, keeps the alias, and reads the reporter as erased', async () => {
    const moderator = await operator('moderator')
    const seeded = await seedErasableMember(prisma, fx, NOW)
    await erase(prisma, seeded.member.id, NOW)
    const response = await exportAs(moderator, {
      scope: 'case',
      caseId: `post.${seeded.post.id}`,
    })
    expect(response.status).toBe(200)
    expect(response.text).not.toContain(ERASED_REASON)
    expect(response.text).not.toContain(seeded.member.id)
    const bundle = parsed(response)
    expect(bundle.decisions[0]).toMatchObject({
      reason: null,
      reasonRemoved: true,
      subjectAlias: seeded.member.alias,
    })
    expect(bundle.decisions[0]!.anonymizedAt).not.toBeNull()

    const reporterCase = await fx.postCase()
    await seedDecision(prisma, {
      caseKey: reporterCase.caseId,
      at: NOW,
      postId: reporterCase.postId,
      subjectId: reporterCase.author.id,
      reportIds: reporterCase.reportIds,
    })
    await erase(prisma, reporterCase.reporters[0]!.id, NOW)
    const erasedReporter = parsed(
      await exportAs(moderator, { scope: 'case', caseId: reporterCase.caseId })
    )
    expect(erasedReporter.reports[0]).toMatchObject({
      origin: 'member',
      reporterState: 'erased',
    })
    expect(erasedReporter.decisions[0]!.reasonRemoved).toBe(true)
  })

  it('[A-X-REKEY] exports an orphaned case through its orphan id, with decisions and audit events', async () => {
    const moderator = await operator('moderator')
    const storage = new InMemoryCommunityStorage()
    const seeded = await seedErasableMember(prisma, fx, NOW)
    await prisma.auditLog.create({
      data: {
        user_id: seeded.operator.id,
        event_type: 'moderation_decision_applied',
        event_data: {
          decisionId: seeded.decision.id,
          caseId: `post.${seeded.post.id}`,
          action: 'ban',
          role: 'moderator',
        },
      },
    })
    await erase(prisma, seeded.member.id, NOW)
    await completeErasure(seeded.member.id, storage)
    const orphan = `orphan-post.${seeded.report.id}`
    await prisma.auditLog.create({
      data: {
        user_id: moderator.id,
        event_type: 'moderation_case_viewed',
        event_data: { caseId: orphan, source: 'post', role: 'moderator' },
      },
    })
    const response = await exportAs(moderator, { scope: 'case', caseId: orphan })
    expect(response.status).toBe(200)
    const bundle = parsed(response)
    expect(bundle.decisions.map((row) => row.decisionId)).toEqual([seeded.decision.id])
    expect(bundle.reports.map((row) => row.reportId)).toEqual([seeded.report.id])
    const types = bundle.auditEvents.map((row) => row.eventType).sort()
    expect(types).toEqual(['moderation_case_viewed', 'moderation_decision_applied'])
    expect(
      bundle.auditEvents.find((row) => row.eventType === 'moderation_case_viewed')
        ?.actorId
    ).toBe(moderator.id)
  })

  it('[A-X-MOD-ERASED] nulls an erased moderator in the bundle while the audit row keeps its value', async () => {
    const exporter = await operator('moderator')
    const decider = await fx.operator()
    const seeded = await fx.postCase()
    const decision = await seedDecision(prisma, {
      caseKey: seeded.caseId,
      at: NOW,
      postId: seeded.postId,
      moderatorId: decider.id,
      subjectId: seeded.author.id,
      reportIds: seeded.reportIds,
      reason: 'Words about someone else.',
    })
    const audit = await prisma.auditLog.create({
      data: {
        user_id: decider.id,
        event_type: 'moderation_decision_applied',
        event_data: {
          decisionId: decision.id,
          caseId: seeded.caseId,
          action: 'resolve',
          role: 'moderator',
        },
      },
    })
    await erase(prisma, decider.id, NOW)
    const response = await exportAs(exporter, { scope: 'case', caseId: seeded.caseId })
    expect(response.text).not.toContain(decider.id)
    const bundle = parsed(response)
    expect(bundle.decisions[0]).toMatchObject({
      moderatorId: null,
      moderatorRole: 'moderator',
      reason: 'Words about someone else.',
      reasonRemoved: false,
    })
    expect(bundle.auditEvents[0]).toMatchObject({ actorId: null, role: 'moderator' })
    expect(
      (await prisma.auditLog.findUniqueOrThrow({ where: { id: audit.id } })).user_id
    ).toBe(decider.id)
  })
})
