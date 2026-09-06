import type { VerifierOptions } from '@pact-foundation/pact'
import type {
  EntitlementStore,
  PremiumThemeKey,
  SilhouettePhotoFailureReason,
} from '@couture/api-client/contracts/http'
import {
  configureProviderEvent,
  configureProviderWardrobeState,
  configureProviderCapsuleState,
  configureProviderCommerceState,
  configureProviderOnboardingState,
  configureProviderSilhouetteState,
  configureProviderSubscriptionState,
  configureProviderPremiumThemeState,
  configureProviderPaletteAdvisorState,
  configureProviderPlannerState,
  configureProviderCommunityState,
  parsePactEvent,
  type PactEvent,
} from './provider-helper'

type StateHandlers = NonNullable<VerifierOptions['stateHandlers']>

export type WarningAlertStateParams = {
  since: string
  event: PactEvent | string
}

type GarmentStateParams = {
  garmentId: string
  userId: string
}

type OnboardingStateParams = {
  userId: string
}

type SilhouetteStateParams = {
  userId: string
}

type SilhouetteFailureStateParams = {
  userId: string
  reason: SilhouettePhotoFailureReason
}

type CommerceStateParams = {
  userId?: string
}

type SubscriptionStateParams = {
  userId?: string
  /**
   * Factory override for the entitled state: which rail the subscription was
   * bought on. 'app_store' arranges the portal-404 case (a paying store
   * subscriber with no Stripe billing profile); omitted, it defaults to
   * 'stripe' in the configurator.
   */
  store?: EntitlementStore
}

type PaletteAdvisorStateParams = {
  userId?: string
}

type PlannerStateParams = {
  userId?: string
  planDate?: string
}

type CommunityStateParams = {
  userId?: string
  postId?: string
}

type PremiumThemeStateParams = {
  userId?: string
  /**
   * Factory override for 'The user has premium theme access': the stored
   * palette to resolve. Omitted models the no-row/Default case; the entitled
   * read-with-a-stored-palette interaction passes a named key explicitly.
   */
  theme?: PremiumThemeKey
}

export const stateHandlers: StateHandlers = {
  /* ----------------------------------------------------------------------- *
   * Story 4.3 outfit capsules.
   * Deterministic states: the provider is configured to present a known
   * capsule graph, not to exercise authorization or concurrency logic, which
   * lives in the API and PostgreSQL integration suites.
   * ----------------------------------------------------------------------- */
  'Two ready and active garments exist for owner': (parameters?: unknown) => {
    const { userId } = (parameters ?? {}) as { userId?: string }
    configureProviderCapsuleState({ ownerUserId: userId, scenario: 'eligible-garments' })
    return Promise.resolve({ description: 'Configured two eligible garments' })
  },
  'Capsules exist for owner': (parameters?: unknown) => {
    const { userId } = (parameters ?? {}) as { userId?: string }
    configureProviderCapsuleState({ ownerUserId: userId, scenario: 'capsule-list' })
    return Promise.resolve({ description: 'Configured owner capsule list' })
  },
  'A capsule exists for owner': (parameters?: unknown) => {
    const { userId, capsuleId } = (parameters ?? {}) as {
      userId?: string
      capsuleId?: string
    }
    configureProviderCapsuleState({
      ownerUserId: userId,
      capsuleId,
      scenario: 'capsule-detail',
    })
    return Promise.resolve({
      description: `Configured capsule ${capsuleId ?? 'default'}`,
    })
  },
  'A capsule exists for owner at a newer revision': (parameters?: unknown) => {
    const { userId, capsuleId } = (parameters ?? {}) as {
      userId?: string
      capsuleId?: string
    }
    configureProviderCapsuleState({
      ownerUserId: userId,
      capsuleId,
      scenario: 'stale-precondition',
    })
    return Promise.resolve({ description: 'Configured capsule ahead of client revision' })
  },
  'A capsule already exists for the idempotency key': (parameters?: unknown) => {
    const { userId, capsuleId } = (parameters ?? {}) as {
      userId?: string
      capsuleId?: string
    }
    configureProviderCapsuleState({
      ownerUserId: userId,
      capsuleId,
      scenario: 'idempotency-replay',
    })
    return Promise.resolve({ description: 'Configured existing idempotency key' })
  },
  'A garment pending deletion exists for owner': (parameters?: unknown) => {
    const { userId } = (parameters ?? {}) as { userId?: string }
    configureProviderCapsuleState({ ownerUserId: userId, scenario: 'ineligible-garment' })
    return Promise.resolve({ description: 'Configured a deletion-pending garment' })
  },
  'The actor has no relationship with the owner': (parameters?: unknown) => {
    const { userId } = (parameters ?? {}) as { userId?: string }
    configureProviderCapsuleState({ ownerUserId: userId, scenario: 'unauthorized-owner' })
    return Promise.resolve({ description: 'Configured masked 404 relationship' })
  },
  '': () => Promise.resolve({ description: 'No provider state required' }),
  'A warning alert event exists after the polling cursor': (parameters?: unknown) => {
    const { event } = parameters as WarningAlertStateParams
    const parsedEvent = parsePactEvent(event)
    configureProviderEvent(parsedEvent)
    return Promise.resolve({ description: `Configured event ${parsedEvent.id}` })
  },
  'Daily scenario outfit recommendations exist for user': () => {
    return Promise.resolve({ description: 'Configured mock outfit recommendations' })
  },
  'Comfort preferences exist for user': () => {
    return Promise.resolve({ description: 'Configured mock comfort preferences' })
  },
  'A garment in awaiting_tags status with tag suggestions exists for user': (
    parameters?: unknown
  ) => {
    const { garmentId, userId } = parameters as GarmentStateParams
    configureProviderWardrobeState({ garmentId, userId, outcome: 'success' })
    return Promise.resolve({
      description: 'Configured garment awaiting tags with suggestions',
    })
  },
  'A garment in awaiting_tags status exists for user': (parameters?: unknown) => {
    const { garmentId, userId } = parameters as GarmentStateParams
    configureProviderWardrobeState({ garmentId, userId, outcome: 'success' })
    return Promise.resolve({ description: 'Configured garment awaiting tags' })
  },
  'Garment analysis is pending for user': (parameters?: unknown) => {
    const { garmentId, userId } = parameters as GarmentStateParams
    configureProviderWardrobeState({
      garmentId,
      userId,
      outcome: 'analysis_pending',
    })
    return Promise.resolve({ description: 'Configured pending garment analysis' })
  },
  'Garment tagging inference is unavailable for user': (parameters?: unknown) => {
    const { garmentId, userId } = parameters as GarmentStateParams
    configureProviderWardrobeState({
      garmentId,
      userId,
      outcome: 'inference_unavailable',
    })
    return Promise.resolve({ description: 'Configured unavailable tag inference' })
  },
  'Garment does not exist for user': (parameters?: unknown) => {
    const { garmentId, userId } = parameters as GarmentStateParams
    configureProviderWardrobeState({ garmentId, userId, outcome: 'not_found' })
    return Promise.resolve({ description: 'Configured missing garment' })
  },
  'Wardrobe tagging is forbidden for user': (parameters?: unknown) => {
    const { garmentId, userId } = parameters as GarmentStateParams
    configureProviderWardrobeState({
      garmentId,
      userId,
      outcome: 'success',
      guardianAllowed: false,
    })
    return Promise.resolve({ description: 'Configured forbidden wardrobe access' })
  },

  /* ----------------------------------------------------------------------- *
   * Story 4.4 wardrobe onboarding and silhouette setup.
   *
   * These configure a named, deterministic scenario before each interaction,
   * following the exact pattern above. The state is consumed by the real
   * `mockWardrobeOnboardingService`/`mockWardrobeSilhouetteService` doubles
   * in provider-helper.ts, wired against the real
   * `WardrobeOnboardingController`/`WardrobeSilhouetteController` -- see
   * provider-helper.ts for the doubles' fidelity level. `test:pact:provider`
   * verifies every onboarding/silhouette interaction through this wiring.
   * ----------------------------------------------------------------------- */
  'Wardrobe onboarding state exists for user': (parameters?: unknown) => {
    const { userId } = parameters as OnboardingStateParams
    configureProviderOnboardingState({ userId, scenario: 'existing' })
    return Promise.resolve({ description: 'Configured existing onboarding state' })
  },
  'No wardrobe onboarding state exists for user': (parameters?: unknown) => {
    const { userId } = parameters as OnboardingStateParams
    configureProviderOnboardingState({ userId, scenario: 'not-started' })
    return Promise.resolve({ description: 'Configured absent onboarding state' })
  },
  'Wardrobe onboarding state exists for user at a newer revision': (
    parameters?: unknown
  ) => {
    const { userId } = parameters as OnboardingStateParams
    configureProviderOnboardingState({ userId, scenario: 'stale-precondition' })
    return Promise.resolve({
      description: 'Configured onboarding state ahead of client revision',
    })
  },
  'Silhouette profile exists for user': (parameters?: unknown) => {
    const { userId } = parameters as SilhouetteStateParams
    configureProviderSilhouetteState({ userId, scenario: 'profile-exists' })
    return Promise.resolve({ description: 'Configured existing silhouette profile' })
  },
  'Guardian consent is not active for teen silhouette access': (parameters?: unknown) => {
    const { userId } = parameters as SilhouetteStateParams
    configureProviderSilhouetteState({ userId, scenario: 'guardian-forbidden' })
    return Promise.resolve({
      description: 'Configured consent-revoked teen silhouette access',
    })
  },
  'Silhouette profile exists for user at a newer revision': (parameters?: unknown) => {
    const { userId } = parameters as SilhouetteStateParams
    configureProviderSilhouetteState({ userId, scenario: 'stale-precondition' })
    return Promise.resolve({
      description: 'Configured silhouette profile ahead of client revision',
    })
  },
  'My Form photo bytes are uploaded and awaiting commit for user': (
    parameters?: unknown
  ) => {
    const { userId } = parameters as SilhouetteStateParams
    configureProviderSilhouetteState({ userId, scenario: 'my-form-awaiting-commit' })
    return Promise.resolve({ description: 'Configured My Form bytes awaiting commit' })
  },
  'A My Form photo is ready for user': (parameters?: unknown) => {
    const { userId } = parameters as SilhouetteStateParams
    configureProviderSilhouetteState({ userId, scenario: 'my-form-ready' })
    return Promise.resolve({ description: 'Configured a ready My Form photo' })
  },
  'A My Form photo failed for user': (parameters?: unknown) => {
    const { userId, reason } = parameters as SilhouetteFailureStateParams
    configureProviderSilhouetteState({
      userId,
      scenario: 'my-form-failed',
      failureReason: reason,
    })
    return Promise.resolve({
      description: `Configured a My Form photo that failed with ${reason}`,
    })
  },
  'A My Form photo failed privacy_violation for a teen and queued a guardian notification':
    (parameters?: unknown) => {
      const { userId } = parameters as SilhouetteStateParams
      configureProviderSilhouetteState({
        userId,
        scenario: 'my-form-privacy-violation-teen-notified',
        failureReason: 'privacy_violation',
      })
      return Promise.resolve({
        description:
          'Configured a privacy_violation My Form photo for a teen with guardian notification queued',
      })
    },
  'A My Form photo exists for user': (parameters?: unknown) => {
    const { userId } = parameters as SilhouetteStateParams
    configureProviderSilhouetteState({ userId, scenario: 'my-form-exists' })
    return Promise.resolve({ description: 'Configured an existing My Form photo' })
  },
  'A My Form upload session was already allocated for user': (parameters?: unknown) => {
    const { userId } = parameters as SilhouetteStateParams
    configureProviderSilhouetteState({
      userId,
      scenario: 'my-form-upload-already-allocated',
    })
    return Promise.resolve({
      description: 'Configured an already-allocated My Form upload session',
    })
  },
  'A My Form photo commit was already processed for user': (parameters?: unknown) => {
    const { userId } = parameters as SilhouetteStateParams
    configureProviderSilhouetteState({
      userId,
      scenario: 'my-form-commit-already-processed',
    })
    return Promise.resolve({
      description: 'Configured an already-processed My Form commit',
    })
  },

  /* ----------------------------------------------------------------------- *
   * Story 5.1 affiliate commerce.
   *
   * Each state names an OUTCOME the contract has to record, not the rule that
   * produces it. "Affiliate commerce is disabled" configures a provider that
   * answers 503; whether the `commerce_affiliate_enabled` flag resolving false
   * is what gets it there is proven in the API suite, where a flag actually
   * exists to resolve.
   * ----------------------------------------------------------------------- */
  'An eligible affiliate offer matches the outfit for user': (parameters?: unknown) => {
    const { userId } = (parameters ?? {}) as CommerceStateParams
    configureProviderCommerceState({ userId, scenario: 'eligible' })
    return Promise.resolve({ description: 'Configured an eligible affiliate offer' })
  },
  'The user has opted out of affiliate suggestions': (parameters?: unknown) => {
    const { userId } = (parameters ?? {}) as CommerceStateParams
    configureProviderCommerceState({ userId, scenario: 'opted-out' })
    return Promise.resolve({ description: 'Configured an opted-out user' })
  },
  'The user is outside the affiliate audience': (parameters?: unknown) => {
    const { userId } = (parameters ?? {}) as CommerceStateParams
    configureProviderCommerceState({ userId, scenario: 'audience-ineligible' })
    return Promise.resolve({ description: 'Configured an audience-ineligible user' })
  },
  'Affiliate commerce is disabled': (parameters?: unknown) => {
    const { userId } = (parameters ?? {}) as CommerceStateParams
    configureProviderCommerceState({ userId, scenario: 'flag-disabled' })
    return Promise.resolve({ description: 'Configured the commerce kill switch as off' })
  },
  'The affiliate offer is unknown, inactive, or out of window': (
    parameters?: unknown
  ) => {
    const { userId } = (parameters ?? {}) as CommerceStateParams
    configureProviderCommerceState({ userId, scenario: 'unknown-offer' })
    return Promise.resolve({ description: 'Configured an unresolvable affiliate offer' })
  },
  'An affiliate click already exists inside the dedupe window': (
    parameters?: unknown
  ) => {
    const { userId } = (parameters ?? {}) as CommerceStateParams
    configureProviderCommerceState({ userId, scenario: 'click-deduped' })
    return Promise.resolve({ description: 'Configured a deduped affiliate click' })
  },
  'The affiliate webhook signature is invalid': () => {
    configureProviderCommerceState({ scenario: 'invalid-signature' })
    return Promise.resolve({ description: 'Configured a failing webhook signature' })
  },

  /* ----------------------------------------------------------------------- *
   * Story 5.2 premium subscription lifecycle.
   *
   * Each state names an arrangement the contract records an outcome for, not
   * the rule that produces it. 'Premium subscriptions are disabled'
   * configures a provider that answers 503 on checkout; whether the
   * commerce_subscription_enabled flag resolving false is what gets it there
   * is proven in the API suite, where a flag actually exists to resolve.
   * ----------------------------------------------------------------------- */
  'The user has an active premium entitlement': (parameters?: unknown) => {
    const { userId, store } = (parameters ?? {}) as SubscriptionStateParams
    configureProviderSubscriptionState({ userId, scenario: 'entitled', store })
    return Promise.resolve({
      description: `Configured an active premium entitlement via ${store ?? 'stripe'}`,
    })
  },
  'The user has no premium entitlement': (parameters?: unknown) => {
    const { userId } = (parameters ?? {}) as SubscriptionStateParams
    configureProviderSubscriptionState({ userId, scenario: 'never-subscribed' })
    return Promise.resolve({ description: 'Configured a never-subscribed user' })
  },
  'Premium subscriptions are disabled': (parameters?: unknown) => {
    const { userId } = (parameters ?? {}) as SubscriptionStateParams
    configureProviderSubscriptionState({ userId, scenario: 'purchasing-disabled' })
    return Promise.resolve({
      description: 'Configured the subscription kill switch as off',
    })
  },
  'The user has a Stripe billing profile': (parameters?: unknown) => {
    const { userId } = (parameters ?? {}) as SubscriptionStateParams
    configureProviderSubscriptionState({
      userId,
      scenario: 'stripe-billing-profile',
      store: 'stripe',
    })
    return Promise.resolve({ description: 'Configured a Stripe billing profile' })
  },

  /* ----------------------------------------------------------------------- *
   * Story 5.3 premium theme switcher.
   *
   * Each state names an arrangement the contract records an outcome for, not
   * the rule that produces it -- same stance as the 5.2 subscription states
   * above. This is also the first Pact provider wiring of
   * `PremiumEntitlementGuard` (5.2's `SubscriptionController` never mounted
   * it): 'The user does not have premium theme access' configures
   * `PremiumEntitlementService.hasPremiumAccess` to resolve false, and the
   * real, un-mocked guard is what turns that into the 403 the PUT error
   * interaction records. `PremiumThemeService` itself stays a scenario-driven
   * double for both operations, exactly like `mockSubscriptionService` above.
   * ----------------------------------------------------------------------- */
  'The user has premium theme access': (parameters?: unknown) => {
    const { userId, theme } = (parameters ?? {}) as PremiumThemeStateParams
    configureProviderPremiumThemeState({ userId, scenario: 'entitled', theme })
    return Promise.resolve({
      description: `Configured premium theme access with stored theme ${theme ?? 'null (Default)'}`,
    })
  },
  'The user does not have premium theme access': (parameters?: unknown) => {
    const { userId } = (parameters ?? {}) as PremiumThemeStateParams
    configureProviderPremiumThemeState({ userId, scenario: 'not-entitled' })
    return Promise.resolve({ description: 'Configured a non-entitled user' })
  },
  'Premium themes are disabled': (parameters?: unknown) => {
    const { userId } = (parameters ?? {}) as PremiumThemeStateParams
    configureProviderPremiumThemeState({ userId, scenario: 'themes-disabled' })
    return Promise.resolve({
      description: 'Configured the premium themes kill switch as off',
    })
  },
  /* ----------------------------------------------------------------------- *
   * Story 5.4 palette advisor.
   *
   * Four states, each naming an arrangement the contract records an outcome
   * for. The two 403 states are the pair that matters most:
   * `PremiumEntitlementGuard` stays real and un-mocked, so 'The user does not
   * have palette advisor access' produces `PREMIUM_REQUIRED_MESSAGE`
   * pre-handler, while 'The user has not granted palette analysis consent'
   * produces `PALETTE_CONSENT_REQUIRED_MESSAGE` from the service body. Both
   * are 403, and a client cannot tell them apart from the status alone --
   * which is exactly why both clients classify on the message and why both
   * have to be pinned here.
   * ----------------------------------------------------------------------- */
  'The user has palette advisor access': (parameters?: unknown) => {
    const { userId } = (parameters ?? {}) as PaletteAdvisorStateParams
    configureProviderPaletteAdvisorState({ userId, scenario: 'entitled-consented' })
    return Promise.resolve({
      description: 'Configured an entitled, consented user with a ready palette',
    })
  },
  'The user has not granted palette analysis consent': (parameters?: unknown) => {
    const { userId } = (parameters ?? {}) as PaletteAdvisorStateParams
    configureProviderPaletteAdvisorState({ userId, scenario: 'entitled-no-consent' })
    return Promise.resolve({
      description: 'Configured an entitled user who has not granted consent',
    })
  },
  'The user does not have palette advisor access': (parameters?: unknown) => {
    const { userId } = (parameters ?? {}) as PaletteAdvisorStateParams
    configureProviderPaletteAdvisorState({ userId, scenario: 'not-entitled' })
    return Promise.resolve({ description: 'Configured a non-entitled user' })
  },
  'Palette color analysis is disabled': (parameters?: unknown) => {
    const { userId } = (parameters ?? {}) as PaletteAdvisorStateParams
    configureProviderPaletteAdvisorState({ userId, scenario: 'analysis-disabled' })
    return Promise.resolve({
      description: 'Configured the color analysis kill switch as off',
    })
  },

  /* ----------------------------------------------------------------------- *
   * Story 5.5 premium 7-day outfit planner.
   *
   * Each state names an arrangement the contract records an outcome for, not
   * the rule that produces it -- same stance as every scenario-driven state
   * above. 'The user does not have premium planner access' drives the real,
   * un-mocked `PremiumEntitlementGuard`; 'The premium planner is disabled'
   * reproduces `PlannerService.assertPlannerEnabled`'s flag check, which runs
   * first in both GET and reshuffle.
   * ----------------------------------------------------------------------- */
  'A ready seven-day planner exists for user': (parameters?: unknown) => {
    const { userId } = (parameters ?? {}) as PlannerStateParams
    configureProviderPlannerState({ userId, scenario: 'ready-week' })
    return Promise.resolve({ description: 'Configured a fully ready seven-day planner' })
  },
  'A seven-day planner with one failed day exists for user': (parameters?: unknown) => {
    const { userId } = (parameters ?? {}) as PlannerStateParams
    configureProviderPlannerState({ userId, scenario: 'partial-week' })
    return Promise.resolve({
      description: 'Configured a seven-day planner with one isolated day failure',
    })
  },
  'The user does not have premium planner access': (parameters?: unknown) => {
    const { userId } = (parameters ?? {}) as PlannerStateParams
    configureProviderPlannerState({ userId, scenario: 'not-entitled' })
    return Promise.resolve({ description: 'Configured a non-entitled user' })
  },
  'The premium planner is disabled': (parameters?: unknown) => {
    const { userId } = (parameters ?? {}) as PlannerStateParams
    configureProviderPlannerState({ userId, scenario: 'disabled' })
    return Promise.resolve({
      description: 'Configured the premium planner kill switch as off',
    })
  },
  'A reshuffleable planner day exists for user': (parameters?: unknown) => {
    const { userId, planDate } = (parameters ?? {}) as PlannerStateParams
    configureProviderPlannerState({ userId, planDate, scenario: 'reshuffle-success' })
    return Promise.resolve({
      description: `Configured a reshuffleable planner day ${planDate ?? 'default'}`,
    })
  },
  'A reshuffle with no disjoint result exists for user': (parameters?: unknown) => {
    const { userId, planDate } = (parameters ?? {}) as PlannerStateParams
    configureProviderPlannerState({ userId, planDate, scenario: 'reshuffle-unchanged' })
    return Promise.resolve({
      description: 'Configured a reshuffle with no disjoint result available',
    })
  },
  'A planner day changed since the client last viewed it': (parameters?: unknown) => {
    const { userId, planDate } = (parameters ?? {}) as PlannerStateParams
    configureProviderPlannerState({ userId, planDate, scenario: 'reshuffle-conflict' })
    return Promise.resolve({
      description: 'Configured a planner day at a stale version',
    })
  },

  'The premium theme owner account no longer exists': (parameters?: unknown) => {
    const { userId } = (parameters ?? {}) as PremiumThemeStateParams
    // Entitled, so the guard lets the request reach the handler -- this state
    // is about the window between that check and the write, where account
    // erasure leaves the upsert with no User row to reference.
    configureProviderPremiumThemeState({ userId, scenario: 'owner-erased' })
    return Promise.resolve({
      description: 'Configured an entitled user whose account is erased mid-request',
    })
  },

  /**
   * Story 6.1 community feed by climate band.
   *
   * Two of these states do not select a service behaviour at all, and that is
   * deliberate rather than an omission. 'The community feed is readable' backs
   * three consumer rows: an unknown `mode` and both cursor rejections. Only the
   * cursor rows reach `CommunityService`; an unknown `mode` fails
   * `communityFeedQuerySchema` inside the controller first, so the scenario it
   * arranges is never consulted. 'An administrator may create a community
   * challenge' has the same shape: the invalid-window row is rejected by
   * `createCommunityChallengeInputSchema`'s `superRefine` before the service
   * runs, while the valid row goes all the way through.
   *
   * 'A community upload session already exists for the idempotency key' backs
   * BOTH the 200 replay and the 409 mismatch, on purpose. They share one world
   * state and differ only in the payload presented against the key, which is
   * exactly what idempotency means; the double compares the incoming bytes
   * rather than being told the answer by two different states.
   */
  'A resolved climate band feed page exists for user': (parameters?: unknown) => {
    const { userId } = (parameters ?? {}) as CommunityStateParams
    configureProviderCommunityState({ userId, scenario: 'feed-resolved' })
    return Promise.resolve({
      description: 'Configured a feed page with a resolved viewer band',
    })
  },

  'The viewer climate band cannot be resolved': (parameters?: unknown) => {
    const { userId } = (parameters ?? {}) as CommunityStateParams
    configureProviderCommunityState({ userId, scenario: 'feed-band-unresolved' })
    return Promise.resolve({
      description: 'Configured an all-region feed with an unresolved viewer band',
    })
  },

  'The author has withdrawn and consent-suspended posts': (parameters?: unknown) => {
    const { userId } = (parameters ?? {}) as CommunityStateParams
    configureProviderCommunityState({ userId, scenario: 'feed-removed-content' })
    return Promise.resolve({
      description: 'Configured removed author content with no readable image',
    })
  },

  'The community feed is readable': (parameters?: unknown) => {
    const { userId } = (parameters ?? {}) as CommunityStateParams
    configureProviderCommunityState({ userId, scenario: 'feed-cursor-invalid' })
    return Promise.resolve({
      description: 'Configured a readable feed that rejects the presented cursor',
    })
  },

  'A published community post is visible to the caller': (parameters?: unknown) => {
    const { userId, postId } = (parameters ?? {}) as CommunityStateParams
    configureProviderCommunityState({ userId, postId, scenario: 'post-visible' })
    return Promise.resolve({
      description: `Configured a visible community post ${postId ?? 'default'}`,
    })
  },

  'The requested community post is not visible to the caller': (parameters?: unknown) => {
    const { userId, postId } = (parameters ?? {}) as CommunityStateParams
    configureProviderCommunityState({ userId, postId, scenario: 'post-not-found' })
    return Promise.resolve({
      description: 'Configured a community post the caller cannot see',
    })
  },

  'The caller may allocate a community upload session': (parameters?: unknown) => {
    const { userId } = (parameters ?? {}) as CommunityStateParams
    configureProviderCommunityState({ userId, scenario: 'allocate-new' })
    return Promise.resolve({
      description: 'Configured a caller who may allocate an upload session',
    })
  },

  'A community upload session already exists for the idempotency key': (
    parameters?: unknown
  ) => {
    const { userId, postId } = (parameters ?? {}) as CommunityStateParams
    configureProviderCommunityState({ userId, postId, scenario: 'allocate-replay' })
    return Promise.resolve({
      description: 'Configured an allocation already recorded against the key',
    })
  },

  'A completed community upload is ready to publish': (parameters?: unknown) => {
    const { userId, postId } = (parameters ?? {}) as CommunityStateParams
    configureProviderCommunityState({ userId, postId, scenario: 'publish-accepted' })
    return Promise.resolve({
      description: 'Configured an uploaded post ready for moderation',
    })
  },

  'The publish upload session does not match the post': (parameters?: unknown) => {
    const { userId, postId } = (parameters ?? {}) as CommunityStateParams
    configureProviderCommunityState({
      userId,
      postId,
      scenario: 'publish-session-mismatch',
    })
    return Promise.resolve({
      description: 'Configured a publish whose upload session belongs elsewhere',
    })
  },

  'The caller has reached the daily community post limit': (parameters?: unknown) => {
    const { userId } = (parameters ?? {}) as CommunityStateParams
    configureProviderCommunityState({ userId, scenario: 'post-rate-limited' })
    return Promise.resolve({
      description: 'Configured ten accepted submissions in the rolling 24-hour window',
    })
  },

  'A visible community post can be reported by the caller': (parameters?: unknown) => {
    const { userId, postId } = (parameters ?? {}) as CommunityStateParams
    configureProviderCommunityState({ userId, postId, scenario: 'report-accepted' })
    return Promise.resolve({
      description: `Configured a reportable community post ${postId ?? 'default'}`,
    })
  },

  'The reported community post is not visible to the caller': (parameters?: unknown) => {
    const { userId, postId } = (parameters ?? {}) as CommunityStateParams
    configureProviderCommunityState({ userId, postId, scenario: 'report-not-found' })
    return Promise.resolve({
      description: 'Configured a report against a post the caller cannot see',
    })
  },

  'The caller already reported this community post for another reason': (
    parameters?: unknown
  ) => {
    const { userId, postId } = (parameters ?? {}) as CommunityStateParams
    configureProviderCommunityState({
      userId,
      postId,
      scenario: 'report-reason-changed',
    })
    return Promise.resolve({
      description: 'Configured an existing report carrying a different reason',
    })
  },

  'The reported community post belongs to the caller': (parameters?: unknown) => {
    const { userId, postId } = (parameters ?? {}) as CommunityStateParams
    configureProviderCommunityState({ userId, postId, scenario: 'report-self' })
    return Promise.resolve({
      description: 'Configured a post authored by the reporting caller',
    })
  },

  'The caller has reached the community reporting abuse limit': (
    parameters?: unknown
  ) => {
    const { userId, postId } = (parameters ?? {}) as CommunityStateParams
    configureProviderCommunityState({ userId, postId, scenario: 'report-rate-limited' })
    return Promise.resolve({
      description: 'Configured a caller past the reporting abuse budget',
    })
  },

  'An administrator may create a community challenge': (parameters?: unknown) => {
    const { userId } = (parameters ?? {}) as CommunityStateParams
    configureProviderCommunityState({ userId, scenario: 'challenge-created' })
    return Promise.resolve({
      description: 'Configured an administrator with no conflicting challenge',
    })
  },

  'An active community challenge already covers this band and window': (
    parameters?: unknown
  ) => {
    const { userId } = (parameters ?? {}) as CommunityStateParams
    configureProviderCommunityState({ userId, scenario: 'challenge-overlap' })
    return Promise.resolve({
      description: 'Configured an overlapping active challenge in the same band',
    })
  },
}
