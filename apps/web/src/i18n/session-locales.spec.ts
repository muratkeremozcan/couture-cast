// Learning path Step 58: Production follow-ups after the project close.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#production-follow-ups-after-the-project-close
// Production follow-up after the project close (2026-11-19): when the session check fails (a
// timeout, a 5xx from the profile check), Shopping and partners, Premium, Interface palettes and
// the Palette advisor show their load error with one shared Try again control, which verifies the
// session again. Its one string ships in all ten web locales.
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

function sessionStrings(catalog: Catalog): Record<string, string> {
  const node = catalog.session
  if (typeof node !== 'object' || node === null) return {}
  return Object.fromEntries(
    Object.entries(node as Record<string, unknown>).map(([key, value]) => [
      key,
      String(value),
    ])
  )
}

/** The Locations section's own retry, which says the same thing in every locale. */
function locationsRetry(catalog: Catalog): string {
  return (catalog as { locations: { loadRetry: string } }).locations.loadRetry
}

describe('Session outage locale parity (web)', () => {
  it('SESSION-I18N-WEB-01 matches the canonical en-US strings', () => {
    expect(sessionStrings(CATALOGS['en-US'])).toEqual({ retry: 'Try again' })
  })

  it('SESSION-I18N-WEB-02 ships the same keys, non-empty, in every locale', () => {
    for (const locale of SUPPORTED_LOCALES) {
      const strings = sessionStrings(CATALOGS[locale])
      expect(Object.keys(strings), locale).toEqual(['retry'])
      expect(strings.retry?.trim().length, locale).toBeGreaterThan(0)
    }
  })

  it('SESSION-I18N-WEB-03 translates the retry outside English', () => {
    for (const locale of SUPPORTED_LOCALES.filter((tag) => !tag.startsWith('en-'))) {
      expect(sessionStrings(CATALOGS[locale]).retry, locale).not.toBe('Try again')
    }
  })

  it('SESSION-I18N-WEB-04 words the retry as the Locations section does on the same page', () => {
    for (const locale of SUPPORTED_LOCALES) {
      expect(sessionStrings(CATALOGS[locale]).retry, locale).toBe(
        locationsRetry(CATALOGS[locale])
      )
    }
  })
})
