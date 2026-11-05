// Story 6.11 owner: the SQL of moderation decisions in `apps/api/src/modules/moderation/moderation-decisions.repository.ts`.
// A decision row is only ever inserted. Story 6.13 enforces that at the database boundary.
import { Injectable } from '@nestjs/common'
import type {
  CommunityComment,
  LookbookPost,
  ModerationDecision,
  Prisma,
} from '@prisma/client'
import type { ModerationCaseTargetState } from '@couture/api-client/contracts/http'
import type { ParsedCaseId } from './moderation-queue.repository.js'
import { inDecisionOrder, type DecisionHistoryRow } from './moderation-decision-rules.js'

type Tx = Prisma.TransactionClient

export interface DecisionCaseReport {
  id: string
  reporterId: string | null
  resolvedAt: Date | null
  subjectAlias: string | null
}

/** A case as a decision sees it. `reports` is every report of the case, oldest first. */
export interface DecisionCase {
  id: ParsedCaseId
  reports: DecisionCaseReport[]
  post: LookbookPost | null
  comment: CommunityComment | null
}

export const decisionCaseSubject = (loaded: DecisionCase): string | null =>
  loaded.post?.user_id ?? loaded.comment?.user_id ?? null

export const decisionCaseTargetStatus = (loaded: DecisionCase): string | null =>
  loaded.post?.status ?? loaded.comment?.status ?? null

export const decisionCaseOpenReportIds = (loaded: DecisionCase): string[] =>
  loaded.reports.filter((report) => report.resolvedAt === null).map(({ id }) => id)

/** The target as the availability rule reads it. An anonymized post, an erased comment or a null author is gone. */
export function decisionCaseTargetState(loaded: DecisionCase): ModerationCaseTargetState {
  if (loaded.post) {
    if (loaded.post.anonymized_at) return { state: 'erased' }
    return {
      state: 'live',
      kind: 'post',
      status: loaded.post.status,
      erasureRequested: loaded.post.erasure_requested_at !== null,
    }
  }
  if (loaded.comment) {
    if (loaded.comment.status === 'erased' || loaded.comment.user_id === null)
      return { state: 'erased' }
    return {
      state: 'live',
      kind: 'comment',
      status: loaded.comment.status,
      erasureRequested: false,
    }
  }
  return { state: 'erased' }
}

@Injectable()
export class ModerationDecisionsRepository {
  /** Every decision on one case runs under this lock, ahead of every privacy and engagement lock. */
  async lockCase(tx: Tx, caseKey: string): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('moderation_case:' || ${caseKey}))`
  }

  /**
   * Serializes an operator's eligibility with a ban on that operator: every decision and appeal
   * holds its own operator's lock shared, and a ban holds its subject's lock exclusive.
   * Taking them in id order means two operators banning each other queue instead of deadlocking,
   * and the second one re-reads the first one's sanction.
   */
  async lockSanctionEligibility(
    tx: Tx,
    operatorId: string,
    banSubjectId: string | null
  ): Promise<void> {
    const ids = [...new Set([operatorId, ...(banSubjectId ? [banSubjectId] : [])])].sort()
    for (const id of ids) {
      if (id === banSubjectId)
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('community_sanction:' || ${id}))`
      else
        await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(hashtext('community_sanction:' || ${id}))`
    }
  }

  findByMutation(
    tx: Tx,
    moderatorId: string,
    mutationId: string
  ): Promise<ModerationDecision | null> {
    return tx.moderationDecision.findUnique({
      where: {
        moderator_id_mutation_id: { moderator_id: moderatorId, mutation_id: mutationId },
      },
    })
  }

  /** Reads the case with the caller's connection, or null when no such case exists. */
  async loadCase(tx: Tx, id: ParsedCaseId): Promise<DecisionCase | null> {
    switch (id.kind) {
      case 'post':
      case 'orphan-post': {
        const rows = await tx.communityPostReport.findMany({
          where: id.kind === 'post' ? { post_id: id.ref } : { id: id.ref, post_id: null },
          orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
        })
        if (rows.length === 0) return null
        return {
          id,
          reports: rows.map((row) => ({
            id: row.id,
            reporterId: row.reporter_id,
            resolvedAt: row.resolved_at,
            subjectAlias: row.subject_alias,
          })),
          post:
            id.kind === 'post'
              ? await tx.lookbookPost.findUnique({ where: { id: id.ref } })
              : null,
          comment: null,
        }
      }
      case 'comment':
      case 'orphan-comment': {
        const rows = await tx.communityCommentReport.findMany({
          where:
            id.kind === 'comment'
              ? { comment_id: id.ref }
              : { id: id.ref, comment_id: null },
          orderBy: [{ accepted_at: 'asc' }, { id: 'asc' }],
        })
        if (rows.length === 0) return null
        return {
          id,
          reports: rows.map((row) => ({
            id: row.id,
            reporterId: row.reporter_id,
            resolvedAt: row.resolved_at,
            subjectAlias: null,
          })),
          post: null,
          comment:
            id.kind === 'comment'
              ? await tx.communityComment.findUnique({ where: { id: id.ref } })
              : null,
        }
      }
    }
  }

  async decisionHistory(
    tx: Tx,
    caseKey: string,
    reportIds: readonly string[]
  ): Promise<DecisionHistoryRow[]> {
    const rows = await tx.moderationDecision.findMany({
      where: {
        OR: [
          { case_key: caseKey },
          ...(reportIds.length > 0 ? [{ report_ids: { hasSome: [...reportIds] } }] : []),
        ],
      },
      select: {
        case_key: true,
        sequence: true,
        is_terminal: true,
        action: true,
        decided_at: true,
      },
    })
    return rows.map((row) => ({
      caseKey: row.case_key,
      sequence: row.sequence,
      isTerminal: row.is_terminal,
      action: row.action,
      decidedAt: row.decided_at,
    }))
  }

  /** The newest sequence of a case key, for a step that does not read the rest of the history. */
  async newestSequence(tx: Tx, caseKey: string): Promise<number> {
    const newest = await tx.moderationDecision.findFirst({
      where: { case_key: caseKey },
      orderBy: { sequence: 'desc' },
      select: { sequence: true },
    })
    return newest?.sequence ?? 0
  }

  /** Newest first. The head is the sanction the standing section shows. */
  sanctionsOf(tx: Tx, member: string) {
    return tx.communitySanction.findMany({
      where: { user_id: member },
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
    })
  }

  async subjectAlias(tx: Tx, loaded: DecisionCase): Promise<string | null> {
    const stored = loaded.reports.find((report) => report.subjectAlias)?.subjectAlias
    if (stored) return stored
    const subject = decisionCaseSubject(loaded)
    if (!subject) return null
    const row = await tx.communityAlias.findUnique({
      where: { user_id: subject },
      select: { alias: true },
    })
    return row?.alias ?? null
  }

  insertDecision(tx: Tx, data: Prisma.ModerationDecisionUncheckedCreateInput) {
    return tx.moderationDecision.create({ data })
  }
}

/** The case keys of a queue page that are escalated now. An orphan key also matches by its report id. */
export async function escalatedCaseKeys(
  tx: Tx,
  caseKeys: readonly string[]
): Promise<ReadonlySet<string>> {
  if (caseKeys.length === 0) return new Set()
  const orphanReports = new Map(
    caseKeys
      .filter((key) => key.startsWith('orphan-'))
      .map((key) => [key.slice(key.indexOf('.') + 1), key])
  )
  const rows = await tx.moderationDecision.findMany({
    where: {
      OR: [
        { case_key: { in: [...caseKeys] } },
        ...(orphanReports.size > 0
          ? [{ report_ids: { hasSome: [...orphanReports.keys()] } }]
          : []),
      ],
      action: {
        in: ['resolve', 'release', 'takedown', 'ban', 'escalate'],
      },
    },
    select: {
      case_key: true,
      action: true,
      report_ids: true,
      sequence: true,
      decided_at: true,
    },
  })
  const escalated = new Set<string>()
  const ordered = inDecisionOrder(
    rows.map((row) => ({ ...row, caseKey: row.case_key, decidedAt: row.decided_at }))
  )
  for (const row of ordered) {
    const keys = new Set<string>()
    if (caseKeys.includes(row.case_key)) keys.add(row.case_key)
    for (const report of row.report_ids) {
      const orphan = orphanReports.get(report)
      if (orphan) keys.add(orphan)
    }
    for (const key of keys) {
      if (row.action === 'escalate') escalated.add(key)
      else escalated.delete(key)
    }
  }
  return escalated
}

/** The prior actions of an orphan post case, whose events lost their `post_id`. */
export function orphanDecisions(tx: Tx, reportIds: readonly string[]) {
  return tx.moderationDecision.findMany({
    where: { report_ids: { hasSome: [...reportIds] } },
    orderBy: [{ decided_at: 'asc' }, { sequence: 'asc' }],
    select: { action: true, reason: true, decided_at: true },
  })
}
