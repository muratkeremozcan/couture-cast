// Story 7.5 test plan 7.5-UNIT-005..008: garment photo alt text ("Blue top") shared by web and
// native.
// Learning path Step 63: Garment detail and tag edit.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-63-garment-detail-and-tag-edit
import { describe, expect, it } from 'vitest'
import { GARMENT_COLOR_FAMILIES } from '../garment-color'
import { formatGarmentAlt, GARMENT_ALT_STRINGS } from './garment-alt'
import { GUEST_PREVIEW_LOCALES } from './strings'
import { SAMPLE_GARMENT_CATEGORIES } from './types'

describe('formatGarmentAlt', () => {
  it('[P0] [7.5-UNIT-005] reads "Blue top" for a blue top in en-US', () => {
    expect(formatGarmentAlt('en-US', { colorFamily: 'blue', category: 'top' })).toBe(
      'Blue top'
    )
  })

  it('[P1] [7.5-UNIT-006] falls back to the category alone, then to "Untagged garment"', () => {
    expect(formatGarmentAlt('en-US', { colorFamily: null, category: 'top' })).toBe('Top')
    expect(formatGarmentAlt('en-US', { category: 'shoes' })).toBe('Shoes')
    expect(formatGarmentAlt('en-US', { colorFamily: 'blue', category: null })).toBe(
      'Untagged garment'
    )
    expect(formatGarmentAlt('en-US', {})).toBe('Untagged garment')
  })

  it('[P1] [7.5-UNIT-006] reads an unsupported or missing locale as en-US', () => {
    expect(formatGarmentAlt('xx-XX', { colorFamily: 'blue', category: 'top' })).toBe(
      'Blue top'
    )
    expect(formatGarmentAlt(undefined, { colorFamily: 'blue', category: 'top' })).toBe(
      'Blue top'
    )
  })

  it('[P1] [7.5-UNIT-007] gives every locale, color and category a complete phrase', () => {
    for (const locale of GUEST_PREVIEW_LOCALES) {
      const table = GARMENT_ALT_STRINGS[locale]
      for (const category of SAMPLE_GARMENT_CATEGORIES) {
        const noun = table.categories[category].noun
        for (const colorFamily of GARMENT_COLOR_FAMILIES) {
          const alt = formatGarmentAlt(locale, { colorFamily, category })
          expect(alt, `${locale} ${colorFamily} ${category}`).not.toMatch(
            /[{}]|undefined/
          )
          expect(alt.toLocaleLowerCase(locale)).toContain(noun.toLocaleLowerCase(locale))
          // The color word is present: the phrase differs from the category-only fallback.
          expect(alt).not.toBe(formatGarmentAlt(locale, { category }))
        }
        expect(formatGarmentAlt(locale, { category })).not.toMatch(/[{}]|undefined/)
      }
      expect(formatGarmentAlt(locale, {})).toBe(table.untagged)
    }
  })

  it.each([
    ['en-CA', { colorFamily: 'gray', category: 'top' }, 'Grey top'],
    ['es-419', { colorFamily: 'blue', category: 'shoes' }, 'Zapatos azules'],
    ['es-419', { colorFamily: 'white', category: 'top' }, 'Prenda superior blanca'],
    ['fr-FR', { colorFamily: 'blue', category: 'dress' }, 'Robe bleue'],
    ['fr-CA', { colorFamily: 'brown', category: 'top' }, 'Haut brun'],
    ['pt-BR', { colorFamily: 'black', category: 'shoes' }, 'Sapatos pretos'],
    ['pt-PT', { colorFamily: 'gray', category: 'outerwear' }, 'Casaco cinzento'],
    ['it-IT', { colorFamily: 'red', category: 'shoes' }, 'Scarpe rosse'],
    ['de-DE', { colorFamily: 'blue', category: 'top' }, 'Oberteil in Blau'],
    ['tr-TR', { colorFamily: 'blue', category: 'top' }, 'Mavi üst'],
  ] as const)(
    '[P2] [7.5-UNIT-008] keeps %s word order and agreement: %j',
    (locale, input, expected) => {
      expect(formatGarmentAlt(locale, input)).toBe(expected)
    }
  )
})
