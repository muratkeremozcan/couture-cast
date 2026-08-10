// Story 4.4 Task 3: onboarding state machine HTTP surface
import {
  BadRequestException,
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
import type { z } from 'zod'
import { updateWardrobeOnboardingStateInputSchema } from '@couture/api-client/contracts/http'
import { AuthContext } from '../auth/security.decorators.js'
import { RequestAuthGuard } from '../auth/security.guards.js'
import type { RequestAuthContext } from '../auth/security.types.js'
import { WardrobeOnboardingService } from './wardrobe-onboarding.service.js'

function validationMessage(prefix: string, error: z.ZodError): string {
  const details = error.issues
    .map((issue) => `${issue.path.join('.') || 'request'}: ${issue.message}`)
    .join('; ')
  return `${prefix}: ${details}`
}

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
    // `safeParse` rather than `parse`: a bare `parse` lets the ZodError reach
    // the global exception filter, which has no Zod mapping and answers 500.
    // The contract documents a 400 for a malformed body.
    const parsed = updateWardrobeOnboardingStateInputSchema.safeParse(rawBody)
    if (!parsed.success) {
      throw new BadRequestException(
        validationMessage('Invalid onboarding transition', parsed.error)
      )
    }
    const input = parsed.data
    const { response } = await this.onboardingService.advanceStep(
      auth.userId,
      ifMatchHeader,
      input
    )

    res.setHeader('ETag', `"onboarding:${auth.userId}:${response.data.revision}"`)
    return response
  }
}
