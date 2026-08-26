// Learning path Step 36: Colour palette, beauty and accessory advisor.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-36-colour-palette-beauty-and-accessory-advisor
import { describe, expect, it } from 'vitest'

import {
  advisorOfferClickedPropertiesSchema,
  advisorRecommendationActedPropertiesSchema,
  paletteAnalysisCompletedPropertiesSchema,
  trackAdvisorOfferClicked,
  trackAdvisorRecommendationActed,
  trackPaletteAnalysisCompleted,
} from '../src/types/analytics-events'

/**
 * Story 5.4 palette advisor analytics wrappers, split from the contract spec
 * on the same line 5.1 drew: `*-contract.spec.ts` asserts published
 * request/response shapes, `*-analytics.spec.ts` asserts the event builders.
 *
 * The negative fixtures are Decision 13's privacy rule made executable: no
 * raw hex, no confidence score, no image metadata, and no raw user id may
 * reach PostHog through any of these three events.
 */

const DISALLOWED_PALETTE_PROPERTY_FIXTURES = Object.freeze([
  { hex: '#C9A14A' },
  { swatch_hex: '#C9A14A' },
  { confidence: 0.82 },
  { image_url: 'https://storage.example.test/selfie.jpg' },
  { object_path: 'palette-selfies/user-1/session-1.jpg' },
  { width_px: 1024 },
  { height_px: 1024 },
  { user_id: 'user-fixture-1' },
  { email: 'user@example.com' },
  { note: 'free text' },
])

describe('5.4 palette advisor analytics wrappers', () => {
  it('5.4-CON-010 builds palette_analysis_completed on the HMAC subject, ready outcome', () => {
    const payload = trackPaletteAnalysisCompleted({
      analyticsSubjectId: 'hmac-subject-1',
      source: 'selfie',
      undertone: 'warm',
      depth: 'medium',
      outcome: 'ready',
    })

    expect(payload).toEqual({
      distinctId: 'hmac-subject-1',
      event: 'palette_analysis_completed',
      properties: {
        source: 'selfie',
        undertone: 'warm',
        depth: 'medium',
        outcome: 'ready',
      },
    })
  })

  it('5.4-CON-011 builds palette_analysis_completed with a failure outcome and null scalars', () => {
    const payload = trackPaletteAnalysisCompleted({
      analyticsSubjectId: 'hmac-subject-1',
      source: 'selfie',
      undertone: null,
      depth: null,
      outcome: 'no_face',
    })

    expect(payload.properties).toEqual({
      source: 'selfie',
      undertone: null,
      depth: null,
      outcome: 'no_face',
    })
  })

  it('5.4-CON-012 builds palette_analysis_completed for a wardrobe-sourced ready palette (depth null)', () => {
    const payload = trackPaletteAnalysisCompleted({
      analyticsSubjectId: 'hmac-subject-1',
      source: 'wardrobe',
      undertone: 'olive',
      depth: null,
      outcome: 'ready',
    })

    expect(payload.properties.depth).toBeNull()
  })

  it('5.4-CON-013 builds advisor_offer_clicked with the advisor slot and platform', () => {
    const payload = trackAdvisorOfferClicked({
      analyticsSubjectId: 'hmac-subject-1',
      partnerId: 'sample-partner',
      offerId: 'offer-1',
      advisorSlot: 'foundation',
      platform: 'web',
    })

    expect(payload).toEqual({
      distinctId: 'hmac-subject-1',
      event: 'advisor_offer_clicked',
      properties: {
        partner_id: 'sample-partner',
        offer_id: 'offer-1',
        advisor_slot: 'foundation',
        platform: 'web',
      },
    })
  })

  it('5.4-CON-014 builds advisor_recommendation_acted for both actions', () => {
    const saved = trackAdvisorRecommendationActed({
      analyticsSubjectId: 'hmac-subject-1',
      slot: 'blush',
      action: 'saved',
    })
    expect(saved.properties).toEqual({ slot: 'blush', action: 'saved' })

    const dismissed = trackAdvisorRecommendationActed({
      analyticsSubjectId: 'hmac-subject-1',
      slot: 'blush',
      action: 'dismissed',
    })
    expect(dismissed.properties).toEqual({ slot: 'blush', action: 'dismissed' })
  })

  describe('5.4-CON-020 property allowlists reject forbidden values', () => {
    const validBysSchema = [
      {
        schema: paletteAnalysisCompletedPropertiesSchema,
        valid: { source: 'selfie', undertone: 'warm', depth: 'medium', outcome: 'ready' },
      },
      {
        schema: advisorOfferClickedPropertiesSchema,
        valid: {
          partner_id: 'sample-partner',
          offer_id: 'offer-1',
          advisor_slot: 'foundation',
          platform: 'web',
        },
      },
      {
        schema: advisorRecommendationActedPropertiesSchema,
        valid: { slot: 'foundation', action: 'saved' },
      },
    ] as const

    for (const [index, { schema, valid }] of validBysSchema.entries()) {
      it(`rejects every disallowed property on schema ${index + 1}`, () => {
        expect(schema.safeParse(valid).success).toBe(true)

        for (const forbidden of DISALLOWED_PALETTE_PROPERTY_FIXTURES) {
          expect(
            schema.safeParse({ ...valid, ...forbidden }).success,
            `expected ${Object.keys(forbidden)[0]} to be rejected`
          ).toBe(false)
        }
      })
    }
  })

  it('5.4-CON-021 rejects an out-of-enum undertone/depth/outcome', () => {
    expect(
      paletteAnalysisCompletedPropertiesSchema.safeParse({
        source: 'selfie',
        undertone: 'tanned', // not a real SkinUndertone member
        depth: 'medium',
        outcome: 'ready',
      }).success
    ).toBe(false)

    expect(
      paletteAnalysisCompletedPropertiesSchema.safeParse({
        source: 'selfie',
        undertone: 'warm',
        depth: 'medium',
        outcome: 'not_a_real_outcome',
      }).success
    ).toBe(false)
  })

  /**
   * The `@ts-expect-error` sits on the property, not on the call.
   *
   * On the call it was reported as unused: the argument object is contextually
   * typed, so TypeScript attributes the excess-property error to `userId`
   * itself and the directive one line higher matched nothing. That made the
   * directive a silent no-op AND a typecheck failure, which is the worst of
   * both -- the runtime `.strict()` assertion below was the only thing left
   * proving anything.
   */
  it('5.4-CON-022 never accepts a raw user id in place of the pseudonymous subject', () => {
    expect(() =>
      trackPaletteAnalysisCompleted({
        // @ts-expect-error -- userId is not an accepted field
        userId: 'raw-user-id',
        source: 'selfie',
        undertone: 'warm',
        depth: 'medium',
        outcome: 'ready',
      })
    ).toThrow()
  })
})
