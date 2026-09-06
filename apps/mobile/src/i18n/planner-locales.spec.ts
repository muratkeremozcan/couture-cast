// Story 5.5 Task 8/9 owner: ten-locale parity for the mobile
// `commerce.premium.planner.*` and `commerce.premium.plannerLocked.*` trees.
//
// A new feature area gets its own dedicated parity spec rather than an extension of
// `premium-locales.spec.ts` (Decision 15, the same reasoning 5.2 through 5.4 recorded).
// `premium-locales.spec.ts` filters both trees out of its own pinned key list, and this
// file owns them outright.
//
// All non-English values are machine-translation drafts pending human review before
// release (AC 7); the parity checks hold the tree together until that review lands.
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

// Listed here rather than imported: the mobile i18n entry point pulls in
// `expo-localization`, which cannot be evaluated under the node test environment.
// `premium-locales.spec.ts` and `palette-advisor-locales.spec.ts` take the same
// approach for the same reason.
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

function subtree(
  catalog: Catalog,
  key: 'planner' | 'plannerLocked'
): Record<string, unknown> {
  const commerce = (catalog.commerce ?? {}) as Record<string, unknown>
  const premium = (commerce.premium ?? {}) as Record<string, unknown>
  return (premium[key] ?? {}) as Record<string, unknown>
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

/** `{{token}}` placeholders must match exactly, or interpolation breaks. Neither tree
 * uses any, so every locale's set is expected to be empty. */
function placeholders(value: string): string[] {
  return [...value.matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1] ?? '').sort()
}

const plannerReference = flatten(subtree(enUS as Catalog, 'planner'))
const plannerLockedReference = flatten(subtree(enUS as Catalog, 'plannerLocked'))

describe('5.5 mobile planner locale parity', () => {
  it('5.5-I18N-MOB-01 ships 35 planner keys and 2 plannerLocked keys in the reference catalog', () => {
    expect(plannerReference.size).toBe(35)
    expect(plannerLockedReference.size).toBe(2)
  })

  it('5.5-I18N-MOB-02 uses an identical planner key tree in every locale', () => {
    const expected = [...plannerReference.keys()].sort()
    for (const locale of SUPPORTED_LOCALES) {
      const actual = [...flatten(subtree(CATALOGS[locale], 'planner')).keys()].sort()
      expect(actual, `${locale} planner key tree`).toEqual(expected)
    }
  })

  it('5.5-I18N-MOB-03 uses an identical plannerLocked key tree in every locale', () => {
    const expected = [...plannerLockedReference.keys()].sort()
    for (const locale of SUPPORTED_LOCALES) {
      const actual = [
        ...flatten(subtree(CATALOGS[locale], 'plannerLocked')).keys(),
      ].sort()
      expect(actual, `${locale} plannerLocked key tree`).toEqual(expected)
    }
  })

  it('5.5-I18N-MOB-04 keeps interpolation placeholders identical across locales', () => {
    for (const locale of SUPPORTED_LOCALES) {
      const planner = flatten(subtree(CATALOGS[locale], 'planner'))
      for (const [key, englishValue] of plannerReference) {
        expect(placeholders(planner.get(key) ?? ''), `${locale} planner.${key}`).toEqual(
          placeholders(englishValue)
        )
      }
      const plannerLocked = flatten(subtree(CATALOGS[locale], 'plannerLocked'))
      for (const [key, englishValue] of plannerLockedReference) {
        expect(
          placeholders(plannerLocked.get(key) ?? ''),
          `${locale} plannerLocked.${key}`
        ).toEqual(placeholders(englishValue))
      }
    }
  })

  it('5.5-I18N-MOB-05 does not leave English values in non-English catalogs', () => {
    for (const locale of NON_ENGLISH_LOCALES) {
      const planner = flatten(subtree(CATALOGS[locale], 'planner'))
      const untranslatedPlanner = [...plannerReference.entries()]
        .filter(([key, englishValue]) => planner.get(key) === englishValue)
        .map(([key]) => key)
      expect(untranslatedPlanner, `${locale} untranslated planner keys`).toEqual([])

      const plannerLocked = flatten(subtree(CATALOGS[locale], 'plannerLocked'))
      const untranslatedLocked = [...plannerLockedReference.entries()]
        .filter(([key, englishValue]) => plannerLocked.get(key) === englishValue)
        .map(([key]) => key)
      expect(untranslatedLocked, `${locale} untranslated plannerLocked keys`).toEqual([])
    }
  })

  it('5.5-I18N-MOB-06 never ships an empty string', () => {
    for (const locale of SUPPORTED_LOCALES) {
      for (const [key, value] of flatten(subtree(CATALOGS[locale], 'planner'))) {
        expect(value.trim().length, `${locale} planner.${key}`).toBeGreaterThan(0)
      }
      for (const [key, value] of flatten(subtree(CATALOGS[locale], 'plannerLocked'))) {
        expect(value.trim().length, `${locale} plannerLocked.${key}`).toBeGreaterThan(0)
      }
    }
  })

  /**
   * AC 7: weather confidence degradation must read as honest, not as full-precision
   * weather. The `unavailable` confidence label and the `daily` label must not collapse
   * onto the same string a translator might otherwise shorten to.
   */
  it('5.5-I18N-MOB-07 keeps the three weather confidence labels distinct in every locale', () => {
    for (const locale of SUPPORTED_LOCALES) {
      const planner = flatten(subtree(CATALOGS[locale], 'planner'))
      const hourly = planner.get('weather.confidence.hourly')
      const daily = planner.get('weather.confidence.daily')
      const unavailable = planner.get('weather.confidence.unavailable')
      const labels = new Set([hourly, daily, unavailable])
      expect(labels.size, `${locale} weather confidence labels`).toBe(3)
    }
  })
})
