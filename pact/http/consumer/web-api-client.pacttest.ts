import { PactV4 } from '@pact-foundation/pact'
import { createApiClient } from '@couture/api-client'
import path from 'node:path'
import { describe, it } from 'vitest'
import {
  verifyApiHealthInteraction,
  verifyEventsPollInteraction,
  verifyInvalidCursorInteraction,
} from './api-contract-interactions'

const pact = new PactV4({
  dir: path.resolve(process.cwd(), 'pacts'),
  consumer: 'CoutureCastWeb',
  provider: 'CoutureCastApi',
  logLevel: 'warn',
})

describe('CoutureCastWeb -> CoutureCastApi HTTP contract', () => {
  it('reads API health metadata', async () => {
    await verifyApiHealthInteraction(pact, (mockServer) =>
      createApiClient(mockServer.url)
    )
  })

  it('polls realtime fallback events', async () => {
    await verifyEventsPollInteraction(pact, (mockServer) =>
      createApiClient(mockServer.url)
    )
  })

  it('returns the graceful invalid cursor payload used by fallback clients', async () => {
    await verifyInvalidCursorInteraction(pact, (mockServer) =>
      createApiClient(mockServer.url)
    )
  })
})
