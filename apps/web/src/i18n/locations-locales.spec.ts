// Learning path Step 45: Client location capture.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-45-client-location-capture
// Story 1.2b: every locations key ships in all ten web locales.
import { describe, expect, it } from 'vitest'
import type { LocationFailureReason } from '../lib/locations'
import {
  errorKey,
  type LocationFailureStep,
} from '../app/components/locations/location-format'
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

/** The value at a dotted catalog key, or `undefined` when any segment is missing. */
function lookup(catalog: Catalog, key: string): unknown {
  return key
    .split('.')
    .reduce<unknown>(
      (node, segment) =>
        typeof node === 'object' && node !== null
          ? (node as Record<string, unknown>)[segment]
          : undefined,
      catalog
    )
}

// Records, so a reason or step added to the union fails to compile here until
// it is listed, and its catalog key is then checked below.
const FAILURE_REASONS: Record<LocationFailureReason, true> = {
  signed_out: true,
  invalid_query: true,
  invalid_candidate: true,
  limit_reached: true,
  duplicate: true,
  provider_unavailable: true,
  service_unavailable: true,
  rate_limited: true,
  not_found: true,
  unknown: true,
}
const FAILURE_STEPS: Record<LocationFailureStep, true> = { search: true, save: true }

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

  // The settings page hosts the Locations section; its heading was English on
  // every locale before Story 1.2b.
  it('1.2b-I18N-WEB-07 ships a translated settings page title in every locale', () => {
    expect(lookup(CATALOGS['en-US'], 'settings.title')).toBe('Settings')
    for (const locale of SUPPORTED_LOCALES) {
      const title = lookup(CATALOGS[locale], 'settings.title')
      expect(typeof title, locale).toBe('string')
      expect(String(title).trim().length, locale).toBeGreaterThan(0)
      if (!locale.startsWith('en-')) expect(title, locale).not.toBe('Settings')
    }
  })

  // Parity proves the catalogs agree with each other; this proves they hold the
  // keys the UI builds, so a key renamed in every catalog cannot render raw.
  it('1.2b-I18N-WEB-08 ships every error key the Locations UI builds in every locale', () => {
    const keys = new Set(
      Object.keys(FAILURE_REASONS).flatMap((reason) =>
        Object.keys(FAILURE_STEPS).map((step) =>
          errorKey(reason as LocationFailureReason, step as LocationFailureStep)
        )
      )
    )
    expect(keys.size).toBeGreaterThan(5)
    for (const locale of SUPPORTED_LOCALES) {
      for (const key of keys) {
        const value = lookup(CATALOGS[locale], key)
        expect(
          typeof value === 'string' && value.trim().length > 0,
          `${locale} ${key}`
        ).toBe(true)
      }
    }
  })
})
