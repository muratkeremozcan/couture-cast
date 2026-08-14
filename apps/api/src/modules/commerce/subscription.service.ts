import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import {
  SUBSCRIPTION_LEDGER_UNAVAILABLE_MESSAGE,
  type Subscription,
} from '../../contracts/http.js'
import { createBaseLogger } from '../../logger/pino.config.js'
import { FeatureFlagsService } from '../feature-flags/feature-flags.service.js'
import { TelemetryService } from '../telemetry/telemetry.service.js'
import {
  PremiumEntitlementService,
  resolveEntitlementEmission,
  type EntitlementTransition,
  type EntitlementView,
} from './premium-entitlement.service.js'
import {
  RevenueCatClient,
  type RevenueCatSubscriberEntitlement,
} from './revenuecat-client.js'

/**
 * Story 5.2: the subscription status read and the on-demand ledger refresh.
 *
 * The status endpoint reads the local mirror only — it must stay fast and must
 * keep working through a RevenueCat outage, because already-synced entitlements
 * are served from here. The refresh endpoint is the client-initiated half of
 * the 2-minute sync guarantee: it pulls the ledger synchronously when a webhook
 * is late, bounded by the rate limit below so a polling client cannot become a
 * ledger hammer.
 */

/** Minimum spacing between real ledger pulls per user; inside it, local state. */
const REFRESH_MIN_INTERVAL_MS = 10_000

/** Hard cap on one ledger pull; past it the refresh answers 503, not hangs. */
const LEDGER_TIMEOUT_MS = 15_000

@Injectable()
export class SubscriptionService {
  private readonly logger = createBaseLogger().child({ feature: 'commerce-subscription' })

  /** Per-user in-flight pull, so concurrent refreshes share one ledger call. */
  private readonly inFlight = new Map<string, Promise<void>>()
  private readonly lastPulledAt = new Map<string, number>()

  constructor(
    @Inject(PremiumEntitlementService)
    private readonly entitlements: PremiumEntitlementService,
    @Inject(FeatureFlagsService)
    private readonly featureFlags: FeatureFlagsService,
    @Inject(TelemetryService)
    private readonly telemetry: TelemetryService,
    @Inject(RevenueCatClient)
    private readonly revenueCat: RevenueCatClient
  ) {}

  /**
   * Test hook: clears the per-user pull throttle. The window state is
   * process-local by design (a per-instance limiter, not a distributed one),
   * which also means a suite that exercises several refresh behaviours against
   * one user needs to clear it between cases.
   */
  resetRefreshThrottle(): void {
    this.lastPulledAt.clear()
    this.inFlight.clear()
  }

  async getSubscription(userId: string): Promise<Subscription> {
    const [entitlement, purchasesEnabled] = await Promise.all([
      this.entitlements.getEntitlement(userId),
      this.resolvePurchasesEnabled(userId),
    ])
    return this.serialize(entitlement, purchasesEnabled)
  }

  /**
   * Pull the ledger, apply the snapshot, and return the resulting state.
   * Inside the rate-limit window the LOCAL state is served instead — the
   * response carries `syncedAt`, so a caller can tell which happened. A ledger
   * failure is an honest 503, never stale-state-as-fresh.
   */
  async refreshSubscription(userId: string): Promise<Subscription> {
    const last = this.lastPulledAt.get(userId)
    const withinWindow = last !== undefined && Date.now() - last < REFRESH_MIN_INTERVAL_MS

    if (!withinWindow) {
      const pull = this.inFlight.get(userId) ?? this.pullAndApply(userId)
      this.inFlight.set(userId, pull)
      try {
        await pull
      } finally {
        if (this.inFlight.get(userId) === pull) {
          this.inFlight.delete(userId)
        }
      }
    }

    return this.getSubscription(userId)
  }

  private async pullAndApply(userId: string): Promise<void> {
    let state: RevenueCatSubscriberEntitlement
    try {
      state = await this.withTimeout(
        this.revenueCat.getSubscriberEntitlement(userId),
        LEDGER_TIMEOUT_MS
      )
    } catch (error) {
      this.logger.warn({ error, userId }, 'RevenueCat ledger pull failed')
      throw new ServiceUnavailableException(SUBSCRIPTION_LEDGER_UNAVAILABLE_MESSAGE)
    }

    // Stamped only after a SUCCESSFUL pull: a failed pull must not start the
    // rate-limit window, or a transient outage would pin clients to local
    // state for its duration plus ten seconds.
    this.lastPulledAt.set(userId, Date.now())

    const transition = await this.entitlements.applyLedgerSnapshot(
      userId,
      state,
      randomUUID()
    )
    if (transition) {
      await this.emitTransition(userId, transition)
    }
  }

  /**
   * Telemetry AFTER the transaction, fail-open: a degraded PostHog must never
   * fail a refresh (5.1 Decision 12 verbatim). Exposed for reuse by the
   * webhook service and the reconciliation sweep, which share the emission
   * rules through {@link resolveEntitlementEmission}.
   */
  async emitTransition(
    userId: string,
    transition: EntitlementTransition,
    reasonOverride?: 'transferred'
  ): Promise<void> {
    const emission = resolveEntitlementEmission(transition, reasonOverride)
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

  private async resolvePurchasesEnabled(userId: string): Promise<boolean> {
    const flagEnabled = await this.featureFlags.getFeatureFlag(
      'commerce_subscription_enabled',
      userId
    )
    // Truthiness rather than `!== true`: `FeatureFlagValue` narrows this key to
    // its literal default `false`, so an equality comparison has no overlap.
    return Boolean(flagEnabled)
  }

  private serialize(
    entitlement: EntitlementView | null,
    purchasesEnabled: boolean
  ): Subscription {
    if (!entitlement) {
      // Wire-only 'none': an absent row IS "never subscribed". The keys are
      // serialized as nulls so the response shape never varies.
      return {
        status: 'none',
        store: null,
        productId: null,
        willRenew: null,
        currentPeriodEnd: null,
        syncedAt: null,
        purchasesEnabled,
      }
    }
    return {
      status: entitlement.status,
      store: entitlement.store,
      productId: entitlement.productId,
      willRenew: entitlement.willRenew,
      currentPeriodEnd: entitlement.currentPeriodEnd.toISOString(),
      syncedAt: entitlement.syncedAt.toISOString(),
      purchasesEnabled,
    }
  }

  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    let timer: NodeJS.Timeout | undefined
    try {
      return await Promise.race([
        promise,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('RevenueCat ledger pull timed out')),
            timeoutMs
          )
        }),
      ])
    } finally {
      clearTimeout(timer)
    }
  }
}
