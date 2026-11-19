// Production follow-up after the project close (2026-11-19): member-owned sections follow the
// verified session (`MemberScope` in lib/use-web-session.ts), so a bare bearer in session storage
// no longer reads as a member. The one bearer that counts without a verified member is the e2e
// fixture bearer: a `test-token` prefix under NEXT_PUBLIC_E2E_AUTH (lib/web-session.ts). Unit
// tests that only need "a member is signed in" sign in with it here.
import { onTestFinished, vi } from 'vitest'
import { WEB_ACCESS_TOKEN_STORAGE_KEY } from '../lib/wardrobe'

/** The fixture bearer these tests sign in with, and the one their requests carry. */
export const FIXTURE_ACCESS_TOKEN = 'test-token-access'

/**
 * Signs this tab in as the fixture member. Call it from a test or a `beforeEach`; the env stub
 * is undone when that test finishes.
 */
export function signInFixtureMember(token: string = FIXTURE_ACCESS_TOKEN): void {
  if (!token.startsWith('test-token'))
    throw new Error(`The fixture bearer needs the test-token prefix: ${token}`)
  vi.stubEnv('NEXT_PUBLIC_E2E_AUTH', 'true')
  onTestFinished(() => {
    vi.unstubAllEnvs()
  })
  window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, token)
}
