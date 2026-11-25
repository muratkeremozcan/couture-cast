// Story CC-7.2: Pact provider double for WardrobeSavedLookService.
import {
  HttpException,
  HttpStatus,
  NotFoundException,
  PreconditionFailedException,
} from '@nestjs/common'
import type { SavedLookContract } from '@couture/api-client/contracts/http'
import {
  parseSavedLookIfMatchHeader,
  type WardrobeSavedLookService,
} from '../../../../apps/api/src/modules/wardrobe/wardrobe-saved-look.service.js'
import { getProviderWardrobeState } from '../state'

export type SavedLookProviderScenario = 'ready' | 'replay' | 'missing'

let state: {
  scenario: SavedLookProviderScenario
  userId: string
  savedLookId: string
  garmentId: string
} = {
  scenario: 'ready',
  userId: 'guardian-1',
  savedLookId: 'saved-look-pact-1',
  garmentId: 'garment-pact-1',
}

export function resetProviderSavedLookState() {
  state = {
    scenario: 'ready',
    userId: 'guardian-1',
    savedLookId: 'saved-look-pact-1',
    garmentId: 'garment-pact-1',
  }
}

export function configureProviderSavedLookState(next: Partial<typeof state>) {
  state = { ...state, ...next }
}

function buildContract(): SavedLookContract {
  return {
    id: state.savedLookId,
    ownerUserId: state.userId,
    source: 'style_piece',
    lookId: 'look-01',
    weather: 'warm-rainy',
    title: null,
    anchorGarmentId: state.garmentId,
    anchorSnapshot: {
      garmentId: state.garmentId,
      category: 'top',
      comfortRange: 'mild',
    },
    composition: [
      {
        slotIndex: 0,
        category: 'top',
        kind: 'garment',
        itemId: state.garmentId,
        label: null,
        missing: false,
        imageAccess: null,
      },
      {
        slotIndex: 1,
        category: 'bottom',
        kind: 'catalog',
        itemId: 'sample:g:bottom-1',
        label: null,
        missing: false,
        imageAccess: null,
      },
      {
        slotIndex: 2,
        category: 'shoes',
        kind: 'catalog',
        itemId: 'sample:g:loafers',
        label: null,
        missing: false,
        imageAccess: null,
      },
    ],
    swaps: { shoes: 'sample:g:loafers' },
    collection: null,
    comfort: null,
    availabilityStatus: 'ready',
    missingGarmentIds: [],
    needsReviewReasons: [],
    revision: 0,
    createdAt: '2026-11-22T01:00:00.000Z',
    updatedAt: '2026-11-22T01:00:00.000Z',
  }
}

export function createSavedLookDoubles() {
  const mockWardrobeSavedLookService = {
    // Story 7.6: the garment usage read counts one look for the configured member and garment;
    // any other pair means the controller delegated the wrong arguments.
    countSavedLooksUsingGarment: (userId: string, garmentId: string) => {
      const state = getProviderWardrobeState()
      if (state.userId !== userId || state.garmentId !== garmentId) {
        throw new Error(
          `countSavedLooksUsingGarment got ${userId}/${garmentId}, expected ${state.userId}/${state.garmentId}`
        )
      }
      return Promise.resolve(1)
    },
    createSavedLook: () =>
      Promise.resolve({
        data: buildContract(),
        isReplay: state.scenario === 'replay',
      }),
    listSavedLooks: () =>
      Promise.resolve({
        data: state.scenario === 'missing' ? [] : [buildContract()],
        total: state.scenario === 'missing' ? 0 : 1,
        limit: 50,
        offset: 0,
      }),
    getSavedLook: (_actor: unknown, savedLookId: string) => {
      if (state.scenario === 'missing' || savedLookId !== state.savedLookId) {
        return Promise.reject(new NotFoundException('SAVED_LOOK_NOT_FOUND'))
      }
      return Promise.resolve({ data: buildContract() })
    },
    restoreSavedLook: (_actor: unknown, savedLookId: string) => {
      if (state.scenario === 'missing' || savedLookId !== state.savedLookId) {
        return Promise.reject(new NotFoundException('SAVED_LOOK_NOT_FOUND'))
      }
      return Promise.resolve({ data: { ...buildContract(), revision: 2 } })
    },
    deleteSavedLook: (
      _actor: unknown,
      savedLookId: string,
      ifMatchHeader: string | undefined
    ) => {
      const expected = parseSavedLookIfMatchHeader(ifMatchHeader, savedLookId)
      if (state.scenario === 'missing' || savedLookId !== state.savedLookId) {
        return Promise.reject(new NotFoundException('SAVED_LOOK_NOT_FOUND'))
      }
      if (expected !== null && !expected.includes(0)) {
        return Promise.reject(
          new PreconditionFailedException('SAVED_LOOK_REVISION_MISMATCH')
        )
      }
      if (ifMatchHeader === undefined) {
        return Promise.reject(
          new HttpException('PRECONDITION_REQUIRED', HttpStatus.PRECONDITION_REQUIRED)
        )
      }
      return Promise.resolve(undefined)
    },
  } as unknown as WardrobeSavedLookService

  return { mockWardrobeSavedLookService }
}
