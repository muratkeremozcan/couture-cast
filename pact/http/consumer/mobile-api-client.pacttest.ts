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
  verifyCapsuleErrorInteraction,
  capsuleErrorInteractions,
  verifyOnboardingStateInteraction,
  verifyOnboardingVirtualDefaultInteraction,
  verifyPatchOnboardingStateInteraction,
  verifyOnboardingReplayInteraction,
  verifyWardrobeErrorInteraction,
  onboardingErrorInteractions,
  verifySilhouetteProfileInteraction,
  verifyUpdateSilhouetteSlidersInteraction,
  verifyUpdateSilhouetteSlidersReplayInteraction,
  silhouetteGuardianErrorInteractions,
  verifySilhouetteStalePreconditionInteraction,
  verifyMyFormUploadUrlInteraction,
  verifyMyFormCommitInteraction,
  verifyMyFormReadyInteraction,
  verifyMyFormFailureInteraction,
  myFormFailureReasons,
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

  it.each(capsuleErrorInteractions)(
    'preserves the documented capsule error envelope that $description',
    async (interaction) => {
      await verifyCapsuleErrorInteraction(pact, interaction)
    }
  )

  it('reads existing wardrobe onboarding progress', async () => {
    await verifyOnboardingStateInteraction(pact, createMobileClientForMockServer)
  })

  it('reads the virtual not_started onboarding default', async () => {
    await verifyOnboardingVirtualDefaultInteraction(pact, createMobileClientForMockServer)
  })

  it('advances the onboarding state machine one step', async () => {
    await verifyPatchOnboardingStateInteraction(pact, createMobileClientForMockServer)
  })

  it('replays a repeated identical onboarding step transition as a no-op', async () => {
    await verifyOnboardingReplayInteraction(pact, createMobileClientForMockServer)
  })

  it.each(onboardingErrorInteractions)(
    'preserves the documented onboarding error envelope: $description',
    async (interaction) => {
      await verifyWardrobeErrorInteraction(pact, interaction)
    }
  )

  it('reads the silhouette profile', async () => {
    await verifySilhouetteProfileInteraction(pact, createMobileClientForMockServer)
  })

  it('saves silhouette slider values', async () => {
    await verifyUpdateSilhouetteSlidersInteraction(pact, createMobileClientForMockServer)
  })

  it('replays a repeated identical silhouette slider save as a no-op', async () => {
    await verifyUpdateSilhouetteSlidersReplayInteraction(
      pact,
      createMobileClientForMockServer
    )
  })

  it.each(silhouetteGuardianErrorInteractions)(
    'enforces guardian consent on silhouette access: $description',
    async (interaction) => {
      await verifyWardrobeErrorInteraction(pact, interaction)
    }
  )

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

  it.each(myFormFailureReasons)(
    'preserves the documented My Form failure reason: %s',
    async (failureReason) => {
      await verifyMyFormFailureInteraction(
        pact,
        createMobileClientForMockServer,
        failureReason
      )
    }
  )

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
