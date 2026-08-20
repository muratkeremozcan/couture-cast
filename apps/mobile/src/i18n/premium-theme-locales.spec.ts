// Story 5.3 Task 6 owner: ten-locale parity for the mobile `commerce.premium.theme.*`
// tree.
//
// The mobile sibling of `apps/web/src/i18n/premium-theme-locales.spec.ts`, and the
// mobile half of AC 7. A new feature area gets its own dedicated parity spec rather than
// an extension of `premium-locales.spec.ts` (Decision 13), and that 5.2 spec now filters
// this `theme` child out so its pinned 22-key list keeps meaning exactly what it meant
// before.
//
// The two surfaces ship the same sixteen keys with the same copy, which is not an
// accident worth trimming: `locked.body` names the subscribe controls rendered directly
// above the section on both surfaces, and the disclosure makes the same AC 7 claims about
// the same server behavior. The assertions below are therefore the same assertions the
// web spec makes, so copy that drifts on one surface fails on that surface's own spec
// rather than being caught late by a reader comparing screenshots.
//
// All non-English values are machine-translation drafts pending human review before
// release (AC 7 / PRD NFR Localization 1) — the parity checks hold the tree together
// until that review lands.
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

const NON_ENGLISH_LOCALES = SUPPORTED_LOCALES.filter(
  (locale) => !locale.startsWith('en-')
)

const ENGLISH_LOCALES = SUPPORTED_LOCALES.filter((locale) => locale.startsWith('en-'))

/**
 * The disclosure has to survive translation with its analytics sentence intact, and a
 * substring check is the only thing that can prove that per locale. Each entry is the
 * phrase its catalog uses to name where the palette goes, so reverting a catalog to copy
 * that omits the sentence fails here rather than shipping a privacy claim the code
 * contradicts. The two French entries reach past the noun phrase because
 * `fournisseur d'analyse` carries an apostrophe, and a literal holding one satisfies
 * neither the `quotes` rule nor Prettier in this config.
 *
 * Why the sentence exists at all: a successful `PUT` fires `premium_theme_selected`
 * server-side (Decision 14), and `TelemetryService` dispatches it to PostHog Cloud. The
 * palette key therefore leaves CoutureCast's own systems on every save, from the mobile
 * surface exactly as from the web one. Pseudonymising the subject id narrows who the row
 * is about; it does not keep the row in-house.
 */
const DISCLOSURE_ANALYTICS_TOKENS: Record<SupportedLocale, string> = {
  'en-US': 'analytics provider',
  'en-CA': 'analytics provider',
  'de-DE': 'Analyseanbieter',
  'es-419': 'proveedor de análisis',
  'fr-CA': 'analyse sous un identifiant pseudonyme',
  'fr-FR': 'analyse sous un identifiant pseudonyme',
  'it-IT': 'fornitore di analisi',
  'pt-BR': 'provedor de análise',
  'pt-PT': 'fornecedor de análise',
  'tr-TR': 'analiz sağlayıcısına',
}

/**
 * The three palette names are proper nouns from `refs/ux/ux-color-themes.html` and ship
 * untranslated everywhere on purpose: they are what the design system calls these
 * palettes, and a localized "Radiance de bijou" would name nothing a reader could match
 * back to the spec or to the web surface. Nothing else is listed, and nothing else should
 * be — an entry here is an admission, so keep the list this small.
 */
const APPROVED_COGNATES: Record<string, readonly SupportedLocale[]> = {
  'names.jewelRadiance': NON_ENGLISH_LOCALES,
  'names.autumnUmber': NON_ENGLISH_LOCALES,
  'names.winterMetallic': NON_ENGLISH_LOCALES,
}

function themeTree(catalog: Catalog): Record<string, unknown> {
  const commerce = (catalog.commerce ?? {}) as Record<string, unknown>
  const premium = (commerce.premium ?? {}) as Record<string, unknown>
  return (premium.theme ?? {}) as Record<string, unknown>
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

const reference = flatten(themeTree(enUS as Catalog))

describe('5.3 premium theme locale parity (mobile)', () => {
  it('5.3-I18N-MOB-THEME-01 ships a theme tree for every supported locale', () => {
    for (const locale of SUPPORTED_LOCALES) {
      expect(Object.keys(themeTree(CATALOGS[locale])).length, locale).toBeGreaterThan(0)
    }
  })

  it('5.3-I18N-MOB-THEME-02 uses an identical key tree in every locale', () => {
    const expected = [...reference.keys()].sort()
    for (const locale of SUPPORTED_LOCALES) {
      const actual = [...flatten(themeTree(CATALOGS[locale])).keys()].sort()
      expect(actual, `${locale} key tree`).toEqual(expected)
    }
  })

  /**
   * Pinning the exact key set means a later rename, or a quiet drop of the disclosure
   * copy, fails here rather than in a released build. It is also the assertion that a
   * fourth palette cannot arrive by locale edit alone: `names.springBloom` would have to
   * be added here, in the contract enum, and in `src/theme/theme-palettes.ts` to render
   * at all.
   *
   * Unlike 5.2's premium tree, this one has no mobile-only or web-only members: the
   * mobile surface renders every one of these sixteen keys, including both locked
   * bodies, because the mobile settings screen is reachable signed out.
   */
  it('5.3-I18N-MOB-THEME-03 carries exactly the keys Decision 13 specifies', () => {
    expect([...reference.keys()].sort()).toEqual([
      'disclosure',
      'loadError',
      'locked.body',
      'locked.signedOutBody',
      'locked.title',
      'names.autumnUmber',
      'names.jewelRadiance',
      'names.winterMetallic',
      'preview.body',
      'preview.title',
      'reset',
      'saveError',
      'sectionTitle',
      'select',
      'selected',
      'unavailable',
    ])
  })

  it('5.3-I18N-MOB-THEME-04 keeps interpolation placeholders identical across locales', () => {
    for (const locale of SUPPORTED_LOCALES) {
      const catalog = flatten(themeTree(CATALOGS[locale]))
      for (const [key, englishValue] of reference) {
        expect(placeholders(catalog.get(key) ?? ''), `${locale}.${key}`).toEqual(
          placeholders(englishValue)
        )
      }
    }
  })

  /** An untranslated value means the catalog silently fell back to English. */
  it('5.3-I18N-MOB-THEME-05 does not leave English values in non-English catalogs', () => {
    for (const locale of NON_ENGLISH_LOCALES) {
      const catalog = flatten(themeTree(CATALOGS[locale]))
      const untranslated = [...reference.entries()]
        .filter(([key, englishValue]) => {
          if (APPROVED_COGNATES[key]?.includes(locale)) return false
          return catalog.get(key) === englishValue
        })
        .map(([key]) => key)

      expect(untranslated, `${locale} untranslated keys`).toEqual([])
    }
  })

  it('5.3-I18N-MOB-THEME-06 never ships an empty string', () => {
    for (const locale of SUPPORTED_LOCALES) {
      for (const [key, value] of flatten(themeTree(CATALOGS[locale]))) {
        expect(value.trim().length, `${locale}.${key}`).toBeGreaterThan(0)
      }
    }
  })

  /**
   * The palette names are the one thing that must be byte-identical everywhere: the
   * gallery, the UX reference file, the contract enum and the web surface all have to
   * agree, and the cognate allowlist above only permits the English value rather than
   * requiring it. Without this, a translator "fixing" one catalog would pass every other
   * check.
   */
  it('5.3-I18N-MOB-THEME-07 spells the three palette names identically in every locale', () => {
    for (const locale of SUPPORTED_LOCALES) {
      const catalog = flatten(themeTree(CATALOGS[locale]))
      expect(catalog.get('names.jewelRadiance'), locale).toBe('Jewel Radiance')
      expect(catalog.get('names.autumnUmber'), locale).toBe('Autumn Umber')
      expect(catalog.get('names.winterMetallic'), locale).toBe('Winter Metallic')
    }
  })

  /**
   * The disclosure is AC 7's compliance copy: it has to say the choice is stored on the
   * account and that a palette changes appearance only. A truncated translation is the
   * realistic way this regresses, and the locked copy naming all three palettes is what
   * tells a non-entitled reader what they would actually be buying.
   *
   * The `{{palettes}}` placeholder is asserted rather than the names themselves: the
   * mobile section builds that list from `PREMIUM_THEME_KEYS` through `Intl.ListFormat`
   * exactly as the web one does, so a translator who resolved the list into their own
   * prose would freeze today's three palettes into twenty sentences.
   */
  it('5.3-I18N-MOB-THEME-08 keeps the disclosure and the locked copy substantive', () => {
    for (const locale of SUPPORTED_LOCALES) {
      const catalog = flatten(themeTree(CATALOGS[locale]))
      const disclosure = catalog.get('disclosure') ?? ''
      expect(disclosure.length, `${locale} disclosure length`).toBeGreaterThan(150)
      expect(
        disclosure.includes('CoutureCast'),
        `${locale} disclosure names the product`
      ).toBe(true)
      expect(disclosure.includes('Premium'), `${locale} disclosure names Premium`).toBe(
        true
      )

      for (const key of ['locked.body', 'locked.signedOutBody'] as const) {
        const value = catalog.get(key) ?? ''
        expect(value.includes('{{palettes}}'), `${locale} ${key} interpolates`).toBe(true)
        for (const name of ['Jewel Radiance', 'Autumn Umber', 'Winter Metallic']) {
          expect(value.includes(name), `${locale} ${key} hardcodes ${name}`).toBe(false)
        }
      }
      expect(
        catalog.get('locked.title')?.includes('Premium'),
        `${locale} locked title names Premium`
      ).toBe(true)
    }
  })

  /**
   * Decision 1 and 2: neither "Midnight Noir" nor "Aurora Dawn" (the epic's and the
   * PRD's throwaway example names) nor Spring Bloom (marked future in the UX spec) may
   * appear in shipped copy. This is the check that catches a well-meaning translator or a
   * copy pass reintroducing a name that has no palette behind it.
   */
  it('5.3-I18N-MOB-THEME-09 ships no palette name without a palette', () => {
    for (const locale of SUPPORTED_LOCALES) {
      const values = [...flatten(themeTree(CATALOGS[locale])).values()].join(' ')
      for (const absent of ['Midnight Noir', 'Aurora Dawn', 'Spring Bloom']) {
        expect(values.includes(absent), `${locale} mentions ${absent}`).toBe(false)
      }
    }
  })

  /**
   * AC 7's disclosure has to match what the server actually does with the selection. A
   * successful `PUT` emits `premium_theme_selected`, which `TelemetryService` sends to
   * PostHog Cloud, so the palette key leaves CoutureCast every time someone saves.
   *
   * The positive token check is the guard that holds in all ten languages: reverting any
   * catalog to copy without the analytics sentence drops the token and fails here. The
   * negative below is English-only because it pins the exact false sentence the web
   * catalogs once shipped ("nothing about your choice is shared outside CoutureCast"),
   * and it is the check that catches a copy pass reaching for the reassuring absolute
   * again.
   */
  it('5.3-I18N-MOB-THEME-10 discloses the analytics dispatch instead of denying it', () => {
    for (const locale of SUPPORTED_LOCALES) {
      const disclosure = flatten(themeTree(CATALOGS[locale])).get('disclosure') ?? ''
      const token = DISCLOSURE_ANALYTICS_TOKENS[locale]
      expect(
        disclosure.includes(token),
        `${locale} disclosure names where the palette is sent ("${token}")`
      ).toBe(true)
    }

    for (const locale of ENGLISH_LOCALES) {
      const disclosure = flatten(themeTree(CATALOGS[locale])).get('disclosure') ?? ''
      expect(
        disclosure.includes('shared outside CoutureCast'),
        `${locale} disclosure must not claim the choice never leaves CoutureCast`
      ).toBe(false)
      expect(
        disclosure.includes('pseudonymous'),
        `${locale} disclosure names the pseudonymous id`
      ).toBe(true)
    }
  })
})
