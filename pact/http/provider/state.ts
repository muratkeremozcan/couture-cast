import type {
  EntitlementStore,
  PremiumThemeKey,
  SilhouetteMode,
  SilhouettePhotoFailureReason,
  SilhouettePhotoStatus,
} from '@couture/api-client/contracts/http'
import { encodeLocationCandidate } from '../../../apps/api/src/modules/location-preferences/location-candidate-token.js'
import { buildSearchLocationKey } from '../../../apps/api/src/modules/location-preferences/location-key.js'
import type {
  LocationSearchWindowCount,
  SavedLocationRecord,
} from '../../../apps/api/src/modules/location-preferences/location-preferences.repository.js'
import type { GeocodedPlace } from '../../../apps/api/src/modules/weather/providers/location-geocoding.js'
import type {
  NormalizedWeatherForecast,
  WeatherIngestionTarget,
} from '../../../apps/api/src/modules/weather/providers/weather.types.js'

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

/* --------------------------------------------------------------------------- *
 * Story 5.4 palette advisor.
 *
 * Four arrangements, and the same stance the 5.2/5.3 states take: each names an
 * arrangement the contract records an outcome for, not the rule that produces
 * it. `entitled-consented` is the only one that answers a ready palette with
 * recommendations; `entitled-no-consent` is what makes the two-403 split
 * observable on the wire, since it is the ONLY way a client sees
 * `PALETTE_CONSENT_REQUIRED_MESSAGE` rather than `PREMIUM_REQUIRED_MESSAGE`;
 * `not-entitled` drives the real, un-mocked `PremiumEntitlementGuard`; and
 * `analysis-disabled` is the kill switch an entitled, consented caller is the
 * only one who can ever observe (Decision 10's precedence).
 * --------------------------------------------------------------------------- */
export type ProviderPaletteAdvisorScenario =
  | 'entitled-consented'
  | 'entitled-no-consent'
  | 'not-entitled'
  | 'analysis-disabled'

export type ProviderPaletteAdvisorState = {
  userId: string | null
  scenario: ProviderPaletteAdvisorScenario
}

let providerPaletteAdvisorState: ProviderPaletteAdvisorState | null = null

export function configureProviderPaletteAdvisorState(state: {
  userId?: string
  scenario: ProviderPaletteAdvisorScenario
}) {
  providerPaletteAdvisorState = {
    userId: state.userId ?? null,
    scenario: state.scenario,
  }
}

export function getProviderPaletteAdvisorState(): ProviderPaletteAdvisorState | null {
  return providerPaletteAdvisorState
}

export function resetProviderPaletteAdvisorState() {
  providerPaletteAdvisorState = null
}

/* --------------------------------------------------------------------------- *
 * Story 5.5 premium 7-day outfit planner.
 *
 * Same design as the 5.4 palette advisor states above: each scenario names an
 * arrangement the contract records an outcome for, not the rule that produces
 * it. `not-entitled` drives the real, un-mocked `PremiumEntitlementGuard`
 * (through the shared `PremiumEntitlementService` double in
 * doubles/premium-entitlement.ts, extended to read this state too);
 * `disabled` reproduces `PlannerService.assertPlannerEnabled`'s flag check,
 * which runs first in both `getPlannerWindow` and `reshuffleDay`, so it is
 * reachable from either operation even though only the GET case is pinned as
 * an interaction. The three `reshuffle-*` scenarios drive
 * `PlannerService.reshuffleDay`'s three observable outcomes: a changed day, a
 * day with no disjoint result available (`unchanged: true`), and a stale
 * `expectedVersion` (409).
 * --------------------------------------------------------------------------- */
export type ProviderPlannerScenario =
  | 'ready-week'
  | 'partial-week'
  | 'not-entitled'
  | 'disabled'
  | 'reshuffle-success'
  | 'reshuffle-unchanged'
  | 'reshuffle-conflict'

export type ProviderPlannerState = {
  userId: string | null
  planDate: string | null
  scenario: ProviderPlannerScenario
}

let providerPlannerState: ProviderPlannerState | null = null

export function configureProviderPlannerState(state: {
  userId?: string
  planDate?: string
  scenario: ProviderPlannerScenario
}) {
  providerPlannerState = {
    userId: state.userId ?? null,
    planDate: state.planDate ?? null,
    scenario: state.scenario,
  }
}

export function getProviderPlannerState(): ProviderPlannerState | null {
  return providerPlannerState
}

export function resetProviderPlannerState() {
  providerPlannerState = null
}

/**
 * Story 6.1 community feed by climate band.
 *
 * One discriminated scenario per interaction outcome, in the same shape the
 * planner and capsule states above use. Two of the recorded outcomes are
 * deliberately absent from this union: an unknown `mode` and an invalid
 * challenge window are both rejected by Zod inside `CommunityController`
 * before `CommunityService` is reached, so the double never runs for them and
 * inventing a scenario would suggest a code path that does not exist. Their
 * provider states still exist in `state-handlers.ts`, because Pact requires a
 * handler for every state name a consumer declares; they simply arrange the
 * ordinary readable/writable world.
 */
export type ProviderCommunityScenario =
  | 'reaction-current'
  | 'reaction-rate-limited'
  | 'reaction-feed'
  | 'feed-resolved'
  | 'feed-band-unresolved'
  | 'feed-removed-content'
  | 'feed-cursor-invalid'
  | 'comment-refusal'
  | 'comment-page'
  | 'post-visible'
  | 'post-not-found'
  | 'allocate-new'
  | 'allocate-replay'
  | 'publish-accepted'
  | 'publish-session-mismatch'
  | 'post-rate-limited'
  | 'report-accepted'
  | 'report-not-found'
  | 'report-reason-changed'
  | 'report-self'
  | 'report-rate-limited'
  | 'challenge-created'
  | 'challenge-overlap'
  | 'spotlight-city'
  | 'spotlight-page-two'
  | 'spotlight-none'
  | 'spotlight-disabled'
  | 'spotlight-rate-limited'

export type ProviderCommunityState = {
  userId: string | null
  postId: string | null
  scenario: ProviderCommunityScenario
  refusal?: string
}

let providerCommunityState: ProviderCommunityState | null = null

export function configureProviderCommunityState(state: {
  userId?: string
  postId?: string
  scenario: ProviderCommunityScenario
  refusal?: string
}) {
  providerCommunityState = {
    userId: state.userId ?? null,
    postId: state.postId ?? null,
    scenario: state.scenario,
    refusal: state.refusal,
  }
}

export function getProviderCommunityState(): ProviderCommunityState | null {
  return providerCommunityState
}

export function resetProviderCommunityState() {
  providerCommunityState = null
}

export type ProviderEngagementScenario =
  | 'ready'
  | 'legacy-updated'
  | 'other-owner'
  | 'unavailable'
  | 'denied'
  | 'child-removed'
let providerEngagementState: ProviderEngagementScenario = 'ready'
export function configureProviderEngagementState(scenario: ProviderEngagementScenario) {
  providerEngagementState = scenario
}
export function getProviderEngagementState() {
  return providerEngagementState
}
export function resetProviderEngagementState() {
  providerEngagementState = 'ready'
}

/* --------------------------------------------------------------------------- *
 * Story 1.2b client location capture.
 *
 * Provider verification runs the real `LocationCaptureService` and
 * `LocationPreferencesService`; `doubles/locations.ts` fakes only the seams
 * they inject, and those fakes read the world below. Each scenario builds the
 * world its provider state names: the saved locations, the search window, the
 * clock, the provider outcomes and the candidate secret. A scenario that ends
 * in a save also mints the candidate token the real service will verify; the
 * state handler hands it to the verifier as a provider-state injected value.
 * --------------------------------------------------------------------------- */
export type ProviderLocationScenario =
  | 'search-candidates'
  | 'no-locations'
  | 'expired-candidate'
  | 'three-locations'
  | 'two-locations'
  | 'duplicate-location'
  | 'search-limit-reached'
  | 'provider-unavailable'
  | 'capture-unconfigured'

export type ProviderLocationWorld = {
  userId: string
  scenario: ProviderLocationScenario
  /** What `LOCATION_CLOCK` answers. */
  now: Date
  /** Every member's saved locations, so ownership is decided by the services. */
  records: SavedLocationRecord[]
  searchWindows: Map<string, LocationSearchWindowCount>
  geocoderDown: boolean
  forecastDown: boolean
  persistedForecasts: NormalizedWeatherForecast[]
  refreshTargets: WeatherIngestionTarget[]
}

/** A member who is not the caller, owning `loc-foreign-9`. */
export const PACT_OTHER_MEMBER_ID = 'pact-other-member'
/** At least 32 characters, so `resolveLocationCandidateSecret` accepts it. */
export const PACT_LOCATION_CANDIDATE_SECRET =
  'pact-location-candidate-secret-fixed-0123456789'
export const PACT_LOCATION_CLOCK_START = new Date('2026-10-22T12:00:30.000Z')
const PACT_LOCATION_CREATED_AT = new Date('2026-10-22T12:00:00.000Z')
/** One minute past the 15-minute candidate lifetime. */
const EXPIRED_CANDIDATE_ADVANCE_MS = 16 * 60 * 1000
/** The real service allows 30 searches a minute; the next one is the 31st. */
const SEARCHES_ALREADY_IN_WINDOW = 30

/** The one place the fake geocoder returns, and the candidate a save mints. */
export const PACT_CHICAGO_PLACE: GeocodedPlace = {
  city: 'Chicago',
  region: 'Illinois',
  country: 'US',
  latitude: 41.878,
  longitude: -87.63,
  localizedName: null,
}

function savedRecord(
  overrides: Partial<SavedLocationRecord> &
    Pick<SavedLocationRecord, 'id' | 'label' | 'city' | 'country' | 'timezone'>
): SavedLocationRecord {
  return {
    user_id: '',
    location_key: '',
    latitude: 0,
    longitude: 0,
    region: null,
    is_primary: false,
    sort_order: 0,
    created_at: PACT_LOCATION_CREATED_AT,
    updated_at: PACT_LOCATION_CREATED_AT,
    ...overrides,
  }
}

const chicagoRecord = (userId: string, sortOrder: number) =>
  savedRecord({
    id: 'loc-searched-1',
    user_id: userId,
    label: 'Home',
    location_key: buildSearchLocationKey(PACT_CHICAGO_PLACE),
    latitude: PACT_CHICAGO_PLACE.latitude,
    longitude: PACT_CHICAGO_PLACE.longitude,
    timezone: 'America/Chicago',
    city: 'Chicago',
    region: 'Illinois',
    country: 'US',
    is_primary: sortOrder === 0,
    sort_order: sortOrder,
  })

const officeRecord = (userId: string, sortOrder: number) =>
  savedRecord({
    id: 'loc-office-2',
    user_id: userId,
    label: 'Office',
    location_key: 'monaco-mc-43-738n-7-425e',
    latitude: 43.738,
    longitude: 7.425,
    timezone: 'Europe/Monaco',
    city: 'Monaco',
    country: 'MC',
    is_primary: sortOrder === 0,
    sort_order: sortOrder,
  })

const lisbonRecord = (userId: string, id: string, sortOrder: number) =>
  savedRecord({
    id,
    user_id: userId,
    label: 'Studio',
    location_key: 'lisbon-lisboa-pt-38-722n-9-139w',
    latitude: 38.722,
    longitude: -9.139,
    timezone: 'Europe/Lisbon',
    city: 'Lisbon',
    region: 'Lisboa',
    country: 'PT',
    is_primary: sortOrder === 0,
    sort_order: sortOrder,
  })

const osloRecord = (userId: string, sortOrder: number) =>
  savedRecord({
    id: 'loc-oslo-4',
    user_id: userId,
    label: 'Cabin',
    location_key: 'oslo-no-59-913n-10-752e',
    latitude: 59.913,
    longitude: 10.752,
    timezone: 'Europe/Oslo',
    city: 'Oslo',
    country: 'NO',
    is_primary: sortOrder === 0,
    sort_order: sortOrder,
  })

/** Another member's location: it exists, and the caller does not own it. */
const foreignRecord = () => lisbonRecord(PACT_OTHER_MEMBER_ID, 'loc-foreign-9', 0)

function seedRecords(scenario: ProviderLocationScenario, userId: string) {
  switch (scenario) {
    case 'two-locations':
      return [chicagoRecord(userId, 0), officeRecord(userId, 1), foreignRecord()]
    case 'three-locations':
      return [
        officeRecord(userId, 0),
        lisbonRecord(userId, 'loc-lisbon-3', 1),
        osloRecord(userId, 2),
        foreignRecord(),
      ]
    case 'duplicate-location':
      return [chicagoRecord(userId, 0), foreignRecord()]
    default:
      return [foreignRecord()]
  }
}

const LOCATION_ENV_KEYS = ['LOCATION_CANDIDATE_SECRET', 'NODE_ENV', 'TEST_ENV'] as const
let savedLocationEnv: Partial<Record<(typeof LOCATION_ENV_KEYS)[number], string>> | null =
  null

/** Sets the listed keys (`undefined` unsets one); keys left out stay as they are. */
function setLocationEnv(
  values: Partial<Record<(typeof LOCATION_ENV_KEYS)[number], string | undefined>>
) {
  savedLocationEnv ??= Object.fromEntries(
    LOCATION_ENV_KEYS.flatMap((key) =>
      process.env[key] === undefined ? [] : [[key, process.env[key]]]
    )
  )
  for (const key of LOCATION_ENV_KEYS) {
    if (!(key in values)) continue
    const value = values[key]
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
}

function restoreLocationEnv() {
  if (!savedLocationEnv) return
  const saved = savedLocationEnv
  for (const key of LOCATION_ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key]
    else process.env[key] = saved[key]
  }
  savedLocationEnv = null
}

let providerLocationWorld: ProviderLocationWorld | null = null

/**
 * Builds the world one provider state names and returns the values the
 * verifier injects into the request (`fromProviderState`).
 */
export function configureProviderLocationState(state: {
  userId?: string
  scenario: ProviderLocationScenario
}): { candidateToken?: string } {
  const { scenario } = state
  const userId = state.userId ?? ''
  const world: ProviderLocationWorld = {
    userId,
    scenario,
    now: PACT_LOCATION_CLOCK_START,
    records: seedRecords(scenario, userId),
    searchWindows: new Map(),
    geocoderDown: scenario === 'provider-unavailable',
    forecastDown: scenario === 'provider-unavailable',
    persistedForecasts: [],
    refreshTargets: [],
  }

  if (scenario === 'search-limit-reached') {
    world.searchWindows.set(userId, {
      searches: SEARCHES_ALREADY_IN_WINDOW,
      windowStart: new Date('2026-10-22T12:00:00.000Z'),
    })
  }

  providerLocationWorld = world

  if (scenario === 'capture-unconfigured') {
    // Preview and production without LOCATION_CANDIDATE_SECRET: no test-only
    // fallback applies, so both capture endpoints fail closed.
    setLocationEnv({
      LOCATION_CANDIDATE_SECRET: undefined,
      NODE_ENV: 'production',
      TEST_ENV: undefined,
    })
    return {}
  }

  setLocationEnv({ LOCATION_CANDIDATE_SECRET: PACT_LOCATION_CANDIDATE_SECRET })
  const candidateToken = encodeLocationCandidate(
    PACT_CHICAGO_PLACE,
    PACT_LOCATION_CANDIDATE_SECRET,
    world.now
  )
  if (scenario === 'expired-candidate') {
    world.now = new Date(world.now.getTime() + EXPIRED_CANDIDATE_ADVANCE_MS)
  }
  return { candidateToken }
}

export function getProviderLocationWorld(): ProviderLocationWorld | null {
  return providerLocationWorld
}

export function resetProviderLocationState() {
  providerLocationWorld = null
  restoreLocationEnv()
}
