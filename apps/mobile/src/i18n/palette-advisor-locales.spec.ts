// Learning path Step 36: Colour palette, beauty and accessory advisor.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-36-colour-palette-beauty-and-accessory-advisor
// Story 5.4 Task 8 owner: ten-locale parity for the mobile `commerce.premium.palette.*`
// tree.
//
// The mobile sibling of `apps/web/src/i18n/palette-advisor-locales.spec.ts`, and the
// mobile half of AC 8. Both surfaces ship the same hundred keys with the same copy,
// which is deliberate rather than duplication worth trimming: the consent promise, the
// sponsored disclosure and the forty-four shade names all describe the same server
// behaviour, so copy that drifts on one surface fails on that surface's own spec rather
// than being noticed late by a reader comparing screenshots.
//
// A new feature area gets its own dedicated parity spec rather than an extension of
// `premium-locales.spec.ts` (Decision 15, the same reasoning 5.3 recorded and 5.2 before
// it). The two specs are siblings: `premium-locales.spec.ts` now filters this `palette`
// child out alongside `theme`, so its pinned 5.2 key list keeps meaning exactly what it
// meant before, and this file owns the palette keys outright.
//
// The key set is NOT hand-pinned here. It is derived from the contract itself --
// `PALETTE_ADVISOR_LOCALE_KEYS` plus every `AdvisorRuleEntry.labelKey` in
// `ADVISOR_RULES` -- because the failure this spec exists to catch is drift between the
// rule table and the copy that names its shades. A hand-written list would have to be
// edited in lockstep with the rule table by the same person who forgot to edit the
// catalogs, which is not a check at all. Adding a shade to `ADVISOR_RULES` now fails
// here until all ten catalogs carry its label.
//
// All non-English values are machine-translation drafts pending human review before
// release (AC 8 / PRD NFR Localization 1) — the parity checks hold the tree together
// until that review lands.
import { describe, expect, it } from 'vitest'
import {
  listAdvisorRuleEntries,
  PALETTE_ADVISOR_LOCALE_KEYS,
} from '@couture/api-client/contracts/http'

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

// Listed here rather than imported: the mobile i18n entry point pulls in
// `expo-localization`, which cannot be evaluated under the node test environment.
// `premium-theme-locales.spec.ts` takes the same approach for the same reason.
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

const NON_ENGLISH_LOCALES: readonly SupportedLocale[] = SUPPORTED_LOCALES.filter(
  (locale) => !locale.startsWith('en-')
)

const KEY_PREFIX = 'commerce.premium.palette.'

/**
 * Words that legitimately stay byte-identical to English in a given locale.
 *
 * Every entry is an admission, so the list is kept to the ones a translator would
 * genuinely leave alone: "Blush" is the loanword the beauty industry uses in French,
 * Italian and both Portuguese variants; German writes "Warm", "Neutral" and
 * "Foundation" exactly as English does; and French "Olive" is spelled the same. Nothing
 * here is a shade name left untranslated for convenience -- all forty-four
 * `ADVISOR_RULES` labels are translated in all ten catalogs, which is what makes
 * Decision 6's "no English shade name reaches a component" true on the copy side too.
 */
const APPROVED_COGNATES: Record<string, readonly SupportedLocale[]> = {
  'slot.blush': ['fr-FR', 'fr-CA', 'it-IT', 'pt-BR', 'pt-PT'],
  'slot.foundation': ['de-DE'],
  'undertone.neutral': ['de-DE'],
  'undertone.olive': ['fr-FR', 'fr-CA'],
  'undertone.warm': ['de-DE'],
}

function paletteTree(catalog: Catalog): Record<string, unknown> {
  const commerce = (catalog.commerce ?? {}) as Record<string, unknown>
  const premium = (commerce.premium ?? {}) as Record<string, unknown>
  return (premium.palette ?? {}) as Record<string, unknown>
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

const reference = flatten(paletteTree(enUS as Catalog))

/** Every key the contract says this tree must carry, relative to `commerce.premium.palette.`. */
const CONTRACT_KEYS = [
  ...PALETTE_ADVISOR_LOCALE_KEYS,
  ...listAdvisorRuleEntries().map((entry) => entry.labelKey),
]
  .map((key) => key.replace(KEY_PREFIX, ''))
  .sort()

describe('5.4 palette advisor locale parity (mobile)', () => {
  it('5.4-I18N-MOB-01 ships a palette tree for every supported locale', () => {
    for (const locale of SUPPORTED_LOCALES) {
      expect(Object.keys(paletteTree(CATALOGS[locale])).length, locale).toBeGreaterThan(0)
    }
  })

  it('5.4-I18N-MOB-02 uses an identical key tree in every locale', () => {
    const expected = [...reference.keys()].sort()
    for (const locale of SUPPORTED_LOCALES) {
      const actual = [...flatten(paletteTree(CATALOGS[locale])).keys()].sort()
      expect(actual, `${locale} key tree`).toEqual(expected)
    }
  })

  /**
   * The contract is the source of truth, in both directions.
   *
   * A key added to `PALETTE_ADVISOR_LOCALE_KEYS` or a shade added to `ADVISOR_RULES`
   * fails here until every catalog carries it; a key left in the catalogs after its
   * rule was retired fails here too. Decision 6 makes `labelKey` a locale key rather
   * than a shade name precisely so this check can exist.
   */
  it('5.4-I18N-MOB-03 carries exactly the keys the contract enumerates', () => {
    expect([...reference.keys()].sort()).toEqual(CONTRACT_KEYS)
  })

  it('5.4-I18N-MOB-04 keeps interpolation placeholders identical across locales', () => {
    for (const locale of SUPPORTED_LOCALES) {
      const catalog = flatten(paletteTree(CATALOGS[locale]))
      for (const [key, englishValue] of reference) {
        expect(placeholders(catalog.get(key) ?? ''), `${locale}.${key}`).toEqual(
          placeholders(englishValue)
        )
      }
    }
  })

  /** An untranslated value means the catalog silently fell back to English. */
  it('5.4-I18N-MOB-05 does not leave English values in non-English catalogs', () => {
    for (const locale of NON_ENGLISH_LOCALES) {
      const catalog = flatten(paletteTree(CATALOGS[locale]))
      const untranslated = [...reference.entries()]
        .filter(([key, englishValue]) => {
          if (APPROVED_COGNATES[key]?.includes(locale)) return false
          return catalog.get(key) === englishValue
        })
        .map(([key]) => key)

      expect(untranslated, `${locale} untranslated keys`).toEqual([])
    }
  })

  it('5.4-I18N-MOB-06 never ships an empty string', () => {
    for (const locale of SUPPORTED_LOCALES) {
      for (const [key, value] of flatten(paletteTree(CATALOGS[locale]))) {
        expect(value.trim().length, `${locale}.${key}`).toBeGreaterThan(0)
      }
    }
  })

  /**
   * AC 5/6 and PRD NFR Security 4: a sponsored suggestion needs a disclosure that says
   * money changes hands AND that the reader can switch it off. A translation that
   * shortens it to "Sponsored." satisfies the key-tree check and breaches the
   * guardrail, so both halves are asserted per locale through the words each catalog
   * actually uses.
   */
  it('5.4-I18N-MOB-07 keeps the sponsored disclosure substantive in every locale', () => {
    const COMMISSION_TOKENS: Record<SupportedLocale, string> = {
      'en-US': 'commission',
      'en-CA': 'commission',
      'de-DE': 'Provision',
      'es-419': 'comisión',
      'fr-CA': 'commission',
      'fr-FR': 'commission',
      'it-IT': 'commissione',
      'pt-BR': 'comissão',
      'pt-PT': 'comissão',
      'tr-TR': 'komisyon',
    }

    for (const locale of SUPPORTED_LOCALES) {
      const catalog = flatten(paletteTree(CATALOGS[locale]))
      const disclosure = catalog.get('sponsored.disclosure') ?? ''
      expect(disclosure.length, `${locale} disclosure length`).toBeGreaterThan(100)
      expect(
        disclosure.includes('CoutureCast'),
        `${locale} disclosure names the product`
      ).toBe(true)
      expect(
        disclosure.includes(COMMISSION_TOKENS[locale]),
        `${locale} disclosure says a commission is earned`
      ).toBe(true)
      expect(
        catalog.get('sponsored.partnerLabel')?.includes('{{partner}}'),
        `${locale} partner label interpolates the partner name`
      ).toBe(true)
    }
  })

  /**
   * AC 1: the consent copy is what makes consent informed. It has to say the photo is
   * deleted when the analysis ends, because that is the promise Decision 8 implements
   * and the single fact a reader is most likely to be deciding on.
   */
  it('5.4-I18N-MOB-08 keeps the consent copy substantive in every locale', () => {
    for (const locale of SUPPORTED_LOCALES) {
      const catalog = flatten(paletteTree(CATALOGS[locale]))
      const body = catalog.get('consent.body') ?? ''
      expect(body.length, `${locale} consent body length`).toBeGreaterThan(200)
      expect(
        body.includes('CoutureCast'),
        `${locale} consent body names the product`
      ).toBe(true)
      expect(
        (catalog.get('deleteConfirm') ?? '').length,
        `${locale} delete confirmation length`
      ).toBeGreaterThan(80)
    }
  })

  /**
   * Decision 15: `en-CA` diverges from `en-US` only in spelling, and this story's copy
   * is full of the word "colour". 5.3 shipped "colors" there and had to fix it in
   * review; this is the check that makes that impossible to repeat.
   */
  it('5.4-I18N-MOB-09 uses Canadian spellings in en-CA and American ones in en-US', () => {
    const ca = flatten(paletteTree(enCA as Catalog))
    const us = flatten(paletteTree(enUS as Catalog))

    for (const [locale, catalog, wrong] of [
      ['en-CA', ca, /\bcolors?\b|\banalyz|\bcentered\b|\bgray\b|\bJewelry\b/],
      [
        'en-US',
        us,
        /\bcolours?\b|\banalys(?:e|ed|ing)\b|\bcentred\b|\bgrey\b|\bJewellery\b/,
      ],
    ] as const) {
      const offenders = [...catalog.entries()]
        .filter(([, value]) => wrong.test(value))
        .map(([key]) => key)
      expect(offenders, `${locale} uses the other variety's spelling`).toEqual([])
    }

    expect(ca.get('sectionTitle')).toBe('Colour palette advisor')
    expect(us.get('sectionTitle')).toBe('Color palette advisor')
    expect(ca.get('slot.jewelry')).toBe('Jewellery')
    expect(us.get('slot.jewelry')).toBe('Jewelry')
  })
})
