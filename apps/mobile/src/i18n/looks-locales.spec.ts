// Learning path Step 69: Looks tab for saved looks, ideas and plans.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-69-looks-tab-for-saved-looks-ideas-and-plans
// Story CC-7.12 test owner (TEA): 7.12-UNIT-070 and 071 for the mobile catalogs (D12). The
// `looks.*` tree the segments, filters, tiles, saved look screen and free Plan preview read is
// the same in all 10 locales, every value is non-empty, and placeholders match en-US; the
// CC-7.11 `looks.capsules` and `looks.plan` rows are gone with the rows they named.
// Test design: _bmad-output/test-artifacts/test-design-7-12-looks-tab-saved-looks-ideas-plans.md.
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

const CATALOGS: Record<string, Catalog> = {
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

function flatten(value: unknown, prefix = ''): Map<string, unknown> {
  const out = new Map<string, unknown>()
  if (typeof value !== 'object' || value === null) return out
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (typeof child === 'object' && child !== null)
      for (const [nested, nestedValue] of flatten(child, path))
        out.set(nested, nestedValue)
    else out.set(path, child)
  }
  return out
}

const looksOf = (catalog: Catalog) => flatten(catalog.looks)

function placeholders(value: unknown): string[] {
  return [...String(value).matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1]!).sort()
}

/** Every key the native Looks screens read (D1 to D5, D9, D10), in the reference catalog. */
const LOOKS_KEYS = [
  'empty',
  'segments.label',
  'segments.saved',
  'segments.ideas',
  'segments.plan',
  'filters.label',
  'filters.all',
  'filters.today',
  'filters.capsules',
  'filterEmpty.today',
  'filterEmpty.capsules',
  'manageCapsules',
  'state.missing_one',
  'state.missing_other',
  'state.needsReview',
  'state.savedOn',
  'detail.gone',
  'detail.signIn',
  'detail.signInAction',
  'freePlan.week',
  'freePlan.line',
  'freePlan.upgrade',
  'loadMore',
] as const

const reference = looksOf(enUS as Catalog)

describe('CC-7.12 mobile looks locale parity', () => {
  it('[P1] [7.12-UNIT-070] the reference catalog holds exactly the Looks keys, with the D2 and D10 words', () => {
    expect([...reference.keys()].sort()).toEqual([...LOOKS_KEYS].sort())
    expect(reference.get('state.missing_one')).toBe('1 piece missing')
    expect(reference.get('state.missing_other')).toBe('{{count}} pieces missing')
    expect(reference.get('state.needsReview')).toBe('Needs review')
    expect(reference.get('state.savedOn')).toBe('Saved {{date}}')
    expect(reference.get('detail.gone')).toBe('This look is no longer saved')
    expect(reference.get('freePlan.line')).toBe(
      'With Premium, you can plan what to wear all week.'
    )
    expect(reference.get('filterEmpty.today')).toBe('No looks from Today yet')
    expect(reference.get('filterEmpty.capsules')).toBe('No capsules yet')
    expect(reference.get('empty')).toBe('Save a look to see it here')
  })

  it('[P1] [7.12-UNIT-070] every locale has the same looks tree, non-empty, with matching placeholders', () => {
    for (const [locale, catalog] of Object.entries(CATALOGS)) {
      const looks = looksOf(catalog)
      expect([...looks.keys()].sort(), `${locale} looks key tree`).toEqual(
        [...reference.keys()].sort()
      )
      for (const [key, english] of reference) {
        const value = looks.get(key)
        expect(typeof value, `${locale} looks.${key}`).toBe('string')
        expect(String(value).trim().length, `${locale} looks.${key}`).toBeGreaterThan(0)
        expect(placeholders(value), `${locale} looks.${key} placeholders`).toEqual(
          placeholders(english)
        )
      }
    }
  })

  it('[P1] [7.12-UNIT-071] the CC-7.11 Capsules and Plan row keys are gone from every locale', () => {
    for (const [locale, catalog] of Object.entries(CATALOGS)) {
      const looks = (catalog.looks ?? {}) as Record<string, unknown>
      // `looks.plan` and `looks.capsules` were strings; `segments.plan` and `filters.capsules`
      // name the segment and the filter now.
      expect(looks, `${locale} looks.capsules`).not.toHaveProperty('capsules')
      expect(looks, `${locale} looks.plan`).not.toHaveProperty('plan')
      const premium = (
        (catalog.commerce ?? {}) as Record<string, Record<string, unknown>>
      ).premium
      expect(premium, `${locale} commerce.premium.plannerLocked`).not.toHaveProperty(
        'plannerLocked'
      )
    }
  })
})
