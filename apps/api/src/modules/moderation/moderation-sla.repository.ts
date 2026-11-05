// Story 6.12 owner: the SQL of the SLA monitor in `apps/api/src/modules/moderation/moderation-sla.repository.ts`.
// Every instant in raw SQL binds as ISO text with a `::timestamp` cast: a JS Date binds as
// timestamptz and shifts a `timestamp` comparison by the session offset. No database clock is used.
import { Prisma, type PrismaClient } from '@prisma/client'
import {
  MODERATION_RISK_BY_RANK,
  MODERATION_SLA_RECENT_ALERTS_LIMIT,
  MODERATION_SLA_RESOLUTION_WINDOW_DAYS,
  type ModerationCaseRisk,
  type ModerationCaseSource,
  type ModerationSlaAlertKind,
  type ModerationSlaChannel,
  type ModerationSlaDeliveryState,
  type ModerationSlaFailureCode,
} from '@couture/api-client/contracts/http'
import { listModerationCases } from './moderation-queue.repository.js'
import {
  moderationSlaAlertRelevance,
  moderationSlaBackoffMs,
  moderationSlaDedupeKey,
} from './moderation-sla.rules.js'

type Tx = Prisma.TransactionClient

const DAY_MS = 24 * 60 * 60 * 1000

/** Longer than one 5-second send, so a live attempt keeps its row. */
export const MODERATION_SLA_LEASE_MS = 60_000
/** At this many failed attempts a delivery failure escalates, once. */
export const MODERATION_SLA_ESCALATE_AT_ATTEMPT = 3
const OWED_ESCALATION_BATCH = 100

export const moderationSlaFailureJobId = (alertId: string) =>
  `moderation_sla_delivery__${alertId}`

export interface ModerationSlaAlertInsert {
  kind: ModerationSlaAlertKind
  caseKey: string
  source: ModerationCaseSource
  anchorReportId: string
  risk: ModerationCaseRisk
  slaDueAt: Date
  decisionId?: string | null
  detectedAt: Date
}

export interface ClaimedModerationSlaAlert {
  id: string
  kind: ModerationSlaAlertKind
  /** The case its anchor report belongs to now, so an alert sent after erasure links a live case. */
  caseId: string
  source: ModerationCaseSource
  anchorReportId: string
  risk: ModerationCaseRisk
  slaDueAt: Date
  detectedAt: Date
  /** The value this claim wrote, which fences the outcome write. */
  attempts: number
  failureEscalatedAt: Date | null
}

export interface OwedModerationSlaEscalation {
  id: string
  kind: ModerationSlaAlertKind
  attempts: number
  code: ModerationSlaFailureCode
}

export type ModerationSlaClaim =
  | {
      disposition: 'claimed'
      alert: ClaimedModerationSlaAlert
      interrupted: boolean
      firstProcessing: boolean
    }
  | {
      disposition: 'superseded' | 'console_only'
      alert: ClaimedModerationSlaAlert
      firstProcessing: boolean
    }

function alertInsertData(input: ModerationSlaAlertInsert) {
  return {
    dedupe_key: moderationSlaDedupeKey({
      kind: input.kind,
      source: input.source,
      anchorReportId: input.anchorReportId,
      decisionId: input.decisionId ?? null,
    }),
    kind: input.kind,
    case_key: input.caseKey,
    source: input.source,
    anchor_report_id: input.anchorReportId,
    risk: input.risk,
    sla_due_at: input.slaDueAt,
    decision_id: input.decisionId ?? null,
    detected_at: input.detectedAt,
    next_attempt_at: input.detectedAt,
  }
}

/** The case a report belongs to now. A report whose target was erased is its own orphan case. */
const postReportCaseId = (report: { id: string; post_id: string | null }) =>
  report.post_id ? `post.${report.post_id}` : `orphan-post.${report.id}`
const commentReportCaseId = (report: { id: string; comment_id: string | null }) =>
  report.comment_id ? `comment.${report.comment_id}` : `orphan-comment.${report.id}`

/** The anchor report as it stands now, or null when the row is gone. */
async function readAnchor(
  tx: Tx,
  source: string,
  reportId: string
): Promise<{ resolved: boolean; caseId: string } | null> {
  if (source === 'post') {
    const report = await tx.communityPostReport.findUnique({
      where: { id: reportId },
      select: { id: true, post_id: true, resolved_at: true },
    })
    return report
      ? { resolved: report.resolved_at !== null, caseId: postReportCaseId(report) }
      : null
  }
  const report = await tx.communityCommentReport.findUnique({
    where: { id: reportId },
    select: { id: true, comment_id: true, resolved_at: true },
  })
  return report
    ? { resolved: report.resolved_at !== null, caseId: commentReportCaseId(report) }
    : null
}

/**
 * Story 6.12 D7: the escalated alert of one decision, inside that decision's transaction, read
 * through the queue's own SQL so its anchor, due time and risk agree with the case as locked.
 */
export async function insertEscalatedAlert(
  tx: Tx,
  input: { decisionId: string; caseId: string; at: Date }
): Promise<void> {
  const [row] = await listModerationCases(
    tx,
    { status: 'open', limit: 1 },
    input.at,
    null,
    { caseKey: input.caseId }
  )
  if (!row?.anchorReportId) {
    throw new Error('An escalated case has no open report to anchor its alert')
  }
  await tx.moderationSlaAlert.createMany({
    data: [
      alertInsertData({
        kind: 'escalated',
        caseKey: row.caseKey,
        source: row.source,
        anchorReportId: row.anchorReportId,
        risk: MODERATION_RISK_BY_RANK[row.riskRank] as ModerationCaseRisk,
        slaDueAt: row.dueAt,
        decisionId: input.decisionId,
        detectedAt: input.at,
      }),
    ],
    skipDuplicates: true,
  })
}

export class ModerationSlaRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /** One row per key. True only when this call inserted it. */
  async insertAlert(input: ModerationSlaAlertInsert): Promise<boolean> {
    const result = await this.prisma.moderationSlaAlert.createMany({
      data: [alertInsertData(input)],
      skipDuplicates: true,
    })
    return result.count === 1
  }

  async existingDedupeKeys(keys: readonly string[]): Promise<ReadonlySet<string>> {
    if (keys.length === 0) return new Set()
    const rows = await this.prisma.moderationSlaAlert.findMany({
      where: { dedupe_key: { in: [...keys] } },
      select: { dedupe_key: true },
    })
    return new Set(rows.map((row) => row.dedupe_key))
  }

  /**
   * Takes the next due row in one short transaction. No transaction ever spans the POST. A lease
   * that expired means a worker died mid-attempt, which is recorded as `interrupted`.
   */
  claimNext(input: {
    /** A fresh clock read: lease and due checks follow real elapsed time. */
    claimNow: Date
    /** The sweep's one clock read: relevance sees the same instant as detection. */
    sweepNow: Date
    channel: ModerationSlaChannel
  }): Promise<ModerationSlaClaim | null> {
    const nowText = input.claimNow.toISOString()
    return this.prisma.$transaction(async (tx) => {
      const [row] = await tx.$queryRaw<
        {
          id: string
          kind: ModerationSlaAlertKind
          case_key: string
          source: ModerationCaseSource
          anchor_report_id: string
          risk: ModerationCaseRisk
          sla_due_at: Date
          detected_at: Date
          attempts: number
          lease_until: Date | null
          failure_escalated_at: Date | null
        }[]
      >(Prisma.sql`
        SELECT id, kind::text AS kind, case_key, source, anchor_report_id, risk, sla_due_at,
          detected_at, attempts, lease_until, failure_escalated_at
        FROM "ModerationSlaAlert"
        WHERE delivery = 'pending'
          AND next_attempt_at <= ${nowText}::timestamp
          AND (lease_until IS NULL OR lease_until < ${nowText}::timestamp)
        ORDER BY next_attempt_at ASC, id ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      `)
      if (!row) return null

      const anchor = await readAnchor(tx, row.source, row.anchor_report_id)
      const alert: ClaimedModerationSlaAlert = {
        id: row.id,
        kind: row.kind,
        caseId: anchor?.caseId ?? row.case_key,
        source: row.source,
        anchorReportId: row.anchor_report_id,
        risk: row.risk,
        slaDueAt: row.sla_due_at,
        detectedAt: row.detected_at,
        attempts: row.attempts,
        failureEscalatedAt: row.failure_escalated_at,
      }
      const firstProcessing = row.attempts === 0

      const relevance = moderationSlaAlertRelevance({
        kind: row.kind,
        slaDueAt: row.sla_due_at,
        anchorResolved: anchor ? anchor.resolved : null,
        now: input.sweepNow,
      })
      const terminal =
        relevance === 'supersede'
          ? 'superseded'
          : input.channel === 'console'
            ? 'console_only'
            : null
      if (terminal) {
        await tx.moderationSlaAlert.update({
          where: { id: row.id },
          data: { delivery: terminal, lease_until: null },
        })
        return { disposition: terminal, alert, firstProcessing }
      }

      const interrupted = row.lease_until !== null
      const attempts = row.attempts + 1
      await tx.moderationSlaAlert.update({
        where: { id: row.id },
        data: {
          attempts,
          lease_until: new Date(input.claimNow.getTime() + MODERATION_SLA_LEASE_MS),
          ...(interrupted ? { last_error_code: 'interrupted' } : {}),
          // A crash loop reaches no failure write, so this claim owes it before it sends (TEA-04).
          ...(interrupted &&
          attempts >= MODERATION_SLA_ESCALATE_AT_ATTEMPT &&
          !row.failure_escalated_at
            ? { failure_owed_code: 'interrupted' }
            : {}),
        },
      })
      return {
        disposition: 'claimed',
        alert: { ...alert, attempts },
        interrupted,
        firstProcessing,
      }
    })
  }

  /** Fenced on the claimed attempts: a worker that lost its lease cannot overwrite a later one. */
  async recordDelivered(alert: ClaimedModerationSlaAlert, now: Date): Promise<boolean> {
    const result = await this.prisma.moderationSlaAlert.updateMany({
      where: { id: alert.id, attempts: alert.attempts, delivery: 'pending' },
      data: {
        delivery: 'delivered',
        delivered_at: now,
        lease_until: null,
        last_error_code: null,
      },
    })
    return result.count === 1
  }

  async recordFailedAttempt(
    alert: ClaimedModerationSlaAlert,
    code: ModerationSlaFailureCode,
    now: Date
  ): Promise<boolean> {
    const result = await this.prisma.moderationSlaAlert.updateMany({
      where: { id: alert.id, attempts: alert.attempts, delivery: 'pending' },
      data: {
        last_error_code: code,
        lease_until: null,
        next_attempt_at: new Date(now.getTime() + moderationSlaBackoffMs(alert.attempts)),
        // In this one write, so a crash right after it still owes the escalation.
        ...(alert.attempts >= MODERATION_SLA_ESCALATE_AT_ATTEMPT &&
        !alert.failureEscalatedAt
          ? { failure_owed_code: code }
          : {}),
      },
    })
    return result.count === 1
  }

  /** Every escalation still owed, whatever the alert's delivery state has become since. */
  async owedEscalations(): Promise<OwedModerationSlaEscalation[]> {
    const rows = await this.prisma.moderationSlaAlert.findMany({
      where: { failure_owed_code: { not: null }, failure_escalated_at: null },
      orderBy: { id: 'asc' },
      take: OWED_ESCALATION_BATCH,
      select: { id: true, kind: true, attempts: true, failure_owed_code: true },
    })
    return rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      attempts: row.attempts,
      code: row.failure_owed_code as ModerationSlaFailureCode,
    }))
  }

  /**
   * Stamps the alert and writes its one `JobFailure` row together, the established operator record
   * (`recordStallAlert`). False when another worker already did. A thrown write leaves the stamp
   * null, so the next repair pass tries again.
   */
  escalateFailure(
    alert: Pick<OwedModerationSlaEscalation, 'id' | 'kind' | 'attempts'>,
    code: ModerationSlaFailureCode,
    now: Date
  ): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const stamped = await tx.moderationSlaAlert.updateMany({
        where: { id: alert.id, failure_escalated_at: null },
        data: { failure_escalated_at: now },
      })
      if (stamped.count !== 1) return false
      await tx.jobFailure.create({
        data: {
          queue_name: 'maintenance',
          job_id: moderationSlaFailureJobId(alert.id),
          job_data: { alertId: alert.id, kind: alert.kind, code },
          error_message: `Operations alert delivery failed: ${code}`,
          attempts: alert.attempts,
        },
      })
      return true
    })
  }

  stampMonitor(now: Date, channel: ModerationSlaChannel) {
    return this.prisma.moderationSlaMonitor.upsert({
      where: { id: 'default' },
      create: { id: 'default', last_sweep_at: now, channel },
      update: { last_sweep_at: now, channel },
    })
  }

  async oldestPendingReviewAt(): Promise<Date | null> {
    const result = await this.prisma.lookbookPost.aggregate({
      where: { status: 'pending_review' },
      _min: { updated_at: true },
    })
    return result._min.updated_at
  }

  readMonitor() {
    return this.prisma.moderationSlaMonitor.findUnique({ where: { id: 'default' } })
  }

  /** `failing` is pending rows with a recorded error, which delivery clears. */
  async alertCounts(): Promise<{
    pending: number
    failing: number
    consoleOnly: number
  }> {
    const [row] = await this.prisma.$queryRaw<
      { pending: number; failing: number; console_only: number }[]
    >(Prisma.sql`
      SELECT
        count(*) FILTER (WHERE delivery = 'pending')::int AS pending,
        count(*) FILTER (WHERE delivery = 'pending' AND last_error_code IS NOT NULL)::int AS failing,
        count(*) FILTER (WHERE delivery = 'console_only')::int AS console_only
      FROM "ModerationSlaAlert"
    `)
    return {
      pending: row?.pending ?? 0,
      failing: row?.failing ?? 0,
      consoleOnly: row?.console_only ?? 0,
    }
  }

  /** Reports resolved inside the window. An escalation stamps no `resolved_at`, so it counts for nothing. */
  async resolutionCounts(now: Date): Promise<{
    resolved: number
    withinSla: number
    late: number
  }> {
    const since = new Date(
      now.getTime() - MODERATION_SLA_RESOLUTION_WINDOW_DAYS * DAY_MS
    ).toISOString()
    const [row] = await this.prisma.$queryRaw<{ resolved: number; within_sla: number }[]>(
      Prisma.sql`
        SELECT count(*)::int AS resolved,
          count(*) FILTER (WHERE resolved_at <= sla_due_at)::int AS within_sla
        FROM (
          SELECT resolved_at, sla_due_at FROM "CommunityPostReport"
          WHERE resolved_at > ${since}::timestamp
          UNION ALL
          SELECT resolved_at, sla_due_at FROM "CommunityCommentReport"
          WHERE resolved_at > ${since}::timestamp
        ) AS resolved_reports
      `
    )
    const resolved = row?.resolved ?? 0
    const withinSla = row?.within_sla ?? 0
    return { resolved, withinSla, late: resolved - withinSla }
  }

  /** The newest alerts, each linked to the case its anchor report belongs to now. */
  async recentAlerts(): Promise<
    {
      id: string
      kind: ModerationSlaAlertKind
      caseId: string
      source: ModerationCaseSource
      risk: ModerationCaseRisk
      slaDueAt: Date
      detectedAt: Date
      delivery: ModerationSlaDeliveryState
      attempts: number
      lastErrorCode: ModerationSlaFailureCode | null
      deliveredAt: Date | null
    }[]
  > {
    const rows = await this.prisma.moderationSlaAlert.findMany({
      orderBy: [{ detected_at: 'desc' }, { id: 'desc' }],
      take: MODERATION_SLA_RECENT_ALERTS_LIMIT,
    })
    const anchors = (source: string) =>
      rows.filter((row) => row.source === source).map((row) => row.anchor_report_id)
    const [posts, comments] = await Promise.all([
      this.prisma.communityPostReport.findMany({
        where: { id: { in: anchors('post') } },
        select: { id: true, post_id: true },
      }),
      this.prisma.communityCommentReport.findMany({
        where: { id: { in: anchors('comment') } },
        select: { id: true, comment_id: true },
      }),
    ])
    const postCase = new Map(posts.map((r) => [r.id, postReportCaseId(r)]))
    const commentCase = new Map(comments.map((r) => [r.id, commentReportCaseId(r)]))
    return rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      caseId:
        (row.source === 'post' ? postCase : commentCase).get(row.anchor_report_id) ??
        row.case_key,
      source: row.source as ModerationCaseSource,
      risk: row.risk as ModerationCaseRisk,
      slaDueAt: row.sla_due_at,
      detectedAt: row.detected_at,
      delivery: row.delivery,
      attempts: row.attempts,
      lastErrorCode: row.last_error_code as ModerationSlaFailureCode | null,
      deliveredAt: row.delivered_at,
    }))
  }
}
