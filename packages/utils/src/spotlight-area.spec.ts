import { describe, expect, it } from 'vitest'
import {
  canonicalCountryCode,
  canonicalSpotlightArea,
  foldAreaComponent,
  SPOTLIGHT_COUNTRY_LOCALES,
  spotlightCountryCodes,
} from './spotlight-area.js'

describe('spotlight area canonicalization', () => {
  it('resolves the same country from codes, aliases and every product locale', () => {
    for (const text of [
      'US',
      'us',
      'USA',
      'U.S.A.',
      'U.S.',
      'United States',
      'united states of america',
      ' Estados Unidos ',
      'États-Unis',
      'Vereinigte Staaten',
      'Stati Uniti',
      'Amerika Birleşik Devletleri',
    ]) {
      expect(canonicalCountryCode(text), text).toBe('US')
    }
    expect(canonicalCountryCode('Deutschland')).toBe('DE')
    expect(canonicalCountryCode('Allemagne')).toBe('DE')
    expect(canonicalCountryCode('UK')).toBe('GB')
    expect(canonicalCountryCode('Great Britain')).toBe('GB')
    expect(canonicalCountryCode('Turkey')).toBe('TR')
    expect(canonicalCountryCode('Türkiye')).toBe('TR')
    expect(canonicalCountryCode('TURKIYE')).toBe('TR')
    expect(canonicalCountryCode('Brasil')).toBe('BR')
    expect(canonicalCountryCode("Côte d'Ivoire")).toBe('CI')
    expect(canonicalCountryCode('Cote d’Ivoire')).toBe('CI')
    expect(canonicalCountryCode('Guinea Bissau')).toBe('GW')
    expect(canonicalCountryCode('Kosovo')).toBe('XK')
  })

  it('leaves unknown, blank and non-country text unresolved', () => {
    for (const text of [
      null,
      undefined,
      '',
      '   ',
      '...',
      'Atlantis',
      'Land 1a2b3c',
      'European Union',
      'EU',
      'United Nations',
      'Unknown Region',
      'ZZ',
      'Pseudo-Accents',
    ]) {
      expect(canonicalCountryCode(text), String(text)).toBeNull()
    }
  })

  it('lists exactly the ISO 3166-1 alpha-2 codes plus Kosovo', () => {
    const codes = spotlightCountryCodes()
    expect(codes).toHaveLength(250)
    expect(codes).toContain('US')
    expect(codes).toContain('XK')
    for (const excluded of ['UK', 'AN', 'EU', 'UN', 'ZZ', 'AC', 'EA']) {
      expect(codes).not.toContain(excluded)
    }
    expect([...codes].sort()).toEqual(codes)
    expect(spotlightCountryCodes()).toBe(codes)
    expect(SPOTLIGHT_COUNTRY_LOCALES).toHaveLength(10)
  })

  it('folds region and city spellings to one form', () => {
    expect(foldAreaComponent('São Paulo')).toBe('sao paulo')
    expect(foldAreaComponent('  SAO PAULO ')).toBe('sao paulo')
    expect(foldAreaComponent('İstanbul')).toBe('istanbul')
    expect(foldAreaComponent('Istanbul')).toBe('istanbul')
    expect(foldAreaComponent('ıstanbul')).toBe('istanbul')
    expect(foldAreaComponent('Ｚüｒｉｃｈ')).toBe('zurich')
    expect(foldAreaComponent('서울')).toBe('서울')
    expect(foldAreaComponent(' \u0301 ')).toBeNull()
    expect(foldAreaComponent('   ')).toBeNull()
    expect(foldAreaComponent(null)).toBeNull()
    expect(foldAreaComponent(undefined)).toBeNull()
  })

  it('keeps only the prefix whose parents resolve', () => {
    expect(
      canonicalSpotlightArea({
        country: 'Brasil',
        region: 'São Paulo',
        city: 'São Paulo',
      })
    ).toEqual({ country: 'BR', region: 'sao paulo', city: 'sao paulo' })
    expect(
      canonicalSpotlightArea({ country: 'Atlantis', region: 'North', city: 'Port' })
    ).toEqual({ country: null, region: null, city: null })
    expect(
      canonicalSpotlightArea({ country: 'USA', region: '  ', city: 'Springfield' })
    ).toEqual({ country: 'US', region: null, city: null })
    expect(
      canonicalSpotlightArea({ country: 'Türkiye', region: 'İstanbul', city: null })
    ).toEqual({ country: 'TR', region: 'istanbul', city: null })
  })
})
