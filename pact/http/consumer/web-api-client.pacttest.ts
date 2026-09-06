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
  pactAdminAuth,
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
  verifyEntitledPaletteReadInteraction,
  verifyNotEntitledPaletteReadInteraction,
  verifyPaletteConsentGrantInteraction,
  verifyWardrobeAnalyzeInteraction,
  verifyDismissRecommendationInteraction,
  verifyPaletteAdvisorErrorInteraction,
  paletteAdvisorErrorInteractions,
  verifyPlannerReadyWeekInteraction,
  verifyPlannerPartialWeekInteraction,
  verifyPlannerAccessErrorInteraction,
  plannerAccessErrorInteractions,
  verifyPlannerReshuffleInteraction,
  verifyPlannerReshuffleUnchangedInteraction,
  verifyPlannerReshuffleConflictInteraction,
  // Story 6.1 community feed by climate band.
  verifyCommunityFeedInteraction,
  verifyCommunityFeedBandUnresolvedInteraction,
  verifyCommunityFeedRemovedContentInteraction,
  verifyCommunityFeedRejectionInteraction,
  communityFeedRejections,
  verifyCommunityPostInteraction,
  verifyCommunityPostNotFoundInteraction,
  verifyAllocateCommunityPostInteraction,
  verifyAllocateCommunityPostReplayInteraction,
  verifyAllocateCommunityPostMismatchInteraction,
  verifyPublishCommunityPostInteraction,
  verifyPublishCommunityPostConflictInteraction,
  verifyCommunityRateLimitInteraction,
  communityRateLimitInteractions,
  verifyReportCommunityPostInteraction,
  verifyReportCommunityPostRejectionInteraction,
  communityReportRejections,
  verifyReportCommunityPostRateLimitInteraction,
  verifyCreateCommunityChallengeInteraction,
  verifyCreateCommunityChallengeRejectionInteraction,
  communityChallengeRejections,
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

/**
 * Story 6.1: the community challenge routes mount `RolesGuard` with
 * `@Roles('admin')`, which neither the guardian nor the teen identity can pass.
 * The guard runs for real in the provider fixture, so recording that surface
 * honestly needs an actual admin actor.
 */
const createWebAdminClientForMockServer = (mockServer: { url: string }) =>
  createApiClient(mockServer.url, {
    accessToken: pactAdminAuth.accessToken,
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

  // Story 5.4: both surfaces read the profile on mount and write consent, an
  // analysis and a save/dismiss from the same screen.
  it('reads the palette advisor profile of an entitled user', async () => {
    await verifyEntitledPaletteReadInteraction(pact, createWebClientForMockServer)
  })

  it('reads the palette advisor profile of a non-entitled user', async () => {
    await verifyNotEntitledPaletteReadInteraction(pact, createWebClientForMockServer)
  })

  it('grants palette analysis consent', async () => {
    await verifyPaletteConsentGrantInteraction(pact, createWebClientForMockServer)
  })

  it('derives a palette from the wardrobe', async () => {
    await verifyWardrobeAnalyzeInteraction(pact, createWebClientForMockServer)
  })

  it('dismisses an advisor recommendation', async () => {
    await verifyDismissRecommendationInteraction(pact, createWebClientForMockServer)
  })

  it.each(paletteAdvisorErrorInteractions)(
    'preserves the documented palette advisor error envelope that $description',
    async (interaction) => {
      await verifyPaletteAdvisorErrorInteraction(pact, interaction)
    }
  )

  // Story 5.5: the premium 7-day outfit planner. Both surfaces fetch the
  // window once per open and reshuffle one day at a time.
  it('gets a fully ready seven-day outfit planner', async () => {
    await verifyPlannerReadyWeekInteraction(pact, createWebClientForMockServer)
  })

  it('gets a seven-day outfit planner with one isolated day failure', async () => {
    await verifyPlannerPartialWeekInteraction(pact, createWebClientForMockServer)
  })

  it.each(plannerAccessErrorInteractions)(
    'preserves the documented planner access error envelope that $description',
    async (interaction) => {
      await verifyPlannerAccessErrorInteraction(pact, interaction)
    }
  )

  it('reshuffles one planner day', async () => {
    await verifyPlannerReshuffleInteraction(pact, createWebClientForMockServer)
  })

  it('reshuffles a planner day with no disjoint result available', async () => {
    await verifyPlannerReshuffleUnchangedInteraction(pact, createWebClientForMockServer)
  })

  it('rejects a planner reshuffle at a stale version', async () => {
    await verifyPlannerReshuffleConflictInteraction(pact)
  })
  // Story 6.1: the community feed by climate band. `x-couture-platform` is
  // passed as a literal per consumer, so this pact records what web
  // actually sends rather than mirroring the other client's header.
  it('reads the auto-mode community feed', async () => {
    await verifyCommunityFeedInteraction(pact, createWebClientForMockServer, 'web')
  })

  it('reads the all-region community feed when the viewer band is unresolved', async () => {
    await verifyCommunityFeedBandUnresolvedInteraction(
      pact,
      createWebClientForMockServer,
      'web'
    )
  })

  it('reads a community feed carrying withdrawn and consent-suspended author content', async () => {
    await verifyCommunityFeedRemovedContentInteraction(
      pact,
      createWebClientForMockServer,
      'web'
    )
  })

  it.each(communityFeedRejections)(
    'preserves the documented community feed rejection envelope that $description',
    async (rejection) => {
      await verifyCommunityFeedRejectionInteraction(pact, rejection, 'web')
    }
  )

  it('resolves one visible community post directly', async () => {
    await verifyCommunityPostInteraction(pact, createWebClientForMockServer, 'web')
  })

  it('rejects a community post the caller cannot see', async () => {
    await verifyCommunityPostNotFoundInteraction(pact, 'web')
  })

  it('allocates a community post upload session', async () => {
    await verifyAllocateCommunityPostInteraction(
      pact,
      createWebClientForMockServer,
      'web'
    )
  })

  it('replays a community upload allocation with the same payload', async () => {
    await verifyAllocateCommunityPostReplayInteraction(
      pact,
      createWebClientForMockServer,
      'web'
    )
  })

  it('rejects a community upload allocation replayed with a different payload', async () => {
    await verifyAllocateCommunityPostMismatchInteraction(pact, 'web')
  })

  it('publishes a community post into moderation', async () => {
    await verifyPublishCommunityPostInteraction(pact, createWebClientForMockServer, 'web')
  })

  it('rejects a community publish whose upload session does not match the post', async () => {
    await verifyPublishCommunityPostConflictInteraction(pact, 'web')
  })

  it.each(communityRateLimitInteractions)(
    'preserves the documented community rate-limit envelope that $description',
    async (interaction) => {
      await verifyCommunityRateLimitInteraction(pact, interaction, 'web')
    }
  )

  it('reports a visible community post', async () => {
    await verifyReportCommunityPostInteraction(pact, createWebClientForMockServer, 'web')
  })

  it.each(communityReportRejections)(
    'preserves the documented community report rejection envelope that $description',
    async (rejection) => {
      await verifyReportCommunityPostRejectionInteraction(pact, rejection, 'web')
    }
  )

  it('refuses a community report that exceeds the reporting abuse limit', async () => {
    await verifyReportCommunityPostRateLimitInteraction(pact, 'web')
  })

  it('creates a Monday-anchored community challenge as an administrator', async () => {
    await verifyCreateCommunityChallengeInteraction(
      pact,
      createWebAdminClientForMockServer
    )
  })

  it.each(communityChallengeRejections)(
    'preserves the documented community challenge rejection envelope that $description',
    async (rejection) => {
      await verifyCreateCommunityChallengeRejectionInteraction(pact, rejection)
    }
  )
})
