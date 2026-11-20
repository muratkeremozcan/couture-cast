// Learning path Step 58: Hosted wardrobe workers and manual tagging.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#hosted-wardrobe-workers-and-manual-tagging
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

type Catalog = { wardrobe: { tagging: Record<string, string> } }

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

/** What the tag step shows before the API names the mode, and in manual mode. */
const KEYS = ['loading', 'pending_desc', 'manual_desc'] as const

describe('web tagging copy that must not promise suggestions', () => {
  it('has the same keys in all ten locales', () => {
    for (const locale of SUPPORTED_LOCALES) {
      expect(Object.keys(CATALOGS[locale].wardrobe.tagging).toSorted(), locale).toEqual(
        [...KEYS].toSorted()
      )
    }
  })

  it.each(KEYS)('has %s translated outside English', (key) => {
    for (const locale of SUPPORTED_LOCALES) {
      const value = CATALOGS[locale].wardrobe.tagging[key]
      expect(value, `${key} in ${locale}`).toBeTruthy()
      if (!locale.startsWith('en-')) {
        expect(value, `${key} in ${locale}`).not.toBe(
          CATALOGS['en-US'].wardrobe.tagging[key]
        )
      }
    }
  })

  it('words the English copy without smart, suggest or AI', () => {
    for (const locale of ['en-US', 'en-CA'] as const) {
      for (const key of KEYS) {
        expect(CATALOGS[locale].wardrobe.tagging[key], `${key} in ${locale}`).not.toMatch(
          /\bsmart\b|\bsuggest|\bAI\b/i
        )
      }
    }
  })
})
