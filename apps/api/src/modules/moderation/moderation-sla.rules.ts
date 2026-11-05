// Story 6.12 owner: the pure rules of the SLA monitor in `apps/api/src/modules/moderation/moderation-sla.rules.ts`.
// State comes only from `deriveSlaState`, so no threshold is copied here.
import {
  deriveSlaState,
  MODERATION_SLA_MONITOR_STALE_MS,
  type ModerationSlaAlertKind,
} from '@couture/api-client/contracts/http'

/** The alert the sweep owes a case right now. A case on track owes none. */
export function moderationSlaAlertKind(input: {
  dueAt: Date
  now: Date
}): Extract<ModerationSlaAlertKind, 'at_risk' | 'breached'> | null {
  const state = deriveSlaState({ status: 'open', dueAt: input.dueAt, now: input.now })
  return state === 'at_risk' || state === 'breached' ? state : null
}

/**
 * A retry, a restart and a concurrent worker all compute the same key. The key anchors on a report
 * because a report id survives the erasure re-key, and on a decision for an escalation because
 * re-escalating is a new decision that owes a new alert.
 */
export function moderationSlaDedupeKey(input: {
  kind: ModerationSlaAlertKind
  source: string
  anchorReportId: string
  decisionId?: string | null
}): string {
  if (input.kind === 'escalated') {
    if (!input.decisionId)
      throw new RangeError('An escalated alert needs its decision id')
    return `escalated:${input.decisionId}`
  }
  return `sla:${input.source}:${input.anchorReportId}:${input.kind}`
}

/**
 * Whether an alert still announces a live problem. `anchorResolved` null means the anchor report
 * is gone. A backlog after an outage or after the flag opens therefore announces only live cases.
 */
export function moderationSlaAlertRelevance(input: {
  kind: ModerationSlaAlertKind
  slaDueAt: Date
  anchorResolved: boolean | null
  now: Date
}): 'send' | 'supersede' {
  if (input.anchorResolved !== false) return 'supersede'
  if (
    input.kind === 'at_risk' &&
    moderationSlaAlertKind({ dueAt: input.slaDueAt, now: input.now }) === 'breached'
  ) {
    return 'supersede'
  }
  return 'send'
}

const BACKOFF_MINUTES = [1, 2, 4, 8, 16, 30] as const

/** The wait after failed attempt `attempts`, counted from 1 and capped at 30 minutes. */
export function moderationSlaBackoffMs(attempts: number): number {
  const index = Math.min(Math.max(attempts, 1), BACKOFF_MINUTES.length) - 1
  return (BACKOFF_MINUTES[index] as number) * 60_000
}

/** A monitor that never stamped, or stamped more than five minutes ago, is stale. */
export function isModerationSlaMonitorStale(
  lastSweepAt: Date | null,
  now: Date
): boolean {
  if (!lastSweepAt) return true
  return now.getTime() - lastSweepAt.getTime() > MODERATION_SLA_MONITOR_STALE_MS
}
