import type { VerifierOptions } from '@pact-foundation/pact'
import {
  configureProviderEvent,
  configureProviderWardrobeState,
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
