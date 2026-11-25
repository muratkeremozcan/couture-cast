// Learning path Step 65: Signed-in shell without flashes.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-65-signed-in-shell-without-flashes
// Story CC-7.7 (AC5): the request classification behind the fixed responses in
// signed-in-shell-layout-shift.spec.ts. A read sorted into the wrong gate would make the late
// mode (7.7-E2E-005) delay a gate read, or serve a read nobody meant to stub.
import { describe, expect, it } from 'vitest'
import { localE2EAccessToken } from './local-e2e-token'
import { fixtureOwner, GATE_READS, readKey } from './shell-fixtures'

const api = 'http://127.0.0.1:4000/api/v1'

describe('readKey', () => {
  it('tells the two Spotlight reads apart by surface', () => {
    expect(readKey(`${api}/community/spotlight?limit=1&surface=home_teaser`, 'GET')).toBe(
      'home-teaser'
    )
    expect(readKey(`${api}/community/spotlight?limit=6`, 'GET')).toBe(
      'community-spotlight'
    )
  })

  it('names same-origin and API-origin reads alike, with or without a query', () => {
    expect(readKey('http://localhost:3000/api/v1/ritual?locale=en-US', 'GET')).toBe(
      'ritual'
    )
    expect(readKey(`${api}/wardrobe/garments`, 'GET')).toBe('garments')
    expect(readKey(`${api}/wardrobe/saved-looks?limit=50&offset=0`, 'GET')).toBe(
      'saved-looks'
    )
  })

  it('serves only the resolve POST and leaves every other write and unknown read alone', () => {
    expect(readKey(`${api}/community/targets/resolve`, 'POST')).toBe('community-resolve')
    expect(readKey(`${api}/wardrobe/garments`, 'POST')).toBeNull()
    expect(readKey(`${api}/user/preferences`, 'GET')).toBeNull()
  })

  it('knows every read a gate waits for', () => {
    const known = [
      `${api}/ritual`,
      `${api}/community/spotlight?surface=home_teaser`,
      `${api}/community/spotlight?limit=6`,
      `${api}/community/feed`,
      `${api}/user/profile`,
      `${api}/wardrobe/onboarding`,
      `${api}/wardrobe/garments`,
      `${api}/locations`,
      `${api}/commerce/preferences`,
      `${api}/commerce/subscription`,
      `${api}/commerce/premium/access`,
      `${api}/commerce/premium/theme`,
    ].map((url) => readKey(url, 'GET'))

    for (const key of Object.values(GATE_READS).flat()) expect(known).toContain(key)
  })
})

describe('fixtureOwner', () => {
  it('reads the member from a local fixture bearer', () => {
    expect(fixtureOwner(`Bearer ${localE2EAccessToken('shell-member-b')}`)).toBe(
      'shell-member-b'
    )
  })

  it('is null for a missing, foreign or corrupt bearer', () => {
    expect(fixtureOwner(undefined)).toBeNull()
    expect(fixtureOwner('Bearer eyJhbGciOiJIUzI1NiJ9.e30.sig')).toBeNull()
    expect(fixtureOwner('Bearer test-token.%%%.couturecast-mobile-e2e')).toBeNull()
  })
})
