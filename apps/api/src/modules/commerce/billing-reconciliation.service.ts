import { randomUUID } from 'node:crypto'
import type { PrismaClient } from '@prisma/client'
import { createBaseLogger } from '../../logger/pino.config.js'
import type { TelemetryService } from '../telemetry/telemetry.service.js'
import {
  resolveEntitlementEmission,
  type EntitlementTransition,
  type PremiumEntitlementService,
} from './premium-entitlement.service.js'
import type { BillingEventPayloadProjection } from './billing-webhook.service.js'
import type { RevenueCatClient } from './revenuecat-client.js'

/**
 * Story 5.2 Decision 4a: the 15-minute billing reconciliation sweep, run as a
 * BullMQ Job Scheduler on the worker runtime (the only substrate in this repo
 * where schedules provably fire — the serverless API's @Cron never has).
 *
 * Two duties per sweep, each individually crash-isolated so one throw cannot
 * kill the other or the worker, and each bounded so a sweep can never become
 * an unbounded iteration or an RC rate-limit surprise:
 *
 *   1. **Forward re-drive** (up to {@link FORWARD_REDRIVE_BATCH_SIZE} rows):
 *      every `forward_due AND forwarded_at IS NULL` BillingEvent is the
 *      durable record of a Stripe payment whose RevenueCat forward has not
 *      succeeded — the one place a payment could otherwise be lost. Re-drive
 *      it, then pull the ledger for that user so the entitlement activates
 *      without waiting for the RC webhook. This 15-minute cadence bounds
 *      paid-but-locked recovery after an RC outage.
 *
 *   2. **Drift correction** (up to {@link DRIFT_CORRECTION_BATCH_SIZE} rows):
 *      entitlements whose `synced_at` is older than
 *      {@link DRIFT_STALENESS_HOURS} get a fresh ledger pull applied through
 *      the same snapshot path the refresh endpoint uses. The mirror follows
 *      the ledger; it never argues.
 *
 * Constructed manually in `workers/bootstrap.ts` (no Nest DI there, like every
 * sibling); integration tests invoke {@link sweep} directly, which is what
 * makes the schedule's behaviour deterministic to assert.
 */

export const FORWARD_REDRIVE_BATCH_SIZE = 100
export const DRIFT_CORRECTION_BATCH_SIZE = 500
export const DRIFT_STALENESS_HOURS = 24

/**
 * A due row younger than this is left to its inline attempt and Stripe's own
 * delivery retries: re-driving a seconds-old obligation would race the
 * webhook's in-flight forward for zero recovery-latency win at a 15-minute
 * sweep cadence.
 */
export const FORWARD_SETTLING_MINUTES = 5

export type BillingReconciliationSweepResult = {
  forwardsRedriven: number
  forwardsFailed: number
  /** Rows whose obligation is unfulfillable (no user or no fetch token). */
  forwardsAbandoned: number
  entitlementsChecked: number
  entitlementsCorrected: number
}

export class BillingReconciliationService {
  private readonly logger = createBaseLogger().child({
    feature: 'billing-reconciliation',
  })

  constructor(
    private readonly prisma: PrismaClient,
    private readonly revenueCat: RevenueCatClient,
    private readonly entitlements: PremiumEntitlementService,
    private readonly telemetry: TelemetryService
  ) {}

  async sweep(): Promise<BillingReconciliationSweepResult> {
    const result: BillingReconciliationSweepResult = {
      forwardsRedriven: 0,
      forwardsFailed: 0,
      forwardsAbandoned: 0,
      entitlementsChecked: 0,
      entitlementsCorrected: 0,
    }

    // Crash isolation: a throw in one duty is logged and must not reach the
    // other duty or the worker. Per-row failures are likewise contained so a
    // single poisoned row cannot stall the rest of a batch.
    try {
      await this.redriveForwards(result)
    } catch (error) {
      this.logger.error({ error }, 'billing_reconciliation_forward_duty_failed')
    }

    try {
      await this.correctDrift(result)
    } catch (error) {
      this.logger.error({ error }, 'billing_reconciliation_drift_duty_failed')
    }

    this.logger.info(result, 'billing_reconciliation_swept')
    return result
  }

  private async redriveForwards(result: BillingReconciliationSweepResult): Promise<void> {
    const settledBefore = new Date(Date.now() - FORWARD_SETTLING_MINUTES * 60 * 1000)
    const dueRows = await this.prisma.billingEvent.findMany({
      where: {
        forward_due: true,
        forwarded_at: null,
        received_at: { lt: settledBefore },
      },
      orderBy: { received_at: 'asc' },
      take: FORWARD_REDRIVE_BATCH_SIZE,
      select: { id: true, user_id: true, payload: true },
    })

    for (const row of dueRows) {
      const payload = row.payload as Partial<BillingEventPayloadProjection> | null
      const fetchToken =
        typeof payload?.fetchToken === 'string' ? payload.fetchToken : null

      if (row.user_id === null || fetchToken === null) {
        // Unfulfillable forever: no user to credit or no receipt pointer to
        // forward. Close the obligation LOUDLY rather than re-scanning it
        // every 15 minutes for eternity; the row itself remains the audit
        // record and the error string says why it was abandoned.
        await this.prisma.billingEvent.update({
          where: { id: row.id },
          data: {
            forward_due: false,
            forward_attempts: { increment: 1 },
            forward_last_error:
              row.user_id === null
                ? 'abandoned: no local user resolved for this event'
                : 'abandoned: no fetch token recorded on this event',
          },
        })
        result.forwardsAbandoned += 1
        this.logger.error(
          { billingEventId: row.id },
          'billing_reconciliation_forward_abandoned'
        )
        continue
      }

      try {
        await this.revenueCat.forwardStripeSubscription(row.user_id, fetchToken)
        await this.prisma.billingEvent.update({
          where: { id: row.id },
          data: {
            forwarded_at: new Date(),
            forward_attempts: { increment: 1 },
            forward_last_error: null,
          },
        })
        result.forwardsRedriven += 1
        // The forward succeeded, so the ledger now owns the subscription;
        // pull it immediately so the user's paid-but-locked window ends with
        // this sweep instead of waiting for the RC webhook.
        await this.pullAndApply(row.user_id)
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error)
        await this.prisma.billingEvent.update({
          where: { id: row.id },
          data: {
            forward_attempts: { increment: 1 },
            forward_last_error: message.slice(0, 500),
          },
        })
        result.forwardsFailed += 1
        this.logger.warn(
          { billingEventId: row.id, error: message },
          'billing_reconciliation_forward_retry_failed'
        )
      }
    }
  }

  private async correctDrift(result: BillingReconciliationSweepResult): Promise<void> {
    const staleBefore = new Date(Date.now() - DRIFT_STALENESS_HOURS * 60 * 60 * 1000)
    const staleRows = await this.prisma.premiumEntitlement.findMany({
      where: { synced_at: { lt: staleBefore } },
      orderBy: { synced_at: 'asc' },
      take: DRIFT_CORRECTION_BATCH_SIZE,
      select: { user_id: true },
    })

    for (const row of staleRows) {
      result.entitlementsChecked += 1
      try {
        const corrected = await this.pullAndApply(row.user_id)
        if (corrected) {
          result.entitlementsCorrected += 1
        }
      } catch (error) {
        // One user's ledger failure must not stall the rest of the batch; the
        // row stays stale and the next sweep retries it.
        this.logger.warn(
          { userId: row.user_id, error },
          'billing_reconciliation_drift_pull_failed'
        )
      }
    }
  }

  /**
   * One ledger pull applied through the same snapshot path the refresh
   * endpoint uses (Decision 4's pull semantics: unconditional, no
   * BillingEvent, audit row on change), with the shared AC 6 emission rules
   * applied fail-open after the write. Returns true when state changed.
   */
  private async pullAndApply(userId: string): Promise<boolean> {
    const state = await this.revenueCat.getSubscriberEntitlement(userId)
    const transition = await this.entitlements.applyLedgerSnapshot(
      userId,
      state,
      randomUUID()
    )
    if (transition === null) {
      return false
    }
    await this.emitTransition(userId, transition)
    return transition.applied && transition.from !== transition.to
  }

  /** Fail-open telemetry, mirroring `SubscriptionService.emitTransition` —
   * that service needs the request app's flag stack, which the worker runtime
   * deliberately does not construct, so the shared emission RULES live in
   * `resolveEntitlementEmission` and only this thin emit shell is duplicated. */
  private async emitTransition(
    userId: string,
    transition: EntitlementTransition
  ): Promise<void> {
    const emission = resolveEntitlementEmission(transition)
    if (!emission) {
      return
    }
    try {
      if (emission.event === 'premium_entitlement_activated') {
        await this.telemetry.captureEvent(userId, 'premium_entitlement_activated', {
          store: emission.store,
          productId: emission.productId,
        })
      } else {
        await this.telemetry.captureEvent(userId, 'premium_entitlement_deactivated', {
          store: emission.store,
          productId: emission.productId,
          reason: emission.reason,
        })
      }
    } catch (error) {
      this.logger.warn({ error, userId }, 'Premium telemetry emission failed (fail-open)')
    }
  }
}
