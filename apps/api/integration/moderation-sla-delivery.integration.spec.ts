// Learning path Step 52: Moderation SLA monitoring and escalation.
// Story 6.12 test owner: delivery to a real HTTP receiver through the real adapter, failure and its
// escalation, the console-only channel, and privacy. Every send assertion reads what the socket got.
// I-W-REAL-THREE-KINDS, -THIRD-FAILURE, -RECOVERS, -CODES-REAL, -CRASH-LOOP, -RECORD-FAILS,
// -BACKOFF-HONORED, -NO-CHANNEL, -BAD-CONFIG, -BACKLOG, -RESOLVED, I-P-CANARY, -WEBHOOK-SECRET,
// -ANALYTICS, U-S-ISOLATION, U-S-RESULT-SAFE, U-S-SNAPSHOT, U-S-RECORDED, U-S-FLAG-ORDER.
import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import { describe, expect, it, vi } from 'vitest'
import { moderationSlaWebhookPayloadSchema } from '@couture/api-client/contracts/http'
import { CommunityModerationActionsService } from '../src/modules/community/community-moderation.actions.js'
import { createModerationOpsChannel } from '../src/modules/moderation/moderation-sla.channel.js'
import { ModerationSlaRepository } from '../src/modules/moderation/moderation-sla.repository.js'
import { ModerationSlaService } from '../src/modules/moderation/moderation-sla.service.js'
import { seedMember } from './helpers/moderation-queue-seed.js'
import {
  SLA_HOUR_MS,
  SLA_MINUTE_MS,
  aroundRawQueries,
  moderationSlaTestContext,
  refuseWrites,
  startCaptureServer,
} from './helpers/moderation-sla-harness.js'

vi.setConfig({ testTimeout: 60_000 })

const NOW = new Date('2026-11-05T12:00:00.000Z')
const ctx = moderationSlaTestContext({ now: NOW })
const {
  prisma,
  clock,
  alerts,
  alertByKey,
  slaKey,
  seedCase,
  sweep,
  capture,
  logs,
  meter,
  analytics,
} = ctx
const inMs = (ms: number) => new Date(NOW.getTime() + ms)
const eventsNamed = (name: string) =>
  analytics.capture.mock.calls
    .map(([event]) => event as { event: string })
    .filter((event) => event.event === name)

async function insertEscalated(seeded: {
  caseId: string
  source: string
  anchorReportId: string
  reports: { dueAt: Date }[]
}) {
  const decisionId = randomUUID()
  return prisma.moderationSlaAlert.create({
    data: {
      dedupe_key: `escalated:${decisionId}`,
      kind: 'escalated',
      case_key: seeded.caseId,
      source: seeded.source,
      anchor_report_id: seeded.anchorReportId,
      risk: 'low',
      sla_due_at: seeded.reports[0]!.dueAt,
      decision_id: decisionId,
      detected_at: NOW,
      next_attempt_at: NOW,
    },
  })
}

describe('I-W-REAL-THREE-KINDS: each kind arrives as a real request', () => {
  it('sends at_risk, breached and escalated with the documented body and header', async () => {
    const risky = await seedCase({ dueAt: inMs(SLA_HOUR_MS), reason: 'harassment' })
    const late = await seedCase({ dueAt: inMs(-SLA_HOUR_MS), source: 'comment' })
    const escalatedCase = await seedCase({ dueAt: inMs(20 * SLA_HOUR_MS) })
    const escalated = await insertEscalated(escalatedCase)
    await sweep().run()

    const received = capture().received
    expect(received).toHaveLength(3)
    for (const request of received) {
      expect(request.method).toBe('POST')
      expect(request.url).toBe('/ops')
      expect(request.headers['content-type']).toContain('application/json')
      expect(request.headers['idempotency-key']).toBe(request.body.id)
      expect(moderationSlaWebhookPayloadSchema.parse(request.body)).toEqual(request.body)
    }
    const byKind: Record<string, unknown> = Object.fromEntries(
      received.map((request) => [String(request.body.kind), request.body])
    )
    const atRiskRow = (await alertByKey(slaKey(risky, 'at_risk')))!
    expect(byKind.at_risk).toEqual({
      id: atRiskRow.id,
      kind: 'at_risk',
      source: 'post',
      risk: 'medium',
      slaDueAt: risky.reports[0]!.dueAt.toISOString(),
      detectedAt: NOW.toISOString(),
      casePath: `/moderation/cases/${risky.caseId}`,
      caseUrl: `https://app.test/moderation/cases/${risky.caseId}`,
      text: `Moderation SLA at risk: medium risk post case. https://app.test/moderation/cases/${risky.caseId}`,
    })
    expect(byKind.breached).toMatchObject({
      source: 'comment',
      casePath: `/moderation/cases/${late.caseId}`,
    })
    expect(byKind.escalated).toMatchObject({
      id: escalated.id,
      casePath: `/moderation/cases/${escalatedCase.caseId}`,
    })
    for (const row of await alerts()) {
      expect(row).toMatchObject({
        delivery: 'delivered',
        attempts: 1,
        last_error_code: null,
      })
      expect(row.delivered_at?.getTime()).toBe(clock.now().getTime())
      expect(row.lease_until).toBeNull()
    }
  })
})

describe('I-W-THIRD-FAILURE: a failing channel escalates once', () => {
  it('logs and counts each attempt, and the third writes one JobFailure, one error log and one event', async () => {
    const seeded = await seedCase({ dueAt: inMs(SLA_HOUR_MS) })
    const key = slaKey(seeded, 'at_risk')
    capture().respondWith(500)

    await sweep().run()
    let row = (await alertByKey(key))!
    expect(row).toMatchObject({
      attempts: 1,
      last_error_code: 'http_5xx',
      delivery: 'pending',
    })
    expect(row.next_attempt_at.getTime()).toBe(clock.now().getTime() + SLA_MINUTE_MS)
    expect(await prisma.jobFailure.count()).toBe(0)

    clock.advance(SLA_MINUTE_MS)
    await sweep().run()
    row = (await alertByKey(key))!
    expect(row.attempts).toBe(2)
    expect(row.next_attempt_at.getTime()).toBe(clock.now().getTime() + 2 * SLA_MINUTE_MS)
    expect(await prisma.jobFailure.count()).toBe(0)
    expect(logs.named('moderation_sla_delivery_failed')).toHaveLength(0)

    clock.advance(2 * SLA_MINUTE_MS)
    await sweep().run()
    row = (await alertByKey(key))!
    expect(row.attempts).toBe(3)
    expect(row.failure_escalated_at?.getTime()).toBe(clock.now().getTime())
    const failures = await prisma.jobFailure.findMany()
    expect(failures).toHaveLength(1)
    expect(failures[0]).toMatchObject({
      queue_name: 'maintenance',
      job_id: `moderation_sla_delivery__${row.id}`,
      job_data: { alertId: row.id, kind: 'at_risk', code: 'http_5xx' },
      attempts: 3,
    })
    expect(logs.named('moderation_sla_delivery_failed', 'error')).toHaveLength(1)
    expect(eventsNamed('moderation_sla_delivery_failed')).toHaveLength(1)

    for (const wait of [4, 8]) {
      clock.advance(wait * SLA_MINUTE_MS)
      await sweep().run()
    }
    expect((await alertByKey(key))!.attempts).toBe(5)
    expect(await prisma.jobFailure.count()).toBe(1)
    expect(logs.named('moderation_sla_delivery_failed', 'error')).toHaveLength(1)
    expect(eventsNamed('moderation_sla_delivery_failed')).toHaveLength(1)
    expect(logs.named('moderation_sla_delivery_attempt_failed', 'warn')).toHaveLength(5)
    expect(meter.countDeliveryFailure.mock.calls).toEqual(Array(5).fill(['http_5xx']))
  })

  it('lets the lease keep a second sweep out at the third attempt', async () => {
    const seeded = await seedCase({ dueAt: inMs(SLA_HOUR_MS) })
    capture().respondWith(500)
    await sweep().run()
    clock.advance(SLA_MINUTE_MS)
    await sweep().run()
    clock.advance(2 * SLA_MINUTE_MS)
    await Promise.all([sweep().run(), sweep({ prisma: ctx.newClient() }).run()])
    expect(await prisma.jobFailure.count()).toBe(1)
    expect((await alertByKey(slaKey(seeded, 'at_risk')))!.attempts).toBe(3)
  })

  it('writes one row when two workers reach the failure write together', async () => {
    const seeded = await seedCase({ dueAt: inMs(SLA_HOUR_MS) })
    const channel = createModerationOpsChannel({ url: capture().url })
    capture().respondWith(500)
    await sweep({ channel }).run()
    const row = (await alertByKey(slaKey(seeded, 'at_risk')))!
    const claimed = {
      id: row.id,
      kind: 'at_risk' as const,
      caseId: seeded.caseId,
      source: 'post' as const,
      anchorReportId: seeded.anchorReportId,
      risk: row.risk as 'low',
      slaDueAt: row.sla_due_at,
      detectedAt: row.detected_at,
      attempts: 3,
      failureEscalatedAt: null,
    }
    const outcomes = await Promise.all([
      new ModerationSlaRepository(prisma).escalateFailure(claimed, 'http_5xx', NOW),
      new ModerationSlaRepository(ctx.newClient()).escalateFailure(
        claimed,
        'http_5xx',
        NOW
      ),
    ])
    expect(outcomes.filter(Boolean)).toHaveLength(1)
    expect(await prisma.jobFailure.count()).toBe(1)
  })
})

describe('I-W-RECOVERS: the channel comes back', () => {
  it('delivers with no operator step and leaves the JobFailure row', async () => {
    const seeded = await seedCase({ dueAt: inMs(SLA_HOUR_MS) })
    const key = slaKey(seeded, 'at_risk')
    capture().respondWith(503)
    await sweep().run()
    clock.advance(SLA_MINUTE_MS)
    await sweep().run()
    clock.advance(2 * SLA_MINUTE_MS)
    await sweep().run()
    expect(await prisma.jobFailure.count()).toBe(1)

    capture().reset()
    clock.advance(4 * SLA_MINUTE_MS)
    await sweep().run()
    const row = (await alertByKey(key))!
    expect(row).toMatchObject({
      delivery: 'delivered',
      attempts: 4,
      last_error_code: null,
    })
    expect(capture().received).toHaveLength(1)
    expect(await prisma.jobFailure.count()).toBe(1)
  })
})

describe('I-W-CODES-REAL: closed codes from real responses', () => {
  it.each([
    [500, 'http_5xx'],
    [404, 'http_4xx'],
  ])('status %d records %s', async (status, code) => {
    const seeded = await seedCase({ dueAt: inMs(SLA_HOUR_MS) })
    capture().respondWith(status)
    await sweep().run()
    expect((await alertByKey(slaKey(seeded, 'at_risk')))!.last_error_code).toBe(code)
  })

  it('302 records http_3xx and the redirect target is hit zero times', async () => {
    const target = await startCaptureServer()
    try {
      const seeded = await seedCase({ dueAt: inMs(SLA_HOUR_MS) })
      capture().respondWith(302, { location: target.url })
      await sweep().run()
      expect((await alertByKey(slaKey(seeded, 'at_risk')))!.last_error_code).toBe(
        'http_3xx'
      )
      expect(target.received).toEqual([])
    } finally {
      await target.close()
    }
  })

  it('a hanging socket records timeout', async () => {
    const seeded = await seedCase({ dueAt: inMs(SLA_HOUR_MS) })
    capture().hang()
    await sweep({
      channel: createModerationOpsChannel({ url: capture().url, timeoutMs: 50 }),
    }).run()
    expect((await alertByKey(slaKey(seeded, 'at_risk')))!.last_error_code).toBe('timeout')
  })

  it('a dropped connection records network', async () => {
    capture().script((_request, response) => {
      response.socket?.destroy()
    })
    const seeded = await seedCase({ dueAt: inMs(SLA_HOUR_MS) })
    await sweep().run()
    expect((await alertByKey(slaKey(seeded, 'at_risk')))!.last_error_code).toBe('network')
  })
})

describe('I-W-CRASH-LOOP: claims that never finish (TEA-04)', () => {
  /** The state a dead worker leaves: claimed, counted, lease expired, no outcome written. */
  async function deadClaim(key: string, attempts: number) {
    await prisma.moderationSlaAlert.update({
      where: { dedupe_key: key },
      data: {
        attempts,
        lease_until: inMs(-1),
        next_attempt_at: inMs(-1),
      },
    })
  }

  it('records interrupted and escalates once attempts reaches 3', async () => {
    const seeded = await seedCase({ dueAt: inMs(SLA_HOUR_MS) })
    const key = slaKey(seeded, 'at_risk')
    capture().respondWith(500)
    await sweep().run()
    const row = (await alertByKey(key))!
    await deadClaim(key, 2)
    capture().respondWith(200)
    await sweep().run()

    const failures = await prisma.jobFailure.findMany()
    expect(failures).toHaveLength(1)
    expect(failures[0]).toMatchObject({
      queue_name: 'maintenance',
      job_id: `moderation_sla_delivery__${row.id}`,
      job_data: { alertId: row.id, kind: 'at_risk', code: 'interrupted' },
      attempts: 3,
    })
    expect(meter.countDeliveryFailure).toHaveBeenCalledWith('interrupted')
    expect((await alertByKey(key))!.delivery).toBe('delivered')
  })

  it('counts an interruption below 3 and writes no JobFailure', async () => {
    const seeded = await seedCase({ dueAt: inMs(SLA_HOUR_MS) })
    const key = slaKey(seeded, 'at_risk')
    capture().respondWith(500)
    await sweep().run()
    await deadClaim(key, 1)
    await sweep().run()
    expect((await alertByKey(key))!.attempts).toBe(2)
    expect(await prisma.jobFailure.count()).toBe(0)
  })

  it('does not escalate an ordinary third claim before it fails', async () => {
    const seeded = await seedCase({ dueAt: inMs(SLA_HOUR_MS) })
    const key = slaKey(seeded, 'at_risk')
    capture().respondWith(500)
    await sweep().run()
    clock.advance(SLA_MINUTE_MS)
    await sweep().run()
    capture().reset()
    clock.advance(2 * SLA_MINUTE_MS)
    await sweep().run()
    expect((await alertByKey(key))!).toMatchObject({ delivery: 'delivered', attempts: 3 })
    expect(await prisma.jobFailure.count()).toBe(0)
  })
})

describe('I-W-CRASH-LOOP signals (D9, TEA-04)', () => {
  it('logs and counts every interruption', async () => {
    const seeded = await seedCase({ dueAt: inMs(SLA_HOUR_MS) })
    const key = slaKey(seeded, 'at_risk')
    capture().respondWith(500)
    await sweep().run()
    logs.clear()
    meter.countDeliveryFailure.mockClear()
    await prisma.moderationSlaAlert.update({
      where: { dedupe_key: key },
      data: { attempts: 1, lease_until: inMs(-1), next_attempt_at: inMs(-1) },
    })
    capture().reset()
    await sweep().run()
    expect(meter.countDeliveryFailure.mock.calls).toEqual([['interrupted']])
    expect(logs.named('moderation_sla_delivery_attempt_failed', 'warn')).toHaveLength(1)
    expect(
      JSON.stringify(logs.named('moderation_sla_delivery_attempt_failed'))
    ).toContain('interrupted')
  })
})

describe('I-W-REKEY-PAYLOAD: a pending alert whose case was re-keyed (matrix, Erasure re-key)', () => {
  it('links the live orphan case and leaves the dead case id out', async () => {
    const seeded = await seedCase({ dueAt: inMs(SLA_HOUR_MS), reporters: 2 })
    capture().respondWith(500)
    await sweep().run()
    capture().reset()
    await prisma.lookbookPost.delete({ where: { id: seeded.targetId } })
    clock.advance(SLA_MINUTE_MS)
    await sweep().run()
    const row = (await alertByKey(slaKey(seeded, 'at_risk')))!
    const request = capture().received.find((item) => item.body.id === row.id)
    expect(request?.body.casePath).toBe(
      `/moderation/cases/orphan-post.${seeded.anchorReportId}`
    )
    expect(request?.raw).not.toContain(`post.${seeded.targetId}`)
  })
})

describe('I-W-RECORD-FAILS: the escalation write itself fails', () => {
  it('leaves the stamp null, logs, and writes the row at the next attempt', async () => {
    const seeded = await seedCase({ dueAt: inMs(SLA_HOUR_MS) })
    const key = slaKey(seeded, 'at_risk')
    capture().respondWith(500)
    await sweep().run()
    clock.advance(SLA_MINUTE_MS)
    await sweep().run()
    await prisma.$executeRawUnsafe(`
      CREATE FUNCTION tea_refuse_job_failure() RETURNS trigger LANGUAGE plpgsql AS $fn$
      BEGIN RAISE EXCEPTION 'tea refuses this row'; END $fn$`)
    await prisma.$executeRawUnsafe(
      'CREATE TRIGGER tea_refuse_job_failure BEFORE INSERT ON "JobFailure" FOR EACH ROW EXECUTE FUNCTION tea_refuse_job_failure()'
    )
    try {
      clock.advance(2 * SLA_MINUTE_MS)
      await expect(sweep().run()).resolves.toBeDefined()
      expect((await alertByKey(key))!).toMatchObject({
        attempts: 3,
        failure_escalated_at: null,
        delivery: 'pending',
      })
      expect(logs.named('moderation_sla_failure_record_failed')).toHaveLength(1)
      expect(logs.named('moderation_sla_delivery_failed', 'error')).toHaveLength(0)
    } finally {
      await prisma.$executeRawUnsafe(
        'DROP TRIGGER tea_refuse_job_failure ON "JobFailure"'
      )
      await prisma.$executeRawUnsafe('DROP FUNCTION tea_refuse_job_failure()')
    }
    clock.advance(4 * SLA_MINUTE_MS)
    await sweep().run()
    expect((await alertByKey(key))!.failure_escalated_at).not.toBeNull()
    expect(await prisma.jobFailure.count()).toBe(1)
  })
})

describe('I-W-BACKOFF-HONORED: next_attempt_at', () => {
  it('sends nothing before it and sends at it exactly', async () => {
    const seeded = await seedCase({ dueAt: inMs(SLA_HOUR_MS) })
    capture().respondWith(500)
    await sweep().run()
    capture().reset()
    clock.advance(SLA_MINUTE_MS - 1)
    await sweep().run()
    expect(capture().received).toEqual([])
    clock.advance(1)
    await sweep().run()
    expect(capture().received).toHaveLength(1)
    expect((await alertByKey(slaKey(seeded, 'at_risk')))!.delivery).toBe('delivered')
  })
})

describe('I-W-NO-CHANNEL: no webhook configured (TEA-11)', () => {
  const noChannel = () => ({ channel: createModerationOpsChannel({ url: '' }) })

  it('marks the alert console_only with no failure, and the monitor says console', async () => {
    const seeded = await seedCase({ dueAt: inMs(SLA_HOUR_MS) })
    await sweep(noChannel()).run()
    expect((await alertByKey(slaKey(seeded, 'at_risk')))!).toMatchObject({
      delivery: 'console_only',
      last_error_code: null,
      failure_escalated_at: null,
    })
    expect(await prisma.jobFailure.count()).toBe(0)
    expect(capture().received).toEqual([])
    expect(logs.named('moderation_sla_delivery_attempt_failed')).toEqual([])
    expect(
      await prisma.moderationSlaMonitor.findUnique({ where: { id: 'default' } })
    ).toMatchObject({ channel: 'console' })
  })

  it('replays nothing when a URL appears later, and the next new alert sends', async () => {
    await seedCase({ dueAt: inMs(SLA_HOUR_MS) })
    await sweep(noChannel()).run()
    await sweep().run()
    expect(capture().received).toEqual([])
    const next = await seedCase({ dueAt: inMs(SLA_HOUR_MS) })
    await sweep().run()
    const row = (await alertByKey(slaKey(next, 'at_risk')))!
    expect(capture().idsReceived()).toEqual([row.id])
  })
})

describe('I-W-BAD-CONFIG: a URL the adapter refuses', () => {
  it('reaches no server, records invalid_config, and the third attempt escalates', async () => {
    const seeded = await seedCase({ dueAt: inMs(SLA_HOUR_MS) })
    const refused = {
      channel: createModerationOpsChannel({
        url: `http://localhost.evil.test:${capture().port}/CANARYSECRET`,
      }),
    }
    await sweep(refused).run()
    clock.advance(SLA_MINUTE_MS)
    await sweep(refused).run()
    clock.advance(2 * SLA_MINUTE_MS)
    await sweep(refused).run()
    expect(capture().received).toEqual([])
    expect((await alertByKey(slaKey(seeded, 'at_risk')))!.last_error_code).toBe(
      'invalid_config'
    )
    const [failure] = await prisma.jobFailure.findMany()
    expect(failure).toMatchObject({ job_data: { code: 'invalid_config' } })
    expect(JSON.stringify(failure)).not.toContain('CANARYSECRET')
    expect(logs.text()).not.toContain('CANARYSECRET')
  })
})

describe('I-W-BACKLOG: the flag opens over old rows (TEA-11)', () => {
  async function buildBacklog() {
    const closed = await seedCase({ dueAt: inMs(SLA_HOUR_MS) })
    const crossed = await seedCase({ dueAt: inMs(SLA_HOUR_MS) })
    const live = await seedCase({ dueAt: inMs(5 * SLA_HOUR_MS) })
    capture().respondWith(500)
    await sweep().run()
    capture().reset()
    ctx.flagValues.set('moderation_sla_monitoring_enabled', false)
    await prisma.communityPostReport.update({
      where: { id: closed.anchorReportId },
      data: { resolved_at: NOW },
    })
    clock.advance(2 * SLA_HOUR_MS)
    await sweep().run()
    ctx.flagValues.delete('moderation_sla_monitoring_enabled')
    return { closed, crossed, live }
  }

  it('with a URL: closed and past-due at-risk rows supersede, and live ones send', async () => {
    const { closed, crossed, live } = await buildBacklog()
    await sweep().run()
    expect((await alertByKey(slaKey(closed, 'at_risk')))!.delivery).toBe('superseded')
    expect((await alertByKey(slaKey(crossed, 'at_risk')))!.delivery).toBe('superseded')
    const breached = (await alertByKey(slaKey(crossed, 'breached')))!
    const liveRow = (await alertByKey(slaKey(live, 'at_risk')))!
    expect(breached.delivery).toBe('delivered')
    expect(liveRow.delivery).toBe('delivered')
    expect(capture().idsReceived().sort()).toEqual([breached.id, liveRow.id].sort())
  })

  it('with no URL: relevance still runs first, so stale rows supersede', async () => {
    const { closed, crossed, live } = await buildBacklog()
    await sweep({ channel: createModerationOpsChannel({ url: '' }) }).run()
    expect((await alertByKey(slaKey(closed, 'at_risk')))!.delivery).toBe('superseded')
    expect((await alertByKey(slaKey(crossed, 'at_risk')))!.delivery).toBe('superseded')
    expect((await alertByKey(slaKey(live, 'at_risk')))!.delivery).toBe('console_only')
  })
})

describe('I-W-RESOLVED: a case closes before delivery', () => {
  it('sends nothing and supersedes the row', async () => {
    const seeded = await seedCase({ dueAt: inMs(SLA_HOUR_MS) })
    capture().respondWith(500)
    await sweep().run()
    capture().reset()
    const operator = await seedMember(
      prisma,
      ctx.runId,
      `op${randomUUID().slice(0, 6)}`,
      {
        alias: false,
      }
    )
    await new CommunityModerationActionsService(prisma, {
      assist: vi.fn(),
    } as never).resolveReport({
      reportId: seeded.anchorReportId,
      operatorId: operator.id,
      resolution: 'handled',
    })
    clock.advance(SLA_MINUTE_MS)
    await sweep().run()
    expect(capture().received).toEqual([])
    expect((await alertByKey(slaKey(seeded, 'at_risk')))!.delivery).toBe('superseded')
  })
})

describe('U-S-ISOLATION: one bad alert leaves the batch running', () => {
  it('processes the other alerts when one send throws through a broken channel', async () => {
    const seeds = await Promise.all(
      [1, 2, 3].map(() => seedCase({ dueAt: inMs(SLA_HOUR_MS) }))
    )
    const sent: string[] = []
    let calls = 0
    const channel = {
      kind: 'webhook' as const,
      deliver: (payload: { id: string }) => {
        calls += 1
        if (calls === 1) return Promise.reject(new Error('adapter contract broken'))
        sent.push(payload.id)
        return Promise.resolve('delivered' as const)
      },
    }
    await expect(sweep({ channel: channel as never }).run()).rejects.toThrow(
      /^moderation_sla_delivery_incomplete$/
    )
    expect(sent).toHaveLength(seeds.length - 1)
    expect(await prisma.moderationSlaMonitor.findFirst()).toBeNull()
    expect(logs.named('moderation_sla_alert_processing_failed')).toHaveLength(1)
  })
})

describe('I-W-CLAIM-FAILS: a delivery fault is a failed sweep (CX-3)', () => {
  const service = () => new ModerationSlaService(prisma, clock.now)

  it('rejects with fixed text, leaves the stamp and the snapshot, and the page goes stale', async () => {
    await sweep().run()
    const stamped = await prisma.moderationSlaMonitor.findFirstOrThrow()
    capture().reset()
    const seeded = await seedCase({ dueAt: inMs(-SLA_HOUR_MS) })
    clock.advance(SLA_MINUTE_MS)
    analytics.capture.mockClear()
    const allow = await refuseWrites(prisma, {
      table: 'ModerationSlaAlert',
      event: 'UPDATE',
    })
    try {
      const failure = await sweep()
        .run()
        .then(
          () => null,
          (error: Error) => error
        )
      expect(failure).toBeInstanceOf(Error)
      expect(failure!.message).toBe('moderation_sla_claim_failed')
      expect(failure!.cause).toBeUndefined()
      expect(logs.named('moderation_sla_claim_failed')).toHaveLength(1)
      expect(await prisma.moderationSlaMonitor.findFirstOrThrow()).toEqual(stamped)
      expect(eventsNamed('moderation_sla_snapshot')).toEqual([])
      expect(capture().received).toEqual([])
      expect((await alertByKey(slaKey(seeded, 'breached')))!.delivery).toBe('pending')
      clock.advance(5 * SLA_MINUTE_MS)
      const { data } = await service().summary()
      expect(data.monitor.stale).toBe(true)
      expect(data.alerts.pending).toBe(1)
    } finally {
      await allow()
    }
    await sweep().run()
    expect((await alertByKey(slaKey(seeded, 'breached')))!.delivery).toBe('delivered')
    expect(
      (await prisma.moderationSlaMonitor.findFirstOrThrow()).last_sweep_at.getTime()
    ).toBeGreaterThan(stamped.last_sweep_at.getTime())
  })

  it('finishes the batch when an outcome write fails, then fails the run with no stamp', async () => {
    await seedCase({ dueAt: inMs(SLA_HOUR_MS) })
    await seedCase({ dueAt: inMs(SLA_HOUR_MS) })
    const allow = await refuseWrites(prisma, {
      table: 'ModerationSlaAlert',
      event: 'UPDATE',
      when: "NEW.delivery = 'delivered'",
    })
    try {
      await expect(sweep().run()).rejects.toThrow(/^moderation_sla_delivery_incomplete$/)
      expect(capture().received).toHaveLength(2)
      expect(logs.named('moderation_sla_alert_processing_failed')).toHaveLength(2)
      expect(await prisma.moderationSlaMonitor.findFirst()).toBeNull()
    } finally {
      await allow()
    }
  })
})

describe('I-W-OWED-ESCALATION: an owed failure record outlives later outcomes (CX-4)', () => {
  const jobFailures = () => prisma.jobFailure.findMany()
  /** Attempts 1 and 2 fail, and the third fails with its JobFailure insert refused. */
  async function thirdFailureUnrecorded(seeded: Awaited<ReturnType<typeof seedCase>>) {
    capture().respondWith(500)
    await sweep().run()
    clock.advance(SLA_MINUTE_MS)
    await sweep().run()
    const allow = await refuseWrites(prisma, { table: 'JobFailure', event: 'INSERT' })
    try {
      clock.advance(2 * SLA_MINUTE_MS)
      await sweep().run()
    } finally {
      await allow()
    }
    const row = (await alertByKey(slaKey(seeded, 'at_risk')))!
    expect(row).toMatchObject({ attempts: 3, failure_escalated_at: null })
    expect(await jobFailures()).toEqual([])
    capture().reset()
  }
  const expectOneRecord = async (key: string) => {
    const row = (await alertByKey(key))!
    expect(row.failure_escalated_at).not.toBeNull()
    expect(await jobFailures()).toMatchObject([
      {
        job_id: `moderation_sla_delivery__${row.id}`,
        job_data: { alertId: row.id, kind: row.kind, code: 'http_5xx' },
      },
    ])
    expect(logs.named('moderation_sla_delivery_failed', 'error')).toHaveLength(1)
    expect(eventsNamed('moderation_sla_delivery_failed')).toHaveLength(1)
  }

  it('repairs it after a later delivery succeeds, once', async () => {
    const seeded = await seedCase({ dueAt: inMs(SLA_HOUR_MS) })
    const key = slaKey(seeded, 'at_risk')
    await thirdFailureUnrecorded(seeded)
    clock.advance(4 * SLA_MINUTE_MS)
    await sweep().run()
    expect((await alertByKey(key))!.delivery).toBe('delivered')
    expect(capture().received).toHaveLength(1)
    await sweep().run()
    await expectOneRecord(key)
    await sweep().run()
    await expectOneRecord(key)
  })

  it('repairs it after a crash between the third failure and its record', async () => {
    const seeded = await seedCase({ dueAt: inMs(SLA_HOUR_MS) })
    const key = slaKey(seeded, 'at_risk')
    capture().respondWith(500)
    await sweep().run()
    clock.advance(SLA_MINUTE_MS)
    await sweep().run()
    // What the row holds when the process dies right after `recordFailedAttempt`.
    await prisma.$executeRaw`
      UPDATE "ModerationSlaAlert"
      SET attempts = 3, last_error_code = 'http_5xx', failure_owed_code = 'http_5xx',
        lease_until = NULL, next_attempt_at = ${inMs(10 * SLA_MINUTE_MS).toISOString()}::timestamp
      WHERE dedupe_key = ${key}`
    capture().reset()
    clock.advance(11 * SLA_MINUTE_MS)
    await sweep().run()
    await sweep().run()
    expect((await alertByKey(key))!.delivery).toBe('delivered')
    await expectOneRecord(key)
  })

  it('repairs it on a superseded alert, because the channel still failed three times', async () => {
    const seeded = await seedCase({ dueAt: inMs(SLA_HOUR_MS) })
    const key = slaKey(seeded, 'at_risk')
    await thirdFailureUnrecorded(seeded)
    await prisma.communityPostReport.update({
      where: { id: seeded.anchorReportId },
      data: { resolved_at: NOW },
    })
    clock.advance(4 * SLA_MINUTE_MS)
    await sweep().run()
    await sweep().run()
    expect((await alertByKey(key))!.delivery).toBe('superseded')
    expect(capture().received).toEqual([])
    await expectOneRecord(key)
  })

  it('repairs it after the webhook is removed and the alert turns console-only', async () => {
    const seeded = await seedCase({ dueAt: inMs(SLA_HOUR_MS) })
    const key = slaKey(seeded, 'at_risk')
    await thirdFailureUnrecorded(seeded)
    clock.advance(4 * SLA_MINUTE_MS)
    const channel = createModerationOpsChannel({ url: null })
    await sweep({ channel }).run()
    await sweep({ channel }).run()
    expect((await alertByKey(key))!.delivery).toBe('console_only')
    await expectOneRecord(key)
  })

  it('writes one record when two workers repair together', async () => {
    const seeded = await seedCase({ dueAt: inMs(SLA_HOUR_MS) })
    const key = slaKey(seeded, 'at_risk')
    await thirdFailureUnrecorded(seeded)
    clock.advance(4 * SLA_MINUTE_MS)
    await sweep().run()
    await Promise.all([sweep().run(), sweep({ prisma: ctx.newClient() }).run()])
    await expectOneRecord(key)
  })

  it('owes nothing when the third attempt succeeds', async () => {
    const seeded = await seedCase({ dueAt: inMs(SLA_HOUR_MS) })
    const key = slaKey(seeded, 'at_risk')
    capture().respondWith(500)
    await sweep().run()
    clock.advance(SLA_MINUTE_MS)
    await sweep().run()
    capture().reset()
    clock.advance(2 * SLA_MINUTE_MS)
    await sweep().run()
    await sweep().run()
    expect((await alertByKey(key))!).toMatchObject({
      attempts: 3,
      delivery: 'delivered',
      failure_escalated_at: null,
    })
    expect(await jobFailures()).toEqual([])
    expect(eventsNamed('moderation_sla_delivery_failed')).toEqual([])
  })
})

describe('U-S-LAST-MEASURED: the time Grafana gates stale counts on (CX-5)', () => {
  it('publishes the measurement time on a successful sweep', async () => {
    await sweep().run()
    expect(meter.setLastMeasuredAt.mock.calls).toEqual([[NOW.getTime() / 1000]])
  })

  it('publishes nothing while a flag holds the sweep off', async () => {
    ctx.flagValues.set('moderation_sla_monitoring_enabled', false)
    await sweep().run()
    expect(meter.setLastMeasuredAt).not.toHaveBeenCalled()
    expect(meter.setOpenCases).not.toHaveBeenCalled()
  })

  it('publishes nothing when detection fails', async () => {
    const broken = new PrismaClient({
      datasourceUrl: 'postgresql://x:x@127.0.0.1:1/none',
    })
    await expect(sweep({ prisma: broken }).run()).rejects.toThrow()
    await broken.$disconnect()
    expect(meter.setLastMeasuredAt).not.toHaveBeenCalled()
  })

  it('publishes nothing when the counts read fails', async () => {
    const failingCounts = aroundRawQueries(prisma, (query, run) =>
      query.sql?.includes('oldest_due_text')
        ? Promise.reject(new Error('counts unavailable'))
        : run()
    )
    await sweep({ prisma: failingCounts }).run()
    expect(meter.setLastMeasuredAt).not.toHaveBeenCalled()
    expect(logs.named('moderation_sla_signals_failed')).toHaveLength(1)
  })
})

describe('U-S-RESULT-SAFE and U-S-FLAG-ORDER', () => {
  it('returns integer counts only, because the maintenance wrapper logs the result (TEA-13)', async () => {
    await seedCase({ dueAt: inMs(SLA_HOUR_MS) })
    const result = await sweep().run()
    const values = Object.values(result)
    expect(values.length).toBeGreaterThan(0)
    for (const value of values) expect(Number.isInteger(value)).toBe(true)
  })

  it('reads flags before anything else, so a missing table cannot matter while off', async () => {
    ctx.flagValues.set('moderation_console_enabled', false)
    const explosive = new Proxy(
      {},
      {
        get(_target, property) {
          throw new Error(`prisma touched before the flags: ${String(property)}`)
        },
      }
    )
    await expect(sweep({ prisma: explosive as never }).run()).resolves.toMatchObject({
      skipped: 1,
      recorded: 0,
      delivered: 0,
    })
  })
})

describe('U-S-SNAPSHOT: the PostHog liveness signal', () => {
  const snapshots = () => eventsNamed('moderation_sla_snapshot')

  it('fires at most once per 5 minutes per sweep instance, with no case id', async () => {
    await seedCase({ dueAt: inMs(SLA_HOUR_MS) })
    const job = sweep()
    await job.run()
    expect(snapshots()).toHaveLength(1)
    clock.advance(5 * SLA_MINUTE_MS - 1)
    await job.run()
    expect(snapshots()).toHaveLength(1)
    clock.advance(1)
    await job.run()
    expect(snapshots()).toHaveLength(2)
    expect(snapshots()[0]).toEqual({
      distinctId: 'system:moderation-sla',
      event: 'moderation_sla_snapshot',
      properties: {
        on_track: 0,
        at_risk: 1,
        breached: 0,
        escalated: 0,
        oldest_pending_review_age_seconds: 0,
      },
    })
  })

  it('a capture failure leaves the sweep result unchanged', async () => {
    const seeded = await seedCase({ dueAt: inMs(SLA_HOUR_MS) })
    analytics.capture.mockImplementation(() => {
      throw new Error('posthog down')
    })
    try {
      await expect(sweep().run()).resolves.toBeDefined()
      expect((await alertByKey(slaKey(seeded, 'at_risk')))!.delivery).toBe('delivered')
    } finally {
      analytics.capture.mockReset()
    }
  })
})

describe('U-S-RECORDED: alert events count real rows (TEA-10)', () => {
  it('fires once per inserted row, never on a conflict or a retry', async () => {
    await seedCase({ dueAt: inMs(SLA_HOUR_MS) })
    await seedCase({ dueAt: inMs(-SLA_HOUR_MS) })
    const job = sweep()
    await job.run()
    await job.run()
    expect(eventsNamed('moderation_sla_alert_recorded')).toHaveLength(2)
    expect(meter.countAlert.mock.calls.map(([kind]) => kind).sort()).toEqual([
      'at_risk',
      'breached',
    ])
  })

  it('fires once for an escalated row, at its first claim', async () => {
    const seeded = await seedCase({ dueAt: inMs(20 * SLA_HOUR_MS) })
    await insertEscalated(seeded)
    capture().respondWith(500)
    await sweep().run()
    clock.advance(SLA_MINUTE_MS)
    await sweep().run()
    expect(eventsNamed('moderation_sla_alert_recorded')).toHaveLength(1)
    expect(meter.countAlert.mock.calls).toEqual([['escalated']])
  })
})

describe('I-P: private data on no surface', () => {
  const CANARY = 'CANARYPRIVATE'
  const hostile = `<script>${CANARY}</script>`

  async function everySurface(extra: string[] = []) {
    return [
      JSON.stringify(capture().received),
      logs.text(),
      JSON.stringify(analytics.capture.mock.calls),
      JSON.stringify(await prisma.jobFailure.findMany()),
      JSON.stringify(await alerts()),
      JSON.stringify(meter.countAlert.mock.calls),
      JSON.stringify(meter.countDeliveryFailure.mock.calls),
      JSON.stringify(meter.setOpenCases.mock.calls),
      ...extra,
    ]
  }

  it('I-P-CANARY: reason text, caption, alias and identities reach no surface on success or failure', async () => {
    const seeded = await seedCase({
      dueAt: inMs(SLA_HOUR_MS),
      caption: hostile,
      details: hostile,
      alias: `alias-${CANARY}`,
      reporters: 2,
    })
    const comment = await seedCase({ source: 'comment', dueAt: inMs(-SLA_HOUR_MS) })
    await prisma.communityCommentReport.updateMany({
      where: { comment_id: comment.targetId },
      data: { content_snapshot: { body: hostile, locale: 'en-US' } },
    })
    const reporterIds = (
      await Promise.all([
        prisma.communityPostReport.findMany({ where: { post_id: seeded.targetId } }),
        prisma.communityCommentReport.findMany({
          where: { comment_id: comment.targetId },
        }),
      ])
    )
      .flat()
      .map((report) => report.reporter_id as string)
    expect(reporterIds).toHaveLength(3)
    capture().respondWith(500)
    await sweep().run()
    clock.advance(SLA_MINUTE_MS)
    await sweep().run()
    clock.advance(2 * SLA_MINUTE_MS)
    await sweep().run()
    const failedSends = JSON.stringify(capture().received)
    expect(capture().received.length).toBeGreaterThan(0)
    capture().reset()
    clock.advance(4 * SLA_MINUTE_MS)
    await sweep().run()
    expect(capture().received.length).toBeGreaterThan(0)
    expect(await prisma.jobFailure.count()).toBeGreaterThan(0)
    for (const surface of await everySurface([failedSends])) {
      expect(surface).not.toContain(CANARY)
      for (const id of [...reporterIds, seeded.authorId])
        expect(surface).not.toContain(id)
    }
  })

  it('I-P-WEBHOOK-SECRET: the URL reaches no surface on any failure path', async () => {
    const token = 'CANARYSECRET'
    const closed = await startCaptureServer()
    const closedUrl = closed.tokenUrl(token)
    await closed.close()
    capture().hang()
    const urls = [
      closedUrl,
      capture().tokenUrl(token),
      // Raw `fetch` prints this whole URL in its error text (2026-11-05 probe).
      `http://user:${token}@127.0.0.1:${capture().port}/ops`,
      `http://${token}.example.test/ops`,
      `https://${token}.invalid/ops`,
    ]
    for (const url of urls) {
      await seedCase({ dueAt: inMs(SLA_HOUR_MS) })
      const channel = createModerationOpsChannel({ url, timeoutMs: 50 })
      await sweep({ channel }).run()
      clock.advance(SLA_MINUTE_MS)
      await sweep({ channel }).run()
      clock.advance(2 * SLA_MINUTE_MS)
      await sweep({ channel }).run()
      clock.advance(4 * SLA_MINUTE_MS)
    }
    expect(await prisma.jobFailure.count()).toBeGreaterThan(0)
    const surfaces = [
      logs.text(),
      JSON.stringify(analytics.capture.mock.calls),
      JSON.stringify(await prisma.jobFailure.findMany()),
      JSON.stringify(await alerts()),
      JSON.stringify(meter.countDeliveryFailure.mock.calls),
    ]
    for (const surface of surfaces) expect(surface).not.toContain(token)
  })

  it('I-P-ANALYTICS: every event has exactly the allowed keys and the fixed distinct id', async () => {
    await seedCase({ dueAt: inMs(SLA_HOUR_MS), reason: 'harassment' })
    capture().respondWith(500)
    const job = sweep()
    await job.run()
    clock.advance(SLA_MINUTE_MS)
    await job.run()
    clock.advance(2 * SLA_MINUTE_MS)
    await job.run()
    const allowed: Record<string, string[]> = {
      moderation_sla_alert_recorded: ['kind', 'risk', 'source'],
      moderation_sla_delivery_failed: ['code', 'kind'],
      moderation_sla_snapshot: [
        'at_risk',
        'breached',
        'escalated',
        'on_track',
        'oldest_pending_review_age_seconds',
      ],
    }
    const events = analytics.capture.mock.calls.map(
      ([call]) =>
        call as {
          distinctId: string
          event: string
          properties?: Record<string, unknown>
        }
    )
    expect(events.length).toBeGreaterThan(2)
    for (const event of events) {
      expect(event.distinctId).toBe('system:moderation-sla')
      // An event missing from the list fails here, so a new one has to declare its properties.
      expect(Object.keys(event.properties ?? {}).sort(), event.event).toEqual(
        [...(allowed[event.event] ?? [])].sort()
      )
      expect(JSON.stringify(event.properties ?? {})).not.toMatch(
        /post\.|comment\.|orphan-/
      )
    }
  })
})
