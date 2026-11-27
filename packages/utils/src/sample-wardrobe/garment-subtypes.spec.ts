// Learning path Step 76: Garment subtypes.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-76-garment-subtypes
import { describe, expect, it } from 'vitest'
import {
  GARMENT_SUBTYPES,
  filterCloset,
  garmentSubtypesForCategory,
  garmentSubtypeStrings,
} from '../index'
import { SAMPLE_CATALOG } from './catalog'
import {
  COMMUNITY_SAMPLE_WEATHER_KEYS,
  DEFAULT_SAMPLE_COMFORT,
  SAMPLE_WEATHER_KEYS,
  selectSampleOutfit,
  type SampleWeatherKey,
} from './selector'
import { GUEST_PREVIEW_LOCALES } from './strings'
import { stylePieceLooks } from './style-one-piece'
import type { SampleCatalog } from './types'

const taxonomy = {
  top: ['camisole', 'tank', 'crop-top'],
  bottom: ['mini-skirt', 'midi-skirt', 'maxi-skirt', 'leggings'],
  shoes: ['moto-boots', 'ankle-boots', 'knee-boots'],
  outerwear: ['blazer', 'moto-jacket'],
  accessory: ['tights', 'socks'],
  dress: [],
} as const

const weatherPresets = [...SAMPLE_WEATHER_KEYS, ...COMMUNITY_SAMPLE_WEATHER_KEYS]

function sampleInput(weather: SampleWeatherKey) {
  return {
    weather,
    collection: 'all' as const,
    comfort: DEFAULT_SAMPLE_COMFORT,
    votes: {},
    swaps: {},
  }
}

function selectableOutfits(input: ReturnType<typeof sampleInput>) {
  const { eligibleLookIds } = selectSampleOutfit(input, SAMPLE_CATALOG)
  return eligibleLookIds.map((selectedLookId) =>
    selectSampleOutfit({ ...input, selectedLookId }, SAMPLE_CATALOG)
  )
}

describe('[7.19-CATALOG] sample garment subtypes', () => {
  it('defines the agreed subtype ids and scopes each to one category', () => {
    expect([...GARMENT_SUBTYPES].sort()).toEqual(Object.values(taxonomy).flat().sort())
    for (const category of Object.keys(taxonomy) as (keyof typeof taxonomy)[]) {
      expect([...garmentSubtypesForCategory(category)].sort(), category).toEqual(
        [...taxonomy[category]].sort()
      )
    }
  })

  it.each(weatherPresets)('%s has complete sample looks with typed pieces', (weather) => {
    const outfits = selectableOutfits(sampleInput(weather))
    const subtypes = new Set<string>()
    expect(outfits.length).toBeGreaterThanOrEqual(2)
    for (const { look, garments } of outfits) {
      const categories = garments.map(({ category }) => category)
      const core = categories.includes('dress')
        ? ['dress', 'shoes']
        : ['top', 'bottom', 'shoes']
      expect(categories, look?.id).toEqual(expect.arrayContaining(core))
      for (const garment of garments) {
        if (garment.subtype) subtypes.add(garment.subtype)
      }
    }
    expect(subtypes.size).toBeGreaterThanOrEqual(2)
  })

  it('renders every subtype in at least one weather-eligible sample look', () => {
    const inputs = weatherPresets.flatMap((weather) =>
      (['cold', 'neutral', 'warm'] as const).map((runsColdWarm) => ({
        ...sampleInput(weather),
        comfort: {
          ...DEFAULT_SAMPLE_COMFORT,
          runsColdWarm,
          windTolerance: 'high' as const,
        },
      }))
    )
    const renderedGarments = inputs.flatMap((input) =>
      selectableOutfits(input).flatMap(({ garments }) => garments)
    )
    const renderedSubtypes = new Set(
      renderedGarments.flatMap(({ subtype }) => (subtype ? [subtype] : []))
    )
    expect([...renderedSubtypes].sort()).toEqual([...GARMENT_SUBTYPES].sort())
  })
})

describe('[7.19-CLOSET] subtype filters', () => {
  const legacy = { id: 'legacy', category: 'bottom', subtype: null } as const
  const midi = { id: 'midi', category: 'bottom', subtype: 'midi-skirt' } as const

  it('shows localized subtype chips only when the category has typed pieces', () => {
    const filter = { category: 'bottom', subtype: 'all' } as const
    const locale = 'fr-FR'
    const withoutSubtypes = filterCloset([legacy], filter, locale, 'Tout')
    expect(withoutSubtypes.filterChips.map(({ id }) => id)).toEqual([
      'closet-category-all',
      'closet-category-bottom',
    ])
    expect(withoutSubtypes.filteredGarments).toEqual([legacy])

    const withSubtype = filterCloset(
      [legacy, midi],
      { ...filter, subtype: midi.subtype },
      locale,
      'Tout'
    )
    expect(withSubtype.filterChips).toContainEqual(
      expect.objectContaining({
        id: 'closet-subtype-midi-skirt',
        label: 'Jupe midi',
        selected: true,
      })
    )
    expect(withSubtype.filteredGarments).toEqual([midi])
  })

  it('falls back to all items in the category when a subtype disappears', () => {
    const result = filterCloset(
      [legacy, midi],
      { category: 'bottom', subtype: 'mini-skirt' },
      'en-US',
      'All'
    )
    expect(result.filterChips).toContainEqual(
      expect.objectContaining({ id: 'closet-subtype-all', selected: true })
    )
    expect(result.filteredGarments).toEqual([legacy, midi])
  })
})

describe('[7.19-LOCALE] garment subtype labels', () => {
  it.each(GUEST_PREVIEW_LOCALES)('%s names every subtype and its controls', (locale) => {
    const { label, none, all, values } = garmentSubtypeStrings(locale)
    expect([label, none, all].every((text) => text.trim().length > 0)).toBe(true)
    expect(Object.keys(values).sort()).toEqual([...GARMENT_SUBTYPES].sort())
    for (const id of GARMENT_SUBTYPES) {
      expect(values[id].trim(), id).toBeTruthy()
      expect(values[id], id).not.toBe(id)
    }
  })

  it.each(GUEST_PREVIEW_LOCALES.filter((locale) => !locale.startsWith('en-')))(
    '%s provides localized subtype controls',
    (locale) => {
      expect(garmentSubtypeStrings(locale).all).not.toBe(
        garmentSubtypeStrings('en-US').all
      )
    }
  )
})

it('[7.19-GENERATE] Style this piece prefers the look with the matching anchor subtype', () => {
  const catalog: SampleCatalog = {
    ...SAMPLE_CATALOG,
    looks: [
      { ...SAMPLE_CATALOG.looks.find(({ id }) => id === 'sample:l:office-oxford')! },
      {
        ...SAMPLE_CATALOG.looks.find(({ id }) => id === 'sample:l:easy-chinos')!,
        core: ['sample:g:cotton-tee', 'sample:g:chinos', 'sample:g:white-sneakers'],
      },
    ],
    garments: SAMPLE_CATALOG.garments.map((garment) =>
      garment.id === 'sample:g:cotton-tee' ? { ...garment, subtype: 'tank' } : garment
    ),
  }
  const anchor = { category: 'top', comfortRange: 'mild' } as const
  const lookIds = (subtype?: 'tank') =>
    stylePieceLooks({ ...anchor, subtype }, 'mild-dry', catalog).looks.map(
      ({ recipe }) => recipe.lookId
    )

  expect(lookIds()).toEqual(['sample:l:office-oxford', 'sample:l:easy-chinos'])
  expect(lookIds('tank')).toEqual(['sample:l:easy-chinos', 'sample:l:office-oxford'])
})
