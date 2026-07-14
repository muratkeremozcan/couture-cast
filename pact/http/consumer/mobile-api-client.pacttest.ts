import type { V3MockServer } from '@pact-foundation/pact'
import { PactV4 } from '@pact-foundation/pact'
import path from 'node:path'
import { describe, it } from 'vitest'
import { createMobileApiClient } from '../../../apps/mobile/src/lib/api-client'
import {
  pactEventAuth,
  verifyApiHealthInteraction,
  verifyEventsPollInteraction,
  verifyInvalidCursorInteraction,
} from './api-contract-interactions'

const pact = new PactV4({
  dir: path.resolve(process.cwd(), 'pacts'),
  consumer: 'CoutureCastMobile',
  provider: 'CoutureCastApi',
  logLevel: 'warn',
})

function createMobileClientForMockServer(mockServer: V3MockServer) {
  return createMobileApiClient({
    baseUrl: mockServer.url,
    accessToken: pactEventAuth.accessToken,
  })
}

describe('CoutureCastMobile -> CoutureCastApi HTTP contract', () => {
  it('reads API health metadata', async () => {
    await verifyApiHealthInteraction(pact, createMobileClientForMockServer)
  })

  it('polls realtime fallback events', async () => {
    await verifyEventsPollInteraction(pact, createMobileClientForMockServer)
  })

  it('returns the graceful invalid cursor payload used by fallback clients', async () => {
    await verifyInvalidCursorInteraction(pact, createMobileClientForMockServer)
  })
})
