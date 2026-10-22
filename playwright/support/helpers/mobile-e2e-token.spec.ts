// Story 6.5: the Maestro bearer must carry an expiry the realtime handshake can read.
import { describe, expect, it } from 'vitest'
import {
  buildMobileE2EAccessToken,
  MOBILE_E2E_TOKEN_MARKER,
} from '../../../scripts/lib/mobile-e2e-token.mjs'

const claims = (token: string): Record<string, unknown> =>
  JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString('utf8')) as Record<
    string,
    unknown
  >

describe('mobile E2E bearer', () => {
  it('keeps the bypass marker shape', () => {
    const token = buildMobileE2EAccessToken('user-1')
    expect(token.split('.')).toHaveLength(3)
    expect(token.endsWith(`.${MOBILE_E2E_TOKEN_MARKER}`)).toBe(true)
    expect(claims(token)).toMatchObject({
      sub: 'user-1',
      role: 'guardian',
      e2e: MOBILE_E2E_TOKEN_MARKER,
    })
  })

  it('expires 12 hours out, matching the web local E2E bearer', () => {
    const before = Math.floor(Date.now() / 1000)
    const { exp } = claims(buildMobileE2EAccessToken('user-1', 'teen'))
    // Without `exp` the realtime handshake reads the bearer as already expired and
    // refuses every socket, so the app never leaves HTTP polling in Maestro.
    expect(typeof exp).toBe('number')
    expect(exp).toBeGreaterThanOrEqual(before + 12 * 60 * 60)
    expect(exp).toBeLessThanOrEqual(Math.floor(Date.now() / 1000) + 12 * 60 * 60)
  })
})
