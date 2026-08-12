// Learning path Step 31: Outfit capsule builder.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-31-outfit-capsule-builder
import { describe, expect, it } from 'vitest'
import type { z } from 'zod'
import {
  trackWardrobeCapsuleCreated,
  trackWardrobeCapsuleDeleted,
  trackWardrobeCapsuleFavoriteChanged,
  trackWardrobeCapsuleRecommendationSelected,
  trackWardrobeCapsuleRecommendationViewed,
  trackWardrobeCapsuleRecommended,
  trackWardrobeCapsuleUpdated,
  wardrobeCapsuleCreatedEventSchema,
  wardrobeCapsuleCreatedPropertiesSchema,
  wardrobeCapsuleDeletedEventSchema,
  wardrobeCapsuleDeletedPropertiesSchema,
  wardrobeCapsuleFavoriteChangedEventSchema,
  wardrobeCapsuleFavoriteChangedPropertiesSchema,
  wardrobeCapsuleRecommendationSelectedEventSchema,
  wardrobeCapsuleRecommendationSelectedPropertiesSchema,
  wardrobeCapsuleRecommendationViewedEventSchema,
  wardrobeCapsuleRecommendationViewedPropertiesSchema,
  wardrobeCapsuleRecommendedEventSchema,
  wardrobeCapsuleRecommendedPropertiesSchema,
  wardrobeCapsuleUpdatedEventSchema,
  wardrobeCapsuleUpdatedPropertiesSchema,
} from '../src/types/analytics-events'

/**
 * 4.3-UNIT-004. Capsule analytics carry identifiers and enums only. The strict
 * allowlists are the enforcement point, so these cases prove the schemas reject
 * user-authored text and media references rather than trusting that callers
 * never pass them.
 */

/**
 * Values a capsule event must never carry: capsule text the user authored,
 * garment media references, free-form search input, and contact details.
 */
const FORBIDDEN_PROPERTIES: Record<string, unknown> = {
  name: 'Weekend brunch capsule',
  capsule_name: 'Weekend brunch capsule',
  description: 'The linen shirt I wore to the wedding',
  capsule_description: 'The linen shirt I wore to the wedding',
  garment_labels: ['blue linen shirt', 'black jeans'],
  garment_names: ['blue linen shirt'],
  image_url: 'https://cdn.example.test/wardrobe/teen-1/shirt.png',
  media_url: 'https://cdn.example.test/wardrobe/teen-1/shirt.png',
  object_path: 'wardrobe/teen-1/shirt.png',
  thumbnail_path: 'wardrobe/teen-1/thumb.png',
  query: 'linen',
  search_query: 'linen',
  display_name: 'Sam Rivera',
  email: 'sam@example.test',
  actor_user_id: 'guardian-1',
  notes: { private: 'wore this on the school trip' },
}

const eventSchemas = [
  ['wardrobe_capsule_created', wardrobeCapsuleCreatedPropertiesSchema],
  ['wardrobe_capsule_updated', wardrobeCapsuleUpdatedPropertiesSchema],
  ['wardrobe_capsule_deleted', wardrobeCapsuleDeletedPropertiesSchema],
  ['wardrobe_capsule_favorite_changed', wardrobeCapsuleFavoriteChangedPropertiesSchema],
  ['wardrobe_capsule_recommended', wardrobeCapsuleRecommendedPropertiesSchema],
  [
    'wardrobe_capsule_recommendation_viewed',
    wardrobeCapsuleRecommendationViewedPropertiesSchema,
  ],
  [
    'wardrobe_capsule_recommendation_selected',
    wardrobeCapsuleRecommendationSelectedPropertiesSchema,
  ],
] as const satisfies readonly (readonly [string, z.ZodTypeAny])[]

const validProperties: Record<string, Record<string, unknown>> = {
  wardrobe_capsule_created: {
    capsule_id: 'capsule-1',
    garment_count: 3,
    occasions: ['work'],
    is_favorite: false,
  },
  wardrobe_capsule_updated: {
    capsule_id: 'capsule-1',
    changed_fields: ['name'],
    garment_count: 3,
    occasions: ['work'],
    is_favorite: false,
  },
  wardrobe_capsule_deleted: { capsule_id: 'capsule-1' },
  wardrobe_capsule_favorite_changed: {
    capsule_id: 'capsule-1',
    requested_state: true,
  },
  wardrobe_capsule_recommended: {
    capsule_id: 'capsule-1',
    scenario: 'morning',
    completeness: 'complete',
    auto_filled_garment_count: 0,
  },
  wardrobe_capsule_recommendation_viewed: {
    capsule_id: 'capsule-1',
    scenario: 'morning',
  },
  wardrobe_capsule_recommendation_selected: {
    capsule_id: 'capsule-1',
    scenario: 'morning',
  },
}

describe('wardrobe capsule analytics privacy allowlists', () => {
  describe.each(eventSchemas)('%s', (eventName, schema) => {
    it('4.3-UNIT-004 accepts its canonical property set', () => {
      expect(schema.safeParse(validProperties[eventName]).success).toBe(true)
    })

    it.each(Object.keys(FORBIDDEN_PROPERTIES))(
      '4.3-UNIT-004 rejects the %s property',
      (forbiddenKey) => {
        const result = schema.safeParse({
          ...validProperties[eventName],
          [forbiddenKey]: FORBIDDEN_PROPERTIES[forbiddenKey],
        })

        expect(result.success).toBe(false)
      }
    )
  })

  it('4.3-UNIT-004 rejects authored content on the inbound event schemas too', () => {
    const inboundSchemas = [
      [
        wardrobeCapsuleCreatedEventSchema,
        {
          analyticsSubjectId: 'owner-1',
          capsuleId: 'capsule-1',
          garmentCount: 2,
          occasions: ['work'],
          isFavorite: false,
        },
      ],
      [
        wardrobeCapsuleUpdatedEventSchema,
        {
          analyticsSubjectId: 'owner-1',
          capsuleId: 'capsule-1',
          changedFields: ['name'],
          garmentCount: 2,
          occasions: ['work'],
          isFavorite: false,
        },
      ],
      [
        wardrobeCapsuleDeletedEventSchema,
        { analyticsSubjectId: 'owner-1', capsuleId: 'capsule-1' },
      ],
      [
        wardrobeCapsuleFavoriteChangedEventSchema,
        {
          analyticsSubjectId: 'owner-1',
          capsuleId: 'capsule-1',
          requestedState: true,
        },
      ],
      [
        wardrobeCapsuleRecommendedEventSchema,
        {
          analyticsSubjectId: 'owner-1',
          capsuleId: 'capsule-1',
          scenario: 'morning',
          completeness: 'complete',
          autoFilledGarmentCount: 0,
        },
      ],
      [
        wardrobeCapsuleRecommendationViewedEventSchema,
        { analyticsSubjectId: 'owner-1', capsuleId: 'capsule-1', scenario: 'morning' },
      ],
      [
        wardrobeCapsuleRecommendationSelectedEventSchema,
        { analyticsSubjectId: 'owner-1', capsuleId: 'capsule-1', scenario: 'morning' },
      ],
    ] as const satisfies readonly (readonly [z.ZodTypeAny, Record<string, unknown>])[]

    for (const [schema, valid] of inboundSchemas) {
      expect(schema.safeParse(valid).success).toBe(true)
      expect(schema.safeParse({ ...valid, name: 'Weekend capsule' }).success).toBe(false)
      expect(schema.safeParse({ ...valid, description: 'authored text' }).success).toBe(
        false
      )
    }
  })

  it('4.3-UNIT-004 emits only allowlisted keys through the tracking wrappers', () => {
    const payloads = [
      trackWardrobeCapsuleCreated({
        analyticsSubjectId: 'owner-1',
        capsuleId: 'capsule-1',
        garmentCount: 3,
        occasions: ['work', 'casual'],
        isFavorite: true,
      }),
      trackWardrobeCapsuleUpdated({
        analyticsSubjectId: 'owner-1',
        capsuleId: 'capsule-1',
        changedFields: ['name', 'garmentIds'],
        garmentCount: 4,
        occasions: ['work'],
        isFavorite: false,
      }),
      trackWardrobeCapsuleDeleted({
        analyticsSubjectId: 'owner-1',
        capsuleId: 'capsule-1',
      }),
      trackWardrobeCapsuleFavoriteChanged({
        analyticsSubjectId: 'owner-1',
        capsuleId: 'capsule-1',
        requestedState: true,
      }),
      trackWardrobeCapsuleRecommended({
        analyticsSubjectId: 'owner-1',
        capsuleId: 'capsule-1',
        scenario: 'morning',
        completeness: 'partial',
        autoFilledGarmentCount: 2,
      }),
      trackWardrobeCapsuleRecommendationViewed({
        analyticsSubjectId: 'owner-1',
        capsuleId: 'capsule-1',
        scenario: 'midday',
      }),
      trackWardrobeCapsuleRecommendationSelected({
        analyticsSubjectId: 'owner-1',
        capsuleId: 'capsule-1',
        scenario: 'evening',
      }),
    ]

    const allowedKeys = new Set([
      'capsule_id',
      'garment_count',
      'occasions',
      'is_favorite',
      'changed_fields',
      'requested_state',
      'scenario',
      'completeness',
      'auto_filled_garment_count',
      'requested_occasion',
      'actor_role',
    ])

    for (const payload of payloads) {
      for (const key of Object.keys(payload.properties)) {
        expect(allowedKeys.has(key)).toBe(true)
      }

      const serialized = JSON.stringify(payload)
      for (const authored of [
        'Weekend',
        'linen',
        'example.test',
        'wardrobe/teen-1',
        'Sam Rivera',
      ]) {
        expect(serialized).not.toContain(authored)
      }
    }
  })

  it('4.3-UNIT-004 attributes guardian and admin mutations to the owner without the actor id', () => {
    const payload = trackWardrobeCapsuleUpdated({
      analyticsSubjectId: 'teen-owner-1',
      capsuleId: 'capsule-1',
      changedFields: ['isFavorite'],
      garmentCount: 2,
      occasions: ['casual'],
      isFavorite: true,
      actorRole: 'guardian',
    })

    expect(payload.distinctId).toBe('teen-owner-1')
    expect(payload.properties.actor_role).toBe('guardian')
    expect(JSON.stringify(payload)).not.toContain('guardian-1')
  })

  it('4.3-UNIT-004 constrains capsule cardinality and changed-field vocabulary', () => {
    const base = validProperties.wardrobe_capsule_created

    for (const invalidCount of [1, 11, 2.5]) {
      expect(
        wardrobeCapsuleCreatedPropertiesSchema.safeParse({
          ...base,
          garment_count: invalidCount,
        }).success
      ).toBe(false)
    }

    expect(
      wardrobeCapsuleUpdatedPropertiesSchema.safeParse({
        ...validProperties.wardrobe_capsule_updated,
        changed_fields: ['capsuleName'],
      }).success
    ).toBe(false)

    expect(
      wardrobeCapsuleCreatedPropertiesSchema.safeParse({
        ...base,
        occasions: ['brunch'],
      }).success
    ).toBe(false)
  })
})
