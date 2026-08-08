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
  verifySuggestGarmentTagsInteraction,
  verifySuggestGarmentTagsErrorInteractions,
  verifyUpdateGarmentTagsInteraction,
  verifyUpdateGarmentTagsErrorInteractions,
  verifyUpdateGarmentTagsNullMaterialInteraction,
  verifyCreateCapsuleInteraction,
  verifyCapsuleIdempotentReplayInteraction,
  verifyListCapsulesInteraction,
  verifyCapsuleDetailInteraction,
  verifyUpdateCapsuleInteraction,
  verifyFavoriteCapsuleInteraction,
  verifyDeleteCapsuleInteraction,
  verifyCapsuleErrorInteractions,
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

  it('suggests garment smart tags', async () => {
    await verifySuggestGarmentTagsInteraction(pact, createWebClientForMockServer)
  })

  it('updates garment smart tags', async () => {
    await verifyUpdateGarmentTagsInteraction(pact, createWebClientForMockServer)
  })

  it('preserves documented smart-tagging error envelopes', async () => {
    await verifySuggestGarmentTagsErrorInteractions(pact)
    await verifyUpdateGarmentTagsErrorInteractions(pact)
  })

  it('clears nullable garment material', async () => {
    await verifyUpdateGarmentTagsNullMaterialInteraction(
      pact,
      createWebClientForMockServer
    )
  })

  it('creates an outfit capsule', async () => {
    await verifyCreateCapsuleInteraction(pact, createWebClientForMockServer)
  })

  it('replays an idempotent capsule creation', async () => {
    await verifyCapsuleIdempotentReplayInteraction(pact, createWebClientForMockServer)
  })

  it('lists and filters outfit capsules', async () => {
    await verifyListCapsulesInteraction(pact, createWebClientForMockServer)
  })

  it('reads one outfit capsule', async () => {
    await verifyCapsuleDetailInteraction(pact, createWebClientForMockServer)
  })

  it('renames an outfit capsule under a current precondition', async () => {
    await verifyUpdateCapsuleInteraction(pact, createWebClientForMockServer)
  })

  it('sets the favorite state of an outfit capsule', async () => {
    await verifyFavoriteCapsuleInteraction(pact, createWebClientForMockServer)
  })

  it('deletes an outfit capsule', async () => {
    await verifyDeleteCapsuleInteraction(pact, createWebClientForMockServer)
  })

  it('preserves documented capsule error envelopes', async () => {
    await verifyCapsuleErrorInteractions(pact)
  })
})
