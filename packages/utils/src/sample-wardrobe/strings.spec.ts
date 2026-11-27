// Learning path Step 56: Guest wardrobe and outfit preview.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-56-guest-wardrobe-and-outfit-preview
// Story 6.16 U-CATALOG-STRINGS, U-VOTES progress text and the shared formatter.
// CC-7.17 copy acceptance: _bmad-output/project-knowledge/learning-path-step-by-step.md#step-74-teen-voice-and-copy
import { describe, expect, it } from 'vitest'
import { AGE_GATE_MESSAGES, INVALID_BIRTHDATE_MESSAGE } from '../age'
import { SAMPLE_CATALOG } from './catalog'
import {
  formatPreviewString,
  formatSampleExplanation,
  formatSampleTemperature,
  getWeatherChance,
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
const adultSituations =
  /\b(?:commut(?:e|es|er|ers|ing)|offices?|meetings?|workdays?|workwear)\b/i

it.each([
  [Number.NaN, 'none'],
  [0.49, 'none'],
  [0.5, 'possible'],
  [49, 'possible'],
  [50, 'likely'],
] as const)(
  '[7.17-COPY-002] turns a %s precipitation chance into %s',
  (percent, chance) => {
    expect(getWeatherChance(percent)).toBe(chance)
  }
)

describe('guest preview strings (U-CATALOG-STRINGS)', () => {
  it.each(['en-US', 'en-CA'] as const)(
    '[7.17-COPY-002] %s catalog names and descriptions use everyday situations',
    (locale) => {
      const strings = getGuestPreviewStrings(locale)
      for (const garment of SAMPLE_CATALOG.garments) {
        const { name, description } = sampleGarmentText(garment, strings)
        expect(`${name} ${description}`, garment.id).not.toMatch(adultSituations)
      }
      for (const look of SAMPLE_CATALOG.looks) {
        const { name, description } = sampleLookText(look, strings)
        expect(`${name} ${description}`, look.id).not.toMatch(adultSituations)
      }
    }
  )

  it.each(['en-US', 'en-CA'] as const)(
    '[7.17-COPY-002] %s saved Oxford look opens with a school-day name and description',
    (locale) => {
      const look = SAMPLE_CATALOG.looks.find(({ id }) => id === 'sample:l:office-oxford')!
      expect(sampleLookText(look, getGuestPreviewStrings(locale))).toEqual({
        name: 'School day',
        description: 'A button-up shirt, dark jeans and loafers for school.',
      })
    }
  )

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
      'Sample looks and weather. Your closet and live weather stay separate.'
    )
    expect(enUS.chrome.supporting).toBe('Change a setting to see a new look.')
    expect(enUS.chrome.conversion).toBe(
      'Make an account to add your clothes. Once you sign in, you can keep your fit and weather settings. Your sample pieces and likes stay here.'
    )
    expect(enUS.gate.underage).toBe(AGE_GATE_MESSAGES.underage)
    expect(enUS.gate.invalid).toBe(INVALID_BIRTHDATE_MESSAGE)
    expect(
      enUS.feedback.progress.replace('{reviewed}', '3').replace('{total}', '9')
    ).toBe('3 of 9 reviewed')
  })

  // Owner report 2026-11-16: a signed-in member saw only Start signup and Sign in on the web
  // landing. Its member actions read these two strings, translated in every locale.
  it('names the member landing actions exactly, and no locale falls back to English', () => {
    const expected = {
      'en-US': ['Open your wardrobe', 'Sign out'],
      'en-CA': ['Open your wardrobe', 'Sign out'],
      'de-DE': ['Ihren Kleiderschrank öffnen', 'Abmelden'],
      'es-419': ['Abrir tu guardarropa', 'Cerrar sesión'],
      'fr-CA': ['Ouvrir votre garde-robe', 'Se déconnecter'],
      'fr-FR': ['Ouvrir votre garde-robe', 'Se déconnecter'],
      'it-IT': ['Apri il tuo guardaroba', 'Esci'],
      'pt-BR': ['Abrir seu guarda-roupa', 'Sair'],
      'pt-PT': ['Abrir o seu roupeiro', 'Terminar sessão'],
      'tr-TR': ['Gardırobunuzu açın', 'Oturumu kapat'],
    } as const
    expect(Object.keys(expected).sort()).toEqual([...GUEST_PREVIEW_LOCALES].sort())
    for (const [locale, [openWardrobe, signOut]] of Object.entries(expected)) {
      const chrome = GUEST_PREVIEW_STRINGS[locale as keyof typeof expected].chrome
      expect([chrome.openWardrobe, chrome.signOut], locale).toEqual([
        openWardrobe,
        signOut,
      ])
      if (!locale.startsWith('en-')) {
        expect(chrome.openWardrobe, locale).not.toBe(enUS.chrome.openWardrobe)
        expect(chrome.signOut, locale).not.toBe(enUS.chrome.signOut)
      }
    }
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
      'Rain may fall. You can skip your rain gear.',
      'Wool overcoat adds warmth below 59°F.',
      'Wool overcoat blocks wind of 6.5 m/s, above your 5 m/s tolerance.',
    ])
  })
})
