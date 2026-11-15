// Story 6.16 U-CATALOG-STRINGS, U-VOTES progress text and the shared formatter.
import { describe, expect, it } from 'vitest'
import { AGE_GATE_MESSAGES, INVALID_BIRTHDATE_MESSAGE } from '../age'
import { SAMPLE_CATALOG } from './catalog'
import {
  formatPreviewString,
  formatSampleExplanation,
  formatSampleTemperature,
  getGuestPreviewStrings,
  resolveGuestPreviewLocale,
  sampleGarmentText,
  sampleLookText,
} from './format'
import {
  selectSampleOutfit,
  DEFAULT_SAMPLE_COMFORT,
  type SampleExplanation,
} from './selector'
import { GUEST_PREVIEW_LOCALES, GUEST_PREVIEW_STRINGS } from './strings'

function shape(value: unknown, prefix = ''): string[] {
  if (typeof value === 'string') return [prefix]
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    shape(child, prefix ? `${prefix}.${key}` : key)
  )
}

function leaves(value: unknown, prefix = ''): [string, string][] {
  if (typeof value === 'string') return [[prefix, value]]
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    leaves(child, prefix ? `${prefix}.${key}` : key)
  )
}

const placeholders = (text: string) =>
  [...text.matchAll(/\{([a-zA-Z]+)\}/g)].map((m) => m[1]).sort()
const slug = (id: string) => id.slice('sample:x:'.length)
const enUS = GUEST_PREVIEW_STRINGS['en-US']

describe('guest preview strings (U-CATALOG-STRINGS)', () => {
  it('ships the ten supported locales', () => {
    expect([...GUEST_PREVIEW_LOCALES].sort()).toEqual(
      [
        'de-DE',
        'en-CA',
        'en-US',
        'es-419',
        'fr-CA',
        'fr-FR',
        'it-IT',
        'pt-BR',
        'pt-PT',
        'tr-TR',
      ].sort()
    )
    expect(Object.keys(GUEST_PREVIEW_STRINGS).sort()).toEqual(
      [...GUEST_PREVIEW_LOCALES].sort()
    )
  })

  for (const locale of GUEST_PREVIEW_LOCALES) {
    it(`${locale} has the en-US key set, non-empty values and the same placeholders`, () => {
      const strings = GUEST_PREVIEW_STRINGS[locale]
      expect(shape(strings)).toEqual(shape(enUS))
      const source = new Map(leaves(enUS))
      for (const [key, text] of leaves(strings)) {
        expect(text.trim(), `${locale} ${key}`).not.toBe('')
        expect(placeholders(text), `${locale} ${key}`).toEqual(
          placeholders(source.get(key) as string)
        )
      }
    })

    it(`${locale} names and describes every garment and look`, () => {
      const strings = GUEST_PREVIEW_STRINGS[locale]
      for (const item of SAMPLE_CATALOG.garments) {
        const text = sampleGarmentText(item, strings)
        expect(text.name, item.id).not.toBe(item.id)
        expect(text.description, item.id).not.toBe(item.id)
      }
      for (const item of SAMPLE_CATALOG.looks) {
        expect(sampleLookText(item, strings).name, item.id).not.toBe(item.id)
      }
      expect(Object.keys(strings.garments).sort()).toEqual(
        SAMPLE_CATALOG.garments.map((g) => slug(g.id)).sort()
      )
      expect(Object.keys(strings.looks).sort()).toEqual(
        SAMPLE_CATALOG.looks.map((l) => slug(l.id)).sort()
      )
    })

    it(`${locale} renders "3 of 9 reviewed" progress with both numbers (U-VOTES)`, () => {
      const text = formatPreviewString(GUEST_PREVIEW_STRINGS[locale].feedback.progress, {
        reviewed: 3,
        total: 9,
      })
      expect(text).toContain('3')
      expect(text).toContain('9')
      expect(text).not.toMatch(/\{|\}/)
    })
  }

  it('keeps the persistent label and gate copy exactly as specified in en-US', () => {
    expect(enUS.chrome.sampleLabel).toBe(
      'Sample wardrobe. Example weather and outfits, not your closet or live forecast.'
    )
    expect(enUS.chrome.supporting).toBe(
      'Change a preference to see how this example responds.'
    )
    expect(enUS.chrome.conversion).toBe(
      'Create an account to add your clothes. You can choose to save your comfort preferences after signing in. Sample items and preview likes stay in this preview.'
    )
    expect(enUS.gate.underage).toBe(AGE_GATE_MESSAGES.underage)
    expect(enUS.gate.invalid).toBe(INVALID_BIRTHDATE_MESSAGE)
    expect(
      enUS.feedback.progress.replace('{reviewed}', '3').replace('{total}', '9')
    ).toBe('3 of 9 reviewed')
  })

  it('makes no score, popularity, sponsorship or live-weather claim in any locale (U-HONEST)', () => {
    for (const locale of GUEST_PREVIEW_LOCALES) {
      for (const [key, text] of leaves(GUEST_PREVIEW_STRINGS[locale])) {
        expect(text, `${locale} ${key}`).not.toMatch(
          /\d+\s?%\s?match|sponsor|trending|popular/i
        )
      }
    }
  })
})

describe('guest preview formatter', () => {
  it('resolves supported locales and falls back to en-US', () => {
    expect(resolveGuestPreviewLocale('tr-TR')).toBe('tr-TR')
    expect(resolveGuestPreviewLocale('tr')).toBe('en-US')
    expect(resolveGuestPreviewLocale(undefined)).toBe('en-US')
    expect(getGuestPreviewStrings('de-DE')).toBe(GUEST_PREVIEW_STRINGS['de-DE'])
  })

  it('fills placeholders and leaves unknown ones visible', () => {
    expect(formatPreviewString('{a} and {b}', { a: 1 })).toBe('1 and {b}')
    expect(formatPreviewString('plain')).toBe('plain')
  })

  it('shows Fahrenheit for en-US and Celsius elsewhere', () => {
    expect(formatSampleTemperature(16, 'en-US')).toBe('61°F')
    expect(formatSampleTemperature(16, 'en-CA')).toBe('16°C')
    expect(formatSampleTemperature(13, 'fr-FR')).toBe('13°C')
  })

  it('falls back to the id when a garment or look has no text', () => {
    expect(sampleGarmentText({ id: 'sample:g:missing' }, enUS)).toEqual({
      name: 'sample:g:missing',
      description: 'sample:g:missing',
    })
    expect(sampleLookText({ id: 'sample:l:missing' }, enUS).name).toBe('sample:l:missing')
  })

  it('renders every explanation of a real result with no leftover placeholder in every locale', () => {
    const results = [
      selectSampleOutfit(
        {
          weather: 'cool-windy',
          collection: 'all',
          comfort: { ...DEFAULT_SAMPLE_COMFORT, runsColdWarm: 'cold' },
          votes: {},
          swaps: {},
        },
        SAMPLE_CATALOG
      ),
      selectSampleOutfit(
        {
          weather: 'warm-rainy',
          collection: 'menswear',
          comfort: { ...DEFAULT_SAMPLE_COMFORT, precipPreparedness: 'low' },
          votes: { 'sample:l:easy-chinos': 'like' },
          swaps: {},
        },
        SAMPLE_CATALOG
      ),
    ]
    const extra: SampleExplanation[] = [
      { key: 'swap-ignored', params: { category: 'outerwear', cause: 'protection' } },
      {
        key: 'swap-applied',
        params: { category: 'shoes', garmentId: 'sample:g:loafers' },
      },
      { key: 'still-suits', params: { control: 'windTolerance' } },
      { key: 'stale-selection', params: { lookId: 'sample:l:city-wool' } },
      { key: 'all-disliked', params: { collection: 'all' } },
      { key: 'no-eligible', params: { collection: 'womenswear' } },
      { key: 'no-layer', params: { range: 'mild' } },
    ]
    for (const locale of GUEST_PREVIEW_LOCALES) {
      const strings = GUEST_PREVIEW_STRINGS[locale]
      for (const item of [...results.flatMap((result) => result.explanation), ...extra]) {
        const text = formatSampleExplanation(item, {
          strings,
          locale,
          catalog: SAMPLE_CATALOG,
        })
        expect(text, `${locale} ${item.key}`).not.toMatch(
          /\{[a-zA-Z]+\}|undefined|sample:/
        )
      }
    }
  })

  it('renders the en-US explanation of the cold wind example exactly', () => {
    const result = selectSampleOutfit(
      {
        weather: 'cool-windy',
        collection: 'all',
        comfort: { ...DEFAULT_SAMPLE_COMFORT },
        votes: {},
        swaps: {},
      },
      SAMPLE_CATALOG
    )
    const text = result.explanation.map((item) =>
      formatSampleExplanation(item, {
        strings: enUS,
        locale: 'en-US',
        catalog: SAMPLE_CATALOG,
      })
    )
    expect(text).toEqual([
      'Cool and windy example, feels like 48°F.',
      'At about average comfort, that reads as cold weather.',
      'A 10% chance of rain is within your 40%.',
      'Wool overcoat adds warmth below 59°F.',
      'Wool overcoat blocks wind of 6.5 m/s, above your 5 m/s tolerance.',
    ])
  })
})
