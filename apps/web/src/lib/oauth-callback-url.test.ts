// Learning path Step 57: Google sign-in.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-57-google-sign-in
// Story 6.17 TEA red spec: U-CALLBACK-CLEAN and U-CALLBACK-HASH (D5, TEA-12).
// The callback URL carries a one-time code and GoTrue's error fields, in the query and again in
// the fragment. They are copied out once and removed from the address bar before anything else
// on the page can read the URL; only the `from` return intent stays.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { takeOAuthCallbackParams } from './oauth-callback-url'

afterEach(() => {
  window.history.replaceState(null, '', '/')
  vi.restoreAllMocks()
})

describe('takeOAuthCallbackParams', () => {
  it('returns the callback params and leaves only from in the URL', () => {
    window.history.replaceState(
      null,
      '',
      '/auth/callback?code=one-time-code&state=opaque-state&from=preview'
    )
    const replace = vi.spyOn(window.history, 'replaceState')
    const params = takeOAuthCallbackParams(window)
    expect(Object.fromEntries(params)).toEqual({
      code: 'one-time-code',
      state: 'opaque-state',
      from: 'preview',
    })
    expect(replace).toHaveBeenCalledTimes(1)
    expect(window.location.pathname).toBe('/auth/callback')
    expect(window.location.search).toBe('?from=preview')
    expect(window.location.hash).toBe('')
  })

  it('removes GoTrue error fields from the query and the fragment (TEA-12)', () => {
    window.history.replaceState(
      null,
      '',
      '/auth/callback?error=access_denied&error_code=provider_email_needs_verification' +
        '&error_description=Unverified+email&from=preview' +
        '#error=access_denied&error_code=provider_email_needs_verification' +
        '&error_description=Unverified+email'
    )
    const params = takeOAuthCallbackParams(window)
    expect(params.get('error')).toBe('access_denied')
    expect(params.get('error_code')).toBe('provider_email_needs_verification')
    expect(window.location.href).toBe(
      `${window.location.origin}/auth/callback?from=preview`
    )
  })

  it('keeps no other parameter, and no from that is not the literal', () => {
    window.history.replaceState(
      null,
      '',
      '/auth/callback?code=c&from=preview2&utm_source=x&access_token=leaked'
    )
    takeOAuthCallbackParams(window)
    expect(window.location.href).toBe(`${window.location.origin}/auth/callback`)
  })

  it('leaves a URL with nothing to remove untouched', () => {
    window.history.replaceState(null, '', '/auth/callback?from=preview')
    const replace = vi.spyOn(window.history, 'replaceState')
    expect(Object.fromEntries(takeOAuthCallbackParams(window))).toEqual({
      from: 'preview',
    })
    expect(window.location.search).toBe('?from=preview')
    expect(replace.mock.calls.length).toBeLessThanOrEqual(1)
  })
})
