import type {
  EntitlementStore,
  PremiumThemeKey,
  SilhouetteMode,
  SilhouettePhotoFailureReason,
  SilhouettePhotoStatus,
} from '@couture/api-client/contracts/http'

/**
 * Per-domain provider scenario state.
 *
 * `state-handlers.ts` writes it from a Pact provider state and the modules in
 * `doubles/` read it. Its own module is what lets those doubles stop closing
 * over `startLocalPactProvider`'s locals: they import a getter instead, so the
 * coupling is one you can follow rather than one you have to be inside the
 * function to see. `provider-helper.ts` re-exports everything here, so existing
 * importers are unchanged.
 */

/**
 * The shape `WardrobeSilhouetteService` hands back, as the doubles model it.
 * It was declared inside `startLocalPactProvider`; it lives here because the
 * silhouette doubles annotate against it from their own module now.
 */
export type SilhouetteRow = {
  mode: SilhouetteMode
  heightSlider: number | null
  buildSlider: number | null
  myForm: {
    status: SilhouettePhotoStatus
    failureReason: SilhouettePhotoFailureReason | null
    committedAt: string | null
    imageAccess: { url: string; expiresAt: string } | null
  } | null
  revision: number
}

type ProviderWardrobeOutcome =
  | 'success'
  | 'analysis_pending'
  | 'inference_unavailable'
  | 'not_found'

type ProviderWardrobeState = {
  garmentId: string | null
  userId: string | null
  outcome: ProviderWardrobeOutcome
  guardianAllowed: boolean
}

let providerWardrobeState: ProviderWardrobeState = {
  garmentId: null,
  userId: null,
  outcome: 'not_found',
  guardianAllowed: true,
}

export function configureProviderWardrobeState(
  state: Partial<ProviderWardrobeState> & Pick<ProviderWardrobeState, 'outcome'>
) {
  providerWardrobeState = {
    garmentId: state.garmentId ?? null,
    userId: state.userId ?? null,
    outcome: state.outcome,
    guardianAllowed: state.guardianAllowed ?? true,
  }
}

export function getProviderWardrobeState(): ProviderWardrobeState {
  return providerWardrobeState
}

export function resetProviderWardrobeState() {
  providerWardrobeState = {
    garmentId: null,
    userId: null,
    outcome: 'not_found',
    guardianAllowed: true,
  }
}

/**
 * Story 4.3 capsule provider states.
 *
 * The verifier configures a named, deterministic scenario before each
 * interaction. Keeping the scenario as a discriminated string means a state the
 * provider does not know fails loudly rather than silently verifying against
 * whatever happened to be in memory.
 */
export type ProviderCapsuleScenario =
  | 'eligible-garments'
  | 'capsule-list'
  | 'capsule-detail'
  | 'stale-precondition'
  | 'idempotency-replay'
  | 'idempotency-conflict'
  | 'ineligible-garment'
  | 'unauthorized-owner'

export type ProviderCapsuleState = {
  ownerUserId: string | null
  capsuleId: string | null
  scenario: ProviderCapsuleScenario
}

let providerCapsuleState: ProviderCapsuleState | null = null

export function configureProviderCapsuleState(state: {
  ownerUserId?: string
  capsuleId?: string
  scenario: ProviderCapsuleScenario
}) {
  providerCapsuleState = {
    ownerUserId: state.ownerUserId ?? null,
    capsuleId: state.capsuleId ?? null,
    scenario: state.scenario,
  }
}

export function getProviderCapsuleState(): ProviderCapsuleState | null {
  return providerCapsuleState
}

export function resetProviderCapsuleState() {
  providerCapsuleState = null
}

/**
 * Story 4.4 wardrobe onboarding and silhouette setup — provider state
 * storage, mirroring the capsule state above exactly.
 *
 * `pact/http/provider/state-handlers.ts` configures a named, deterministic
 * scenario per interaction exactly like every other state handler here, and
 * that state is consumed by the real `mockWardrobeOnboardingService`/
 * `mockWardrobeSilhouetteService` doubles below (wired against the real
 * `WardrobeOnboardingController`/`WardrobeSilhouetteController` -- see the
 * doc comments on those doubles for their fidelity level). `npm run
 * test:pact:provider` verifies all onboarding/silhouette interactions
 * genuinely green through this wiring, not just the state-setup half.
 */
export type ProviderOnboardingScenario = 'existing' | 'not-started' | 'stale-precondition'

export type ProviderOnboardingState = {
  userId: string | null
  scenario: ProviderOnboardingScenario
}

let providerOnboardingState: ProviderOnboardingState | null = null

export function configureProviderOnboardingState(state: {
  userId?: string
  scenario: ProviderOnboardingScenario
}) {
  providerOnboardingState = {
    userId: state.userId ?? null,
    scenario: state.scenario,
  }
}

export function getProviderOnboardingState(): ProviderOnboardingState | null {
  return providerOnboardingState
}

export function resetProviderOnboardingState() {
  providerOnboardingState = null
}

export type ProviderSilhouetteScenario =
  | 'profile-exists'
  | 'guardian-forbidden'
  | 'stale-precondition'
  | 'my-form-awaiting-commit'
  | 'my-form-ready'
  | 'my-form-failed'
  | 'my-form-privacy-violation-teen-notified'
  | 'my-form-exists'
  | 'my-form-upload-already-allocated'
  | 'my-form-commit-already-processed'

export type ProviderSilhouetteState = {
  userId: string | null
  scenario: ProviderSilhouetteScenario
  /** Only set for the `my-form-failed` scenario, which the state handler parameterizes by reason. */
  failureReason: SilhouettePhotoFailureReason | null
}

let providerSilhouetteState: ProviderSilhouetteState | null = null

export function configureProviderSilhouetteState(state: {
  userId?: string
  scenario: ProviderSilhouetteScenario
  failureReason?: SilhouettePhotoFailureReason
}) {
  providerSilhouetteState = {
    userId: state.userId ?? null,
    scenario: state.scenario,
    failureReason: state.failureReason ?? null,
  }
}

export function getProviderSilhouetteState(): ProviderSilhouetteState | null {
  return providerSilhouetteState
}

export function resetProviderSilhouetteState() {
  providerSilhouetteState = null
}

/* --------------------------------------------------------------------------- *
 * Story 5.1 affiliate commerce provider states.
 *
 * The doubles below decide their answer from the scenario the verifier sets,
 * not from a real database, feature flag, or HMAC. That is deliberate and it is
 * what Pact is for here: the contract records which status, headers, and body a
 * client must understand. WHEN each status is produced, meaning the eligibility
 * chain, the 60-second dedupe window, and the five-step signature verification,
 * is proven in the API unit suite and against real PostgreSQL in
 * `apps/api/integration/commerce-affiliate-*.integration.spec.ts`. Reimplementing
 * those rules here would make this suite agree with itself rather than with the
 * provider.
 * --------------------------------------------------------------------------- */
export type ProviderCommerceScenario =
  | 'eligible'
  | 'opted-out'
  | 'audience-ineligible'
  | 'flag-disabled'
  | 'unknown-offer'
  | 'click-deduped'
  | 'invalid-signature'

export type ProviderCommerceState = {
  userId: string | null
  scenario: ProviderCommerceScenario
}

let providerCommerceState: ProviderCommerceState | null = null

export function configureProviderCommerceState(state: {
  userId?: string
  scenario: ProviderCommerceScenario
}) {
  providerCommerceState = {
    userId: state.userId ?? null,
    scenario: state.scenario,
  }
}

export function getProviderCommerceState(): ProviderCommerceState | null {
  return providerCommerceState
}

export function resetProviderCommerceState() {
  providerCommerceState = null
}

/* --------------------------------------------------------------------------- *
 * Story 5.2 premium subscription provider states.
 *
 * Same design as the 5.1 commerce states above: each scenario names an
 * arrangement the contract records an outcome for, and the doubles decide
 * their answer from it rather than from a real database, flag, or Stripe
 * call. The `store` field is the factory override the portal-404 arrangement
 * needs — 'The user has an active premium entitlement' with `store:
 * 'app_store'` is a paying store subscriber with no Stripe billing profile,
 * which is exactly who the portal must answer 404 to.
 * --------------------------------------------------------------------------- */
export type ProviderSubscriptionScenario =
  | 'entitled'
  | 'never-subscribed'
  | 'purchasing-disabled'
  | 'stripe-billing-profile'

export type ProviderSubscriptionState = {
  userId: string | null
  scenario: ProviderSubscriptionScenario
  store: EntitlementStore
}

let providerSubscriptionState: ProviderSubscriptionState | null = null

export function configureProviderSubscriptionState(state: {
  userId?: string
  scenario: ProviderSubscriptionScenario
  store?: EntitlementStore
}) {
  providerSubscriptionState = {
    userId: state.userId ?? null,
    scenario: state.scenario,
    // The web rail is the default; interactions pinning the store-managed
    // arrangement pass 'app_store' explicitly.
    store: state.store ?? 'stripe',
  }
}

export function getProviderSubscriptionState(): ProviderSubscriptionState | null {
  return providerSubscriptionState
}

export function resetProviderSubscriptionState() {
  providerSubscriptionState = null
}

/* --------------------------------------------------------------------------- *
 * Story 5.3 premium theme switcher provider states.
 *
 * Same design as the 5.2 subscription states above: each scenario names an
 * arrangement the contract records an outcome for, and the doubles above
 * decide their answer from it rather than from a real database, flag, or
 * `PremiumEntitlementService` call to production code -- except for the guard
 * itself, which is the one piece of production logic this fixture leaves
 * unmocked (see the `PremiumEntitlementGuard` provider registration above).
 * The `theme` field is the factory override the entitled-with-no-stored-row
 * (Default) read interaction needs: 'The user has premium theme access' with
 * no `theme` param models an absent/NULL row, and with `theme: 'jewel_radiance'`
 * (or any shipped key) models a stored preference. Both are Decision 8's two
 * spellings of Default when `theme` is omitted, and a real stored choice when
 * it isn't.
 * --------------------------------------------------------------------------- */
export type ProviderPremiumThemeScenario =
  | 'entitled'
  | 'not-entitled'
  | 'themes-disabled'
  | 'owner-erased'

export type ProviderPremiumThemeState = {
  userId: string | null
  scenario: ProviderPremiumThemeScenario
  theme: PremiumThemeKey | null
}

let providerPremiumThemeState: ProviderPremiumThemeState | null = null

export function configureProviderPremiumThemeState(state: {
  userId?: string
  scenario: ProviderPremiumThemeScenario
  theme?: PremiumThemeKey
}) {
  providerPremiumThemeState = {
    userId: state.userId ?? null,
    scenario: state.scenario,
    theme: state.theme ?? null,
  }
}

export function getProviderPremiumThemeState(): ProviderPremiumThemeState | null {
  return providerPremiumThemeState
}

export function resetProviderPremiumThemeState() {
  providerPremiumThemeState = null
}
