// Learning path Step 53: Immutable moderation history.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-53-immutable-moderation-history
// Story 6.13 test owner: both routes through the real module, real guards and real HTTP, on real Postgres.
// A-ER-ADMIN, -ROLES, -UNKNOWN, -AUDIT, -REPLAY; A-X-CASE, -CANARY, -AUDIT-ONE, -AUDIT-FAIL, -DENIED-NO-AUDIT, -SELF,
// -RANGE-ROLE, -RANGE-CONFLICT, -RANGE-LIMITS, -BYTE-CAP, -LOAD, -ERASED, -REKEY, -MOD-ERASED, -HOSTILE, -SNAPSHOT,
// -UNKNOWN, -TZ, -APPEAL; A-FLAG-OFF
import 'reflect-metadata'
import { createHash, randomUUID } from 'node:crypto'
import { Test } from '@nestjs/testing'
import { UnauthorizedException } from '@nestjs/common'
import { PrismaClient } from '@prisma/client'
import request from 'supertest'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  moderationErasureResponseSchema,
  moderationEvidenceBundleSchema,
  type ModerationEvidenceBundle,
} from '@couture/api-client/contracts/http'
import { AccessTokenIdentityService } from '../src/modules/auth/access-token-identity.service.js'
import { GuardianConsentStateService } from '../src/modules/auth/guardian-consent-state.service.js'
import { SupabaseCommunityStorageAdapter } from '../src/modules/community/community-storage.adapter.js'
import {
  COMMUNITY_ERASURE_LATE_WRITE_WINDOW_MS,
  CommunityMaintenanceService,
} from '../src/modules/community/community-maintenance.service.js'
import { InMemoryCommunityStorage } from '../src/modules/community/community-storage.fake.js'
import { FeatureFlagsService } from '../src/modules/feature-flags/feature-flags.service.js'
import { MODERATION_QUEUE_CLOCK } from '../src/modules/moderation/moderation-decision-rules.js'
import { ModerationHistoryRepository } from '../src/modules/moderation/moderation-history.repository.js'
import { ModerationModule } from '../src/modules/moderation/moderation.module.js'
import { listenHttpApp } from '../src/testing/loopback-http-app.js'
import {
  decisionFixtures,
  moderationDecisionsTestContext,
} from './helpers/moderation-decisions-seed.js'
import {
  erase,
  ERASED_REASON,
  installTrigger,
  seedDecision,
  seedErasableMember,
} from './helpers/moderation-history-seed.js'

vi.setConfig({ testTimeout: 120_000 })

const NOW = new Date('2026-11-05T12:00:00.000Z')
const ERASURE = '/api/v1/moderation/erasure-requests'
const EXPORT = '/api/v1/moderation/evidence-exports'
const DAY = 86_400_000
const ctx = moderationDecisionsTestContext()
const { prisma, clock, flagValues, flags, failFlag } = ctx
const fx = decisionFixtures(prisma, clock.now)
let server: string
let closeApp: () => Promise<void>

const auth = (role: string, id: string) => `Bearer test-token:${role}:${id}`
const postAs = (path: string, role: string, id: string) =>
  request(server)
    .post(path)
    .set('Authorization', auth(role, id))
    .set('x-couture-platform', 'web')
const operator = (role: string) => fx.operator().then(({ id }) => ({ id, role }))
const exportAs = (who: { id: string; role: string }, body: object) =>
  postAs(EXPORT, who.role, who.id).send(body)
const codeOf = (response: { body: unknown }) => (response.body as { code?: string }).code
const parsed = (response: { body: unknown }): ModerationEvidenceBundle =>
  moderationEvidenceBundleSchema.parse(response.body)

const auditCount = (eventType: string, userId?: string) =>
  prisma.auditLog.count({
    where: { event_type: eventType, ...(userId ? { user_id: userId } : {}) },
  })

/** The digest as a compliance reviewer would recompute it from a kept file. */
function recomputeDigest(bundle: ModerationEvidenceBundle): string {
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical)
    if (value === null || typeof value !== 'object') return value
    const source = value as Record<string, unknown>
    return Object.fromEntries(
      Object.keys(source)
        .sort()
        .map((key) => [key, canonical(source[key])])
    )
  }
  return createHash('sha256')
    .update(
      JSON.stringify(
        canonical({
          decisions: bundle.decisions,
          reports: bundle.reports,
          auditEvents: bundle.auditEvents,
          alerts: bundle.alerts,
        })
      )
    )
    .digest('hex')
}

beforeAll(async () => {
  clock.at(NOW)
  const module = await Test.createTestingModule({ imports: [ModerationModule] })
    .overrideProvider(PrismaClient)
    .useValue(prisma)
    .overrideProvider(FeatureFlagsService)
    .useValue(flags)
    .overrideProvider(SupabaseCommunityStorageAdapter)
    .useValue({ signReadUrl: vi.fn() })
    .overrideProvider(MODERATION_QUEUE_CLOCK)
    .useValue(clock.now)
    .overrideProvider(AccessTokenIdentityService)
    .useValue({
      resolveIdentity: vi.fn((token: string) => {
        const match = /^test-token:([a-z]+):(.+)$/.exec(token)
        if (!match)
          return Promise.reject(new UnauthorizedException('Invalid access token'))
        return Promise.resolve({ userId: match[2]!, role: match[1]! })
      }),
    })
    .overrideProvider(GuardianConsentStateService)
    .useValue({ canTeenAccess: vi.fn().mockResolvedValue(true) })
    .compile()
  const app = module.createNestApplication()
  app.useLogger(false)
  server = await listenHttpApp(app)
  closeApp = () => app.close()
}, 120_000)

afterAll(async () => {
  await closeApp?.()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  clock.at(NOW)
  flagValues.clear()
})

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
    const anonymous = await request(server).post(ERASURE).send({ memberId: target.id })
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
    const viewed = await prisma.auditLog.create({
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
    expect(viewed.user_id).toBe(moderator.id)
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

describe('POST /evidence-exports: a period', () => {
  /** Each test owns a window of its own, far from the others. */
  let windowStart = new Date('2024-01-01T00:00:00.000Z').getTime()
  const newWindow = () => {
    const from = new Date(windowStart)
    windowStart += 100 * DAY
    return { from, to: new Date(from.getTime() + 90 * DAY) }
  }
  const range = (window: { from: Date; to: Date }) => ({
    scope: 'range',
    from: window.from.toISOString(),
    to: window.to.toISOString(),
  })
  const seedMany = (
    count: number,
    window: { from: Date },
    reason = 'A rationale written by the moderator.'
  ) => {
    const run = randomUUID()
    return prisma.moderationDecision.createMany({
      data: Array.from({ length: count }, (_, index) => ({
        case_key: `post.bulk-${run}-${index}`,
        sequence: 1,
        source: 'post',
        report_ids: [],
        action: 'resolve' as const,
        reason,
        moderator_role: 'moderator',
        mutation_id: randomUUID(),
        payload_hash: 'seeded',
        response: {},
        is_terminal: true,
        decided_at: new Date(window.from.getTime() + 1000),
      })),
    })
  }

  it('[A-X-RANGE-ROLE] refuses a moderator with admin_required, and no audit row', async () => {
    const moderator = await operator('moderator')
    const response = await exportAs(moderator, range(newWindow()))
    expect(response.status).toBe(403)
    expect(codeOf(response)).toBe('admin_required')
    expect(await auditCount('moderation_evidence_exported', moderator.id)).toBe(0)
  })

  it('[A-X-RANGE-CONFLICT] withholds every row of a case the admin wrote or reported', async () => {
    const admin = await operator('admin')
    const window = newWindow()
    const at = new Date(window.from.getTime() + 1000)

    const clean = await fx.postCase()
    const cleanRow = await seedDecision(prisma, {
      caseKey: clean.caseId,
      at,
      postId: clean.postId,
      reportIds: clean.reportIds,
    })

    const authored = await fx.post({ authorId: admin.id })
    const authoredReport = await fx.postReport(
      authored.id,
      (await fx.member('reporter')).id
    )
    await seedDecision(prisma, {
      caseKey: `post.${authored.id}`,
      at,
      postId: authored.id,
      reportIds: [authoredReport.id],
    })

    // The admin's report arrives after the first decision, so that row does not name it.
    const reported = await fx.postCase()
    await seedDecision(prisma, {
      caseKey: reported.caseId,
      sequence: 1,
      at,
      postId: reported.postId,
      reportIds: reported.reportIds,
    })
    const theirs = await fx.postReport(reported.postId, admin.id)
    await seedDecision(prisma, {
      caseKey: reported.caseId,
      sequence: 2,
      at,
      postId: reported.postId,
      reportIds: [...reported.reportIds, theirs.id],
    })

    const response = await exportAs(admin, range(window))
    expect(response.status).toBe(200)
    const bundle = parsed(response)
    expect(bundle.decisions.map((row) => row.decisionId)).toEqual([cleanRow.id])
    expect(bundle.counts.withheldForConflict).toBe(3)
    expect(bundle.reports.map((row) => row.reportId)).toEqual(clean.reportIds)
    expect(recomputeDigest(bundle)).toBe(bundle.sha256)
  })

  it('[A-X-RANGE-LIMITS] pins from and to at the instant, both ends included', async () => {
    const admin = await operator('admin')
    const window = newWindow()
    const edge = await seedDecision(prisma, {
      caseKey: 'post.edge-from',
      at: window.from,
    })
    const last = await seedDecision(prisma, { caseKey: 'post.edge-to', at: window.to })
    const before = await seedDecision(prisma, {
      caseKey: 'post.edge-before',
      at: new Date(window.from.getTime() - 1),
    })
    const after = await seedDecision(prisma, {
      caseKey: 'post.edge-after',
      at: new Date(window.to.getTime() + 1),
    })
    const bundle = parsed(await exportAs(admin, range(window)))
    const ids = bundle.decisions.map((row) => row.decisionId)
    expect(ids).toEqual(expect.arrayContaining([edge.id, last.id]))
    expect(ids).not.toContain(before.id)
    expect(ids).not.toContain(after.id)
    const offset = parsed(
      await exportAs(admin, {
        scope: 'range',
        from: '2024-01-01T00:00:00+02:00',
        to: new Date(Date.parse('2024-01-01T00:00:00+02:00') + DAY).toISOString(),
      })
    )
    expect(offset.scope).toMatchObject({ from: '2023-12-31T22:00:00.000Z' })
  })

  it('[A-X-RANGE-LIMITS] refuses more than 90 days with invalid_range', async () => {
    const admin = await operator('admin')
    const window = newWindow()
    const response = await exportAs(admin, {
      ...range(window),
      to: new Date(window.from.getTime() + 90 * DAY + 1).toISOString(),
    })
    expect(response.status).toBe(400)
    expect(codeOf(response)).toBe('invalid_range')
    expect(await auditCount('moderation_evidence_exported', admin.id)).toBe(0)
  })

  it('[A-X-RANGE-LIMITS, A-X-LOAD] takes 5,000 decisions inside the budget and refuses 5,001 on the count', async () => {
    const admin = await operator('admin')
    const window = newWindow()
    await seedMany(5000, window)
    const started = performance.now()
    const allowed = await exportAs(admin, range(window))
    const elapsed = performance.now() - started
    expect(allowed.status).toBe(200)
    expect(parsed(allowed).counts.decisions).toBe(5000)
    expect(Buffer.byteLength(allowed.text)).toBeLessThanOrEqual(4_000_000)
    expect(elapsed).toBeLessThan(15_000)
    await seedMany(1, window)
    const findMany = vi.spyOn(ModerationHistoryRepository.prototype, 'decisionsInRange')
    const refused = await exportAs(admin, range(window))
    expect(refused.status).toBe(413)
    expect(codeOf(refused)).toBe('export_too_large')
    expect(findMany).not.toHaveBeenCalled()
    expect(await auditCount('moderation_evidence_exported', admin.id)).toBe(1)
  })

  it('[A-X-BYTE-CAP] refuses a legal count over 4,000,000 bytes, with no audit row', async () => {
    const admin = await operator('admin')
    const window = newWindow()
    await seedMany(5000, window, 'x'.repeat(1000))
    const response = await exportAs(admin, range(window))
    expect(response.status).toBe(413)
    expect(codeOf(response)).toBe('export_too_large')
    expect(await auditCount('moderation_evidence_exported', admin.id)).toBe(0)
  })

  it('[A-X-BYTE-CAP] passes a bundle just under 4,000,000 bytes', async () => {
    const admin = await operator('admin')
    const probe = newWindow()
    await seedMany(100, probe, 'x'.repeat(1000))
    const sized = await exportAs(admin, range(probe))
    const perRow = Buffer.byteLength(sized.text) / 100
    const window = newWindow()
    await seedMany(Math.floor(3_950_000 / perRow), window, 'x'.repeat(1000))
    const response = await exportAs(admin, range(window))
    expect(response.status).toBe(200)
    const bytes = Buffer.byteLength(response.text)
    expect(bytes).toBeGreaterThan(3_800_000)
    expect(bytes).toBeLessThanOrEqual(4_000_000)
  })

  it('[A-X-SNAPSHOT] keeps counts, arrays and digest on one snapshot when a write lands mid-read', async () => {
    const admin = await operator('admin')
    const window = newWindow()
    const seeded = await fx.postCase()
    await seedDecision(prisma, {
      caseKey: seeded.caseId,
      at: new Date(window.from.getTime() + 1000),
      postId: seeded.postId,
      reportIds: seeded.reportIds,
    })
    // eslint-disable-next-line @typescript-eslint/unbound-method -- restored by being called with `this`.
    const original = ModerationHistoryRepository.prototype.reports
    let landed = false
    vi.spyOn(ModerationHistoryRepository.prototype, 'reports').mockImplementation(
      async function (this: ModerationHistoryRepository, tx, ids) {
        if (!landed) {
          landed = true
          // The real client, so this commits while the export's transaction is open.
          await prisma.moderationSlaAlert.create({
            data: {
              dedupe_key: `sla:post:${seeded.reportIds[0]}:at_risk`,
              kind: 'at_risk',
              case_key: seeded.caseId,
              source: 'post',
              anchor_report_id: seeded.reportIds[0]!,
              risk: 'medium',
              sla_due_at: NOW,
              detected_at: NOW,
              next_attempt_at: NOW,
            },
          })
        }
        return (await original.call(this, tx, ids)) as Awaited<
          ReturnType<typeof original>
        >
      }
    )
    const bundle = parsed(await exportAs(admin, range(window)))
    expect(landed).toBe(true)
    expect(bundle.alerts).toEqual([])
    expect(bundle.counts.alerts).toBe(0)
    const rows = await prisma.auditLog.findMany({
      where: { user_id: admin.id, event_type: 'moderation_evidence_exported' },
    })
    expect(rows.at(-1)!.event_data).toMatchObject({ sha256: bundle.sha256 })
  })

  it('[A-X-TZ] selects the same rows on a Chicago session as on UTC', async () => {
    const window = newWindow()
    await seedDecision(prisma, { caseKey: 'post.tz-in', at: window.from })
    await seedDecision(prisma, {
      caseKey: 'post.tz-out',
      at: new Date(window.from.getTime() - 3 * 60 * 60 * 1000),
    })
    const session = (zone: string) => {
      const url = new URL(ctx.database.url)
      url.searchParams.set('options', `-c TimeZone=${zone}`)
      return new PrismaClient({ datasourceUrl: url.toString() })
    }
    const utc = session('UTC')
    const chicago = session('America/Chicago')
    const repository = new ModerationHistoryRepository()
    try {
      const read = (client: PrismaClient) =>
        repository
          .decisionsInRange(client as never, window.from, window.to)
          .then((rows) => rows.map((row) => row.id))
      const onUtc = await read(utc)
      expect(onUtc).toHaveLength(1)
      expect(await read(chicago)).toEqual(onUtc)
    } finally {
      await utc.$disconnect()
      await chicago.$disconnect()
    }
  })
})

describe('A-AVAILABILITY: what the console asks before it offers a control', () => {
  const AVAILABILITY = `${EXPORT}/availability`
  const getAs = (role: string, id: string) =>
    request(server).get(AVAILABILITY).set('Authorization', auth(role, id))

  it('answers a moderator and an admin apart, in private', async () => {
    const moderator = await operator('moderator')
    const admin = await operator('admin')
    const asModerator = await getAs('moderator', moderator.id)
    expect(asModerator.status).toBe(200)
    expect(asModerator.headers['cache-control']).toBe('private, no-store')
    expect(asModerator.body).toEqual({ data: { rangeExport: false } })
    expect((await getAs('admin', admin.id)).body).toEqual({ data: { rangeExport: true } })
  })

  it('closes with the flag off, and hides that from anyone else', async () => {
    const admin = await operator('admin')
    flagValues.set('moderation_history_enabled', false)
    const closed = await getAs('admin', admin.id)
    expect(closed.status).toBe(503)
    expect(codeOf(closed)).toBe('moderation_history_disabled')
    const guardian = await getAs('guardian', admin.id)
    expect(guardian.status).toBe(403)
    expect(codeOf(guardian)).toBeUndefined()
    expect((await request(server).get(AVAILABILITY)).status).toBe(401)
  })
})

describe('A-X-DENIED-NO-AUDIT and A-FLAG-OFF', () => {
  it('leaves the audit count unchanged on every refusal', async () => {
    const moderator = await operator('moderator')
    const admin = await operator('admin')
    const seeded = await fx.postCase()
    const before = await auditCount('moderation_evidence_exported')
    expect(
      (await request(server).post(EXPORT).send({ scope: 'case', caseId: seeded.caseId }))
        .status
    ).toBe(401)
    expect(
      (
        await postAs(EXPORT, 'guardian', moderator.id).send({
          scope: 'case',
          caseId: seeded.caseId,
        })
      ).status
    ).toBe(403)
    expect((await exportAs(moderator, { scope: 'case' })).status).toBe(400)
    expect(
      (await exportAs(moderator, { scope: 'case', caseId: 'post.no-such' })).status
    ).toBe(404)
    expect(
      (
        await exportAs(moderator, {
          scope: 'range',
          from: '2024-01-01T00:00:00Z',
          to: '2024-01-02T00:00:00Z',
        })
      ).status
    ).toBe(403)
    expect(
      (
        await exportAs(admin, {
          scope: 'range',
          from: '2024-01-02T00:00:00Z',
          to: '2024-01-01T00:00:00Z',
        })
      ).status
    ).toBe(400)
    flagValues.set('moderation_history_enabled', false)
    expect(
      (await exportAs(moderator, { scope: 'case', caseId: seeded.caseId })).status
    ).toBe(503)
    expect(await auditCount('moderation_evidence_exported')).toBe(before)
  })

  it.each([
    [
      'moderation_history_enabled off',
      () => flagValues.set('moderation_history_enabled', false),
    ],
    [
      'moderation_console_enabled off',
      () => flagValues.set('moderation_console_enabled', false),
    ],
    ['a failed flag read', () => failFlag('moderation_history_enabled')],
  ])(
    'closes both routes on %s, before input, and keeps enforcement live',
    async (_name, close) => {
      const admin = await operator('admin')
      const target = await fx.member('target')
      const decision = await seedDecision(prisma, {
        caseKey: `post.flag-${randomUUID()}`,
        at: NOW,
      })
      close()
      for (const response of [
        await postAs(ERASURE, 'admin', admin.id).send({ memberId: target.id }),
        await postAs(ERASURE, 'admin', admin.id).send({ bad: true }),
        await exportAs(admin, { scope: 'case', caseId: 'post.anything' }),
        await exportAs(admin, { bad: true }),
      ]) {
        expect(response.status).toBe(503)
        expect(codeOf(response)).toBe('moderation_history_disabled')
      }
      // A non-moderator never learns the flag state.
      const guardian = await postAs(EXPORT, 'guardian', admin.id).send({ bad: true })
      expect(guardian.status).toBe(403)
      expect(codeOf(guardian)).toBeUndefined()
      await expect(
        prisma.moderationDecision.update({
          where: { id: decision.id },
          data: { reason: 'rewritten' },
        })
      ).rejects.toThrow()
    }
  )
})
