import {
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common'
import { PREMIUM_REQUIRED_MESSAGE } from '../../contracts/http.js'
import type { AuthenticatedRequest } from '../auth/security.types.js'
import { PremiumEntitlementService } from './premium-entitlement.service.js'

/**
 * Story 5.2 AC 4: the server-side premium gate.
 *
 * Runs AFTER RequestAuthGuard — it reads `request.auth.userId` and treats its
 * absence as a wiring error (401), never as "anonymous premium". Access rule:
 * `active` and `grace_period` pass; `expired`, `revoked`, and no-row answer
 * 403 with {@link PREMIUM_REQUIRED_MESSAGE}. Grace period keeps access on
 * purpose — a card hiccup is not a downgrade.
 *
 * SHIPPED TESTED BUT DORMANT in story 5.2, deliberately: no production route
 * mounted it yet, only the exported service (web planner-rail gate) and the
 * supertest fixture proving the guard over HTTP. Story 5.3's
 * `PremiumThemeController` PUT route was its first production consumer,
 * Story 5.4's palette-advisor routes followed, and CC-5.5's planner API is
 * the third.
 */
@Injectable()
export class PremiumEntitlementGuard implements CanActivate {
  constructor(
    @Inject(PremiumEntitlementService)
    private readonly entitlements: PremiumEntitlementService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>()
    const userId = request.auth?.userId

    if (!userId) {
      // Reaching here without RequestAuthGuard is a route wiring bug; answer
      // as unauthenticated rather than leaking that the route exists.
      throw new UnauthorizedException('Authentication required.')
    }

    if (await this.entitlements.hasPremiumAccess(userId)) {
      return true
    }

    throw new ForbiddenException(PREMIUM_REQUIRED_MESSAGE)
  }
}
