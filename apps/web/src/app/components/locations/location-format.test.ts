import { describe, expect, it } from 'vitest'
import { errorKey, formatPlace, safeReturnPath } from './location-format'

const ORIGIN = 'https://couture.example'

describe('safeReturnPath', () => {
  it('1.2b-WEB-13 keeps no target as no navigation', () => {
    expect(safeReturnPath(null, ORIGIN)).toBeNull()
    expect(safeReturnPath('', ORIGIN)).toBeNull()
  })

  it.each([
    ['root', '/', '/'],
    ['path with query and hash', '/wardrobe?tab=all#top', '/wardrobe?tab=all#top'],
    ['dot segments that stay on this origin', '/a/../community', '/community'],
  ])('1.2b-WEB-14 keeps a same-origin %s', (_name, value, expected) => {
    expect(safeReturnPath(value, ORIGIN)).toBe(expected)
  })

  it.each([
    ['protocol-relative', '//evil.example/path'],
    ['backslash host', '/\\evil.example'],
    ['leading backslashes', '\\\\evil.example'],
    ['tab-split protocol-relative', '/\t/evil.example'],
    ['newline-split protocol-relative', '/\n/evil.example'],
    ['encoded slash', '/%2Fevil.example'],
    ['encoded backslash', '/%5Cevil.example'],
    ['double-encoded slash', '/%252F%252Fevil.example'],
    ['absolute URL', 'https://evil.example/'],
    ['javascript scheme', 'javascript:alert(1)'],
    ['relative path', 'settings'],
  ])('1.2b-WEB-15 sends a %s target home', (_name, value) => {
    expect(safeReturnPath(value, ORIGIN)).toBe('/')
  })
})

describe('errorKey', () => {
  it('1.2b-WEB-16b names save, search, limit and unknown failures apart', () => {
    expect(errorKey('provider_unavailable')).toBe('locations.errors.provider_unavailable')
    expect(errorKey('provider_unavailable', 'save')).toBe(
      'locations.errors.save_unavailable'
    )
    expect(errorKey('duplicate', 'save')).toBe('locations.errors.duplicate')
    expect(errorKey('limit_reached')).toBe('locations.limit')
    expect(errorKey('not_found')).toBe('locations.errors.unknown')
  })
})

describe('formatPlace', () => {
  it('1.2b-WEB-16c localizes an ISO country and keeps a legacy free-text one', () => {
    expect(formatPlace({ city: 'Lyon', region: null, country: 'FR' }, 'en-US')).toBe(
      'Lyon, France'
    )
    expect(formatPlace({ city: 'Lyon', region: null, country: 'FR' }, 'de-DE')).toBe(
      'Lyon, Frankreich'
    )
    expect(
      formatPlace(
        { city: 'Springfield', region: 'IL', country: 'United States' },
        'en-US'
      )
    ).toBe('Springfield, IL, United States')
    expect(formatPlace({ city: 'Somewhere', region: null, country: null }, 'en-US')).toBe(
      'Somewhere'
    )
  })
})
