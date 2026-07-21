import { PactV4 } from '@pact-foundation/pact'
import { createApiClient } from '@couture/api-client'
import path from 'node:path'
import { describe, it } from 'vitest'
import {
  pactEventAuth,
  verifyApiHealthInteraction,
  verifyEventsPollInteraction,
  verifyInvalidCursorInteraction,
  verifyRitualInteraction,
  verifyGetComfortPreferencesInteraction,
  verifyUpdateComfortPreferencesInteraction,
} from './api-contract-interactions'

const pact = new PactV4({
  dir: path.resolve(process.cwd(), 'pacts'),
  consumer: 'CoutureCastWeb',
  provider: 'CoutureCastApi',
  logLevel: 'warn',
})

const createWebClientForMockServer = (mockServer: { url: string }) =>
  createApiClient(mockServer.url, {
    accessToken: pactEventAuth.accessToken,
  })

describe('CoutureCastWeb -> CoutureCastApi HTTP contract', () => {
  it('reads API health metadata', async () => {
    await verifyApiHealthInteraction(pact, createWebClientForMockServer)
  })

  it('polls realtime fallback events', async () => {
    await verifyEventsPollInteraction(pact, createWebClientForMockServer)
  })

  it('returns the graceful invalid cursor payload used by fallback clients', async () => {
    await verifyInvalidCursorInteraction(pact, createWebClientForMockServer)
  })

  it('gets daily scenario outfit recommendations', async () => {
    await verifyRitualInteraction(pact, createWebClientForMockServer)
  })

  it('reads user comfort preferences', async () => {
    await verifyGetComfortPreferencesInteraction(pact, createWebClientForMockServer)
  })

  it('updates user comfort preferences', async () => {
    await verifyUpdateComfortPreferencesInteraction(pact, createWebClientForMockServer)
  })
})
