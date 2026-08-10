import { z } from 'zod'

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
