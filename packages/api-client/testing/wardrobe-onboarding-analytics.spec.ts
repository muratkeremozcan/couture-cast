// Learning path Step 32: Wardrobe onboarding and silhouette setup.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-32-wardrobe-onboarding-and-silhouette-setup
import { describe, expect, it } from 'vitest'
import type { z } from 'zod'
import {
  trackWardrobeOnboardingCompleted,
  trackWardrobeOnboardingStarted,
  wardrobeOnboardingCompletedEventSchema,
  wardrobeOnboardingCompletedPropertiesSchema,
  wardrobeOnboardingStartedEventSchema,
  wardrobeOnboardingStartedPropertiesSchema,
} from '../src/types/analytics-events'

/**
 * 4.4-UNIT-001. Mirrors 4.3-UNIT-004 for the new onboarding activation
 * events (decision 13): the strict allowlists are the enforcement point, so
 * these cases prove the schemas reject photo bytes, silhouette detail, and
 * user-authored text rather than trusting that callers never pass them.
 */

/**
 * Values an onboarding event must never carry: photo/media references,
 * silhouette measurements, free-form text, and contact details.
 */
const FORBIDDEN_PROPERTIES: Record<string, unknown> = {
  image_url: 'https://cdn.example.test/wardrobe/teen-1/my-form.jpg',
  media_url: 'https://cdn.example.test/wardrobe/teen-1/my-form.jpg',
  object_path: 'wardrobe/teen-1/silhouette/photo.jpg',
  photo_url: 'https://cdn.example.test/wardrobe/teen-1/my-form.jpg',
  height_slider: 62,
  build_slider: 40,
  my_form_status: 'ready',
  failure_reason: 'contrast',
  garment_labels: ['blue linen shirt'],
  display_name: 'Sam Rivera',
  email: 'sam@example.test',
  notes: { private: 'wore this on the school trip' },
}

const eventSchemas = [
  ['wardrobe_onboarding_started', wardrobeOnboardingStartedPropertiesSchema],
  ['wardrobe_onboarding_completed', wardrobeOnboardingCompletedPropertiesSchema],
] as const satisfies readonly (readonly [string, z.ZodTypeAny])[]

const validProperties: Record<string, Record<string, unknown>> = {
  wardrobe_onboarding_started: {
    user_id: 'owner-1',
    timestamp: '2026-08-09T12:00:00.000Z',
  },
  wardrobe_onboarding_completed: {
    user_id: 'owner-1',
    duration_ms: 45_000,
    used_starter_wardrobe: false,
    garment_count: 3,
    silhouette_mode: 'default_mannequin',
    timestamp: '2026-08-09T12:00:45.000Z',
  },
}

describe('wardrobe onboarding analytics privacy allowlists', () => {
  describe.each(eventSchemas)('%s', (eventName, schema) => {
    it('4.4-UNIT-001 accepts its canonical property set', () => {
      expect(schema.safeParse(validProperties[eventName]).success).toBe(true)
    })

    it.each(Object.keys(FORBIDDEN_PROPERTIES))(
      '4.4-UNIT-001 rejects the %s property',
      (forbiddenKey) => {
        const result = schema.safeParse({
          ...validProperties[eventName],
          [forbiddenKey]: FORBIDDEN_PROPERTIES[forbiddenKey],
        })

        expect(result.success).toBe(false)
      }
    )
  })

  it('4.4-UNIT-001 rejects photo and silhouette detail on the inbound event schemas too', () => {
    const inboundSchemas = [
      [
        wardrobeOnboardingStartedEventSchema,
        { analyticsSubjectId: 'owner-1', timestamp: '2026-08-09T12:00:00.000Z' },
      ],
      [
        wardrobeOnboardingCompletedEventSchema,
        {
          analyticsSubjectId: 'owner-1',
          durationMs: 45_000,
          usedStarterWardrobe: false,
          garmentCount: 3,
          silhouetteMode: 'default_mannequin',
          timestamp: '2026-08-09T12:00:45.000Z',
        },
      ],
    ] as const satisfies readonly (readonly [z.ZodTypeAny, Record<string, unknown>])[]

    for (const [schema, valid] of inboundSchemas) {
      expect(schema.safeParse(valid).success).toBe(true)
      expect(
        schema.safeParse({ ...valid, imageUrl: 'https://cdn.example.test/photo.jpg' })
          .success
      ).toBe(false)
      expect(schema.safeParse({ ...valid, heightSlider: 62 }).success).toBe(false)
    }
  })

  it('4.4-UNIT-001 emits only allowlisted keys through the tracking wrappers', () => {
    const payloads = [
      trackWardrobeOnboardingStarted({
        analyticsSubjectId: 'owner-1',
        timestamp: '2026-08-09T12:00:00.000Z',
      }),
      trackWardrobeOnboardingCompleted({
        analyticsSubjectId: 'owner-1',
        durationMs: 45_000,
        usedStarterWardrobe: true,
        garmentCount: 0,
        silhouetteMode: 'my_form',
        timestamp: '2026-08-09T12:00:45.000Z',
      }),
    ]

    const allowedKeys = new Set([
      'user_id',
      'timestamp',
      'duration_ms',
      'used_starter_wardrobe',
      'garment_count',
      'silhouette_mode',
    ])

    for (const payload of payloads) {
      for (const key of Object.keys(payload.properties)) {
        expect(allowedKeys.has(key)).toBe(true)
      }

      const serialized = JSON.stringify(payload)
      for (const authored of ['example.test', 'wardrobe/teen-1', 'Sam Rivera']) {
        expect(serialized).not.toContain(authored)
      }
    }
  })

  it('4.4-UNIT-001 distinguishes the onboarding pair from the pre-existing MVP activation events', () => {
    // profile_completed and first_outfit_generated already exist and are out
    // of scope for this story (decision 13); this pins the two new event
    // names to their own distinct identity.
    const started = trackWardrobeOnboardingStarted({
      analyticsSubjectId: 'owner-1',
      timestamp: '2026-08-09T12:00:00.000Z',
    })
    const completed = trackWardrobeOnboardingCompleted({
      analyticsSubjectId: 'owner-1',
      durationMs: 1_000,
      usedStarterWardrobe: false,
      garmentCount: 1,
      silhouetteMode: 'default_mannequin',
      timestamp: '2026-08-09T12:00:01.000Z',
    })

    expect(started.event).toBe('wardrobe_onboarding_started')
    expect(completed.event).toBe('wardrobe_onboarding_completed')
    expect(started.event).not.toBe('profile_completed')
    expect(completed.event).not.toBe('first_outfit_generated')
  })
})
