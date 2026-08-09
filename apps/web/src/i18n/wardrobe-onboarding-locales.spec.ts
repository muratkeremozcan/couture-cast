import { describe, expect, it } from 'vitest'
import { SUPPORTED_LOCALES, type SupportedLocale } from './index'

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
  'silhouette.title': ['de-DE', 'fr-FR', 'fr-CA', 'it-IT'],
}

function onboardingSilhouetteTree(catalog: Catalog): Record<string, unknown> {
  const wardrobe = catalog.wardrobe as Record<string, unknown> | undefined
  return {
    onboarding: wardrobe?.onboarding ?? {},
    silhouette: wardrobe?.silhouette ?? {},
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

/** `{{token}}` placeholders must match exactly, or interpolation breaks. */
function placeholders(value: string): string[] {
  return [...value.matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1] ?? '').sort()
}

const reference = flatten(onboardingSilhouetteTree(enUS as Catalog))

describe('4.4 wardrobe onboarding & silhouette locale parity', () => {
  it('4.4-I18N-WEB-01 ships an onboarding and silhouette tree for every supported locale', () => {
    for (const locale of SUPPORTED_LOCALES) {
      const tree = flatten(onboardingSilhouetteTree(CATALOGS[locale]))
      expect(tree.size, locale).toBeGreaterThan(0)
    }
  })

  it('4.4-I18N-WEB-02 uses an identical key tree in every locale', () => {
    const expected = [...reference.keys()].sort()
    for (const locale of SUPPORTED_LOCALES) {
      const actual = [
        ...flatten(onboardingSilhouetteTree(CATALOGS[locale])).keys(),
      ].sort()
      expect(actual, `${locale} key tree`).toEqual(expected)
    }
  })

  it('4.4-I18N-WEB-03 keeps interpolation placeholders identical across locales', () => {
    for (const locale of SUPPORTED_LOCALES) {
      const catalog = flatten(onboardingSilhouetteTree(CATALOGS[locale]))
      for (const [key, englishValue] of reference) {
        expect(placeholders(catalog.get(key) ?? ''), `${locale}.${key}`).toEqual(
          placeholders(englishValue)
        )
      }
    }
  })

  /** An untranslated value means the catalog silently fell back to English. */
  it('4.4-I18N-WEB-04 does not leave English values in non-English catalogs', () => {
    const nonEnglish = SUPPORTED_LOCALES.filter((locale) => !locale.startsWith('en-'))

    for (const locale of nonEnglish) {
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

  it('4.4-I18N-WEB-05 never ships an empty string', () => {
    for (const locale of SUPPORTED_LOCALES) {
      for (const [key, value] of flatten(onboardingSilhouetteTree(CATALOGS[locale]))) {
        expect(value.trim().length, `${locale}.${key}`).toBeGreaterThan(0)
      }
    }
  })

  it('4.4-I18N-WEB-06 matches the canonical en-US source strings from the story', () => {
    const onboarding = (enUS as Catalog).wardrobe as Record<string, unknown>
    const tree = onboarding.onboarding as Record<string, unknown>
    expect(tree.title).toBe('Set up your closet')
    expect(tree.checklistTagged).toBe('{{garment}}: tags confirmed')
    const errors = tree.errors as Record<string, unknown>
    expect(errors.stale).toBe(
      'This step changed elsewhere. Review the latest version and try again.'
    )
  })
})
