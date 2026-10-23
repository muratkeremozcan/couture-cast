// Story 1.2b: every locations key ships in all ten web locales.
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

function locationsTree(catalog: Catalog): unknown {
  return catalog.locations ?? {}
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

const reference = flatten(locationsTree(enUS as Catalog))

describe('1.2b locations locale parity (web)', () => {
  it('1.2b-I18N-WEB-01 ships a locations tree for every supported locale', () => {
    for (const locale of SUPPORTED_LOCALES) {
      expect(flatten(locationsTree(CATALOGS[locale])).size, locale).toBe(reference.size)
    }
    expect(reference.size).toBeGreaterThan(30)
  })

  it('1.2b-I18N-WEB-02 uses an identical key tree in every locale', () => {
    const expected = [...reference.keys()].sort()
    for (const locale of SUPPORTED_LOCALES) {
      const actual = [...flatten(locationsTree(CATALOGS[locale])).keys()].sort()
      expect(actual, `${locale} key tree`).toEqual(expected)
    }
  })

  it('1.2b-I18N-WEB-03 keeps interpolation placeholders identical across locales', () => {
    for (const locale of SUPPORTED_LOCALES) {
      const catalog = flatten(locationsTree(CATALOGS[locale]))
      for (const [key, englishValue] of reference) {
        expect(placeholders(catalog.get(key) ?? ''), `${locale}.${key}`).toEqual(
          placeholders(englishValue)
        )
      }
    }
  })

  /** An untranslated value means the catalog silently fell back to English. */
  it('1.2b-I18N-WEB-04 does not leave English values in non-English catalogs', () => {
    for (const locale of SUPPORTED_LOCALES.filter((tag) => !tag.startsWith('en-'))) {
      const catalog = flatten(locationsTree(CATALOGS[locale]))
      const untranslated = [...reference.entries()]
        .filter(([key, englishValue]) => catalog.get(key) === englishValue)
        .map(([key]) => key)
      expect(untranslated, `${locale} untranslated keys`).toEqual([])
    }
  })

  it('1.2b-I18N-WEB-05 never ships an empty string', () => {
    for (const locale of SUPPORTED_LOCALES) {
      for (const [key, value] of flatten(locationsTree(CATALOGS[locale]))) {
        expect(value.trim().length, `${locale}.${key}`).toBeGreaterThan(0)
      }
    }
  })

  it('1.2b-I18N-WEB-06 matches the canonical en-US strings', () => {
    expect(reference.get('title')).toBe('Locations')
    expect(reference.get('limit')).toBe(
      'You have saved three locations. Delete one to add another.'
    )
    expect(reference.get('guided.add')).toBe('Add a location')
    expect(reference.get('errors.provider_unavailable')).toBe(
      'City search is temporarily unavailable. Try again.'
    )
  })
})
