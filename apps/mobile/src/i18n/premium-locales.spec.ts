// Story 5.2 Task 6: premium subscription locale parity (Decision 12a).
// All non-English values are machine-translation drafts pending human review
// before release (AC 7); this spec guards structure, not translation quality.
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
 * "Premium" is the product's name and a cognate in every shipped language, so
 * the bare section title is legitimately identical outside English. Budgeted
 * up front, as the story requires; every other key must actually translate.
 */
const APPROVED_COGNATES: Record<string, readonly SupportedLocale[]> = {
  sectionTitle: ['de-DE', 'es-419', 'fr-CA', 'fr-FR', 'it-IT', 'pt-BR', 'pt-PT', 'tr-TR'],
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

function placeholders(value: string): string[] {
  return [...value.matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1] ?? '').sort()
}

const reference = flatten(premiumTree(enUS as Catalog))

describe('5.2 mobile premium locale parity', () => {
  it('5.2-I18N-MOB-01 ships the 22 Decision 12a mobile keys in the reference catalog', () => {
    // 21 shared keys plus the mobile-only `unavailableInBuild`. The web-only
    // keys (signedOutHint, plannerLocked.*) are deliberately absent here.
    expect(reference.size).toBe(22)
    expect(reference.has('unavailableInBuild')).toBe(true)
    expect(reference.has('signedOutHint')).toBe(false)
  })

  it('5.2-I18N-MOB-02 uses an identical key tree in every locale', () => {
    const expected = [...reference.keys()].sort()
    for (const locale of SUPPORTED_LOCALES) {
      const actual = [...flatten(premiumTree(CATALOGS[locale])).keys()].sort()
      expect(actual, `${locale} key tree`).toEqual(expected)
    }
  })

  it('5.2-I18N-MOB-03 keeps interpolation placeholders identical across locales', () => {
    for (const locale of SUPPORTED_LOCALES) {
      const catalog = flatten(premiumTree(CATALOGS[locale]))
      for (const [key, englishValue] of reference) {
        expect(placeholders(catalog.get(key) ?? ''), `${locale}.${key}`).toEqual(
          placeholders(englishValue)
        )
      }
    }
  })

  it('5.2-I18N-MOB-04 interpolates plan and date into both entitled status lines', () => {
    // The entitled render is "plan name + period-end line" (Decision 11); a
    // locale that dropped either placeholder would show a dangling sentence.
    for (const locale of SUPPORTED_LOCALES) {
      const catalog = flatten(premiumTree(CATALOGS[locale]))
      for (const key of ['status.active', 'status.gracePeriod']) {
        expect(placeholders(catalog.get(key) ?? ''), `${locale}.${key}`).toEqual([
          'date',
          'plan',
        ])
      }
    }
  })

  it('5.2-I18N-MOB-05 does not leave English values in non-English catalogs', () => {
    for (const locale of SUPPORTED_LOCALES.filter((l) => !l.startsWith('en-'))) {
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

  it('5.2-I18N-MOB-06 never ships an empty string', () => {
    for (const locale of SUPPORTED_LOCALES) {
      for (const [key, value] of flatten(premiumTree(CATALOGS[locale]))) {
        expect(value.trim().length, `${locale}.${key}`).toBeGreaterThan(0)
      }
    }
  })

  it('5.2-I18N-MOB-07 keeps the processor disclosure substantive and names both processors', () => {
    // AC 7's compliance surface: the disclosure must name RevenueCat and
    // Stripe and say what is shared. Brand names are locale-invariant, so
    // this is assertable across all ten catalogs.
    for (const locale of SUPPORTED_LOCALES) {
      const disclosure = flatten(premiumTree(CATALOGS[locale])).get('disclosure') ?? ''
      expect(disclosure.length, `${locale} disclosure length`).toBeGreaterThan(80)
      expect(disclosure, `${locale} disclosure names RevenueCat`).toContain('RevenueCat')
      expect(disclosure, `${locale} disclosure names Stripe`).toContain('Stripe')
    }
  })
})
