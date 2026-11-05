// Learning path Step 52: Moderation SLA monitoring and escalation.
// Story 6.12 test owner: the 6.11 escalate decision now writes an alert in its transaction.
// I-E-ATOMIC, -ROLLBACK, -REPLAY, -REPLAY-RACE, -REESCALATE, -PARITY, -FLAG-OFF, -NEXT-SWEEP,
// -ORPHAN, -DECISION-UNCHANGED, I-W-RESOLVED-DECISION. Real routes, real guards, real transaction.
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  moderationCasesQuerySchema,
  moderationDecisionResponseSchema,
} from '@couture/api-client/contracts/http'
import { ModerationQueueRepository } from '../src/modules/moderation/moderation-queue.repository.js'
import { createModerationOpsChannel } from '../src/modules/moderation/moderation-sla.channel.js'
import { ModerationSlaSweep } from '../src/modules/moderation/moderation-sla.sweep.js'
import {
  decisionFixtures,
  moderationDecisionsTestContext,
  type DecisionBoot,
} from './helpers/moderation-decisions-seed.js'
import {
  createLogSpy,
  createMeterSpy,
  startCaptureServer,
  type CaptureServer,
} from './helpers/moderation-sla-harness.js'

vi.setConfig({ testTimeout: 60_000 })

const NOW = new Date('2026-11-05T12:00:00.000Z')
const REASON = 'Needs a second reader.'
const ctx = moderationDecisionsTestContext()
const { prisma, clock, flagValues } = ctx
const fx = decisionFixtures(prisma, clock.now)
let boot: DecisionBoot
let receiver: CaptureServer
const logs = createLogSpy()

const sweep = () =>
  new ModerationSlaSweep({
    prisma,
    clock: clock.now,
    channel: createModerationOpsChannel({ url: receiver.url }),
    flags: {
      getFeatureFlag: (key: string) => Promise.resolve(flagValues.get(key) ?? true),
    } as never,
    analytics: { capture: vi.fn() },
    logger: logs.logger as never,
    meter: createMeterSpy(),
    appUrl: 'https://app.test',
  })

const staff = async () => boot.staff('moderator', await fx.operator())
const alertsFor = (caseId: string) =>
  prisma.moderationSlaAlert.findMany({
    where: { case_key: caseId, kind: 'escalated' },
    orderBy: { detected_at: 'asc' },
  })
const decisionsFor = (caseId: string) =>
  prisma.moderationDecision.findMany({
    where: { case_key: caseId },
    orderBy: { sequence: 'asc' },
  })

beforeAll(async () => {
  clock.at(NOW)
  receiver = await startCaptureServer()
  boot = await ctx.bootApp()
}, 120_000)

beforeEach(() => {
  flagValues.clear()
  receiver.reset()
})

afterAll(async () => {
  await receiver.close()
})

describe('I-E-ATOMIC: decision and alert commit together', () => {
  it('writes one decision, one audit row and one pending alert keyed on the decision', async () => {
    const seeded = await fx.postCase({ reports: 2 })
    const moderator = await staff()
    const response = await moderator.decide(seeded.caseId, {
      action: 'escalate',
      reason: REASON,
    })
    expect(response.status).toBe(200)
    const { decisionId } = moderationDecisionResponseSchema.parse(response.body).data
    const [decision] = await decisionsFor(seeded.caseId)
    expect(decision!.id).toBe(decisionId)
    const alerts = await alertsFor(seeded.caseId)
    expect(alerts).toHaveLength(1)
    expect(alerts[0]).toMatchObject({
      dedupe_key: `escalated:${decisionId}`,
      decision_id: decisionId,
      kind: 'escalated',
      source: 'post',
      delivery: 'pending',
      attempts: 0,
    })
    expect(alerts[0]!.detected_at.getTime()).toBe(NOW.getTime())
    expect(
      await prisma.auditLog.count({
        where: { user_id: moderator.id, event_type: 'moderation_decision_applied' },
      })
    ).toBe(1)
  })

  it('writes no alert for a terminal decision', async () => {
    const seeded = await fx.postCase({ reports: 1 })
    const moderator = await staff()
    const response = await moderator.decide(seeded.caseId, {
      action: 'resolve',
      reason: REASON,
    })
    expect(response.status).toBe(200)
    expect(await alertsFor(seeded.caseId)).toEqual([])
  })
})

describe('I-E-ROLLBACK: an alert the database refuses', () => {
  it('answers 503 audit_unavailable with nothing written, and the same key then succeeds', async () => {
    const seeded = await fx.postCase({ reports: 1 })
    const moderator = await staff()
    const mutationId = randomUUID()
    const revision = (await moderator.detail(seeded.caseId)).revision
    const before = await prisma.auditLog.count({ where: { user_id: moderator.id } })
    await prisma.$executeRawUnsafe(`
      CREATE FUNCTION tea_refuse_sla_alert() RETURNS trigger LANGUAGE plpgsql AS $fn$
      BEGIN RAISE EXCEPTION 'tea refuses this alert'; END $fn$`)
    await prisma.$executeRawUnsafe(
      'CREATE TRIGGER tea_refuse_sla_alert BEFORE INSERT ON "ModerationSlaAlert" FOR EACH ROW EXECUTE FUNCTION tea_refuse_sla_alert()'
    )
    try {
      const refused = await moderator.decide(seeded.caseId, {
        action: 'escalate',
        reason: REASON,
        mutationId,
        expectedRevision: revision,
      })
      expect(refused.status).toBe(503)
      expect((refused.body as { code: string }).code).toBe('audit_unavailable')
      expect(await decisionsFor(seeded.caseId)).toEqual([])
      expect(await prisma.auditLog.count({ where: { user_id: moderator.id } })).toBe(
        before
      )
      expect(
        await prisma.moderationEvent.count({
          where: { post_id: seeded.postId, action: 'escalated_by_operator' },
        })
      ).toBe(0)
    } finally {
      await prisma.$executeRawUnsafe(
        'DROP TRIGGER tea_refuse_sla_alert ON "ModerationSlaAlert"'
      )
      await prisma.$executeRawUnsafe('DROP FUNCTION tea_refuse_sla_alert()')
    }
    const accepted = await moderator.decide(seeded.caseId, {
      action: 'escalate',
      reason: REASON,
      mutationId,
      expectedRevision: revision,
    })
    expect(accepted.status).toBe(200)
    expect(await alertsFor(seeded.caseId)).toHaveLength(1)
  })
})

describe('I-E-REPLAY and I-E-REPLAY-RACE', () => {
  it('a sequential replay returns the stored response and adds no alert', async () => {
    const seeded = await fx.postCase({ reports: 1 })
    const moderator = await staff()
    const mutationId = randomUUID()
    const expectedRevision = (await moderator.detail(seeded.caseId)).revision
    const first = await moderator.decide(seeded.caseId, {
      action: 'escalate',
      reason: REASON,
      mutationId,
      expectedRevision,
    })
    const second = await moderator.decide(seeded.caseId, {
      action: 'escalate',
      reason: REASON,
      mutationId,
      expectedRevision,
    })
    expect(second.status).toBe(200)
    const firstData = moderationDecisionResponseSchema.parse(first.body).data
    const secondData = moderationDecisionResponseSchema.parse(second.body).data
    expect(secondData.replayed).toBe(true)
    expect(secondData.decisionId).toBe(firstData.decisionId)
    expect(await alertsFor(seeded.caseId)).toHaveLength(1)
  })

  it('concurrent identical requests make one decision and one alert', async () => {
    const seeded = await fx.postCase({ reports: 1 })
    const moderator = await staff()
    const mutationId = randomUUID()
    const expectedRevision = (await moderator.detail(seeded.caseId)).revision
    const responses = await Promise.all(
      [1, 2, 3].map(() =>
        moderator.decide(seeded.caseId, {
          action: 'escalate',
          reason: REASON,
          mutationId,
          expectedRevision,
        })
      )
    )
    expect(responses.every((response) => response.status === 200)).toBe(true)
    expect(await decisionsFor(seeded.caseId)).toHaveLength(1)
    expect(await alertsFor(seeded.caseId)).toHaveLength(1)
  })
})

describe('I-E-REESCALATE', () => {
  it('escalate, terminal, new report, escalate: two alerts under two keys', async () => {
    const seeded = await fx.postCase({ reports: 1 })
    const moderator = boot.staff('admin', await fx.operator())
    await moderator.decide(seeded.caseId, { action: 'escalate', reason: REASON })
    await moderator.decide(seeded.caseId, { action: 'resolve', reason: REASON })
    const reporter = await fx.member('late')
    await fx.postReport(seeded.postId, reporter.id)
    const again = await moderator.decide(seeded.caseId, {
      action: 'escalate',
      reason: REASON,
    })
    expect(again.status).toBe(200)
    const alerts = await alertsFor(seeded.caseId)
    expect(alerts).toHaveLength(2)
    expect(new Set(alerts.map((alert) => alert.dedupe_key)).size).toBe(2)
    expect(new Set(alerts.map((alert) => alert.anchor_report_id)).size).toBe(2)
  })

  it('a second escalate on an escalated case is refused and writes nothing', async () => {
    const seeded = await fx.postCase({ reports: 1 })
    const moderator = await staff()
    await moderator.decide(seeded.caseId, { action: 'escalate', reason: REASON })
    const refused = await moderator.decide(seeded.caseId, {
      action: 'escalate',
      reason: REASON,
    })
    expect((refused.body as { detail?: string }).detail).toBe('already_escalated')
    expect(await alertsFor(seeded.caseId)).toHaveLength(1)
  })
})

describe('I-E-PARITY: the alert matches the queue row (TEA-08)', () => {
  const repository = () => new ModerationQueueRepository(prisma)
  const queueRow = async (caseId: string) => {
    const rows = await repository().listCases(
      moderationCasesQuerySchema.parse({ status: 'open', limit: 50 }),
      clock.now(),
      null
    )
    const row = rows.find((item) => item.caseKey === caseId)
    if (!row) throw new Error(`${caseId} not on the first page`)
    return row
  }

  async function expectParity(caseId: string) {
    const moderator = await staff()
    const row = await queueRow(caseId)
    const response = await moderator.decide(caseId, {
      action: 'escalate',
      reason: REASON,
    })
    expect(response.status).toBe(200)
    const [alert] = await alertsFor(caseId)
    expect(alert).toMatchObject({
      anchor_report_id: row.anchorReportId,
      source: row.source,
      risk: ['low', 'medium', 'high'][row.riskRank],
    })
    expect(alert!.sla_due_at.getTime()).toBe(row.dueAt.getTime())
  }

  it('post case with one report', async () => {
    await expectParity((await fx.postCase({ reports: 1 })).caseId)
  })

  it('post case with a finding raising the risk', async () => {
    await expectParity((await fx.postCase({ status: 'flagged', reports: 1 })).caseId)
  })

  it('post case with three distinct reporters raising the risk', async () => {
    await expectParity((await fx.postCase({ reports: 3 })).caseId)
  })

  it('comment case', async () => {
    await expectParity((await fx.commentCase({ reports: 2 })).caseId)
  })
})

describe('I-E-FLAG-OFF: the row is written with monitoring off', () => {
  it('sends nothing until the flag opens, then a live case sends and a closed one supersedes', async () => {
    const live = await fx.postCase({ reports: 1 })
    const closed = await fx.postCase({ reports: 1 })
    const moderator = boot.staff('admin', await fx.operator())
    flagValues.set('moderation_sla_monitoring_enabled', false)
    for (const seeded of [live, closed]) {
      const response = await moderator.decide(seeded.caseId, {
        action: 'escalate',
        reason: REASON,
      })
      expect(response.status).toBe(200)
    }
    receiver.reset()
    await sweep().run()
    expect(receiver.received).toEqual([])
    expect(await alertsFor(live.caseId)).toMatchObject([{ delivery: 'pending' }])

    await moderator.decide(closed.caseId, { action: 'resolve', reason: REASON })
    flagValues.delete('moderation_sla_monitoring_enabled')
    await sweep().run()
    const [liveAlert] = await alertsFor(live.caseId)
    const [closedAlert] = await alertsFor(closed.caseId)
    expect(liveAlert!.delivery).toBe('delivered')
    expect(closedAlert!.delivery).toBe('superseded')
    expect(receiver.idsReceived()).toContain(liveAlert!.id)
    expect(receiver.idsReceived()).not.toContain(closedAlert!.id)
  })
})

describe('I-E-NEXT-SWEEP: the real escalate reaches the receiver', () => {
  it('delivers at the next sweep with a valid case path', async () => {
    const seeded = await fx.postCase({ reports: 1 })
    const moderator = await staff()
    await moderator.decide(seeded.caseId, { action: 'escalate', reason: REASON })
    receiver.reset()
    await sweep().run()
    const [alert] = await alertsFor(seeded.caseId)
    const request = receiver.received.find((item) => item.body.id === alert!.id)
    expect(request?.body).toMatchObject({
      kind: 'escalated',
      casePath: `/moderation/cases/${seeded.caseId}`,
    })
  })

  it('a case both escalated and breached gets two alerts', async () => {
    const seeded = await fx.postCase({ reports: 1 })
    const moderator = await staff()
    await moderator.decide(seeded.caseId, { action: 'escalate', reason: REASON })
    await prisma.communityPostReport.updateMany({
      where: { post_id: seeded.postId },
      data: { sla_due_at: new Date(NOW.getTime() - 1) },
    })
    receiver.reset()
    await sweep().run()
    const kinds = receiver.received
      .filter((item) => String(item.body.casePath).endsWith(seeded.caseId))
      .map((item) => item.body.kind)
      .sort()
    expect(kinds).toEqual(['breached', 'escalated'])
  })
})

describe('I-W-RESOLVED-DECISION: a real terminal decision between sweeps', () => {
  it('supersedes a pending escalated alert with zero POSTs for it', async () => {
    const seeded = await fx.postCase({ reports: 1 })
    const moderator = boot.staff('admin', await fx.operator())
    await moderator.decide(seeded.caseId, { action: 'escalate', reason: REASON })
    await moderator.decide(seeded.caseId, { action: 'resolve', reason: REASON })
    receiver.reset()
    await sweep().run()
    const [alert] = await alertsFor(seeded.caseId)
    expect(alert!.delivery).toBe('superseded')
    expect(receiver.idsReceived()).not.toContain(alert!.id)
  })
})

describe('I-E-ORPHAN', () => {
  it('anchors an orphan case on its one report', async () => {
    const { caseId, reportId } = await fx.orphanPostCase()
    const moderator = await staff()
    const response = await moderator.decide(caseId, {
      action: 'escalate',
      reason: REASON,
    })
    expect(response.status).toBe(200)
    expect(await alertsFor(caseId)).toMatchObject([{ anchor_report_id: reportId }])
  })
})

describe('I-E-DECISION-UNCHANGED: the 6.11 response stays the same', () => {
  it('holds the same strict body as a terminal decision does', async () => {
    const seeded = await fx.postCase({ reports: 1 })
    const moderator = await staff()
    const response = await moderator.decide(seeded.caseId, {
      action: 'escalate',
      reason: REASON,
    })
    const body = moderationDecisionResponseSchema.parse(response.body)
    expect(JSON.stringify(body)).not.toMatch(/alert|sla_|dedupe/i)
  })
})
