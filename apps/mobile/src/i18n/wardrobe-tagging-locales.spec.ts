// Learning path Step 30: Smart tagging and comfort metadata.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-30-smart-tagging-and-comfort-metadata
// Learning path Step 58: Hosted wardrobe workers and manual tagging.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#hosted-wardrobe-workers-and-manual-tagging
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

function flattenKeys(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return [prefix]
  }
  return Object.entries(value).flatMap(([key, child]) =>
    flattenKeys(child, prefix ? `${prefix}.${key}` : key)
  )
}

describe('wardrobe smart-tagging locale parity', () => {
  it('keeps every smart-tagging key present in every supported locale', () => {
    const locales = [
      ['de-DE', deDE],
      ['en-CA', enCA],
      ['es-419', es419],
      ['fr-CA', frCA],
      ['fr-FR', frFR],
      ['it-IT', itIT],
      ['pt-BR', ptBR],
      ['pt-PT', ptPT],
      ['tr-TR', trTR],
    ] as const
    const canonicalKeys = flattenKeys(enUS.wardrobe.tagging).sort()

    for (const [localeId, locale] of locales) {
      expect(
        flattenKeys(locale.wardrobe.tagging).sort(),
        `tagging keys for ${localeId}`
      ).toEqual(canonicalKeys)
    }
  })
})

/** The copy shown before the API names the mode, in manual mode, and on the close control. */
const NEUTRAL_KEYS = [
  'loading',
  'pending_title',
  'pending_desc',
  'manual_title',
  'manual_desc',
  'close',
] as const

describe('wardrobe tagging copy that must not promise suggestions', () => {
  const locales = [
    ['en-US', enUS],
    ['en-CA', enCA],
    ['de-DE', deDE],
    ['es-419', es419],
    ['fr-CA', frCA],
    ['fr-FR', frFR],
    ['it-IT', itIT],
    ['pt-BR', ptBR],
    ['pt-PT', ptPT],
    ['tr-TR', trTR],
  ] as const

  it.each(NEUTRAL_KEYS)(
    'has %s in all ten locales, translated outside English',
    (key) => {
      for (const [localeId, locale] of locales) {
        const value = (locale.wardrobe.tagging as unknown as Record<string, string>)[key]
        expect(value, `${key} in ${localeId}`).toBeTruthy()
        if (!localeId.startsWith('en-')) {
          expect(value, `${key} in ${localeId}`).not.toBe(
            (enUS.wardrobe.tagging as unknown as Record<string, string>)[key]
          )
        }
      }
    }
  )

  it('words the English neutral copy without smart, suggest or AI', () => {
    for (const [localeId, locale] of locales.filter(([id]) => id.startsWith('en-'))) {
      for (const key of NEUTRAL_KEYS) {
        expect(
          (locale.wardrobe.tagging as unknown as Record<string, string>)[key],
          `${key} in ${localeId}`
        ).not.toMatch(/\bsmart\b|\bsuggest|\bAI\b/i)
      }
    }
  })

  it('has no key left from the retired suggestion-only loading line', () => {
    for (const [localeId, locale] of locales) {
      expect(locale.wardrobe.tagging, localeId).not.toHaveProperty('loading_suggestions')
    }
  })
})
