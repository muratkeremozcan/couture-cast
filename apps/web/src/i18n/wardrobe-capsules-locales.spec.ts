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
  // German says "warm" for the warm comfort range too.
  'comfort.warm': ['de-DE'],
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

/**
 * Story CC-7.9 D9: the capsules screen, the capsule builder and the tag editor read every
 * member-facing string from the catalogs. These are the keys that replaced hard-coded English.
 */
const CC_7_9_CAPSULE_KEYS = [
  'signIn',
  'subtitle',
  'filterOccasionLabel',
  'loading',
  'favoriteCapsule',
  'garmentCount_one',
  'garmentCount_other',
  'status.ready',
  'status.needsRepair',
  'editAction',
  'deleteAction',
  'truncation',
  'cancelDeletion',
  'cancel',
  'builderDescription',
  'repairRemoved_one',
  'repairRemoved_other',
  'reloadLatest',
  'garmentFallback',
  'garmentNoun',
  'untagged',
  'garmentLabel',
  'garmentLabelWithComfort',
  'category.top',
  'category.bottom',
  'category.outerwear',
  'category.dress',
  'category.shoes',
  'category.accessory',
  'comfort.cold',
  'comfort.cool',
  'comfort.mild',
  'comfort.warm',
  'comfort.hot',
] as const

/** Same-spelled words reviewed per locale, as for the capsule tree above. */
const TAG_EDITOR_COGNATES: Record<string, readonly SupportedLocale[]> = {
  'comfort.warm.name': ['de-DE'],
}

function tagEditorTree(catalog: Catalog): Record<string, unknown> {
  const wardrobe = catalog.wardrobe as Record<string, unknown> | undefined
  return (wardrobe?.tagEditor ?? {}) as Record<string, unknown>
}

const tagEditorReference = flatten(tagEditorTree(enUS as Catalog))

describe('CC-7.9 capsules and tag editor strings in the catalogs', () => {
  it('7.9-I18N-WEB-01 ships every new capsule key non-empty in all ten locales', () => {
    for (const locale of SUPPORTED_LOCALES) {
      const catalog = flatten(capsuleTree(CATALOGS[locale]))
      for (const key of CC_7_9_CAPSULE_KEYS) {
        expect(catalog.get(key)?.trim() ?? '', `${locale}.${key}`).not.toBe('')
      }
    }
  })

  it('7.9-I18N-WEB-02 translates every new capsule key for de-DE', () => {
    const german = flatten(capsuleTree(CATALOGS['de-DE']))
    const untranslated = CC_7_9_CAPSULE_KEYS.filter(
      (key) =>
        !APPROVED_COGNATES[key]?.includes('de-DE') &&
        german.get(key) === reference.get(key)
    )
    expect(untranslated).toEqual([])
  })

  it('7.9-I18N-WEB-03 ships the same tag editor key tree, non-empty, in every locale', () => {
    const expected = [...tagEditorReference.keys()].sort()
    expect(expected).toContain('title')
    expect(expected).toContain('comfort.hot.label')
    for (const locale of SUPPORTED_LOCALES) {
      const catalog = flatten(tagEditorTree(CATALOGS[locale]))
      expect([...catalog.keys()].sort(), `${locale} key tree`).toEqual(expected)
      for (const [key, value] of catalog) {
        expect(value.trim().length, `${locale}.${key}`).toBeGreaterThan(0)
        expect(placeholders(value), `${locale}.${key}`).toEqual(
          placeholders(tagEditorReference.get(key) ?? '')
        )
      }
    }
  })

  it('7.9-I18N-WEB-04 leaves no English tag editor value in a non-English catalog', () => {
    const nonEnglish = SUPPORTED_LOCALES.filter((locale) => !locale.startsWith('en-'))
    for (const locale of nonEnglish) {
      const catalog = flatten(tagEditorTree(CATALOGS[locale]))
      const untranslated = [...tagEditorReference.entries()]
        .filter(
          ([key, englishValue]) =>
            !TAG_EDITOR_COGNATES[key]?.includes(locale) &&
            catalog.get(key) === englishValue
        )
        .map(([key]) => key)
      expect(untranslated, `${locale} untranslated keys`).toEqual([])
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
