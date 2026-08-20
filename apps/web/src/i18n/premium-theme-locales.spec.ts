// Learning path Step 35: Premium theme switcher.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-35-premium-theme-switcher
// Story 5.3 Task 5 owner: ten-locale parity for the `commerce.premium.theme.*` tree.
//
// A new feature area gets its own dedicated parity spec rather than an extension of
// `premium-locales.spec.ts` (Decision 13, the reasoning 5.2 itself recorded when it
// declined to extend `commerce-locales.spec.ts`). The two specs are siblings: 5.2's
// `premiumTree` now filters this `theme` child out, so its pinned 5.2 key list keeps
// meaning exactly what it meant before, and this file owns the theme keys outright.
//
// The key set is Decision 13's twelve plus three. `unavailable` is the first addition:
// the kill switch (`premium_themes_enabled`) is reachable by an entitled subscriber, and
// it disables every gallery card. Every other disabled control in this app carries a
// reason next to it — `commerce.settings.signedOutHint`, `commerce.premium
// .signedOutHint` — so shipping four silently dead cards would have been the only
// exception. The note is that reason, and the cards point `aria-describedby` at it.
//
// `preview.title` and `preview.body` are the other two. Decision 4 names a preview card
// as part of the demonstration surface, and it is the element that gives the `data-theme`
// on `<html>` a visible consumer: the gallery cards each pin their own palette, so the
// preview is the only thing in the section that re-colors on selection.
//
// All non-English values are machine-translation drafts pending human review before
// release (AC 7 / PRD NFR Localization 1) — the parity checks hold the tree together
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
 * palette key therefore leaves CoutureCast's own systems on every save. Pseudonymising
 * the subject id narrows who the row is about; it does not keep the row in-house. Copy
 * that says otherwise is false, which is what the first draft of this key said.
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
 * back to the spec or to another surface. Nothing else is listed, and nothing else
 * should be — an entry here is an admission, so keep the list this small.
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

describe('5.3 premium theme locale parity (web)', () => {
  it('5.3-I18N-WEB-01 ships a theme tree for every supported locale', () => {
    for (const locale of SUPPORTED_LOCALES) {
      expect(Object.keys(themeTree(CATALOGS[locale])).length, locale).toBeGreaterThan(0)
    }
  })

  it('5.3-I18N-WEB-02 uses an identical key tree in every locale', () => {
    const expected = [...reference.keys()].sort()
    for (const locale of SUPPORTED_LOCALES) {
      const actual = [...flatten(themeTree(CATALOGS[locale])).keys()].sort()
      expect(actual, `${locale} key tree`).toEqual(expected)
    }
  })

  /**
   * Pinning the exact key set means a later rename, or a quiet drop of the disclosure
   * copy, fails here rather than in a released build. It is also the assertion that a
   * fourth palette cannot arrive by locale edit alone: `names.springBloom` would have
   * to be added here, in the contract enum, and in `globals.css` to render at all.
   */
  it('5.3-I18N-WEB-03 carries exactly the keys Decision 13 specifies', () => {
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

  it('5.3-I18N-WEB-04 keeps interpolation placeholders identical across locales', () => {
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
  it('5.3-I18N-WEB-05 does not leave English values in non-English catalogs', () => {
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

  it('5.3-I18N-WEB-06 never ships an empty string', () => {
    for (const locale of SUPPORTED_LOCALES) {
      for (const [key, value] of flatten(themeTree(CATALOGS[locale]))) {
        expect(value.trim().length, `${locale}.${key}`).toBeGreaterThan(0)
      }
    }
  })

  /**
   * The palette names are the one thing that must be byte-identical everywhere: the
   * gallery, the UX reference file, and the contract enum all have to agree, and the
   * cognate allowlist above only permits the English value rather than requiring it.
   * Without this, a translator "fixing" one catalog would pass every other check.
   */
  it('5.3-I18N-WEB-07 spells the three palette names identically in every locale', () => {
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
   */
  it('5.3-I18N-WEB-08 keeps the disclosure and the locked copy substantive', () => {
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

      /*
       * The palette names arrive through the `{{palettes}}` interpolation now,
       * built from `PREMIUM_THEME_KEYS` and joined by `Intl.ListFormat`, so the
       * catalog no longer spells them out. Asserting the placeholder is the
       * stronger check anyway: it catches a translator who resolved the list
       * into their own prose and froze today's three palettes into twenty
       * sentences, which is exactly what this key used to be.
       */
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
   * appear in shipped copy. This is the check that catches a well-meaning translator or
   * a copy pass reintroducing a name that has no palette behind it.
   */
  it('5.3-I18N-WEB-09 ships no palette name without a palette', () => {
    for (const locale of SUPPORTED_LOCALES) {
      const values = [...flatten(themeTree(CATALOGS[locale])).values()].join(' ')
      for (const absent of ['Midnight Noir', 'Aurora Dawn', 'Spring Bloom']) {
        expect(values.includes(absent), `${locale} mentions ${absent}`).toBe(false)
      }
    }
  })

  /**
   * AC 7's disclosure has to match what the server actually does with the selection.
   * A successful `PUT` emits `premium_theme_selected`, which `TelemetryService` sends to
   * PostHog Cloud, so the palette key leaves CoutureCast every time someone saves. The
   * first draft of this key claimed the opposite ("nothing about your choice is shared
   * outside CoutureCast"), which was false the moment Decision 14's event landed.
   *
   * The positive token check is the guard that holds in all ten languages: reverting any
   * catalog to copy without the analytics sentence drops the token and fails here. The
   * negative below is English-only because it pins the exact false sentence that shipped,
   * and it is the check that catches a copy pass reaching for the reassuring absolute
   * again. The bounded negative that replaced it ("no wardrobe photos or personal
   * details are shared") is the same shape `commerce.settings.disclosure` already uses,
   * and it is true.
   */
  it('5.3-I18N-WEB-10 discloses the analytics dispatch instead of denying it', () => {
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
