import {
  Body,
  Controller,
  Headers,
  HttpStatus,
  Inject,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common'
import type { Response } from 'express'
import {
  affiliateClickRequestSchema,
  type AffiliateClickRequest,
  type AffiliateClickResponse,
} from '../../contracts/http.js'
import { toBadRequest } from '../../controllers/error-helpers.js'
import { AuthContext } from '../auth/security.decorators.js'
import { RequestAuthGuard } from '../auth/security.guards.js'
import type { RequestAuthContext } from '../auth/security.types.js'
import { AffiliateClickService } from './affiliate-click.service.js'

/**
 * Story 5.1 AC 2: mint one attributed click and return the outbound partner URL.
 *
 * `201` on a fresh mint, `200` on a deduped replay inside 60 seconds, matching
 * the `createMyFormUploadUrl` / `commitGarment` convention. The status is set on
 * the response object rather than declared with `@HttpCode`, because it depends
 * on what the service found; `apps/api/integration/commerce-affiliate-clicks.integration.spec.ts`
 * asserts the distinction over real HTTP, which is the lesson Story 4.4 paid for.
 */
@Controller('/api/v1/commerce/affiliate/clicks')
@UseGuards(RequestAuthGuard)
export class AffiliateClickController {
  constructor(
    @Inject(AffiliateClickService)
    private readonly clickService: AffiliateClickService
  ) {}

  @Post()
  async recordClick(
    @AuthContext() auth: RequestAuthContext,
    @Body() rawBody: unknown,
    @Res({ passthrough: true }) res: Response,
    @Headers('accept-language') acceptLanguage?: string
  ): Promise<AffiliateClickResponse> {
    let body: AffiliateClickRequest
    try {
      body = affiliateClickRequestSchema.parse(rawBody)
    } catch (error) {
      return toBadRequest(error)
    }

    const result = await this.clickService.recordClick({
      ...body,
      userId: auth.userId,
      acceptLanguage,
    })

    res.status(result.created ? HttpStatus.CREATED : HttpStatus.OK)

    return { data: { redirectUrl: result.redirectUrl } }
  }
}
