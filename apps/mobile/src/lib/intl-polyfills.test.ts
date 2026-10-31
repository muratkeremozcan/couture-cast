// Learning path Step 41: Curated reactions.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-41-curated-reactions
import { afterAll, describe, expect, it, vi } from 'vitest'

const nativeIntl = vi.hoisted(() => {
  const original = {
    PluralRules: Intl.PluralRules,
    Locale: Intl.Locale,
    getCanonicalLocales: Intl.getCanonicalLocales,
  }
  // Reproduce the Hermes capability gap before evaluating the app's bootstrap.
  Reflect.deleteProperty(Intl, 'PluralRules')
  Reflect.deleteProperty(Intl, 'Locale')
  Reflect.deleteProperty(Intl, 'getCanonicalLocales')
  return original
})

import './intl-polyfills'

afterAll(() => {
  Object.assign(Intl, nativeIntl)
})

describe('native plural-rule bootstrap', () => {
  it('supports every shipped locale without native Intl plural APIs', () => {
    const locales = [
      'en-US',
      'en-CA',
      'fr-FR',
      'fr-CA',
      'es-419',
      'tr-TR',
      'de-DE',
      'it-IT',
      'pt-BR',
      'pt-PT',
    ]
    expect(Intl.PluralRules.supportedLocalesOf(locales)).toEqual(locales)
    expect(new Intl.PluralRules('en-US').select(1)).toBe('one')
    expect(new Intl.PluralRules('en-US').select(2)).toBe('other')
    expect(new Intl.PluralRules('fr-FR').select(0)).toBe('one')
    expect(new Intl.PluralRules('pt-BR').select(0)).toBe('one')
    expect(new Intl.PluralRules('pt-PT').select(0)).toBe('other')
  })
})
