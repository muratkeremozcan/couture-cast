// Learning path Step 52: Moderation SLA monitoring and escalation.
// Story 6.12 test owner: GET /api/v1/moderation/sla through the real ModerationModule, so a missing
// guard, provider or `forRoutes` entry fails here. Counts are compared with the real queue route.
// I-R-HTTP, -HEADERS, -COUNT-PARITY, -NO-LOAD, -RESOLUTION, -ALERT-COUNTS, -RECENT, -STALE,
// -PENDING-AGE, -SANCTIONED, and the route halves of I-S-TZ-DST and I-P-CANARY.
import 'reflect-metadata'
import { randomUUID } from 'node:crypto'
import { Test } from '@nestjs/testing'
import { UnauthorizedException } from '@nestjs/common'
import { PrismaClient } from '@prisma/client'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  SLA_AT_RISK_WINDOW_MS,
  forbiddenHttpErrorSchema,
  moderationCasesResponseSchema,
  moderationSlaErrorSchema,
  moderationSlaResponseSchema,
  type ModerationSlaSummary,
} from '@couture/api-client/contracts/http'
import { AccessTokenIdentityService } from '../src/modules/auth/access-token-identity.service.js'
import { GuardianConsentStateService } from '../src/modules/auth/guardian-consent-state.service.js'
import { SupabaseCommunityStorageAdapter } from '../src/modules/community/community-storage.adapter.js'
import { FeatureFlagsService } from '../src/modules/feature-flags/feature-flags.service.js'
import { ModerationModule } from '../src/modules/moderation/moderation.module.js'
import { MODERATION_QUEUE_CLOCK } from '../src/modules/moderation/moderation-decision-rules.js'
import { ModerationSlaService } from '../src/modules/moderation/moderation-sla.service.js'
import { listenHttpApp } from '../src/testing/loopback-http-app.js'
import {
  decisionFixtures,
  moderationDecisionsTestContext,
  type DecisionBoot,
} from './helpers/moderation-decisions-seed.js'
import { checksumTables } from './helpers/moderation-queue-context.js'
import { SEED_DAY_MS } from './helpers/moderation-queue-seed.js'

vi.setConfig({ testTimeout: 60_000 })

const NOW = new Date('2026-11-05T12:00:00.000Z')
const HOUR = 3_600_000
const MINUTE = 60_000
const ROUTE = '/api/v1/moderation/sla'
const REASON = 'Needs a second reader.'
const inMs = (ms: number) => new Date(NOW.getTime() + ms)

const ctx = moderationDecisionsTestContext()
const { prisma, clock, flagValues, flags, failFlag } = ctx
const fx = decisionFixtures(prisma, clock.now)
let boot: DecisionBoot
let server: string
let closeApp: () => Promise<void>
let moderatorId: string

const auth = (role: string, id = moderatorId) => `Bearer test-token:${role}:${id}`
const get = (role?: string) => {
  const call = request(server).get(ROUTE)
  return role ? call.set('Authorization', auth(role)) : call
}
const summary = async (role = 'moderator'): Promise<ModerationSlaSummary> => {
  const response = await get(role).expect(200)
  return moderationSlaResponseSchema.parse(response.body).data
}

beforeAll(async () => {
  clock.at(NOW)
  boot = await ctx.bootApp()
  moderatorId = (await fx.operator()).id
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

/** Every test reads a closed world: no open report, alert, monitor row or pending post. */
beforeEach(async () => {
  clock.at(NOW)
  await prisma.communityPostReport.updateMany({
    where: { resolved_at: null },
    data: { resolved_at: inMs(-30 * SEED_DAY_MS) },
  })
  await prisma.communityCommentReport.updateMany({
    where: { resolved_at: null },
    data: { resolved_at: inMs(-30 * SEED_DAY_MS) },
  })
  await prisma.moderationSlaAlert.deleteMany()
  await prisma.moderationSlaMonitor.deleteMany()
  await prisma.$executeRaw`UPDATE "LookbookPost" SET status = 'published', published_at = COALESCE(published_at, ${NOW.toISOString()}::timestamp) WHERE status = 'pending_review'`
})

/** Pins every report of a post case to one due time. */
const dueAt = (postId: string, due: Date) =>
  prisma.communityPostReport.updateMany({
    where: { post_id: postId, resolved_at: null },
    data: { sla_due_at: due },
  })

/** A comment report's due time is tied to its routing time by a check constraint. */
const commentReportTimes = (
  commentId: string,
  due: Date,
  resolvedAt: Date | null = null
) => {
  const routed = new Date(due.getTime() - SEED_DAY_MS)
  return prisma.communityCommentReport.updateMany({
    where: { comment_id: commentId },
    data: {
      accepted_at: routed,
      routed_at: routed,
      sla_due_at: due,
      resolved_at: resolvedAt,
    },
  })
}

async function postCaseDue(remainingMs: number, reports = 1) {
  const seeded = await fx.postCase({ reports })
  await dueAt(seeded.postId, inMs(remainingMs))
  return seeded
}

const insertAlert = (overrides: Record<string, unknown> = {}) => {
  const id = randomUUID()
  return prisma.moderationSlaAlert.create({
    data: {
      id,
      dedupe_key: `sla:post:${id}:at_risk`,
      kind: 'at_risk',
      case_key: `post.${id}`,
      source: 'post',
      anchor_report_id: id,
      risk: 'low',
      sla_due_at: NOW,
      detected_at: NOW,
      next_attempt_at: NOW,
      ...overrides,
    },
  })
}

/** What the real queue route says, every page. */
async function queueItems() {
  const staff = boot.staff('moderator', { id: moderatorId })
  const items: {
    caseId: string
    slaState: string
    escalated: boolean
    slaDueAt: string
  }[] = []
  let cursor: string | null = null
  for (let page = 0; page < 50; page++) {
    const response = await staff.get(
      `/api/v1/moderation/cases?status=open&limit=50${cursor ? `&cursor=${cursor}` : ''}`
    )
    expect(response.status).toBe(200)
    const data: ReturnType<typeof moderationCasesResponseSchema.parse>['data'] =
      moderationCasesResponseSchema.parse(response.body).data
    items.push(...data.items)
    cursor = data.nextCursor
    if (!cursor) return items
  }
  throw new Error('queue walk did not end')
}

describe('I-R-HTTP: who can read', () => {
  it('answers 401 with no token, and with a bad token', async () => {
    await get().expect(401)
    await request(server).get(ROUTE).set('Authorization', 'Bearer nonsense').expect(401)
  })

  it.each(['guardian', 'teen'])(
    '%s gets 403 with the 6.10 body in every flag state, which hides the flag',
    async (role) => {
      const queueBody = (
        await request(server)
          .get('/api/v1/moderation/cases')
          .set('Authorization', auth(role))
          .expect(403)
      ).body as unknown
      flags.getFeatureFlag.mockClear()
      const open = (await get(role).expect(403)).body as unknown
      flagValues.set('moderation_sla_monitoring_enabled', false)
      flagValues.set('moderation_console_enabled', false)
      const closed = (await get(role).expect(403)).body as unknown
      flagValues.clear()
      expect(forbiddenHttpErrorSchema.parse(open)).toEqual(queueBody)
      expect(closed).toEqual(open)
      expect(flags.getFeatureFlag).not.toHaveBeenCalled()
    }
  )

  it.each([['moderation_sla_monitoring_enabled'], ['moderation_console_enabled']])(
    'a moderator gets 503 with no data while %s is off',
    async (flag) => {
      flagValues.set(flag, false)
      const response = await get('moderator').expect(503)
      flagValues.clear()
      expect(moderationSlaErrorSchema.parse(response.body)).toEqual({
        statusCode: 503,
        code: 'moderation_sla_disabled',
        message: expect.any(String) as string,
      })
    }
  )

  it('a thrown flag read closes the route with the same 503', async () => {
    failFlag('moderation_sla_monitoring_enabled')
    const response = await get('moderator').expect(503)
    expect((response.body as { code: string }).code).toBe('moderation_sla_disabled')
  })

  it('reads flags for the viewer', async () => {
    flags.getFeatureFlag.mockClear()
    await get('moderator').expect(200)
    const subjects = flags.getFeatureFlag.mock.calls.map(([, subject]) => subject)
    expect(subjects.length).toBeGreaterThanOrEqual(2)
    expect(new Set(subjects)).toEqual(new Set([moderatorId]))
  })

  it.each(['moderator', 'admin'])('%s gets 200 with a strict body', async (role) => {
    const data = await summary(role)
    expect(data.serverNow).toBe(NOW.toISOString())
  })
})

describe('I-R-HEADERS: the shipped module marks every answer private', () => {
  it('sets private, no-store and Vary Authorization on 200, 401, 403 and 503', async () => {
    const answers = [
      await get('moderator').expect(200),
      await get().expect(401),
      await get('guardian').expect(403),
    ]
    flagValues.set('moderation_console_enabled', false)
    answers.push(await get('moderator').expect(503))
    flagValues.clear()
    for (const answer of answers) {
      expect(answer.headers['cache-control']).toBe('private, no-store')
      expect(String(answer.headers.vary)).toMatch(/authorization/i)
    }
  })
})

describe('I-R-COUNT-PARITY: the dashboard agrees with the queue (TEA-09)', () => {
  it('gives the same state counts, boundary rows included, and the same oldest due time', async () => {
    await postCaseDue(SLA_AT_RISK_WINDOW_MS + 1)
    await postCaseDue(20 * HOUR)
    await postCaseDue(SLA_AT_RISK_WINDOW_MS)
    await postCaseDue(1, 3)
    await postCaseDue(0)
    await postCaseDue(-3 * HOUR)
    const comment = await fx.commentCase({ reports: 2 })
    await commentReportTimes(comment.commentId, inMs(HOUR))
    const items = await queueItems()
    const count = (state: string) =>
      items.filter((item) => item.slaState === state).length
    const { queue } = await summary()
    expect(queue).toMatchObject({
      onTrack: count('on_track'),
      atRisk: count('at_risk'),
      breached: count('breached'),
    })
    expect(queue).toMatchObject({ onTrack: 2, atRisk: 3, breached: 2 })
    expect(queue.oldestDueAt).toBe(inMs(-3 * HOUR).toISOString())
  })

  it('gives null for the oldest due time with an empty queue', async () => {
    const { queue } = await summary()
    expect(queue).toMatchObject({ onTrack: 0, atRisk: 0, breached: 0, escalated: 0 })
    expect(queue.oldestDueAt).toBeNull()
  })

  it('counts escalated as the queue marks it: terminal clears it, re-escalation restores it, orphans count', async () => {
    const admin = boot.staff('admin', await fx.operator())
    const standing = await fx.postCase({ reports: 2 })
    await admin.decide(standing.caseId, { action: 'escalate', reason: REASON })

    const cleared = await fx.postCase({ reports: 1 })
    await admin.decide(cleared.caseId, { action: 'escalate', reason: REASON })
    await admin.decide(cleared.caseId, { action: 'resolve', reason: REASON })
    const clearedReporter = await fx.member('late')
    await fx.postReport(cleared.postId, clearedReporter.id)

    const again = await fx.postCase({ reports: 1 })
    await admin.decide(again.caseId, { action: 'escalate', reason: REASON })
    await admin.decide(again.caseId, { action: 'resolve', reason: REASON })
    const againReporter = await fx.member('later')
    await fx.postReport(again.postId, againReporter.id)
    await admin.decide(again.caseId, { action: 'escalate', reason: REASON })

    const orphan = await fx.orphanPostCase()
    await admin.decide(orphan.caseId, { action: 'escalate', reason: REASON })

    const comment = await fx.commentCase({ reports: 1 })
    await admin.decide(comment.caseId, { action: 'escalate', reason: REASON })

    await fx.postCase({ reports: 1 })

    const items = await queueItems()
    const marked = items.filter((item) => item.escalated).map((item) => item.caseId)
    expect(marked.sort()).toEqual(
      [standing.caseId, again.caseId, orphan.caseId, comment.caseId].sort()
    )
    expect((await summary()).queue.escalated).toBe(marked.length)
  })
})

describe('I-R-NO-LOAD: a read changes nothing', () => {
  it('runs no write and leaves every table as it was', async () => {
    await postCaseDue(HOUR)
    await insertAlert()
    const logged = new PrismaClient({
      datasourceUrl: ctx.database.url,
      log: [{ emit: 'event', level: 'query' }],
    })
    const statements: string[] = []
    logged.$on('query', (event) => statements.push(event.query))
    const before = await checksumTables(prisma)
    const auditBefore = await prisma.auditLog.count()
    await new ModerationSlaService(logged, clock.now).summary()
    await logged.$disconnect()
    expect(statements.length).toBeGreaterThan(0)
    expect(
      statements.filter((statement) => /^\s*(INSERT|UPDATE|DELETE)\b/i.test(statement))
    ).toEqual([])
    expect(await checksumTables(prisma)).toEqual(before)
    expect(await prisma.auditLog.count()).toBe(auditBefore)
  })
})

describe('I-R-RESOLUTION: the seven-day window', () => {
  /** A resolved post report, with its time relative to its due time and to now. */
  async function resolved(resolvedAt: Date, due: Date) {
    const seeded = await fx.postCase({ reports: 1 })
    await prisma.communityPostReport.updateMany({
      where: { post_id: seeded.postId },
      data: { resolved_at: resolvedAt, sla_due_at: due },
    })
  }
  const windowCounts = async () => {
    const baseline = (await summary()).resolution
    return baseline
  }

  it('counts resolved_at equal to the due time as within SLA, and 1 ms later as late', async () => {
    const before = await windowCounts()
    const at = inMs(-HOUR)
    await resolved(at, at)
    await resolved(at, inMs(-HOUR - 1))
    const after = await windowCounts()
    expect(after.resolved - before.resolved).toBe(2)
    expect(after.withinSla - before.withinSla).toBe(1)
    expect(after.late - before.late).toBe(1)
    expect(after.windowDays).toBe(7)
    expect(after.late + after.withinSla).toBe(after.resolved)
  })

  it('pins the window edge on both sides', async () => {
    const before = await windowCounts()
    const edge = inMs(-7 * SEED_DAY_MS)
    await resolved(edge, edge)
    expect((await windowCounts()).resolved).toBe(before.resolved)
    await resolved(new Date(edge.getTime() + 1), edge)
    expect((await windowCounts()).resolved).toBe(before.resolved + 1)
  })

  it('counts comment reports too', async () => {
    const before = await windowCounts()
    const comment = await fx.commentCase({ reports: 1 })
    await commentReportTimes(comment.commentId, inMs(-HOUR), inMs(-HOUR))
    const after = await windowCounts()
    expect(after.resolved - before.resolved).toBe(1)
    expect(after.withinSla - before.withinSla).toBe(1)
  })

  it('an escalation changes no count', async () => {
    const seeded = await fx.postCase({ reports: 1 })
    const before = await windowCounts()
    const staff = boot.staff('moderator', await fx.operator())
    await staff.decide(seeded.caseId, { action: 'escalate', reason: REASON })
    expect(await windowCounts()).toEqual(before)
  })
})

describe('I-R-ALERT-COUNTS (TEA-09)', () => {
  it('counts every pending, pending with an error, and console-only', async () => {
    await insertAlert()
    await insertAlert({ last_error_code: 'http_5xx', attempts: 2 })
    await insertAlert({ last_error_code: 'interrupted', attempts: 1 })
    await insertAlert({ delivery: 'console_only' })
    await insertAlert({ delivery: 'delivered', attempts: 1 })
    await insertAlert({ delivery: 'superseded', last_error_code: 'http_5xx' })
    expect((await summary()).alerts).toEqual({ pending: 3, failing: 2, consoleOnly: 1 })
  })
})

describe('I-R-RECENT: the newest alerts', () => {
  it('returns the newest 50 by detection time, then id, both descending', async () => {
    for (let index = 0; index < 51; index++)
      await insertAlert({ detected_at: inMs(-index * MINUTE) })
    const tied = [
      await insertAlert({ detected_at: inMs(MINUTE) }),
      await insertAlert({ detected_at: inMs(MINUTE) }),
    ]
    const { recentAlerts } = await summary()
    expect(recentAlerts).toHaveLength(50)
    expect(recentAlerts.slice(0, 2).map((alert) => alert.id)).toEqual(
      tied
        .map((alert) => alert.id)
        .sort()
        .reverse()
    )
    expect(recentAlerts.map((alert) => alert.detectedAt)).toEqual(
      [...recentAlerts.map((alert) => alert.detectedAt)].sort().reverse()
    )
  })

  it('recomputes caseId after a re-key, and keeps the stored key when the anchor row is gone', async () => {
    const orphan = await fx.orphanPostCase()
    const moved = await insertAlert({
      case_key: 'post.gone',
      anchor_report_id: orphan.reportId,
    })
    const ghost = await insertAlert({
      case_key: 'post.stored',
      anchor_report_id: 'no-such-report',
    })
    const seeded = await fx.postCase({ reports: 1 })
    const live = await insertAlert({
      case_key: seeded.caseId,
      anchor_report_id: seeded.reportIds[0]!,
    })
    const comment = await fx.commentCase({ reports: 1 })
    const commentAlert = await insertAlert({
      source: 'comment',
      case_key: 'comment.stale',
      anchor_report_id: comment.reportIds[0]!,
    })
    const byId = new Map((await summary()).recentAlerts.map((alert) => [alert.id, alert]))
    expect(byId.get(moved.id)?.caseId).toBe(orphan.caseId)
    expect(byId.get(ghost.id)?.caseId).toBe('post.stored')
    expect(byId.get(live.id)?.caseId).toBe(seeded.caseId)
    expect(byId.get(commentAlert.id)?.caseId).toBe(comment.caseId)
  })

  it('holds the exact field set and maps each column', async () => {
    const row = await insertAlert({
      delivery: 'delivered',
      attempts: 3,
      delivered_at: NOW,
      risk: 'high',
      kind: 'breached',
      decision_id: 'hidden-decision',
    })
    const alert = (await summary()).recentAlerts.find((item) => item.id === row.id)
    expect(alert).toEqual({
      id: row.id,
      kind: 'breached',
      caseId: row.case_key,
      source: 'post',
      risk: 'high',
      slaDueAt: NOW.toISOString(),
      detectedAt: NOW.toISOString(),
      delivery: 'delivered',
      attempts: 3,
      lastErrorCode: null,
      deliveredAt: NOW.toISOString(),
    })
  })
})

describe('I-R-STALE: a dead worker reads as dead, from the API alone', () => {
  const stamp = (at: Date, channel = 'webhook') =>
    prisma.moderationSlaMonitor.create({
      data: { id: 'default', last_sweep_at: at, channel },
    })

  it('with no monitor row: stale, with nulls', async () => {
    expect((await summary()).monitor).toEqual({
      lastSweepAt: null,
      stale: true,
      channel: null,
    })
  })

  it.each([
    ['a fresh stamp', 0, false],
    ['exactly 5 minutes', -5 * MINUTE, false],
    ['5 minutes plus 1 ms', -5 * MINUTE - 1, true],
    ['an hour', -HOUR, true],
  ])('%s', async (_name, offset, stale) => {
    await stamp(inMs(offset), 'console')
    expect((await summary()).monitor).toEqual({
      lastSweepAt: inMs(offset).toISOString(),
      stale,
      channel: 'console',
    })
  })

  it('reads the route clock, so time passing alone turns it stale', async () => {
    await stamp(NOW)
    expect((await summary()).monitor.stale).toBe(false)
    clock.at(inMs(5 * MINUTE + 1))
    expect((await summary()).monitor.stale).toBe(true)
  })

  it('opening the route for one viewer leaves a stale monitor stale (D10)', async () => {
    flags.getFeatureFlag.mockImplementation((key: string, subject: string) =>
      Promise.resolve(subject === 'system:moderation-sla' ? key !== key : true)
    )
    try {
      expect((await summary()).monitor.stale).toBe(true)
    } finally {
      flags.getFeatureFlag.mockImplementation((key: string) =>
        Promise.resolve(flagValues.get(key) ?? true)
      )
    }
  })
})

describe('I-R-PENDING-AGE: the BH18 signal', () => {
  it('is null when nothing waits', async () => {
    expect((await summary()).screening.oldestPendingReviewAt).toBeNull()
  })

  it('is the earliest updated_at of pending_review posts, the column the stale sweep reads', async () => {
    const author = await fx.member('author')
    const older = await fx.post({ authorId: author.id, status: 'pending_review' })
    const newer = await fx.post({ authorId: author.id, status: 'pending_review' })
    const other = await fx.post({ authorId: author.id, status: 'published' })
    const set = (id: string, at: Date, createdAt: Date) =>
      prisma.$executeRaw`UPDATE "LookbookPost" SET updated_at = ${at.toISOString()}::timestamp, created_at = ${createdAt.toISOString()}::timestamp WHERE id = ${id}`
    await set(older.id, inMs(-2 * HOUR), inMs(-1 * MINUTE))
    await set(newer.id, inMs(-HOUR), inMs(-9 * HOUR))
    await set(other.id, inMs(-99 * HOUR), inMs(-99 * HOUR))
    expect((await summary()).screening.oldestPendingReviewAt).toBe(
      inMs(-2 * HOUR).toISOString()
    )
  })
})

describe('I-R-SANCTIONED: an operator under a sanction', () => {
  it('reads the route as the queue route allows', async () => {
    const operator = await fx.member('banned-operator')
    await fx.sanction(operator, { kind: 'permanent' })
    const call = (path: string) =>
      request(server).get(path).set('Authorization', auth('moderator', operator.id))
    const queue = await call('/api/v1/moderation/cases')
    const sla = await call(ROUTE)
    expect(sla.status).toBe(queue.status)
  })
})

describe('I-S-TZ-DST, route half: the same answer on a Chicago session', () => {
  it('matches UTC at every boundary', async () => {
    await postCaseDue(SLA_AT_RISK_WINDOW_MS + 1)
    await postCaseDue(SLA_AT_RISK_WINDOW_MS)
    await postCaseDue(0)
    const edge = inMs(-7 * SEED_DAY_MS)
    const inside = await fx.postCase({ reports: 1 })
    await prisma.communityPostReport.updateMany({
      where: { post_id: inside.postId },
      data: { resolved_at: new Date(edge.getTime() + 1), sla_due_at: edge },
    })
    await prisma.moderationSlaMonitor.create({
      data: { id: 'default', last_sweep_at: inMs(-5 * MINUTE), channel: 'webhook' },
    })
    const author = await fx.member('author')
    const pending = await fx.post({ authorId: author.id, status: 'pending_review' })
    await prisma.$executeRaw`UPDATE "LookbookPost" SET updated_at = ${inMs(-HOUR).toISOString()}::timestamp WHERE id = ${pending.id}`

    const session = (zone: string) => {
      const url = new URL(ctx.database.url)
      url.searchParams.set('options', `-c TimeZone=${zone}`)
      return new PrismaClient({ datasourceUrl: url.toString() })
    }
    const utc = session('UTC')
    const chicago = session('America/Chicago')
    try {
      const onUtc = await new ModerationSlaService(utc, clock.now).summary()
      const onChicago = await new ModerationSlaService(chicago, clock.now).summary()
      expect(onChicago).toEqual(onUtc)
      expect(onUtc.data.queue).toMatchObject({ onTrack: 1, atRisk: 1, breached: 1 })
      expect(onUtc.data.monitor.stale).toBe(false)
      expect(onUtc.data.screening.oldestPendingReviewAt).toBe(inMs(-HOUR).toISOString())
    } finally {
      await utc.$disconnect()
      await chicago.$disconnect()
    }
  })
})

describe('I-P-CANARY, route half: no private data in the response', () => {
  it('leaks no reason, content, alias or identity', async () => {
    const CANARY = 'CANARYPRIVATE'
    const author = await fx.member('author')
    const seeded = await fx.postCase({ reports: 2, author })
    await prisma.communityPostReport.updateMany({
      where: { post_id: seeded.postId },
      data: {
        details: `<b>${CANARY}</b>`,
        subject_alias: `alias-${CANARY}`,
        content_snapshot: { caption: CANARY, locale: 'en-US' },
      },
    })
    const reports = await prisma.communityPostReport.findMany({
      where: { post_id: seeded.postId },
    })
    await insertAlert({
      case_key: seeded.caseId,
      anchor_report_id: seeded.reportIds[0]!,
      decision_id: `decision-${CANARY}`,
    })
    const raw = JSON.stringify((await get('moderator').expect(200)).body)
    expect(raw).not.toContain(CANARY)
    expect(raw).not.toContain(author.id)
    for (const report of reports) expect(raw).not.toContain(report.reporter_id as string)
  })
})
