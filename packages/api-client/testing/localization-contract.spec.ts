import { describe, expect, it } from 'vitest'
import {
  resolveAcceptLanguage,
  resolveSupportedLocale,
  ritualQueryParamsSchema,
  supportedLocales,
  userPreferencesInputSchema,
  userPreferencesResponseSchema,
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

  it('only accepts true for a successful preference update response', () => {
    expect(userPreferencesResponseSchema.parse({ success: true })).toEqual({
      success: true,
    })
    expect(() => userPreferencesResponseSchema.parse({ success: false })).toThrow()
  })
})

describe('resolveSupportedLocale fallbacks', () => {
  // A missing profile locale and a missing header are both normal, so the
  // resolver has to answer "no opinion" rather than guessing a locale.
  it.each([null, undefined, ''])(
    'returns undefined for the absent locale tag %s',
    (tag) => {
      expect(resolveSupportedLocale(tag)).toBeUndefined()
    }
  )

  // BCP-47 tags can carry extension subtags. The full tag is not a supported
  // locale key, so the region has to be matched against the locale registry.
  it('matches a regional variant carried alongside extension subtags', () => {
    expect(resolveSupportedLocale('fr-CA-u-ca-gregory')).toBe('fr-CA')
    expect(resolveSupportedLocale('pt-BR-u-nu-latn')).toBe('pt-BR')
  })

  // An unknown region still has a usable language, so the language default is
  // better than falling back to English for a French speaker.
  it('falls back to the language default when the region is unknown', () => {
    expect(resolveSupportedLocale('fr-BE')).toBe('fr-FR')
    expect(resolveSupportedLocale('en-AU')).toBe('en-US')
  })

  it('returns undefined for a supported region under an unsupported language', () => {
    expect(resolveSupportedLocale('ja-CA')).toBeUndefined()
  })

  // A malformed tag with no language part must not be treated as a wildcard.
  it('returns undefined for a tag with an empty language subtag', () => {
    expect(resolveSupportedLocale('-US')).toBeUndefined()
  })
})

describe('resolveAcceptLanguage negotiation', () => {
  it('returns undefined when the header is absent', () => {
    expect(resolveAcceptLanguage(null)).toBeUndefined()
    expect(resolveAcceptLanguage(undefined)).toBeUndefined()
    expect(resolveAcceptLanguage('')).toBeUndefined()
  })

  // '*' means "anything", which is not a locale request. Treating it as one
  // would pin every wildcard client to whichever locale sorts first.
  it('ignores the wildcard range and empty entries', () => {
    expect(resolveAcceptLanguage('*')).toBeUndefined()
    expect(resolveAcceptLanguage('*, de-DE')).toBe('de-DE')
    expect(resolveAcceptLanguage('de-DE,,tr-TR')).toBe('de-DE')
  })

  it('returns undefined when no listed range maps to a supported locale', () => {
    expect(resolveAcceptLanguage('ja-JP, ko-KR;q=0.8')).toBeUndefined()
  })

  // Equal quality means the header order decides, so negotiation stays stable
  // instead of depending on the locale registry's own ordering.
  it('breaks a quality tie using the order the client listed', () => {
    expect(resolveAcceptLanguage('de-DE;q=0.8, tr-TR;q=0.8')).toBe('de-DE')
    expect(resolveAcceptLanguage('tr-TR;q=0.8, de-DE;q=0.8')).toBe('tr-TR')
  })

  // A malformed q value must drop the range rather than silently ranking it
  // first, which is what an unclamped NaN comparison would do.
  it('drops a range whose quality is unparseable or zero', () => {
    expect(resolveAcceptLanguage('de-DE;q=abc, tr-TR;q=0.5')).toBe('tr-TR')
    expect(resolveAcceptLanguage('de-DE;q=0, tr-TR;q=0.5')).toBe('tr-TR')
    expect(resolveAcceptLanguage('de-DE;q=-1, tr-TR;q=0.5')).toBe('tr-TR')
  })

  it('clamps an out-of-range quality above one instead of rejecting the range', () => {
    expect(resolveAcceptLanguage('de-DE;q=5, tr-TR')).toBe('de-DE')
  })

  it('ignores parameters other than q and tolerates surrounding whitespace', () => {
    expect(resolveAcceptLanguage('  de-DE ; charset=utf-8 ,  tr-TR ; q=0.9 ')).toBe(
      'de-DE'
    )
  })
})
