// Learning path Step 57: Google sign-in.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-57-google-sign-in
// Story 6.17 D11: the Google sign-in copy, ten locales, one key set, and the same base-language
// fallbacks as the clients' i18n.
import { describe, expect, it } from 'vitest'
import {
  FEDERATED_SIGNIN_STRINGS,
  getFederatedSignInStrings,
  resolveFederatedSignInLocale,
} from './strings'

describe('federated sign-in strings', () => {
  it('every locale has the en-US key set with no empty value', () => {
    const keys = Object.keys(FEDERATED_SIGNIN_STRINGS['en-US']).sort()
    for (const [locale, strings] of Object.entries(FEDERATED_SIGNIN_STRINGS)) {
      expect(Object.keys(strings).sort(), locale).toEqual(keys)
      for (const [key, value] of Object.entries(strings))
        expect(value.trim(), `${locale}.${key}`).not.toBe('')
    }
  })

  it.each([
    ['es-419', 'es-419'],
    ['es', 'es-419'],
    ['es-MX', 'es-419'],
    ['es_419', 'es-419'],
    ['fr', 'fr-FR'],
    ['fr-CA', 'fr-CA'],
    ['fr-ca', 'fr-CA'],
    ['pt', 'pt-PT'],
    ['pt-BR', 'pt-BR'],
    ['en-CA', 'en-CA'],
    ['en-GB', 'en-US'],
    ['tr', 'tr-TR'],
    ['de-AT', 'de-DE'],
    ['it', 'it-IT'],
    ['ja', 'en-US'],
    [undefined, 'en-US'],
    ['', 'en-US'],
  ])('resolves %j to %s', (input, expected) => {
    expect(resolveFederatedSignInLocale(input)).toBe(expected)
  })

  it('serves the Spanish copy for a bare es', () => {
    expect(getFederatedSignInStrings('es').continueWithGoogle).toBe(
      'Continuar con Google'
    )
  })
})
