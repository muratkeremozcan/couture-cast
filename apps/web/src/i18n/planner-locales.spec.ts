// Story 5.5 Task 7 owner: ten-locale parity for the `commerce.premium.planner.*` tree.
//
// A new feature area gets its own dedicated parity spec rather than an extension of
// `premium-locales.spec.ts` (Decision 15, the same reasoning 5.4's palette advisor and
// 5.3's theme switcher recorded before it). The two specs are siblings:
// `premium-locales.spec.ts` filters this `planner` child out alongside `theme` and
// `palette`, so its pinned key list keeps meaning exactly what it meant before, and this
// file owns the planner keys outright.
//
// All non-English values are machine-translation drafts pending human review before
// release (AC 7 / PRD NFR Localization 1). The parity checks hold the tree together
// until that review lands.
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

function plannerTree(catalog: Catalog): Record<string, unknown> {
  const commerce = (catalog.commerce ?? {}) as Record<string, unknown>
  const premium = (commerce.premium ?? {}) as Record<string, unknown>
  return (premium.planner ?? {}) as Record<string, unknown>
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

const reference = flatten(plannerTree(enUS as Catalog))

describe('5.5 planner locale parity (web)', () => {
  it('5.5-I18N-WEB-01 ships a planner tree for every supported locale', () => {
    for (const locale of SUPPORTED_LOCALES) {
      expect(Object.keys(plannerTree(CATALOGS[locale])).length, locale).toBeGreaterThan(0)
    }
  })

  it('5.5-I18N-WEB-02 uses an identical key tree in every locale', () => {
    const expected = [...reference.keys()].sort()
    for (const locale of SUPPORTED_LOCALES) {
      const actual = [...flatten(plannerTree(CATALOGS[locale])).keys()].sort()
      expect(actual, `${locale} key tree`).toEqual(expected)
    }
  })

  /**
   * Pins the exact key set Decision 8 enumerates: section and day labels, conditions,
   * weather confidence and freshness, scenario labels, starter wardrobe, open, close,
   * loading, retry, reshuffle states, the disabled state, the error state, and live
   * announcements. A later rename or a quiet drop of any of these fails here rather
   * than in a released build.
   */
  it('5.5-I18N-WEB-03 carries exactly the keys Decision 8 specifies for web', () => {
    expect([...reference.keys()].sort()).toEqual(
      [
        'announce.dayFailed',
        'announce.opened',
        'announce.ready',
        'checking',
        'close',
        'condition.clear',
        'condition.cloudy',
        'condition.drizzle',
        'condition.fog',
        'condition.partly_cloudy',
        'condition.rain',
        'condition.sleet',
        'condition.snow',
        'condition.thunderstorm',
        'condition.unknown',
        'condition.wind',
        'confidence.daily',
        'confidence.hourly',
        'dayError',
        'disabled',
        'errorTitle',
        'freshness.cached',
        'freshness.fresh',
        'freshness.stale',
        'garmentCategory.accessory',
        'garmentCategory.bottom',
        'garmentCategory.dress',
        'garmentCategory.outerwear',
        'garmentCategory.shoes',
        'garmentCategory.top',
        'loading',
        'openControl',
        'reshuffle.action',
        'reshuffle.conflict',
        'reshuffle.error',
        'reshuffle.loading',
        'reshuffle.unchanged',
        'reshuffle.updated',
        'retry',
        'scenario.evening',
        'scenario.midday',
        'scenario.morning',
        'sectionTitle',
        'starterWardrobe',
        'today',
        'tomorrow',
        'weatherUnavailable',
      ].sort()
    )
  })

  it('5.5-I18N-WEB-04 keeps interpolation placeholders identical across locales', () => {
    for (const locale of SUPPORTED_LOCALES) {
      const catalog = flatten(plannerTree(CATALOGS[locale]))
      for (const [key, englishValue] of reference) {
        expect(placeholders(catalog.get(key) ?? ''), `${locale}.${key}`).toEqual(
          placeholders(englishValue)
        )
      }
    }
  })

  /**
   * An untranslated value means the catalog silently fell back to English.
   *
   * `en-CA` is deliberately excluded from this check (as `NON_ENGLISH_LOCALES`
   * already excludes it): unlike 5.4's "colour"-heavy palette copy, nothing in this
   * tree (outfit/planner/reshuffle/weather/category) has a Canadian/American spelling
   * divergence, so `en-CA.json`'s planner block is a literal copy of `en-US.json`'s
   * rather than an independent draft.
   */
  it('5.5-I18N-WEB-05 does not leave English values in non-English catalogs', () => {
    for (const locale of NON_ENGLISH_LOCALES) {
      const catalog = flatten(plannerTree(CATALOGS[locale]))
      const untranslated = [...reference.entries()]
        .filter(([key, englishValue]) => catalog.get(key) === englishValue)
        .map(([key]) => key)

      expect(untranslated, `${locale} untranslated keys`).toEqual([])
    }
  })

  it('5.5-I18N-WEB-06 never ships an empty string', () => {
    for (const locale of SUPPORTED_LOCALES) {
      for (const [key, value] of flatten(plannerTree(CATALOGS[locale]))) {
        expect(value.trim().length, `${locale}.${key}`).toBeGreaterThan(0)
      }
    }
  })
})
