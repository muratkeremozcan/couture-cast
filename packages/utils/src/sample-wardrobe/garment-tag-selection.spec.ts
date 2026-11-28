// Learning path Step 84: Suggested tags that are right.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-84-suggested-tags-that-are-right
import { describe, expect, it } from 'vitest'
import {
  confidentGarmentTag,
  resolveGarmentSubtypeSelection,
} from './garment-tag-selection'
import { garmentTaggingStrings } from './garment-tagging-strings'
import { GUEST_PREVIEW_LOCALES } from './strings'

const confidentTank = {
  category: { value: 'top' },
  subtype: { value: 'tank', isConfident: true },
} as const

describe('Garment tag selection', () => {
  it('applies confident tag values and preserves an explicit absence', () => {
    expect(confidentGarmentTag()).toBeUndefined()
    expect(confidentGarmentTag({ value: 'top', isConfident: false })).toBeUndefined()
    expect(confidentGarmentTag({ value: 'top', isConfident: true })).toBe('top')
    expect(confidentGarmentTag({ value: null, isConfident: true })).toBeNull()
  })

  it('prefers an explicit choice, including None, and keeps an untouched stored subtype', () => {
    const saved = { category: 'top', subtype: 'camisole' } as const
    expect(
      resolveGarmentSubtypeSelection('top', 'crop-top', saved, confidentTank)
    ).toMatchObject({ selected: 'crop-top', save: 'crop-top' })
    expect(
      resolveGarmentSubtypeSelection('top', null, saved, confidentTank)
    ).toMatchObject({ selected: null, save: null })
    expect(
      resolveGarmentSubtypeSelection('top', undefined, saved, confidentTank)
    ).toMatchObject({ selected: 'camisole', save: undefined })
  })

  it('uses the confident matching suggestion and ignores malformed or incompatible selections', () => {
    expect(
      resolveGarmentSubtypeSelection('top', 'mini-skirt', undefined, confidentTank)
    ).toMatchObject({ selected: 'tank', save: 'tank' })
    expect(
      resolveGarmentSubtypeSelection(
        'top',
        undefined,
        { category: 'top' },
        {
          ...confidentTank,
          subtype: { value: null, isConfident: true },
        }
      )
    ).toMatchObject({ selected: null, save: null })
    expect(
      resolveGarmentSubtypeSelection('top', undefined, undefined, {
        ...confidentTank,
        subtype: { value: 'mini-skirt', isConfident: true },
      })
    ).toMatchObject({ selected: undefined, save: undefined })
  })

  it('requires resolving an uncertain result or a new category with incompatible tags', () => {
    expect(
      resolveGarmentSubtypeSelection('top', undefined, undefined, {
        ...confidentTank,
        subtype: { value: 'tank', isConfident: false },
      })
    ).toMatchObject({ selected: undefined, save: undefined })
    expect(
      resolveGarmentSubtypeSelection(
        'bottom',
        'tank',
        { category: 'top', subtype: 'camisole' },
        confidentTank
      )
    ).toEqual({
      options: ['mini-skirt', 'midi-skirt', 'maxi-skirt', 'leggings'],
      selected: undefined,
      save: undefined,
    })
  })

  it('leaves subtype optional in manual mode, on a legacy response, and for dresses', () => {
    expect(resolveGarmentSubtypeSelection('top', undefined)).toMatchObject({
      selected: null,
      save: undefined,
    })
    expect(
      resolveGarmentSubtypeSelection('top', undefined, undefined, {
        category: { value: 'top' },
      })
    ).toMatchObject({ selected: null, save: undefined })
    expect(
      resolveGarmentSubtypeSelection('dress', undefined, undefined, {
        category: { value: 'dress' },
        subtype: { value: null, isConfident: true },
      })
    ).toEqual({ options: [], selected: null, save: undefined })
    expect(resolveGarmentSubtypeSelection(null, undefined)).toEqual({
      options: [],
      selected: null,
      save: undefined,
    })
  })
})

describe('Garment tagging text', () => {
  const english = {
    preview: 'Garment preview',
    pickOne: 'Pick one',
    looksRight: 'Looks right',
  }

  it.each(GUEST_PREVIEW_LOCALES)(
    '%s names the preview, unresolved choice, and confirm action',
    (locale) => {
      const labels = garmentTaggingStrings(locale)
      expect(labels.preview).toMatch(/\S/)
      expect(labels.pickOne).toMatch(/\S/)
      expect(labels.looksRight).toMatch(/\S/)
    }
  )

  it('uses English for an absent or unsupported locale and localized text for Turkish', () => {
    expect(garmentTaggingStrings(undefined)).toEqual(english)
    expect(garmentTaggingStrings('unknown')).toEqual(english)
    expect(garmentTaggingStrings('tr-TR')).toEqual({
      preview: 'Giysi önizlemesi',
      pickOne: 'Birini seç',
      looksRight: 'Doğru görünüyor',
    })
  })
})
