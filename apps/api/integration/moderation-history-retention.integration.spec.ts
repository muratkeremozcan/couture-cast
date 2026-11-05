// Learning path Step 53: Immutable moderation history.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-53-immutable-moderation-history
// Story 6.13 test owner: the daily prune and the drift check on real Postgres.
// I-R-BOUNDARY, -PENDING, -OWED, -13-MONTH, -BATCH, -TZ, -DRIFT-LOG, -REALERT, -CONCURRENT
import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  COMMUNITY_ERASURE_LATE_WRITE_WINDOW_MS,
  CommunityMaintenanceService,
} from '../src/modules/community/community-maintenance.service.js'
import { InMemoryCommunityStorage } from '../src/modules/community/community-storage.fake.js'
import {
  MODERATION_HISTORY_LOG_EVENTS,
  ModerationHistoryRetention,
} from '../src/modules/moderation/moderation-history.retention.js'
import {
  decisionFixtures,
  moderationDecisionsTestContext,
} from './helpers/moderation-decisions-seed.js'
import { seedDecision } from './helpers/moderation-history-seed.js'

vi.setConfig({ testTimeout: 120_000 })

const NOW = new Date('2026-11-05T12:00:00.000Z')
const DAY = 86_400_000
const ago = (ms: number) => new Date(NOW.getTime() - ms)

const ctx = moderationDecisionsTestContext()
const { prisma, clock } = ctx
const fx = decisionFixtures(prisma, clock.now)

const flagsOn = { getFeatureFlag: vi.fn(() => Promise.resolve(true as unknown)) }
const logger = { info: vi.fn(), error: vi.fn() }
const retention = (client: PrismaClient = prisma, flags: typeof flagsOn = flagsOn) =>
  new ModerationHistoryRetention({ prisma: client, flags, clock: () => NOW, logger })

type Delivery = 'pending' | 'delivered' | 'console_only' | 'superseded'
async function alert(detectedAt: Date, delivery: Delivery, extra: object = {}) {
  const anchor = randomUUID()
  return prisma.moderationSlaAlert.create({
    data: {
      dedupe_key: `sla:post:${anchor}:breached`,
      kind: 'breached',
      case_key: `post.${anchor}`,
      source: 'post',
      anchor_report_id: anchor,
      risk: 'medium',
      sla_due_at: detectedAt,
      detected_at: detectedAt,
      delivery,
      next_attempt_at: detectedAt,
      ...extra,
    },
  })
}
const exists = async (id: string) =>
  (await prisma.moderationSlaAlert.count({ where: { id } })) === 1

beforeEach(async () => {
  await prisma.moderationSlaAlert.deleteMany()
  logger.info.mockClear()
  logger.error.mockClear()
  flagsOn.getFeatureFlag.mockClear()
})

afterEach(() => vi.restoreAllMocks())

describe('I-R-BOUNDARY', () => {
  it.each(['delivered', 'console_only', 'superseded'] as const)(
    'keeps %s at 399 and exactly 400 days, and removes it 1 ms past',
    async (delivery) => {
      const young = await alert(ago(399 * DAY), delivery)
      const edge = await alert(ago(400 * DAY), delivery)
      const past = await alert(ago(400 * DAY + 1), delivery)
      const old = await alert(ago(401 * DAY), delivery)
      const result = await retention().run()
      expect(result).toMatchObject({ pruned: 2, skipped: false, drift: [] })
      expect(await exists(young.id)).toBe(true)
      expect(await exists(edge.id)).toBe(true)
      expect(await exists(past.id)).toBe(false)
      expect(await exists(old.id)).toBe(false)
    }
  )

  it('[I-R-PENDING] keeps a pending alert at 500 days', async () => {
    const row = await alert(ago(500 * DAY), 'pending')
    await retention().run()
    expect(await exists(row.id)).toBe(true)
  })

  it('[I-R-OWED] keeps a terminal alert that still owes its failure record, and removes one that paid', async () => {
    const owes = await alert(ago(500 * DAY), 'delivered', {
      failure_owed_code: 'http_5xx',
    })
    const paid = await alert(ago(500 * DAY), 'delivered', {
      failure_owed_code: 'http_5xx',
      failure_escalated_at: ago(499 * DAY),
    })
    await retention().run()
    expect(await exists(owes.id)).toBe(true)
    expect(await exists(paid.id)).toBe(false)
  })

  it('[I-R-BATCH] removes the 500 oldest in one run, and the rest in the next', async () => {
    const rows = Array.from({ length: 600 }, (_, index) => ({
      dedupe_key: `sla:post:bulk-${index}-${randomUUID()}:breached`,
      kind: 'breached' as const,
      case_key: `post.bulk-${index}`,
      source: 'post',
      anchor_report_id: `bulk-${index}`,
      risk: 'medium',
      sla_due_at: NOW,
      detected_at: ago((500 + index) * DAY),
      delivery: 'delivered' as const,
      next_attempt_at: NOW,
    }))
    await prisma.moderationSlaAlert.createMany({ data: rows })
    expect((await retention().run()).pruned).toBe(500)
    const left = await prisma.moderationSlaAlert.findMany({
      orderBy: { detected_at: 'asc' },
    })
    expect(left).toHaveLength(100)
    // The newest hundred stay, so the oldest went first.
    expect(left[0]!.detected_at).toEqual(ago(599 * DAY))
    expect(left.at(-1)!.detected_at).toEqual(ago(500 * DAY))
    expect((await retention().run()).pruned).toBe(100)
    expect(await prisma.moderationSlaAlert.count()).toBe(0)
  })

  it('[I-R-TZ] holds the 400-day edge on a Chicago session', async () => {
    const url = new URL(ctx.database.url)
    url.searchParams.set('options', '-c TimeZone=America/Chicago')
    const chicago = new PrismaClient({ datasourceUrl: url.toString() })
    try {
      const edge = await alert(ago(400 * DAY), 'delivered')
      const past = await alert(ago(400 * DAY + 60_000), 'delivered')
      await retention(chicago).run()
      expect(await exists(edge.id)).toBe(true)
      expect(await exists(past.id)).toBe(false)
    } finally {
      await chicago.$disconnect()
    }
  })

  it('[I-R-CONCURRENT] deletes each row once across two workers', async () => {
    await prisma.moderationSlaAlert.createMany({
      data: Array.from({ length: 300 }, (_, index) => ({
        dedupe_key: `sla:post:race-${index}:breached`,
        kind: 'breached' as const,
        case_key: `post.race-${index}`,
        source: 'post',
        anchor_report_id: `race-${index}`,
        risk: 'medium',
        sla_due_at: NOW,
        detected_at: ago(500 * DAY),
        delivery: 'delivered' as const,
        next_attempt_at: NOW,
      })),
    })
    const [first, second] = await Promise.all([retention().run(), retention().run()])
    expect(first.pruned + second.pruned).toBeGreaterThan(0)
    expect(first.pruned + second.pruned).toBeLessThanOrEqual(300)
    const leftover = await prisma.moderationSlaAlert.count()
    expect(first.pruned + second.pruned + leftover).toBe(300)
    expect(logger.error).not.toHaveBeenCalled()
  })
})

describe('I-R-13-MONTH', () => {
  it('keeps every evidence row at 13 months through the sweep and the erasure sweep', async () => {
    const thirteenMonths = ago(395 * DAY)
    const seeded = await fx.postCase()
    const decision = await seedDecision(prisma, {
      caseKey: seeded.caseId,
      at: thirteenMonths,
      postId: seeded.postId,
      reportIds: seeded.reportIds,
    })
    const operatorRow = await fx.operator()
    const audit = await prisma.auditLog.create({
      data: {
        user_id: operatorRow.id,
        event_type: 'moderation_decision_applied',
        timestamp: thirteenMonths,
        event_data: { decisionId: decision.id },
      },
    })
    const event = await prisma.moderationEvent.create({
      data: {
        post_id: seeded.postId,
        action: 'flagged',
        reason: 'r',
        created_at: thirteenMonths,
      },
    })
    const comment = await fx.commentCase()
    const commentAudit = await prisma.communityCommentAudit.create({
      data: {
        report_id: comment.reportIds[0]!,
        action: 'reported',
        reason: 'harassment',
        occurred_at: thirteenMonths,
      },
    })
    const pending = await alert(ago(395 * DAY), 'pending')
    const snapshot = () =>
      Promise.all([
        prisma.moderationDecision.findUnique({ where: { id: decision.id } }),
        prisma.auditLog.findUnique({ where: { id: audit.id } }),
        prisma.moderationEvent.findUnique({ where: { id: event.id } }),
        prisma.communityCommentAudit.findUnique({ where: { id: commentAudit.id } }),
        prisma.communityPostReport.findUnique({ where: { id: seeded.reportIds[0]! } }),
        prisma.communityCommentReport.findUnique({
          where: { id: comment.reportIds[0]! },
        }),
        prisma.moderationSlaAlert.findUnique({ where: { id: pending.id } }),
      ])
    const before = await snapshot()
    expect(before.every(Boolean)).toBe(true)
    await retention().run()
    await new CommunityMaintenanceService(
      prisma,
      new InMemoryCommunityStorage()
    ).sweepErasureRequests(
      new Date(NOW.getTime() + COMMUNITY_ERASURE_LATE_WRITE_WINDOW_MS)
    )
    expect(await snapshot()).toEqual(before)
  })
})

describe('I-R-DRIFT-LOG', () => {
  const driftLogs = () =>
    logger.error.mock.calls.filter(
      ([entry]) =>
        (entry as { event?: string }).event === MODERATION_HISTORY_LOG_EVENTS.drift
    )

  it('reports nothing on a clean database', async () => {
    expect((await retention().run()).drift).toEqual([])
    expect(driftLogs()).toEqual([])
  })

  it('logs the closed check name for a disabled trigger, and holds no row data', async () => {
    await prisma.$executeRawUnsafe(
      'ALTER TABLE "ModerationDecision" DISABLE TRIGGER moderation_decision_block_update'
    )
    try {
      const result = await retention().run()
      expect(result.drift).toEqual(['trigger_update'])
      const logs = driftLogs()
      expect(logs).toHaveLength(1)
      expect(logs[0]![0]).toEqual({
        event: MODERATION_HISTORY_LOG_EVENTS.drift,
        checks: ['trigger_update'],
      })
    } finally {
      await prisma.$executeRawUnsafe(
        'ALTER TABLE "ModerationDecision" ENABLE TRIGGER moderation_decision_block_update'
      )
    }
  })

  it('logs drift with the flag off, and skips only the prune', async () => {
    const stale = await alert(ago(500 * DAY), 'delivered')
    const off = { getFeatureFlag: vi.fn(() => Promise.resolve(false as unknown)) }
    await prisma.$executeRawUnsafe('GRANT SELECT ON "ModerationDecision" TO service_role')
    try {
      const result = await retention(prisma, off).run()
      expect(result).toMatchObject({
        drift: ['no_other_grantee'],
        pruned: 0,
        skipped: true,
      })
      expect(driftLogs()).toHaveLength(1)
      expect(await exists(stale.id)).toBe(true)
    } finally {
      await prisma.$executeRawUnsafe(
        'REVOKE ALL ON "ModerationDecision" FROM service_role'
      )
    }
  })

  it('asks for system:moderation-history and treats a failed read as off', async () => {
    const stale = await alert(ago(500 * DAY), 'delivered')
    await retention().run()
    expect(flagsOn.getFeatureFlag).toHaveBeenCalledWith(
      'moderation_history_enabled',
      'system:moderation-history'
    )
    const another = await alert(ago(500 * DAY), 'delivered')
    const failing = {
      getFeatureFlag: vi.fn(() => Promise.reject(new Error('flag read failed'))),
    }
    const result = await retention(prisma, failing as never).run()
    expect(result.skipped).toBe(true)
    expect(await exists(another.id)).toBe(true)
    expect(await exists(stale.id)).toBe(false)
  })
})

describe('I-R-REALERT', () => {
  it('lets a new alert use the dedupe key of a pruned row', async () => {
    const stale = await alert(ago(500 * DAY), 'delivered')
    await retention().run()
    expect(await exists(stale.id)).toBe(false)
    const again = await prisma.moderationSlaAlert.create({
      data: {
        dedupe_key: stale.dedupe_key,
        kind: stale.kind,
        case_key: stale.case_key,
        source: stale.source,
        anchor_report_id: stale.anchor_report_id,
        risk: stale.risk,
        sla_due_at: NOW,
        detected_at: NOW,
        next_attempt_at: NOW,
      },
    })
    expect(again.delivery).toBe('pending')
  })
})
