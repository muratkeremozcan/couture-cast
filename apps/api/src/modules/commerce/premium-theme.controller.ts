import { Body, Controller, Get, Inject, Put, UseGuards } from '@nestjs/common'
import {
  premiumThemeResponseSchema,
  updatePremiumThemeInputSchema,
  updatePremiumThemeResponseSchema,
  type PremiumThemeResponse,
  type UpdatePremiumThemeInput,
  type UpdatePremiumThemeResponse,
} from '../../contracts/http.js'
import { toBadRequest } from '../../controllers/error-helpers.js'
import { AuthContext } from '../auth/security.decorators.js'
import { RequestAuthGuard } from '../auth/security.guards.js'
import type { RequestAuthContext } from '../auth/security.types.js'
import { PremiumEntitlementGuard } from './premium-entitlement.guard.js'
import { PremiumThemeService } from './premium-theme.service.js'

/**
 * Story 5.3 AC 3/5/6: the premium palette preference surface.
 *
 * ROUTE PREFIX IS LOAD-BEARING (Decision 9). `/api/v1/commerce/premium/theme`
 * sits inside the `/api/v1/commerce{/*path}` binding that `CommerceModule`
 * already gives `CommerceCacheHeadersMiddleware`, so both operations inherit
 * `Cache-Control: private, no-store` with no new wiring — including on the
 * error paths, which is the whole reason that header is middleware rather than
 * a per-handler `@Header`. Moving these routes to a top-level `/api/v1/premium`
 * namespace would silently ship a per-user response with no cache header at
 * all; `premium-theme.controller.spec.ts` asserts the header so that move
 * cannot happen quietly.
 *
 * ASYMMETRIC GATING, ON PURPOSE. The GET carries `RequestAuthGuard` only: a
 * non-entitled or flag-off caller still needs an answer to render the locked
 * upsell or the Default palette, and refusing them would make AC 6's clean
 * fallback impossible to reach. The PUT adds `PremiumEntitlementGuard`, so only
 * a subscriber can write.
 *
 * STATUS PRECEDENCE, STATED ONCE (Decision 9): 403 → 503 → 400. The entitlement
 * guard runs pre-handler, so a non-entitled caller never observes the kill
 * switch; the kill switch is asserted before the body is parsed, so a disabled
 * feature answers 503 to malformed writes too, matching
 * `SubscriptionController.parseCheckoutRequest`. None of this is a bug to
 * "fix" in review.
 *
 * EVERY RESPONSE IS PARSED THROUGH ITS PUBLISHED SCHEMA before it leaves the
 * handler, the same way `alerts.controller.ts` and `comfort.controller.ts` do
 * it. The service's return type already claims the contract shape, but a type
 * claim is erased at runtime: a service that starts returning an extra field,
 * or `undefined` where the contract says `boolean`, would ship straight to
 * clients and only surface as a `.strict()` parse failure in the browser. The
 * parse turns that drift into a 500 at the boundary that owns the contract.
 *
 * NO ROUTE TAKES AN ID PARAMETER, and none may ever be added: the acting user
 * from `RequestAuthGuard` is the only subject these endpoints can answer about,
 * which is the cross-user authorization story enforced by construction rather
 * than by a check that can be forgotten (same rule as
 * `subscription.controller.ts`).
 */
@Controller('/api/v1/commerce/premium/theme')
@UseGuards(RequestAuthGuard)
export class PremiumThemeController {
  constructor(
    @Inject(PremiumThemeService)
    private readonly themes: PremiumThemeService
  ) {}

  @Get()
  async getTheme(@AuthContext() auth: RequestAuthContext): Promise<PremiumThemeResponse> {
    const data = await this.themes.getTheme(auth.userId)

    return premiumThemeResponseSchema.parse({ data })
  }

  /**
   * Always 200, including when the submitted palette matches the stored one and
   * including `{ theme: null }`, which resets to Default by upserting the row to
   * NULL rather than deleting it. The response carries the freshly resolved
   * state either way, so a client has one shape to handle.
   */
  @Put()
  @UseGuards(PremiumEntitlementGuard)
  async setTheme(
    @AuthContext() auth: RequestAuthContext,
    @Body() rawBody: unknown
  ): Promise<UpdatePremiumThemeResponse> {
    const input = await this.parseThemeRequest(auth.userId, rawBody)
    const data = await this.themes.setTheme(auth.userId, input.theme)

    return updatePremiumThemeResponseSchema.parse({ data })
  }

  /**
   * The kill switch is evaluated before the body is parsed, so the 503 outranks
   * the 400. A disabled feature answers the same way to every write attempt
   * rather than leaking which payloads it would have accepted.
   */
  private async parseThemeRequest(
    userId: string,
    rawBody: unknown
  ): Promise<UpdatePremiumThemeInput> {
    await this.themes.assertThemesEnabled(userId)
    try {
      return updatePremiumThemeInputSchema.parse(rawBody)
    } catch (error) {
      return toBadRequest(error)
    }
  }
}
