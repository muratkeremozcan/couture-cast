// Learning path Step 66: One app shell and visual system.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-66-one-app-shell-and-visual-system
// Story CC-7.9 D9: the shell's strings (the top bar's back label and the error and not-found
// screens) ship in all ten web locales, translated, with the same placeholders.
import { describe, expect, it } from 'vitest'
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

const CATALOGS: Record<string, Catalog> = {
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

/** Every `shell.*` string, keyed by its dotted path under `shell`. */
function shellStrings(node: unknown, prefix = ''): Map<string, string> {
  const strings = new Map<string, string>()
  if (typeof node !== 'object' || node === null) return strings
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (typeof value === 'string') strings.set(`${prefix}${key}`, value)
    else
      for (const entry of shellStrings(value, `${prefix}${key}.`)) strings.set(...entry)
  }
  return strings
}

const placeholders = (value: string) =>
  [...value.matchAll(/{{\s*(\w+)\s*}}/g)].map((match) => match[1])
const reference = shellStrings(CATALOGS['en-US']?.shell)
const LOCALES = Object.keys(CATALOGS)

describe('7.9 shell strings (web)', () => {
  it('7.9-I18N-WEB-SHELL-01 holds the back label in en-US', () => {
    expect(reference.get('back')).toBe('Back')
  })

  it.each(LOCALES)(
    '7.9-I18N-WEB-SHELL-02 %s carries every shell key, non-empty, with the same placeholders',
    (locale) => {
      const catalog = shellStrings(CATALOGS[locale]?.shell)
      expect([...catalog.keys()].sort()).toEqual([...reference.keys()].sort())
      for (const [key, english] of reference) {
        const value = catalog.get(key) ?? ''
        expect(value.trim().length, `${locale}.shell.${key}`).toBeGreaterThan(0)
        expect(placeholders(value), `${locale}.shell.${key}`).toEqual(
          placeholders(english)
        )
      }
    }
  )

  it.each(LOCALES.filter((locale) => !locale.startsWith('en-')))(
    '7.9-I18N-WEB-SHELL-03 %s translates every shell string',
    (locale) => {
      const catalog = shellStrings(CATALOGS[locale]?.shell)
      const untranslated = [...reference].filter(
        ([key, english]) => catalog.get(key) === english
      )
      expect(untranslated.map(([key]) => key)).toEqual([])
    }
  )
})
