import { z } from 'zod'

const isoTimestamp = z.string().datetime()
const nonEmptyString = z.string().min(1)

export const analyticsEventNameSchema = z.enum([
  'ritual_created',
  'wardrobe_upload_started',
  'alert_received',
  'moderation_action',
  'guardian_consent_granted',
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

export const analyticsEventSchemas = {
  ritual_created: ritualCreatedEventSchema,
  wardrobe_upload_started: wardrobeUploadStartedEventSchema,
  alert_received: alertReceivedEventSchema,
  moderation_action: moderationActionEventSchema,
  guardian_consent_granted: guardianConsentGrantedEventSchema,
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
