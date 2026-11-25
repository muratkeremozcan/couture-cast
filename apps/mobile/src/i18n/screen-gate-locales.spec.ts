// Learning path Step 65: Signed-in shell without flashes.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-65-signed-in-shell-without-flashes
// Story CC-7.7: the screen gate's placeholder names itself ("Loading") to VoiceOver and
// TalkBack in all ten mobile locales.
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

const CATALOGS = {
  'en-US': enUS,
  'en-CA': enCA,
  'de-DE': deDE,
  'es-419': es419,
  'fr-CA': frCA,
  'fr-FR': frFR,
  'it-IT': itIT,
  'pt-BR': ptBR,
  'pt-PT': ptPT,
  'tr-TR': trTR,
} as const

const ENGLISH = ['en-US', 'en-CA'] as const
const TRANSLATED = Object.keys(CATALOGS).filter(
  (locale) => !(ENGLISH as readonly string[]).includes(locale)
) as (keyof typeof CATALOGS)[]

const label = (locale: keyof typeof CATALOGS) =>
  (CATALOGS[locale] as { common?: { loading?: unknown } }).common?.loading

describe('screen gate placeholder label', () => {
  it.each(ENGLISH)('7.7 %s reads Loading', (locale) => {
    expect(label(locale)).toBe('Loading')
  })

  it.each(TRANSLATED)('7.7 %s names the placeholder in its own language', (locale) => {
    const text = label(locale)

    expect(typeof text).toBe('string')
    expect((text as string).trim()).not.toBe('')
    expect(text).not.toBe('Loading')
  })
})
