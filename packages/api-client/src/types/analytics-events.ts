import { z } from 'zod'

/** Story 0.7 owner file: analytics contracts + tracking wrappers.
 * Analytics contract here = canonical event name + validated input shape + provider property shape.
 * Tracking wrapper here = track* helper that validates and returns a capture-ready payload.
 * Problems solved: schema drift across apps, inconsistent event/property naming, weak observability from split metrics.
 * Why typed contracts: compile-time event safety plus runtime validation at the analytics boundary.
 * Alternatives: direct untyped posthog.capture calls, ingest-only JSON Schema validation, or Protobuf/Avro contracts.
 * Ownership anchors:
 * - Story 0.7 Task 2 step 1 owner: define canonical event names and input/property schemas.
 * - Story 0.7 Task 2 step 2 owner: normalize domain inputs to snake_case analytics properties in track* wrappers.
 * - Story 0.7 Task 3 step 1 owner: publish shared track* wrappers for app-layer reuse and integration assertions.
 * Flow refs:
 * - S0.7/T3/1: mobile, web, and API call sites import these wrappers instead of inventing local payload shapes.
 */
const isoTimestamp = z.string().datetime()
const nonEmptyString = z.string().min(1)

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
