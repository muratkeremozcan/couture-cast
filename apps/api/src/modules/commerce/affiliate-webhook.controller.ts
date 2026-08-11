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
import type { AffiliateWebhookResponse } from '../../contracts/http.js'
import { AffiliateWebhookService } from './affiliate-webhook.service.js'

/** The one route excluded from `api_error_occurred` capture, by exact path. */
export const AFFILIATE_WEBHOOK_ROUTE = '/api/v1/commerce/affiliate/webhook'

@Controller('api/v1/commerce/affiliate')
export class AffiliateWebhookController {
  constructor(
    @Inject(AffiliateWebhookService)
    private readonly webhookService: AffiliateWebhookService
  ) {}

  /**
   * Machine-to-machine. There is deliberately **no `@UseGuards`** here, and that
   * omission is the whole authentication story for this route.
   *
   * It is safe because this app wires no global guard: `app.module.ts` registers
   * no `APP_GUARD` and `RequestAuthGuard` is applied per controller. So omitting
   * the decorator leaves the route open to unauthenticated callers by design, and
   * the HMAC signature over the raw bytes is what authenticates it instead. The
   * integration suite asserts the route is reachable with no `Authorization`
   * header, so a future global guard cannot silently break every partner.
   *
   * 200 rather than the POST default of 201: nothing is created from the caller's
   * point of view, and a replay that writes nothing must be indistinguishable
   * from a first delivery so a partner's retry logic settles.
   */
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  async recordConversion(
    @Headers('x-couture-partner-id') partnerId: string | undefined,
    @Headers('x-couture-timestamp') timestamp: string | undefined,
    @Headers('x-couture-signature') signature: string | undefined,
    // `request.rawBody`, never `@Body()`: the signature covers the exact bytes
    // that arrived, and a re-serialized body differs from them in key order and
    // whitespace without differing in meaning.
    @Req() request: RawBodyRequest<Request>
  ): Promise<AffiliateWebhookResponse> {
    return this.webhookService.recordConversion({
      partnerId,
      timestamp,
      signature,
      rawBody: request.rawBody,
    })
  }
}
