// Learning path Step 33: Affiliate "Shop this look" CTA.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-33-affiliate-shop-this-look-cta
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
 * Nothing in the commerce tree qualifies today: every non-English value differs
 * from its English source. The map stays so that a future addition which does
 * collide has to be declared here rather than quietly weakening the rule below.
 */
const APPROVED_COGNATES: Record<string, readonly SupportedLocale[]> = {}

function commerceTree(catalog: Catalog): Record<string, unknown> {
  // Story 5.2 nests its keys under `commerce.premium` and ships its own parity
  // spec (`premium-locales.spec.ts`). Excluding the subtree here keeps this
  // file the 5.1 affiliate suite: one spec owns each key set.
  const commerce = (catalog.commerce ?? {}) as Record<string, unknown>
  return Object.fromEntries(Object.entries(commerce).filter(([key]) => key !== 'premium'))
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

const reference = flatten(commerceTree(enUS as Catalog))

describe('5.1 mobile commerce locale parity', () => {
  it('5.1-I18N-MOB-01 ships 13 commerce keys in the reference catalog', () => {
    // Twelve at story 5.1, plus `settings.loadError`. Web carries fourteen: it
    // also has `settings.signedOutHint`, which mobile has no use for because
    // its settings screen is unreachable without a session.
    expect(reference.size).toBe(13)
  })

  it('5.1-I18N-MOB-02 uses an identical key tree in every locale', () => {
    const expected = [...reference.keys()].sort()
    for (const locale of SUPPORTED_LOCALES) {
      const actual = [...flatten(commerceTree(CATALOGS[locale])).keys()].sort()
      expect(actual, `${locale} key tree`).toEqual(expected)
    }
  })

  it('5.1-I18N-MOB-03 keeps interpolation placeholders identical across locales', () => {
    for (const locale of SUPPORTED_LOCALES) {
      const catalog = flatten(commerceTree(CATALOGS[locale]))
      for (const [key, englishValue] of reference) {
        expect(placeholders(catalog.get(key) ?? ''), `${locale}.${key}`).toEqual(
          placeholders(englishValue)
        )
      }
    }
  })

  it('5.1-I18N-MOB-04 keeps the partner name interpolated rather than hard-coded', () => {
    // Every locale has to route the partner through the placeholder. A catalog
    // that dropped it would name whichever partner the translator happened to
    // see, on every card.
    for (const locale of SUPPORTED_LOCALES) {
      const value = flatten(commerceTree(CATALOGS[locale])).get(
        'shopThisLook.partnerLabel'
      )
      expect(value, `${locale} partnerLabel`).toContain('{{partner}}')
    }
  })

  it('5.1-I18N-MOB-05 does not leave English values in non-English catalogs', () => {
    for (const locale of SUPPORTED_LOCALES.filter((l) => !l.startsWith('en-'))) {
      const catalog = flatten(commerceTree(CATALOGS[locale]))
      const untranslated = [...reference.entries()]
        .filter(([key, englishValue]) => {
          if (APPROVED_COGNATES[key]?.includes(locale)) return false
          return catalog.get(key) === englishValue
        })
        .map(([key]) => key)

      expect(untranslated, `${locale} untranslated keys`).toEqual([])
    }
  })

  it('5.1-I18N-MOB-06 never ships an empty string', () => {
    for (const locale of SUPPORTED_LOCALES) {
      for (const [key, value] of flatten(commerceTree(CATALOGS[locale]))) {
        expect(value.trim().length, `${locale}.${key}`).toBeGreaterThan(0)
      }
    }
  })

  it('5.1-I18N-MOB-07 keeps both disclosures present and substantive in every locale', () => {
    // These two strings are the compliance surface: PRD FR5.1 accepts only a
    // disclosure visible before the click, and NFR Security 4 requires the
    // settings paragraph. A locale that shipped a stub for either would pass
    // every other check in this file.
    for (const locale of SUPPORTED_LOCALES) {
      const catalog = flatten(commerceTree(CATALOGS[locale]))
      expect(
        (catalog.get('shopThisLook.disclosure') ?? '').length,
        `${locale} CTA disclosure`
      ).toBeGreaterThan(20)
      expect(
        (catalog.get('settings.disclosure') ?? '').length,
        `${locale} settings disclosure`
      ).toBeGreaterThan(80)
    }
  })
})
