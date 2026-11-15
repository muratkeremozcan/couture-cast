// Learning path Step 57: Google sign-in.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-57-google-sign-in
// Story 6.17 TEA red spec: U-INTENT-CALLBACK (D5). The OAuth callback link never reaches
// `+not-found`: while an in-process Google round trip waits for it, the router stays put (the
// in-process result completes sign-in); otherwise the link opens `/auth/callback` with its
// query unchanged. Nothing else changes routing.
import { afterEach, describe, expect, it } from 'vitest'
import { redirectSystemPath } from '@/app/+native-intent'
import { setNativeOAuthInFlight } from './native-oauth-flight'

afterEach(() => setNativeOAuthInFlight(false))

const callbacks = [
  [
    'the primary scheme',
    'couturecast://auth/callback?code=c-1&from=preview',
    '?code=c-1&from=preview',
  ],
  ['the mobile alias', 'mobile://auth/callback?code=c-2', '?code=c-2'],
  [
    'an isolated story build',
    'couturecast-story68://auth/callback?code=c-3',
    '?code=c-3',
  ],
  ['an Expo Go link', 'exp://127.0.0.1:8081/--/auth/callback?code=c-4', '?code=c-4'],
  [
    'an error callback',
    'couturecast://auth/callback?error=access_denied&error_code=provider_email_needs_verification',
    '?error=access_denied&error_code=provider_email_needs_verification',
  ],
] as const

describe('U-INTENT-CALLBACK', () => {
  it.each(callbacks)('drops %s while a round trip is in flight', (_label, path) => {
    setNativeOAuthInFlight(true)
    expect(redirectSystemPath({ path, initial: false })).toBe('')
    expect(redirectSystemPath({ path, initial: true })).toBe('')
  })

  it.each(callbacks)(
    'routes %s to /auth/callback with the same query when nothing waits',
    (_label, path, query) => {
      setNativeOAuthInFlight(false)
      expect(redirectSystemPath({ path, initial: true })).toBe(`/auth/callback${query}`)
      expect(redirectSystemPath({ path, initial: false })).toBe(`/auth/callback${query}`)
    }
  )

  it.each([
    'couturecast://guardian-accept?token=t-1',
    'couturecast://community?source=notification&type=community&cardId=post-1',
    'couturecast://auth/callbackx?code=c',
    'couturecast://evil/auth/callback?code=c',
    'couturecast://auth/callback/extra?code=c',
    '/(tabs)/community',
    'not a url',
  ])('passes %s through unchanged, in flight or not', (path) => {
    setNativeOAuthInFlight(true)
    expect(redirectSystemPath({ path, initial: false })).toBe(path)
    setNativeOAuthInFlight(false)
    expect(redirectSystemPath({ path, initial: false })).toBe(path)
  })
})
