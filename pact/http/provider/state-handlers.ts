import type { VerifierOptions } from '@pact-foundation/pact'
import { configureProviderEvent, parsePactEvent, type PactEvent } from './provider-helper'

type StateHandlers = NonNullable<VerifierOptions['stateHandlers']>

export type WarningAlertStateParams = {
  since: string
  event: PactEvent | string
}

export const stateHandlers: StateHandlers = {
  '': () => Promise.resolve({ description: 'No provider state required' }),
  'A warning alert event exists after the polling cursor': (parameters?: unknown) => {
    const { event } = parameters as WarningAlertStateParams
    const parsedEvent = parsePactEvent(event)
    configureProviderEvent(parsedEvent)
    return Promise.resolve({ description: `Configured event ${parsedEvent.id}` })
  },
}
