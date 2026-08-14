// Story 5.2 Task 7 owner: ten-locale parity for the `commerce.premium.*` tree.
//
// The premium namespace lives under `commerce.premium` (Decision 12a), but its
// parity harness is this file, not `commerce-locales.spec.ts` — that spec pins
// the 5.1 key set exactly and excludes this subtree. The key list below is the
// Decision 12a enumeration: the shared surface keys plus the three web-only
// keys (`signedOutHint`, `plannerLocked.title`, `plannerLocked.cta`). The
// mobile-only `unavailableInBuild` key deliberately has no web entry.
//
// All non-English values are machine-translation drafts pending human review
// before release (AC 7 / PRD NFR Localization 1) — the parity checks hold the
// tree together until that review lands.
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

const NON_ENGLISH_LOCALES = SUPPORTED_LOCALES.filter(
  (locale) => !locale.startsWith('en-')
)

/**
 * Cognates that are legitimately spelled identically in some target languages,
 * reviewed and approved rather than left as an English fallback. "Premium" is
 * the product name and a cognate in every shipped locale, so the bare
 * `sectionTitle` is identical everywhere by design. An entry here is an
 * admission, so keep the list this small.
 */
const APPROVED_COGNATES: Record<string, readonly SupportedLocale[]> = {
  sectionTitle: NON_ENGLISH_LOCALES,
}

function premiumTree(catalog: Catalog): Record<string, unknown> {
  const commerce = (catalog.commerce ?? {}) as Record<string, unknown>
  return (commerce.premium ?? {}) as Record<string, unknown>
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

const reference = flatten(premiumTree(enUS as Catalog))

describe('5.2 premium locale parity (web)', () => {
  it('5.2-I18N-WEB-01 ships a premium tree for every supported locale', () => {
    for (const locale of SUPPORTED_LOCALES) {
      expect(Object.keys(premiumTree(CATALOGS[locale])).length, locale).toBeGreaterThan(0)
    }
  })

  it('5.2-I18N-WEB-02 uses an identical key tree in every locale', () => {
    const expected = [...reference.keys()].sort()
    for (const locale of SUPPORTED_LOCALES) {
      const actual = [...flatten(premiumTree(CATALOGS[locale])).keys()].sort()
      expect(actual, `${locale} key tree`).toEqual(expected)
    }
  })

  /**
   * Decision 12a fixes this tree. Pinning the exact key set means a later
   * rename or a quiet drop of the disclosure copy fails here rather than in a
   * released build. The mobile-only `unavailableInBuild` key is asserted
   * absent by this very list.
   */
  it('5.2-I18N-WEB-03 carries exactly the keys Decision 12a specifies for web', () => {
    expect([...reference.keys()].sort()).toEqual([
      'activating',
      'disclosure',
      'endedNote',
      'errorLoad',
      'errorPurchase',
      'graceBanner',
      'manage',
      'manageInStore',
      'pendingApproval',
      'planAnnual',
      'planMonthly',
      'plannerLocked.cta',
      'plannerLocked.title',
      'portalLagHint',
      'restore',
      'sectionTitle',
      'signedOutHint',
      'status.active',
      'status.expired',
      'status.gracePeriod',
      'status.none',
      'status.revoked',
      'stillProcessing',
      'subscribe',
    ])
  })

  it('5.2-I18N-WEB-04 keeps interpolation placeholders identical across locales', () => {
    for (const locale of SUPPORTED_LOCALES) {
      const catalog = flatten(premiumTree(CATALOGS[locale]))
      for (const [key, englishValue] of reference) {
        expect(placeholders(catalog.get(key) ?? ''), `${locale}.${key}`).toEqual(
          placeholders(englishValue)
        )
      }
    }
  })

  /** An untranslated value means the catalog silently fell back to English. */
  it('5.2-I18N-WEB-05 does not leave English values in non-English catalogs', () => {
    for (const locale of NON_ENGLISH_LOCALES) {
      const catalog = flatten(premiumTree(CATALOGS[locale]))
      const untranslated = [...reference.entries()]
        .filter(([key, englishValue]) => {
          if (APPROVED_COGNATES[key]?.includes(locale)) return false
          return catalog.get(key) === englishValue
        })
        .map(([key]) => key)

      expect(untranslated, `${locale} untranslated keys`).toEqual([])
    }
  })

  it('5.2-I18N-WEB-06 never ships an empty string', () => {
    for (const locale of SUPPORTED_LOCALES) {
      for (const [key, value] of flatten(premiumTree(CATALOGS[locale]))) {
        expect(value.trim().length, `${locale}.${key}`).toBeGreaterThan(0)
      }
    }
  })

  /**
   * The disclosure is the compliance copy AC 7 and PRD NFR Security 4 turn on:
   * it must name both processors and stay substantive in every locale. A
   * truncated translation is the realistic way this regresses.
   */
  it('5.2-I18N-WEB-07 keeps the processor disclosure substantive in every locale', () => {
    for (const locale of SUPPORTED_LOCALES) {
      const catalog = flatten(premiumTree(CATALOGS[locale]))
      const disclosure = catalog.get('disclosure') ?? ''
      expect(disclosure.length, `${locale} disclosure length`).toBeGreaterThan(120)
      expect(
        disclosure.includes('RevenueCat'),
        `${locale} disclosure names RevenueCat`
      ).toBe(true)
      expect(disclosure.includes('Stripe'), `${locale} disclosure names Stripe`).toBe(
        true
      )
      expect(
        disclosure.includes('CoutureCast'),
        `${locale} disclosure names the product`
      ).toBe(true)
    }
  })
})
