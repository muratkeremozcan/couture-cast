import type { V3MockServer } from '@pact-foundation/pact'
import { PactV4 } from '@pact-foundation/pact'
import path from 'node:path'
import { describe, it } from 'vitest'
import { createMobileApiClient } from '../../../apps/mobile/src/lib/api-client'
import {
  pactEventAuth,
  pactTeenAuth,
  verifyApiHealthInteraction,
  verifyEventsPollInteraction,
  verifyInvalidCursorInteraction,
  verifyRitualInteraction,
  verifyRitualLocalizationInteraction,
  verifyGetComfortPreferencesInteraction,
  verifyUpdateComfortPreferencesInteraction,
  verifyUpdateUserPreferencesInteraction,
  verifySuggestGarmentTagsInteraction,
  verifyUpdateGarmentTagsInteraction,
  verifyCreateCapsuleInteraction,
  verifyCapsuleIdempotentReplayInteraction,
  verifyListCapsulesInteraction,
  verifyCapsuleDetailInteraction,
  verifyUpdateCapsuleInteraction,
  verifyFavoriteCapsuleInteraction,
  verifyDeleteCapsuleInteraction,
  verifyCapsuleErrorInteractions,
  verifyOnboardingStateInteraction,
  verifyOnboardingVirtualDefaultInteraction,
  verifyPatchOnboardingStateInteraction,
  verifyOnboardingErrorInteractions,
  verifySilhouetteProfileInteraction,
  verifyUpdateSilhouetteSlidersInteraction,
  verifySilhouetteGuardianConsentInteractions,
  verifySilhouetteStalePreconditionInteraction,
  verifyMyFormUploadUrlInteraction,
  verifyMyFormCommitInteraction,
  verifyMyFormReadyInteraction,
  verifyMyFormFailureInteractions,
  verifyMyFormGuardianNotificationInteraction,
  verifyMyFormDeleteInteraction,
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

function createMobileTeenClientForMockServer(mockServer: V3MockServer) {
  return createMobileApiClient({
    baseUrl: mockServer.url,
    accessToken: pactTeenAuth.accessToken,
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

  it('gets daily scenario outfit recommendations', async () => {
    await verifyRitualInteraction(pact, createMobileClientForMockServer)
  })

  it('gets daily scenario outfit recommendations with an explicit locale', async () => {
    await verifyRitualLocalizationInteraction(pact, createMobileClientForMockServer)
  })

  it('reads user comfort preferences', async () => {
    await verifyGetComfortPreferencesInteraction(pact, createMobileClientForMockServer)
  })

  it('updates user comfort preferences', async () => {
    await verifyUpdateComfortPreferencesInteraction(pact, createMobileClientForMockServer)
  })

  it('persists the selected mobile locale', async () => {
    await verifyUpdateUserPreferencesInteraction(pact, createMobileClientForMockServer)
  })

  it('suggests garment smart tags', async () => {
    await verifySuggestGarmentTagsInteraction(pact, createMobileClientForMockServer)
  })

  it('updates garment smart tags', async () => {
    await verifyUpdateGarmentTagsInteraction(pact, createMobileClientForMockServer)
  })

  it('creates an outfit capsule', async () => {
    await verifyCreateCapsuleInteraction(pact, createMobileClientForMockServer)
  })

  it('replays an idempotent capsule creation', async () => {
    await verifyCapsuleIdempotentReplayInteraction(pact, createMobileClientForMockServer)
  })

  it('lists and filters outfit capsules', async () => {
    await verifyListCapsulesInteraction(pact, createMobileClientForMockServer)
  })

  it('reads one outfit capsule', async () => {
    await verifyCapsuleDetailInteraction(pact, createMobileClientForMockServer)
  })

  it('renames an outfit capsule under a current precondition', async () => {
    await verifyUpdateCapsuleInteraction(pact, createMobileClientForMockServer)
  })

  it('sets the favorite state of an outfit capsule', async () => {
    await verifyFavoriteCapsuleInteraction(pact, createMobileClientForMockServer)
  })

  it('deletes an outfit capsule', async () => {
    await verifyDeleteCapsuleInteraction(pact, createMobileClientForMockServer)
  })

  it('preserves documented capsule error envelopes', async () => {
    await verifyCapsuleErrorInteractions(pact)
  })

  it('reads existing wardrobe onboarding progress', async () => {
    await verifyOnboardingStateInteraction(pact, createMobileClientForMockServer)
  })

  it('reads the virtual not_started onboarding default', async () => {
    await verifyOnboardingVirtualDefaultInteraction(pact, createMobileClientForMockServer)
  })

  it('advances the onboarding state machine one step', async () => {
    await verifyPatchOnboardingStateInteraction(pact, createMobileClientForMockServer)
  })

  it('preserves documented onboarding error envelopes', async () => {
    await verifyOnboardingErrorInteractions(pact)
  })

  it('reads the silhouette profile', async () => {
    await verifySilhouetteProfileInteraction(pact, createMobileClientForMockServer)
  })

  it('saves silhouette slider values', async () => {
    await verifyUpdateSilhouetteSlidersInteraction(pact, createMobileClientForMockServer)
  })

  it('enforces guardian consent on silhouette reads and writes', async () => {
    await verifySilhouetteGuardianConsentInteractions(pact)
  })

  it('rejects a stale silhouette revision precondition', async () => {
    await verifySilhouetteStalePreconditionInteraction(pact)
  })

  it('allocates a My Form upload session', async () => {
    await verifyMyFormUploadUrlInteraction(pact, createMobileClientForMockServer)
  })

  it('commits the My Form photo for processing', async () => {
    await verifyMyFormCommitInteraction(pact, createMobileClientForMockServer)
  })

  it('reads a ready My Form photo', async () => {
    await verifyMyFormReadyInteraction(pact, createMobileClientForMockServer)
  })

  it('preserves each documented My Form failure reason', async () => {
    await verifyMyFormFailureInteractions(pact, createMobileClientForMockServer)
  })

  it('queues a guardian notification for a teen privacy_violation verdict', async () => {
    await verifyMyFormGuardianNotificationInteraction(
      pact,
      createMobileTeenClientForMockServer
    )
  })

  it('deletes the My Form photo and reverts to the default mannequin', async () => {
    await verifyMyFormDeleteInteraction(pact, createMobileClientForMockServer)
  })
})
