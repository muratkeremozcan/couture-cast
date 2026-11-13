// Story 5.2 Task 3 step 1 owner: own entitlement reads and writes, including the ordering guard, in `apps/api/src/modules/commerce/premium-entitlement.service.ts`
import { Inject, Injectable } from '@nestjs/common'
import {
  PrismaClient,
  type EntitlementStore,
  type PremiumEntitlement,
  type PremiumEntitlementStatus,
  type Prisma,
} from '@prisma/client'
import { appliesRevenueCatTestStore } from '../../config/runtime-environment.js'
import { createBaseLogger } from '../../logger/pino.config.js'
import {
  ComplimentaryAccessService,
  type ComplimentaryAccessCheck,
} from '../feature-flags/complimentary-access.service.js'
import { RevenueCatClient } from './revenuecat-client.js'
import { StripeBillingClient } from './stripe-client.js'
import { interactiveTransaction } from '../../prisma/prisma-client.js'

/**
 * Story 5.2: the single owner of PremiumEntitlement reads and writes.
 *
 * Our database MIRRORS, never originates, entitlement state: the only writers
 * are {@link applyLedgerEvent} (driven by the RevenueCat webhook and the
 * reconciliation sweep) and {@link applyLedgerSnapshot} (driven by the refresh
 * endpoint's REST pull). Nothing else in this codebase may write the table.
 *
 * EVERY WRITE GOES THROUGH THE DECISION 8 ORDERING GUARD. RevenueCat retries
 * and re-orders deliveries, and it emits RENEWAL + PRODUCT_CHANGE pairs with
 * identical occurred_at at period boundaries, so "newest wins" alone is wrong
 * and "drop equal timestamps" is also wrong. The rule, exactly: apply iff
 * `occurred_at > last_event_occurred_at`, OR `occurred_at ==
 * last_event_occurred_at AND external_event_id != last_event_id` (distinct
 * same-instant events apply in arrival order, which the (provider, event id)
 * idempotency index upstream makes deterministic per event). Strictly-older
 * events are dropped.
 */

/** The subset of entitlement state the status endpoint and guard read. */
export type EntitlementView = {
  status: PremiumEntitlementStatus
  store: EntitlementStore
  productId: string
  willRenew: boolean
  currentPeriodEnd: Date
  syncedAt: Date
}

/** The ledger-derived target state one webhook event or pull row carries. */
export type LedgerEntitlementState = {
  status: PremiumEntitlementStatus
  store: EntitlementStore
  productId: string
  willRenew: boolean
  currentPeriodEnd: Date
}

export type ApplyLedgerEventInput = {
  userId: string
  state: LedgerEntitlementState
  occurredAt: Date
  /** Provider event id; becomes last_event_id when applied. */
  eventId: string
  /** BillingProvider label recorded in the audit row. */
  provider: 'stripe' | 'revenuecat'
}

export type EntitlementTransition = {
  applied: boolean
  /** 'none' when no row existed before the write. */
  from: PremiumEntitlementStatus | 'none'
  to: PremiumEntitlementStatus
  store: EntitlementStore
  productId: string
}

const statusOf = (row: PremiumEntitlement | null): PremiumEntitlementStatus | 'none' =>
  row?.status ?? 'none'

/**
 * Story 6.15 D15: whether this API honors a mirror row from `store`. A `test_store` row counts
 * only where {@link appliesRevenueCatTestStore} holds. Elsewhere (an API whose TEST_ENV is unset,
 * staging or production reading a preview database or a restored dump) the row is no paid access,
 * reads as absent, and a transfer never moves it.
 */
export function honorsEntitlementStore(store: EntitlementStore): boolean {
  return store !== 'test_store' || appliesRevenueCatTestStore()
}

/**
 * The ledger writers' view of the existing mirror row: a row from a store this API does not
 * honor counts as absent, so the next write starts from `none` (audit row and activation
 * telemetry included), its ordering cursor cannot discard a real event, and a null snapshot
 * over it writes nothing (story 6.15 D15 r6).
 */
function honoredRow(row: PremiumEntitlement | null): PremiumEntitlement | null {
  return row !== null && honorsEntitlementStore(row.store) ? row : null
}

export type EntitlementTelemetryEmission =
  | {
      event: 'premium_entitlement_activated'
      store: EntitlementStore
      productId: string
    }
  | {
      event: 'premium_entitlement_deactivated'
      store: EntitlementStore
      productId: string
      reason: 'expired' | 'revoked' | 'transferred'
    }

/**
 * The AC 6 emission rules, in one shared pure function so the refresh path,
 * the webhook service, and the reconciliation sweep cannot drift:
 *
 *   - activated fires on transitions INTO `active` from absent/expired/revoked
 *     (and TRANSFER-gain, which is the absent→active case for the gainer);
 *     grace_period→active fires nothing — grace never lost access.
 *   - deactivated fires on transitions INTO `expired` or `revoked`, with a
 *     reason; TRANSFER-loss passes `reasonOverride: 'transferred'`.
 *   - grace_period entry/exit fires neither.
 */
export function resolveEntitlementEmission(
  transition: EntitlementTransition,
  reasonOverride?: 'transferred'
): EntitlementTelemetryEmission | null {
  if (!transition.applied || transition.from === transition.to) {
    return null
  }

  const base = { store: transition.store, productId: transition.productId }

  if (
    transition.to === 'active' &&
    (transition.from === 'none' ||
      transition.from === 'expired' ||
      transition.from === 'revoked')
  ) {
    return { event: 'premium_entitlement_activated', ...base }
  }

  if (transition.to === 'expired') {
    return { event: 'premium_entitlement_deactivated', ...base, reason: 'expired' }
  }

  if (transition.to === 'revoked') {
    return {
      event: 'premium_entitlement_deactivated',
      ...base,
      reason: reasonOverride ?? 'revoked',
    }
  }

  return null
}

@Injectable()
export class PremiumEntitlementService {
  private readonly logger = createBaseLogger().child({ feature: 'premium-entitlement' })

  constructor(
    @Inject(PrismaClient) private readonly prisma: PrismaClient,
    @Inject(RevenueCatClient) private readonly revenueCat: RevenueCatClient,
    @Inject(StripeBillingClient) private readonly stripeBilling: StripeBillingClient,
    // Story 6.14 D5: read-side only. No ledger write path in this class consults it.
    @Inject(ComplimentaryAccessService)
    private readonly complimentary: Pick<ComplimentaryAccessService, 'isActive' | 'check'>
  ) {}

  /**
   * Processor-side erasure (Decision 7): account deletion must un-share what
   * the AC 7 disclosure names — delete the RevenueCat subscriber, and the
   * Stripe customer when a `BillingCustomer` mapping exists. No deletion flow
   * exists in this codebase yet; the future account-deletion story owns the
   * wiring and MAY NOT ship without calling this (Open question 5 is the
   * binding record — grep for `eraseProcessorData` finds both).
   *
   * Deliberately NOT fail-open: a deletion flow must know erasure did not
   * happen, so failures propagate to the caller. Local rows are not touched
   * here — user deletion cascades `PremiumEntitlement`/`BillingCustomer` and
   * `BillingEvent.user_id` goes `SetNull` by design.
   */
  async eraseProcessorData(userId: string): Promise<void> {
    await this.revenueCat.deleteSubscriber(userId)

    const billingCustomer = await this.prisma.billingCustomer.findUnique({
      where: { user_id: userId },
      select: { stripe_customer_id: true },
    })
    if (billingCustomer) {
      await this.stripeBilling.deleteCustomer(billingCustomer.stripe_customer_id)
    }

    this.logger.info({ userId }, 'Processor-side billing data erased')
  }

  /**
   * Null means "never subscribed"; the controller serializes that as status 'none'. A row from
   * a store this API does not honor reads as absent (story 6.15 D15), for the status read, the
   * refresh answer and the checkout and portal guards alike.
   */
  async getEntitlement(userId: string): Promise<EntitlementView | null> {
    const row = await this.prisma.premiumEntitlement.findUnique({
      where: { user_id: userId },
    })
    if (!row || !honorsEntitlementStore(row.store)) {
      return null
    }
    return {
      status: row.status,
      store: row.store,
      productId: row.product_id,
      willRenew: row.will_renew,
      currentPeriodEnd: row.current_period_end,
      syncedAt: row.synced_at,
    }
  }

  /**
   * The guard's one question. Grace period keeps access on purpose: store
   * guidance is not to punish a card hiccup, and BILLING_ISSUE ends in either
   * RENEWAL or EXPIRATION, both of which resolve this properly.
   */
  async hasPremiumAccess(userId: string): Promise<boolean> {
    // Story 6.14 D5 (TEA-16): the paid row first; a grant is asked only when it does not entitle.
    if (await this.hasPaidAccess(userId)) return true
    return this.complimentary.isActive(userId)
  }

  /**
   * Story 6.14 D6: where premium access comes from. A complimentary grant wins when both apply,
   * so the member sees the grant. Nothing here writes, and a revoke leaves the answer to the
   * paid row again on the next request.
   */
  async premiumAccessSource(
    userId: string
  ): Promise<'subscription' | 'complimentary' | 'none'> {
    const [paid, complimentary] = await Promise.all([
      this.hasPaidAccess(userId),
      this.complimentary.isActive(userId),
    ])
    if (complimentary) return 'complimentary'
    return paid ? 'subscription' : 'none'
  }

  /**
   * Story 6.14 D5: the three-way grant answer for checkout, which must not fail open: a
   * grantee whose grant cannot be read right now is not sold what they may already have.
   */
  complimentaryAccessCheck(userId: string): Promise<ComplimentaryAccessCheck> {
    return this.complimentary.check(userId)
  }

  private async hasPaidAccess(userId: string): Promise<boolean> {
    const row = await this.prisma.premiumEntitlement.findUnique({
      where: { user_id: userId },
      select: { status: true, store: true },
    })
    if (!row || !honorsEntitlementStore(row.store)) return false
    return row.status === 'active' || row.status === 'grace_period'
  }

  /**
   * Applies one provider event inside the caller's transaction, enforcing the
   * ordering guard and writing the audit row on any state change. The caller
   * (webhook service / reconciliation sweep) owns recording the BillingEvent
   * and emitting telemetry AFTER the transaction commits — a telemetry emit
   * inside the transaction would let a degraded PostHog fail a billing webhook.
   */
  async applyLedgerEvent(
    tx: Prisma.TransactionClient,
    input: ApplyLedgerEventInput
  ): Promise<EntitlementTransition> {
    const existing = honoredRow(
      await tx.premiumEntitlement.findUnique({ where: { user_id: input.userId } })
    )

    if (existing && !this.shouldApply(existing, input.occurredAt, input.eventId)) {
      return {
        applied: false,
        from: existing.status,
        to: existing.status,
        store: existing.store,
        productId: existing.product_id,
      }
    }

    const from = statusOf(existing)
    const syncedAt = new Date()

    await tx.premiumEntitlement.upsert({
      where: { user_id: input.userId },
      create: {
        user_id: input.userId,
        status: input.state.status,
        store: input.state.store,
        product_id: input.state.productId,
        will_renew: input.state.willRenew,
        current_period_end: input.state.currentPeriodEnd,
        synced_at: syncedAt,
        last_event_occurred_at: input.occurredAt,
        last_event_id: input.eventId,
      },
      update: {
        status: input.state.status,
        store: input.state.store,
        product_id: input.state.productId,
        will_renew: input.state.willRenew,
        current_period_end: input.state.currentPeriodEnd,
        synced_at: syncedAt,
        last_event_occurred_at: input.occurredAt,
        last_event_id: input.eventId,
      },
    })

    if (from !== input.state.status) {
      await this.writeAuditRow(tx, input.userId, from, input.state, input.provider)
    }

    return {
      applied: true,
      from,
      to: input.state.status,
      store: input.state.store,
      productId: input.state.productId,
    }
  }

  /**
   * Applies a REST ledger pull. A pull is a SYNC, not an event: it applies the
   * snapshot unconditionally (the ledger is authoritative "as of now"), writes
   * no BillingEvent, stamps synced_at, and sets the ordering cursor to the
   * pull's server-clock timestamp with a `pull:<id>` event id — so a
   * later-arriving webhook event older than the pull is correctly dropped by
   * the guard above, because the pull already reflected it.
   *
   * `state: null` means the ledger reports no premium entitlement. With no
   * local row that is a no-op; with a local non-expired row it applies the
   * downgrade the ledger asserts (status expired, will_renew false) — the
   * reconciliation sweep's drift-correction case.
   */
  async applyLedgerSnapshot(
    userId: string,
    state: LedgerEntitlementState | null,
    pullId: string
  ): Promise<EntitlementTransition | null> {
    const occurredAt = new Date()
    const eventId = `pull:${pullId}`

    return interactiveTransaction(this.prisma, async (tx) => {
      const existing = honoredRow(
        await tx.premiumEntitlement.findUnique({ where: { user_id: userId } })
      )

      if (!state) {
        if (!existing) {
          return null
        }
        if (existing.status === 'expired' || existing.status === 'revoked') {
          // Already downgraded; just record the successful sync instant.
          await tx.premiumEntitlement.update({
            where: { user_id: userId },
            data: {
              synced_at: occurredAt,
              last_event_occurred_at: occurredAt,
              last_event_id: eventId,
            },
          })
          return null
        }
        const downgrade: LedgerEntitlementState = {
          status: 'expired',
          store: existing.store,
          productId: existing.product_id,
          willRenew: false,
          currentPeriodEnd: existing.current_period_end,
        }
        return this.applyLedgerEvent(tx, {
          userId,
          state: downgrade,
          occurredAt,
          eventId,
          provider: 'revenuecat',
        })
      }

      const from = statusOf(existing)

      await tx.premiumEntitlement.upsert({
        where: { user_id: userId },
        create: {
          user_id: userId,
          status: state.status,
          store: state.store,
          product_id: state.productId,
          will_renew: state.willRenew,
          current_period_end: state.currentPeriodEnd,
          synced_at: occurredAt,
          last_event_occurred_at: occurredAt,
          last_event_id: eventId,
        },
        update: {
          status: state.status,
          store: state.store,
          product_id: state.productId,
          will_renew: state.willRenew,
          current_period_end: state.currentPeriodEnd,
          synced_at: occurredAt,
          last_event_occurred_at: occurredAt,
          last_event_id: eventId,
        },
      })

      if (from !== state.status) {
        await this.writeAuditRow(tx, userId, from, state, 'revenuecat')
      }

      return {
        applied: true,
        from,
        to: state.status,
        store: state.store,
        productId: state.productId,
      }
    })
  }

  /** The Decision 8 rule, verbatim. */
  private shouldApply(
    existing: Pick<PremiumEntitlement, 'last_event_occurred_at' | 'last_event_id'>,
    occurredAt: Date,
    eventId: string
  ): boolean {
    const last = existing.last_event_occurred_at.getTime()
    const incoming = occurredAt.getTime()
    if (incoming > last) {
      return true
    }
    return incoming === last && eventId !== existing.last_event_id
  }

  private async writeAuditRow(
    tx: Prisma.TransactionClient,
    userId: string,
    from: PremiumEntitlementStatus | 'none',
    state: LedgerEntitlementState,
    provider: 'stripe' | 'revenuecat'
  ): Promise<void> {
    await tx.auditLog.create({
      data: {
        user_id: userId,
        event_type: 'premium_entitlement_changed',
        event_data: {
          from,
          to: state.status,
          store: state.store,
          productId: state.productId,
          provider,
        },
        ip_address: null,
      },
    })
  }
}
