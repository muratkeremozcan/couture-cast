import {
  ConflictException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common'
import { PrismaClient } from '@prisma/client'
import {
  COMMERCE_SUBSCRIPTION_DISABLED_MESSAGE,
  SUBSCRIPTION_ALREADY_ACTIVE_MESSAGE,
  SUBSCRIPTION_NOT_FOUND_MESSAGE,
  SUBSCRIPTION_NOT_WEB_MANAGED_MESSAGE,
  type SubscriptionPlan,
} from '../../contracts/http.js'
import { createBaseLogger } from '../../logger/pino.config.js'
import { FeatureFlagsService } from '../feature-flags/feature-flags.service.js'
import { TelemetryService } from '../telemetry/telemetry.service.js'
import { PremiumEntitlementService } from './premium-entitlement.service.js'
import { resolveStripePriceId, StripeBillingClient } from './stripe-client.js'

/**
 * Story 5.2 Task 4: Stripe Checkout and Customer Portal session creation.
 *
 * Status precedence for checkout-session is FIXED so assertions stay
 * deterministic (Decision 4): 503 kill switch → 400 schema (the controller's
 * Zod parse) → 409 already subscribed → 500 Stripe failure. The kill switch
 * gates ONLY checkout-session creation: portal-session always works, because a
 * paying user must always be able to cancel (AC 5).
 *
 * The Stripe customer is created-or-reused AT SESSION-CREATION TIME and
 * `BillingCustomer` upserted then — not at webhook time — so an abandoned
 * checkout still leaves a portal-capable customer and the webhook can resolve
 * the user by customer id as its second linkage path.
 */

/** Return/cancel URLs land on the settings page (Decision 12); no new routes. */
function resolveWebBaseUrl(): string {
  const configured =
    process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
  return configured.replace(/\/+$/, '')
}

@Injectable()
export class StripeBillingService {
  private readonly logger = createBaseLogger().child({ feature: 'stripe-billing' })

  constructor(
    @Inject(PrismaClient) private readonly prisma: PrismaClient,
    @Inject(FeatureFlagsService) private readonly featureFlags: FeatureFlagsService,
    @Inject(PremiumEntitlementService)
    private readonly entitlements: PremiumEntitlementService,
    @Inject(TelemetryService) private readonly telemetry: TelemetryService,
    @Inject(StripeBillingClient) private readonly stripe: StripeBillingClient
  ) {}

  /**
   * The AC 5 kill switch, as a 503. Public because the controller runs it
   * BEFORE parsing the request body — Decision 4's precedence puts the 503
   * above the 400, so a disabled rail answers 503 even to a malformed body.
   */
  async assertPurchasingEnabled(userId: string): Promise<void> {
    const flagEnabled = await this.featureFlags.getFeatureFlag(
      'commerce_subscription_enabled',
      userId
    )
    // Truthiness rather than `!== true`: `FeatureFlagValue` narrows this key to
    // its literal default `false`, so an equality comparison has no overlap.
    if (!flagEnabled) {
      throw new ServiceUnavailableException(COMMERCE_SUBSCRIPTION_DISABLED_MESSAGE)
    }
  }

  async createCheckoutSession(
    userId: string,
    plan: SubscriptionPlan
  ): Promise<{ url: string }> {
    // Re-asserted here (the controller already did) so the service is safe on
    // its own: no future caller can reach Stripe with the kill switch off.
    await this.assertPurchasingEnabled(userId)

    const entitlement = await this.entitlements.getEntitlement(userId)
    if (entitlement?.status === 'active' || entitlement?.status === 'grace_period') {
      throw new ConflictException(SUBSCRIPTION_ALREADY_ACTIVE_MESSAGE)
    }

    const baseUrl = resolveWebBaseUrl()
    let session: { url: string }
    try {
      const customerId = await this.ensureBillingCustomer(userId)
      session = await this.stripe.createCheckoutSession({
        customerId,
        priceId: resolveStripePriceId(plan),
        userId,
        plan,
        successUrl: `${baseUrl}/settings?checkout=success`,
        cancelUrl: `${baseUrl}/settings?checkout=cancelled`,
      })
    } catch (error) {
      // The honest 500 (5.1 Decision 7 stance): a Stripe outage or a missing
      // key is a server-side failure, never a silent skip or a fake URL.
      this.logger.error({ error, userId }, 'Stripe checkout session creation failed')
      throw new InternalServerErrorException()
    }

    await this.emitCheckoutStarted(userId, plan)

    return { url: session.url }
  }

  async createPortalSession(userId: string): Promise<{ url: string }> {
    const billingCustomer = await this.prisma.billingCustomer.findUnique({
      where: { user_id: userId },
    })
    if (!billingCustomer) {
      throw new NotFoundException(SUBSCRIPTION_NOT_FOUND_MESSAGE)
    }

    // A store-managed subscription cannot be managed in the Stripe portal; the
    // client normally shows the "manage in the App Store / Play Store" hint
    // instead of calling, but the server still answers correctly when called.
    // An absent entitlement does NOT 409: a lapsed web subscriber must still
    // reach the portal to manage payment methods and history.
    const entitlement = await this.entitlements.getEntitlement(userId)
    if (entitlement && entitlement.store !== 'stripe') {
      throw new ConflictException(SUBSCRIPTION_NOT_WEB_MANAGED_MESSAGE)
    }

    try {
      const session = await this.stripe.createPortalSession(
        billingCustomer.stripe_customer_id,
        `${resolveWebBaseUrl()}/settings?portal=return`
      )
      return { url: session.url }
    } catch (error) {
      this.logger.error({ error, userId }, 'Stripe portal session creation failed')
      throw new InternalServerErrorException()
    }
  }

  /**
   * Create-or-reuse the Stripe customer and mirror it in `BillingCustomer`.
   * The unique index on `user_id` makes a concurrent double-create resolve to
   * one row; the loser's Stripe customer is orphaned but harmless (no payment
   * method, no subscription), so no compensating delete is attempted.
   */
  private async ensureBillingCustomer(userId: string): Promise<string> {
    const existing = await this.prisma.billingCustomer.findUnique({
      where: { user_id: userId },
    })
    if (existing) {
      return existing.stripe_customer_id
    }

    const customerId = await this.stripe.createCustomer(userId)
    const row = await this.prisma.billingCustomer.upsert({
      where: { user_id: userId },
      create: { user_id: userId, stripe_customer_id: customerId },
      // A concurrent request won the race: keep its mapping, use its customer.
      update: {},
    })
    return row.stripe_customer_id
  }

  /**
   * AC 6: `premium_checkout_started` fires on checkout-session creation —
   * web-only by construction, since sessions exist only on this rail. After
   * the session exists, fail-open: a degraded PostHog must never turn a
   * created session into an error response.
   */
  private async emitCheckoutStarted(
    userId: string,
    plan: SubscriptionPlan
  ): Promise<void> {
    try {
      await this.telemetry.captureEvent(userId, 'premium_checkout_started', { plan })
    } catch (error) {
      this.logger.warn(
        { error, userId },
        'premium_checkout_started emission failed (fail-open)'
      )
    }
  }
}
