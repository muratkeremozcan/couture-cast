// Story 6.13 owner: the reads behind an evidence bundle in `apps/api/src/modules/moderation/moderation-history.repository.ts`.
// Each read names its columns, so reporter ids, details, snapshots and paths stay out of memory where they are not needed.
import { Injectable } from '@nestjs/common'
import type { ModerationDecision, Prisma } from '@prisma/client'
import {
  moderationEvidenceAuditEventTypes,
  type ModerationCaseSource,
  type ModerationEvidenceAlert,
  type ModerationEvidenceDecision,
  type ModerationEvidenceReport,
} from '@couture/api-client/contracts/http'
import { closeOverEvidence } from './moderation-case-conflict.js'
import {
  mapModerationAuditEvent,
  mapModerationReason,
  moderationReporterState,
  type ModerationHistoryAuditRow,
} from './moderation-history.rules.js'

type Tx = Prisma.TransactionClient

const DECISION_ORDER = [{ decided_at: 'asc' }, { id: 'asc' }] as const

export function mapEvidenceDecision(row: ModerationDecision): ModerationEvidenceDecision {
  return {
    decisionId: row.id,
    caseId: row.case_key,
    sequence: row.sequence,
    source: row.source as ModerationCaseSource,
    action: row.action,
    ...mapModerationReason(row.reason),
    moderatorId: row.moderator_id,
    moderatorRole: row.moderator_role,
    subjectAlias: row.subject_alias,
    isTerminal: row.is_terminal,
    decidedAt: row.decided_at.toISOString(),
    anonymizedAt: row.anonymized_at?.toISOString() ?? null,
  }
}

@Injectable()
export class ModerationHistoryRepository {
  countDecisionsInRange(tx: Tx, from: Date, to: Date): Promise<number> {
    return tx.moderationDecision.count({
      where: { decided_at: { gte: from, lte: to } },
    })
  }

  decisionsInRange(tx: Tx, from: Date, to: Date): Promise<ModerationDecision[]> {
    return tx.moderationDecision.findMany({
      where: { decided_at: { gte: from, lte: to } },
      orderBy: [...DECISION_ORDER],
    })
  }

  /** A re-keyed case is reached through its report ids, the same way `firstDecisionAt` is. */
  decisionsOfCase(
    tx: Tx,
    caseKey: string,
    reportIds: readonly string[]
  ): Promise<ModerationDecision[]> {
    return tx.moderationDecision.findMany({
      where: {
        OR: [
          { case_key: caseKey },
          ...(reportIds.length > 0 ? [{ report_ids: { hasSome: [...reportIds] } }] : []),
        ],
      },
      orderBy: [...DECISION_ORDER],
    })
  }

  /**
   * Which of these decisions the viewer may not see, for the range export's conflict rule. Not returned to
   * anyone. It starts from everything the viewer filed, wrote or is named on and closes over all evidence,
   * because the only link to the viewer can sit outside the period.
   */
  async conflictingDecisionIds(
    tx: Tx,
    viewerId: string,
    decisions: readonly ModerationDecision[]
  ): Promise<ReadonlySet<string>> {
    const postIds = decisions.flatMap((row) => (row.post_id ? [row.post_id] : []))
    const commentIds = decisions.flatMap((row) =>
      row.comment_id ? [row.comment_id] : []
    )
    const [postReports, commentReports, posts, comments, named] = await Promise.all([
      tx.communityPostReport.findMany({
        where: { reporter_id: viewerId },
        select: { id: true },
      }),
      tx.communityCommentReport.findMany({
        where: { OR: [{ reporter_id: viewerId }, { comment_author_id: viewerId }] },
        select: { id: true },
      }),
      tx.lookbookPost.findMany({
        where: { id: { in: postIds }, user_id: viewerId },
        select: { id: true },
      }),
      tx.communityComment.findMany({
        where: { id: { in: commentIds }, user_id: viewerId },
        select: { id: true },
      }),
      tx.moderationDecision.findMany({
        where: { subject_user_id: viewerId },
        select: { case_key: true },
      }),
    ])
    const posted = new Set(posts.map(({ id }) => id))
    const commented = new Set(comments.map(({ id }) => id))
    const { cases } = await closeOverEvidence(tx, {
      reports: [...postReports, ...commentReports].map(({ id }) => id),
      cases: [
        ...named.map(({ case_key }) => case_key),
        ...decisions
          .filter(
            (row) =>
              (row.post_id !== null && posted.has(row.post_id)) ||
              (row.comment_id !== null && commented.has(row.comment_id))
          )
          .map((row) => row.case_key),
      ],
    })
    return new Set(
      decisions.filter((row) => cases.has(row.case_key)).map((row) => row.id)
    )
  }

  async reports(
    tx: Tx,
    reportIds: readonly string[]
  ): Promise<ModerationEvidenceReport[]> {
    const ids = [...new Set(reportIds)]
    if (ids.length === 0) return []
    const [posts, comments] = await Promise.all([
      tx.communityPostReport.findMany({
        where: { id: { in: ids } },
        select: {
          id: true,
          reason: true,
          origin: true,
          reporter_id: true,
          created_at: true,
          sla_due_at: true,
          resolved_at: true,
        },
        orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
      }),
      tx.communityCommentReport.findMany({
        where: { id: { in: ids } },
        select: {
          id: true,
          reason: true,
          origin: true,
          reporter_id: true,
          accepted_at: true,
          sla_due_at: true,
          resolved_at: true,
        },
        orderBy: [{ accepted_at: 'asc' }, { id: 'asc' }],
      }),
    ])
    return [
      ...posts.map((row) => ({
        reportId: row.id,
        source: 'post' as const,
        reason: row.reason,
        origin: row.origin,
        reporterState: moderationReporterState(row),
        acceptedAt: row.created_at.toISOString(),
        dueAt: row.sla_due_at.toISOString(),
        resolvedAt: row.resolved_at?.toISOString() ?? null,
      })),
      ...comments.map((row) => ({
        reportId: row.id,
        source: 'comment' as const,
        reason: row.reason,
        origin: row.origin,
        reporterState: moderationReporterState(row),
        acceptedAt: row.accepted_at.toISOString(),
        dueAt: row.sla_due_at.toISOString(),
        resolvedAt: row.resolved_at?.toISOString() ?? null,
      })),
    ]
  }

  async alerts(
    tx: Tx,
    decisionIds: readonly string[],
    reportIds: readonly string[]
  ): Promise<ModerationEvidenceAlert[]> {
    const rows = await tx.moderationSlaAlert.findMany({
      where: {
        OR: [
          { decision_id: { in: [...decisionIds] } },
          { anchor_report_id: { in: [...reportIds] } },
        ],
      },
      select: {
        kind: true,
        delivery: true,
        sla_due_at: true,
        detected_at: true,
        delivered_at: true,
      },
      orderBy: [{ detected_at: 'asc' }, { id: 'asc' }],
    })
    return rows.map((row) => ({
      kind: row.kind,
      delivery: row.delivery,
      slaDueAt: row.sla_due_at.toISOString(),
      detectedAt: row.detected_at.toISOString(),
      deliveredAt: row.delivered_at?.toISOString() ?? null,
    }))
  }

  /** Matched on decision and case ids, because `caseId` in a row keeps the id it had before a re-key. */
  async auditEvents(tx: Tx, decisionIds: readonly string[], caseIds: readonly string[]) {
    const rows = await tx.$queryRaw<ModerationHistoryAuditRow[]>`
      SELECT
        a.event_type,
        a."timestamp",
        a.user_id,
        a.event_data->>'role' AS role,
        a.event_data->>'action' AS action,
        EXISTS (
          SELECT 1 FROM "ModerationErasureRequest" r WHERE r.member_id = a.user_id
        ) AS actor_erased
      FROM "AuditLog" a
      WHERE a.event_type = ANY(${[...moderationEvidenceAuditEventTypes]}::text[])
        AND (
          a.event_data->>'decisionId' = ANY(${[...decisionIds]}::text[])
          OR a.event_data->>'caseId' = ANY(${[...caseIds]}::text[])
        )
      ORDER BY a."timestamp", a.id`
    return rows.map(mapModerationAuditEvent)
  }
}
