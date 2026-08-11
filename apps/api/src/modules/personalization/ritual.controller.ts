import {
  Controller,
  Get,
  Inject,
  Query,
  UseGuards,
  InternalServerErrorException,
  Logger,
  Headers,
} from '@nestjs/common'
import {
  ritualQueryParamsSchema,
  ritualResponseSchema,
  type RitualResponse,
  type RitualQueryParams,
} from '../../contracts/http.js'
import { AuthContext } from '../auth/security.decorators.js'
import { RequestAuthGuard } from '../auth/security.guards.js'
import type { RequestAuthContext } from '../auth/security.types.js'
import { RitualService } from './ritual.service.js'
import { AffiliateOfferService } from '../commerce/affiliate-offer.service.js'
import { toBadRequest } from '../../controllers/error-helpers.js'

@Controller('/api/v1/ritual')
@UseGuards(RequestAuthGuard)
export class RitualController {
  private readonly logger = new Logger(RitualController.name)

  constructor(
    @Inject(RitualService)
    private readonly ritualService: RitualService,
    @Inject(AffiliateOfferService)
    private readonly affiliateOfferService: AffiliateOfferService
  ) {}

  @Get()
  async getOrCreateRitual(
    @AuthContext() auth: RequestAuthContext,
    @Query() query: unknown,
    @Headers('accept-language') acceptLanguage?: string
  ): Promise<RitualResponse> {
    let parsedQuery: RitualQueryParams
    try {
      parsedQuery = ritualQueryParamsSchema.parse(query)
    } catch (error) {
      return toBadRequest(error)
    }

    const data = await this.ritualService.getOrCreateRitual(
      auth.userId,
      parsedQuery.locationId,
      acceptLanguage,
      parsedQuery.locale,
      parsedQuery.occasion
    )

    // Story 5.1 decision 5: the commerce block is assembled HERE, not in
    // RitualService. Every path -- cold generate, warm Redis cache, warm
    // database cache -- passes through this line, which is what makes the
    // opt-out take effect immediately even while a cached recommendation is
    // being served. See AffiliateOfferService for why the service layer has no
    // equivalent single point.
    const shopThisLookByOutfitId = await this.affiliateOfferService.resolveShopThisLook({
      userId: auth.userId,
      outfits: data.outfits,
      acceptLanguage,
      requestedLocale: parsedQuery.locale,
    })

    const dataWithCommerce = {
      ...data,
      outfits: data.outfits.map((outfit) => ({
        ...outfit,
        // Always written, never omitted: the contract field is nullable and not
        // optional precisely so a client never has to tell "absent" from "null".
        shopThisLook: shopThisLookByOutfitId.get(outfit.id) ?? null,
      })),
    }

    try {
      return ritualResponseSchema.parse({ data: dataWithCommerce })
    } catch (error) {
      this.logger.error(
        `Ritual response schema validation failed for user ${auth.userId}:`,
        error instanceof Error ? error.stack : error
      )
      throw new InternalServerErrorException('Response schema validation failed')
    }
  }
}
