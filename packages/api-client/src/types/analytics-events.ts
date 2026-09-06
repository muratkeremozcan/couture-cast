import { z } from 'zod'
import { affiliateSurfaceSchema } from '../contracts/http/commerce'
import {
  advisorSlotSchema,
  paletteAnalysisFailureReasonSchema,
  paletteSourceSchema,
  skinDepthSchema,
  skinUndertoneSchema,
} from '../contracts/http/palette-advisor'
import {
  climateBandSchema,
  communityExperimentVariantSchema,
  communityFeedModeSchema,
  communityPlatformSchema,
  communityReportReasonSchema,
} from '../contracts/http/community'

/** Story 0.7 owner file: analytics contracts + tracking wrappers.
 * Analytics contract here = canonical event name + validated input shape + provider property shape.
 * Tracking wrapper here = track* helper that validates and returns a capture-ready payload.
 * Problems solved: schema drift across apps, inconsistent event/property naming, weak observability from split metrics.
 * Why typed contracts: compile-time event safety plus runtime validation at the analytics boundary.
 * Alternatives: direct untyped posthog.capture calls, ingest-only JSON Schema validation, or Protobuf/Avro contracts.
 * Ownership anchors:
 * - Story 0.7 Task 2 step 1 owner: define canonical event names and input/property schemas.
 * - Story 4.2 Task 6 step 1 owner: define garment_tagging_completed analytics event schema in packages/api-client/src/types/analytics-events.ts
 * - Story 0.7 Task 2 step 2 owner: normalize domain inputs to snake_case analytics properties in track* wrappers.
 * - Story 0.7 Task 3 step 1 owner: publish shared track* wrappers for app-layer reuse and integration assertions.
 * Flow refs:
 * - S0.7/T3/1: mobile, web, and API call sites import these wrappers instead of inventing local payload shapes.
 */
const isoTimestamp = z.string().datetime()
const nonEmptyString = z.string().min(1)
const garmentOverrideFieldSchema = z.enum(['category', 'material', 'comfort_range'])
const garmentOverrideFieldsSchema = z
  .array(garmentOverrideFieldSchema)
  .max(3)
  .refine((fields) => new Set(fields).size === fields.length, {
    message: 'override fields must be unique',
  })

// Flow ref S0.7/T2/1: define canonical event names and input/property schemas
// in one shared place before any app calls capture().
export const analyticsEventNameSchema = z.enum([
  'ritual_created',
  'wardrobe_upload_started',
  'alert_received',
  'moderation_action',
  'guardian_consent_granted',
  'profile_completed',
  'first_outfit_generated',
  'forecast_viewed',
  'alert_sent',
  'location_switched',
  'api_error_occurred',
  'locale_switched',
  'garment_upload_completed',
  'garment_tagging_completed',
  'wardrobe_capsule_created',
  'wardrobe_capsule_updated',
  'wardrobe_capsule_deleted',
  'wardrobe_capsule_favorite_changed',
  'wardrobe_capsule_recommended',
  'wardrobe_capsule_recommendation_viewed',
  'wardrobe_capsule_recommendation_selected',
  'wardrobe_onboarding_started',
  'wardrobe_onboarding_completed',
  // Story 5.1. affiliate_cta_shown is emitted by the mobile client directly to
  // PostHog and never reaches TelemetryService; the other two are emitted by the
  // API with an HMAC subject id. See the property schemas below for why no URL,
  // product title, garment id, or raw user id may ever appear in any of them.
  'affiliate_cta_shown',
  'affiliate_cta_clicked',
  'affiliate_conversion_recorded',
  // Story 5.2. premium_subscribe_tapped is emitted by clients directly to
  // PostHog with their own distinctId and never reaches TelemetryService; the
  // other three are server events with an HMAC subject id. Property allowlists
  // permit product id and store enums only — no price, no receipt id, no URL.
  'premium_subscribe_tapped',
  'premium_checkout_started',
  'premium_entitlement_activated',
  'premium_entitlement_deactivated',
  // Story 5.3. Server-side only: the palette write always goes through
  // PUT /api/v1/commerce/premium/theme, so there is a natural server emission
  // point and no client-distinctId variant is needed. The property allowlist is
  // the palette key and nothing else.
  'premium_theme_selected',
  // Story 5.4. All three server-side only, pseudonymous. No raw hex, no
  // confidence score, and no image metadata in any of them: undertone and
  // depth are closed enums, which is analytics-safe; a hex value is closer to
  // a biometric fingerprint and has no analytics purpose.
  'palette_analysis_completed',
  'advisor_offer_clicked',
  'advisor_recommendation_acted',
  // Story 5.5. Both server-side only, pseudonymous. `platform` comes from the
  // required `x-couture-platform` header (server-trusted, never client
  // input); `daysReady`/`dayOffset`/`unchanged` carry no wardrobe, weather,
  // or capsule content.
  'premium_planner_viewed',
  'premium_planner_day_reshuffled',
  // Story 6.1. All three server-side only, pseudonymous. Platform comes from the
  // required `x-couture-platform` header (server-trusted, never client input);
  // closed-enum properties only: no caption text, no image URL, no raw user id,
  // no coordinates.
  'community_feed_viewed',
  'community_card_opened',
  'community_post_allocated',
  'community_post_submitted',
  'community_post_published',
  'community_post_reported',
  'community_post_withdrawn',
  'community_challenge_participated',
])

export type AnalyticsEventName = z.infer<typeof analyticsEventNameSchema>

export interface AnalyticsCapturePayload<
  TEventName extends AnalyticsEventName,
  TProperties extends Record<string, unknown>,
> {
  distinctId: string
  event: TEventName
  properties: TProperties
}

export const ritualCreatedEventSchema = z.object({
  userId: nonEmptyString,
  locationId: nonEmptyString,
  timestamp: isoTimestamp,
  ritualType: nonEmptyString.optional(),
  weatherContext: nonEmptyString.optional(),
})

export type RitualCreatedEvent = z.infer<typeof ritualCreatedEventSchema>

export const wardrobeUploadStartedEventSchema = z.object({
  userId: nonEmptyString,
  itemId: nonEmptyString,
  fileSize: z.number().positive(),
  timestamp: isoTimestamp,
  itemCount: z.number().int().positive().optional(),
  uploadSource: nonEmptyString.optional(),
})

export type WardrobeUploadStartedEvent = z.infer<typeof wardrobeUploadStartedEventSchema>

export const alertReceivedEventSchema = z.object({
  userId: nonEmptyString,
  alertType: nonEmptyString,
  severity: z.enum(['info', 'warning', 'critical']),
  timestamp: isoTimestamp,
  weatherSeverity: nonEmptyString.optional(),
})

export type AlertReceivedEvent = z.infer<typeof alertReceivedEventSchema>

export const moderationActionEventSchema = z.object({
  moderatorId: nonEmptyString,
  targetId: nonEmptyString,
  action: nonEmptyString,
  reason: nonEmptyString,
  timestamp: isoTimestamp,
  contentType: nonEmptyString.optional(),
})

export type ModerationActionEvent = z.infer<typeof moderationActionEventSchema>

export const guardianConsentGrantedEventSchema = z.object({
  guardianId: nonEmptyString,
  teenId: nonEmptyString,
  consentLevel: nonEmptyString,
  timestamp: isoTimestamp,
})

export type GuardianConsentGrantedEvent = z.infer<
  typeof guardianConsentGrantedEventSchema
>

export const profileCompletedEventSchema = z.object({
  userId: nonEmptyString,
  age: z.number().int().positive(),
  guardianConsentRequired: z.boolean(),
  timestamp: isoTimestamp,
})

export type ProfileCompletedEvent = z.infer<typeof profileCompletedEventSchema>

export const firstOutfitGeneratedEventSchema = z.object({
  userId: nonEmptyString,
  locationId: nonEmptyString,
  timestamp: isoTimestamp,
  isFirstOutfit: z.boolean(),
})

export type FirstOutfitGeneratedEvent = z.infer<typeof firstOutfitGeneratedEventSchema>

export const forecastViewedEventSchema = z.object({
  userId: nonEmptyString,
  locationKey: nonEmptyString,
  status: nonEmptyString,
  timestamp: isoTimestamp,
})

export type ForecastViewedEvent = z.infer<typeof forecastViewedEventSchema>

export const alertSentEventSchema = z.object({
  userId: nonEmptyString,
  alertType: nonEmptyString,
  severity: z.enum(['info', 'warning', 'critical']),
  channel: z.enum(['realtime', 'push']),
  timestamp: isoTimestamp,
})

export type AlertSentEvent = z.infer<typeof alertSentEventSchema>

export const locationSwitchedEventSchema = z.object({
  userId: nonEmptyString,
  fromLocation: z.string().nullable(),
  toLocation: nonEmptyString,
  timestamp: isoTimestamp,
})

export type LocationSwitchedEvent = z.infer<typeof locationSwitchedEventSchema>

export const apiErrorOccurredEventSchema = z.object({
  userId: z.string().nullable(),
  route: nonEmptyString,
  method: nonEmptyString,
  statusCode: z.number().int().positive(),
  errorCode: nonEmptyString,
  timestamp: isoTimestamp,
})

export type ApiErrorOccurredEvent = z.infer<typeof apiErrorOccurredEventSchema>

export const localeSwitchedEventSchema = z.object({
  userId: nonEmptyString,
  fromLocale: nonEmptyString,
  toLocale: nonEmptyString,
  timestamp: isoTimestamp,
})

export type LocaleSwitchedEvent = z.infer<typeof localeSwitchedEventSchema>

export const garmentUploadCompletedEventSchema = z
  .object({
    analyticsSubjectId: nonEmptyString.max(128),
    garmentId: nonEmptyString,
    fileSizeBytes: z.number().int().min(1).max(10_485_760),
    mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
    hasCropping: z.boolean(),
    hasBgCleanup: z.boolean(),
    durationMs: z.number().int().min(0).max(86_400_000),
  })
  .strict()

export type GarmentUploadCompletedEvent = z.infer<
  typeof garmentUploadCompletedEventSchema
>

export const garmentTaggingCompletedEventSchema = z
  .object({
    analyticsSubjectId: nonEmptyString.max(128),
    garmentId: nonEmptyString.max(128),
    suggestedCategory: z
      .enum(['top', 'bottom', 'outerwear', 'dress', 'shoes', 'accessory'])
      .nullable(),
    confirmedCategory: z.enum([
      'top',
      'bottom',
      'outerwear',
      'dress',
      'shoes',
      'accessory',
    ]),
    suggestedMaterial: z
      .enum([
        'cotton',
        'wool',
        'linen',
        'leather',
        'denim',
        'fleece',
        'synthetic',
        'down',
        'silk',
      ])
      .nullable(),
    confirmedMaterial: z
      .enum([
        'cotton',
        'wool',
        'linen',
        'leather',
        'denim',
        'fleece',
        'synthetic',
        'down',
        'silk',
      ])
      .nullable(),
    suggestedComfortRange: z.enum(['cold', 'cool', 'mild', 'warm', 'hot']).nullable(),
    confirmedComfortRange: z.enum(['cold', 'cool', 'mild', 'warm', 'hot']),
    suggestionAvailable: z.boolean(),
    analysisVersion: nonEmptyString.max(128).nullable(),
    wasOverridden: z.boolean(),
    overrideFields: garmentOverrideFieldsSchema,
  })
  .strict()
  .superRefine((event, context) => {
    if (event.wasOverridden && event.overrideFields.length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['overrideFields'],
        message: 'overrideFields must contain a value when wasOverridden is true',
      })
    }
  })

export type GarmentTaggingCompletedEvent = z.infer<
  typeof garmentTaggingCompletedEventSchema
>

const capsuleOccasionAnalyticsEnum = z.enum([
  'work',
  'casual',
  'formal',
  'sport',
  'travel',
  'evening',
  'outdoor',
  'home',
])

const capsuleChangedFieldAnalyticsEnum = z.enum([
  'name',
  'description',
  'occasions',
  'garmentIds',
  'isFavorite',
])

export const wardrobeCapsuleCreatedEventSchema = z
  .object({
    analyticsSubjectId: nonEmptyString.max(128),
    capsuleId: nonEmptyString.max(128),
    garmentCount: z.number().int().min(2).max(10),
    occasions: z.array(capsuleOccasionAnalyticsEnum),
    isFavorite: z.boolean(),
    actorRole: z.enum(['owner', 'guardian', 'admin']).optional(),
  })
  .strict()

export type WardrobeCapsuleCreatedEvent = z.infer<
  typeof wardrobeCapsuleCreatedEventSchema
>

export const wardrobeCapsuleUpdatedEventSchema = z
  .object({
    analyticsSubjectId: nonEmptyString.max(128),
    capsuleId: nonEmptyString.max(128),
    changedFields: z.array(capsuleChangedFieldAnalyticsEnum),
    garmentCount: z.number().int().min(2).max(10),
    occasions: z.array(capsuleOccasionAnalyticsEnum),
    isFavorite: z.boolean(),
    actorRole: z.enum(['owner', 'guardian', 'admin']).optional(),
  })
  .strict()

export type WardrobeCapsuleUpdatedEvent = z.infer<
  typeof wardrobeCapsuleUpdatedEventSchema
>

export const wardrobeCapsuleDeletedEventSchema = z
  .object({
    analyticsSubjectId: nonEmptyString.max(128),
    capsuleId: nonEmptyString.max(128),
    actorRole: z.enum(['owner', 'guardian', 'admin']).optional(),
  })
  .strict()

export type WardrobeCapsuleDeletedEvent = z.infer<
  typeof wardrobeCapsuleDeletedEventSchema
>

export const wardrobeCapsuleFavoriteChangedEventSchema = z
  .object({
    analyticsSubjectId: nonEmptyString.max(128),
    capsuleId: nonEmptyString.max(128),
    requestedState: z.boolean(),
    actorRole: z.enum(['owner', 'guardian', 'admin']).optional(),
  })
  .strict()

export type WardrobeCapsuleFavoriteChangedEvent = z.infer<
  typeof wardrobeCapsuleFavoriteChangedEventSchema
>

export const wardrobeCapsuleRecommendedEventSchema = z
  .object({
    analyticsSubjectId: nonEmptyString.max(128),
    capsuleId: nonEmptyString.max(128),
    scenario: z.enum(['morning', 'midday', 'evening']),
    completeness: z.enum(['complete', 'partial']),
    autoFilledGarmentCount: z.number().int().min(0).max(10),
    requestedOccasion: capsuleOccasionAnalyticsEnum.nullable().optional(),
  })
  .strict()

export type WardrobeCapsuleRecommendedEvent = z.infer<
  typeof wardrobeCapsuleRecommendedEventSchema
>

export const wardrobeCapsuleRecommendationViewedEventSchema = z
  .object({
    analyticsSubjectId: nonEmptyString.max(128),
    capsuleId: nonEmptyString.max(128),
    scenario: z.enum(['morning', 'midday', 'evening']),
  })
  .strict()

export type WardrobeCapsuleRecommendationViewedEvent = z.infer<
  typeof wardrobeCapsuleRecommendationViewedEventSchema
>

export const wardrobeCapsuleRecommendationSelectedEventSchema = z
  .object({
    analyticsSubjectId: nonEmptyString.max(128),
    capsuleId: nonEmptyString.max(128),
    scenario: z.enum(['morning', 'midday', 'evening']),
  })
  .strict()

export type WardrobeCapsuleRecommendationSelectedEvent = z.infer<
  typeof wardrobeCapsuleRecommendationSelectedEventSchema
>

// Story 4.4 Task 2: onboarding activation events, distinct from the existing
// profile_completed/first_outfit_generated MVP activation pair. Deliberately
// carries no photo bytes, silhouette detail, or free-form text (decision 13).
export const wardrobeOnboardingStartedEventSchema = z
  .object({
    analyticsSubjectId: nonEmptyString.max(128),
    timestamp: isoTimestamp,
  })
  .strict()

export type WardrobeOnboardingStartedEvent = z.infer<
  typeof wardrobeOnboardingStartedEventSchema
>

export const wardrobeOnboardingCompletedEventSchema = z
  .object({
    analyticsSubjectId: nonEmptyString.max(128),
    durationMs: z.number().int().min(0).max(86_400_000),
    usedStarterWardrobe: z.boolean(),
    garmentCount: z.number().int().min(0).max(10_000),
    silhouetteMode: z.enum(['default_mannequin', 'my_form']),
    timestamp: isoTimestamp,
  })
  .strict()

export type WardrobeOnboardingCompletedEvent = z.infer<
  typeof wardrobeOnboardingCompletedEventSchema
>

// --- Story 5.1: affiliate commerce ----------------------------------------
//
// Three events, and the shared constraint across all of them is what is NOT
// here. No URL, no product title, no garment id, and no free-text field appears
// in any property schema, and every schema is `.strict()` so a caller cannot
// smuggle one in. `partner_id` is a slug and `offer_id` is a catalog row id;
// both are operator-controlled and safe to log. The `analyticsSubjectId` on the
// two server events is the HMAC pseudonym, never a raw user id.

// Story 5.4: derived from affiliateSurfaceSchema by import, not hand-copied.
// The hand-copy this replaced is exactly the shape of bug Decision 13 warns
// about: a surface added to the contract enum and not here fails every
// affected event's `.strict()` parse silently inside TelemetryService.
const affiliateSurfaceAnalyticsEnum = affiliateSurfaceSchema
const affiliateScenarioAnalyticsEnum = z.enum(['morning', 'midday', 'evening'])
/** Uppercase region subtag, or the '*' sentinel meaning "published globally". */
const affiliateLocaleRegionSchema = z.union([
  z.literal('*'),
  z.string().regex(/^[A-Z0-9]{2,3}$/),
])
const affiliateConversionStatusAnalyticsEnum = z.enum([
  'pending',
  'confirmed',
  'reversed',
])

export const affiliateCtaShownEventSchema = z.object({
  // Client-side only: this event uses the mobile analytics client's own
  // distinctId, exactly like trackMobileRitualCreated. It does NOT go through
  // TelemetryService and writes no TelemetryEvent row, because a mobile client
  // can neither compute the server-side HMAC subject nor write that table.
  partnerId: nonEmptyString.max(128),
  scenario: affiliateScenarioAnalyticsEnum,
  surface: affiliateSurfaceAnalyticsEnum,
  localeRegion: affiliateLocaleRegionSchema,
  /**
   * The ScenarioOutfit.id. This is the once-per-payload dedupe key the client
   * needs, the join key between impression and click, and the correlation key
   * that gives the PRD's "share of outfit sessions that trigger a brand click"
   * metric its denominator. It is a synthetic server id carrying no user
   * identity in itself, but it IS joinable to a user in the database. That is
   * the deliberate tradeoff that makes the metric computable.
   */
  recommendationId: nonEmptyString.max(128),
})

export type AffiliateCtaShownEvent = z.infer<typeof affiliateCtaShownEventSchema>

export const affiliateCtaClickedEventSchema = z.object({
  analyticsSubjectId: nonEmptyString,
  partnerId: nonEmptyString.max(128),
  offerId: nonEmptyString.max(128),
  scenario: affiliateScenarioAnalyticsEnum,
  surface: affiliateSurfaceAnalyticsEnum,
  localeRegion: affiliateLocaleRegionSchema,
  recommendationId: nonEmptyString.max(128),
})

export type AffiliateCtaClickedEvent = z.infer<typeof affiliateCtaClickedEventSchema>

export const affiliateConversionRecordedEventSchema = z.object({
  /**
   * When the posted click token matched a click, this is the HMAC of that
   * click's owner and `matched` is true. When it matched nothing there is no
   * user subject at all, so the partner slug stands in and `matched` is false.
   */
  analyticsSubjectId: nonEmptyString,
  partnerId: nonEmptyString.max(128),
  status: affiliateConversionStatusAnalyticsEnum,
  currency: z.string().regex(/^[A-Z]{3}$/),
  orderValueMinorUnits: z.number().int().min(0),
  matched: z.boolean(),
})

export type AffiliateConversionRecordedEvent = z.infer<
  typeof affiliateConversionRecordedEventSchema
>

// --- Story 5.2: premium subscription ----------------------------------------
//
// Four events; the constraint is again what is NOT here. No price, no receipt
// or transaction id, no URL, no email, and no free text appears in any schema,
// and every wrapper parses `.strict()` so a caller cannot smuggle one in.
//
// Funnel honesty, stated in the story and repeated here: the computable convert
// funnel lives in the SERVER event space (premium_checkout_started →
// premium_entitlement_activated for web; store-attributed activations for
// mobile). premium_subscribe_tapped uses the client's own distinctId, which is
// a disjoint identifier space with no join to the HMAC subject — it measures
// directional volume, not a funnel leg.

const premiumPlanAnalyticsEnum = z.enum(['premium_monthly', 'premium_annual'])
const premiumStoreAnalyticsEnum = z.enum([
  'app_store',
  'play_store',
  'stripe',
  'promotional',
])
const premiumSurfaceAnalyticsEnum = z.enum(['mobile_settings', 'web_settings'])
/** Why an entitlement stopped: expiration, refund/revocation, or transfer-loss. */
const premiumDeactivationReasonEnum = z.enum(['expired', 'revoked', 'transferred'])

export const premiumSubscribeTappedEventSchema = z.object({
  // Client-side only: uses the client analytics identity, exactly like
  // affiliate_cta_shown. Does NOT go through TelemetryService.
  plan: premiumPlanAnalyticsEnum,
  surface: premiumSurfaceAnalyticsEnum,
})

export type PremiumSubscribeTappedEvent = z.infer<
  typeof premiumSubscribeTappedEventSchema
>

export const premiumCheckoutStartedEventSchema = z.object({
  analyticsSubjectId: nonEmptyString,
  // Web-only by construction: checkout sessions exist only on the Stripe rail.
  // The mobile funnel start is premium_subscribe_tapped.
  plan: premiumPlanAnalyticsEnum,
})

export type PremiumCheckoutStartedEvent = z.infer<
  typeof premiumCheckoutStartedEventSchema
>

export const premiumEntitlementActivatedEventSchema = z.object({
  analyticsSubjectId: nonEmptyString,
  store: premiumStoreAnalyticsEnum,
  productId: nonEmptyString.max(128),
})

export type PremiumEntitlementActivatedEvent = z.infer<
  typeof premiumEntitlementActivatedEventSchema
>

export const premiumEntitlementDeactivatedEventSchema = z.object({
  analyticsSubjectId: nonEmptyString,
  store: premiumStoreAnalyticsEnum,
  productId: nonEmptyString.max(128),
  reason: premiumDeactivationReasonEnum,
})

export type PremiumEntitlementDeactivatedEvent = z.infer<
  typeof premiumEntitlementDeactivatedEventSchema
>

// --- Story 5.3: premium theme -----------------------------------------------
//
// One server event, fired on a successful PUT /api/v1/commerce/premium/theme.
// Unlike premium_subscribe_tapped there is no client-distinctId variant: the
// write always goes through the API, so the server is the only emission point
// and the HMAC subject is always available.

/**
 * Mirrors `premiumThemeKeySchema` in `contracts/http/premium-theme.ts`, kept
 * local for the same reason `premiumStoreAnalyticsEnum` is: `types/` does not
 * depend on `contracts/`. Null is the Default palette — the same single
 * spelling the contract uses, so a reset is a measurable selection rather than
 * a missing event.
 */
const premiumThemeAnalyticsEnum = z.enum([
  'jewel_radiance',
  'autumn_umber',
  'winter_metallic',
])

export const premiumThemeSelectedEventSchema = z.object({
  analyticsSubjectId: nonEmptyString,
  theme: premiumThemeAnalyticsEnum.nullable(),
})

export type PremiumThemeSelectedEvent = z.infer<typeof premiumThemeSelectedEventSchema>

/**
 * Story 5.4: three server-side, pseudonymous events. `undertone` and `depth`
 * are pinned against the contract enums by import (Decision 13), not
 * re-listed, for the same reason `affiliateSurfaceAnalyticsEnum` now is.
 *
 * No raw hex, no confidence score, and no image metadata in any property: a
 * hex value is closer to a biometric fingerprint than an analytics
 * dimension, and `undertone`/`depth` are closed four- and five-member enums.
 */
const paletteAnalysisOutcomeAnalyticsEnum = z.union([
  z.literal('ready'),
  paletteAnalysisFailureReasonSchema,
])

export const paletteAnalysisCompletedEventSchema = z.object({
  analyticsSubjectId: nonEmptyString,
  source: paletteSourceSchema,
  undertone: skinUndertoneSchema.nullable(),
  depth: skinDepthSchema.nullable(),
  outcome: paletteAnalysisOutcomeAnalyticsEnum,
})

export type PaletteAnalysisCompletedEvent = z.infer<
  typeof paletteAnalysisCompletedEventSchema
>

const advisorPlatformAnalyticsEnum = z.enum(['web', 'mobile'])

export const advisorOfferClickedEventSchema = z.object({
  analyticsSubjectId: nonEmptyString,
  partnerId: nonEmptyString.max(128),
  offerId: nonEmptyString.max(128),
  advisorSlot: advisorSlotSchema,
  platform: advisorPlatformAnalyticsEnum,
})

export type AdvisorOfferClickedEvent = z.infer<typeof advisorOfferClickedEventSchema>

export const advisorRecommendationActedEventSchema = z.object({
  analyticsSubjectId: nonEmptyString,
  slot: advisorSlotSchema,
  action: z.enum(['saved', 'dismissed']),
})

export type AdvisorRecommendationActedEvent = z.infer<
  typeof advisorRecommendationActedEventSchema
>

const plannerPlatformAnalyticsEnum = z.enum(['web', 'mobile'])

// Story 5.5 AC 6. `platform` comes from the required `x-couture-platform`
// header, never client-supplied input.
export const premiumPlannerViewedEventSchema = z.object({
  analyticsSubjectId: nonEmptyString,
  platform: plannerPlatformAnalyticsEnum,
  daysReady: z.number().int().min(0).max(7),
})

export type PremiumPlannerViewedEvent = z.infer<typeof premiumPlannerViewedEventSchema>

export const premiumPlannerDayReshuffledEventSchema = z.object({
  analyticsSubjectId: nonEmptyString,
  platform: plannerPlatformAnalyticsEnum,
  dayOffset: z.number().int().min(0).max(6),
  unchanged: z.boolean(),
})

export type PremiumPlannerDayReshuffledEvent = z.infer<
  typeof premiumPlannerDayReshuffledEventSchema
>

// Story 6.1 AC 8. Platform comes from the required `x-couture-platform` header.
//
// Every community event carries a `dedupeKey`. The moderation pipeline emits from a
// BullMQ job that retries, so without a stable key a retried job double-counts a
// publication, and publication count is an input to the beta gate. The key is
// deterministic per (event, subject occurrence) and the sink upserts on it.
const communityDedupeKeySchema = nonEmptyString.describe(
  'Deterministic idempotency key. The analytics sink upserts on it so a retried emit counts once.'
)

export const communityFeedViewedEventSchema = z.object({
  analyticsSubjectId: nonEmptyString,
  platform: communityPlatformSchema,
  dedupeKey: communityDedupeKeySchema,
  /** The viewer's own resolved band. Never the requested filter; see filterMode. */
  climateBand: climateBandSchema.nullable(),
  bandResolved: z.boolean(),
  filterMode: communityFeedModeSchema,
  experimentVariant: communityExperimentVariantSchema,
  itemCount: z.number().int().min(0),
  isEmpty: z.boolean(),
})

export type CommunityFeedViewedEvent = z.infer<typeof communityFeedViewedEventSchema>

/**
 * The beta gate advances on non-self card-open lift, so the self flag is required
 * rather than derived, and the variant has to travel with the event to split arms.
 */
export const communityCardOpenedEventSchema = z.object({
  analyticsSubjectId: nonEmptyString,
  platform: communityPlatformSchema,
  dedupeKey: communityDedupeKeySchema,
  climateBand: climateBandSchema.nullable(),
  isSelf: z.boolean(),
  experimentVariant: communityExperimentVariantSchema,
})

export type CommunityCardOpenedEvent = z.infer<typeof communityCardOpenedEventSchema>

export const communityPostAllocatedEventSchema = z.object({
  analyticsSubjectId: nonEmptyString,
  platform: communityPlatformSchema,
  dedupeKey: communityDedupeKeySchema,
  replayed: z.boolean(),
})

export type CommunityPostAllocatedEvent = z.infer<
  typeof communityPostAllocatedEventSchema
>

export const communityPostSubmittedEventSchema = z.object({
  analyticsSubjectId: nonEmptyString,
  platform: communityPlatformSchema,
  dedupeKey: communityDedupeKeySchema,
  climateBand: climateBandSchema.nullable(),
  hasCaption: z.boolean(),
  hasChallenge: z.boolean(),
})

export type CommunityPostSubmittedEvent = z.infer<
  typeof communityPostSubmittedEventSchema
>

export const communityPostPublishedEventSchema = z.object({
  analyticsSubjectId: nonEmptyString,
  platform: communityPlatformSchema,
  dedupeKey: communityDedupeKeySchema,
  climateBand: climateBandSchema.nullable(),
})

export type CommunityPostPublishedEvent = z.infer<
  typeof communityPostPublishedEventSchema
>

export const communityPostReportedEventSchema = z.object({
  analyticsSubjectId: nonEmptyString,
  platform: communityPlatformSchema,
  dedupeKey: communityDedupeKeySchema,
  reason: communityReportReasonSchema,
})

export type CommunityPostReportedEvent = z.infer<typeof communityPostReportedEventSchema>

export const communityPostWithdrawnEventSchema = z.object({
  analyticsSubjectId: nonEmptyString,
  platform: communityPlatformSchema,
  dedupeKey: communityDedupeKeySchema,
  climateBand: climateBandSchema.nullable(),
})

export type CommunityPostWithdrawnEvent = z.infer<
  typeof communityPostWithdrawnEventSchema
>

/** One per unique published participant, so the challenge count stays honest. */
export const communityChallengeParticipatedEventSchema = z.object({
  analyticsSubjectId: nonEmptyString,
  platform: communityPlatformSchema,
  dedupeKey: communityDedupeKeySchema,
  climateBand: climateBandSchema.nullable(),
})

export type CommunityChallengeParticipatedEvent = z.infer<
  typeof communityChallengeParticipatedEventSchema
>

export const analyticsEventSchemas = {
  ritual_created: ritualCreatedEventSchema,
  wardrobe_upload_started: wardrobeUploadStartedEventSchema,
  alert_received: alertReceivedEventSchema,
  moderation_action: moderationActionEventSchema,
  guardian_consent_granted: guardianConsentGrantedEventSchema,
  profile_completed: profileCompletedEventSchema,
  first_outfit_generated: firstOutfitGeneratedEventSchema,
  forecast_viewed: forecastViewedEventSchema,
  alert_sent: alertSentEventSchema,
  location_switched: locationSwitchedEventSchema,
  api_error_occurred: apiErrorOccurredEventSchema,
  locale_switched: localeSwitchedEventSchema,
  garment_upload_completed: garmentUploadCompletedEventSchema,
  garment_tagging_completed: garmentTaggingCompletedEventSchema,
  wardrobe_capsule_created: wardrobeCapsuleCreatedEventSchema,
  wardrobe_capsule_updated: wardrobeCapsuleUpdatedEventSchema,
  wardrobe_capsule_deleted: wardrobeCapsuleDeletedEventSchema,
  wardrobe_capsule_favorite_changed: wardrobeCapsuleFavoriteChangedEventSchema,
  wardrobe_capsule_recommended: wardrobeCapsuleRecommendedEventSchema,
  wardrobe_capsule_recommendation_viewed: wardrobeCapsuleRecommendationViewedEventSchema,
  wardrobe_capsule_recommendation_selected:
    wardrobeCapsuleRecommendationSelectedEventSchema,
  wardrobe_onboarding_started: wardrobeOnboardingStartedEventSchema,
  wardrobe_onboarding_completed: wardrobeOnboardingCompletedEventSchema,
  affiliate_cta_shown: affiliateCtaShownEventSchema,
  affiliate_cta_clicked: affiliateCtaClickedEventSchema,
  affiliate_conversion_recorded: affiliateConversionRecordedEventSchema,
  premium_subscribe_tapped: premiumSubscribeTappedEventSchema,
  premium_checkout_started: premiumCheckoutStartedEventSchema,
  premium_entitlement_activated: premiumEntitlementActivatedEventSchema,
  premium_entitlement_deactivated: premiumEntitlementDeactivatedEventSchema,
  premium_theme_selected: premiumThemeSelectedEventSchema,
  palette_analysis_completed: paletteAnalysisCompletedEventSchema,
  advisor_offer_clicked: advisorOfferClickedEventSchema,
  advisor_recommendation_acted: advisorRecommendationActedEventSchema,
  premium_planner_viewed: premiumPlannerViewedEventSchema,
  premium_planner_day_reshuffled: premiumPlannerDayReshuffledEventSchema,
  community_feed_viewed: communityFeedViewedEventSchema,
  community_card_opened: communityCardOpenedEventSchema,
  community_post_allocated: communityPostAllocatedEventSchema,
  community_post_submitted: communityPostSubmittedEventSchema,
  community_post_published: communityPostPublishedEventSchema,
  community_post_reported: communityPostReportedEventSchema,
  community_post_withdrawn: communityPostWithdrawnEventSchema,
  community_challenge_participated: communityChallengeParticipatedEventSchema,
}

export const ritualCreatedPropertiesSchema = z.object({
  user_id: nonEmptyString,
  location_id: nonEmptyString,
  timestamp: isoTimestamp,
  ritual_type: nonEmptyString.optional(),
  weather_context: nonEmptyString.optional(),
})

export type RitualCreatedProperties = z.infer<typeof ritualCreatedPropertiesSchema>

export const wardrobeUploadStartedPropertiesSchema = z.object({
  user_id: nonEmptyString,
  item_id: nonEmptyString,
  file_size: z.number().positive(),
  timestamp: isoTimestamp,
  item_count: z.number().int().positive().optional(),
  upload_source: nonEmptyString.optional(),
})

export type WardrobeUploadStartedProperties = z.infer<
  typeof wardrobeUploadStartedPropertiesSchema
>

export const alertReceivedPropertiesSchema = z.object({
  user_id: nonEmptyString,
  alert_type: nonEmptyString,
  severity: z.enum(['info', 'warning', 'critical']),
  timestamp: isoTimestamp,
  weather_severity: nonEmptyString.optional(),
})

export type AlertReceivedProperties = z.infer<typeof alertReceivedPropertiesSchema>

export const moderationActionPropertiesSchema = z.object({
  moderator_id: nonEmptyString,
  target_id: nonEmptyString,
  action: nonEmptyString,
  reason: nonEmptyString,
  timestamp: isoTimestamp,
  content_type: nonEmptyString.optional(),
})

export type ModerationActionProperties = z.infer<typeof moderationActionPropertiesSchema>

export const guardianConsentGrantedPropertiesSchema = z.object({
  guardian_id: nonEmptyString,
  teen_id: nonEmptyString,
  consent_level: nonEmptyString,
  timestamp: isoTimestamp,
  consent_timestamp: isoTimestamp,
})

export type GuardianConsentGrantedProperties = z.infer<
  typeof guardianConsentGrantedPropertiesSchema
>

export const profileCompletedPropertiesSchema = z.object({
  user_id: nonEmptyString,
  age: z.number().int().positive(),
  guardian_consent_required: z.boolean(),
  timestamp: isoTimestamp,
})

export type ProfileCompletedProperties = z.infer<typeof profileCompletedPropertiesSchema>

export const firstOutfitGeneratedPropertiesSchema = z.object({
  user_id: nonEmptyString,
  location_id: nonEmptyString,
  timestamp: isoTimestamp,
  is_first_outfit: z.boolean(),
})

export type FirstOutfitGeneratedProperties = z.infer<
  typeof firstOutfitGeneratedPropertiesSchema
>

export const forecastViewedPropertiesSchema = z.object({
  user_id: nonEmptyString,
  location_key: nonEmptyString,
  status: nonEmptyString,
  timestamp: isoTimestamp,
})

export type ForecastViewedProperties = z.infer<typeof forecastViewedPropertiesSchema>

export const alertSentPropertiesSchema = z.object({
  user_id: nonEmptyString,
  alert_type: nonEmptyString,
  severity: z.enum(['info', 'warning', 'critical']),
  channel: z.enum(['realtime', 'push']),
  timestamp: isoTimestamp,
})

export type AlertSentProperties = z.infer<typeof alertSentPropertiesSchema>

export const locationSwitchedPropertiesSchema = z.object({
  user_id: nonEmptyString,
  from_location: z.string().nullable(),
  to_location: nonEmptyString,
  timestamp: isoTimestamp,
})

export type LocationSwitchedProperties = z.infer<typeof locationSwitchedPropertiesSchema>

export const apiErrorOccurredPropertiesSchema = z.object({
  user_id: z.string().nullable(),
  route: nonEmptyString,
  method: nonEmptyString,
  status_code: z.number().int().positive(),
  error_code: nonEmptyString,
  timestamp: isoTimestamp,
})

export type ApiErrorOccurredProperties = z.infer<typeof apiErrorOccurredPropertiesSchema>

export const localeSwitchedPropertiesSchema = z.object({
  user_id: nonEmptyString,
  from_locale: nonEmptyString,
  to_locale: nonEmptyString,
  timestamp: isoTimestamp,
})

export type LocaleSwitchedProperties = z.infer<typeof localeSwitchedPropertiesSchema>

export const garmentUploadCompletedPropertiesSchema = z
  .object({
    garment_id: nonEmptyString.max(64),
    file_size_bytes: z.number().int().min(1).max(10_485_760),
    mime_type: z.enum(['image/jpeg', 'image/png', 'image/webp']),
    has_cropping: z.boolean(),
    has_bg_cleanup: z.boolean(),
    duration_ms: z.number().int().min(0).max(86_400_000),
  })
  .strict()

export type GarmentUploadCompletedProperties = z.infer<
  typeof garmentUploadCompletedPropertiesSchema
>

export const garmentTaggingCompletedPropertiesSchema = z
  .object({
    garment_id: nonEmptyString.max(128),
    suggested_category: z
      .enum(['top', 'bottom', 'outerwear', 'dress', 'shoes', 'accessory'])
      .nullable(),
    confirmed_category: z.enum([
      'top',
      'bottom',
      'outerwear',
      'dress',
      'shoes',
      'accessory',
    ]),
    suggested_material: z
      .enum([
        'cotton',
        'wool',
        'linen',
        'leather',
        'denim',
        'fleece',
        'synthetic',
        'down',
        'silk',
      ])
      .nullable(),
    confirmed_material: z
      .enum([
        'cotton',
        'wool',
        'linen',
        'leather',
        'denim',
        'fleece',
        'synthetic',
        'down',
        'silk',
      ])
      .nullable(),
    suggested_comfort_range: z.enum(['cold', 'cool', 'mild', 'warm', 'hot']).nullable(),
    confirmed_comfort_range: z.enum(['cold', 'cool', 'mild', 'warm', 'hot']),
    suggestion_available: z.boolean(),
    analysis_version: nonEmptyString.max(128).nullable(),
    was_overridden: z.boolean(),
    override_fields: garmentOverrideFieldsSchema,
  })
  .strict()
  .superRefine((properties, context) => {
    if (properties.was_overridden && properties.override_fields.length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['override_fields'],
        message: 'override_fields must contain a value when was_overridden is true',
      })
    }
  })

export type GarmentTaggingCompletedProperties = z.infer<
  typeof garmentTaggingCompletedPropertiesSchema
>

// Flow ref S0.7/T2/2: normalize domain inputs to snake_case analytics
// properties in the shared wrappers below.
// Flow ref S0.7/T3/1: app layers and integration assertions reuse these
// wrappers instead of rolling their own payload shapes.
export function trackRitualCreated(
  event: RitualCreatedEvent
): AnalyticsCapturePayload<'ritual_created', RitualCreatedProperties> {
  const parsed = ritualCreatedEventSchema.parse(event)

  return {
    distinctId: parsed.userId,
    event: 'ritual_created',
    properties: ritualCreatedPropertiesSchema.parse({
      user_id: parsed.userId,
      location_id: parsed.locationId,
      timestamp: parsed.timestamp,
      ritual_type: parsed.ritualType,
      weather_context: parsed.weatherContext,
    }),
  }
}

export function trackWardrobeUploadStarted(
  event: WardrobeUploadStartedEvent
): AnalyticsCapturePayload<'wardrobe_upload_started', WardrobeUploadStartedProperties> {
  const parsed = wardrobeUploadStartedEventSchema.parse(event)

  return {
    distinctId: parsed.userId,
    event: 'wardrobe_upload_started',
    properties: wardrobeUploadStartedPropertiesSchema.parse({
      user_id: parsed.userId,
      item_id: parsed.itemId,
      file_size: parsed.fileSize,
      timestamp: parsed.timestamp,
      item_count: parsed.itemCount,
      upload_source: parsed.uploadSource,
    }),
  }
}

export function trackAlertReceived(
  event: AlertReceivedEvent
): AnalyticsCapturePayload<'alert_received', AlertReceivedProperties> {
  const parsed = alertReceivedEventSchema.parse(event)

  return {
    distinctId: parsed.userId,
    event: 'alert_received',
    properties: alertReceivedPropertiesSchema.parse({
      user_id: parsed.userId,
      alert_type: parsed.alertType,
      severity: parsed.severity,
      timestamp: parsed.timestamp,
      weather_severity: parsed.weatherSeverity,
    }),
  }
}

export function trackModerationAction(
  event: ModerationActionEvent
): AnalyticsCapturePayload<'moderation_action', ModerationActionProperties> {
  const parsed = moderationActionEventSchema.parse(event)

  return {
    distinctId: parsed.moderatorId,
    event: 'moderation_action',
    properties: moderationActionPropertiesSchema.parse({
      moderator_id: parsed.moderatorId,
      target_id: parsed.targetId,
      action: parsed.action,
      reason: parsed.reason,
      timestamp: parsed.timestamp,
      content_type: parsed.contentType,
    }),
  }
}

export function trackGuardianConsentGranted(
  event: GuardianConsentGrantedEvent
): AnalyticsCapturePayload<'guardian_consent_granted', GuardianConsentGrantedProperties> {
  const parsed = guardianConsentGrantedEventSchema.parse(event)

  return {
    distinctId: parsed.guardianId,
    event: 'guardian_consent_granted',
    properties: guardianConsentGrantedPropertiesSchema.parse({
      guardian_id: parsed.guardianId,
      teen_id: parsed.teenId,
      consent_level: parsed.consentLevel,
      timestamp: parsed.timestamp,
      consent_timestamp: parsed.timestamp,
    }),
  }
}

export function trackProfileCompleted(
  event: ProfileCompletedEvent
): AnalyticsCapturePayload<'profile_completed', ProfileCompletedProperties> {
  const parsed = profileCompletedEventSchema.parse(event)

  return {
    distinctId: parsed.userId,
    event: 'profile_completed',
    properties: profileCompletedPropertiesSchema.parse({
      user_id: parsed.userId,
      age: parsed.age,
      guardian_consent_required: parsed.guardianConsentRequired,
      timestamp: parsed.timestamp,
    }),
  }
}

export function trackFirstOutfitGenerated(
  event: FirstOutfitGeneratedEvent
): AnalyticsCapturePayload<'first_outfit_generated', FirstOutfitGeneratedProperties> {
  const parsed = firstOutfitGeneratedEventSchema.parse(event)

  return {
    distinctId: parsed.userId,
    event: 'first_outfit_generated',
    properties: firstOutfitGeneratedPropertiesSchema.parse({
      user_id: parsed.userId,
      location_id: parsed.locationId,
      timestamp: parsed.timestamp,
      is_first_outfit: parsed.isFirstOutfit,
    }),
  }
}

export function trackForecastViewed(
  event: ForecastViewedEvent
): AnalyticsCapturePayload<'forecast_viewed', ForecastViewedProperties> {
  const parsed = forecastViewedEventSchema.parse(event)

  return {
    distinctId: parsed.userId,
    event: 'forecast_viewed',
    properties: forecastViewedPropertiesSchema.parse({
      user_id: parsed.userId,
      location_key: parsed.locationKey,
      status: parsed.status,
      timestamp: parsed.timestamp,
    }),
  }
}

export function trackAlertSent(
  event: AlertSentEvent
): AnalyticsCapturePayload<'alert_sent', AlertSentProperties> {
  const parsed = alertSentEventSchema.parse(event)

  return {
    distinctId: parsed.userId,
    event: 'alert_sent',
    properties: alertSentPropertiesSchema.parse({
      user_id: parsed.userId,
      alert_type: parsed.alertType,
      severity: parsed.severity,
      channel: parsed.channel,
      timestamp: parsed.timestamp,
    }),
  }
}

export function trackLocationSwitched(
  event: LocationSwitchedEvent
): AnalyticsCapturePayload<'location_switched', LocationSwitchedProperties> {
  const parsed = locationSwitchedEventSchema.parse(event)

  return {
    distinctId: parsed.userId,
    event: 'location_switched',
    properties: locationSwitchedPropertiesSchema.parse({
      user_id: parsed.userId,
      from_location: parsed.fromLocation,
      to_location: parsed.toLocation,
      timestamp: parsed.timestamp,
    }),
  }
}

export function trackApiErrorOccurred(
  event: ApiErrorOccurredEvent
): AnalyticsCapturePayload<'api_error_occurred', ApiErrorOccurredProperties> {
  const parsed = apiErrorOccurredEventSchema.parse(event)

  return {
    distinctId: parsed.userId ?? 'anonymous',
    event: 'api_error_occurred',
    properties: apiErrorOccurredPropertiesSchema.parse({
      user_id: parsed.userId,
      route: parsed.route,
      method: parsed.method,
      status_code: parsed.statusCode,
      error_code: parsed.errorCode,
      timestamp: parsed.timestamp,
    }),
  }
}

export function trackLocaleSwitched(
  event: LocaleSwitchedEvent
): AnalyticsCapturePayload<'locale_switched', LocaleSwitchedProperties> {
  const parsed = localeSwitchedEventSchema.parse(event)

  return {
    distinctId: parsed.userId,
    event: 'locale_switched',
    properties: localeSwitchedPropertiesSchema.parse({
      user_id: parsed.userId,
      from_locale: parsed.fromLocale,
      to_locale: parsed.toLocale,
      timestamp: parsed.timestamp,
    }),
  }
}

// Story 4.1 Task 7 step 1 owner: define garment_upload_completed analytics event and track wrapper
export function trackGarmentUploadCompleted(
  event: GarmentUploadCompletedEvent
): AnalyticsCapturePayload<'garment_upload_completed', GarmentUploadCompletedProperties> {
  const parsed = garmentUploadCompletedEventSchema.parse(event)

  return {
    distinctId: parsed.analyticsSubjectId,
    event: 'garment_upload_completed',
    properties: garmentUploadCompletedPropertiesSchema.parse({
      garment_id: parsed.garmentId,
      file_size_bytes: parsed.fileSizeBytes,
      mime_type: parsed.mimeType,
      has_cropping: parsed.hasCropping,
      has_bg_cleanup: parsed.hasBgCleanup,
      duration_ms: parsed.durationMs,
    }),
  }
}

export function trackGarmentTaggingCompleted(
  event: GarmentTaggingCompletedEvent
): AnalyticsCapturePayload<
  'garment_tagging_completed',
  GarmentTaggingCompletedProperties
> {
  const parsed = garmentTaggingCompletedEventSchema.parse(event)

  return {
    distinctId: parsed.analyticsSubjectId,
    event: 'garment_tagging_completed',
    properties: garmentTaggingCompletedPropertiesSchema.parse({
      garment_id: parsed.garmentId,
      suggested_category: parsed.suggestedCategory,
      confirmed_category: parsed.confirmedCategory,
      suggested_material: parsed.suggestedMaterial,
      confirmed_material: parsed.confirmedMaterial,
      suggested_comfort_range: parsed.suggestedComfortRange,
      confirmed_comfort_range: parsed.confirmedComfortRange,
      suggestion_available: parsed.suggestionAvailable,
      analysis_version: parsed.analysisVersion,
      was_overridden: parsed.wasOverridden,
      override_fields: parsed.overrideFields,
    }),
  }
}

export const wardrobeCapsuleCreatedPropertiesSchema = z
  .object({
    capsule_id: nonEmptyString.max(128),
    garment_count: z.number().int().min(2).max(10),
    occasions: z.array(capsuleOccasionAnalyticsEnum),
    is_favorite: z.boolean(),
    actor_role: z.enum(['owner', 'guardian', 'admin']).optional(),
  })
  .strict()

export type WardrobeCapsuleCreatedProperties = z.infer<
  typeof wardrobeCapsuleCreatedPropertiesSchema
>

export const wardrobeCapsuleUpdatedPropertiesSchema = z
  .object({
    capsule_id: nonEmptyString.max(128),
    changed_fields: z.array(capsuleChangedFieldAnalyticsEnum),
    garment_count: z.number().int().min(2).max(10),
    occasions: z.array(capsuleOccasionAnalyticsEnum),
    is_favorite: z.boolean(),
    actor_role: z.enum(['owner', 'guardian', 'admin']).optional(),
  })
  .strict()

export type WardrobeCapsuleUpdatedProperties = z.infer<
  typeof wardrobeCapsuleUpdatedPropertiesSchema
>

export const wardrobeCapsuleDeletedPropertiesSchema = z
  .object({
    capsule_id: nonEmptyString.max(128),
    actor_role: z.enum(['owner', 'guardian', 'admin']).optional(),
  })
  .strict()

export type WardrobeCapsuleDeletedProperties = z.infer<
  typeof wardrobeCapsuleDeletedPropertiesSchema
>

export const wardrobeCapsuleFavoriteChangedPropertiesSchema = z
  .object({
    capsule_id: nonEmptyString.max(128),
    requested_state: z.boolean(),
    actor_role: z.enum(['owner', 'guardian', 'admin']).optional(),
  })
  .strict()

export type WardrobeCapsuleFavoriteChangedProperties = z.infer<
  typeof wardrobeCapsuleFavoriteChangedPropertiesSchema
>

export const wardrobeCapsuleRecommendedPropertiesSchema = z
  .object({
    capsule_id: nonEmptyString.max(128),
    scenario: z.enum(['morning', 'midday', 'evening']),
    completeness: z.enum(['complete', 'partial']),
    auto_filled_garment_count: z.number().int().min(0).max(10),
    requested_occasion: capsuleOccasionAnalyticsEnum.nullable().optional(),
  })
  .strict()

export type WardrobeCapsuleRecommendedProperties = z.infer<
  typeof wardrobeCapsuleRecommendedPropertiesSchema
>

export const wardrobeCapsuleRecommendationViewedPropertiesSchema = z
  .object({
    capsule_id: nonEmptyString.max(128),
    scenario: z.enum(['morning', 'midday', 'evening']),
  })
  .strict()

export type WardrobeCapsuleRecommendationViewedProperties = z.infer<
  typeof wardrobeCapsuleRecommendationViewedPropertiesSchema
>

export const wardrobeCapsuleRecommendationSelectedPropertiesSchema = z
  .object({
    capsule_id: nonEmptyString.max(128),
    scenario: z.enum(['morning', 'midday', 'evening']),
  })
  .strict()

export type WardrobeCapsuleRecommendationSelectedProperties = z.infer<
  typeof wardrobeCapsuleRecommendationSelectedPropertiesSchema
>

export const wardrobeOnboardingStartedPropertiesSchema = z
  .object({
    user_id: nonEmptyString,
    timestamp: isoTimestamp,
  })
  .strict()

export type WardrobeOnboardingStartedProperties = z.infer<
  typeof wardrobeOnboardingStartedPropertiesSchema
>

export const wardrobeOnboardingCompletedPropertiesSchema = z
  .object({
    user_id: nonEmptyString,
    duration_ms: z.number().int().min(0).max(86_400_000),
    used_starter_wardrobe: z.boolean(),
    garment_count: z.number().int().min(0).max(10_000),
    silhouette_mode: z.enum(['default_mannequin', 'my_form']),
    timestamp: isoTimestamp,
  })
  .strict()

export type WardrobeOnboardingCompletedProperties = z.infer<
  typeof wardrobeOnboardingCompletedPropertiesSchema
>

export function trackWardrobeCapsuleCreated(
  event: WardrobeCapsuleCreatedEvent
): AnalyticsCapturePayload<'wardrobe_capsule_created', WardrobeCapsuleCreatedProperties> {
  const parsed = wardrobeCapsuleCreatedEventSchema.parse(event)

  return {
    distinctId: parsed.analyticsSubjectId,
    event: 'wardrobe_capsule_created',
    properties: wardrobeCapsuleCreatedPropertiesSchema.parse({
      capsule_id: parsed.capsuleId,
      garment_count: parsed.garmentCount,
      occasions: parsed.occasions,
      is_favorite: parsed.isFavorite,
      actor_role: parsed.actorRole,
    }),
  }
}

export function trackWardrobeCapsuleUpdated(
  event: WardrobeCapsuleUpdatedEvent
): AnalyticsCapturePayload<'wardrobe_capsule_updated', WardrobeCapsuleUpdatedProperties> {
  const parsed = wardrobeCapsuleUpdatedEventSchema.parse(event)

  return {
    distinctId: parsed.analyticsSubjectId,
    event: 'wardrobe_capsule_updated',
    properties: wardrobeCapsuleUpdatedPropertiesSchema.parse({
      capsule_id: parsed.capsuleId,
      changed_fields: parsed.changedFields,
      garment_count: parsed.garmentCount,
      occasions: parsed.occasions,
      is_favorite: parsed.isFavorite,
      actor_role: parsed.actorRole,
    }),
  }
}

export function trackWardrobeCapsuleDeleted(
  event: WardrobeCapsuleDeletedEvent
): AnalyticsCapturePayload<'wardrobe_capsule_deleted', WardrobeCapsuleDeletedProperties> {
  const parsed = wardrobeCapsuleDeletedEventSchema.parse(event)

  return {
    distinctId: parsed.analyticsSubjectId,
    event: 'wardrobe_capsule_deleted',
    properties: wardrobeCapsuleDeletedPropertiesSchema.parse({
      capsule_id: parsed.capsuleId,
      actor_role: parsed.actorRole,
    }),
  }
}

export function trackWardrobeCapsuleFavoriteChanged(
  event: WardrobeCapsuleFavoriteChangedEvent
): AnalyticsCapturePayload<
  'wardrobe_capsule_favorite_changed',
  WardrobeCapsuleFavoriteChangedProperties
> {
  const parsed = wardrobeCapsuleFavoriteChangedEventSchema.parse(event)

  return {
    distinctId: parsed.analyticsSubjectId,
    event: 'wardrobe_capsule_favorite_changed',
    properties: wardrobeCapsuleFavoriteChangedPropertiesSchema.parse({
      capsule_id: parsed.capsuleId,
      requested_state: parsed.requestedState,
      actor_role: parsed.actorRole,
    }),
  }
}

export function trackWardrobeCapsuleRecommended(
  event: WardrobeCapsuleRecommendedEvent
): AnalyticsCapturePayload<
  'wardrobe_capsule_recommended',
  WardrobeCapsuleRecommendedProperties
> {
  const parsed = wardrobeCapsuleRecommendedEventSchema.parse(event)

  return {
    distinctId: parsed.analyticsSubjectId,
    event: 'wardrobe_capsule_recommended',
    properties: wardrobeCapsuleRecommendedPropertiesSchema.parse({
      capsule_id: parsed.capsuleId,
      scenario: parsed.scenario,
      completeness: parsed.completeness,
      auto_filled_garment_count: parsed.autoFilledGarmentCount,
      requested_occasion: parsed.requestedOccasion,
    }),
  }
}

export function trackWardrobeCapsuleRecommendationViewed(
  event: WardrobeCapsuleRecommendationViewedEvent
): AnalyticsCapturePayload<
  'wardrobe_capsule_recommendation_viewed',
  WardrobeCapsuleRecommendationViewedProperties
> {
  const parsed = wardrobeCapsuleRecommendationViewedEventSchema.parse(event)

  return {
    distinctId: parsed.analyticsSubjectId,
    event: 'wardrobe_capsule_recommendation_viewed',
    properties: wardrobeCapsuleRecommendationViewedPropertiesSchema.parse({
      capsule_id: parsed.capsuleId,
      scenario: parsed.scenario,
    }),
  }
}

export function trackWardrobeCapsuleRecommendationSelected(
  event: WardrobeCapsuleRecommendationSelectedEvent
): AnalyticsCapturePayload<
  'wardrobe_capsule_recommendation_selected',
  WardrobeCapsuleRecommendationSelectedProperties
> {
  const parsed = wardrobeCapsuleRecommendationSelectedEventSchema.parse(event)

  return {
    distinctId: parsed.analyticsSubjectId,
    event: 'wardrobe_capsule_recommendation_selected',
    properties: wardrobeCapsuleRecommendationSelectedPropertiesSchema.parse({
      capsule_id: parsed.capsuleId,
      scenario: parsed.scenario,
    }),
  }
}

export function trackWardrobeOnboardingStarted(
  event: WardrobeOnboardingStartedEvent
): AnalyticsCapturePayload<
  'wardrobe_onboarding_started',
  WardrobeOnboardingStartedProperties
> {
  const parsed = wardrobeOnboardingStartedEventSchema.parse(event)

  return {
    distinctId: parsed.analyticsSubjectId,
    event: 'wardrobe_onboarding_started',
    properties: wardrobeOnboardingStartedPropertiesSchema.parse({
      user_id: parsed.analyticsSubjectId,
      timestamp: parsed.timestamp,
    }),
  }
}

export function trackWardrobeOnboardingCompleted(
  event: WardrobeOnboardingCompletedEvent
): AnalyticsCapturePayload<
  'wardrobe_onboarding_completed',
  WardrobeOnboardingCompletedProperties
> {
  const parsed = wardrobeOnboardingCompletedEventSchema.parse(event)

  return {
    distinctId: parsed.analyticsSubjectId,
    event: 'wardrobe_onboarding_completed',
    properties: wardrobeOnboardingCompletedPropertiesSchema.parse({
      user_id: parsed.analyticsSubjectId,
      duration_ms: parsed.durationMs,
      used_starter_wardrobe: parsed.usedStarterWardrobe,
      garment_count: parsed.garmentCount,
      silhouette_mode: parsed.silhouetteMode,
      timestamp: parsed.timestamp,
    }),
  }
}

// --- Story 5.1: affiliate commerce property schemas and wrappers -----------
//
// Every schema below is `.strict()`. That is the enforcement point for the
// story's privacy rule: a caller that tries to attach a URL, a product title, a
// garment id, or a raw user id gets a parse failure at the wrapper rather than a
// silent leak into PostHog. The negative fixtures in
// `packages/api-client/testing/commerce-contract.spec.ts` exercise exactly that.

export const affiliateCtaShownPropertiesSchema = z
  .object({
    partner_id: nonEmptyString.max(128),
    scenario: z.enum(['morning', 'midday', 'evening']),
    surface: z.enum(['mobile_hero']),
    locale_region: z.union([z.literal('*'), z.string().regex(/^[A-Z0-9]{2,3}$/)]),
    recommendation_id: nonEmptyString.max(128),
  })
  .strict()

export type AffiliateCtaShownProperties = z.infer<
  typeof affiliateCtaShownPropertiesSchema
>

export const affiliateCtaClickedPropertiesSchema = z
  .object({
    partner_id: nonEmptyString.max(128),
    offer_id: nonEmptyString.max(128),
    scenario: z.enum(['morning', 'midday', 'evening']),
    // Derived from affiliateSurfaceSchema by import, not hand-copied: a
    // hand-copied enum here is exactly what let Story 5.4's advisor click
    // fail this .strict() parse silently the moment `palette_advisor` was
    // added to the contract enum and not here.
    surface: affiliateSurfaceSchema,
    locale_region: z.union([z.literal('*'), z.string().regex(/^[A-Z0-9]{2,3}$/)]),
    recommendation_id: nonEmptyString.max(128),
  })
  .strict()

export type AffiliateCtaClickedProperties = z.infer<
  typeof affiliateCtaClickedPropertiesSchema
>

export const affiliateConversionRecordedPropertiesSchema = z
  .object({
    partner_id: nonEmptyString.max(128),
    status: z.enum(['pending', 'confirmed', 'reversed']),
    currency: z.string().regex(/^[A-Z]{3}$/),
    order_value_minor_units: z.number().int().min(0),
    matched: z.boolean(),
  })
  .strict()

export type AffiliateConversionRecordedProperties = z.infer<
  typeof affiliateConversionRecordedPropertiesSchema
>

export function trackAffiliateCtaShown(
  event: AffiliateCtaShownEvent,
  distinctId: string
): AnalyticsCapturePayload<'affiliate_cta_shown', AffiliateCtaShownProperties> {
  const parsed = affiliateCtaShownEventSchema.parse(event)

  // The distinctId is passed in rather than read off the event, because this is
  // the one commerce event with no server subject: the mobile analytics client
  // owns its own identity here, matching trackMobileRitualCreated.
  return {
    distinctId,
    event: 'affiliate_cta_shown',
    properties: affiliateCtaShownPropertiesSchema.parse({
      partner_id: parsed.partnerId,
      scenario: parsed.scenario,
      surface: parsed.surface,
      locale_region: parsed.localeRegion,
      recommendation_id: parsed.recommendationId,
    }),
  }
}

export function trackAffiliateCtaClicked(
  event: AffiliateCtaClickedEvent
): AnalyticsCapturePayload<'affiliate_cta_clicked', AffiliateCtaClickedProperties> {
  const parsed = affiliateCtaClickedEventSchema.parse(event)

  return {
    distinctId: parsed.analyticsSubjectId,
    event: 'affiliate_cta_clicked',
    properties: affiliateCtaClickedPropertiesSchema.parse({
      partner_id: parsed.partnerId,
      offer_id: parsed.offerId,
      scenario: parsed.scenario,
      surface: parsed.surface,
      locale_region: parsed.localeRegion,
      recommendation_id: parsed.recommendationId,
    }),
  }
}

export function trackAffiliateConversionRecorded(
  event: AffiliateConversionRecordedEvent
): AnalyticsCapturePayload<
  'affiliate_conversion_recorded',
  AffiliateConversionRecordedProperties
> {
  const parsed = affiliateConversionRecordedEventSchema.parse(event)

  return {
    distinctId: parsed.analyticsSubjectId,
    event: 'affiliate_conversion_recorded',
    properties: affiliateConversionRecordedPropertiesSchema.parse({
      partner_id: parsed.partnerId,
      status: parsed.status,
      currency: parsed.currency,
      order_value_minor_units: parsed.orderValueMinorUnits,
      matched: parsed.matched,
    }),
  }
}

// --- Story 5.2: premium subscription property schemas and wrappers ----------
//
// Every schema below is `.strict()`: a caller that tries to attach a price, a
// receipt id, an email, or a URL gets a parse failure at the wrapper rather
// than a silent leak into PostHog. The negative fixtures in
// `packages/api-client/testing/premium-analytics.spec.ts` exercise exactly that.

export const premiumSubscribeTappedPropertiesSchema = z
  .object({
    plan: premiumPlanAnalyticsEnum,
    surface: premiumSurfaceAnalyticsEnum,
  })
  .strict()

export type PremiumSubscribeTappedProperties = z.infer<
  typeof premiumSubscribeTappedPropertiesSchema
>

export const premiumCheckoutStartedPropertiesSchema = z
  .object({
    plan: premiumPlanAnalyticsEnum,
  })
  .strict()

export type PremiumCheckoutStartedProperties = z.infer<
  typeof premiumCheckoutStartedPropertiesSchema
>

export const premiumEntitlementActivatedPropertiesSchema = z
  .object({
    store: premiumStoreAnalyticsEnum,
    product_id: nonEmptyString.max(128),
  })
  .strict()

export type PremiumEntitlementActivatedProperties = z.infer<
  typeof premiumEntitlementActivatedPropertiesSchema
>

export const premiumEntitlementDeactivatedPropertiesSchema = z
  .object({
    store: premiumStoreAnalyticsEnum,
    product_id: nonEmptyString.max(128),
    reason: premiumDeactivationReasonEnum,
  })
  .strict()

export type PremiumEntitlementDeactivatedProperties = z.infer<
  typeof premiumEntitlementDeactivatedPropertiesSchema
>

// --- Story 5.3: premium theme property schema and wrapper -------------------
//
// The allowlist is one key. A palette choice is a cosmetic preference, so there
// is nothing else about the write worth publishing: no user id, no surface, no
// timestamp of the previous choice, and above all no hex values, which live in
// each app's own styling layer and would make a designer's tweak an analytics
// schema change.

export const premiumThemeSelectedPropertiesSchema = z
  .object({
    theme: premiumThemeAnalyticsEnum.nullable(),
  })
  .strict()

export type PremiumThemeSelectedProperties = z.infer<
  typeof premiumThemeSelectedPropertiesSchema
>

// Story 5.4. Three server-side, pseudonymous properties schemas. No raw hex,
// no confidence score, and no image metadata: see the docblock above the
// event schemas for why.

export const paletteAnalysisCompletedPropertiesSchema = z
  .object({
    source: paletteSourceSchema,
    undertone: skinUndertoneSchema.nullable(),
    depth: skinDepthSchema.nullable(),
    outcome: paletteAnalysisOutcomeAnalyticsEnum,
  })
  .strict()

export type PaletteAnalysisCompletedProperties = z.infer<
  typeof paletteAnalysisCompletedPropertiesSchema
>

export const advisorOfferClickedPropertiesSchema = z
  .object({
    partner_id: nonEmptyString.max(128),
    offer_id: nonEmptyString.max(128),
    advisor_slot: advisorSlotSchema,
    platform: advisorPlatformAnalyticsEnum,
  })
  .strict()

export type AdvisorOfferClickedProperties = z.infer<
  typeof advisorOfferClickedPropertiesSchema
>

export const advisorRecommendationActedPropertiesSchema = z
  .object({
    slot: advisorSlotSchema,
    action: z.enum(['saved', 'dismissed']),
  })
  .strict()

export type AdvisorRecommendationActedProperties = z.infer<
  typeof advisorRecommendationActedPropertiesSchema
>

export const premiumPlannerViewedPropertiesSchema = z
  .object({
    platform: plannerPlatformAnalyticsEnum,
    days_ready: z.number().int().min(0).max(7),
  })
  .strict()

export type PremiumPlannerViewedProperties = z.infer<
  typeof premiumPlannerViewedPropertiesSchema
>

export const premiumPlannerDayReshuffledPropertiesSchema = z
  .object({
    platform: plannerPlatformAnalyticsEnum,
    day_offset: z.number().int().min(0).max(6),
    unchanged: z.boolean(),
  })
  .strict()

export type PremiumPlannerDayReshuffledProperties = z.infer<
  typeof premiumPlannerDayReshuffledPropertiesSchema
>

export const communityFeedViewedPropertiesSchema = z
  .object({
    platform: communityPlatformSchema,
    dedupe_key: nonEmptyString,
    climate_band: climateBandSchema.nullable(),
    band_resolved: z.boolean(),
    filter_mode: communityFeedModeSchema,
    experiment_variant: communityExperimentVariantSchema,
    item_count: z.number().int().min(0),
    is_empty: z.boolean(),
  })
  .strict()

export type CommunityFeedViewedProperties = z.infer<
  typeof communityFeedViewedPropertiesSchema
>

export const communityCardOpenedPropertiesSchema = z
  .object({
    platform: communityPlatformSchema,
    dedupe_key: nonEmptyString,
    climate_band: climateBandSchema.nullable(),
    is_self: z.boolean(),
    experiment_variant: communityExperimentVariantSchema,
  })
  .strict()

export type CommunityCardOpenedProperties = z.infer<
  typeof communityCardOpenedPropertiesSchema
>

export const communityPostAllocatedPropertiesSchema = z
  .object({
    platform: communityPlatformSchema,
    dedupe_key: nonEmptyString,
    replayed: z.boolean(),
  })
  .strict()

export type CommunityPostAllocatedProperties = z.infer<
  typeof communityPostAllocatedPropertiesSchema
>

export const communityPostSubmittedPropertiesSchema = z
  .object({
    platform: communityPlatformSchema,
    dedupe_key: nonEmptyString,
    climate_band: climateBandSchema.nullable(),
    has_caption: z.boolean(),
    has_challenge: z.boolean(),
  })
  .strict()

export type CommunityPostSubmittedProperties = z.infer<
  typeof communityPostSubmittedPropertiesSchema
>

export const communityPostPublishedPropertiesSchema = z
  .object({
    platform: communityPlatformSchema,
    dedupe_key: nonEmptyString,
    climate_band: climateBandSchema.nullable(),
  })
  .strict()

export type CommunityPostPublishedProperties = z.infer<
  typeof communityPostPublishedPropertiesSchema
>

export const communityPostReportedPropertiesSchema = z
  .object({
    platform: communityPlatformSchema,
    dedupe_key: nonEmptyString,
    reason: communityReportReasonSchema,
  })
  .strict()

export type CommunityPostReportedProperties = z.infer<
  typeof communityPostReportedPropertiesSchema
>

export const communityPostWithdrawnPropertiesSchema = z
  .object({
    platform: communityPlatformSchema,
    dedupe_key: nonEmptyString,
    climate_band: climateBandSchema.nullable(),
  })
  .strict()

export type CommunityPostWithdrawnProperties = z.infer<
  typeof communityPostWithdrawnPropertiesSchema
>

export const communityChallengeParticipatedPropertiesSchema = z
  .object({
    platform: communityPlatformSchema,
    dedupe_key: nonEmptyString,
    climate_band: climateBandSchema.nullable(),
  })
  .strict()

export type CommunityChallengeParticipatedProperties = z.infer<
  typeof communityChallengeParticipatedPropertiesSchema
>

export function trackPremiumSubscribeTapped(
  event: PremiumSubscribeTappedEvent,
  distinctId: string
): AnalyticsCapturePayload<'premium_subscribe_tapped', PremiumSubscribeTappedProperties> {
  const parsed = premiumSubscribeTappedEventSchema.parse(event)

  // The distinctId is passed in rather than read off the event: this is the one
  // premium event with no server subject, matching trackAffiliateCtaShown.
  return {
    distinctId,
    event: 'premium_subscribe_tapped',
    properties: premiumSubscribeTappedPropertiesSchema.parse({
      plan: parsed.plan,
      surface: parsed.surface,
    }),
  }
}

export function trackPremiumCheckoutStarted(
  event: PremiumCheckoutStartedEvent
): AnalyticsCapturePayload<'premium_checkout_started', PremiumCheckoutStartedProperties> {
  const parsed = premiumCheckoutStartedEventSchema.parse(event)

  return {
    distinctId: parsed.analyticsSubjectId,
    event: 'premium_checkout_started',
    properties: premiumCheckoutStartedPropertiesSchema.parse({
      plan: parsed.plan,
    }),
  }
}

export function trackPremiumEntitlementActivated(
  event: PremiumEntitlementActivatedEvent
): AnalyticsCapturePayload<
  'premium_entitlement_activated',
  PremiumEntitlementActivatedProperties
> {
  const parsed = premiumEntitlementActivatedEventSchema.parse(event)

  return {
    distinctId: parsed.analyticsSubjectId,
    event: 'premium_entitlement_activated',
    properties: premiumEntitlementActivatedPropertiesSchema.parse({
      store: parsed.store,
      product_id: parsed.productId,
    }),
  }
}

export function trackPremiumEntitlementDeactivated(
  event: PremiumEntitlementDeactivatedEvent
): AnalyticsCapturePayload<
  'premium_entitlement_deactivated',
  PremiumEntitlementDeactivatedProperties
> {
  const parsed = premiumEntitlementDeactivatedEventSchema.parse(event)

  return {
    distinctId: parsed.analyticsSubjectId,
    event: 'premium_entitlement_deactivated',
    properties: premiumEntitlementDeactivatedPropertiesSchema.parse({
      store: parsed.store,
      product_id: parsed.productId,
      reason: parsed.reason,
    }),
  }
}

export function trackPremiumThemeSelected(
  event: PremiumThemeSelectedEvent
): AnalyticsCapturePayload<'premium_theme_selected', PremiumThemeSelectedProperties> {
  const parsed = premiumThemeSelectedEventSchema.parse(event)

  return {
    distinctId: parsed.analyticsSubjectId,
    event: 'premium_theme_selected',
    properties: premiumThemeSelectedPropertiesSchema.parse({
      theme: parsed.theme,
    }),
  }
}

export function trackPaletteAnalysisCompleted(
  event: PaletteAnalysisCompletedEvent
): AnalyticsCapturePayload<
  'palette_analysis_completed',
  PaletteAnalysisCompletedProperties
> {
  const parsed = paletteAnalysisCompletedEventSchema.parse(event)

  return {
    distinctId: parsed.analyticsSubjectId,
    event: 'palette_analysis_completed',
    properties: paletteAnalysisCompletedPropertiesSchema.parse({
      source: parsed.source,
      undertone: parsed.undertone,
      depth: parsed.depth,
      outcome: parsed.outcome,
    }),
  }
}

export function trackAdvisorOfferClicked(
  event: AdvisorOfferClickedEvent
): AnalyticsCapturePayload<'advisor_offer_clicked', AdvisorOfferClickedProperties> {
  const parsed = advisorOfferClickedEventSchema.parse(event)

  return {
    distinctId: parsed.analyticsSubjectId,
    event: 'advisor_offer_clicked',
    properties: advisorOfferClickedPropertiesSchema.parse({
      partner_id: parsed.partnerId,
      offer_id: parsed.offerId,
      advisor_slot: parsed.advisorSlot,
      platform: parsed.platform,
    }),
  }
}

export function trackAdvisorRecommendationActed(
  event: AdvisorRecommendationActedEvent
): AnalyticsCapturePayload<
  'advisor_recommendation_acted',
  AdvisorRecommendationActedProperties
> {
  const parsed = advisorRecommendationActedEventSchema.parse(event)

  return {
    distinctId: parsed.analyticsSubjectId,
    event: 'advisor_recommendation_acted',
    properties: advisorRecommendationActedPropertiesSchema.parse({
      slot: parsed.slot,
      action: parsed.action,
    }),
  }
}

export function trackPremiumPlannerViewed(
  event: PremiumPlannerViewedEvent
): AnalyticsCapturePayload<'premium_planner_viewed', PremiumPlannerViewedProperties> {
  const parsed = premiumPlannerViewedEventSchema.parse(event)

  return {
    distinctId: parsed.analyticsSubjectId,
    event: 'premium_planner_viewed',
    properties: premiumPlannerViewedPropertiesSchema.parse({
      platform: parsed.platform,
      days_ready: parsed.daysReady,
    }),
  }
}

export function trackPremiumPlannerDayReshuffled(
  event: PremiumPlannerDayReshuffledEvent
): AnalyticsCapturePayload<
  'premium_planner_day_reshuffled',
  PremiumPlannerDayReshuffledProperties
> {
  const parsed = premiumPlannerDayReshuffledEventSchema.parse(event)

  return {
    distinctId: parsed.analyticsSubjectId,
    event: 'premium_planner_day_reshuffled',
    properties: premiumPlannerDayReshuffledPropertiesSchema.parse({
      platform: parsed.platform,
      day_offset: parsed.dayOffset,
      unchanged: parsed.unchanged,
    }),
  }
}

export function trackCommunityFeedViewed(
  event: CommunityFeedViewedEvent
): AnalyticsCapturePayload<'community_feed_viewed', CommunityFeedViewedProperties> {
  const parsed = communityFeedViewedEventSchema.parse(event)

  return {
    distinctId: parsed.analyticsSubjectId,
    event: 'community_feed_viewed',
    properties: communityFeedViewedPropertiesSchema.parse({
      platform: parsed.platform,
      dedupe_key: parsed.dedupeKey,
      climate_band: parsed.climateBand,
      band_resolved: parsed.bandResolved,
      filter_mode: parsed.filterMode,
      experiment_variant: parsed.experimentVariant,
      item_count: parsed.itemCount,
      is_empty: parsed.isEmpty,
    }),
  }
}

export function trackCommunityCardOpened(
  event: CommunityCardOpenedEvent
): AnalyticsCapturePayload<'community_card_opened', CommunityCardOpenedProperties> {
  const parsed = communityCardOpenedEventSchema.parse(event)

  return {
    distinctId: parsed.analyticsSubjectId,
    event: 'community_card_opened',
    properties: communityCardOpenedPropertiesSchema.parse({
      platform: parsed.platform,
      dedupe_key: parsed.dedupeKey,
      climate_band: parsed.climateBand,
      is_self: parsed.isSelf,
      experiment_variant: parsed.experimentVariant,
    }),
  }
}

export function trackCommunityPostAllocated(
  event: CommunityPostAllocatedEvent
): AnalyticsCapturePayload<'community_post_allocated', CommunityPostAllocatedProperties> {
  const parsed = communityPostAllocatedEventSchema.parse(event)

  return {
    distinctId: parsed.analyticsSubjectId,
    event: 'community_post_allocated',
    properties: communityPostAllocatedPropertiesSchema.parse({
      platform: parsed.platform,
      dedupe_key: parsed.dedupeKey,
      replayed: parsed.replayed,
    }),
  }
}

export function trackCommunityPostSubmitted(
  event: CommunityPostSubmittedEvent
): AnalyticsCapturePayload<'community_post_submitted', CommunityPostSubmittedProperties> {
  const parsed = communityPostSubmittedEventSchema.parse(event)

  return {
    distinctId: parsed.analyticsSubjectId,
    event: 'community_post_submitted',
    properties: communityPostSubmittedPropertiesSchema.parse({
      platform: parsed.platform,
      dedupe_key: parsed.dedupeKey,
      climate_band: parsed.climateBand,
      has_caption: parsed.hasCaption,
      has_challenge: parsed.hasChallenge,
    }),
  }
}

export function trackCommunityPostPublished(
  event: CommunityPostPublishedEvent
): AnalyticsCapturePayload<'community_post_published', CommunityPostPublishedProperties> {
  const parsed = communityPostPublishedEventSchema.parse(event)

  return {
    distinctId: parsed.analyticsSubjectId,
    event: 'community_post_published',
    properties: communityPostPublishedPropertiesSchema.parse({
      platform: parsed.platform,
      dedupe_key: parsed.dedupeKey,
      climate_band: parsed.climateBand,
    }),
  }
}

export function trackCommunityPostReported(
  event: CommunityPostReportedEvent
): AnalyticsCapturePayload<'community_post_reported', CommunityPostReportedProperties> {
  const parsed = communityPostReportedEventSchema.parse(event)

  return {
    distinctId: parsed.analyticsSubjectId,
    event: 'community_post_reported',
    properties: communityPostReportedPropertiesSchema.parse({
      platform: parsed.platform,
      dedupe_key: parsed.dedupeKey,
      reason: parsed.reason,
    }),
  }
}

export function trackCommunityPostWithdrawn(
  event: CommunityPostWithdrawnEvent
): AnalyticsCapturePayload<'community_post_withdrawn', CommunityPostWithdrawnProperties> {
  const parsed = communityPostWithdrawnEventSchema.parse(event)

  return {
    distinctId: parsed.analyticsSubjectId,
    event: 'community_post_withdrawn',
    properties: communityPostWithdrawnPropertiesSchema.parse({
      platform: parsed.platform,
      dedupe_key: parsed.dedupeKey,
      climate_band: parsed.climateBand,
    }),
  }
}

export function trackCommunityChallengeParticipated(
  event: CommunityChallengeParticipatedEvent
): AnalyticsCapturePayload<
  'community_challenge_participated',
  CommunityChallengeParticipatedProperties
> {
  const parsed = communityChallengeParticipatedEventSchema.parse(event)

  return {
    distinctId: parsed.analyticsSubjectId,
    event: 'community_challenge_participated',
    properties: communityChallengeParticipatedPropertiesSchema.parse({
      platform: parsed.platform,
      dedupe_key: parsed.dedupeKey,
      climate_band: parsed.climateBand,
    }),
  }
}
