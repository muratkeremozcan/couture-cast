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
    const locales = [deDE, enCA, es419, frCA, frFR, itIT, ptBR, ptPT, trTR]
    const canonicalKeys = flattenKeys(enUS.wardrobe.tagging).sort()

    for (const locale of locales) {
      expect(flattenKeys(locale.wardrobe.tagging).sort()).toEqual(canonicalKeys)
    }
  })
})
