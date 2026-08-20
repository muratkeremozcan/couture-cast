import { MatchersV3, type V3MockServer } from '@pact-foundation/pact'
import type { DefaultApi } from '@couture/api-client'

/**
 * What every interaction module in this directory needs, and nothing a single
 * domain owns.
 *
 * The rule for what belongs here is narrow on purpose. Matchers, the two test
 * identities, the client shape, and the ISO timestamp matcher are shared because
 * every domain uses them. Contract schemas and message constants are NOT: each
 * module imports the ones it asserts against straight from
 * `@couture/api-client/contracts/http`, so a module's imports say what it covers
 * and nothing re-exports a symbol on another module's behalf.
 */

export const { decimal, eachLike, equal, like, nullValue, regex, string } = MatchersV3

export const pactEventAuth = {
  accessToken: 'pact-event-token',
  userId: 'guardian-1',
  role: 'guardian',
} as const

export const pactEventHeaders = {
  Authorization: `Bearer ${pactEventAuth.accessToken}`,
}

/**
 * A second identity for the Story 4.4 guardian-consent-gate and
 * guardian-notification interactions, which need an actor whose `role` is
 * `'teen'` (`WardrobeUploadGuard`/`assertWardrobeUploadAllowed` only ever
 * forbids a `'teen'` actor, decision 7). `provider-helper.ts`'s
 * `accessTokenIdentityService` mock resolves this token to `{ userId:
 * 'teen-1', role: 'teen' }` alongside the existing guardian identity.
 */
export const pactTeenAuth = {
  accessToken: 'pact-teen-token',
  userId: 'teen-1',
  role: 'teen',
} as const

export const pactTeenHeaders = {
  Authorization: `Bearer ${pactTeenAuth.accessToken}`,
}

export type ContractApiClient = Pick<
  DefaultApi,
  | 'apiHealthGet'
  | 'apiV1EventsPollGet'
  | 'apiV1RitualGet'
  | 'apiV1PersonalizationComfortGet'
  | 'apiV1PersonalizationComfortPut'
  | 'apiV1UserPreferencesPut'
  | 'apiV1WardrobeGarmentsGarmentIdSuggestTagsPost'
  | 'apiV1WardrobeGarmentsGarmentIdTagsPatch'
  | 'apiV1WardrobeOwnerUserIdCapsulesGet'
  | 'apiV1WardrobeOwnerUserIdCapsulesPost'
  | 'apiV1WardrobeOwnerUserIdCapsulesCapsuleIdGet'
  | 'apiV1WardrobeOwnerUserIdCapsulesCapsuleIdPatch'
  | 'apiV1WardrobeOwnerUserIdCapsulesCapsuleIdFavoritePatch'
  | 'apiV1WardrobeOwnerUserIdCapsulesCapsuleIdDelete'
  | 'apiV1WardrobeOnboardingGet'
  | 'apiV1WardrobeOnboardingPatch'
  | 'apiV1WardrobeSilhouetteGet'
  | 'apiV1WardrobeSilhouettePut'
  | 'apiV1WardrobeSilhouetteMyFormUploadUrlPost'
  | 'apiV1WardrobeSilhouetteMyFormCommitPost'
  | 'apiV1WardrobeSilhouetteMyFormDelete'
  | 'apiV1CommercePreferencesGet'
  | 'apiV1CommercePreferencesPut'
  | 'apiV1CommerceAffiliateClicksPostRaw'
  | 'apiV1CommerceAffiliateWebhookPost'
  | 'apiV1CommerceSubscriptionGet'
  | 'apiV1CommerceSubscriptionRefreshPost'
  | 'apiV1CommerceSubscriptionCheckoutSessionPost'
  | 'apiV1CommerceSubscriptionPortalSessionPost'
  | 'apiV1CommercePremiumThemeGet'
  | 'apiV1CommercePremiumThemePut'
>

export type CreateClient = (mockServer: V3MockServer) => ContractApiClient

export const isoTimestamp = (value: string) =>
  regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/, value)
