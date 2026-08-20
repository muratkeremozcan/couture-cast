import type { WardrobeOnboardingService } from '../../../../apps/api/src/modules/wardrobe/wardrobe-onboarding.service'
import {
  formatOnboardingETag,
  parseOnboardingIfMatchHeader,
} from '../../../../apps/api/src/modules/wardrobe/wardrobe-onboarding.service'
import type {
  UpdateWardrobeOnboardingStateInput,
  WardrobeOnboardingStateResponse,
  WardrobeOnboardingStep,
} from '@couture/api-client/contracts/http'
import {
  ConflictException,
  NotFoundException,
  PreconditionFailedException,
} from '@nestjs/common'
import { PACT_ONBOARDING_COMPLETED_AT, PACT_ONBOARDING_STARTED_AT } from '../fixtures'
import { getProviderOnboardingState } from '../state'

/**
 * Provider doubles for the onboarding surface.
 *
 * These were inline consts inside `startLocalPactProvider`, which held all
 * seventeen of them across 1164 lines. Only what the Nest fixture actually
 * registers is returned; the scenario readers and response shapers stay private
 * to this module.
 */
export function createOnboardingDoubles() {
  const ONBOARDING_FORWARD_TRANSITIONS: Record<
    WardrobeOnboardingStep,
    WardrobeOnboardingStep[]
  > = {
    permission: ['capture'],
    capture: ['tagging', 'silhouette'],
    tagging: ['silhouette'],
    silhouette: ['complete'],
    complete: [],
  }

  type OnboardingRow = WardrobeOnboardingStateResponse['data']

  const toOnboardingResponse = (row: OnboardingRow): WardrobeOnboardingStateResponse => ({
    data: row,
  })

  const requireOnboardingScenario = (): { row: OnboardingRow } => {
    const state = getProviderOnboardingState()
    if (!state) {
      throw new NotFoundException('ONBOARDING_STATE_NOT_CONFIGURED')
    }
    if (state.scenario === 'not-started') {
      return {
        row: {
          status: 'not_started',
          currentStep: 'permission',
          usedStarterWardrobe: false,
          garmentsCapturedCount: 0,
          startedAt: null,
          completedAt: null,
          revision: 0,
        },
      }
    }
    return {
      row: {
        status: 'in_progress',
        currentStep: 'capture',
        usedStarterWardrobe: false,
        garmentsCapturedCount: 1,
        startedAt: PACT_ONBOARDING_STARTED_AT,
        completedAt: null,
        revision: state.scenario === 'stale-precondition' ? 2 : 1,
      },
    }
  }

  const mockWardrobeOnboardingService = {
    getState: (userId: string) => {
      const { row } = requireOnboardingScenario()
      return Promise.resolve({
        response: toOnboardingResponse(row),
        etag: formatOnboardingETag(userId, row.revision),
      })
    },
    advanceStep: (
      userId: string,
      ifMatchHeader: string | undefined,
      input: UpdateWardrobeOnboardingStateInput
    ) => {
      // Parsed first, exactly like the real service: a missing/malformed
      // If-Match throws 428/412 before any provider-state scenario lookup.
      const expectedRevision = parseOnboardingIfMatchHeader(ifMatchHeader, userId)
      const { row } = requireOnboardingScenario()
      if (expectedRevision !== null && expectedRevision !== row.revision) {
        throw new PreconditionFailedException('ONBOARDING_REVISION_MISMATCH')
      }

      const usedStarterWardrobe = input.usedStarterWardrobe ?? false
      const isIdenticalReplay =
        row.currentStep === input.targetStep &&
        row.usedStarterWardrobe === usedStarterWardrobe
      if (isIdenticalReplay) {
        return Promise.resolve({ response: toOnboardingResponse(row), isNoOp: true })
      }

      const allowed = ONBOARDING_FORWARD_TRANSITIONS[row.currentStep]
      if (!allowed.includes(input.targetStep)) {
        throw new ConflictException('INVALID_STEP_TRANSITION')
      }

      // Built per variant rather than as one wide object: the contract is a
      // discriminated union, so `completed` carries its terminal step and
      // timestamp together and `in_progress` cannot carry a completedAt at all.
      const advancedShared = {
        usedStarterWardrobe,
        garmentsCapturedCount: row.garmentsCapturedCount,
        startedAt: row.startedAt ?? PACT_ONBOARDING_STARTED_AT,
        revision: row.revision + 1,
      }
      const advanced: OnboardingRow =
        input.targetStep === 'complete'
          ? {
              status: 'completed',
              currentStep: 'complete',
              ...advancedShared,
              completedAt: PACT_ONBOARDING_COMPLETED_AT,
            }
          : {
              status: 'in_progress',
              currentStep: input.targetStep,
              ...advancedShared,
              completedAt: null,
            }
      return Promise.resolve({ response: toOnboardingResponse(advanced), isNoOp: false })
    },
  } as unknown as WardrobeOnboardingService

  /**
   * Story 4.4 silhouette/My Form provider double, wired against the real
   * `WardrobeSilhouetteController`. Same fidelity level as the onboarding
   * double above: canned rows per named provider state (including every
   * documented My Form failure reason and the ready/processing/deleted
   * shapes), reusing the real `formatSilhouetteETag`/
   * `parseSilhouetteIfMatchHeader` for header handling. The guardian-consent
   * gate itself is `mockGuardianService.assertWardrobeUploadAllowed` above
   * (the class-level `WardrobeUploadGuard`), not this double.
   */

  return { mockWardrobeOnboardingService }
}
