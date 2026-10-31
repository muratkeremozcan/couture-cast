// Learning path Step 44: Community city spotlight.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-44-community-city-spotlight
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

  it('drops a leading article, reads & as and, saint as st, and knows formal names', () => {
    const cases: [string, string][] = [
      ['The Netherlands', 'NL'],
      ['the Bahamas', 'BS'],
      ['The Gambia', 'GM'],
      ['Les Pays-Bas', 'NL'],
      ['Die Niederlande', 'NL'],
      ['Gli Stati Uniti', 'US'],
      ['Os Estados Unidos', 'US'],
      ['El Salvador', 'SV'],
      ['Antigua and Barbuda', 'AG'],
      ['Antigua & Barbuda', 'AG'],
      ['Bosnia & Herzegovina', 'BA'],
      ['Korea', 'KR'],
      ['Republic of Korea', 'KR'],
      ['DPRK', 'KP'],
      ['Congo', 'CG'],
      ['Republic of the Congo', 'CG'],
      ['DRC', 'CD'],
      ['DR Congo', 'CD'],
      ['Democratic Republic of the Congo', 'CD'],
      ['Republic of Ireland', 'IE'],
      ['St Kitts and Nevis', 'KN'],
      ['Saint Kitts and Nevis', 'KN'],
      ['St. Kitts & Nevis', 'KN'],
      ['Saint Lucia', 'LC'],
    ]
    for (const [text, code] of cases) expect(canonicalCountryCode(text), text).toBe(code)
    // A lone code is never read as an article.
    expect(canonicalCountryCode('IL')).toBe('IL')
    expect(canonicalCountryCode('LA')).toBe('LA')
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

  it('keeps countries whose names contain one another apart', () => {
    const pairs: [string, string, string, string][] = [
      ['Niger', 'NE', 'Nigeria', 'NG'],
      ['Sudan', 'SD', 'South Sudan', 'SS'],
      ['Guinea', 'GN', 'Equatorial Guinea', 'GQ'],
      ['Dominica', 'DM', 'Dominican Republic', 'DO'],
      ['Austria', 'AT', 'Australia', 'AU'],
    ]
    for (const [left, leftCode, right, rightCode] of pairs) {
      expect(canonicalCountryCode(left), left).toBe(leftCode)
      expect(canonicalCountryCode(right), right).toBe(rightCode)
    }
  })

  it('round-trips every country name in every product locale and display style', () => {
    for (const locale of SPOTLIGHT_COUNTRY_LOCALES) {
      for (const style of ['long', 'short'] as const) {
        const names = new Intl.DisplayNames([locale], {
          type: 'region',
          style,
          fallback: 'none',
        })
        for (const code of spotlightCountryCodes()) {
          const name = names.of(code)
          expect(name, `${locale} ${style} ${code}`).toBeTruthy()
          expect(canonicalCountryCode(name), `${locale} ${style} ${name}`).toBe(code)
        }
      }
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
    expect(foldAreaComponent('São   Paulo')).toBe('sao paulo')
    expect(foldAreaComponent('Rio\tde\u00a0 Janeiro')).toBe('rio de janeiro')
    expect(foldAreaComponent('New\nYork')).toBe('new york')
    expect(foldAreaComponent('Straße')).toBe('strasse')
    expect(foldAreaComponent('Łódź')).toBe('lodz')
    expect(foldAreaComponent('Đà Nẵng')).toBe('da nang')
    expect(foldAreaComponent('Tromsø')).toBe('tromso')
    expect(foldAreaComponent('Ærøskøbing')).toBe('aeroskobing')
    expect(foldAreaComponent('Œuvre')).toBe('oeuvre')
    expect(foldAreaComponent('Þórshöfn')).toBe('thorshofn')
    // A name that extends another stays its own area.
    expect(foldAreaComponent('Paris')).toBe('paris')
    expect(foldAreaComponent('Parish')).toBe('parish')
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
