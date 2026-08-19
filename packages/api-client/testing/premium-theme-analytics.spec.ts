// Learning path Step 35: Premium theme switcher.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-35-premium-theme-switcher
import { describe, expect, it } from 'vitest'

import { premiumThemeKeySchema } from '../src/contracts/http/premium-theme'
import {
  analyticsEventNameSchema,
  analyticsEventSchemas,
  premiumThemeSelectedEventSchema,
  premiumThemeSelectedPropertiesSchema,
  trackPremiumThemeSelected,
} from '../src/types/analytics-events'

/**
 * Story 5.3 premium theme analytics, split from `premium-theme-contract.spec.ts`
 * on the line 5.1 drew and 5.2 kept: `*-contract.spec.ts` asserts published
 * request/response shapes, `*-analytics.spec.ts` asserts the event builders.
 *
 * A new file rather than an addition to `premium-analytics.spec.ts` for the same
 * reason 5.2 gave its locale spec: a feature area owns its own fixtures, and
 * appending here would make a 5.2 file jointly owned for no gain.
 *
 * The negative fixtures are the story's privacy rule made executable. A palette
 * choice is cosmetic, so the allowlist is one key: no user id, no surface, no
 * hex values, no free text.
 */

const DISALLOWED_THEME_PROPERTY_FIXTURES = Object.freeze([
  { user_id: 'user-fixture-1' },
  { analytics_subject_id: 'hmac-subject-1' },
  { email: 'subscriber@example.com' },
  { theme_primary_hex: '#0D6F62' },
  { card_bg: '#E9EDF6' },
  { previous_theme: 'autumn_umber' },
  { surface: 'web_settings' },
  { note: 'free text' },
])

describe('5.3 premium theme analytics wrapper', () => {
  it('5.3-CON-001 registers the event name and its schema in lockstep', () => {
    // The generic registry gate in `analytics-events.spec.ts` proves set
    // equality across the whole enum; this asserts the 5.3 row specifically so
    // a failure names the event that went missing.
    expect(analyticsEventNameSchema.safeParse('premium_theme_selected').success).toBe(
      true
    )
    expect(analyticsEventSchemas.premium_theme_selected).toBeDefined()
  })

  it('5.3-CON-002 builds premium_theme_selected on the HMAC subject', () => {
    const payload = trackPremiumThemeSelected({
      analyticsSubjectId: 'hmac-subject-1',
      theme: 'jewel_radiance',
    })

    expect(payload).toEqual({
      distinctId: 'hmac-subject-1',
      event: 'premium_theme_selected',
      properties: { theme: 'jewel_radiance' },
    })
  })

  it('5.3-CON-003 publishes a reset to Default as a null theme, not a missing event', () => {
    // Null is the same single spelling of Default the HTTP contract uses. If a
    // reset emitted nothing, adoption would look monotonic and abandonment
    // would be invisible.
    const payload = trackPremiumThemeSelected({
      analyticsSubjectId: 'hmac-subject-1',
      theme: null,
    })

    expect(payload.properties).toEqual({ theme: null })
  })

  /**
   * `types/` deliberately does not import from `contracts/`, so `analytics-events.ts`
   * re-lists the three palettes by hand. Nothing made the two lists agree, and the
   * drift is silent in the worst direction: add a fourth palette to the contract and
   * the PUT accepts and stores it, then the analytics parse throws inside
   * `TelemetryService`, `PremiumThemeService.emitSelection` catches it fail-open, and
   * the only evidence is a palette that produces no events at all. This test is the
   * detector, and it belongs here rather than in the module because it is the one
   * layer allowed to see both.
   */
  it('5.3-CON-007 keeps the analytics palette list equal to the contract enum', () => {
    const contractKeys = [...premiumThemeKeySchema.options].sort()
    const analyticsKeys = [
      ...premiumThemeSelectedEventSchema.shape.theme.unwrap().options,
    ].sort()

    expect(analyticsKeys).toEqual(contractKeys)
  })

  it('5.3-CON-004 keeps the palette enum closed at the analytics boundary too', () => {
    // Spring Bloom is future in the UX spec; Midnight Noir was only ever an
    // illustrative name in the epic. Neither may reach PostHog as a value that
    // later looks like evidence the palette shipped.
    for (const unknownTheme of ['spring_bloom', 'midnight_noir', 'default']) {
      expect(
        premiumThemeSelectedPropertiesSchema.safeParse({ theme: unknownTheme }).success
      ).toBe(false)
      expect(() =>
        trackPremiumThemeSelected({
          analyticsSubjectId: 'hmac-subject-1',
          // @ts-expect-error -- the enum is closed around the three shipped palettes
          theme: unknownTheme,
        })
      ).toThrow()
    }
  })

  it('5.3-CON-005 rejects every disallowed property on the theme allowlist', () => {
    const valid = { theme: 'autumn_umber' as const }
    expect(premiumThemeSelectedPropertiesSchema.safeParse(valid).success).toBe(true)

    for (const forbidden of DISALLOWED_THEME_PROPERTY_FIXTURES) {
      expect(
        premiumThemeSelectedPropertiesSchema.safeParse({ ...valid, ...forbidden })
          .success,
        `expected ${Object.keys(forbidden)[0]} to be rejected`
      ).toBe(false)
    }
  })

  it('5.3-CON-006 never accepts a raw user id in place of the pseudonymous subject', () => {
    // The wrapper requires analyticsSubjectId; there is no path that accepts a
    // userId key, so a caller holding only a raw id cannot emit at all.
    expect(() =>
      trackPremiumThemeSelected(
        // @ts-expect-error -- userId is not an accepted field
        { userId: 'raw-user-id', theme: 'winter_metallic' }
      )
    ).toThrow()
  })
})
