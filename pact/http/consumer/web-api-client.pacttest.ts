// Learning path Step 19: Scenario outfit generator.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-19-scenario-outfit-generator
// Learning path Step 20: Comfort calibration settings.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-20-comfort-calibration-settings
// Learning path Step 21: Reasoning badges and explanations.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-21-reasoning-badges-and-explanations
// Learning path Step 30: Smart tagging and comfort metadata.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-30-smart-tagging-and-comfort-metadata
// Learning path Step 31: Outfit capsule builder.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-31-outfit-capsule-builder
// Learning path Step 32: Wardrobe onboarding and silhouette setup.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-32-wardrobe-onboarding-and-silhouette-setup
// Learning path Step 33: Affiliate "Shop this look" CTA.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-33-affiliate-shop-this-look-cta
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
  verifyNeverSubscribedStatusInteraction,
  verifyCheckoutSessionInteraction,
  verifyPortalSessionInteraction,
  verifySubscriptionErrorInteraction,
  subscriptionErrorInteractions,
  verifyEntitledThemeReadInteraction,
  verifyEntitledThemeReadDefaultInteraction,
  verifyNotEntitledThemeReadInteraction,
  verifyThemeUpdateInteraction,
  verifyThemeResetInteraction,
  verifyPremiumThemeErrorInteraction,
  premiumThemeErrorInteractions,
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

  // Story 5.2: web reads status before rendering the subscribe CTA and
  // creates the Stripe Checkout / Customer Portal sessions. The refresh poll
  // is mobile's post-purchase concern; web returns from Checkout via the
  // Stripe redirect and re-reads status instead.
  it('reads the premium subscription status of a never-subscribed user', async () => {
    await verifyNeverSubscribedStatusInteraction(pact, createWebClientForMockServer)
  })

  it('creates a Stripe Checkout session', async () => {
    await verifyCheckoutSessionInteraction(pact, createWebClientForMockServer)
  })

  it('creates a Stripe Customer Portal session', async () => {
    await verifyPortalSessionInteraction(pact, createWebClientForMockServer)
  })

  it.each(subscriptionErrorInteractions)(
    'preserves the documented subscription error envelope that $description',
    async (interaction) => {
      await verifySubscriptionErrorInteraction(pact, interaction)
    }
  )

  // Story 5.3: unlike 5.2's asymmetric subscription split, web reads and
  // writes the premium theme from the same settings gallery.
  it('reads the resolved premium theme of an entitled user with a stored palette', async () => {
    await verifyEntitledThemeReadInteraction(pact, createWebClientForMockServer)
  })

  it('reads the resolved premium theme of an entitled user with no stored palette', async () => {
    await verifyEntitledThemeReadDefaultInteraction(pact, createWebClientForMockServer)
  })

  it('reads the resolved premium theme of a non-entitled user', async () => {
    await verifyNotEntitledThemeReadInteraction(pact, createWebClientForMockServer)
  })

  it('selects a premium theme palette', async () => {
    await verifyThemeUpdateInteraction(pact, createWebClientForMockServer)
  })

  it('resets the premium theme to Default', async () => {
    await verifyThemeResetInteraction(pact, createWebClientForMockServer)
  })

  it.each(premiumThemeErrorInteractions)(
    'preserves the documented premium theme error envelope that $description',
    async (interaction) => {
      await verifyPremiumThemeErrorInteraction(pact, interaction)
    }
  )
})
