// Learning path Step 38: Community feed by climate band.
// Story 6.1 owner: ten-locale parity for the `community.*` tree on Mobile, plus
// the cross-surface check.
//
// This mirrors `apps/web/src/i18n/community-locales.spec.ts` case for case. The one
// test that only exists here is `6.1-I18N-MOB-09`, whose reasoning sits on the test
// itself.
//
// It lives on the mobile side because only the mobile vitest project can reach
// both sets of catalogs by relative path; `wardrobe-capsules-locales.spec.ts:155`
// already does the same import for the same reason.
//
// Three of the checks derive their expected key set from the contract rather than
// a hand-written list, because a hand-pinned list would have to be edited in
// lockstep with the enum by the same person who forgot to edit the catalogs.
//
// All non-English values are machine-translation drafts pending human review
// before release (PRD NFR Localization 1); these checks hold the tree together
// until that review lands.
import { CLIMATE_BANDS } from '@couture/utils'
import {
  communityBandUnresolvedReasonSchema,
  communityPostStatusSchema,
  communityReportReasonSchema,
} from '@couture/api-client/contracts/http'
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
 * Values legitimately spelled the same as the English source in a target
 * language, reviewed rather than left as an English fallback. Kept identical to
 * the web list on purpose: the two catalogs are required to match value for
 * value, so an entry that exists on one surface and not the other would make
 * `6.1-I18N-MOB-09` and `6.1-I18N-MOB-04` contradict each other.
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

const WEB_CATALOG_PATHS: Record<SupportedLocale, () => Promise<{ default: Catalog }>> = {
  'en-US': () => import('../../../web/src/i18n/locales/en-US.json'),
  'en-CA': () => import('../../../web/src/i18n/locales/en-CA.json'),
  'de-DE': () => import('../../../web/src/i18n/locales/de-DE.json'),
  'es-419': () => import('../../../web/src/i18n/locales/es-419.json'),
  'fr-CA': () => import('../../../web/src/i18n/locales/fr-CA.json'),
  'fr-FR': () => import('../../../web/src/i18n/locales/fr-FR.json'),
  'it-IT': () => import('../../../web/src/i18n/locales/it-IT.json'),
  'pt-BR': () => import('../../../web/src/i18n/locales/pt-BR.json'),
  'pt-PT': () => import('../../../web/src/i18n/locales/pt-PT.json'),
  'tr-TR': () => import('../../../web/src/i18n/locales/tr-TR.json'),
}

describe('6.1 community locale parity', () => {
  it('6.1-I18N-MOB-01 ships a non-empty community tree for every supported locale', () => {
    for (const locale of SUPPORTED_LOCALES) {
      const catalog = flatten(communityTree(CATALOGS[locale]))
      expect(catalog.size, `${locale} community tree`).toBeGreaterThan(0)
      for (const [key, value] of catalog) {
        expect(value.trim().length, `${locale}.${key}`).toBeGreaterThan(0)
      }
    }
  })

  it('6.1-I18N-MOB-02 uses an identical key tree in every locale', () => {
    const expected = [...reference.keys()].sort()
    for (const locale of SUPPORTED_LOCALES) {
      const actual = [...flatten(communityTree(CATALOGS[locale])).keys()].sort()
      expect(actual, `${locale} key tree`).toEqual(expected)
    }
  })

  it('6.1-I18N-MOB-03 keeps interpolation placeholders identical across locales', () => {
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
  it('6.1-I18N-MOB-04 does not leave English values in non-English catalogs', () => {
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
   * The band pills and the band filter row both render a `CLIMATE_BANDS` member,
   * so a seventh band fails here, in every locale at once, rather than painting a
   * raw `temperate_wet` onto a pill.
   */
  it('6.1-I18N-MOB-05 labels every climate band in every locale', () => {
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

  it('6.1-I18N-MOB-06 labels every community post status in every locale', () => {
    // `reason` is the "Reason: {{reason}}" suffix the flagged and consent states
    // append; every other child of `status` is one enum member.
    const expected = [...communityPostStatusSchema.options, 'reason'].sort()
    for (const locale of SUPPORTED_LOCALES) {
      expect(childKeys(CATALOGS[locale], 'status'), `${locale} status labels`).toEqual(
        expected
      )
    }
  })

  it('6.1-I18N-MOB-07 labels every report reason in every locale', () => {
    const expected = [...communityReportReasonSchema.options].sort()
    for (const locale of SUPPORTED_LOCALES) {
      expect(
        childKeys(CATALOGS[locale], 'report.reason'),
        `${locale} report reasons`
      ).toEqual(expected)
    }
  })

  it('6.1-I18N-MOB-08 explains every band-unresolved reason in every locale', () => {
    const expected = [...communityBandUnresolvedReasonSchema.options].sort()
    for (const locale of SUPPORTED_LOCALES) {
      expect(
        childKeys(CATALOGS[locale], 'band.unresolved'),
        `${locale} band-unresolved banners`
      ).toEqual(expected)
    }
  })

  /**
   * Web-only card-detail copy. The web grid clamps a card to a 256px thumbnail
   * and a 3-line caption, so opening a look there expands it into a modal with
   * its own open/close affordance. Mobile's card already renders a larger image
   * and exposes the full alt text to VoiceOver via `accessibilityLabel`, so the
   * open interaction there is a silent tap that only records the analytics
   * event -- there is no second surface to label. This is a deliberate,
   * documented exception rather than a gap: an unexplained absence would look
   * like a missed translation, and adding unused strings to mobile's catalogs to
   * satisfy the comparison would be worse than the asymmetry it papers over.
   */
  const WEB_ONLY_KEYS = ['card.detailClose', 'card.open', 'card.openLabel']

  /**
   * The spec requires identical localized states on both surfaces. Comparing
   * values rather than keys is what makes that a real check: two catalogs can
   * share a key tree and still tell a Turkish reader two different things about
   * a withdrawn post.
   */
  it('6.1-I18N-MOB-09 ships the same community tree on web and mobile in every locale', async () => {
    for (const locale of SUPPORTED_LOCALES) {
      const web = await WEB_CATALOG_PATHS[locale]()
      const webTree = Object.fromEntries(flatten(communityTree(web.default)))
      for (const key of WEB_ONLY_KEYS) {
        delete webTree[key]
      }
      expect(webTree, `${locale} web/mobile community tree`).toEqual(
        Object.fromEntries(flatten(communityTree(CATALOGS[locale])))
      )
    }
  })

  /**
   * `WEB_ONLY_KEYS` above is a documented exception, not a blind spot: this
   * pins that the web catalog actually carries every one of them, with a real
   * translation, in every locale. Without it a typo in the exception list
   * (or a key silently dropped from web) would pass MOB-09 by excluding
   * something that was never there to begin with.
   */
  it('6.1-I18N-MOB-10 still requires the documented web-only keys to exist and be translated', async () => {
    for (const locale of SUPPORTED_LOCALES) {
      const web = await WEB_CATALOG_PATHS[locale]()
      const webTree = Object.fromEntries(flatten(communityTree(web.default)))
      for (const key of WEB_ONLY_KEYS) {
        expect(webTree[key], `${locale} ${key}`).toBeTruthy()
        expect(webTree[key]?.trim().length, `${locale} ${key}`).toBeGreaterThan(0)
      }
    }
  })
})
