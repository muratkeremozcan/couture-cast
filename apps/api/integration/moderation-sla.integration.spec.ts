// Learning path Step 52: Moderation SLA monitoring and escalation.
// Story 6.12 test owner: detection against real SQL. Which cases alert, with which kind, and when.
// I-S-BOUNDARY, -PAGING, -ANCHOR, -TZ-DST, -OUTAGE, -SUPERSEDE, -NEW-REPORT, -PARTIAL, -REKEY,
// -REKEY-COMMENT, -MONITOR, -FLAG-OFF, -FLAG-OUTAGE.
process.env.TZ = 'America/Chicago'

import { PrismaClient } from '@prisma/client'
import { describe, expect, it, vi } from 'vitest'
import {
  SLA_AT_RISK_WINDOW_MS,
  deriveSlaState,
  moderationCasesQuerySchema,
} from '@couture/api-client/contracts/http'
import { CommunityModerationActionsService } from '../src/modules/community/community-moderation.actions.js'
import { getFeatureFlag } from '@couture/config'
import { ModerationQueueRepository } from '../src/modules/moderation/moderation-queue.repository.js'
import { createModerationOpsChannel } from '../src/modules/moderation/moderation-sla.channel.js'
import { ModerationSlaSweep } from '../src/modules/moderation/moderation-sla.sweep.js'
import { seedBulkOpenPosts, seedMember } from './helpers/moderation-queue-seed.js'
import {
  SLA_HOUR_MS,
  SLA_MINUTE_MS,
  moderationSlaTestContext,
} from './helpers/moderation-sla-harness.js'

vi.setConfig({ testTimeout: 60_000 })

const NOW = new Date('2026-11-05T12:00:00.000Z')
const ctx = moderationSlaTestContext({ now: NOW })
const { prisma, clock, flagValues, alerts, alertByKey, slaKey, seedCase, sweep } = ctx
const inMs = (ms: number) => new Date(NOW.getTime() + ms)
const repository = () => new ModerationQueueRepository(prisma)
const query = (sla: 'at_risk' | 'breached' | 'on_track') =>
  moderationCasesQuerySchema.parse({ status: 'open', sla, limit: 50 })

/** Earlier tests leave closed cases behind, so a resolved row may sit on any page. */
async function findResolvedRow(caseId: string) {
  let after: { rank: number; dueKey: string; caseKey: string } | null = null
  for (;;) {
    const rows = await repository().listCases(
      moderationCasesQuerySchema.parse({ status: 'resolved', limit: 50 }),
      NOW,
      after
    )
    const row = rows.find((item) => item.caseKey === caseId)
    if (row) return row
    const last = rows.at(49)
    if (rows.length <= 50 || !last) return undefined
    after = { rank: last.riskRank, dueKey: last.dueKey, caseKey: last.caseKey }
  }
}

describe('I-S-BOUNDARY: alerts equal the 6.10 definition on real rows', () => {
  const table = [
    { remaining: SLA_AT_RISK_WINDOW_MS + 1, state: 'on_track', kinds: [] },
    { remaining: SLA_AT_RISK_WINDOW_MS, state: 'at_risk', kinds: ['at_risk'] },
    { remaining: 1, state: 'at_risk', kinds: ['at_risk'] },
    { remaining: 0, state: 'breached', kinds: ['breached'] },
    { remaining: -1, state: 'breached', kinds: ['breached'] },
  ] as const

  for (const source of ['post', 'comment'] as const) {
    for (const row of table) {
      it(`${source}: remaining ${row.remaining} ms is ${row.state}`, async () => {
        const seeded = await seedCase({ source, dueAt: inMs(row.remaining) })
        await sweep().run()
        const written = await alerts()
        expect(written.map((alert) => alert.kind)).toEqual(row.kinds)
        expect(
          deriveSlaState({ status: 'open', dueAt: inMs(row.remaining), now: NOW })
        ).toBe(row.state)
        const listed = await repository().listCases(query(row.state), NOW, null)
        expect(listed.map((item) => item.caseKey)).toEqual([seeded.caseId])
        expect(listed[0]!.slaState).toBe(row.state)
        for (const alert of written) {
          expect(alert).toMatchObject({
            dedupe_key: slaKey(seeded, row.kinds[0] as 'at_risk' | 'breached'),
            case_key: seeded.caseId,
            source,
            anchor_report_id: seeded.anchorReportId,
            risk: 'low',
          })
          expect(alert.sla_due_at.getTime()).toBe(inMs(row.remaining).getTime())
          expect(alert.detected_at.getTime()).toBe(NOW.getTime())
        }
      })
    }
  }
})

describe('I-S-PAGING: a sweep reads every page', () => {
  it('alerts each case across more than two pages of each state at mixed risk', async () => {
    const author = await seedMember(prisma, `${ctx.runId}p`, 'author')
    const reporter = await seedMember(prisma, `${ctx.runId}p`, 'reporter')
    const bulk = (
      runId: string,
      reason: 'spam' | 'harassment',
      count: number,
      dueAt: Date
    ) =>
      seedBulkOpenPosts(prisma, {
        runId,
        count,
        authorId: author.id,
        reporterId: reporter.id,
        reason,
        createdAt: new Date(dueAt.getTime() - 24 * SLA_HOUR_MS),
        dueAt,
      })
    await bulk(`${ctx.runId}a1`, 'spam', 60, inMs(SLA_HOUR_MS))
    await bulk(`${ctx.runId}a2`, 'harassment', 60, inMs(2 * SLA_HOUR_MS))
    await bulk(`${ctx.runId}b1`, 'spam', 60, inMs(-SLA_HOUR_MS))
    await bulk(`${ctx.runId}b2`, 'harassment', 60, inMs(-2 * SLA_HOUR_MS))
    await sweep({ channel: createModerationOpsChannel({ url: '' }) }).run()
    const written = await alerts()
    expect(written.filter((alert) => alert.kind === 'at_risk')).toHaveLength(120)
    expect(written.filter((alert) => alert.kind === 'breached')).toHaveLength(120)
    expect(new Set(written.map((alert) => alert.case_key)).size).toBe(240)
  })
})

describe('I-S-ANCHOR: the anchor is the earliest open report', () => {
  it('chooses the earliest due open report', async () => {
    const seeded = await seedCase({ dueAt: inMs(SLA_HOUR_MS), reporters: 3 })
    const [row] = await repository().listCases(query('at_risk'), NOW, null)
    expect(row!.anchorReportId).toBe(seeded.reports[0]!.id)
  })

  it('breaks an equal due time by report id in byte order', async () => {
    const seeded = await seedCase({
      dueAt: inMs(SLA_HOUR_MS),
      reporters: 3,
      laterReportGapMs: 0,
    })
    const [row] = await repository().listCases(query('at_risk'), NOW, null)
    const byBytes = seeded.reports
      .map((report) => report.id)
      .sort((a, b) => (Buffer.compare(Buffer.from(a), Buffer.from(b)) < 0 ? -1 : 1))
    expect(row!.anchorReportId).toBe(byBytes[0])
  })

  it('skips a resolved earlier report', async () => {
    const seeded = await seedCase({ dueAt: inMs(SLA_HOUR_MS), reporters: 2 })
    await prisma.communityPostReport.update({
      where: { id: seeded.reports[0]!.id },
      data: { resolved_at: NOW },
    })
    const [row] = await repository().listCases(query('at_risk'), NOW, null)
    expect(row!.anchorReportId).toBe(seeded.reports[1]!.id)
  })

  it('gives null for a resolved case', async () => {
    const seeded = await seedCase({ dueAt: inMs(SLA_HOUR_MS) })
    await prisma.communityPostReport.update({
      where: { id: seeded.reports[0]!.id },
      data: { resolved_at: NOW },
    })
    const row = await findResolvedRow(seeded.caseId)
    expect(row).toBeDefined()
    expect(row!.anchorReportId).toBeNull()
  })
})

describe('I-S-TZ-DST: instants hold under any session time zone', () => {
  // The 2026-11-05 probe: a JS Date parameter binds as timestamptz and shifts a `timestamp`
  // comparison by the session offset. These clocks straddle both 2026-27 US changes.
  const clocks = [
    new Date('2026-11-01T06:30:00.000Z'),
    new Date('2026-11-01T07:30:00.000Z'),
    new Date('2027-03-14T07:30:00.000Z'),
    new Date('2027-03-14T08:30:00.000Z'),
  ]

  async function runScenario(client: PrismaClient, now: Date) {
    clock.at(now)
    const offset = (ms: number) => new Date(now.getTime() + ms)
    const seeds = {
      outside: await seedCase({ dueAt: offset(SLA_AT_RISK_WINDOW_MS + 1) }),
      atWindow: await seedCase({ dueAt: offset(SLA_AT_RISK_WINDOW_MS) }),
      inside: await seedCase({ dueAt: offset(SLA_HOUR_MS) }),
      atDue: await seedCase({ dueAt: now }),
      past: await seedCase({ dueAt: offset(-1) }),
    }
    const receiver = ctx.capture()
    receiver.reset()
    receiver.respondWith(500)
    await new ModerationSlaSweep({
      prisma: client,
      clock: clock.now,
      channel: createModerationOpsChannel({ url: receiver.url }),
      flags: ctx.flags as never,
      analytics: ctx.analytics,
      logger: ctx.logs.logger as never,
      meter: ctx.meter,
    }).run()
    const firstPass = receiver.received.length
    const rows = await client.moderationSlaAlert.findMany()
    const failed = rows.find((row) => row.attempts === 1)
    // Each row's retry time is exactly one minute on, whatever the session offset is.
    const retryAt = failed?.next_attempt_at?.getTime() ?? 0
    const outcome = {
      kinds: Object.fromEntries(
        Object.entries(seeds).map(([name, seeded]) => [
          name,
          rows
            .filter((row) => row.case_key === seeded.caseId)
            .map((row) => row.kind)
            .sort(),
        ])
      ),
      firstPass,
      retryDelayMs: retryAt - now.getTime(),
    }
    await client.moderationSlaAlert.deleteMany()
    await client.jobFailure.deleteMany()
    await client.communityPostReport.updateMany({
      where: { resolved_at: null },
      data: { resolved_at: now },
    })
    return outcome
  }

  for (const now of clocks) {
    it(`matches the UTC session at ${now.toISOString()}`, async () => {
      const utc = ctx.newClient('-c TimeZone=UTC')
      const chicago = ctx.newClient('-c TimeZone=America/Chicago')
      const onUtc = await runScenario(utc, now)
      const onChicago = await runScenario(chicago, now)
      expect(onUtc.kinds).toEqual({
        outside: [],
        atWindow: ['at_risk'],
        inside: ['at_risk'],
        atDue: ['breached'],
        past: ['breached'],
      })
      expect(onUtc.firstPass).toBe(4)
      expect(onUtc.retryDelayMs).toBe(SLA_MINUTE_MS)
      expect(onChicago).toEqual(onUtc)
    })
  }

  it('keeps the at-risk boundary across the repeated hour of the fall change', async () => {
    const chicago = ctx.newClient('-c TimeZone=America/Chicago')
    // 06:30Z is 01:30 CDT, and 07:30Z is 01:30 CST. Wall time repeats. Instants do not.
    const now = new Date('2026-11-01T06:30:00.000Z')
    const outcome = await runScenario(chicago, now)
    expect(outcome.kinds.atWindow).toEqual(['at_risk'])
    expect(outcome.kinds.outside).toEqual([])
  })
})

describe('I-S-OUTAGE: a worker outage crossed the window', () => {
  it('writes breached only', async () => {
    const seeded = await seedCase({ dueAt: inMs(-3 * SLA_HOUR_MS) })
    await sweep().run()
    expect((await alerts()).map((alert) => alert.dedupe_key)).toEqual([
      slaKey(seeded, 'breached'),
    ])
  })
})

describe('I-S-SUPERSEDE: an unsent at-risk alert meets the breach', () => {
  it('supersedes it in the same sweep and sends only breached', async () => {
    const seeded = await seedCase({ dueAt: inMs(SLA_HOUR_MS) })
    const receiver = ctx.capture()
    receiver.respondWith(500)
    await sweep().run()
    expect((await alertByKey(slaKey(seeded, 'at_risk')))!.delivery).toBe('pending')

    receiver.reset()
    clock.at(seeded.reports[0]!.dueAt)
    await sweep().run()
    expect((await alertByKey(slaKey(seeded, 'at_risk')))!.delivery).toBe('superseded')
    const breached = await alertByKey(slaKey(seeded, 'breached'))
    expect(breached!.delivery).toBe('delivered')
    expect(receiver.idsReceived()).toEqual([breached!.id])
  })
})

describe('I-S-NEW-REPORT: reports arriving around an alert', () => {
  it('gives a new report on a resolved case its own alerts at its own window', async () => {
    const seeded = await seedCase({ dueAt: inMs(SLA_HOUR_MS) })
    await sweep().run()
    await prisma.communityPostReport.update({
      where: { id: seeded.anchorReportId },
      data: { resolved_at: NOW },
    })
    const later = await prisma.communityPostReport.create({
      data: {
        id: `${ctx.runId}-newrep`,
        post_id: seeded.targetId,
        reporter_id: (
          await seedMember(prisma, ctx.runId, 'newreporter', { alias: false })
        ).id,
        reason: 'spam',
        sla_due_at: inMs(2 * SLA_HOUR_MS),
        created_at: NOW,
      },
    })
    await sweep().run()
    const key = `sla:post:${later.id}:at_risk`
    expect(await alertByKey(key)).not.toBeNull()
    await sweep().run()
    expect((await alerts()).filter((alert) => alert.dedupe_key === key)).toHaveLength(1)
  })

  it('adds no alert for a later report on an alerted open case, and reportCount moves', async () => {
    const seeded = await seedCase({ dueAt: inMs(SLA_HOUR_MS) })
    await sweep().run()
    const before = await alerts()
    await prisma.communityPostReport.create({
      data: {
        id: `${ctx.runId}-laterrep`,
        post_id: seeded.targetId,
        reporter_id: (
          await seedMember(prisma, ctx.runId, 'laterreporter', { alias: false })
        ).id,
        reason: 'spam',
        sla_due_at: inMs(20 * SLA_HOUR_MS),
        created_at: NOW,
      },
    })
    await sweep().run()
    expect((await alerts()).map((alert) => alert.id)).toEqual(
      before.map((alert) => alert.id)
    )
    const [row] = await repository().listCases(query('at_risk'), NOW, null)
    expect(row!.reportCount).toBe(2)
    expect(row!.anchorReportId).toBe(seeded.anchorReportId)
  })
})

describe('I-S-PARTIAL: resolving one report of a case (TEA-19)', () => {
  it('alerts the next open report under its own key', async () => {
    const seeded = await seedCase({ dueAt: inMs(SLA_HOUR_MS), reporters: 2 })
    await sweep().run()
    const operator = await seedMember(prisma, ctx.runId, 'operator', { alias: false })
    await new CommunityModerationActionsService(prisma, {
      assist: vi.fn(),
    } as never).resolveReport({
      reportId: seeded.anchorReportId,
      operatorId: operator.id,
      resolution: 'unfounded',
    })
    await sweep().run()
    expect(await alertByKey(`sla:post:${seeded.reports[1]!.id}:at_risk`)).not.toBeNull()
  })
})

describe('I-S-REKEY: erasure splits a case into orphan cases', () => {
  it('post: the alerted orphan stays quiet and the others alert once each', async () => {
    const seeded = await seedCase({ dueAt: inMs(SLA_HOUR_MS), reporters: 3 })
    await sweep().run()
    expect(await alerts()).toHaveLength(1)
    // Author erasure deletes the post row, and the foreign key sets each report's post_id to null.
    await prisma.lookbookPost.delete({ where: { id: seeded.targetId } })
    await sweep().run()
    await sweep().run()
    const keys = (await alerts()).map((alert) => alert.dedupe_key).sort()
    expect(keys).toEqual(
      seeded.reports.map((report) => `sla:post:${report.id}:at_risk`).sort()
    )
    const orphanKeys = (await alerts()).map((alert) => alert.case_key)
    expect(orphanKeys).toContain(`post.${seeded.targetId}`)
    expect(orphanKeys).toContain(`orphan-post.${seeded.reports[1]!.id}`)
    expect(orphanKeys).toContain(`orphan-post.${seeded.reports[2]!.id}`)
  })
})

describe('I-S-REKEY-COMMENT: the comment form', () => {
  it('re-keys when the comment is gone', async () => {
    const seeded = await seedCase({
      source: 'comment',
      dueAt: inMs(SLA_HOUR_MS),
      reporters: 2,
    })
    await sweep().run()
    await prisma.communityCommentReport.updateMany({
      where: { comment_id: seeded.targetId },
      data: { comment_id: null },
    })
    await sweep().run()
    expect((await alerts()).map((alert) => alert.dedupe_key).sort()).toEqual(
      seeded.reports.map((report) => `sla:comment:${report.id}:at_risk`).sort()
    )
  })
})

describe('I-S-MONITOR: the singleton stamp', () => {
  it('is created at the first completed sweep and stamped at each later one', async () => {
    expect(await prisma.moderationSlaMonitor.findFirst()).toBeNull()
    await sweep().run()
    const first = await prisma.moderationSlaMonitor.findUniqueOrThrow({
      where: { id: 'default' },
    })
    expect(first.last_sweep_at?.getTime()).toBe(NOW.getTime())
    expect(first.channel).toBe('webhook')
    clock.at(inMs(SLA_MINUTE_MS))
    await sweep({ channel: createModerationOpsChannel({ url: '' }) }).run()
    const second = await prisma.moderationSlaMonitor.findUniqueOrThrow({
      where: { id: 'default' },
    })
    expect(second.last_sweep_at?.getTime()).toBe(inMs(SLA_MINUTE_MS).getTime())
    expect(second.channel).toBe('console')
  })

  it('U-S-SWEEP-FAILS: a detection failure rejects, sends nothing and leaves the stamp', async () => {
    await sweep().run()
    const before = await prisma.moderationSlaMonitor.findUniqueOrThrow({
      where: { id: 'default' },
    })
    const broken = new PrismaClient({
      datasourceUrl: 'postgresql://x:x@127.0.0.1:1/none',
    })
    clock.at(inMs(SLA_MINUTE_MS))
    await expect(sweep({ prisma: broken }).run()).rejects.toThrow()
    await broken.$disconnect()
    const after = await prisma.moderationSlaMonitor.findUniqueOrThrow({
      where: { id: 'default' },
    })
    expect(after.last_sweep_at?.getTime()).toBe(before.last_sweep_at?.getTime())
    expect(ctx.capture().received).toHaveLength(0)
  })
})

describe('I-S-FLAG-OFF: either flag off', () => {
  const combos = [
    { monitoring: false, console: true },
    { monitoring: true, console: false },
    { monitoring: false, console: false },
  ]
  for (const combo of combos) {
    it(`monitoring ${combo.monitoring}, console ${combo.console}: no read, no write, no send`, async () => {
      const seeded = await seedCase({ dueAt: inMs(SLA_HOUR_MS) })
      flagValues.set('moderation_sla_monitoring_enabled', combo.monitoring)
      flagValues.set('moderation_console_enabled', combo.console)
      const logged = new PrismaClient({
        datasourceUrl: ctx.database.url,
        log: [{ emit: 'event', level: 'query' }],
      })
      const statements: string[] = []
      logged.$on('query', (event) => statements.push(event.query))
      const result = await sweep({ prisma: logged }).run()
      await logged.$disconnect()
      // Flags are doubles here, so even the `FeatureFlag` fallback (TEA-20) does not appear.
      expect(statements).toEqual([])
      expect(result).toMatchObject({ recorded: 0, delivered: 0, failed: 0, skipped: 1 })
      expect(await alerts()).toEqual([])
      expect(await prisma.moderationSlaMonitor.findFirst()).toBeNull()
      expect(ctx.capture().received).toEqual([])
      expect(ctx.analytics.capture).not.toHaveBeenCalled()
      expect(seeded.caseId).toBeTruthy()
    })
  }

  it('reads each flag once, first, for the system subject', async () => {
    await sweep().run()
    const calls = ctx.flags.getFeatureFlag.mock.calls
    expect(calls.map(([key]) => key).sort()).toEqual([
      'moderation_console_enabled',
      'moderation_sla_monitoring_enabled',
    ])
    for (const [, subject] of calls) expect(subject).toBe('system:moderation-sla')
  })
})

describe('I-S-FLAG-OUTAGE: PostHog and the fallback both fail (TEA-05)', () => {
  it('reads as off through the real resolver: nothing is written or sent', async () => {
    await seedCase({ dueAt: inMs(SLA_HOUR_MS) })
    const outageFlags = {
      getFeatureFlag: (key: string, subject: string) =>
        getFeatureFlag(key as never, subject, {
          readRemoteFlag: () => Promise.reject(new Error('posthog down')),
          readFallbackFlag: () => Promise.reject(new Error('database down')),
        }),
    }
    await sweep({ flags: outageFlags as never }).run()
    expect(await alerts()).toEqual([])
    expect(ctx.capture().received).toEqual([])
    expect(await prisma.moderationSlaMonitor.findFirst()).toBeNull()
  })

  it('U-S-FLAG-THROW: a thrown read skips the run and logs moderation_sla_flag_unavailable', async () => {
    await seedCase({ dueAt: inMs(SLA_HOUR_MS) })
    ctx.failingFlags.add('moderation_sla_monitoring_enabled')
    await expect(sweep().run()).resolves.toBeDefined()
    expect(ctx.logs.named('moderation_sla_flag_unavailable')).toHaveLength(1)
    expect(await alerts()).toEqual([])
  })
})
