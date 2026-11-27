// Story 2.1 Task 2 step 2 owner: implement the ritual GET route with Zod-validated query and response in `apps/api/src/modules/personalization/ritual.controller.ts`
// Story 5.1 Task 3 step 3 owner: assemble `shopThisLook` after the cached service result in `apps/api/src/modules/personalization/ritual.controller.ts`
import {
  Controller,
  Get,
  Header,
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
import { AllowPendingGuardianTeen, AuthContext } from '../auth/security.decorators.js'
import { RequestAuthGuard } from '../auth/security.guards.js'
import type { RequestAuthContext } from '../auth/security.types.js'
import { RitualService } from './ritual.service.js'
import { RitualGarmentPhotoService } from './ritual-garment-photo.service.js'
import { AffiliateOfferService } from '../commerce/affiliate-offer.service.js'
import { toBadRequest } from '../../controllers/error-helpers.js'

@Controller('/api/v1/ritual')
@UseGuards(RequestAuthGuard)
@AllowPendingGuardianTeen()
export class RitualController {
  private readonly logger = new Logger(RitualController.name)

  constructor(
    @Inject(RitualService)
    private readonly ritualService: RitualService,
    @Inject(AffiliateOfferService)
    private readonly affiliateOfferService: AffiliateOfferService,
    @Inject(RitualGarmentPhotoService)
    private readonly garmentPhotos: RitualGarmentPhotoService
  ) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
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
    const [shopThisLookByOutfitId, displayById] = await Promise.all([
      this.affiliateOfferService.resolveShopThisLook({
        userId: auth.userId,
        outfits: data.outfits,
        acceptLanguage,
        requestedLocale: parsedQuery.locale,
      }),
      this.garmentPhotos.resolve(auth, data.outfits),
    ])

    const dataWithCommerce = {
      ...data,
      outfits: data.outfits.map((outfit) => {
        const base = new Map(
          outfit.displayGarments?.map(({ id, category }) => [id, { id, category }])
        )
        if (!displayById) {
          const fallback = ['top', 'bottom', 'shoes', 'outerwear', 'accessory']
          return {
            ...outfit,
            garmentIds: outfit.garmentIds.map((id, index) =>
              id.startsWith('default-')
                ? id
                : `default-${base.get(id)?.category ?? fallback[index % fallback.length]}`
            ),
            displayGarments: [],
            capsuleId: null,
            capsuleName: null,
            autoFilledGarmentIds: [],
            recommendationActionsAvailable: false,
            shopThisLook: null,
          }
        }
        return {
          ...outfit,
          displayGarments: outfit.garmentIds.flatMap((id) => {
            const piece = displayById?.get(id) ?? base.get(id)
            return piece ? [piece] : []
          }),
          shopThisLook: shopThisLookByOutfitId.get(outfit.id) ?? null,
        }
      }),
    }

    try {
      return ritualResponseSchema.parse({ data: dataWithCommerce })
    } catch {
      this.logger.error(
        `Ritual response schema validation failed for user ${auth.userId}`
      )
      throw new InternalServerErrorException('Response schema validation failed')
    }
  }
}
