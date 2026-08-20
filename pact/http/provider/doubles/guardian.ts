import type { GuardianService } from '../../../../apps/api/src/modules/guardian/guardian.service'
import { ForbiddenException } from '@nestjs/common'
import { PACT_SILHOUETTE_TEEN_ID } from '../fixtures'
import { getProviderSilhouetteState, getProviderWardrobeState } from '../state'

/**
 * Provider doubles for the guardian surface.
 *
 * These were inline consts inside `startLocalPactProvider`, which held all
 * seventeen of them across 1164 lines. Only what the Nest fixture actually
 * registers is returned; the scenario readers and response shapers stay private
 * to this module.
 */
export function createGuardianDoubles() {
  const mockGuardianService = {
    assertWardrobeUploadAllowed: (userId: string) => {
      // Story 4.4: `WardrobeUploadGuard` applies class-level to
      // WardrobeSilhouetteController (decision 7), so the consent-revoked-teen
      // Pact scenario must be honored here too, independent of the pre-existing
      // garment/capsule getProviderWardrobeState() check below.
      const silhouetteState = getProviderSilhouetteState()
      if (
        silhouetteState?.scenario === 'guardian-forbidden' &&
        userId === (silhouetteState.userId ?? PACT_SILHOUETTE_TEEN_ID)
      ) {
        throw new ForbiddenException('GUARDIAN_CONSENT_REQUIRED')
      }
      if (
        !getProviderWardrobeState().guardianAllowed ||
        (getProviderWardrobeState().userId !== null &&
          getProviderWardrobeState().userId !== userId)
      ) {
        throw new ForbiddenException('GUARDIAN_CONSENT_REQUIRED')
      }
      return Promise.resolve()
    },
  } as unknown as GuardianService

  /**
   * Story 5.1: `RitualController` injects this, so the fixture cannot build
   * without it even for the interactions that have nothing to do with commerce.
   *
   * It answers a populated block only under the `eligible` scenario. Every other
   * scenario returns an empty map, and the controller writes `null` for each
   * outfit, which is what the pre-existing ritual interactions pin.
   */

  return { mockGuardianService }
}
