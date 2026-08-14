import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  UseGuards,
} from '@nestjs/common'
import {
  checkoutSessionRequestSchema,
  type CheckoutSessionRequest,
  type CheckoutSessionResponse,
  type PortalSessionResponse,
  type SubscriptionResponse,
} from '../../contracts/http.js'
import { toBadRequest } from '../../controllers/error-helpers.js'
import { AuthContext } from '../auth/security.decorators.js'
import { RequestAuthGuard } from '../auth/security.guards.js'
import type { RequestAuthContext } from '../auth/security.types.js'
import { StripeBillingService } from './stripe-billing.service.js'
import { SubscriptionService } from './subscription.service.js'

/**
 * Story 5.2 AC 1/2: the subscription status surface, plus the Stripe rail's
 * session endpoints (Task 4).
 *
 * Only checkout-session is gated by `commerce_subscription_enabled` — a paying
 * user must always be able to see their subscription state and reach the
 * portal to cancel, including while purchasing is switched off. The kill
 * switch reaches clients only as the server-evaluated `purchasesEnabled` field
 * on the status responses.
 *
 * No route takes an id parameter, and none may ever be added: the acting
 * user from `RequestAuthGuard` is the only subject these endpoints can answer
 * about, which is the cross-user authorization story (5.2-API-014) enforced by
 * construction.
 *
 * `Cache-Control: private, no-store` comes from CommerceCacheHeadersMiddleware
 * via the `/api/v1/commerce{/*path}` binding, so it survives error paths too.
 */
@Controller('/api/v1/commerce/subscription')
@UseGuards(RequestAuthGuard)
export class SubscriptionController {
  constructor(
    @Inject(SubscriptionService)
    private readonly subscriptions: SubscriptionService,
    @Inject(StripeBillingService)
    private readonly stripeBilling: StripeBillingService
  ) {}

  @Get()
  async getSubscription(
    @AuthContext() auth: RequestAuthContext
  ): Promise<SubscriptionResponse> {
    return { data: await this.subscriptions.getSubscription(auth.userId) }
  }

  /**
   * 200 rather than 201: a refresh creates nothing, it re-reads the ledger.
   * Rate limiting and the 503 ledger-unavailable path live in the service.
   */
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refreshSubscription(
    @AuthContext() auth: RequestAuthContext
  ): Promise<SubscriptionResponse> {
    return { data: await this.subscriptions.refreshSubscription(auth.userId) }
  }

  /**
   * Status precedence (Decision 4): 503 kill switch → 400 schema → 409 already
   * subscribed → 500 Stripe failure. `parseCheckoutRequest` asserts the flag
   * before parsing so the 503 outranks the 400; the service owns the rest.
   */
  @Post('checkout-session')
  async createCheckoutSession(
    @AuthContext() auth: RequestAuthContext,
    @Body() rawBody: unknown
  ): Promise<CheckoutSessionResponse> {
    const input = await this.parseCheckoutRequest(auth.userId, rawBody)
    return {
      data: await this.stripeBilling.createCheckoutSession(auth.userId, input.plan),
    }
  }

  @Post('portal-session')
  async createPortalSession(
    @AuthContext() auth: RequestAuthContext
  ): Promise<PortalSessionResponse> {
    return { data: await this.stripeBilling.createPortalSession(auth.userId) }
  }

  /**
   * Decision 4's precedence puts the 503 kill switch ABOVE the 400 schema
   * error, so the flag is evaluated before the body is parsed. A disabled
   * rail answers 503 to every checkout attempt, well-formed or not.
   */
  private async parseCheckoutRequest(
    userId: string,
    rawBody: unknown
  ): Promise<CheckoutSessionRequest> {
    await this.stripeBilling.assertPurchasingEnabled(userId)
    try {
      return checkoutSessionRequestSchema.parse(rawBody)
    } catch (error) {
      return toBadRequest(error)
    }
  }
}
