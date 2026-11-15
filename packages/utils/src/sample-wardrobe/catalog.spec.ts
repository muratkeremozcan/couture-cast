// Learning path Step 56: Guest wardrobe and outfit preview.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-56-guest-wardrobe-and-outfit-preview
// Story 6.16 U-CATALOG-COMPLETE, U-CATALOG-FIXTURE-REACH and the art fallback.
import { describe, expect, it } from 'vitest'
import {
  resolveSampleArt,
  SAMPLE_ART,
  SAMPLE_CATEGORY_FALLBACK_ART,
  SAMPLE_FALLBACK_COLORS,
} from './art'
import { SAMPLE_CATALOG, SAMPLE_CATALOG_VERSION } from './catalog'
import { SAMPLE_WEATHER_KEYS, selectSampleOutfit } from './selector'
import {
  SAMPLE_ART_KEYS,
  SAMPLE_COLLECTION_FILTERS,
  SAMPLE_GARMENT_CATEGORIES,
  sampleCatalogSchema,
} from './types'

const garments = new Map(SAMPLE_CATALOG.garments.map((garment) => [garment.id, garment]))
const TOLERANCES = ['low', 'medium', 'high'] as const
const RUNS = ['cold', 'neutral', 'warm'] as const

describe('sample catalog (6.16 U-CATALOG-COMPLETE)', () => {
  it('parses against the strict catalog schema', () => {
    expect(sampleCatalogSchema.parse(SAMPLE_CATALOG)).toEqual(SAMPLE_CATALOG)
    expect(SAMPLE_CATALOG.catalogVersion).toBe(SAMPLE_CATALOG_VERSION)
  })

  it('has at least 30 garments, 12 looks and exactly 9 feedback cards', () => {
    expect(SAMPLE_CATALOG.garments.length).toBeGreaterThanOrEqual(30)
    expect(SAMPLE_CATALOG.looks.length).toBeGreaterThanOrEqual(12)
    expect(SAMPLE_CATALOG.looks.filter((look) => look.feedbackCard)).toHaveLength(9)
  })

  it('uses unique ids that all resolve', () => {
    const ids = [...SAMPLE_CATALOG.garments, ...SAMPLE_CATALOG.looks].map(
      (item) => item.id
    )
    expect(new Set(ids).size).toBe(ids.length)
    for (const look of SAMPLE_CATALOG.looks) {
      for (const id of look.core)
        expect(garments.has(id), `${look.id} -> ${id}`).toBe(true)
    }
  })

  it('gives every look a complete core and no outerwear', () => {
    for (const look of SAMPLE_CATALOG.looks) {
      const categories = look.core.map((id) => garments.get(id)?.category)
      const hasSeparates = categories.includes('top') && categories.includes('bottom')
      const hasDress = categories.includes('dress')
      expect(hasSeparates !== hasDress, look.id).toBe(true)
      expect(
        categories.filter((category) => category === 'shoes'),
        look.id
      ).toHaveLength(1)
      expect(categories, look.id).not.toContain('outerwear')
      expect(new Set(categories).size, look.id).toBe(categories.length)
    }
  })

  it('keeps each look inside the collections its garments belong to', () => {
    for (const look of SAMPLE_CATALOG.looks) {
      for (const collection of look.collections) {
        for (const id of look.core) {
          expect(garments.get(id)?.collections, `${look.id} ${id}`).toContain(collection)
        }
      }
    }
  })

  it('records first-party provenance on every garment', () => {
    for (const garment of SAMPLE_CATALOG.garments) {
      expect(garment.provenance).toEqual({
        authored: 'couture-cast',
        license: 'project-owned',
        story: '6.16',
      })
    }
  })

  it('covers womenswear, menswear and every garment category', () => {
    const lookCollections = SAMPLE_CATALOG.looks.flatMap((look) => look.collections)
    expect(lookCollections).toContain('womenswear')
    expect(lookCollections).toContain('menswear')
    expect(new Set(SAMPLE_CATALOG.garments.map((garment) => garment.category))).toEqual(
      new Set(SAMPLE_GARMENT_CATEGORIES)
    )
  })
})

describe('sample catalog reach (6.16 U-CATALOG-FIXTURE-REACH)', () => {
  for (const collection of SAMPLE_COLLECTION_FILTERS) {
    it(`gives two or more looks and the right layer for every context in ${collection}`, () => {
      for (const weather of SAMPLE_WEATHER_KEYS) {
        for (const runsColdWarm of RUNS) {
          for (const windTolerance of TOLERANCES) {
            for (const precipPreparedness of TOLERANCES) {
              const label = `${collection} ${weather} ${runsColdWarm} ${windTolerance} ${precipPreparedness}`
              const result = selectSampleOutfit(
                {
                  weather,
                  collection,
                  comfort: { runsColdWarm, windTolerance, precipPreparedness },
                  votes: {},
                  swaps: {},
                },
                SAMPLE_CATALOG
              )
              const { coldLayer, windLayer, rainReady } = result.context
              const layer = result.garments.find(
                (garment) => garment.category === 'outerwear'
              )
              expect(result.reason, label).toBe('ok')
              expect(result.eligibleLookIds.length, label).toBeGreaterThanOrEqual(2)
              expect(layer !== undefined, label).toBe(coldLayer || windLayer || rainReady)
              if (windLayer) expect(layer?.windResistant, label).toBe(true)
              if (rainReady) expect(layer?.waterResistant, label).toBe(true)
            }
          }
        }
      }
    })
  }
})

describe('sample art', () => {
  it('draws every art key the schema allows and every garment uses', () => {
    expect(Object.keys(SAMPLE_ART).sort()).toEqual([...SAMPLE_ART_KEYS].sort())
    for (const key of SAMPLE_ART_KEYS) {
      expect(SAMPLE_ART[key].length, key).toBeGreaterThan(0)
      for (const path of SAMPLE_ART[key]) expect(path.d, key).toMatch(/^M[\d .A-Z-]+$/)
    }
    for (const garment of SAMPLE_CATALOG.garments) {
      expect(resolveSampleArt(garment.art, garment.category).fallback, garment.id).toBe(
        false
      )
    }
  })

  it('falls back to the neutral category glyph for an unknown key (W/M-ART-FALLBACK)', () => {
    const resolved = resolveSampleArt(
      { key: 'missing', primary: '#111111', secondary: '#222222' },
      'shoes'
    )
    expect(resolved).toEqual({
      paths: SAMPLE_ART[SAMPLE_CATEGORY_FALLBACK_ART.shoes],
      ...SAMPLE_FALLBACK_COLORS,
      fallback: true,
    })
  })

  it('keeps garment colors when the key resolves', () => {
    const resolved = resolveSampleArt(
      { key: 'tee', primary: '#111111', secondary: '#222222' },
      'top'
    )
    expect(resolved).toEqual({
      paths: SAMPLE_ART.tee,
      primary: '#111111',
      secondary: '#222222',
      fallback: false,
    })
  })
})
