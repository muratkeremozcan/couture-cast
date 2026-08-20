// Learning path Step 33: Affiliate "Shop this look" CTA.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-33-affiliate-shop-this-look-cta
// Story 5.1 Task 7 owner: ten-locale parity for the `commerce.*` tree.
//
// Nothing audits a new key tree by default in this repo: all the existing
// parity specs are subtree-scoped and hard-coded, so a namespace with no spec
// of its own can silently ship English everywhere. This file is the commerce
// namespace's copy of that harness, following
// `wardrobe-capsules-locales.spec.ts`.
//
// `commerce.settings.signedOutHint` is the one key here that decision 16 does
// not list. Decision 17 requires a localized "Sign in to change this" hint on
// the Web settings section, which is the only surface in this story that has to
// render with no session, so the key exists on Web and has no Mobile
// counterpart.
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
 * reviewed and approved rather than left as an English fallback. Empty today:
 * every commerce string has a genuine translation in all nine non-English
 * catalogs. An entry here is an admission, so keep it that way.
 */
const APPROVED_COGNATES: Record<string, readonly SupportedLocale[]> = {}

function commerceTree(catalog: Catalog): Record<string, unknown> {
  // Story 5.2 nests its `premium` namespace under `commerce.*` (Decision 12a)
  // but audits it in `premium-locales.spec.ts`; this spec keeps pinning the
  // 5.1 key set exactly, so the subtree is excluded rather than absorbed.
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

/** `{{token}}` placeholders must match exactly, or interpolation breaks. */
function placeholders(value: string): string[] {
  return [...value.matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1] ?? '').sort()
}

const reference = flatten(commerceTree(enUS as Catalog))

describe('5.1 commerce locale parity', () => {
  it('5.1-I18N-WEB-01 ships a commerce tree for every supported locale', () => {
    for (const locale of SUPPORTED_LOCALES) {
      expect(Object.keys(commerceTree(CATALOGS[locale])).length, locale).toBeGreaterThan(
        0
      )
    }
  })

  it('5.1-I18N-WEB-02 uses an identical key tree in every locale', () => {
    const expected = [...reference.keys()].sort()
    for (const locale of SUPPORTED_LOCALES) {
      const actual = [...flatten(commerceTree(CATALOGS[locale])).keys()].sort()
      expect(actual, `${locale} key tree`).toEqual(expected)
    }
  })

  /**
   * The story fixes this tree in decision 16, plus the Web-only signed-out
   * hint. Pinning the exact key set means a later rename or a quiet drop of the
   * disclosure copy fails here rather than in a released build.
   */
  it('5.1-I18N-WEB-03 carries exactly the keys decisions 16 and 17 specify', () => {
    expect([...reference.keys()].sort()).toEqual([
      'settings.disclosure',
      'settings.error',
      'settings.loadError',
      'settings.optOutHelp',
      'settings.optOutLabel',
      'settings.saved',
      'settings.sectionTitle',
      'settings.signedOutHint',
      'shopThisLook.cta',
      'shopThisLook.disclosure',
      'shopThisLook.error',
      'shopThisLook.loading',
      'shopThisLook.opensInBrowser',
      'shopThisLook.partnerLabel',
    ])
  })

  it('5.1-I18N-WEB-04 keeps interpolation placeholders identical across locales', () => {
    for (const locale of SUPPORTED_LOCALES) {
      const catalog = flatten(commerceTree(CATALOGS[locale]))
      for (const [key, englishValue] of reference) {
        expect(placeholders(catalog.get(key) ?? ''), `${locale}.${key}`).toEqual(
          placeholders(englishValue)
        )
      }
    }
  })

  /** An untranslated value means the catalog silently fell back to English. */
  it('5.1-I18N-WEB-05 does not leave English values in non-English catalogs', () => {
    const nonEnglish = SUPPORTED_LOCALES.filter((locale) => !locale.startsWith('en-'))

    for (const locale of nonEnglish) {
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

  it('5.1-I18N-WEB-06 never ships an empty string', () => {
    for (const locale of SUPPORTED_LOCALES) {
      for (const [key, value] of flatten(commerceTree(CATALOGS[locale]))) {
        expect(value.trim().length, `${locale}.${key}`).toBeGreaterThan(0)
      }
    }
  })

  /**
   * The two disclosure strings are the compliance copy PRD FR5.1 and NFR
   * Security 4 turn on. A truncated translation is the realistic way this
   * regresses, so every locale has to name both the commission and the
   * partner-side sharing rather than only one of them.
   */
  it('5.1-I18N-WEB-07 keeps both disclosures substantive in every locale', () => {
    for (const locale of SUPPORTED_LOCALES) {
      const catalog = flatten(commerceTree(CATALOGS[locale]))
      expect(
        (catalog.get('shopThisLook.disclosure') ?? '').length,
        `${locale} CTA disclosure`
      ).toBeGreaterThan(30)
      expect(
        (catalog.get('settings.disclosure') ?? '').length,
        `${locale} settings disclosure`
      ).toBeGreaterThan(120)
      expect(
        (catalog.get('settings.disclosure') ?? '').includes('CoutureCast'),
        `${locale} settings disclosure names the product`
      ).toBe(true)
    }
  })
})
