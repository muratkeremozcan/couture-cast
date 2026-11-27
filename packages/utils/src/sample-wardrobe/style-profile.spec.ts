// Learning path Step 77: Account style profile.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-77-account-style-profile
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { looksIdeas } from '../looks-feed'
import { SAMPLE_CATALOG } from './catalog'
import { createMemberSampleOutfit } from './member-outfit'
import { garmentSuitsRange, sampleSwapCandidates } from './selector'
import { getStyleProfileStrings } from './style-profile-strings'
import { GUEST_PREVIEW_LOCALES } from './strings'
import {
  activeStyleDay,
  STYLE_PALETTE_SWATCHES,
  styleChoiceGarment,
  styleForecastSampleWeather,
  styleLocalDay,
  styleProfileSelection,
  styleSampleWeather,
  styleTunePatch,
  styleTuneSelected,
  toggleStyleTuneChoice,
  type StyleDay,
  type StyleIllustratedChoice,
  type StyleProfileAnswers,
} from './style-profile'

const EMPTY_PROFILE: StyleProfileAnswers = {
  mood: null,
  palette: null,
  texture: null,
  fit: null,
  avoid: [],
}

describe('CC-7.20 style answers and daily choices', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 10, 21, 12))
  })

  afterEach(() => vi.useRealTimers())

  it('[7.20-RANK] ranks account preferences, honors avoid choices, and restores defaults on clear', () => {
    const profile: StyleProfileAnswers = {
      mood: 'cozy',
      palette: 'colorful',
      texture: 'textured',
      fit: 'fitted',
      avoid: [],
    }
    const clear = createMemberSampleOutfit('mild-dry', { profile: EMPTY_PROFILE })
    expect(clear.look?.id).toBe('sample:l:office-oxford')
    expect(createMemberSampleOutfit('mild-dry', { profile }).look?.id).toBe(
      'sample:l:mini-and-tights'
    )
    expect(looksIdeas({ profile })[0]?.look.id).toBe('sample:l:mini-and-tights')
    expect(looksIdeas({ profile: EMPTY_PROFILE })).toEqual(looksIdeas())

    const avoided = createMemberSampleOutfit('mild-dry', {
      profile: { ...profile, avoid: ['mini-skirt', 'leggings'] },
    })
    const garmentIds = avoided.garments.map(({ id }) => id)
    expect(garmentIds).not.toContain('sample:g:mini-skirt')
    expect(garmentIds).not.toContain('sample:g:leggings')
    expect(avoided.garments.length).toBeGreaterThanOrEqual(2)
    const swapIds = sampleSwapCandidates(SAMPLE_CATALOG, 'bottom', avoided.input).map(
      ({ id }) => id
    )
    expect(swapIds).toContain('sample:g:midi-skirt')
    expect(swapIds).not.toContain('sample:g:mini-skirt')
    expect(swapIds).not.toContain('sample:g:leggings')
  })

  it('[7.20-DAY] changes sample temperature and mood for the active day and keeps real rain eligibility', () => {
    const profile: StyleProfileAnswers = {
      ...EMPTY_PROFILE,
      mood: 'cozy',
      fit: 'relaxed',
    }
    const day: StyleDay = { date: styleLocalDay(), temperature: 'warm', mood: 'active' }
    expect(styleProfileSelection(profile, day)).toEqual({
      preferences: { style: 'active', fit: 'relaxed' },
    })
    const result = createMemberSampleOutfit('cool-rainy', { profile, day })
    expect(result.context.weather).toBe('warm-rainy')
    expect(result.context.rainReady).toBe(true)
    expect(result.look?.preferences?.style).toBe('active')
    expect(result.eligibleLookIds).not.toContain('sample:l:winter-knit')
    expect(result.garments.length).toBeGreaterThanOrEqual(2)
    for (const piece of result.garments) {
      expect(garmentSuitsRange(piece, result.context.range)).toBe(true)
    }
    expect(
      result.garments.find((piece) => piece.category === 'outerwear')?.waterResistant
    ).toBe(true)
    expect(looksIdeas({ profile, day })[0]?.look.preferences?.style).toBe('active')
    expect(styleSampleWeather('warm-rainy', 'cool')).toBe('cool-rainy')
    expect(styleSampleWeather('warm-dry', 'mild')).toBe('mild-dry')
  })

  it('[7.20-DAY] expires exactly at device-local midnight', () => {
    const before = new Date(2026, 10, 20, 23, 59, 59, 999)
    const midnight = new Date(2026, 10, 21)
    const record: StyleDay = { date: '2026-11-20', mood: 'classic', temperature: 'cool' }
    expect(styleLocalDay(before)).toBe('2026-11-20')
    expect(styleLocalDay(midnight)).toBe('2026-11-21')
    expect(activeStyleDay(record, before)).toEqual(record)
    expect(activeStyleDay(record, midnight)).toBeNull()
    expect(activeStyleDay(null, before)).toBeNull()
    expect(createMemberSampleOutfit('mild-dry', { day: record })).toEqual(
      createMemberSampleOutfit('mild-dry')
    )
    expect(looksIdeas({ day: record })).toEqual(looksIdeas())
  })

  it('[7.20-DAY] carries forecast temperature and precipitation into the sample weather', () => {
    expect(styleForecastSampleWeather(null)).toBe('mild-dry')
    expect(styleForecastSampleWeather({ temperature: 3, condition: 'snow' })).toBe(
      'cool-rainy'
    )
    expect(styleForecastSampleWeather({ temperature: 9, condition: 'clouds' })).toBe(
      'cool-windy'
    )
    expect(styleForecastSampleWeather({ temperature: 16, condition: 'drizzle' })).toBe(
      'mild-rainy'
    )
    expect(styleForecastSampleWeather({ temperature: 28, condition: 'clear' })).toBe(
      'warm-dry'
    )
  })

  it('[7.20-NATIVE] maps every illustrated choice to its authored catalog art and defines each swatch', () => {
    const art: Readonly<Record<StyleIllustratedChoice, string>> = {
      active: 'polo-shirt',
      chic: 'silk-blouse',
      cozy: 'cable-knit',
      classic: 'oxford-shirt',
      smooth: 'camisole',
      textured: 'ribbed-knit',
      fitted: 'wool-trousers',
      relaxed: 'linen-trousers',
      'crop-top': 'crop-top',
      'mini-skirt': 'mini-skirt',
      leggings: 'leggings',
    }
    for (const choice of Object.keys(art) as StyleIllustratedChoice[]) {
      expect(styleChoiceGarment(choice).id).toBe(`sample:g:${art[choice]}`)
    }
    for (const swatch of Object.values(STYLE_PALETTE_SWATCHES)) {
      expect(new Set(swatch).size).toBe(3)
      for (const color of swatch) expect(color).toMatch(/^#[a-f0-9]{6}$/i)
    }
  })

  it('[7.20-NATIVE] supplies all choice and action labels in every supported locale', () => {
    const labels = Object.keys(getStyleProfileStrings()) as (keyof ReturnType<
      typeof getStyleProfileStrings
    >)[]
    for (const locale of GUEST_PREVIEW_LOCALES) {
      const strings = getStyleProfileStrings(locale)
      for (const key of labels) expect(strings[key].trim()).not.toBe('')
    }
    expect(getStyleProfileStrings('en-US').classic).toBe('Classic')
    expect(getStyleProfileStrings('tr-TR').classic).toBe('Klasik')
  })

  it('[7.20-TUNE] toggles picture choices and returns only the fields on the completed screen', () => {
    const stored: StyleProfileAnswers = {
      ...EMPTY_PROFILE,
      mood: 'cozy',
      palette: 'neutral',
      avoid: ['leggings'],
    }
    const palette = toggleStyleTuneChoice(stored, 'palette', 'colorful')
    expect(styleTuneSelected(palette, 'palette', 'colorful')).toBe(true)
    expect(styleTunePatch(palette, 0)).toEqual({ palette: 'colorful' })
    expect(toggleStyleTuneChoice(palette, 'palette', 'colorful').palette).toBeNull()

    const texture = toggleStyleTuneChoice(palette, 'texture', 'textured')
    const fit = toggleStyleTuneChoice(texture, 'fit', 'relaxed')
    expect(styleTunePatch(fit, 1)).toEqual({ texture: 'textured', fit: 'relaxed' })

    const avoid = toggleStyleTuneChoice(fit, 'avoid', 'mini-skirt')
    expect(styleTuneSelected(avoid, 'avoid', 'mini-skirt')).toBe(true)
    const removed = toggleStyleTuneChoice(avoid, 'avoid', 'leggings')
    expect(styleTuneSelected(removed, 'avoid', 'leggings')).toBe(false)
    expect(styleTunePatch(removed, 2)).toEqual({ avoid: ['mini-skirt'] })
    expect(stored.avoid).toEqual(['leggings'])
  })
})
