// Learning path Step 38: Community feed by climate band.
// Story 6.1 owner: ten-locale parity for the `community.*` tree on Web.
//
// Nothing audits a new key tree by default in this repo: every parity spec is
// subtree-scoped, so a namespace with no spec of its own can ship English in
// all ten catalogs without a single test going red. This file is the community
// namespace's copy of that harness, following `commerce-locales.spec.ts`.
//
// Three of the checks below derive their expected key set from the contract
// instead of a hand-written list. `community.status.*`, `community.report.reason.*`
// and `community.band.unresolved.*` each render one member of a zod enum, and
// `community.band.*` renders one member of the `CLIMATE_BANDS` tuple. A hand-pinned
// list would have to be edited in lockstep with the enum by the same person who
// forgot to edit the catalogs, which is not a check at all. Deriving it means a
// seventh climate band, or a new report reason, fails here rather than rendering a
// raw `temperate_wet` on a pill in front of a member.
//
// The cross-surface check (mobile and web ship the same `community` subtree) lives
// in `apps/mobile/src/i18n/community-locales.spec.ts`, not here: the mobile vitest
// project can reach the web catalogs by relative path, and already does so in
// `wardrobe-capsules-locales.spec.ts`, while the web project cannot see
// `apps/mobile/assets`.
//
// All non-English values are machine-translation drafts pending human review before
// release (PRD NFR Localization 1) — the parity checks hold the tree together until
// that review lands.
import { CLIMATE_BANDS } from '@couture/utils'
import {
  communityBandUnresolvedReasonSchema,
  communityPostStatusSchema,
  communityReportReasonSchema,
} from '@couture/api-client/contracts/http'
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
 * Values that are legitimately spelled the same as the English source in a target
 * language, reviewed rather than left as an English fallback. Every entry is an
 * admission, so the list stays short and each one is argued:
 *
 * - `title` in `de-DE` and `it-IT`: both catalogs already ship the English loanword
 *   for this exact word — the mobile `tabs.community` label reads "Community" in
 *   German and in Italian. "Gemeinschaft" and "Comunità" would name the page
 *   something the tab bar underneath it does not call it.
 * - `compose.photoLabel` in `fr-CA` and `fr-FR`: "photo" is the French word.
 */
const APPROVED_COGNATES: Record<string, readonly SupportedLocale[]> = {
  title: ['de-DE', 'it-IT'],
  'compose.photoLabel': ['fr-CA', 'fr-FR'],
}

function communityTree(catalog: Catalog): Record<string, unknown> {
  return (catalog.community ?? {}) as Record<string, unknown>
}

function childKeys(catalog: Catalog, path: string): string[] {
  const node = path
    .split('.')
    .reduce<unknown>(
      (current, key) => (current as Record<string, unknown> | undefined)?.[key],
      communityTree(catalog)
    )
  return Object.keys((node ?? {}) as Record<string, unknown>).sort()
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

const reference = flatten(communityTree(enUS as Catalog))

describe('6.1 community locale parity', () => {
  it('6.1-I18N-WEB-01 ships a non-empty community tree for every supported locale', () => {
    for (const locale of SUPPORTED_LOCALES) {
      const catalog = flatten(communityTree(CATALOGS[locale]))
      expect(catalog.size, `${locale} community tree`).toBeGreaterThan(0)
      for (const [key, value] of catalog) {
        expect(value.trim().length, `${locale}.${key}`).toBeGreaterThan(0)
      }
    }
  })

  it('6.1-I18N-WEB-02 uses an identical key tree in every locale', () => {
    const expected = [...reference.keys()].sort()
    for (const locale of SUPPORTED_LOCALES) {
      const actual = [...flatten(communityTree(CATALOGS[locale])).keys()].sort()
      expect(actual, `${locale} key tree`).toEqual(expected)
    }
  })

  it('6.1-I18N-WEB-03 keeps interpolation placeholders identical across locales', () => {
    for (const locale of SUPPORTED_LOCALES) {
      const catalog = flatten(communityTree(CATALOGS[locale]))
      for (const [key, englishValue] of reference) {
        expect(placeholders(catalog.get(key) ?? ''), `${locale}.${key}`).toEqual(
          placeholders(englishValue)
        )
      }
    }
  })

  /** An untranslated value means the catalog silently fell back to English. */
  it('6.1-I18N-WEB-04 does not leave English values in non-English catalogs', () => {
    const nonEnglish = SUPPORTED_LOCALES.filter((locale) => !locale.startsWith('en-'))

    for (const locale of nonEnglish) {
      const catalog = flatten(communityTree(CATALOGS[locale]))
      const untranslated = [...reference.entries()]
        .filter(([key, englishValue]) => {
          if (APPROVED_COGNATES[key]?.includes(locale)) return false
          return catalog.get(key) === englishValue
        })
        .map(([key]) => key)

      expect(untranslated, `${locale} untranslated keys`).toEqual([])
    }
  })

  /**
   * The band pills and the band filter row both render a `CLIMATE_BANDS` member.
   * Deriving the expected keys from the tuple means adding a seventh band fails
   * here, in every locale at once, rather than painting a raw `temperate_wet` onto
   * a pill.
   */
  it('6.1-I18N-WEB-05 labels every climate band in every locale', () => {
    const expectedBandKeys = [...CLIMATE_BANDS, 'unclassified', 'unresolved'].sort()
    const expectedModeKeys = [...CLIMATE_BANDS, 'auto', 'autoWithBand', 'all'].sort()

    for (const locale of SUPPORTED_LOCALES) {
      expect(childKeys(CATALOGS[locale], 'band'), `${locale} band labels`).toEqual(
        expectedBandKeys
      )
      expect(
        childKeys(CATALOGS[locale], 'filters.mode'),
        `${locale} filter pills`
      ).toEqual(expectedModeKeys)
    }
  })

  it('6.1-I18N-WEB-06 labels every community post status in every locale', () => {
    // `reason` is the "Reason: {{reason}}" suffix the flagged and consent states
    // append; every other child of `status` is one enum member.
    const expected = [...communityPostStatusSchema.options, 'reason'].sort()
    for (const locale of SUPPORTED_LOCALES) {
      expect(childKeys(CATALOGS[locale], 'status'), `${locale} status labels`).toEqual(
        expected
      )
    }
  })

  it('6.1-I18N-WEB-07 labels every report reason in every locale', () => {
    const expected = [...communityReportReasonSchema.options].sort()
    for (const locale of SUPPORTED_LOCALES) {
      expect(
        childKeys(CATALOGS[locale], 'report.reason'),
        `${locale} report reasons`
      ).toEqual(expected)
    }
  })

  it('6.1-I18N-WEB-08 explains every band-unresolved reason in every locale', () => {
    const expected = [...communityBandUnresolvedReasonSchema.options].sort()
    for (const locale of SUPPORTED_LOCALES) {
      expect(
        childKeys(CATALOGS[locale], 'band.unresolved'),
        `${locale} band-unresolved banners`
      ).toEqual(expected)
    }
  })
})
