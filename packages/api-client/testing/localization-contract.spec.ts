import { describe, expect, it } from 'vitest'
import {
  resolveAcceptLanguage,
  resolveSupportedLocale,
  ritualQueryParamsSchema,
  supportedLocales,
  userPreferencesInputSchema,
} from '../src/contracts/http/index.js'

describe('localization HTTP contracts', () => {
  it('accepts every supported locale and rejects unsupported profile values', () => {
    for (const locale of supportedLocales) {
      expect(userPreferencesInputSchema.parse({ locale })).toEqual({ locale })
    }

    expect(() => userPreferencesInputSchema.parse({ locale: 'ja-JP' })).toThrow()
    expect(() => userPreferencesInputSchema.parse({ locale: ' ' })).toThrow()
  })

  it('normalizes regional and case-insensitive locale tags', () => {
    expect(resolveSupportedLocale('TR-tr')).toBe('tr-TR')
    expect(resolveSupportedLocale('fr_CA')).toBe('fr-CA')
    expect(resolveSupportedLocale('pt')).toBe('pt-PT')
    expect(resolveSupportedLocale('unknown')).toBeUndefined()
  })

  it('negotiates all Accept-Language ranges by quality', () => {
    expect(resolveAcceptLanguage('xx-ZZ, fr-ca;q=0.6, tr-TR;q=0.9')).toBe('tr-TR')
    expect(resolveAcceptLanguage('fr-FR;q=0, es;q=0.8')).toBe('es-419')
  })

  it('supports an explicit ritual locale override', () => {
    expect(ritualQueryParamsSchema.parse({ locale: 'de-DE' })).toEqual({
      locale: 'de-DE',
    })
    expect(() => ritualQueryParamsSchema.parse({ locale: 'ja-JP' })).toThrow()
  })
})
