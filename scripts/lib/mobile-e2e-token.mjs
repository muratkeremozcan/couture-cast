// Mobile E2E bearer for the app under test (moved out of run-maestro.mjs so it is testable).
//
// The token is unsigned and is never verified as a JWT. The API matches it through its
// existing `TEST_ENV`-gated bypass list, keyed on the `e2e` marker claim, which is shared
// with `matchMobileE2EBypass` in
// `apps/api/src/modules/auth/access-token-identity.service.ts` and kept in sync by hand:
// the API must not import a helper that manufactures bearer tokens.
export const MOBILE_E2E_TOKEN_MARKER = 'couturecast-mobile-e2e'

export function buildMobileE2EAccessToken(userId, role = 'guardian') {
  const encodeSegment = (value) =>
    Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')
  const header = encodeSegment({ alg: 'none', typ: 'JWT' })
  // Twelve hours outlasts any run and matches the web `localE2EAccessToken`. The realtime
  // handshake reads `exp` before it verifies anything; a bearer without one is expired.
  const exp = Math.floor(Date.now() / 1000) + 12 * 60 * 60
  const payload = encodeSegment({ sub: userId, role, exp, e2e: MOBILE_E2E_TOKEN_MARKER })
  return `${header}.${payload}.${MOBILE_E2E_TOKEN_MARKER}`
}
