import type { AccessTokenIdentityService } from '../../../../apps/api/src/modules/auth/access-token-identity.service'
import type { GuardianConsentStateService } from '../../../../apps/api/src/modules/auth/guardian-consent-state.service'

/**
 * Provider doubles for the identity surface.
 *
 * These were inline consts inside `startLocalPactProvider`, which held all
 * seventeen of them across 1164 lines. Only what the Nest fixture actually
 * registers is returned; the scenario readers and response shapers stay private
 * to this module.
 */
export function createIdentityDoubles() {
  const guardianConsentStateService = {
    canTeenAccess: () => Promise.resolve(true),
  } as unknown as GuardianConsentStateService
  const accessTokenIdentityService = {
    resolveIdentity(token: string) {
      if (token === 'pact-event-token') {
        return Promise.resolve({ userId: 'guardian-1', role: 'guardian' as const })
      }
      // Story 4.4 wardrobe onboarding/silhouette: a second identity whose
      // role is 'teen', needed by the guardian-consent-gate and
      // guardian-notification consumer interactions in
      // pact/http/consumer/api-contract-interactions.ts
      // (pactTeenAuth/verifyMyFormGuardianNotificationInteraction).
      if (token === 'pact-teen-token') {
        return Promise.resolve({ userId: 'teen-1', role: 'teen' as const })
      }
      return Promise.reject(new Error('Unknown Pact access token'))
    },
  } as unknown as AccessTokenIdentityService

  return { guardianConsentStateService, accessTokenIdentityService }
}
