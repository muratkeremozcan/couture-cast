// Story 6.12 owner: the scheduled SLA sweep in `apps/api/src/modules/moderation/moderation-sla.sweep.ts`.
// A plain class, so the general worker's job and the hosted worker's interval compose the same code.
// Detection reads through the queue's own SQL and decides with `deriveSlaState`, and every write is
// keyed, so a retry, a restart or a concurrent worker changes nothing it should not.
import type { PrismaClient } from '@prisma/client'
import {
  MODERATION_QUEUE_MAX_LIMIT,
  MODERATION_RISK_BY_RANK,
  type ModerationCaseRisk,
  type ModerationSlaFailureCode,
} from '@couture/api-client/contracts/http'
import type { FeatureFlagsService } from '../feature-flags/feature-flags.service.js'
import {
  countModerationCases,
  listModerationCases,
} from './moderation-queue.repository.js'
import type { ModerationQueuePosition } from './moderation-queue-cursor.js'
import {
  buildModerationSlaPayload,
  type ModerationOpsChannel,
} from './moderation-sla.channel.js'
import {
  MODERATION_SLA_ESCALATE_AT_ATTEMPT,
  ModerationSlaRepository,
  type ClaimedModerationSlaAlert,
  type ModerationSlaClaim,
} from './moderation-sla.repository.js'
import { moderationSlaAlertKind, moderationSlaDedupeKey } from './moderation-sla.rules.js'
import {
  MODERATION_SLA_ANALYTICS_EVENTS,
  MODERATION_SLA_LOG_EVENTS,
  type ModerationSlaMeter,
} from './moderation-sla.telemetry.js'

export const MODERATION_SLA_SUBJECT = 'system:moderation-sla'
/** Thirteen failing 5-second sends would outlive a 60-second lease, so claiming stops here. */
export const MODERATION_SLA_CLAIM_BUDGET_MS = 45_000
const SNAPSHOT_INTERVAL_MS = 5 * 60 * 1000

interface SweepLogger {
  info(payload: object, message: string): void
  warn(payload: object, message: string): void
  error(payload: object, message: string): void
}

export interface ModerationSlaSweepDeps {
  prisma: PrismaClient
  clock: () => Date
  channel: ModerationOpsChannel
  flags: Pick<FeatureFlagsService, 'getFeatureFlag'>
  analytics: {
    capture(event: {
      distinctId: string
      event: string
      properties?: Record<string, unknown>
    }): void
  }
  logger: SweepLogger
  meter: ModerationSlaMeter
  appUrl?: string
}

/** Integer counts only, because `maintenance.processor.ts` logs whatever a sweep returns. */
export interface ModerationSlaSweepResult {
  skipped: number
  recorded: number
  delivered: number
  failed: number
  superseded: number
  consoleOnly: number
  errors: number
}

const emptyResult = (): ModerationSlaSweepResult => ({
  skipped: 0,
  recorded: 0,
  delivered: 0,
  failed: 0,
  superseded: 0,
  consoleOnly: 0,
  errors: 0,
})

/** Enough to diagnose an outage. An error message can carry row data, so it never leaves. */
function prismaErrorCode(error: unknown): string | null {
  const code = (error as { code?: unknown } | null)?.code
  return typeof code === 'string' && /^P\d{4}$/.test(code) ? code : null
}

export class ModerationSlaSweep {
  private readonly repository: ModerationSlaRepository
  private lastSnapshotAt: number | null = null

  constructor(private readonly deps: ModerationSlaSweepDeps) {
    this.repository = new ModerationSlaRepository(deps.prisma)
  }

  async run(): Promise<ModerationSlaSweepResult> {
    const result = emptyResult()
    if (!(await this.enabled())) {
      result.skipped = 1
      return result
    }

    const sweepNow = this.deps.clock()
    await this.detect(sweepNow, result)
    await this.deliver(sweepNow, result)
    await this.repository.stampMonitor(this.deps.clock(), this.deps.channel.kind)
    await this.publishSignals(sweepNow, result)
    return result
  }

  /** Flags come first and an outage reads as off, so the sweep does nothing while closed. */
  private async enabled(): Promise<boolean> {
    try {
      const monitoring = await this.deps.flags.getFeatureFlag(
        'moderation_sla_monitoring_enabled',
        MODERATION_SLA_SUBJECT
      )
      if (!monitoring) return false
      return await this.deps.flags.getFeatureFlag(
        'moderation_console_enabled',
        MODERATION_SLA_SUBJECT
      )
    } catch {
      const event = MODERATION_SLA_LOG_EVENTS.flagUnavailable
      this.deps.logger.error({ event }, event)
      return false
    }
  }

  private async detect(now: Date, result: ModerationSlaSweepResult): Promise<void> {
    for (const sla of ['at_risk', 'breached'] as const) {
      let after: ModerationQueuePosition | null = null
      for (;;) {
        const rows = await listModerationCases(
          this.deps.prisma,
          { status: 'open', sla, limit: MODERATION_QUEUE_MAX_LIMIT },
          now,
          after
        )
        const page = rows.slice(0, MODERATION_QUEUE_MAX_LIMIT)
        const candidates = page.flatMap((row) => {
          const kind = moderationSlaAlertKind({ dueAt: row.dueAt, now })
          if (!kind || !row.anchorReportId) return []
          const anchorReportId = row.anchorReportId
          const dedupeKey = moderationSlaDedupeKey({
            kind,
            source: row.source,
            anchorReportId,
          })
          return [{ row, kind, anchorReportId, dedupeKey }]
        })
        const existing = await this.repository.existingDedupeKeys(
          candidates.map(({ dedupeKey }) => dedupeKey)
        )
        for (const { row, kind, anchorReportId, dedupeKey } of candidates) {
          if (existing.has(dedupeKey)) continue
          const risk = MODERATION_RISK_BY_RANK[row.riskRank] as ModerationCaseRisk
          const inserted = await this.repository.insertAlert({
            kind,
            caseKey: row.caseKey,
            source: row.source,
            anchorReportId,
            risk,
            slaDueAt: row.dueAt,
            detectedAt: now,
          })
          if (!inserted) continue
          result.recorded += 1
          this.recordAlertSignal(kind, row.source, risk)
        }
        const last = page.at(-1)
        if (rows.length <= MODERATION_QUEUE_MAX_LIMIT || !last) break
        after = { rank: last.riskRank, dueKey: last.dueKey, caseKey: last.caseKey }
      }
    }
  }

  private async deliver(sweepNow: Date, result: ModerationSlaSweepResult): Promise<void> {
    for (;;) {
      const claimNow = this.deps.clock()
      if (claimNow.getTime() - sweepNow.getTime() >= MODERATION_SLA_CLAIM_BUDGET_MS)
        return

      let claim: ModerationSlaClaim | null
      try {
        claim = await this.repository.claimNext({
          claimNow,
          sweepNow,
          channel: this.deps.channel.kind,
        })
      } catch (error) {
        const event = MODERATION_SLA_LOG_EVENTS.claimFailed
        this.deps.logger.error({ event, prismaCode: prismaErrorCode(error) }, event)
        result.errors += 1
        return
      }
      if (!claim) return

      const { alert } = claim
      if (claim.firstProcessing && alert.kind === 'escalated') {
        this.recordAlertSignal(alert.kind, alert.source, alert.risk)
      }
      if (claim.disposition !== 'claimed') {
        if (claim.disposition === 'superseded') result.superseded += 1
        else result.consoleOnly += 1
        continue
      }

      try {
        if (claim.interrupted) {
          this.recordAttemptFailure(alert, 'interrupted')
          await this.escalateIfDue(alert, 'interrupted')
        }
        await this.attempt(alert, result)
      } catch (error) {
        // The lease stays, so the row returns as `interrupted` once it expires. One alert's
        // failure never stops the rest of the batch.
        const event = MODERATION_SLA_LOG_EVENTS.alertFailed
        this.deps.logger.error(
          { event, alertId: alert.id, prismaCode: prismaErrorCode(error) },
          event
        )
        result.errors += 1
      }
    }
  }

  private async attempt(
    alert: ClaimedModerationSlaAlert,
    result: ModerationSlaSweepResult
  ): Promise<void> {
    const outcome = await this.deps.channel.deliver(
      buildModerationSlaPayload(
        {
          id: alert.id,
          kind: alert.kind,
          source: alert.source,
          risk: alert.risk,
          slaDueAt: alert.slaDueAt,
          detectedAt: alert.detectedAt,
          caseId: alert.caseId,
        },
        { appUrl: this.deps.appUrl }
      )
    )
    const now = this.deps.clock()
    if (outcome === 'delivered') {
      await this.repository.recordDelivered(alert, now)
      result.delivered += 1
      return
    }

    result.failed += 1
    this.recordAttemptFailure(alert, outcome)
    // A stale claimant lost the fence: a later worker owns this row, so it raises no alarm.
    const recorded = await this.repository.recordFailedAttempt(alert, outcome, now)
    if (recorded) await this.escalateIfDue(alert, outcome)
  }

  private recordAttemptFailure(
    alert: ClaimedModerationSlaAlert,
    code: ModerationSlaFailureCode
  ): void {
    this.deps.meter.countDeliveryFailure(code)
    const event = MODERATION_SLA_LOG_EVENTS.attemptFailed
    this.deps.logger.warn(
      { event, alertId: alert.id, kind: alert.kind, code, attempts: alert.attempts },
      event
    )
  }

  /** The established failure path, once per alert. A failed write retries at the next attempt. */
  private async escalateIfDue(
    alert: ClaimedModerationSlaAlert,
    code: ModerationSlaFailureCode
  ): Promise<void> {
    if (alert.attempts < MODERATION_SLA_ESCALATE_AT_ATTEMPT || alert.failureEscalatedAt) {
      return
    }
    let escalated: boolean
    try {
      escalated = await this.repository.escalateFailure(alert, code, this.deps.clock())
    } catch (error) {
      const event = MODERATION_SLA_LOG_EVENTS.failureRecordFailed
      this.deps.logger.error(
        { event, alertId: alert.id, code, prismaCode: prismaErrorCode(error) },
        event
      )
      return
    }
    if (!escalated) return
    const event = MODERATION_SLA_LOG_EVENTS.deliveryFailed
    this.deps.logger.error(
      { event, alertId: alert.id, kind: alert.kind, code, attempts: alert.attempts },
      event
    )
    this.capture(MODERATION_SLA_ANALYTICS_EVENTS.deliveryFailed, {
      kind: alert.kind,
      code,
    })
  }

  private recordAlertSignal(
    kind: ClaimedModerationSlaAlert['kind'],
    source: ClaimedModerationSlaAlert['source'],
    risk: ModerationCaseRisk
  ): void {
    this.deps.meter.countAlert(kind)
    this.capture(MODERATION_SLA_ANALYTICS_EVENTS.recorded, { kind, source, risk })
  }

  /** Gauges each sweep, the PostHog snapshot at most every five minutes. Signals never fail a sweep. */
  private async publishSignals(
    now: Date,
    result: ModerationSlaSweepResult
  ): Promise<void> {
    try {
      const [counts, oldestPendingReviewAt] = await Promise.all([
        countModerationCases(this.deps.prisma, now),
        this.repository.oldestPendingReviewAt(),
      ])
      const pendingAgeSeconds = oldestPendingReviewAt
        ? Math.max(
            0,
            Math.floor((now.getTime() - oldestPendingReviewAt.getTime()) / 1000)
          )
        : 0
      this.deps.meter.setOpenCases('on_track', counts.onTrack)
      this.deps.meter.setOpenCases('at_risk', counts.atRisk)
      this.deps.meter.setOpenCases('breached', counts.breached)
      this.deps.meter.setOldestPendingReviewAgeSeconds(pendingAgeSeconds)

      const nowMs = now.getTime()
      if (
        this.lastSnapshotAt !== null &&
        nowMs - this.lastSnapshotAt < SNAPSHOT_INTERVAL_MS
      ) {
        return
      }
      this.lastSnapshotAt = nowMs
      this.capture(MODERATION_SLA_ANALYTICS_EVENTS.snapshot, {
        on_track: counts.onTrack,
        at_risk: counts.atRisk,
        breached: counts.breached,
        escalated: counts.escalated,
        oldest_pending_review_age_seconds: pendingAgeSeconds,
      })
    } catch (error) {
      const event = MODERATION_SLA_LOG_EVENTS.signalsFailed
      this.deps.logger.error({ event, prismaCode: prismaErrorCode(error) }, event)
      result.errors += 1
    }
  }

  private capture(event: string, properties: Record<string, unknown>): void {
    try {
      this.deps.analytics.capture({
        distinctId: MODERATION_SLA_SUBJECT,
        event,
        properties,
      })
    } catch {
      // Analytics must not change monitor behaviour.
    }
  }
}
