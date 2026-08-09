// Story 4.4 Task 3: onboarding state machine HTTP surface
import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Patch,
  Res,
  UseGuards,
} from '@nestjs/common'
import type { Response } from 'express'
import { updateWardrobeOnboardingStateInputSchema } from '@couture/api-client/contracts/http'
import { AuthContext } from '../auth/security.decorators.js'
import { RequestAuthGuard } from '../auth/security.guards.js'
import type { RequestAuthContext } from '../auth/security.types.js'
import { WardrobeOnboardingService } from './wardrobe-onboarding.service.js'

/**
 * No `WardrobeUploadGuard` here (decision 7): this controller exposes no
 * photo bytes, and its capture/tagging steps already delegate to
 * `WardrobeController`'s existing, already-gated endpoints. `Cache-Control`
 * is applied by `CapsuleCacheHeadersMiddleware` in `wardrobe.module.ts`
 * (reused as-is, not re-implemented) so it survives guard- and
 * validation-raised error responses too, not just handler success paths --
 * the exact gap Story 4.3's review found and fixed for capsules.
 */
@Controller('api/v1/wardrobe/onboarding')
@UseGuards(RequestAuthGuard)
export class WardrobeOnboardingController {
  constructor(
    @Inject(WardrobeOnboardingService)
    private readonly onboardingService: WardrobeOnboardingService
  ) {}

  @Get()
  async getState(
    @AuthContext() auth: RequestAuthContext,
    @Res({ passthrough: true }) res: Response
  ) {
    const { response, etag } = await this.onboardingService.getState(auth.userId)
    res.setHeader('ETag', etag)
    return response
  }

  @Patch()
  async advanceStep(
    @AuthContext() auth: RequestAuthContext,
    @Headers('if-match') ifMatchHeader: string | undefined,
    @Body() rawBody: unknown,
    @Res({ passthrough: true }) res: Response
  ) {
    const input = updateWardrobeOnboardingStateInputSchema.parse(rawBody)
    const { response } = await this.onboardingService.advanceStep(
      auth.userId,
      ifMatchHeader,
      input
    )

    res.setHeader('ETag', `"onboarding:${auth.userId}:${response.data.revision}"`)
    return response
  }
}
