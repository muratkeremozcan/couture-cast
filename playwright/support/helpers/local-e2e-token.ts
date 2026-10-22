import type { ApiRole } from './api-test'

/** Explicit claims accepted by the API's existing local-only E2E identity parser. */
export function localE2EAccessToken(userId: string, role: ApiRole = 'guardian'): string {
  const claims = {
    sub: userId,
    role,
    e2e: 'couturecast-mobile-e2e',
    exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
  }

  // The web's local fixture bridge recognizes this prefix; the API reads the claims and marker.
  return `test-token.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.couturecast-mobile-e2e`
}
