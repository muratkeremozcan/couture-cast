import {
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
  type RawBodyRequest,
} from '@nestjs/common'
import type { Request } from 'express'
import type { BillingWebhookResponse } from '../../contracts/http.js'
import { BillingWebhookService } from './billing-webhook.service.js'

/** Excluded from `api_error_occurred` capture, by exact path (5.1 reasoning). */
export const STRIPE_WEBHOOK_ROUTE = '/api/v1/commerce/subscription/webhooks/stripe'
export const REVENUECAT_WEBHOOK_ROUTE =
  '/api/v1/commerce/subscription/webhooks/revenuecat'

/**
 * Story 5.2 Tasks 4+5: both billing webhook rails.
 *
 * Machine-to-machine. There is deliberately **no `@UseGuards`** on either
 * route, and that omission is the whole authentication story: this app wires
 * no global guard, so omitting the decorator leaves the routes open to
 * unauthenticated callers by design, and the provider credential over the raw
 * bytes (Stripe HMAC signature / RevenueCat Authorization header) is what
 * authenticates them instead. The integration suites assert both routes are
 * reachable with no bearer token, so a future global guard cannot silently
 * break every provider delivery.
 *
 * 200 rather than the POST default of 201 on both: nothing is created from the
 * provider's point of view, and a replay that writes nothing must be
 * indistinguishable from a first delivery so provider retry logic settles.
 */
@Controller('api/v1/commerce/subscription/webhooks')
export class BillingWebhookController {
  constructor(
    @Inject(BillingWebhookService)
    private readonly webhooks: BillingWebhookService
  ) {}

  @Post('stripe')
  @HttpCode(HttpStatus.OK)
  async receiveStripeEvent(
    @Headers('stripe-signature') signature: string | undefined,
    // `request.rawBody`, never `@Body()`: the signature covers the exact bytes
    // that arrived, and a re-serialized body differs from them in key order
    // and whitespace without differing in meaning.
    @Req() request: RawBodyRequest<Request>
  ): Promise<BillingWebhookResponse> {
    return this.webhooks.handleStripeWebhook({
      signature,
      rawBody: request.rawBody,
    })
  }

  @Post('revenuecat')
  @HttpCode(HttpStatus.OK)
  async receiveRevenueCatEvent(
    @Headers('authorization') authorization: string | undefined,
    @Req() request: RawBodyRequest<Request>
  ): Promise<BillingWebhookResponse> {
    return this.webhooks.handleRevenueCatWebhook({
      authorization,
      rawBody: request.rawBody,
    })
  }
}
