import type { PremiumEntitlementService } from '../../../../apps/api/src/modules/commerce/premium-entitlement.service'
import type { PremiumThemeService } from '../../../../apps/api/src/modules/commerce/premium-theme.service'
import {
  PREMIUM_THEMES_DISABLED_MESSAGE,
  PREMIUM_THEME_OWNER_NOT_FOUND_MESSAGE,
} from '@couture/api-client/contracts/http'
import type { PremiumThemeKey } from '@couture/api-client/contracts/http'
import { NotFoundException, ServiceUnavailableException } from '@nestjs/common'
import { getProviderPremiumThemeState } from '../state'

/**
 * Provider doubles for the premium-theme surface.
 *
 * These were inline consts inside `startLocalPactProvider`, which held all
 * seventeen of them across 1164 lines. Only what the Nest fixture actually
 * registers is returned; the scenario readers and response shapers stay private
 * to this module.
 */
export function createPremiumThemeDoubles() {
  const requirePremiumThemeScenario = () => {
    const state = getProviderPremiumThemeState()
    if (!state) {
      throw new NotFoundException('PREMIUM_THEME_STATE_NOT_CONFIGURED')
    }
    return state
  }

  const mockPremiumEntitlementService = {
    hasPremiumAccess: () =>
      Promise.resolve(requirePremiumThemeScenario().scenario !== 'not-entitled'),
  } as unknown as PremiumEntitlementService

  const mockPremiumThemeService = {
    getTheme: () => {
      const state = requirePremiumThemeScenario()
      const isEntitled = state.scenario !== 'not-entitled'
      return Promise.resolve({
        theme: isEntitled ? state.theme : null,
        isEntitled,
        themesEnabled: state.scenario !== 'themes-disabled',
      })
    },
    assertThemesEnabled: () => {
      if (requirePremiumThemeScenario().scenario === 'themes-disabled') {
        throw new ServiceUnavailableException(PREMIUM_THEMES_DISABLED_MESSAGE)
      }
      return Promise.resolve()
    },
    setTheme: (_userId: string, theme: PremiumThemeKey | null) => {
      // Re-asserted here too, mirroring the real service's own defense --
      // the controller already checked, but this double stays honest on its
      // own the same way `PremiumThemeService.setTheme` does.
      if (requirePremiumThemeScenario().scenario === 'themes-disabled') {
        throw new ServiceUnavailableException(PREMIUM_THEMES_DISABLED_MESSAGE)
      }
      // The account erased mid-request. In the real service this is Prisma
      // `P2003` on the preference table's user foreign key, caught in
      // `writePreference` and remapped; the double raises the mapped exception
      // directly because the constraint itself belongs to the database tier and
      // the contract records only the status and envelope that reach a client.
      if (requirePremiumThemeScenario().scenario === 'owner-erased') {
        throw new NotFoundException(PREMIUM_THEME_OWNER_NOT_FOUND_MESSAGE)
      }
      return Promise.resolve({ theme, isEntitled: true, themesEnabled: true })
    },
  } as unknown as PremiumThemeService

  return { mockPremiumEntitlementService, mockPremiumThemeService }
}
