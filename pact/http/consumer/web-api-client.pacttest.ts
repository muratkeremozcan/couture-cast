import { PactV4 } from '@pact-foundation/pact'
import { createApiClient } from '@couture/api-client'
import path from 'node:path'
import { describe, it } from 'vitest'
import {
  pactEventAuth,
  pactTeenAuth,
  verifyApiHealthInteraction,
  verifyEventsPollInteraction,
  verifyInvalidCursorInteraction,
  verifyRitualInteraction,
  verifyGetComfortPreferencesInteraction,
  verifyUpdateComfortPreferencesInteraction,
  verifySuggestGarmentTagsInteraction,
  verifySmartTagErrorInteraction,
  suggestGarmentTagsErrorInteractions,
  verifyUpdateGarmentTagsInteraction,
  updateGarmentTagsErrorInteractions,
  verifyUpdateGarmentTagsNullMaterialInteraction,
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
  verifyMyFormUploadUrlReplayInteraction,
  verifyMyFormCommitInteraction,
  verifyMyFormCommitReplayInteraction,
  verifyMyFormReadyInteraction,
  verifyMyFormFailureInteraction,
  myFormFailureReasons,
  verifyMyFormGuardianNotificationInteraction,
  verifyMyFormDeleteInteraction,
  verifyRitualEligibleShopThisLookInteraction,
  verifyCommercePreferencesReadInteraction,
  verifyCommercePreferencesOptOutInteraction,
  verifyAffiliateClickMintInteraction,
  verifyAffiliateClickDedupeInteraction,
  verifyAffiliateClickErrorInteraction,
  affiliateClickErrorInteractions,
  verifyAffiliateWebhookInteraction,
  verifyAffiliateWebhookErrorInteraction,
  affiliateWebhookErrorInteractions,
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

const createWebTeenClientForMockServer = (mockServer: { url: string }) =>
  createApiClient(mockServer.url, {
    accessToken: pactTeenAuth.accessToken,
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

  it.each(suggestGarmentTagsErrorInteractions)(
    'preserves the documented smart-tag suggestion error envelope: $description',
    async (interaction) => {
      await verifySmartTagErrorInteraction(pact, interaction)
    }
  )

  it.each(updateGarmentTagsErrorInteractions)(
    'preserves the documented smart-tag update error envelope: $description',
    async (interaction) => {
      await verifySmartTagErrorInteraction(pact, interaction)
    }
  )

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

  it.each(capsuleErrorInteractions)(
    'preserves the documented capsule error envelope that $description',
    async (interaction) => {
      await verifyCapsuleErrorInteraction(pact, interaction)
    }
  )

  it('reads existing wardrobe onboarding progress', async () => {
    await verifyOnboardingStateInteraction(pact, createWebClientForMockServer)
  })

  it('reads the virtual not_started onboarding default', async () => {
    await verifyOnboardingVirtualDefaultInteraction(pact, createWebClientForMockServer)
  })

  it('advances the onboarding state machine one step', async () => {
    await verifyPatchOnboardingStateInteraction(pact, createWebClientForMockServer)
  })

  it('replays a repeated identical onboarding step transition as a no-op', async () => {
    await verifyOnboardingReplayInteraction(pact, createWebClientForMockServer)
  })

  it.each(onboardingErrorInteractions)(
    'preserves the documented onboarding error envelope: $description',
    async (interaction) => {
      await verifyWardrobeErrorInteraction(pact, interaction)
    }
  )

  it('reads the silhouette profile', async () => {
    await verifySilhouetteProfileInteraction(pact, createWebClientForMockServer)
  })

  it('saves silhouette slider values', async () => {
    await verifyUpdateSilhouetteSlidersInteraction(pact, createWebClientForMockServer)
  })

  it('replays a repeated identical silhouette slider save as a no-op', async () => {
    await verifyUpdateSilhouetteSlidersReplayInteraction(
      pact,
      createWebClientForMockServer
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
    await verifyMyFormUploadUrlInteraction(pact, createWebClientForMockServer)
  })

  it('replays a repeated My Form upload session allocation', async () => {
    await verifyMyFormUploadUrlReplayInteraction(pact, createWebClientForMockServer)
  })

  it('commits the My Form photo for processing', async () => {
    await verifyMyFormCommitInteraction(pact, createWebClientForMockServer)
  })

  it('replays a repeated My Form commit', async () => {
    await verifyMyFormCommitReplayInteraction(pact, createWebClientForMockServer)
  })

  it('reads a ready My Form photo', async () => {
    await verifyMyFormReadyInteraction(pact, createWebClientForMockServer)
  })

  it.each(myFormFailureReasons)(
    'preserves the documented My Form failure reason: %s',
    async (failureReason) => {
      await verifyMyFormFailureInteraction(
        pact,
        createWebClientForMockServer,
        failureReason
      )
    }
  )

  it('queues a guardian notification for a teen privacy_violation verdict', async () => {
    await verifyMyFormGuardianNotificationInteraction(
      pact,
      createWebTeenClientForMockServer
    )
  })

  it('deletes the My Form photo and reverts to the default mannequin', async () => {
    await verifyMyFormDeleteInteraction(pact, createWebClientForMockServer)
  })
  it('gets a ritual whose cards carry an eligible affiliate offer', async () => {
    await verifyRitualEligibleShopThisLookInteraction(pact, createWebClientForMockServer)
  })

  it('reads the affiliate CTA preference', async () => {
    await verifyCommercePreferencesReadInteraction(pact, createWebClientForMockServer)
  })

  it('turns affiliate suggestions off', async () => {
    await verifyCommercePreferencesOptOutInteraction(pact, createWebClientForMockServer)
  })

  it('mints an attributed affiliate click', async () => {
    await verifyAffiliateClickMintInteraction(pact, createWebClientForMockServer)
  })

  it('dedupes a repeat activation onto the existing click', async () => {
    await verifyAffiliateClickDedupeInteraction(pact, createWebClientForMockServer)
  })

  it.each(affiliateClickErrorInteractions)(
    'preserves the documented affiliate click error envelope that $description',
    async (interaction) => {
      await verifyAffiliateClickErrorInteraction(pact, interaction)
    }
  )

  it('records a signed partner conversion webhook', async () => {
    await verifyAffiliateWebhookInteraction(pact, createWebClientForMockServer)
  })

  it.each(affiliateWebhookErrorInteractions)(
    'preserves the documented affiliate webhook error envelope that $description',
    async (interaction) => {
      await verifyAffiliateWebhookErrorInteraction(pact, interaction)
    }
  )
})
