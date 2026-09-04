// Story 5.5 Decision 6: `api/v1/commerce/premium/planner` deliberately lives
// in PersonalizationModule, not CommerceModule -- the generation engine and
// weather/comfort/wardrobe reads it needs already live here. The
// commerce-prefixed path still inherits CommerceCacheHeadersMiddleware's
// `Cache-Control: private, no-store` (registered by path pattern in
// CommerceModule, not by controller ownership), which is why the prefix
// stays even though the controller does not.
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common'
import { RequestAuthGuard } from '../auth/security.guards.js'
import { AuthContext } from '../auth/security.decorators.js'
import type { RequestAuthContext } from '../auth/security.types.js'
import { PremiumEntitlementGuard } from '../commerce/premium-entitlement.guard.js'
import { PlannerService } from './planner.service.js'
import {
  plannerHeadersSchema,
  plannerQueryParamsSchema,
  plannerReshuffleInputSchema,
  type PlannerResponse,
  type PlannerReshuffleResponse,
} from '../../contracts/http.js'

@Controller('api/v1/commerce/premium/planner')
export class PlannerController {
  constructor(
    @Inject(PlannerService)
    private readonly planner: PlannerService
  ) {}

  private resolvePlatform(header: string | undefined): 'web' | 'mobile' {
    const parsed = plannerHeadersSchema.safeParse({ 'x-couture-platform': header })
    if (!parsed.success) {
      throw new BadRequestException('Missing or invalid x-couture-platform header')
    }
    return parsed.data['x-couture-platform']
  }

  @Get()
  @UseGuards(RequestAuthGuard, PremiumEntitlementGuard)
  async getPlannerWindow(
    @AuthContext() auth: RequestAuthContext,
    @Query() rawQuery: Record<string, unknown>,
    @Headers('accept-language') acceptLanguage: string | undefined,
    @Headers('x-couture-platform') platformHeader: string | undefined
  ): Promise<PlannerResponse> {
    const query = plannerQueryParamsSchema.safeParse(rawQuery)
    if (!query.success) {
      throw new BadRequestException('Invalid query parameters')
    }
    const platform = this.resolvePlatform(platformHeader)

    return this.planner.getPlannerWindow(
      auth.userId,
      query.data.locationId,
      acceptLanguage,
      query.data.locale,
      platform
    )
  }

  @Post(':planDate/reshuffle')
  @HttpCode(200)
  @UseGuards(RequestAuthGuard, PremiumEntitlementGuard)
  async reshuffleDay(
    @AuthContext() auth: RequestAuthContext,
    @Param('planDate') planDate: string,
    @Query() rawQuery: Record<string, unknown>,
    @Headers('accept-language') acceptLanguage: string | undefined,
    @Headers('x-couture-platform') platformHeader: string | undefined,
    @Body() rawBody: unknown
  ): Promise<PlannerReshuffleResponse> {
    const query = plannerQueryParamsSchema.safeParse(rawQuery)
    if (!query.success) {
      throw new BadRequestException('Invalid query parameters')
    }
    const body = plannerReshuffleInputSchema.safeParse(rawBody)
    if (!body.success) {
      throw new BadRequestException('Invalid request body')
    }
    const platform = this.resolvePlatform(platformHeader)

    return this.planner.reshuffleDay(
      auth.userId,
      planDate,
      query.data.locationId,
      acceptLanguage,
      query.data.locale,
      body.data.expectedVersion,
      platform
    )
  }
}
