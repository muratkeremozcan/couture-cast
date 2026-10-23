import { describe, expect, it } from 'vitest'
import { safeReturnPath } from './location-format'

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
