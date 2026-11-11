// Story 6.14 D6 owner: the premium access source read.
import { Controller, Get, Inject, UseGuards } from '@nestjs/common'
import {
  premiumAccessResponseSchema,
  type PremiumAccessResponse,
} from '../../contracts/http.js'
import { AuthContext } from '../auth/security.decorators.js'
import { RequestAuthGuard } from '../auth/security.guards.js'
import type { RequestAuthContext } from '../auth/security.types.js'
import { PremiumEntitlementService } from './premium-entitlement.service.js'

/**
 * `GET /api/v1/commerce/premium/access`: whether the acting member has premium and where it
 * comes from. It sits under the commerce prefix so `CommerceCacheHeadersMiddleware` sends
 * `Cache-Control: private, no-store` on every status, as `premium-theme.controller.ts` explains.
 * The acting user is the only subject; no route here takes an id. The response is parsed
 * through its published strict schema before it leaves the handler.
 */
@Controller('/api/v1/commerce/premium/access')
@UseGuards(RequestAuthGuard)
export class PremiumAccessController {
  constructor(
    @Inject(PremiumEntitlementService)
    private readonly entitlements: PremiumEntitlementService
  ) {}

  @Get()
  async getAccess(
    @AuthContext() auth: RequestAuthContext
  ): Promise<PremiumAccessResponse> {
    const source = await this.entitlements.premiumAccessSource(auth.userId)
    return premiumAccessResponseSchema.parse({
      data: { premium: source !== 'none', source },
    })
  }
}
