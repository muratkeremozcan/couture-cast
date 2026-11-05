// Story 6.13 owner: the pure rules of moderation history in `apps/api/src/modules/moderation/moderation-history.rules.ts`.
// No Nest or Prisma runtime here, so the community image, the routes and the erasure transaction all read one definition.
import { createHash } from 'node:crypto'
import {
  MODERATION_ERASED_REASON,
  type moderationEvidenceAuditEventTypes,
  type ModerationEvidenceAlert,
  type ModerationEvidenceAuditEvent,
  type ModerationEvidenceDecision,
  type ModerationEvidenceReport,
  type ModerationEvidenceReporterState,
} from '@couture/api-client/contracts/http'

/** The worker's flag subject. A per-moderator rule opens the routes and leaves this off, which is true. */
export const MODERATION_HISTORY_SUBJECT = 'system:moderation-history'
export const MODERATION_ALERT_RETENTION_DAYS = 400
export const MODERATION_ALERT_PRUNE_BATCH = 500

/** Exactly 400 days stays, because the prune compares with a strict "before". */
export function moderationAlertRetentionCutoff(now: Date): Date {
  return new Date(now.getTime() - MODERATION_ALERT_RETENTION_DAYS * 86_400_000)
}

export type ModerationHistoryAuditInput =
  | { eventType: 'moderation_erasure_requested'; requestId: string; role: string }
  | {
      eventType: 'moderation_evidence_exported'
      exportId: string
      scope: 'case'
      caseId: string
      counts: ModerationEvidenceCounts
      sha256: string
      role: string
    }
  | {
      eventType: 'moderation_evidence_exported'
      exportId: string
      scope: 'range'
      from: string
      to: string
      counts: ModerationEvidenceCounts
      sha256: string
      role: string
    }

export interface ModerationEvidenceCounts {
  decisions: number
  reports: number
  auditEvents: number
  alerts: number
  withheldForConflict: number
}

/**
 * `AuditLog` outlives erasure and is immutable, so its rows hold no subject id, reporter id, alias or
 * reason. Every audit row of this story is built here, listing its keys, so a caller's extra field
 * cannot reach the table. `moderation_history_anonymized` is written by the database function.
 */
export function buildModerationHistoryAuditData(
  input: ModerationHistoryAuditInput
): Record<string, string | number | Record<string, number>> {
  if (input.eventType === 'moderation_erasure_requested')
    return { requestId: input.requestId, role: input.role }
  const counts = {
    decisions: input.counts.decisions,
    reports: input.counts.reports,
    auditEvents: input.counts.auditEvents,
    alerts: input.counts.alerts,
    withheldForConflict: input.counts.withheldForConflict,
  }
  const common = {
    exportId: input.exportId,
    counts,
    sha256: input.sha256,
    role: input.role,
  }
  return input.scope === 'case'
    ? { ...common, scope: 'case', caseId: input.caseId }
    : { ...common, scope: 'range', from: input.from, to: input.to }
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value === null || typeof value !== 'object') return value
  const source = value as Record<string, unknown>
  return Object.fromEntries(
    Object.keys(source)
      .sort()
      .map((key) => [key, canonicalize(source[key])])
  )
}

/** Over the four arrays alone, so a kept copy compares with the audit row whatever the envelope says. */
export function moderationEvidenceDigest(content: {
  decisions: readonly ModerationEvidenceDecision[]
  reports: readonly ModerationEvidenceReport[]
  auditEvents: readonly ModerationEvidenceAuditEvent[]
  alerts: readonly ModerationEvidenceAlert[]
}): string {
  return createHash('sha256')
    .update(
      JSON.stringify(
        canonicalize({
          decisions: content.decisions,
          reports: content.reports,
          auditEvents: content.auditEvents,
          alerts: content.alerts,
        })
      )
    )
    .digest('hex')
}

/** The API's one reading of the constant erasure leaves, so no screen or file ever shows it. */
export function mapModerationReason(reason: string): {
  reason: string | null
  reasonRemoved: boolean
} {
  return reason === MODERATION_ERASED_REASON
    ? { reason: null, reasonRemoved: true }
    : { reason, reasonRemoved: false }
}

export function moderationReporterState(report: {
  reporter_id: string | null
  origin: 'member' | 'screening'
}): ModerationEvidenceReporterState {
  if (report.reporter_id) return 'member'
  return report.origin === 'screening' ? 'screening' : 'erased'
}

export interface ModerationHistoryAuditRow {
  event_type: string
  timestamp: Date
  user_id: string
  role: string | null
  action: string | null
  actor_erased: boolean
}

/** `event_data` is never copied out. An erased actor reads as null while the immutable row keeps its value. */
export function mapModerationAuditEvent(
  row: ModerationHistoryAuditRow
): ModerationEvidenceAuditEvent {
  return {
    eventType: row.event_type as (typeof moderationEvidenceAuditEventTypes)[number],
    occurredAt: row.timestamp.toISOString(),
    actorId: row.actor_erased ? null : row.user_id,
    role: row.role,
    action: row.action,
  }
}
