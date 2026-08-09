// Story 4.4 Task 6 owner: locale parity for the new wardrobe.onboarding /
// wardrobe.silhouette key trees, mirroring wardrobe-capsules-locales.spec.ts's
// pattern for Story 4.3's capsule keys.
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
 * "Silhouette" is a French loanword also used unchanged in German and Italian,
 * so those locales legitimately keep the English spelling for that one title.
 */
const APPROVED_COGNATES: Record<string, readonly SupportedLocale[]> = {
  'silhouette.title': ['de-DE', 'fr-CA', 'fr-FR', 'it-IT'],
}

function onboardingSilhouetteTree(catalog: Catalog): Record<string, unknown> {
  const wardrobe = (catalog.wardrobe ?? {}) as Record<string, unknown>
  return {
    onboarding: wardrobe.onboarding ?? {},
    silhouette: wardrobe.silhouette ?? {},
  }
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

const reference = flatten(onboardingSilhouetteTree(enUS as Catalog))

describe('4.4 mobile wardrobe onboarding/silhouette locale parity', () => {
  it('4.4-I18N-MOB-01 ships 32 onboarding + silhouette keys in the reference catalog', () => {
    expect(reference.size).toBe(32)
  })

  it('4.4-I18N-MOB-02 uses an identical key tree in every locale', () => {
    const expected = [...reference.keys()].sort()
    for (const locale of SUPPORTED_LOCALES) {
      const actual = [
        ...flatten(onboardingSilhouetteTree(CATALOGS[locale])).keys(),
      ].sort()
      expect(actual, `${locale} key tree`).toEqual(expected)
    }
  })

  it('4.4-I18N-MOB-03 keeps interpolation placeholders identical across locales', () => {
    for (const locale of SUPPORTED_LOCALES) {
      const catalog = flatten(onboardingSilhouetteTree(CATALOGS[locale]))
      for (const [key, englishValue] of reference) {
        expect(placeholders(catalog.get(key) ?? ''), `${locale}.${key}`).toEqual(
          placeholders(englishValue)
        )
      }
    }
  })

  it('4.4-I18N-MOB-04 does not leave English values in non-English catalogs', () => {
    for (const locale of SUPPORTED_LOCALES.filter((l) => !l.startsWith('en-'))) {
      const catalog = flatten(onboardingSilhouetteTree(CATALOGS[locale]))
      const untranslated = [...reference.entries()]
        .filter(([key, englishValue]) => {
          if (APPROVED_COGNATES[key]?.includes(locale)) return false
          return catalog.get(key) === englishValue
        })
        .map(([key]) => key)

      expect(untranslated, `${locale} untranslated keys`).toEqual([])
    }
  })

  it('4.4-I18N-MOB-05 never ships an empty string', () => {
    for (const locale of SUPPORTED_LOCALES) {
      for (const [key, value] of flatten(onboardingSilhouetteTree(CATALOGS[locale]))) {
        expect(value.trim().length, `${locale}.${key}`).toBeGreaterThan(0)
      }
    }
  })

  it('4.4-I18N-MOB-06 uses the snake_case convention already established on Mobile', () => {
    for (const key of reference.keys()) {
      const segments = key.split('.')
      for (const segment of segments) {
        expect(segment, key).toMatch(/^[a-z][a-z0-9_]*$/)
      }
    }
  })
})
