// Learning path Step 31: Outfit capsule builder.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-31-outfit-capsule-builder
import { describe, expect, it } from 'vitest'

import deDE from '../../assets/locales/de-DE.json'
import enCA from '../../assets/locales/en-CA.json'
import enUS from '../../assets/locales/en-US.json'
import es419 from '../../assets/locales/es-419.json'
import frCA from '../../assets/locales/fr-CA.json'
import frFR from '../../assets/locales/fr-FR.json'
import itIT from '../../assets/locales/it-IT.json'
import ptBR from '../../assets/locales/pt-BR.json'
import ptPT from '../../assets/locales/pt-PT.json'
import trTR from '../../assets/locales/tr-TR.json'

type Catalog = Record<string, unknown>

const SUPPORTED_LOCALES = [
  'en-US',
  'en-CA',
  'de-DE',
  'es-419',
  'fr-CA',
  'fr-FR',
  'it-IT',
  'pt-BR',
  'pt-PT',
  'tr-TR',
] as const

type SupportedLocale = (typeof SUPPORTED_LOCALES)[number]

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
 * Cognates that are legitimately spelled identically in some target languages.
 * Listing the expected locales keeps an unlisted match failing as a suspected
 * English fallback.
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

function placeholders(value: string): string[] {
  return [...value.matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1] ?? '').sort()
}

const reference = flatten(capsuleTree(enUS as Catalog))

describe('4.3 mobile wardrobe capsule locale parity', () => {
  it('4.3-I18N-MOB-01 ships 49 capsule keys in the reference catalog', () => {
    expect(reference.size).toBe(49)
  })

  it('4.3-I18N-MOB-02 uses an identical key tree in every locale', () => {
    const expected = [...reference.keys()].sort()
    for (const locale of SUPPORTED_LOCALES) {
      const actual = [...flatten(capsuleTree(CATALOGS[locale])).keys()].sort()
      expect(actual, `${locale} key tree`).toEqual(expected)
    }
  })

  it('4.3-I18N-MOB-03 keeps interpolation placeholders identical across locales', () => {
    for (const locale of SUPPORTED_LOCALES) {
      const catalog = flatten(capsuleTree(CATALOGS[locale]))
      for (const [key, englishValue] of reference) {
        expect(placeholders(catalog.get(key) ?? ''), `${locale}.${key}`).toEqual(
          placeholders(englishValue)
        )
      }
    }
  })

  it('4.3-I18N-MOB-04 provides both plural forms wherever English does', () => {
    const pluralKeys = [...reference.keys()].filter((key) => key.endsWith('_one'))
    expect(pluralKeys.length).toBeGreaterThan(0)

    for (const locale of SUPPORTED_LOCALES) {
      const catalog = flatten(capsuleTree(CATALOGS[locale]))
      for (const oneKey of pluralKeys) {
        expect(catalog.has(oneKey), `${locale}.${oneKey}`).toBe(true)
        expect(
          catalog.has(oneKey.replace(/_one$/, '_other')),
          `${locale} plural other`
        ).toBe(true)
      }
    }
  })

  it('4.3-I18N-MOB-05 does not leave English values in non-English catalogs', () => {
    for (const locale of SUPPORTED_LOCALES.filter((l) => !l.startsWith('en-'))) {
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

  it('4.3-I18N-MOB-06 matches the web catalogs key for key', async () => {
    const web = (await import('../../../web/src/i18n/locales/en-US.json')) as {
      default: Catalog
    }
    expect([...flatten(capsuleTree(web.default)).keys()].sort()).toEqual(
      [...reference.keys()].sort()
    )
  })

  it('4.3-I18N-MOB-07 never ships an empty string', () => {
    for (const locale of SUPPORTED_LOCALES) {
      for (const [key, value] of flatten(capsuleTree(CATALOGS[locale]))) {
        expect(value.trim().length, `${locale}.${key}`).toBeGreaterThan(0)
      }
    }
  })
})
