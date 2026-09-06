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

/**
 * A third identity for the Story 6.1 community challenge admin routes.
 *
 * `POST /api/v1/community/challenges` and `PATCH .../challenges/{id}` mount
 * `RolesGuard` with `@Roles('admin')`, and neither `pactEventAuth` (guardian)
 * nor `pactTeenAuth` (teen) can pass it. The guard is left un-mocked in
 * `provider-helper.ts` exactly like `PremiumEntitlementGuard`, so the only way
 * to record the admin surface honestly is with an admin actor;
 * `doubles/identity.ts` resolves this token to `{ userId: 'admin-1', role:
 * 'admin' }`.
 */
export const pactAdminAuth = {
  accessToken: 'pact-admin-token',
  userId: 'admin-1',
  role: 'admin',
} as const

export const pactAdminHeaders = {
  Authorization: `Bearer ${pactAdminAuth.accessToken}`,
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
  // Story 5.4 palette advisor. The selfie upload lifecycle is deliberately
  // absent: its bytes route carries raw image data rather than a JSON body, and
  // neither client drives it through the generated SDK.
  | 'apiV1CommercePremiumPaletteGet'
  | 'apiV1CommercePremiumPaletteConsentPost'
  | 'apiV1CommercePremiumPaletteAnalyzePost'
  | 'apiV1CommercePremiumPaletteRecommendationsPut'
  // Story 5.5 premium 7-day outfit planner. The 403/503 error interactions
  // hit the mock server through raw fetch rather than these methods, exactly
  // like the palette advisor error rows above: the generated SDK throws on
  // non-2xx responses.
  | 'apiV1CommercePremiumPlannerGet'
  | 'apiV1CommercePremiumPlannerPlanDateReshufflePost'
  // Story 6.1 community feed by climate band. Two community operations are
  // deliberately absent. `apiV1CommunityPostsPostIdWithdrawPost` returns
  // `{ tracked: true }`, byte-identical to the report success
  // `interactions/community.ts` already records, so a second interaction over
  // the same envelope would add pact weight without adding coverage.
  // `apiV1CommunityChallengesIdPatch` has no interaction of its own: it shares
  // its response projection with the create it would duplicate, and the window
  // rules it re-validates are already recorded four ways on the create path.
  //
  // `apiV1CommunityChallengesPost` IS here, and deliberately so. The generated
  // `CommunityChallengeCopy` model used to project
  // `z.record(supportedLocaleSchema, ...)` as a fixed object with camelCased
  // locale tags -- `enUS?`, `enCA?`, `es419?`, all optional -- so a client that
  // followed the type sent `{ enUS: ... }` and the API rejected it, and the
  // required `en-US` fallback was not expressible at all. Driving the create
  // through the SDK rather than through raw fetch is what makes this contract
  // test a regression test for that defect: if the projection ever reverts to a
  // fixed-property object, this stops compiling.
  //
  // The 4xx rows on every community route go out through raw fetch, like the
  // palette-advisor and planner error rows above, because the generated SDK
  // throws on non-2xx responses.
  | 'apiV1CommunityFeedGet'
  | 'apiV1CommunityPostsPostIdGet'
  | 'apiV1CommunityPostsAllocatePost'
  | 'apiV1CommunityPostsPublishPost'
  | 'apiV1CommunityPostsPostIdReportPost'
  | 'apiV1CommunityChallengesPost'
>

export type CreateClient = (mockServer: V3MockServer) => ContractApiClient

export const isoTimestamp = (value: string) =>
  regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/, value)
