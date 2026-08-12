// Learning path Step 18: Telemetry and audit baseline.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-18-telemetry-and-audit-baseline
// Learning path Step 8: Shared analytics contracts and event tracking.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-8-shared-analytics-contracts-and-event-tracking
// Learning path Step 29: Garment capture flow.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-29-garment-capture-flow
// Learning path Step 30: Smart tagging and comfort metadata.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-30-smart-tagging-and-comfort-metadata
import { describe, expect, it } from 'vitest'
import {
  analyticsEventNameSchema,
  analyticsEventSchemas,
  garmentTaggingCompletedEventSchema,
  garmentTaggingCompletedPropertiesSchema,
  trackAlertReceived,
  trackAlertSent,
  trackApiErrorOccurred,
  trackFirstOutfitGenerated,
  trackForecastViewed,
  trackGarmentTaggingCompleted,
  trackGarmentUploadCompleted,
  trackGuardianConsentGranted,
  trackLocaleSwitched,
  trackLocationSwitched,
  trackModerationAction,
  trackProfileCompleted,
  trackRitualCreated,
  trackWardrobeUploadStarted,
} from '../src/types/analytics-events'

const TIMESTAMP = '2026-08-09T12:00:00.000Z'

/*
 * Typed from the function's own parameter rather than `as const`: the const
 * assertion made `overrideFields` a readonly tuple, which is not assignable
 * to the mutable array the event builder accepts.
 */
const validTaggingEvent: Parameters<typeof trackGarmentTaggingCompleted>[0] = {
  analyticsSubjectId: 'owner-1',
  garmentId: 'garment-1',
  suggestedCategory: 'top',
  confirmedCategory: 'top',
  suggestedMaterial: 'cotton',
  confirmedMaterial: 'wool',
  suggestedComfortRange: 'mild',
  confirmedComfortRange: 'cool',
  suggestionAvailable: true,
  analysisVersion: 'fashion-clip:prompts-v1',
  wasOverridden: true,
  overrideFields: ['material', 'comfort_range'],
}

describe('analytics event registry', () => {
  // The name enum and the schema map are two hand-maintained lists. Drift
  // between them means an event can be captured with no validated shape.
  it('keeps the canonical event names and the schema map in lockstep', () => {
    expect(Object.keys(analyticsEventSchemas).sort()).toEqual(
      [...analyticsEventNameSchema.options].sort()
    )
  })

  it('rejects an event name that is not in the canonical enum', () => {
    expect(analyticsEventNameSchema.safeParse('wardrobe_upload_finished').success).toBe(
      false
    )
  })
})

describe('analytics tracking wrappers', () => {
  it('normalizes ritual_created input to snake_case provider properties', () => {
    expect(
      trackRitualCreated({
        userId: 'user-1',
        locationId: 'loc-1',
        timestamp: TIMESTAMP,
        ritualType: 'morning',
        weatherContext: 'rain',
      })
    ).toEqual({
      distinctId: 'user-1',
      event: 'ritual_created',
      properties: {
        user_id: 'user-1',
        location_id: 'loc-1',
        timestamp: TIMESTAMP,
        ritual_type: 'morning',
        weather_context: 'rain',
      },
    })
  })

  // Absent optionals must stay absent rather than acquiring an invented
  // default, otherwise a ritual with no declared type would be reported as one.
  it('leaves absent optional ritual_created properties undefined', () => {
    const payload = trackRitualCreated({
      userId: 'user-1',
      locationId: 'loc-1',
      timestamp: TIMESTAMP,
    })

    expect(payload.properties.ritual_type).toBeUndefined()
    expect(payload.properties.weather_context).toBeUndefined()
    expect(
      Object.keys(
        JSON.parse(JSON.stringify(payload.properties)) as Record<string, unknown>
      ).sort()
    ).toEqual(['location_id', 'timestamp', 'user_id'])
  })

  it('normalizes wardrobe_upload_started input', () => {
    expect(
      trackWardrobeUploadStarted({
        userId: 'user-1',
        itemId: 'item-1',
        fileSize: 2048,
        timestamp: TIMESTAMP,
        itemCount: 3,
        uploadSource: 'camera',
      })
    ).toEqual({
      distinctId: 'user-1',
      event: 'wardrobe_upload_started',
      properties: {
        user_id: 'user-1',
        item_id: 'item-1',
        file_size: 2048,
        timestamp: TIMESTAMP,
        item_count: 3,
        upload_source: 'camera',
      },
    })
  })

  it('normalizes alert_received input', () => {
    expect(
      trackAlertReceived({
        userId: 'user-1',
        alertType: 'severe',
        severity: 'critical',
        timestamp: TIMESTAMP,
        weatherSeverity: 'high',
      })
    ).toEqual({
      distinctId: 'user-1',
      event: 'alert_received',
      properties: {
        user_id: 'user-1',
        alert_type: 'severe',
        severity: 'critical',
        timestamp: TIMESTAMP,
        weather_severity: 'high',
      },
    })
  })

  // moderation_action is the one event keyed on the moderator rather than the
  // subject, so the distinctId choice is the behavior worth pinning.
  it('attributes moderation_action to the moderator, not the target', () => {
    const payload = trackModerationAction({
      moderatorId: 'moderator-9',
      targetId: 'post-3',
      action: 'remove',
      reason: 'policy_violation',
      timestamp: TIMESTAMP,
      contentType: 'lookbook_post',
    })

    expect(payload.distinctId).toBe('moderator-9')
    expect(payload.properties).toEqual({
      moderator_id: 'moderator-9',
      target_id: 'post-3',
      action: 'remove',
      reason: 'policy_violation',
      timestamp: TIMESTAMP,
      content_type: 'lookbook_post',
    })
  })

  // The provider shape carries consent_timestamp as well; it is derived from
  // the single inbound timestamp rather than accepted separately.
  it('derives consent_timestamp from the guardian_consent_granted timestamp', () => {
    const payload = trackGuardianConsentGranted({
      guardianId: 'guardian-1',
      teenId: 'teen-1',
      consentLevel: 'full',
      timestamp: TIMESTAMP,
    })

    expect(payload.distinctId).toBe('guardian-1')
    expect(payload.properties.consent_timestamp).toBe(TIMESTAMP)
    expect(payload.properties.timestamp).toBe(TIMESTAMP)
  })

  it('normalizes profile_completed and first_outfit_generated activation events', () => {
    expect(
      trackProfileCompleted({
        userId: 'user-1',
        age: 15,
        guardianConsentRequired: true,
        timestamp: TIMESTAMP,
      }).properties
    ).toEqual({
      user_id: 'user-1',
      age: 15,
      guardian_consent_required: true,
      timestamp: TIMESTAMP,
    })

    expect(
      trackFirstOutfitGenerated({
        userId: 'user-1',
        locationId: 'loc-1',
        timestamp: TIMESTAMP,
        isFirstOutfit: true,
      }).properties
    ).toEqual({
      user_id: 'user-1',
      location_id: 'loc-1',
      timestamp: TIMESTAMP,
      is_first_outfit: true,
    })
  })

  it('normalizes forecast_viewed input', () => {
    expect(
      trackForecastViewed({
        userId: 'user-1',
        locationKey: 'new-york-ny',
        status: 'cached',
        timestamp: TIMESTAMP,
      }).properties
    ).toEqual({
      user_id: 'user-1',
      location_key: 'new-york-ny',
      status: 'cached',
      timestamp: TIMESTAMP,
    })
  })

  it('normalizes alert_sent input and keeps the delivery channel', () => {
    expect(
      trackAlertSent({
        userId: 'user-1',
        alertType: 'severe',
        severity: 'warning',
        channel: 'push',
        timestamp: TIMESTAMP,
      }).properties
    ).toEqual({
      user_id: 'user-1',
      alert_type: 'severe',
      severity: 'warning',
      channel: 'push',
      timestamp: TIMESTAMP,
    })
  })

  // A first-ever location selection has no previous location; null must survive
  // normalization rather than being dropped as an absent optional.
  it('preserves a null from_location on the first location switch', () => {
    expect(
      trackLocationSwitched({
        userId: 'user-1',
        fromLocation: null,
        toLocation: 'chicago-il',
        timestamp: TIMESTAMP,
      }).properties
    ).toEqual({
      user_id: 'user-1',
      from_location: null,
      to_location: 'chicago-il',
      timestamp: TIMESTAMP,
    })
  })

  it('normalizes locale_switched input', () => {
    expect(
      trackLocaleSwitched({
        userId: 'user-1',
        fromLocale: 'en-US',
        toLocale: 'tr-TR',
        timestamp: TIMESTAMP,
      }).properties
    ).toEqual({
      user_id: 'user-1',
      from_locale: 'en-US',
      to_locale: 'tr-TR',
      timestamp: TIMESTAMP,
    })
  })

  // API errors are reported from unauthenticated routes too, so the wrapper has
  // to produce a usable distinctId without inventing a user identity.
  it('falls back to an anonymous distinctId for unauthenticated api_error_occurred', () => {
    const payload = trackApiErrorOccurred({
      userId: null,
      route: '/api/v1/ritual',
      method: 'GET',
      statusCode: 500,
      errorCode: 'INTERNAL_SERVER_ERROR',
      timestamp: TIMESTAMP,
    })

    expect(payload.distinctId).toBe('anonymous')
    expect(payload.properties.user_id).toBeNull()
  })

  it('uses the authenticated user id for api_error_occurred when present', () => {
    expect(
      trackApiErrorOccurred({
        userId: 'user-1',
        route: '/api/v1/ritual',
        method: 'GET',
        statusCode: 403,
        errorCode: 'FORBIDDEN',
        timestamp: TIMESTAMP,
      }).distinctId
    ).toBe('user-1')
  })

  // The garment upload event carries analyticsSubjectId inbound but must not
  // leak it into the provider property bag; only the garment id goes out.
  it('keeps the analytics subject out of garment_upload_completed properties', () => {
    const payload = trackGarmentUploadCompleted({
      analyticsSubjectId: 'owner-1',
      garmentId: 'garment-1',
      fileSizeBytes: 2048,
      mimeType: 'image/webp',
      hasCropping: true,
      hasBgCleanup: false,
      durationMs: 1200,
    })

    expect(payload.distinctId).toBe('owner-1')
    expect(Object.keys(payload.properties)).not.toContain('analytics_subject_id')
    expect(payload.properties).toEqual({
      garment_id: 'garment-1',
      file_size_bytes: 2048,
      mime_type: 'image/webp',
      has_cropping: true,
      has_bg_cleanup: false,
      duration_ms: 1200,
    })
  })

  it('normalizes garment_tagging_completed suggestion and override fields', () => {
    const payload = trackGarmentTaggingCompleted(validTaggingEvent)

    expect(payload.distinctId).toBe('owner-1')
    expect(payload.properties).toEqual({
      garment_id: 'garment-1',
      suggested_category: 'top',
      confirmed_category: 'top',
      suggested_material: 'cotton',
      confirmed_material: 'wool',
      suggested_comfort_range: 'mild',
      confirmed_comfort_range: 'cool',
      suggestion_available: true,
      analysis_version: 'fashion-clip:prompts-v1',
      was_overridden: true,
      override_fields: ['material', 'comfort_range'],
    })
  })

  it('keeps null suggestions when no tagging inference was available', () => {
    const payload = trackGarmentTaggingCompleted({
      ...validTaggingEvent,
      suggestedCategory: null,
      suggestedMaterial: null,
      suggestedComfortRange: null,
      confirmedMaterial: null,
      suggestionAvailable: false,
      analysisVersion: null,
      wasOverridden: false,
      overrideFields: [],
    })

    expect(payload.properties.suggested_category).toBeNull()
    expect(payload.properties.analysis_version).toBeNull()
    expect(payload.properties.override_fields).toEqual([])
  })
})

describe('garment_tagging_completed invariants', () => {
  // wasOverridden and overrideFields are two representations of the same fact.
  // Allowing them to disagree would make override-rate metrics meaningless.
  it('rejects wasOverridden without any override field', () => {
    const result = garmentTaggingCompletedEventSchema.safeParse({
      ...validTaggingEvent,
      wasOverridden: true,
      overrideFields: [],
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.path.join('.'))).toContain(
        'overrideFields'
      )
    }
  })

  it('rejects was_overridden without any override field on the provider shape', () => {
    const result = garmentTaggingCompletedPropertiesSchema.safeParse({
      garment_id: 'garment-1',
      suggested_category: 'top',
      confirmed_category: 'top',
      suggested_material: 'cotton',
      confirmed_material: 'wool',
      suggested_comfort_range: 'mild',
      confirmed_comfort_range: 'cool',
      suggestion_available: true,
      analysis_version: 'fashion-clip:prompts-v1',
      was_overridden: true,
      override_fields: [],
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.path.join('.'))).toContain(
        'override_fields'
      )
    }
  })

  // A repeated field would double-count that field in override analytics.
  it('rejects duplicate override fields', () => {
    const result = garmentTaggingCompletedEventSchema.safeParse({
      ...validTaggingEvent,
      overrideFields: ['category', 'category'],
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.message)).toContain(
        'override fields must be unique'
      )
    }
  })

  it('accepts all three override fields at once', () => {
    expect(
      garmentTaggingCompletedEventSchema.safeParse({
        ...validTaggingEvent,
        overrideFields: ['category', 'material', 'comfort_range'],
      }).success
    ).toBe(true)
  })

  it('rejects an override field outside the declared enum', () => {
    expect(
      garmentTaggingCompletedEventSchema.safeParse({
        ...validTaggingEvent,
        overrideFields: ['brand'],
      }).success
    ).toBe(false)
  })
})

describe('analytics wrapper input validation', () => {
  // The wrappers parse before normalizing, so bad input must throw at the call
  // site rather than reaching the provider as a malformed capture.
  it('throws on an empty identifier', () => {
    expect(() =>
      trackRitualCreated({ userId: '', locationId: 'loc-1', timestamp: TIMESTAMP })
    ).toThrow()
  })

  it('throws on a non-ISO timestamp', () => {
    expect(() =>
      trackForecastViewed({
        userId: 'user-1',
        locationKey: 'new-york-ny',
        status: 'fresh',
        timestamp: '2026-08-09 12:00:00',
      })
    ).toThrow()
  })

  it('throws on a non-positive upload file size', () => {
    expect(() =>
      trackWardrobeUploadStarted({
        userId: 'user-1',
        itemId: 'item-1',
        fileSize: 0,
        timestamp: TIMESTAMP,
      })
    ).toThrow()
  })

  it('throws on an upload larger than the ten megabyte ceiling', () => {
    expect(() =>
      trackGarmentUploadCompleted({
        analyticsSubjectId: 'owner-1',
        garmentId: 'garment-1',
        fileSizeBytes: 10_485_761,
        mimeType: 'image/png',
        hasCropping: false,
        hasBgCleanup: false,
        durationMs: 10,
      })
    ).toThrow()
  })

  it('throws on a delivery channel outside the declared enum', () => {
    expect(() =>
      trackAlertSent({
        userId: 'user-1',
        alertType: 'severe',
        severity: 'warning',
        // @ts-expect-error email is not a supported alert delivery channel
        channel: 'email',
        timestamp: TIMESTAMP,
      })
    ).toThrow()
  })
})
