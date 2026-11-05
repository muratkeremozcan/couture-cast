// Story 6.10 owner: the read-only SQL of the moderator queue and case detail in `apps/api/src/modules/moderation/moderation-queue.repository.ts`.
// One query path groups the two report tables into cases, orders them and pages them with a keyset.
// Nothing here writes a report, a post, a comment or a member. The only write is the D10 audit row.
import { Inject, Injectable } from '@nestjs/common'
import { Prisma, PrismaClient } from '@prisma/client'
import {
  COMMUNITY_BAN_MARKER_PREFIX,
  COMMUNITY_MODERATION_REASON_CATEGORY,
  MODERATION_OPERATOR_TAKEDOWN_REASON,
  MODERATION_REASON_RISK_RANK,
  MODERATION_REPORTER_BUMP_THRESHOLD,
  MODERATION_RISK_BY_RANK,
  SLA_AT_RISK_WINDOW_MS,
  type ModerationCaseSlaState,
  type ModerationCaseSource,
  type ModerationCasesQuery,
} from '@couture/api-client/contracts/http'
import { escalatedCaseKeys, orphanDecisions } from './moderation-decisions.repository.js'
import type { ModerationQueuePosition } from './moderation-queue-cursor.js'

export { MODERATION_QUEUE_READ_TABLES } from './moderation-queue-tables.js'

/** The actions only the screening processor writes to `CommunityCommentAudit`. */
const SCREENING_AUDIT_ACTIONS: readonly string[] = [
  'held_for_review',
  'blocked',
  'screening_failed',
]

export type ParsedCaseId =
  | { kind: 'post'; source: 'post'; ref: string }
  | { kind: 'orphan-post'; source: 'post'; ref: string }
  | { kind: 'comment'; source: 'comment'; ref: string }
  | { kind: 'orphan-comment'; source: 'comment'; ref: string }

/** Returns null for anything that is not a well-formed case id. */
export function parseModerationCaseId(caseId: string): ParsedCaseId | null {
  const match =
    /^(post|comment|orphan-post|orphan-comment)\.([A-Za-z0-9_-]{1,128})$/.exec(caseId)
  if (!match) return null
  const kind = match[1] as ParsedCaseId['kind']
  const ref = match[2] as string
  return { kind, source: kind.endsWith('post') ? 'post' : 'comment', ref } as ParsedCaseId
}

export interface CaseRow {
  caseKey: string
  source: ModerationCaseSource
  reportCount: number
  reasons: string[]
  riskRank: number
  hasFinding: boolean
  openCount: number
  dueAt: Date
  dueKey: string
  acceptedAt: Date
  locale: string | null
  excerpt: string | null
  slaState: ModerationCaseSlaState
  /** The open report with the earliest due time, ties by id. Null when no report is open. */
  anchorReportId: string | null
}

/** The sla_state buckets of the open cases, which the monitor and its route report. */
export interface CaseStateCounts {
  onTrack: number
  atRisk: number
  breached: number
  escalated: number
  oldestDueAt: Date | null
}

export interface ReportRecord {
  id: string
  reporterId: string | null
  reason: string
  details: string | null
  snapshot: unknown
  subjectAlias: string | null
  imagePath: string | null
  dueAt: Date
  acceptedAt: Date
  resolvedAt: Date | null
  /** `screening` when the screener filed it, so a null reporter is not read as erased. */
  origin: 'member' | 'screening'
}

export interface LoadedCase {
  kind: ParsedCaseId['kind']
  source: ModerationCaseSource
  /** Every report of the target, oldest first. */
  reports: ReportRecord[]
  post: {
    userId: string
    status: string
    publishedAt: Date | null
    imagePath: string | null
    anonymizedAt: Date | null
    objectsPurgedAt: Date | null
    moderationReason: string | null
    engineVersion: string | null
    locale: string | null
  } | null
  comment: {
    userId: string | null
    status: string
    publishedAt: Date | null
    screeningReason: string | null
    screeningVersion: string | null
    locale: string
    parentBody: string | null
  } | null
  /** `userId` to alias for the reporters and the author. A member with no row is absent. */
  aliases: ReadonlyMap<string, string>
  priorActions: {
    actorKind: 'screening' | 'reporter' | 'operator'
    action: string
    reason: string | null
    occurredAt: Date
  }[]
}

// The SQL fragments build at call time, so importing this module never touches the Prisma namespace.
// A spec that mocks `@prisma/client` with only the client class can still load the whole app.
const reasonRankSql = () =>
  Prisma.raw(
    `CASE reason ${Object.entries(MODERATION_REASON_RISK_RANK)
      .map(([reason, rank]) => `WHEN '${reason}' THEN ${rank}`)
      .join(' ')} ELSE 0 END`
  )
const KNOWN_FINDING_CODES = Object.keys(COMMUNITY_MODERATION_REASON_CATEGORY)
const MAX_RISK_RANK = MODERATION_RISK_BY_RANK.length - 1
/** A locale the contract can carry: ASCII letters, digits and hyphens, 1 to 35 characters. */
const LOCALE_PATTERN = '^[A-Za-z0-9-]{1,35}$'
const validLocale = (column: string) =>
  Prisma.raw(`(CASE WHEN ${column} ~ '${LOCALE_PATTERN}' THEN ${column} END)`)
const DUE_KEY_FORMAT = 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'

/** True when a post's `moderation_reason` holds at least one code and every code is a known screening code. */
const postFindingSql = () => Prisma.sql`COALESCE(
  p.moderation_reason IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM unnest(string_to_array(p.moderation_reason, ',')) AS c(code)
    WHERE btrim(c.code) <> ''
  )
  AND NOT EXISTS (
    SELECT 1 FROM unnest(string_to_array(p.moderation_reason, ',')) AS c(code)
    WHERE btrim(c.code) <> '' AND btrim(c.code) <> ALL(${KNOWN_FINDING_CODES}::text[])
  ),
  false
)`

type CaseQueryClient = Pick<PrismaClient, '$queryRaw'> | Prisma.TransactionClient

/**
 * Every case the query selects, as the CTE `scored`. One definition of grouping, risk, due time
 * and SLA state, shared by the queue, the SLA sweep, the escalated alert and the SLA counts.
 */
function scoredCasesSql(
  query: Pick<ModerationCasesQuery, 'source' | 'status'>,
  now: Date
): Prisma.Sql {
  const open = query.status === 'open'
  const reportFilter = open ? Prisma.sql`WHERE r.resolved_at IS NULL` : Prisma.empty
  const branches: Prisma.Sql[] = []
  if (query.source !== 'comment') {
    branches.push(Prisma.sql`
        SELECT 'post'::text AS source,
          CASE WHEN r.post_id IS NOT NULL THEN 'post.' || r.post_id ELSE 'orphan-post.' || r.id END AS case_key,
          r.id AS report_id, r.reporter_id, r.reason::text AS reason, r.created_at AS accepted_at,
          r.sla_due_at, r.resolved_at,
          COALESCE(${validLocale("(r.content_snapshot->>'locale')")}, ${validLocale('p.locale')}) AS locale,
          NULLIF(r.content_snapshot->>'caption', '') AS excerpt,
          ${postFindingSql()} AS finding
        FROM "CommunityPostReport" r
        LEFT JOIN "LookbookPost" p ON p.id = r.post_id
        ${reportFilter}`)
  }
  if (query.source !== 'post') {
    branches.push(Prisma.sql`
        SELECT 'comment'::text AS source,
          CASE WHEN r.comment_id IS NOT NULL THEN 'comment.' || r.comment_id ELSE 'orphan-comment.' || r.id END AS case_key,
          r.id AS report_id, r.reporter_id, r.reason::text AS reason, r.accepted_at AS accepted_at,
          r.sla_due_at, r.resolved_at,
          COALESCE(${validLocale("(r.content_snapshot->>'locale')")}, ${validLocale('c.locale')}) AS locale,
          NULLIF(r.content_snapshot->>'body', '') AS excerpt,
          COALESCE(c.status::text IN ('held_for_review', 'blocked'), false)
            AND COALESCE(c.screening_reason <> ${MODERATION_OPERATOR_TAKEDOWN_REASON}
              AND c.screening_reason NOT LIKE ${`${COMMUNITY_BAN_MARKER_PREFIX}%`}, true) AS finding
        FROM "CommunityCommentReport" r
        LEFT JOIN "CommunityComment" c ON c.id = r.comment_id
        ${reportFilter}`)
  }

  const nowText = now.toISOString()
  const resolvedOnly = open
    ? Prisma.empty
    : Prisma.sql`HAVING count(*) FILTER (WHERE resolved_at IS NULL) = 0`
  return Prisma.sql`
      WITH rep AS (${Prisma.join(branches, ' UNION ALL ')}),
      agg AS (
        SELECT source, case_key,
          count(*)::int AS report_count,
          array_agg(DISTINCT reason ORDER BY reason) AS reasons,
          max(${reasonRankSql()}) AS base_rank,
          bool_or(finding) AS finding,
          (count(DISTINCT reporter_id) + count(*) FILTER (WHERE reporter_id IS NULL))::int AS reporters,
          count(*) FILTER (WHERE resolved_at IS NULL)::int AS open_count,
          min(sla_due_at) AS due,
          min(accepted_at) AS accepted_at,
          (array_agg(locale ORDER BY accepted_at ASC, report_id ASC))[1] AS locale,
          (array_agg(excerpt ORDER BY accepted_at ASC, report_id ASC) FILTER (WHERE excerpt IS NOT NULL))[1] AS excerpt,
          (array_agg(report_id ORDER BY sla_due_at ASC, report_id COLLATE "C" ASC) FILTER (WHERE resolved_at IS NULL))[1] AS anchor_report_id
        FROM rep
        GROUP BY source, case_key
        ${resolvedOnly}
      ),
      scored AS (
        SELECT source, case_key, report_count, reasons, finding, open_count, due, accepted_at, locale,
          anchor_report_id,
          left(excerpt, 280) AS excerpt,
          LEAST(
            base_rank + finding::int + (reporters >= ${MODERATION_REPORTER_BUMP_THRESHOLD})::int,
            ${MAX_RISK_RANK}
          ) AS risk_rank,
          to_char(due, ${DUE_KEY_FORMAT}) AS due_key,
          CASE
            WHEN open_count = 0 THEN 'resolved'
            WHEN due <= ${nowText}::timestamp THEN 'breached'
            WHEN due <= ${nowText}::timestamp + (${SLA_AT_RISK_WINDOW_MS}::bigint * interval '1 millisecond') THEN 'at_risk'
            ELSE 'on_track'
          END AS sla_state
        FROM agg
      )`
}

/**
 * One page of cases, `limit + 1` rows so the caller can tell whether another page exists.
 * `client` is the caller's transaction when the read must share its snapshot and locks.
 */
export async function listModerationCases(
  client: CaseQueryClient,
  query: ModerationCasesQuery,
  now: Date,
  after: ModerationQueuePosition | null,
  options: { caseKey?: string } = {}
): Promise<CaseRow[]> {
  const filters: Prisma.Sql[] = []
  if (options.caseKey) filters.push(Prisma.sql`case_key = ${options.caseKey}`)
  if (query.locale === 'unknown') filters.push(Prisma.sql`locale IS NULL`)
  else if (query.locale) filters.push(Prisma.sql`locale = ${query.locale}`)
  if (query.risk) {
    filters.push(Prisma.sql`risk_rank = ${MODERATION_RISK_BY_RANK.indexOf(query.risk)}`)
  }
  if (query.sla) filters.push(Prisma.sql`sla_state = ${query.sla}`)
  if (after) {
    filters.push(Prisma.sql`(
        risk_rank < ${after.rank}
        OR (risk_rank = ${after.rank} AND due_key COLLATE "C" > ${after.dueKey} COLLATE "C")
        OR (risk_rank = ${after.rank} AND due_key COLLATE "C" = ${after.dueKey} COLLATE "C"
            AND case_key COLLATE "C" > ${after.caseKey} COLLATE "C")
      )`)
  }
  const where = filters.length
    ? Prisma.sql`WHERE ${Prisma.join(filters, ' AND ')}`
    : Prisma.empty

  const rows = await client.$queryRaw<
    {
      case_key: string
      source: ModerationCaseSource
      report_count: number
      reasons: string[]
      risk_rank: number
      finding: boolean
      open_count: number
      due: Date
      due_key: string
      accepted_at: Date
      locale: string | null
      excerpt: string | null
      sla_state: ModerationCaseSlaState
      anchor_report_id: string | null
    }[]
  >(Prisma.sql`
      ${scoredCasesSql(query, now)}
      SELECT * FROM scored
      ${where}
      ORDER BY risk_rank DESC, due_key COLLATE "C" ASC, case_key COLLATE "C" ASC
      LIMIT ${query.limit + 1}
    `)

  return rows.map((row) => ({
    caseKey: row.case_key,
    source: row.source,
    reportCount: row.report_count,
    reasons: row.reasons,
    riskRank: Number(row.risk_rank),
    hasFinding: row.finding,
    openCount: row.open_count,
    dueAt: row.due,
    dueKey: row.due_key,
    acceptedAt: row.accepted_at,
    locale: row.locale,
    excerpt: row.excerpt,
    slaState: row.sla_state,
    anchorReportId: row.anchor_report_id,
  }))
}

/** A row of `ModerationDecision` that decides a scored case. An orphan also matches by its report. */
const decidesCaseSql = (alias: string) =>
  Prisma.raw(`${alias}.action::text IN ('resolve', 'release', 'takedown', 'ban', 'escalate')
              AND (
                ${alias}.case_key = scored.case_key
                OR (scored.case_key LIKE 'orphan-%'
                  AND ${alias}.report_ids @> ARRAY[split_part(scored.case_key, '.', 2)])
              )`)

/**
 * The open cases by SLA state, in SQL over the same CTE as the queue. `escalated` is the count of
 * open cases `escalatedCaseKeys` would mark. `inDecisionOrder` places rows by time across case keys
 * and restores sequence order inside each key, so the newest row by time picks the key, and that
 * key's highest sequence is the logical latest decision, whatever the instances' clocks said.
 */
export async function countModerationCases(
  client: CaseQueryClient,
  now: Date
): Promise<CaseStateCounts> {
  const rows = await client.$queryRaw<
    {
      on_track: number
      at_risk: number
      breached: number
      escalated: number
      oldest_due_text: string | null
    }[]
  >(Prisma.sql`
      ${scoredCasesSql({ status: 'open' }, now)}
      SELECT
        count(*) FILTER (WHERE sla_state = 'on_track')::int AS on_track,
        count(*) FILTER (WHERE sla_state = 'at_risk')::int AS at_risk,
        count(*) FILTER (WHERE sla_state = 'breached')::int AS breached,
        count(*) FILTER (WHERE (
          SELECT latest.action::text FROM "ModerationDecision" latest
          WHERE ${decidesCaseSql('latest')}
            AND latest.case_key = (
              SELECT head.case_key FROM "ModerationDecision" head
              WHERE ${decidesCaseSql('head')}
              ORDER BY head.decided_at DESC, head.sequence DESC
              LIMIT 1
            )
          ORDER BY latest.sequence DESC
          LIMIT 1
        ) = 'escalate')::int AS escalated,
        to_char(min(due), ${DUE_KEY_FORMAT}) AS oldest_due_text
      FROM scored
    `)
  const row = rows[0]
  return {
    onTrack: row?.on_track ?? 0,
    atRisk: row?.at_risk ?? 0,
    breached: row?.breached ?? 0,
    escalated: row?.escalated ?? 0,
    oldestDueAt: row?.oldest_due_text ? new Date(row.oldest_due_text) : null,
  }
}

@Injectable()
export class ModerationQueueRepository {
  constructor(@Inject(PrismaClient) private readonly prisma: PrismaClient) {}

  /**
   * One page of cases, `limit + 1` rows so the caller can tell whether another page exists.
   * `now` is the one clock read of the request and is bound as a parameter, so the `sla` filter
   * and the item `slaState` cannot disagree at the boundary.
   */
  async listCases(
    query: ModerationCasesQuery,
    now: Date,
    after: ModerationQueuePosition | null
  ): Promise<CaseRow[]> {
    return listModerationCases(this.prisma, query, now, after)
  }

  /** Loads everything one case detail needs, or null when no such case exists. */
  /** Pass a transaction client so the case reads from the caller's snapshot. */
  async loadCase(
    id: ParsedCaseId,
    db: Prisma.TransactionClient = this.prisma
  ): Promise<LoadedCase | null> {
    return id.source === 'post' ? this.loadPostCase(db, id) : this.loadCommentCase(db, id)
  }

  private async loadPostCase(
    db: Prisma.TransactionClient,
    id: Extract<ParsedCaseId, { source: 'post' }>
  ): Promise<LoadedCase | null> {
    const rows =
      id.kind === 'post'
        ? await db.communityPostReport.findMany({
            where: { post_id: id.ref },
            orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
          })
        : await db.communityPostReport.findMany({
            where: { id: id.ref, post_id: null },
          })
    if (rows.length === 0) return null

    const reports: ReportRecord[] = rows.map((row) => ({
      id: row.id,
      reporterId: row.reporter_id,
      reason: row.reason,
      details: row.details,
      snapshot: row.content_snapshot,
      subjectAlias: row.subject_alias,
      imagePath: row.image_object_path,
      dueAt: row.sla_due_at,
      acceptedAt: row.created_at,
      resolvedAt: row.resolved_at,
      origin: row.origin,
    }))

    const post =
      id.kind === 'post'
        ? await db.lookbookPost.findUnique({
            where: { id: id.ref },
            select: {
              user_id: true,
              status: true,
              published_at: true,
              image_object_path: true,
              anonymized_at: true,
              objects_purged_at: true,
              moderation_reason: true,
              moderation_engine_version: true,
              locale: true,
            },
          })
        : null

    const events =
      id.kind === 'post'
        ? await db.moderationEvent.findMany({
            where: {
              post_id: id.ref,
              OR: [{ action: null }, { action: { not: 'reported' } }],
            },
            orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
            select: {
              action: true,
              reason: true,
              created_at: true,
              reviewed_by_id: true,
              flagged_by_id: true,
            },
          })
        : []
    const decisions =
      id.kind === 'orphan-post'
        ? await orphanDecisions(
            db,
            reports.map((report) => report.id)
          )
        : []

    return {
      kind: id.kind,
      source: 'post',
      reports,
      post: post
        ? {
            userId: post.user_id,
            status: post.status,
            publishedAt: post.published_at,
            imagePath: post.image_object_path,
            anonymizedAt: post.anonymized_at,
            objectsPurgedAt: post.objects_purged_at,
            moderationReason: post.moderation_reason,
            engineVersion: post.moderation_engine_version,
            locale: post.locale,
          }
        : null,
      comment: null,
      aliases: await this.aliasesFor(db, [
        ...reports.map((report) => report.reporterId),
        post?.user_id ?? null,
      ]),
      // An orphan's events lost their `post_id`, so its decision rows tell the history.
      priorActions: [
        ...events.map((event) => ({
          actorKind: event.reviewed_by_id
            ? ('operator' as const)
            : event.flagged_by_id
              ? ('reporter' as const)
              : ('screening' as const),
          action: event.action ?? 'unknown',
          reason: event.reason,
          occurredAt: event.created_at,
        })),
        ...decisions.map((decision) => ({
          actorKind: 'operator' as const,
          action: decision.action,
          reason: decision.reason,
          occurredAt: decision.decided_at,
        })),
      ],
    }
  }

  private async loadCommentCase(
    db: Prisma.TransactionClient,
    id: Extract<ParsedCaseId, { source: 'comment' }>
  ): Promise<LoadedCase | null> {
    const rows =
      id.kind === 'comment'
        ? await db.communityCommentReport.findMany({
            where: { comment_id: id.ref },
            orderBy: [{ accepted_at: 'asc' }, { id: 'asc' }],
          })
        : await db.communityCommentReport.findMany({
            where: { id: id.ref, comment_id: null },
          })
    if (rows.length === 0) return null

    const reports: ReportRecord[] = rows.map((row) => ({
      id: row.id,
      reporterId: row.reporter_id,
      reason: row.reason,
      details: null,
      snapshot: row.content_snapshot,
      subjectAlias: null,
      imagePath: null,
      dueAt: row.sla_due_at,
      acceptedAt: row.accepted_at,
      resolvedAt: row.resolved_at,
      origin: row.origin,
    }))

    const comment =
      id.kind === 'comment'
        ? await db.communityComment.findUnique({
            where: { id: id.ref },
            select: {
              user_id: true,
              status: true,
              published_at: true,
              screening_reason: true,
              screening_version: true,
              locale: true,
              parent: { select: { body: true, status: true } },
            },
          })
        : null

    const audits = await db.communityCommentAudit.findMany({
      where: {
        report_id: { in: reports.map((report) => report.id) },
        action: { not: 'reported' },
      },
      orderBy: [{ occurred_at: 'asc' }, { id: 'asc' }],
      select: { action: true, reason: true, occurred_at: true },
    })

    return {
      kind: id.kind,
      source: 'comment',
      reports,
      post: null,
      comment: comment
        ? {
            userId: comment.user_id,
            status: comment.status,
            publishedAt: comment.published_at,
            screeningReason: comment.screening_reason,
            screeningVersion: comment.screening_version,
            locale: comment.locale,
            parentBody:
              comment.parent?.status === 'published' ? comment.parent.body : null,
          }
        : null,
      aliases: await this.aliasesFor(db, [
        ...reports.map((report) => report.reporterId),
        comment?.user_id ?? null,
      ]),
      // Comment audit rows carry no actor, so the action names who wrote it.
      priorActions: audits.map((audit) => ({
        actorKind: SCREENING_AUDIT_ACTIONS.includes(audit.action)
          ? ('screening' as const)
          : ('operator' as const),
        action: audit.action,
        reason: audit.reason,
        occurredAt: audit.occurred_at,
      })),
    }
  }

  /** The page's escalated cases, read after paging so the queue order and keyset are untouched. */
  async escalatedCaseKeys(caseKeys: readonly string[]): Promise<ReadonlySet<string>> {
    return escalatedCaseKeys(this.prisma, caseKeys)
  }

  /** Reads aliases and never creates one. */
  private async aliasesFor(
    db: Prisma.TransactionClient,
    userIds: (string | null)[]
  ): Promise<Map<string, string>> {
    const ids = [...new Set(userIds.filter((id): id is string => id !== null))]
    if (ids.length === 0) return new Map()
    const rows = await db.communityAlias.findMany({
      where: { user_id: { in: ids } },
      select: { user_id: true, alias: true },
    })
    return new Map(rows.map((row) => [row.user_id, row.alias]))
  }

  /** The D10 audit row of a successful detail read. The immutable `AuditLog` is the only write of this story. */
  async recordCaseView(params: {
    userId: string
    caseId: string
    source: ModerationCaseSource
    role: string
  }): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        user_id: params.userId,
        event_type: 'moderation_case_viewed',
        event_data: { caseId: params.caseId, source: params.source, role: params.role },
      },
    })
  }
}
