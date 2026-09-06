// Story 6.1 matrix row "Analytics": closed-enum, exactly-once events that record
// no sensitive payload.
import { describe, expect, it } from 'vitest'
import {
  analyticsEventNameSchema,
  analyticsEventSchemas,
  communityCardOpenedPropertiesSchema,
  communityFeedViewedPropertiesSchema,
  trackCommunityCardOpened,
  trackCommunityChallengeParticipated,
  trackCommunityFeedViewed,
  trackCommunityPostAllocated,
  trackCommunityPostPublished,
  trackCommunityPostReported,
  trackCommunityPostSubmitted,
  trackCommunityPostWithdrawn,
  type AnalyticsEventName,
} from '../src/types/analytics-events'
import { analyticsPropertySchemas } from '../src/testing/analytics-event-assertions'

const SUBJECT = 'hmac-subject-1'

type CommunityEventName = Extract<AnalyticsEventName, `community_${string}`>

type TrackedPayload = {
  distinctId: string
  event: string
  properties: Record<string, unknown>
}

type CommunityEventCase = {
  name: CommunityEventName
  build: () => TrackedPayload
  properties: Record<string, unknown>
}

/**
 * The eight events this story owns, each paired with the exact property bag its
 * wrapper is expected to emit. Driving every shared assertion off this one table
 * is deliberate: a ninth community event added to the enum without a row here
 * fails the closure test below rather than shipping unasserted.
 */
const communityEventCases: CommunityEventCase[] = [
  {
    name: 'community_feed_viewed',
    build: () =>
      trackCommunityFeedViewed({
        analyticsSubjectId: SUBJECT,
        platform: 'web',
        dedupeKey: 'feed:hmac-subject-1:page-0',
        climateBand: 'temperate_dry',
        bandResolved: true,
        filterMode: 'auto',
        experimentVariant: 'auto',
        itemCount: 12,
        isEmpty: false,
      }),
    properties: {
      platform: 'web',
      dedupe_key: 'feed:hmac-subject-1:page-0',
      climate_band: 'temperate_dry',
      band_resolved: true,
      filter_mode: 'auto',
      experiment_variant: 'auto',
      item_count: 12,
      is_empty: false,
    },
  },
  {
    name: 'community_card_opened',
    build: () =>
      trackCommunityCardOpened({
        analyticsSubjectId: SUBJECT,
        platform: 'mobile',
        dedupeKey: 'card:hmac-subject-1:post-1',
        climateBand: 'cold_wet',
        isSelf: false,
        experimentVariant: 'all',
      }),
    properties: {
      platform: 'mobile',
      dedupe_key: 'card:hmac-subject-1:post-1',
      climate_band: 'cold_wet',
      is_self: false,
      experiment_variant: 'all',
    },
  },
  {
    name: 'community_post_allocated',
    build: () =>
      trackCommunityPostAllocated({
        analyticsSubjectId: SUBJECT,
        platform: 'web',
        dedupeKey: 'allocate:hmac-subject-1:idem-1',
        replayed: true,
      }),
    properties: {
      platform: 'web',
      dedupe_key: 'allocate:hmac-subject-1:idem-1',
      replayed: true,
    },
  },
  {
    name: 'community_post_submitted',
    build: () =>
      trackCommunityPostSubmitted({
        analyticsSubjectId: SUBJECT,
        platform: 'mobile',
        dedupeKey: 'submit:hmac-subject-1:post-1',
        climateBand: 'warm_wet',
        hasCaption: true,
        hasChallenge: false,
      }),
    properties: {
      platform: 'mobile',
      dedupe_key: 'submit:hmac-subject-1:post-1',
      climate_band: 'warm_wet',
      has_caption: true,
      has_challenge: false,
    },
  },
  {
    name: 'community_post_published',
    build: () =>
      trackCommunityPostPublished({
        analyticsSubjectId: SUBJECT,
        platform: 'mobile',
        dedupeKey: 'publish:hmac-subject-1:post-1',
        climateBand: 'warm_dry',
      }),
    properties: {
      platform: 'mobile',
      dedupe_key: 'publish:hmac-subject-1:post-1',
      climate_band: 'warm_dry',
    },
  },
  {
    name: 'community_post_reported',
    build: () =>
      trackCommunityPostReported({
        analyticsSubjectId: SUBJECT,
        platform: 'web',
        dedupeKey: 'report:hmac-subject-1:post-1',
        reason: 'inappropriate_content',
      }),
    properties: {
      platform: 'web',
      dedupe_key: 'report:hmac-subject-1:post-1',
      reason: 'inappropriate_content',
    },
  },
  {
    name: 'community_post_withdrawn',
    build: () =>
      trackCommunityPostWithdrawn({
        analyticsSubjectId: SUBJECT,
        platform: 'web',
        dedupeKey: 'withdraw:hmac-subject-1:post-1',
        climateBand: null,
      }),
    properties: {
      platform: 'web',
      dedupe_key: 'withdraw:hmac-subject-1:post-1',
      climate_band: null,
    },
  },
  {
    name: 'community_challenge_participated',
    build: () =>
      trackCommunityChallengeParticipated({
        analyticsSubjectId: SUBJECT,
        platform: 'mobile',
        dedupeKey: 'challenge:hmac-subject-1:challenge-1',
        climateBand: 'cold_dry',
        challengeId: 'challenge-1',
      }),
    properties: {
      platform: 'mobile',
      dedupe_key: 'challenge:hmac-subject-1:challenge-1',
      climate_band: 'cold_dry',
      challenge_id: 'challenge-1',
    },
  },
]

const COMMUNITY_EVENT_NAMES: CommunityEventName[] = [
  'community_feed_viewed',
  'community_card_opened',
  'community_post_allocated',
  'community_post_submitted',
  'community_post_published',
  'community_post_reported',
  'community_post_withdrawn',
  'community_challenge_participated',
]

/**
 * Boundaries/Never: no caption, alt text, image URL, raw user id, or location
 * may reach the analytics sink. Every property schema is `.strict()`, so each of
 * these must be refused by each of the eight.
 */
const SENSITIVE_FIELDS: Record<string, Record<string, unknown>> = {
  user_id: { user_id: 'user-123' },
  caption: { caption: 'Crisp autumn layering.' },
  image_url: { image_url: 'https://cdn.couturecast.test/o/opaque-object-key' },
  alt_text: { alt_text: 'A wool trench over a striped knit.' },
  coordinates: { latitude: 45.4642, longitude: 9.19 },
  object_path: { object_path: 'community/user-123/post-1.jpg' },
  post_id: { post_id: 'post-1' },
  moderation_reason: { moderation_reason: 'failed_image_screen' },
}

const withoutKey = (
  source: Readonly<Record<string, unknown>>,
  key: string
): Record<string, unknown> => {
  const copy = { ...source }
  delete copy[key]
  return copy
}

const namesOf = (source: Record<string, unknown>): string[] =>
  Object.keys(source)
    .filter((key) => key.startsWith('community_'))
    .sort()

describe('6.1 community analytics event wrappers', () => {
  describe.each(communityEventCases)('$name', ({ name, build, properties }) => {
    it(`6.1-CON-050 ${name} round-trips through its wrapper and strict properties schema`, () => {
      const payload = build()

      expect(payload.distinctId).toBe(SUBJECT)
      expect(payload.event).toBe(name)
      expect(payload.properties).toEqual(properties)
      expect(analyticsPropertySchemas[name].safeParse(payload.properties).success).toBe(
        true
      )
    })

    it(`6.1-CON-051 ${name} refuses every sensitive field`, () => {
      for (const [label, sensitive] of Object.entries(SENSITIVE_FIELDS)) {
        expect(
          analyticsPropertySchemas[name].safeParse({ ...properties, ...sensitive })
            .success,
          `${name} must refuse "${label}"`
        ).toBe(false)
      }
    })

    it(`6.1-CON-052 ${name} requires dedupe_key`, () => {
      // The moderation pipeline emits from a BullMQ job that retries, and the
      // publication count feeds the beta gate. Without the key a retried job
      // double-counts, so the field is required rather than optional.
      expect(properties).toHaveProperty('dedupe_key')

      expect(
        analyticsPropertySchemas[name].safeParse(withoutKey(properties, 'dedupe_key'))
          .success
      ).toBe(false)
      expect(
        analyticsPropertySchemas[name].safeParse({ ...properties, dedupe_key: '' })
          .success
      ).toBe(false)
    })
  })

  describe('community_feed_viewed band reporting', () => {
    it('6.1-CON-053 records the viewer band and the requested filter as separate values', () => {
      // The whole point of the split. A viewer whose own band is cold_wet may
      // request warm_dry; the event must report the band the viewer resolved to.
      const payload = trackCommunityFeedViewed({
        analyticsSubjectId: SUBJECT,
        platform: 'web',
        dedupeKey: 'feed:hmac-subject-1:page-0',
        climateBand: 'cold_wet',
        bandResolved: true,
        filterMode: 'warm_dry',
        experimentVariant: 'all',
        itemCount: 4,
        isEmpty: false,
      })

      expect(payload.properties.climate_band).toBe('cold_wet')
      expect(payload.properties.filter_mode).toBe('warm_dry')
      expect(payload.properties.climate_band).not.toBe(payload.properties.filter_mode)
    })

    it('6.1-CON-054 reports an unresolved viewer band as null without disturbing filter_mode', () => {
      // Acceptance criterion: the beta guardrail keeps unresolved bands at or
      // below 15%, so an unresolved band has to be a distinguishable null rather
      // than a fallback to the filter the viewer happened to pick.
      const payload = trackCommunityFeedViewed({
        analyticsSubjectId: SUBJECT,
        platform: 'mobile',
        dedupeKey: 'feed:hmac-subject-1:page-0',
        climateBand: null,
        bandResolved: false,
        filterMode: 'auto',
        experimentVariant: 'auto',
        itemCount: 0,
        isEmpty: true,
      })

      expect(payload.properties.climate_band).toBeNull()
      expect(payload.properties.band_resolved).toBe(false)
      expect(payload.properties.filter_mode).toBe('auto')
      expect(payload.properties.is_empty).toBe(true)
      expect(payload.properties.item_count).toBe(0)
    })

    it('6.1-CON-055 accepts every filter mode and rejects a band value in filter_mode position', () => {
      const base = {
        platform: 'web' as const,
        dedupe_key: 'feed:hmac-subject-1:page-0',
        climate_band: 'temperate_dry' as const,
        band_resolved: true,
        experiment_variant: 'auto' as const,
        item_count: 1,
        is_empty: false,
      }

      for (const mode of ['auto', 'all', 'cold_wet', 'warm_dry']) {
        expect(
          communityFeedViewedPropertiesSchema.safeParse({ ...base, filter_mode: mode })
            .success,
          `filter_mode "${mode}" must be accepted`
        ).toBe(true)
      }

      expect(
        communityFeedViewedPropertiesSchema.safeParse({ ...base, filter_mode: 'polar' })
          .success
      ).toBe(false)
      // `climate_band` is the viewer's own band, so it never takes the filter-only
      // sentinels.
      expect(
        communityFeedViewedPropertiesSchema.safeParse({
          ...base,
          filter_mode: 'auto',
          climate_band: 'all',
        }).success
      ).toBe(false)
    })
  })

  describe('community_card_opened self flag', () => {
    it('6.1-CON-056 records is_self on both sides and requires it', () => {
      // The beta gate advances on at least 10% relative NON-SELF card-open lift,
      // so a card opened by its own author has to be separable from the rest.
      const openEvent = (isSelf: boolean) =>
        trackCommunityCardOpened({
          analyticsSubjectId: SUBJECT,
          platform: 'web',
          dedupeKey: 'card:hmac-subject-1:post-1',
          climateBand: 'temperate_wet',
          isSelf,
          experimentVariant: 'auto',
        })

      expect(openEvent(false).properties.is_self).toBe(false)
      expect(openEvent(true).properties.is_self).toBe(true)

      expect(
        communityCardOpenedPropertiesSchema.safeParse({
          platform: 'web',
          dedupe_key: 'card:hmac-subject-1:post-1',
          climate_band: 'temperate_wet',
          experiment_variant: 'auto',
        }).success
      ).toBe(false)
    })

    it('6.1-CON-057 keeps the experiment variant closed to the two beta arms', () => {
      const base = {
        platform: 'web' as const,
        dedupe_key: 'card:hmac-subject-1:post-1',
        climate_band: 'temperate_wet' as const,
        is_self: false,
      }

      expect(
        communityCardOpenedPropertiesSchema.safeParse({
          ...base,
          experiment_variant: 'auto',
        }).success
      ).toBe(true)
      expect(
        communityCardOpenedPropertiesSchema.safeParse({
          ...base,
          experiment_variant: 'all',
        }).success
      ).toBe(true)
      // The experiment is a stable 50/50 between auto and all; a band literal is
      // a filter value, never an arm.
      expect(
        communityCardOpenedPropertiesSchema.safeParse({
          ...base,
          experiment_variant: 'cold_wet',
        }).success
      ).toBe(false)
    })
  })

  describe('registry closure', () => {
    it('6.1-CON-058 covers all eight community events in this suite', () => {
      expect(communityEventCases.map((testCase) => testCase.name).sort()).toEqual(
        [...COMMUNITY_EVENT_NAMES].sort()
      )
    })

    it('6.1-CON-059 keeps the name enum, the event schemas, and the assertion registry identical', () => {
      // A name in the enum with no property schema fails `.strict()` parsing
      // inside TelemetryService at runtime and nowhere earlier; a schema with no
      // enum member is unreachable. Both directions have to be checked.
      const expected = [...COMMUNITY_EVENT_NAMES].sort()
      const fromEnum = analyticsEventNameSchema.options
        .filter((name) => name.startsWith('community_'))
        .sort()
      const fromEventSchemas = namesOf(analyticsEventSchemas)
      const fromAssertions = namesOf(analyticsPropertySchemas)

      expect(fromEnum).toEqual(expected)
      expect(fromEventSchemas).toEqual(expected)
      expect(fromAssertions).toEqual(expected)

      expect(fromEventSchemas.filter((name) => !fromAssertions.includes(name))).toEqual(
        []
      )
      expect(fromAssertions.filter((name) => !fromEventSchemas.includes(name))).toEqual(
        []
      )
    })
  })
})
