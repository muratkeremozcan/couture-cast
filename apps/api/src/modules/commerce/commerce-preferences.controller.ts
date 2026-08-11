import { Controller, Get, Inject, Put, Req, Body, UseGuards } from '@nestjs/common'
import type { Request } from 'express'
import {
  updateCommercePreferenceInputSchema,
  type CommercePreferenceResponse,
  type UpdateCommercePreferenceResponse,
} from '../../contracts/http.js'
import { getClientIp } from '../../controllers/client-ip.js'
import { toBadRequest } from '../../controllers/error-helpers.js'
import { AuthContext } from '../auth/security.decorators.js'
import { RequestAuthGuard } from '../auth/security.guards.js'
import type { RequestAuthContext } from '../auth/security.types.js'
import { CommercePreferencesService } from './commerce-preferences.service.js'

/**
 * Story 5.1 AC 3: the server-enforced affiliate opt-out.
 *
 * Deliberately not gated by `commerce_affiliate_enabled`. Both routes answer
 * normally while affiliate commerce is switched off, because a user who cannot
 * read or change their own consent signal has no working opt-out at all.
 *
 * `Cache-Control: private, no-store` is applied by
 * {@link CommerceCacheHeadersMiddleware}, not here, so it survives the error
 * paths too.
 */
@Controller('/api/v1/commerce/preferences')
@UseGuards(RequestAuthGuard)
export class CommercePreferencesController {
  constructor(
    @Inject(CommercePreferencesService)
    private readonly preferencesService: CommercePreferencesService
  ) {}

  @Get()
  async getPreference(
    @AuthContext() auth: RequestAuthContext
  ): Promise<CommercePreferenceResponse> {
    return { data: await this.preferencesService.getPreference(auth.userId) }
  }

  /**
   * Always 200, including when the submitted value matches the stored one. An
   * unchanged write persists nothing and writes no audit row; the response still
   * carries the current state so the client has one shape to handle.
   */
  @Put()
  async setPreference(
    @AuthContext() auth: RequestAuthContext,
    @Body() rawBody: unknown,
    @Req() request: Request
  ): Promise<UpdateCommercePreferenceResponse> {
    let input: { affiliateCtasEnabled: boolean }
    try {
      input = updateCommercePreferenceInputSchema.parse(rawBody)
    } catch (error) {
      return toBadRequest(error)
    }

    return {
      data: await this.preferencesService.setPreference(
        auth.userId,
        input.affiliateCtasEnabled,
        getClientIp(request)
      ),
    }
  }
}
