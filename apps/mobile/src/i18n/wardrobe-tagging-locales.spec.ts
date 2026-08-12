// Learning path Step 30: Smart tagging and comfort metadata.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-30-smart-tagging-and-comfort-metadata
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
