import type { WardrobeCapsuleService } from '../../../../apps/api/src/modules/wardrobe/wardrobe-capsule.service.js'
import {
  ConflictException,
  HttpException,
  HttpStatus,
  NotFoundException,
  PreconditionFailedException,
} from '@nestjs/common'
import {
  PACT_CAPSULE_GARMENT_A,
  PACT_CAPSULE_ID,
  PACT_CAPSULE_OWNER_ID,
  PACT_CAPSULE_TIMESTAMP,
} from '../fixtures'
import { getProviderCapsuleState } from '../state'

/**
 * Provider doubles for the capsules surface.
 *
 * These were inline consts inside `startLocalPactProvider`, which held all
 * seventeen of them across 1164 lines. Only what the Nest fixture actually
 * registers is returned; the scenario readers and response shapers stay private
 * to this module.
 */
export function createCapsulesDoubles() {
  const capsuleRepresentation = (revision: number) => ({
    id: PACT_CAPSULE_ID,
    ownerUserId: PACT_CAPSULE_OWNER_ID,
    name: 'Work capsule',
    description: null,
    occasions: ['work'] as const,
    isFavorite: false,
    revision,
    availabilityStatus: 'ready' as const,
    unavailableGarmentCount: 0,
    garments: [
      {
        id: PACT_CAPSULE_GARMENT_A,
        category: 'top' as const,
        material: 'cotton' as const,
        comfortRange: 'mild' as const,
        imageAccess: null,
        availabilityStatus: 'ready' as const,
        garmentOrder: 0,
      },
    ],
    createdAt: PACT_CAPSULE_TIMESTAMP,
    updatedAt: PACT_CAPSULE_TIMESTAMP,
  })

  /**
   * An unconfigured state, or one the provider models as unauthorized, is a
   * masked 404. That matches the story rule that a missing capsule and an
   * unauthorized relationship are indistinguishable to the client.
   */
  const requireCapsuleScenario = () => {
    const state = getProviderCapsuleState()
    if (!state || state.scenario === 'unauthorized-owner') {
      throw new NotFoundException('CAPSULE_NOT_FOUND')
    }
    return state
  }

  const mockWardrobeCapsuleService = {
    createCapsule: (_actor: unknown, _ownerUserId: string, body: { name?: string }) => {
      const { scenario } = requireCapsuleScenario()
      if (scenario === 'ineligible-garment') {
        throw new ConflictException('GARMENT_NOT_CAPSULE_ELIGIBLE')
      }

      /**
       * Replay and key-reuse share one provider state because they differ by
       * payload, not by stored data: an identical normalized payload replays,
       * a changed one conflicts.
       */
      if (scenario === 'idempotency-replay') {
        if (body?.name !== 'Work capsule') {
          throw new ConflictException('IDEMPOTENCY_KEY_REUSED')
        }
        return Promise.resolve({ data: capsuleRepresentation(1), isReplay: true })
      }

      return Promise.resolve({ data: capsuleRepresentation(1), isReplay: false })
    },
    listCapsules: () => {
      requireCapsuleScenario()
      return Promise.resolve({
        data: [capsuleRepresentation(1)],
        total: 1,
        limit: 20,
        offset: 0,
      })
    },
    getCapsule: () => {
      requireCapsuleScenario()
      return Promise.resolve({ data: capsuleRepresentation(1) })
    },
    updateCapsule: (
      _actor: unknown,
      _ownerUserId: string,
      _capsuleId: string,
      ifMatch: string | undefined
    ) => {
      const { scenario } = requireCapsuleScenario()
      if (!ifMatch) {
        throw new HttpException('PRECONDITION_REQUIRED', HttpStatus.PRECONDITION_REQUIRED)
      }
      if (scenario === 'stale-precondition') {
        throw new PreconditionFailedException('CAPSULE_REVISION_MISMATCH')
      }
      return Promise.resolve({ data: capsuleRepresentation(1) })
    },
    setFavoriteStatus: () => {
      requireCapsuleScenario()
      return Promise.resolve({ data: capsuleRepresentation(1) })
    },
    deleteCapsule: () => {
      requireCapsuleScenario()
      return Promise.resolve()
    },
  } as unknown as WardrobeCapsuleService

  /**
   * Story 4.4 onboarding provider double, wired against the real
   * `WardrobeOnboardingController` (unlike Task 7's earlier state-setup-only
   * scaffolding, which had no controller to wire against yet). Mirrors
   * `mockWardrobeCapsuleService`'s level of fidelity: canned responses per
   * named provider state plus the documented error paths, not a full
   * re-simulation of `wardrobe-onboarding.service.ts`'s business logic --
   * that is proven separately against a real database by
   * `apps/api/integration/wardrobe-onboarding.integration.spec.ts`. Reuses
   * the real `formatOnboardingETag`/`parseOnboardingIfMatchHeader` (pure,
   * side-effect-free) so header parsing and the 428/malformed-412 paths
   * match the real service exactly instead of a hand-duplicated copy.
   */

  return { mockWardrobeCapsuleService }
}
