import type { VerifierOptions } from '@pact-foundation/pact'
import type { SilhouettePhotoFailureReason } from '@couture/api-client/contracts/http'
import {
  configureProviderEvent,
  configureProviderWardrobeState,
  configureProviderCapsuleState,
  configureProviderOnboardingState,
  configureProviderSilhouetteState,
  parsePactEvent,
  type PactEvent,
} from './provider-helper'

type StateHandlers = NonNullable<VerifierOptions['stateHandlers']>

export type WarningAlertStateParams = {
  since: string
  event: PactEvent | string
}

type GarmentStateParams = {
  garmentId: string
  userId: string
}

type OnboardingStateParams = {
  userId: string
}

type SilhouetteStateParams = {
  userId: string
}

type SilhouetteFailureStateParams = {
  userId: string
  reason: SilhouettePhotoFailureReason
}

export const stateHandlers: StateHandlers = {
  /* ----------------------------------------------------------------------- *
   * Story 4.3 outfit capsules.
   * Deterministic states: the provider is configured to present a known
   * capsule graph, not to exercise authorization or concurrency logic, which
   * lives in the API and PostgreSQL integration suites.
   * ----------------------------------------------------------------------- */
  'Two ready and active garments exist for owner': (parameters?: unknown) => {
    const { userId } = (parameters ?? {}) as { userId?: string }
    configureProviderCapsuleState({ ownerUserId: userId, scenario: 'eligible-garments' })
    return Promise.resolve({ description: 'Configured two eligible garments' })
  },
  'Capsules exist for owner': (parameters?: unknown) => {
    const { userId } = (parameters ?? {}) as { userId?: string }
    configureProviderCapsuleState({ ownerUserId: userId, scenario: 'capsule-list' })
    return Promise.resolve({ description: 'Configured owner capsule list' })
  },
  'A capsule exists for owner': (parameters?: unknown) => {
    const { userId, capsuleId } = (parameters ?? {}) as {
      userId?: string
      capsuleId?: string
    }
    configureProviderCapsuleState({
      ownerUserId: userId,
      capsuleId,
      scenario: 'capsule-detail',
    })
    return Promise.resolve({
      description: `Configured capsule ${capsuleId ?? 'default'}`,
    })
  },
  'A capsule exists for owner at a newer revision': (parameters?: unknown) => {
    const { userId, capsuleId } = (parameters ?? {}) as {
      userId?: string
      capsuleId?: string
    }
    configureProviderCapsuleState({
      ownerUserId: userId,
      capsuleId,
      scenario: 'stale-precondition',
    })
    return Promise.resolve({ description: 'Configured capsule ahead of client revision' })
  },
  'A capsule already exists for the idempotency key': (parameters?: unknown) => {
    const { userId, capsuleId } = (parameters ?? {}) as {
      userId?: string
      capsuleId?: string
    }
    configureProviderCapsuleState({
      ownerUserId: userId,
      capsuleId,
      scenario: 'idempotency-replay',
    })
    return Promise.resolve({ description: 'Configured existing idempotency key' })
  },
  'A garment pending deletion exists for owner': (parameters?: unknown) => {
    const { userId } = (parameters ?? {}) as { userId?: string }
    configureProviderCapsuleState({ ownerUserId: userId, scenario: 'ineligible-garment' })
    return Promise.resolve({ description: 'Configured a deletion-pending garment' })
  },
  'The actor has no relationship with the owner': (parameters?: unknown) => {
    const { userId } = (parameters ?? {}) as { userId?: string }
    configureProviderCapsuleState({ ownerUserId: userId, scenario: 'unauthorized-owner' })
    return Promise.resolve({ description: 'Configured masked 404 relationship' })
  },
  '': () => Promise.resolve({ description: 'No provider state required' }),
  'A warning alert event exists after the polling cursor': (parameters?: unknown) => {
    const { event } = parameters as WarningAlertStateParams
    const parsedEvent = parsePactEvent(event)
    configureProviderEvent(parsedEvent)
    return Promise.resolve({ description: `Configured event ${parsedEvent.id}` })
  },
  'Daily scenario outfit recommendations exist for user': () => {
    return Promise.resolve({ description: 'Configured mock outfit recommendations' })
  },
  'Comfort preferences exist for user': () => {
    return Promise.resolve({ description: 'Configured mock comfort preferences' })
  },
  'A garment in awaiting_tags status with tag suggestions exists for user': (
    parameters?: unknown
  ) => {
    const { garmentId, userId } = parameters as GarmentStateParams
    configureProviderWardrobeState({ garmentId, userId, outcome: 'success' })
    return Promise.resolve({
      description: 'Configured garment awaiting tags with suggestions',
    })
  },
  'A garment in awaiting_tags status exists for user': (parameters?: unknown) => {
    const { garmentId, userId } = parameters as GarmentStateParams
    configureProviderWardrobeState({ garmentId, userId, outcome: 'success' })
    return Promise.resolve({ description: 'Configured garment awaiting tags' })
  },
  'Garment analysis is pending for user': (parameters?: unknown) => {
    const { garmentId, userId } = parameters as GarmentStateParams
    configureProviderWardrobeState({
      garmentId,
      userId,
      outcome: 'analysis_pending',
    })
    return Promise.resolve({ description: 'Configured pending garment analysis' })
  },
  'Garment tagging inference is unavailable for user': (parameters?: unknown) => {
    const { garmentId, userId } = parameters as GarmentStateParams
    configureProviderWardrobeState({
      garmentId,
      userId,
      outcome: 'inference_unavailable',
    })
    return Promise.resolve({ description: 'Configured unavailable tag inference' })
  },
  'Garment does not exist for user': (parameters?: unknown) => {
    const { garmentId, userId } = parameters as GarmentStateParams
    configureProviderWardrobeState({ garmentId, userId, outcome: 'not_found' })
    return Promise.resolve({ description: 'Configured missing garment' })
  },
  'Wardrobe tagging is forbidden for user': (parameters?: unknown) => {
    const { garmentId, userId } = parameters as GarmentStateParams
    configureProviderWardrobeState({
      garmentId,
      userId,
      outcome: 'success',
      guardianAllowed: false,
    })
    return Promise.resolve({ description: 'Configured forbidden wardrobe access' })
  },

  /* ----------------------------------------------------------------------- *
   * Story 4.4 wardrobe onboarding and silhouette setup.
   *
   * These configure a named, deterministic scenario before each interaction,
   * following the exact pattern above. The state is consumed by the real
   * `mockWardrobeOnboardingService`/`mockWardrobeSilhouetteService` doubles
   * in provider-helper.ts, wired against the real
   * `WardrobeOnboardingController`/`WardrobeSilhouetteController` -- see
   * provider-helper.ts for the doubles' fidelity level. `test:pact:provider`
   * verifies every onboarding/silhouette interaction through this wiring.
   * ----------------------------------------------------------------------- */
  'Wardrobe onboarding state exists for user': (parameters?: unknown) => {
    const { userId } = parameters as OnboardingStateParams
    configureProviderOnboardingState({ userId, scenario: 'existing' })
    return Promise.resolve({ description: 'Configured existing onboarding state' })
  },
  'No wardrobe onboarding state exists for user': (parameters?: unknown) => {
    const { userId } = parameters as OnboardingStateParams
    configureProviderOnboardingState({ userId, scenario: 'not-started' })
    return Promise.resolve({ description: 'Configured absent onboarding state' })
  },
  'Wardrobe onboarding state exists for user at a newer revision': (
    parameters?: unknown
  ) => {
    const { userId } = parameters as OnboardingStateParams
    configureProviderOnboardingState({ userId, scenario: 'stale-precondition' })
    return Promise.resolve({
      description: 'Configured onboarding state ahead of client revision',
    })
  },
  'Silhouette profile exists for user': (parameters?: unknown) => {
    const { userId } = parameters as SilhouetteStateParams
    configureProviderSilhouetteState({ userId, scenario: 'profile-exists' })
    return Promise.resolve({ description: 'Configured existing silhouette profile' })
  },
  'Guardian consent is not active for teen silhouette access': (parameters?: unknown) => {
    const { userId } = parameters as SilhouetteStateParams
    configureProviderSilhouetteState({ userId, scenario: 'guardian-forbidden' })
    return Promise.resolve({
      description: 'Configured consent-revoked teen silhouette access',
    })
  },
  'Silhouette profile exists for user at a newer revision': (parameters?: unknown) => {
    const { userId } = parameters as SilhouetteStateParams
    configureProviderSilhouetteState({ userId, scenario: 'stale-precondition' })
    return Promise.resolve({
      description: 'Configured silhouette profile ahead of client revision',
    })
  },
  'My Form photo bytes are uploaded and awaiting commit for user': (
    parameters?: unknown
  ) => {
    const { userId } = parameters as SilhouetteStateParams
    configureProviderSilhouetteState({ userId, scenario: 'my-form-awaiting-commit' })
    return Promise.resolve({ description: 'Configured My Form bytes awaiting commit' })
  },
  'A My Form photo is ready for user': (parameters?: unknown) => {
    const { userId } = parameters as SilhouetteStateParams
    configureProviderSilhouetteState({ userId, scenario: 'my-form-ready' })
    return Promise.resolve({ description: 'Configured a ready My Form photo' })
  },
  'A My Form photo failed for user': (parameters?: unknown) => {
    const { userId, reason } = parameters as SilhouetteFailureStateParams
    configureProviderSilhouetteState({
      userId,
      scenario: 'my-form-failed',
      failureReason: reason,
    })
    return Promise.resolve({
      description: `Configured a My Form photo that failed with ${reason}`,
    })
  },
  'A My Form photo failed privacy_violation for a teen and queued a guardian notification':
    (parameters?: unknown) => {
      const { userId } = parameters as SilhouetteStateParams
      configureProviderSilhouetteState({
        userId,
        scenario: 'my-form-privacy-violation-teen-notified',
        failureReason: 'privacy_violation',
      })
      return Promise.resolve({
        description:
          'Configured a privacy_violation My Form photo for a teen with guardian notification queued',
      })
    },
  'A My Form photo exists for user': (parameters?: unknown) => {
    const { userId } = parameters as SilhouetteStateParams
    configureProviderSilhouetteState({ userId, scenario: 'my-form-exists' })
    return Promise.resolve({ description: 'Configured an existing My Form photo' })
  },
  'A My Form upload session was already allocated for user': (parameters?: unknown) => {
    const { userId } = parameters as SilhouetteStateParams
    configureProviderSilhouetteState({
      userId,
      scenario: 'my-form-upload-already-allocated',
    })
    return Promise.resolve({
      description: 'Configured an already-allocated My Form upload session',
    })
  },
  'A My Form photo commit was already processed for user': (parameters?: unknown) => {
    const { userId } = parameters as SilhouetteStateParams
    configureProviderSilhouetteState({
      userId,
      scenario: 'my-form-commit-already-processed',
    })
    return Promise.resolve({
      description: 'Configured an already-processed My Form commit',
    })
  },
}
