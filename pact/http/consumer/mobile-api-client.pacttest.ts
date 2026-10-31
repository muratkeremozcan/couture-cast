import {
  shareCardInteractions,
  verifyShareCardInteraction,
} from './interactions/share-cards'
import {
  communityEngagementInteractions,
  verifyCommunityEngagement,
  commentOperations,
  commentFailureCases,
  verifyCommunityCommentFailure,
  verifyCommunityCommentPage,
  verifyCommunityComment,
  verifyCommunityCommentMissing,
  communityReactionConflictInteractions,
  verifyCommunityReactionConflictInteraction,
  verifyCommunityReactionRateLimitInteraction,
  verifyCommunityReactionFeedInteraction,
  communityReactionInteractions,
  verifyCommunityReactionPostInteraction,
  verifyCommunityReactionInteraction,
  // Story 6.7b opted-in sponsored reads.
  verifyCommunitySponsoredFeedInteraction,
  verifyCommunitySponsoredSpotlightInteraction,
  verifyCommunitySponsoredHomeTeaserInteraction,
  verifyCommunitySponsoredPostInteraction,
  type CommunitySponsoredReads,
} from './interactions/community'
// Learning path Step 19: Scenario outfit generator.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-19-scenario-outfit-generator
// Learning path Step 20: Comfort calibration settings.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-20-comfort-calibration-settings
// Learning path Step 21: Reasoning badges and explanations.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-21-reasoning-badges-and-explanations
// Learning path Step 22: Localization infrastructure and quality gates.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-22-localization-infrastructure-and-quality-gates
// Learning path Step 30: Smart tagging and comfort metadata.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-30-smart-tagging-and-comfort-metadata
// Learning path Step 31: Outfit capsule builder.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-31-outfit-capsule-builder
// Learning path Step 32: Wardrobe onboarding and silhouette setup.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-32-wardrobe-onboarding-and-silhouette-setup
// Learning path Step 33: Affiliate "Shop this look" CTA.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-33-affiliate-shop-this-look-cta
// Learning path Step 41: Curated reactions.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-41-curated-reactions
// Learning path Step 42: Screened threaded comments.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-42-screened-threaded-comments
// Learning path Step 43: Realtime engagement and push notifications.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-43-realtime-engagement-and-push-notifications
// Learning path Step 44: Community city spotlight.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-44-community-city-spotlight
// Learning path Step 45: Client location capture.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-45-client-location-capture
// Learning path Step 46: Home spotlight teaser.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-46-home-spotlight-teaser
// Learning path Step 47: Sponsored community highlights.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-47-sponsored-community-highlights
// Learning path Step 48: Safe branded share-card export.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-48-safe-branded-share-card-export
import { PactV4, type V3MockServer } from '@pact-foundation/pact'
import path from 'node:path'
import { describe, it } from 'vitest'
import { createMobileApiClient } from '../../../apps/mobile/src/lib/api-client'
import {
  getCommunityFeedFromMobile,
  getCommunityPostFromMobile,
  getCommunitySpotlightFromMobile,
} from '../../../apps/mobile/src/lib/community'
import { setMobileAccessTokenResolver } from '../../../apps/mobile/src/lib/mobile-auth'
import {
  pactEventAuth,
  pactTeenAuth,
  pactAdminAuth,
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
  // Story 6.7b sponsored community CTA clicks.
  communityAffiliateClickSurfaces,
  verifyCommunityAffiliateClickMintInteraction,
  verifyCommunityAffiliateClickEndedInteraction,
  verifyEntitledSubscriptionStatusInteraction,
  verifySubscriptionRefreshInteraction,
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
  // Story 6.6 City Spotlight and both opened branches.
  verifyCommunitySpotlightInteraction,
  verifyCommunitySpotlightNoneInteraction,
  verifyCommunityReactionSpotlightInteraction,
  verifyCommunitySpotlightPageTwoInteraction,
  verifyCommunitySpotlightInvalidCursorInteraction,
  verifyCommunitySpotlightDisabledInteraction,
  verifyOpenCommunitySpotlightPostInteraction,
  // Story 6.7 Home teaser read and open.
  verifyCommunitySpotlightHomeTeaserInteraction,
  verifyOpenCommunityHomeTeaserPostInteraction,
  verifyCommunitySpotlightHomeTeaserRateLimitedInteraction,
  verifyOpenCommunityFeedPostInteraction,
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
  verifyLocationSearchInteraction,
  verifyLocationSearchErrorInteraction,
  locationSearchErrorInteractions,
  verifyLocationSearchRateLimitedInteraction,
  verifyLocationSaveFromSearchInteraction,
  verifyLocationSaveErrorInteraction,
  locationSaveErrorInteractions,
  verifyLocationListInteraction,
  verifyLocationSetPrimaryInteraction,
  verifyLocationSetPrimaryForeignInteraction,
  verifyLocationDeleteInteraction,
  verifyLocationDeleteForeignInteraction,
  verifyLocationRenameInteraction,
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

/**
 * Story 6.7b: runs a real `apps/mobile/src/lib/community.ts` read against the
 * mock server. `createMobileApiClient` reads `EXPO_PUBLIC_API_BASE_URL` per
 * request and the wrapper asks `mobile-auth` for its bearer, so this points the
 * one and installs a resolver for the other for the call, then restores both.
 * The wrapper code is real, so the opt-in headers recorded are the ones the
 * mobile app sends.
 */
async function withMobileApp<T>(mockServer: V3MockServer, read: () => Promise<T>) {
  const previousBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL
  process.env.EXPO_PUBLIC_API_BASE_URL = mockServer.url
  const restoreResolver = setMobileAccessTokenResolver(() => pactEventAuth.accessToken)
  try {
    return await read()
  } finally {
    restoreResolver()
    if (previousBaseUrl === undefined) delete process.env.EXPO_PUBLIC_API_BASE_URL
    else process.env.EXPO_PUBLIC_API_BASE_URL = previousBaseUrl
  }
}

const mobileSponsoredReads: CommunitySponsoredReads = {
  feed: (mockServer, request) =>
    withMobileApp(mockServer, () => getCommunityFeedFromMobile(request)),
  spotlight: (mockServer, request) =>
    withMobileApp(mockServer, () => getCommunitySpotlightFromMobile(request)),
  post: (mockServer, postId) =>
    withMobileApp(mockServer, () => getCommunityPostFromMobile(postId)),
}

function createMobileTeenClientForMockServer(mockServer: V3MockServer) {
  return createMobileApiClient({
    baseUrl: mockServer.url,
    accessToken: pactTeenAuth.accessToken,
  })
}

/**
 * Story 6.1: the community challenge routes mount `RolesGuard` with
 * `@Roles('admin')`, and the guard runs for real in the provider fixture, so
 * recording that surface honestly needs an actual admin actor.
 */
function createMobileAdminClientForMockServer(mockServer: V3MockServer) {
  return createMobileApiClient({
    baseUrl: mockServer.url,
    accessToken: pactAdminAuth.accessToken,
  })
}

describe('CoutureCastMobile -> CoutureCastApi HTTP contract', () => {
  for (const interaction of communityEngagementInteractions) {
    it(interaction.id, async () => {
      await verifyCommunityEngagement(
        pact,
        createMobileClientForMockServer,
        'mobile',
        interaction
      )
    })
  }

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

  it('replays a repeated My Form upload session allocation', async () => {
    await verifyMyFormUploadUrlReplayInteraction(pact, createMobileClientForMockServer)
  })

  it('commits the My Form photo for processing', async () => {
    await verifyMyFormCommitInteraction(pact, createMobileClientForMockServer)
  })

  it('replays a repeated My Form commit', async () => {
    await verifyMyFormCommitReplayInteraction(pact, createMobileClientForMockServer)
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
  it('gets a ritual whose cards carry an eligible affiliate offer', async () => {
    await verifyRitualEligibleShopThisLookInteraction(
      pact,
      createMobileClientForMockServer
    )
  })

  it('reads the affiliate CTA preference', async () => {
    await verifyCommercePreferencesReadInteraction(pact, createMobileClientForMockServer)
  })

  it('turns affiliate suggestions off', async () => {
    await verifyCommercePreferencesOptOutInteraction(
      pact,
      createMobileClientForMockServer
    )
  })

  it('mints an attributed affiliate click', async () => {
    await verifyAffiliateClickMintInteraction(pact, createMobileClientForMockServer)
  })

  it('dedupes a repeat activation onto the existing click', async () => {
    await verifyAffiliateClickDedupeInteraction(pact, createMobileClientForMockServer)
  })

  it.each(affiliateClickErrorInteractions)(
    'preserves the documented affiliate click error envelope that $description',
    async (interaction) => {
      await verifyAffiliateClickErrorInteraction(pact, interaction)
    }
  )

  it.each(communityAffiliateClickSurfaces)(
    'mints an attributed click from the sponsored %s CTA',
    async (surface) => {
      await verifyCommunityAffiliateClickMintInteraction(
        pact,
        createMobileClientForMockServer,
        surface
      )
    }
  )

  it.each(communityAffiliateClickSurfaces)(
    'refuses a sponsored %s click after the sponsorship ended',
    async (surface) => {
      await verifyCommunityAffiliateClickEndedInteraction(pact, surface)
    }
  )

  it('records a signed partner conversion webhook', async () => {
    await verifyAffiliateWebhookInteraction(pact, createMobileClientForMockServer)
  })

  it.each(affiliateWebhookErrorInteractions)(
    'preserves the documented affiliate webhook error envelope that $description',
    async (interaction) => {
      await verifyAffiliateWebhookErrorInteraction(pact, interaction)
    }
  )

  // Story 5.2: mobile reads status and triggers the post-purchase refresh
  // poll only. Checkout and portal sessions are the web rail's; the store
  // purchase itself goes through RevenueCat, never through this API.
  it('reads the premium subscription status of an entitled user', async () => {
    await verifyEntitledSubscriptionStatusInteraction(
      pact,
      createMobileClientForMockServer
    )
  })

  it('refreshes the premium subscription from the entitlement ledger', async () => {
    await verifySubscriptionRefreshInteraction(pact, createMobileClientForMockServer)
  })

  // Story 5.3: unlike 5.2's asymmetric subscription split, mobile reads and
  // writes the premium theme from the same settings gallery.
  it('reads the resolved premium theme of an entitled user with a stored palette', async () => {
    await verifyEntitledThemeReadInteraction(pact, createMobileClientForMockServer)
  })

  it('reads the resolved premium theme of an entitled user with no stored palette', async () => {
    await verifyEntitledThemeReadDefaultInteraction(pact, createMobileClientForMockServer)
  })

  it('reads the resolved premium theme of a non-entitled user', async () => {
    await verifyNotEntitledThemeReadInteraction(pact, createMobileClientForMockServer)
  })

  it('selects a premium theme palette', async () => {
    await verifyThemeUpdateInteraction(pact, createMobileClientForMockServer)
  })

  it('resets the premium theme to Default', async () => {
    await verifyThemeResetInteraction(pact, createMobileClientForMockServer)
  })

  it.each(premiumThemeErrorInteractions)(
    'preserves the documented premium theme error envelope that $description',
    async (interaction) => {
      await verifyPremiumThemeErrorInteraction(pact, interaction)
    }
  )

  // Story 6.4: both surfaces preserve screened thread, refusal and paging contracts.
  it.each(commentOperations)(
    'preserves screened comment %s contracts',
    async (operation) => {
      await verifyCommunityComment(
        pact,
        createMobileClientForMockServer,
        'mobile',
        operation
      )
    }
  )
  it.each(commentFailureCases)('preserves comment refusal $name', async (failure) => {
    await verifyCommunityCommentFailure(
      pact,
      createMobileClientForMockServer,
      'mobile',
      failure
    )
  })
  it.each(['roots', 'replies', 'submissions'] as const)(
    'preserves paginated comment %s contracts',
    async (operation) => {
      await verifyCommunityCommentPage(
        pact,
        createMobileClientForMockServer,
        'mobile',
        operation
      )
    }
  )
  it('refuses an unavailable comment thread', async () => {
    await verifyCommunityCommentMissing(pact, createMobileClientForMockServer, 'mobile')
  })

  it('[P0] preserves the current summary when a reaction revision is stale', async () => {
    await verifyCommunityReactionConflictInteraction(
      pact,
      createMobileClientForMockServer,
      'mobile',
      communityReactionConflictInteractions[0]
    )
  })

  it('[P0] preserves the current summary when a reaction receipt payload changes', async () => {
    await verifyCommunityReactionConflictInteraction(
      pact,
      createMobileClientForMockServer,
      'mobile',
      communityReactionConflictInteractions[1]
    )
  })

  it('[P1] exposes the reaction rolling-window Retry-After through ResponseError', async () => {
    await verifyCommunityReactionRateLimitInteraction(
      pact,
      createMobileClientForMockServer,
      'mobile'
    )
  })

  it('[P0] reads a negotiated feed with a populated viewer reaction summary', async () => {
    await verifyCommunityReactionFeedInteraction(
      pact,
      createMobileClientForMockServer,
      'mobile'
    )
  })

  it('negotiates reaction fields without changing legacy detail', async () => {
    await verifyCommunityReactionPostInteraction(
      pact,
      createMobileClientForMockServer,
      'mobile'
    )
  })

  it.each(communityReactionInteractions)(
    'sets a desired reaction $selection',
    async (interaction) => {
      await verifyCommunityReactionInteraction(
        pact,
        createMobileClientForMockServer,
        'mobile',
        interaction
      )
    }
  )

  it('reads the palette advisor profile of an entitled user', async () => {
    await verifyEntitledPaletteReadInteraction(pact, createMobileClientForMockServer)
  })

  it('reads the palette advisor profile of a non-entitled user', async () => {
    await verifyNotEntitledPaletteReadInteraction(pact, createMobileClientForMockServer)
  })

  it('grants palette analysis consent', async () => {
    await verifyPaletteConsentGrantInteraction(pact, createMobileClientForMockServer)
  })

  it('derives a palette from the wardrobe', async () => {
    await verifyWardrobeAnalyzeInteraction(pact, createMobileClientForMockServer)
  })

  it('dismisses an advisor recommendation', async () => {
    await verifyDismissRecommendationInteraction(pact, createMobileClientForMockServer)
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
    await verifyPlannerReadyWeekInteraction(pact, createMobileClientForMockServer)
  })

  it('gets a seven-day outfit planner with one isolated day failure', async () => {
    await verifyPlannerPartialWeekInteraction(pact, createMobileClientForMockServer)
  })

  it.each(plannerAccessErrorInteractions)(
    'preserves the documented planner access error envelope that $description',
    async (interaction) => {
      await verifyPlannerAccessErrorInteraction(pact, interaction)
    }
  )

  it('reshuffles one planner day', async () => {
    await verifyPlannerReshuffleInteraction(pact, createMobileClientForMockServer)
  })

  it('reshuffles a planner day with no disjoint result available', async () => {
    await verifyPlannerReshuffleUnchangedInteraction(
      pact,
      createMobileClientForMockServer
    )
  })

  it('rejects a planner reshuffle at a stale version', async () => {
    await verifyPlannerReshuffleConflictInteraction(pact)
  })
  // Story 6.1: the community feed by climate band. `x-couture-platform` is
  // passed as a literal per consumer, so this pact records what mobile sends.
  it('reads the auto-mode community feed', async () => {
    await verifyCommunityFeedInteraction(pact, createMobileClientForMockServer, 'mobile')
  })

  it('reads the all-region community feed when the viewer band is unresolved', async () => {
    await verifyCommunityFeedBandUnresolvedInteraction(
      pact,
      createMobileClientForMockServer,
      'mobile'
    )
  })

  it('reads a community feed carrying withdrawn and consent-suspended author content', async () => {
    await verifyCommunityFeedRemovedContentInteraction(
      pact,
      createMobileClientForMockServer,
      'mobile'
    )
  })

  it.each(communityFeedRejections)(
    'preserves the documented community feed rejection envelope that $description',
    async (rejection) => {
      await verifyCommunityFeedRejectionInteraction(pact, rejection, 'mobile')
    }
  )

  it('reads the city spotlight for the viewer area', async () => {
    await verifyCommunitySpotlightInteraction(
      pact,
      createMobileClientForMockServer,
      'mobile'
    )
  })

  it('reads a spotlight with no eligible cohort', async () => {
    await verifyCommunitySpotlightNoneInteraction(
      pact,
      createMobileClientForMockServer,
      'mobile'
    )
  })

  it('reads the negotiated city spotlight with live reactions', async () => {
    await verifyCommunityReactionSpotlightInteraction(
      pact,
      createMobileClientForMockServer,
      'mobile'
    )
  })

  it('reads spotlight page two with the page-one cursor', async () => {
    await verifyCommunitySpotlightPageTwoInteraction(
      pact,
      createMobileClientForMockServer,
      'mobile'
    )
  })

  it('restarts the spotlight on an invalid_cursor refusal', async () => {
    await verifyCommunitySpotlightInvalidCursorInteraction(
      pact,
      createMobileClientForMockServer,
      'mobile'
    )
  })

  it('reads the spotlight refusal while the read rollout is off', async () => {
    await verifyCommunitySpotlightDisabledInteraction(
      pact,
      createMobileClientForMockServer,
      'mobile'
    )
  })

  it('records a spotlight card open with its rank', async () => {
    await verifyOpenCommunitySpotlightPostInteraction(
      pact,
      createMobileClientForMockServer,
      'mobile'
    )
  })

  it('reads the top spotlight entry for the home teaser', async () => {
    await verifyCommunitySpotlightHomeTeaserInteraction(
      pact,
      createMobileClientForMockServer,
      'mobile'
    )
  })

  it('records a home teaser open with rank one', async () => {
    await verifyOpenCommunityHomeTeaserPostInteraction(
      pact,
      createMobileClientForMockServer,
      'mobile'
    )
  })

  it('reports a home teaser read over the limit with its Retry-After', async () => {
    await verifyCommunitySpotlightHomeTeaserRateLimitedInteraction(
      pact,
      createMobileClientForMockServer,
      'mobile'
    )
  })

  it('records a feed card open with the served experiment arm', async () => {
    await verifyOpenCommunityFeedPostInteraction(
      pact,
      createMobileClientForMockServer,
      'mobile'
    )
  })

  it('resolves one visible community post directly', async () => {
    await verifyCommunityPostInteraction(pact, createMobileClientForMockServer, 'mobile')
  })

  it('rejects a community post the caller cannot see', async () => {
    await verifyCommunityPostNotFoundInteraction(pact, 'mobile')
  })

  it('reads an opted-in feed whose item carries a sponsorship block', async () => {
    await verifyCommunitySponsoredFeedInteraction(pact, mobileSponsoredReads, 'mobile')
  })

  it('reads an opted-in city spotlight whose item carries a sponsorship block', async () => {
    await verifyCommunitySponsoredSpotlightInteraction(
      pact,
      mobileSponsoredReads,
      'mobile'
    )
  })

  it('reads an opted-in home teaser whose item carries a sponsorship block', async () => {
    await verifyCommunitySponsoredHomeTeaserInteraction(
      pact,
      mobileSponsoredReads,
      'mobile'
    )
  })

  it('reads one opted-in sponsored post with its sponsorship block', async () => {
    await verifyCommunitySponsoredPostInteraction(pact, mobileSponsoredReads, 'mobile')
  })

  it('allocates a community post upload session', async () => {
    await verifyAllocateCommunityPostInteraction(
      pact,
      createMobileClientForMockServer,
      'mobile'
    )
  })

  it('replays a community upload allocation with the same payload', async () => {
    await verifyAllocateCommunityPostReplayInteraction(
      pact,
      createMobileClientForMockServer,
      'mobile'
    )
  })

  it('rejects a community upload allocation replayed with a different payload', async () => {
    await verifyAllocateCommunityPostMismatchInteraction(pact, 'mobile')
  })

  it('publishes a community post into moderation', async () => {
    await verifyPublishCommunityPostInteraction(
      pact,
      createMobileClientForMockServer,
      'mobile'
    )
  })

  it('rejects a community publish whose upload session does not match the post', async () => {
    await verifyPublishCommunityPostConflictInteraction(pact, 'mobile')
  })

  it.each(communityRateLimitInteractions)(
    'preserves the documented community rate-limit envelope that $description',
    async (interaction) => {
      await verifyCommunityRateLimitInteraction(pact, interaction, 'mobile')
    }
  )

  it('reports a visible community post', async () => {
    await verifyReportCommunityPostInteraction(
      pact,
      createMobileClientForMockServer,
      'mobile'
    )
  })

  it.each(communityReportRejections)(
    'preserves the documented community report rejection envelope that $description',
    async (rejection) => {
      await verifyReportCommunityPostRejectionInteraction(pact, rejection, 'mobile')
    }
  )

  it('refuses a community report that exceeds the reporting abuse limit', async () => {
    await verifyReportCommunityPostRateLimitInteraction(pact, 'mobile')
  })

  it('creates a Monday-anchored community challenge as an administrator', async () => {
    await verifyCreateCommunityChallengeInteraction(
      pact,
      createMobileAdminClientForMockServer
    )
  })

  it.each(communityChallengeRejections)(
    'preserves the documented community challenge rejection envelope that $description',
    async (rejection) => {
      await verifyCreateCommunityChallengeRejectionInteraction(pact, rejection)
    }
  )

  // Story 1.2b: client location capture.
  it('searches cities for a location', async () => {
    await verifyLocationSearchInteraction(pact, createMobileClientForMockServer, 'mobile')
  })

  it.each(locationSearchErrorInteractions)(
    'preserves the typed city search error envelope $description',
    async (interaction) => {
      await verifyLocationSearchErrorInteraction(pact, interaction, 'mobile')
    }
  )

  it('carries Retry-After when city search is rate limited', async () => {
    await verifyLocationSearchRateLimitedInteraction(pact, 'mobile')
  })

  it('saves a searched city as a location', async () => {
    await verifyLocationSaveFromSearchInteraction(
      pact,
      createMobileClientForMockServer,
      'mobile'
    )
  })

  it.each(locationSaveErrorInteractions)(
    'preserves the save-from-search error envelope that $description',
    async (interaction) => {
      await verifyLocationSaveErrorInteraction(pact, interaction, 'mobile')
    }
  )

  it('lists saved locations', async () => {
    await verifyLocationListInteraction(pact, createMobileClientForMockServer)
  })

  it('renames a saved location', async () => {
    await verifyLocationRenameInteraction(pact, createMobileClientForMockServer)
  })

  it('switches the primary saved location', async () => {
    await verifyLocationSetPrimaryInteraction(pact, createMobileClientForMockServer)
  })

  it('refuses to make a foreign location primary', async () => {
    await verifyLocationSetPrimaryForeignInteraction(pact)
  })

  it('deletes a saved location', async () => {
    await verifyLocationDeleteInteraction(pact, createMobileClientForMockServer)
  })

  it('refuses to delete a foreign location', async () => {
    await verifyLocationDeleteForeignInteraction(pact)
  })
  it.each(shareCardInteractions)('prepares $kind $purpose for $id', async (scenario) => {
    await verifyShareCardInteraction(pact, createMobileClientForMockServer, scenario)
  })
})
