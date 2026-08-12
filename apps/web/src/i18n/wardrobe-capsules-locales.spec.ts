// Learning path Step 31: Outfit capsule builder.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-31-outfit-capsule-builder
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  resolveSupportedLocale,
  resolveWebLocale,
  type SupportedLocale,
} from './index'

import deDE from './locales/de-DE.json'
import enCA from './locales/en-CA.json'
import enUS from './locales/en-US.json'
import es419 from './locales/es-419.json'
import frCA from './locales/fr-CA.json'
import frFR from './locales/fr-FR.json'
import itIT from './locales/it-IT.json'
import ptBR from './locales/pt-BR.json'
import ptPT from './locales/pt-PT.json'
import trTR from './locales/tr-TR.json'

type Catalog = Record<string, unknown>

const CATALOGS: Record<SupportedLocale, Catalog> = {
  'en-US': enUS as Catalog,
  'en-CA': enCA as Catalog,
  'de-DE': deDE as Catalog,
  'es-419': es419 as Catalog,
  'fr-CA': frCA as Catalog,
  'fr-FR': frFR as Catalog,
  'it-IT': itIT as Catalog,
  'pt-BR': ptBR as Catalog,
  'pt-PT': ptPT as Catalog,
  'tr-TR': trTR as Catalog,
}

/**
 * Cognates that are legitimately spelled identically in some target languages,
 * reviewed and approved rather than left as an English fallback.
 *
 * Each entry lists the locales where the match is expected, so a new identical
 * value in an unlisted locale still fails as a suspected fallback.
 */
const APPROVED_COGNATES: Record<string, readonly SupportedLocale[]> = {
  descriptionLabel: ['fr-FR', 'fr-CA'],
  occasionsLabel: ['fr-FR', 'fr-CA'],
  'occasions.casual': ['it-IT', 'es-419', 'pt-PT', 'pt-BR'],
  'occasions.formal': ['es-419', 'pt-PT', 'pt-BR'],
  'occasions.sport': ['fr-FR', 'fr-CA', 'it-IT', 'de-DE'],
}

function capsuleTree(catalog: Catalog): Record<string, unknown> {
  const wardrobe = catalog.wardrobe as Record<string, unknown> | undefined
  return (wardrobe?.capsules ?? {}) as Record<string, unknown>
}

function flatten(value: unknown, prefix = ''): Map<string, string> {
  const out = new Map<string, string>()
  if (typeof value !== 'object' || value === null) {
    return out
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (typeof child === 'object' && child !== null) {
      for (const [nested, nestedValue] of flatten(child, path)) {
        out.set(nested, nestedValue)
      }
    } else {
      out.set(path, String(child))
    }
  }
  return out
}

/** `{{token}}` placeholders must match exactly, or interpolation breaks. */
function placeholders(value: string): string[] {
  return [...value.matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1] ?? '').sort()
}

const reference = flatten(capsuleTree(enUS as Catalog))

describe('4.3 wardrobe capsule locale parity', () => {
  it('4.3-I18N-WEB-01 ships a capsule tree for every supported locale', () => {
    for (const locale of SUPPORTED_LOCALES) {
      expect(Object.keys(capsuleTree(CATALOGS[locale])).length, locale).toBeGreaterThan(0)
    }
  })

  it('4.3-I18N-WEB-02 uses an identical key tree in every locale', () => {
    const expected = [...reference.keys()].sort()
    for (const locale of SUPPORTED_LOCALES) {
      const actual = [...flatten(capsuleTree(CATALOGS[locale])).keys()].sort()
      expect(actual, `${locale} key tree`).toEqual(expected)
    }
  })

  it('4.3-I18N-WEB-03 keeps interpolation placeholders identical across locales', () => {
    for (const locale of SUPPORTED_LOCALES) {
      const catalog = flatten(capsuleTree(CATALOGS[locale]))
      for (const [key, englishValue] of reference) {
        expect(placeholders(catalog.get(key) ?? ''), `${locale}.${key}`).toEqual(
          placeholders(englishValue)
        )
      }
    }
  })

  it('4.3-I18N-WEB-04 provides both plural forms wherever English does', () => {
    const pluralKeys = [...reference.keys()].filter((key) => key.endsWith('_one'))
    expect(pluralKeys.length).toBeGreaterThan(0)

    for (const locale of SUPPORTED_LOCALES) {
      const catalog = flatten(capsuleTree(CATALOGS[locale]))
      for (const oneKey of pluralKeys) {
        const otherKey = oneKey.replace(/_one$/, '_other')
        expect(catalog.has(oneKey), `${locale}.${oneKey}`).toBe(true)
        expect(catalog.has(otherKey), `${locale}.${otherKey}`).toBe(true)
      }
    }
  })

  /** An untranslated value means the catalog silently fell back to English. */
  it('4.3-I18N-WEB-05 does not leave English values in non-English catalogs', () => {
    const nonEnglish = SUPPORTED_LOCALES.filter((locale) => !locale.startsWith('en-'))

    for (const locale of nonEnglish) {
      const catalog = flatten(capsuleTree(CATALOGS[locale]))
      const untranslated = [...reference.entries()]
        .filter(([key, englishValue]) => {
          if (APPROVED_COGNATES[key]?.includes(locale)) return false
          return catalog.get(key) === englishValue
        })
        .map(([key]) => key)

      expect(untranslated, `${locale} untranslated keys`).toEqual([])
    }
  })

  it('4.3-I18N-WEB-06 never ships an empty string', () => {
    for (const locale of SUPPORTED_LOCALES) {
      for (const [key, value] of flatten(capsuleTree(CATALOGS[locale]))) {
        expect(value.trim().length, `${locale}.${key}`).toBeGreaterThan(0)
      }
    }
  })
})

describe('web locale resolution', () => {
  it('4.3-I18N-WEB-07 prefers an exact supported locale', () => {
    expect(resolveSupportedLocale('pt-BR')).toBe('pt-BR')
    expect(resolveSupportedLocale('fr-CA')).toBe('fr-CA')
    expect(resolveSupportedLocale('en-CA')).toBe('en-CA')
  })

  it('4.3-I18N-WEB-08 normalizes separators and casing', () => {
    expect(resolveSupportedLocale('pt_br')).toBe('pt-BR')
    expect(resolveSupportedLocale('DE-de')).toBe('de-DE')
  })

  it('4.3-I18N-WEB-09 maps an unsupported region to its base language default', () => {
    expect(resolveSupportedLocale('fr-BE')).toBe('fr-FR')
    expect(resolveSupportedLocale('pt-AO')).toBe('pt-PT')
    expect(resolveSupportedLocale('es-MX')).toBe('es-419')
    expect(resolveSupportedLocale('en-GB')).toBe('en-US')
  })

  it('4.3-I18N-WEB-10 returns null for a language we do not ship', () => {
    expect(resolveSupportedLocale('ja-JP')).toBeNull()
  })

  it('4.3-I18N-WEB-11 prefers the saved profile locale over the browser', () => {
    expect(
      resolveWebLocale({ profileLocale: 'tr-TR', browserLanguages: ['fr-FR'] })
    ).toBe('tr-TR')
  })

  it('4.3-I18N-WEB-12 falls back through browser languages then to en-US', () => {
    expect(
      resolveWebLocale({ profileLocale: null, browserLanguages: ['ja-JP', 'it-IT'] })
    ).toBe('it-IT')
    expect(resolveWebLocale({ profileLocale: null, browserLanguages: ['ja-JP'] })).toBe(
      DEFAULT_LOCALE
    )
    expect(resolveWebLocale({})).toBe(DEFAULT_LOCALE)
  })
})
