import type { PremiumEntitlementService } from '../../../../apps/api/src/modules/commerce/premium-entitlement.service'
import { NotFoundException } from '@nestjs/common'
import { getProviderPaletteAdvisorState, getProviderPremiumThemeState } from '../state'

/**
 * The one `PremiumEntitlementService` double, shared by every feature whose
 * routes mount `PremiumEntitlementGuard`.
 *
 * It started life inside `createPremiumThemeDoubles`, which was correct while
 * story 5.3 was the only consumer of the guard. Story 5.4 mounts the same guard
 * on the palette advisor routes, and a double that could only read the premium
 * theme state answered `404 PREMIUM_THEME_STATE_NOT_CONFIGURED` for every
 * palette interaction -- an entitlement double failing on a feature it knows
 * nothing about. The guard is shared infrastructure, so its double is too.
 *
 * Each feature's provider state carries its own notion of "entitled", and this
 * reads whichever one the current interaction configured. Configuring neither is
 * a wiring mistake in a new interaction, not a scenario, so it still throws --
 * silently resolving `true` would make an entitlement 403 unprovable.
 */
export function createPremiumEntitlementDouble() {
  const mockPremiumEntitlementService = {
    hasPremiumAccess: () => {
      const themeState = getProviderPremiumThemeState()
      if (themeState) {
        return Promise.resolve(themeState.scenario !== 'not-entitled')
      }
      const paletteState = getProviderPaletteAdvisorState()
      if (paletteState) {
        return Promise.resolve(paletteState.scenario !== 'not-entitled')
      }
      throw new NotFoundException('PREMIUM_ENTITLEMENT_STATE_NOT_CONFIGURED')
    },
  } as unknown as PremiumEntitlementService

  return { mockPremiumEntitlementService }
}
