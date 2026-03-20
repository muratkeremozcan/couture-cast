import { expect } from 'vitest'
import {
  alertReceivedPropertiesSchema,
  analyticsEventNameSchema,
  guardianConsentGrantedPropertiesSchema,
  moderationActionPropertiesSchema,
  ritualCreatedPropertiesSchema,
  wardrobeUploadStartedPropertiesSchema,
  type AnalyticsEventName,
} from '../src/types/analytics-events'

export type MemoryTrackedAnalyticsEvent = {
  distinctId?: string
  event: string
  properties?: Record<string, unknown>
}

type EventExpectationOptions = {
  afterIndex?: number
  count?: number
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
  events: readonly MemoryTrackedAnalyticsEvent[]
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
        expect(
          matchingEvents,
          `Expected ${options.count} "${normalizedEventName}" event(s) after cursor ${options.afterIndex ?? 0}. Captured: ${formatCapturedEvents(scopedEvents)}`
        ).toHaveLength(options.count)
      } else {
        expect(
          matchingEvents.length,
          `Expected analytics event "${normalizedEventName}" to be tracked. Captured: ${formatCapturedEvents(scopedEvents)}`
        ).toBeGreaterThan(0)
      }

      const trackedEvent = matchingEvents.at(-1)
      const parsedProperties = analyticsPropertySchemas[normalizedEventName].safeParse(
        trackedEvent?.properties ?? {}
      )

      expect(
        parsedProperties.success,
        parsedProperties.success ? undefined : parsedProperties.error.message
      ).toBe(true)
      expect(trackedEvent?.properties ?? {}).toEqual(expect.objectContaining(properties))

      return trackedEvent as MemoryTrackedAnalyticsEvent
    },
  }
}
