// Story CC-7.9 D9 owner: the native Wardrobe hub strings that were hard-coded English (the
// loading label, the Saved Looks fallback error, the garment status words and the signed-out
// error) ship in all ten mobile catalogs.
// Learning path Step 66: One app shell and visual system.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-66-one-app-shell-and-visual-system
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

/** Every garment status the contract names today, plus the open-set fallback. */
const STATUS_KEYS = [
  'pending_upload',
  'bytes_uploaded',
  'processing',
  'awaiting_tags',
  'ready',
  'failed',
  'unknown',
] as const

function hubTree(catalog: Catalog): Record<string, unknown> {
  const wardrobe = (catalog.wardrobe ?? {}) as Record<string, Record<string, unknown>>
  return {
    hub: wardrobe.hub ?? {},
    'error.sign_in_required': wardrobe.error?.sign_in_required,
  }
}

function flatten(value: unknown, prefix = ''): Map<string, string> {
  const out = new Map<string, string>()
  if (typeof value !== 'object' || value === null) return out
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (typeof child === 'object' && child !== null) {
      for (const [nested, nestedValue] of flatten(child, path))
        out.set(nested, nestedValue)
    } else if (typeof child === 'string') {
      out.set(path, child)
    }
  }
  return out
}

const reference = flatten(hubTree(enUS as Catalog))

describe('7.9 mobile Wardrobe hub locale parity', () => {
  it('7.9-I18N-MOB-01 ships 10 hub keys in the reference catalog, one per garment status', () => {
    expect(reference.size).toBe(10)
    for (const status of STATUS_KEYS) {
      expect(reference.has(`hub.status.${status}`), status).toBe(true)
    }
  })

  it('7.9-I18N-MOB-02 uses an identical key tree in every locale', () => {
    const expected = [...reference.keys()].sort()
    for (const locale of SUPPORTED_LOCALES) {
      const actual = [...flatten(hubTree(CATALOGS[locale])).keys()].sort()
      expect(actual, `${locale} key tree`).toEqual(expected)
    }
  })

  it('7.9-I18N-MOB-03 does not leave English values in non-English catalogs', () => {
    for (const locale of SUPPORTED_LOCALES.filter((l) => !l.startsWith('en-'))) {
      const catalog = flatten(hubTree(CATALOGS[locale]))
      const untranslated = [...reference.entries()]
        .filter(([key, englishValue]) => catalog.get(key) === englishValue)
        .map(([key]) => key)
      expect(untranslated, `${locale} untranslated keys`).toEqual([])
    }
  })

  it('7.9-I18N-MOB-04 never ships an empty string', () => {
    for (const locale of SUPPORTED_LOCALES) {
      for (const [key, value] of flatten(hubTree(CATALOGS[locale]))) {
        expect(value.trim().length, `${locale}.${key}`).toBeGreaterThan(0)
      }
    }
  })

  it('7.9-I18N-MOB-05 keeps the awaiting-tags status apart from the Needs tags action', () => {
    // A device flow taps the "Needs tags" button by its text; a status word equal to it would
    // put two matches on the card.
    for (const locale of SUPPORTED_LOCALES) {
      const wardrobe = CATALOGS[locale].wardrobe as { tagging: { needs_tags: string } }
      expect(
        flatten(hubTree(CATALOGS[locale])).get('hub.status.awaiting_tags'),
        locale
      ).not.toBe(wardrobe.tagging.needs_tags)
    }
  })
})
