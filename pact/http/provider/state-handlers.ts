import type { VerifierOptions } from '@pact-foundation/pact'
import {
  configureProviderEvent,
  configureProviderWardrobeState,
  configureProviderCapsuleState,
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
}
