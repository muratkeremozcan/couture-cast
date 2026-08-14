import { ritualResponseSchema } from '@couture/api-client/contracts/http'
import { describe, expect, it } from 'vitest'

import { mockRitualResponse, mockShopThisLook } from './handlers'

/**
 * Guard: the mobile MSW fixtures must stay a *valid* stand-in for the API.
 *
 * Mock data is supposed to differ from seeded data in its values. What it may
 * never do is differ in its shape, because then every mobile unit test passes
 * against a payload the API could not send: a `scenario`, `condition` or
 * `garmentCategory` outside the contract's enums looks fine in jsdom and fails
 * only on a device.
 *
 * This is the shape half of the fixture-vs-seed drift guard. The other half --
 * "no Maestro flow may assert a value that exists only in these mocks" -- needs
 * the filesystem and lives in `packages/db/test/mock-vs-seed-drift.spec.ts`,
 * next to the seeds whose output it is protecting.
 */
describe('MSW fixtures satisfy the canonical contracts', () => {
  it('parses the ritual fixture against the canonical response schema', () => {
    expect(() => ritualResponseSchema.parse(mockRitualResponse)).not.toThrow()
  })

  it('parses every localized outfit variant the fixture ships', () => {
    // The locale variants are hand-maintained copies of the same structure, so
    // they drift independently of the default fixture and of each other.
    for (const locale of ['tr-TR', 'es-ES', 'fr-FR', 'de-DE']) {
      const localized = {
        ...mockRitualResponse,
        data: { ...mockRitualResponse.data, locale },
      }
      expect(() => ritualResponseSchema.parse(localized), locale).not.toThrow()
    }
  })

  it('keeps the affiliate fixture inside the contract enums', () => {
    const parsed = ritualResponseSchema.parse(mockRitualResponse)
    const withOffer = parsed.data.outfits.find((outfit) => outfit.shopThisLook)

    expect(withOffer?.shopThisLook?.garmentCategory).toBe(
      mockShopThisLook.garmentCategory
    )
  })
})
