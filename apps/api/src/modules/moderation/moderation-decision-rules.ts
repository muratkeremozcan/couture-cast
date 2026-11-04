// Story 6.11 owner: the pure rules of a moderation decision in `apps/api/src/modules/moderation/moderation-decision-rules.ts`.
// They live here because the shared contract ships in browser bundles and cannot import `node:crypto`.
import { createHash } from 'node:crypto'
import {
  ConflictException,
  ForbiddenException,
  HttpException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common'
import { Prisma } from '@prisma/client'
import {
  COMMUNITY_BAN_MARKER_PREFIX,
  type ModerationBanTerms,
  type ModerationDecisionAction,
  type ModerationDecisionDetail,
  type ModerationDecisionErrorCode,
  type ModerationSanctionKind,
} from '@couture/api-client/contracts/http'

/** The one clock of a request. Tests inject a fixed instant. */
export const MODERATION_QUEUE_CLOCK = Symbol('MODERATION_QUEUE_CLOCK')
export type ModerationQueueClock = () => Date
export const systemModerationQueueClock: ModerationQueueClock = () => new Date()

/** A report, a withdrawal or another decision moves this value, so a stale reading is refused. */
export function computeModerationCaseRevision(input: {
  sequence: number
  openReportIds: readonly string[]
  targetStatus: string | null
}): string {
  const reports = [...input.openReportIds].sort().join(',')
  return createHash('sha256')
    .update(`${input.sequence}|${reports}|${input.targetStatus ?? ''}`)
    .digest('hex')
    .slice(0, 16)
}

export type DecisionPayload =
  | {
      route: 'decision'
      caseId: string
      action: ModerationDecisionAction
      reason: string
      ban?: ModerationBanTerms
    }
  | { route: 'appeal'; sanctionId: string; status: string; reason: string }

/**
 * What "the same payload" means for a retry. `expectedRevision` stays out, so a client that reloaded
 * after losing the response still replays its own decision.
 */
export function computeDecisionPayloadHash(payload: DecisionPayload): string {
  const canonical =
    payload.route === 'decision'
      ? [
          payload.route,
          payload.caseId,
          payload.action,
          payload.reason.trim(),
          payload.ban?.kind ?? null,
          payload.ban?.kind === 'temporary' ? payload.ban.durationDays : null,
        ]
      : [payload.route, payload.sanctionId, payload.status, payload.reason.trim()]
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex')
}

/** One rule for the detail, the decision and the appeal: nobody rules on their own content or report. */
export function computeViewerConflict(input: {
  viewerId: string
  authorId: string | null
  reporterIds: readonly (string | null)[]
}): boolean {
  return (
    input.authorId === input.viewerId ||
    input.reporterIds.some((reporter) => reporter === input.viewerId)
  )
}

/**
 * The `AuditLog` row outlives erasure and is immutable, so it holds no subject id, alias or reason.
 * Every audit row of this story is built here.
 */
export function buildDecisionAuditData(input: {
  decisionId: string
  caseId: string
  action: string
  role: string
  banKind?: ModerationSanctionKind
}): Record<string, string> {
  return {
    decisionId: input.decisionId,
    caseId: input.caseId,
    action: input.action,
    role: input.role,
    ...(input.banKind ? { banKind: input.banKind } : {}),
  }
}

export interface DecisionHistoryRow {
  caseKey: string
  sequence: number
  isTerminal: boolean
  action: string
  decidedAt: Date
}

/**
 * What the record says about a case. `firstDecisionAt` is a minimum over rows nothing updates, so
 * nothing can move it. The rows are read by case key or report overlap, so they survive a re-key.
 */
export function summarizeDecisionHistory(
  rows: readonly DecisionHistoryRow[],
  caseKey: string
): { sequence: number; escalated: boolean; firstDecisionAt: Date | null } {
  const ordered = [...rows].sort(
    (a, b) => a.decidedAt.getTime() - b.decidedAt.getTime() || a.sequence - b.sequence
  )
  let sequence = 0
  let escalated = false
  let firstDecisionAt: Date | null = null
  for (const row of ordered) {
    if (row.caseKey === caseKey) sequence = Math.max(sequence, row.sequence)
    if (row.action === 'escalate') escalated = true
    if (row.isTerminal) {
      escalated = false
      firstDecisionAt ??= row.decidedAt
    }
  }
  return { sequence, escalated, firstDecisionAt }
}

const ERROR_MESSAGES: Record<ModerationDecisionErrorCode, string> = {
  invalid_decision: 'Invalid moderation decision.',
  case_not_found: 'Moderation case not found.',
  sanction_not_found: 'Sanction not found.',
  moderation_console_disabled: 'The moderation console is not available.',
  moderation_decisions_disabled: 'Moderation decisions are not available.',
  self_review_refused: 'This account cannot review its own content or report.',
  admin_required: 'This decision needs an admin.',
  operator_sanctioned: 'This account cannot apply decisions while sanctioned.',
  case_conflict: 'The case changed since it was read.',
  action_not_applicable: 'That action does not apply to the case as it stands.',
  idempotency_mismatch: 'This mutation id was used for a different request.',
  appeal_transition_invalid: 'That appeal step does not apply to the sanction.',
  audit_unavailable: 'The decision could not be recorded.',
}

/** Every refusal of both routes. The body holds a closed code and never echoes the request. */
export function moderationDecisionError(
  code: ModerationDecisionErrorCode,
  extra: { detail?: ModerationDecisionDetail; currentRevision?: string } = {}
): HttpException {
  const body = (statusCode: number) => ({
    statusCode,
    code,
    message: ERROR_MESSAGES[code],
    ...extra,
  })
  switch (code) {
    case 'case_not_found':
    case 'sanction_not_found':
      return new NotFoundException(body(404))
    case 'self_review_refused':
    case 'admin_required':
    case 'operator_sanctioned':
      return new ForbiddenException(body(403))
    case 'case_conflict':
    case 'action_not_applicable':
    case 'idempotency_mismatch':
    case 'appeal_transition_invalid':
      return new ConflictException(body(409))
    case 'invalid_decision':
      return new HttpException(body(400), 400)
    case 'moderation_console_disabled':
    case 'moderation_decisions_disabled':
    case 'audit_unavailable':
      return new ServiceUnavailableException(body(503))
  }
}

/** True for a unique violation that names every one of these columns. */
export function isUniqueViolation(error: unknown, ...columns: string[]): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false
  if (error.code !== 'P2002') return false
  const target = error.meta?.target
  const named = Array.isArray(target) ? target.map(String).join(',') : String(target)
  return columns.every((column) => named.includes(column))
}

export const moderatorLogRef = (userId: string): string =>
  createHash('sha256').update(userId).digest('hex').slice(0, 12)

/** A held item carries this until an overturned appeal restores it. It never leaves the API. */
export const communityBanMarker = (sanctionId: string): string =>
  `${COMMUNITY_BAN_MARKER_PREFIX}${sanctionId}`
