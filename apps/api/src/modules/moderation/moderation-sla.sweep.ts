// Story 6.12 owner: the scheduled SLA sweep in `apps/api/src/modules/moderation/moderation-sla.sweep.ts`.
// A plain class, so the general worker's job and the hosted worker's interval compose the same code.
// Detection reads through the queue's own SQL and decides with `deriveSlaState`, and every write is
// keyed, so a retry, a restart or a concurrent worker changes nothing it should not.
import type { PrismaClient } from '@prisma/client'
import {
  MODERATION_RISK_BY_RANK,
  type ModerationCaseRisk,
  type ModerationSlaFailureCode,
} from '@couture/api-client/contracts/http'
import { createBaseLogger } from '../../logger/pino.config.js'
import type { FeatureFlagsService } from '../feature-flags/feature-flags.service.js'
import {
  countModerationCases,
  listModerationCases,
} from './moderation-queue.repository.js'
import type { ModerationQueuePosition } from './moderation-queue-cursor.js'
import {
  buildModerationSlaPayload,
  createModerationOpsChannel,
  parseModerationOpsPushUserIds,
  readExpoPushReceipts,
  resolveModerationSlaAppUrl,
  type ExpoPushReceipt,
  type ModerationOpsChannel,
} from './moderation-sla.channel.js'
import {
  ModerationSlaRepository,
  type ClaimedModerationSlaAlert,
  type ModerationSlaClaim,
  type OwedModerationSlaEscalation,
} from './moderation-sla.repository.js'
import { moderationSlaAlertKind, moderationSlaDedupeKey } from './moderation-sla.rules.js'
import {
  MODERATION_SLA_ANALYTICS_EVENTS,
  createOpenTelemetryModerationSlaMeter,
  MODERATION_SLA_LOG_EVENTS,
  type ModerationSlaMeter,
} from './moderation-sla.telemetry.js'

export const MODERATION_SLA_SUBJECT = 'system:moderation-sla'
/** The hosted worker's trigger: it does not subscribe to `maintenance`, so it has no scheduler. */
export const MODERATION_SLA_SWEEP_INTERVAL_MS = 60_000
/**
 * Claiming stops this long after delivery starts. It counts from delivery and not from the sweep,
 * so a slow detection scan can never use up delivery's share, and every run claims at least once.
 */
export const MODERATION_SLA_CLAIM_BUDGET_MS = 45_000
/** Fixed text: a worker copies an error message into logs and `JobFailure`, so these hold no row data. */
export const MODERATION_SLA_DETECTION_FAILED = 'moderation_sla_detection_failed'
export const MODERATION_SLA_CLAIM_FAILED = 'moderation_sla_claim_failed'
export const MODERATION_SLA_DELIVERY_INCOMPLETE = 'moderation_sla_delivery_incomplete'
const SNAPSHOT_INTERVAL_MS = 5 * 60 * 1000
/**
 * Each page reruns the whole case query, so a larger page keeps a big backlog cheap: 10,000 open
 * breached cases read in 9 seconds at 50 a page and 0.5 seconds at this size. No cap ends the
 * scan, because a case past a cap would never alert.
 */
const DETECTION_PAGE_SIZE = 1000

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
  /** Lets a test cross page boundaries with a small seed. */
  detectionPageSize?: number
  /** Reads Expo receipts for recorded push tickets; defaults to Expo's API. */
  readPushReceipts?: (ids: readonly string[]) => Promise<Map<string, ExpoPushReceipt>>
}

/** First receipt look, and the retry spacing while Expo has none yet or the lookup fails. */
export const MODERATION_SLA_PUSH_RECEIPT_RETRY_MS = 5 * 60_000
/** Expo keeps receipts about a day; an id with no receipt by then is recorded as unknown. */
export const MODERATION_SLA_PUSH_RECEIPT_EXPIRY_MS = 24 * 60 * 60_000
const PUSH_RECEIPTS_PER_SWEEP = 1000

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
    try {
      await this.detect(sweepNow, result)
    } catch (error) {
      const event = MODERATION_SLA_LOG_EVENTS.detectionFailed
      this.deps.logger.error({ event, prismaCode: prismaErrorCode(error) }, event)
      throw new Error(MODERATION_SLA_DETECTION_FAILED)
    }
    await this.deliver(result)
    // Accepted tickets drain whatever channel new alerts use now, so a switch to webhook or console
    // still settles the pushes already sent.
    await this.checkPushReceipts()
    // A run that could not finish delivery must look like one: no stamp and no snapshot, so the
    // dashboard and the absence alert both show it, and the general worker's retries apply.
    if (result.errors > 0) throw new Error(MODERATION_SLA_DELIVERY_INCOMPLETE)
    await this.repository.stampMonitor(this.deps.clock(), this.deps.channel.kind)
    await this.publishSignals(sweepNow, result)
    return result
  }

  /**
   * Reads owed Expo receipts. Acceptance already counted the alert delivered; a failure Expo
   * reports later, or no receipt by expiry, is logged so a dead device is visible. A failed lookup
   * leaves the rows owed for the next try and never fails the sweep.
   */
  private async checkPushReceipts(): Promise<void> {
    const read = this.deps.readPushReceipts
    if (!read) return
    try {
      await this.settlePushReceipts(read)
    } catch (error) {
      // Receipts are a side signal: a database or provider failure here leaves the rows due and
      // never costs the run its stamp.
      const event = MODERATION_SLA_LOG_EVENTS.pushReceiptReadFailed
      this.deps.logger.warn({ event, prismaCode: prismaErrorCode(error) }, event)
    }
  }

  private async settlePushReceipts(
    read: NonNullable<ModerationSlaSweepDeps['readPushReceipts']>
  ): Promise<void> {
    const now = this.deps.clock()
    const due = await this.repository.duePushReceipts(now, PUSH_RECEIPTS_PER_SWEEP)
    if (due.length === 0) return
    let receipts = new Map<string, ExpoPushReceipt>()
    let readFailed = false
    try {
      receipts = await read(due.map((row) => row.ticketId))
    } catch {
      readFailed = true
      const event = MODERATION_SLA_LOG_EVENTS.pushReceiptReadFailed
      this.deps.logger.warn({ event, owed: due.length }, event)
    }
    const waiting: string[] = []
    for (const row of due) {
      // Expiry is checked first, so a provider outage cannot keep an expired ticket owed forever.
      const receipt = receipts.get(row.ticketId)
      if (receipt?.status === 'ok') {
        await this.repository.settlePushReceipt(row.ticketId, 'ok', null, now)
      } else if (receipt?.status === 'error') {
        const event = MODERATION_SLA_LOG_EVENTS.pushReceiptFailed
        this.deps.logger.warn(
          { event, alertId: row.alertId, error: receipt.error },
          event
        )
        await this.repository.settlePushReceipt(
          row.ticketId,
          'failed',
          receipt.error,
          now
        )
      } else if (row.expiresAt.getTime() <= now.getTime()) {
        const event = MODERATION_SLA_LOG_EVENTS.pushReceiptUnknown
        this.deps.logger.warn({ event, alertId: row.alertId, readFailed }, event)
        await this.repository.settlePushReceipt(row.ticketId, 'unknown', null, now)
      } else {
        waiting.push(row.ticketId)
      }
    }
    if (waiting.length > 0)
      await this.repository.deferPushReceipts(
        waiting,
        new Date(now.getTime() + MODERATION_SLA_PUSH_RECEIPT_RETRY_MS)
      )
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
    const pageSize = this.deps.detectionPageSize ?? DETECTION_PAGE_SIZE
    for (const sla of ['at_risk', 'breached'] as const) {
      let after: ModerationQueuePosition | null = null
      for (;;) {
        const rows = await listModerationCases(
          this.deps.prisma,
          { status: 'open', sla, limit: pageSize },
          now,
          after
        )
        const page = rows.slice(0, pageSize)
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
        if (rows.length <= pageSize || !last) break
        after = { rank: last.riskRank, dueKey: last.dueKey, caseKey: last.caseKey }
      }
    }
  }

  private async deliver(result: ModerationSlaSweepResult): Promise<void> {
    await this.repairOwedEscalations(result)
    const startedAt = this.deps.clock().getTime()
    for (let first = true; ; first = false) {
      const claimNow = this.deps.clock()
      if (!first && claimNow.getTime() - startedAt >= MODERATION_SLA_CLAIM_BUDGET_MS)
        break

      let claim: ModerationSlaClaim | null
      try {
        claim = await this.repository.claimNext({
          claimNow,
          channel: this.deps.channel.kind,
        })
      } catch (error) {
        const event = MODERATION_SLA_LOG_EVENTS.claimFailed
        this.deps.logger.error({ event, prismaCode: prismaErrorCode(error) }, event)
        throw new Error(MODERATION_SLA_CLAIM_FAILED)
      }
      if (!claim) break

      const { alert } = claim
      if (claim.firstProcessing && alert.kind === 'escalated') {
        this.recordAlertSignal(alert.kind, alert.source, alert.risk)
      }
      if (claim.disposition !== 'claimed') {
        if (claim.disposition === 'superseded') result.superseded += 1
        else if (claim.disposition === 'delivered') result.delivered += 1
        else result.consoleOnly += 1
        continue
      }

      try {
        if (claim.interrupted) this.recordAttemptFailure(alert, 'interrupted')
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
    await this.repairOwedEscalations(result)
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
    // A stale claimant loses the fence: a later worker owns this row, so nothing is owed by it.
    await this.repository.recordFailedAttempt(alert, outcome, now)
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

  /**
   * The established failure path, once per alert, on its own record of what is owed: a later
   * delivery or a crash after the third failure cannot lose it. A failed write stays owed and
   * retries on the next pass.
   */
  private async repairOwedEscalations(result: ModerationSlaSweepResult): Promise<void> {
    let owed: OwedModerationSlaEscalation[]
    try {
      owed = await this.repository.owedEscalations()
    } catch (error) {
      const event = MODERATION_SLA_LOG_EVENTS.failureRecordFailed
      this.deps.logger.error({ event, prismaCode: prismaErrorCode(error) }, event)
      result.errors += 1
      return
    }
    for (const escalation of owed) {
      const { id: alertId, kind, code, attempts } = escalation
      let escalated: boolean
      try {
        escalated = await this.repository.escalateFailure(
          escalation,
          code,
          this.deps.clock()
        )
      } catch (error) {
        const event = MODERATION_SLA_LOG_EVENTS.failureRecordFailed
        this.deps.logger.error(
          { event, alertId, code, prismaCode: prismaErrorCode(error) },
          event
        )
        continue
      }
      if (!escalated) continue
      const event = MODERATION_SLA_LOG_EVENTS.deliveryFailed
      this.deps.logger.error({ event, alertId, kind, code, attempts }, event)
      this.capture(MODERATION_SLA_ANALYTICS_EVENTS.deliveryFailed, { kind, code })
    }
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
      this.deps.meter.setLastMeasuredAt(Math.floor(now.getTime() / 1000))

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

/** One composition for both worker processes, so they cannot drift. */
export function createModerationSlaSweep(
  deps: Pick<ModerationSlaSweepDeps, 'prisma' | 'flags' | 'analytics'>
): ModerationSlaSweep {
  const logger = createBaseLogger().child({ feature: 'moderation-sla' })
  const repository = new ModerationSlaRepository(deps.prisma)
  const accessToken = process.env.EXPO_PUSH_ACCESS_TOKEN
  return new ModerationSlaSweep({
    ...deps,
    clock: () => new Date(),
    channel: createModerationOpsChannel({
      url: process.env.MODERATION_OPS_WEBHOOK_URL,
      push: {
        userIds: parseModerationOpsPushUserIds(process.env.MODERATION_OPS_PUSH_USER_IDS),
        accessToken,
        tokens: async (userIds) =>
          (
            await deps.prisma.pushToken.findMany({
              where: { user_id: { in: [...userIds] }, permission: 'granted' },
              select: { token: true },
            })
          ).map((row) => row.token),
        // Recorded before the alert counts as delivered, so receipts survive a worker restart.
        onAccepted: async (alertId, ticketIds) => {
          const now = new Date()
          try {
            await repository.recordPushTickets(
              alertId,
              ticketIds,
              now,
              new Date(now.getTime() + MODERATION_SLA_PUSH_RECEIPT_RETRY_MS),
              new Date(now.getTime() + MODERATION_SLA_PUSH_RECEIPT_EXPIRY_MS)
            )
          } catch (error) {
            const event = MODERATION_SLA_LOG_EVENTS.pushTicketRecordFailed
            logger.warn({ event, alertId, prismaCode: prismaErrorCode(error) }, event)
          }
        },
      },
    }),
    logger,
    readPushReceipts: (ids) => readExpoPushReceipts(ids, { accessToken }),
    meter: createOpenTelemetryModerationSlaMeter(),
    appUrl: resolveModerationSlaAppUrl(),
  })
}
