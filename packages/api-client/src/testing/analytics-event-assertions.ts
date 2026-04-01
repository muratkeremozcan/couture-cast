import {
  alertReceivedPropertiesSchema,
  analyticsEventNameSchema,
  guardianConsentGrantedPropertiesSchema,
  moderationActionPropertiesSchema,
  ritualCreatedPropertiesSchema,
  wardrobeUploadStartedPropertiesSchema,
  type AnalyticsEventName,
} from '../types/analytics-events'

export type MemoryTrackedAnalyticsEvent = {
  distinctId?: string
  event: string
  properties?: Record<string, unknown>
}

type EventExpectationOptions = {
  afterIndex?: number
  count?: number
}

type ExpectLike = ((
  actual: unknown,
  message?: string
) => {
  toBe(expected: unknown): void
  toBeGreaterThan(expected: number): void
  toEqual(expected: unknown): void
  toHaveLength(expected: number): void
}) & {
  objectContaining(expected: Record<string, unknown>): unknown
}

const analyticsPropertySchemas = {
  ritual_created: ritualCreatedPropertiesSchema,
  wardrobe_upload_started: wardrobeUploadStartedPropertiesSchema,
  alert_received: alertReceivedPropertiesSchema,
  moderation_action: moderationActionPropertiesSchema,
  guardian_consent_granted: guardianConsentGrantedPropertiesSchema,
}

const formatCapturedEvents = (events: readonly MemoryTrackedAnalyticsEvent[]) =>
  events.map(({ event }) => event).join(', ')

export function createAnalyticsEventExpectations(
  events: readonly MemoryTrackedAnalyticsEvent[],
  expectLike: ExpectLike
) {
  return {
    createCursor() {
      return events.length
    },

    expectEventTracked(
      eventName: AnalyticsEventName,
      properties: Record<string, unknown> = {},
      options: EventExpectationOptions = {}
    ) {
      const normalizedEventName = analyticsEventNameSchema.parse(eventName)
      const scopedEvents =
        options.afterIndex === undefined ? events : events.slice(options.afterIndex)
      const matchingEvents = scopedEvents.filter(
        (event) => event.event === normalizedEventName
      )

      if (options.count !== undefined) {
        expectLike(
          matchingEvents,
          `Expected ${options.count} "${normalizedEventName}" event(s) after cursor ${options.afterIndex ?? 0}. Captured: ${formatCapturedEvents(scopedEvents)}`
        ).toHaveLength(options.count)
      } else {
        expectLike(
          matchingEvents.length,
          `Expected analytics event "${normalizedEventName}" to be tracked. Captured: ${formatCapturedEvents(scopedEvents)}`
        ).toBeGreaterThan(0)
      }

      const trackedEvent = matchingEvents.at(-1)
      const parsedProperties = analyticsPropertySchemas[normalizedEventName].safeParse(
        trackedEvent?.properties ?? {}
      )

      expectLike(
        parsedProperties.success,
        parsedProperties.success ? undefined : parsedProperties.error.message
      ).toBe(true)
      expectLike(trackedEvent?.properties ?? {}).toEqual(
        expectLike.objectContaining(properties)
      )

      return trackedEvent as MemoryTrackedAnalyticsEvent
    },
  }
}
