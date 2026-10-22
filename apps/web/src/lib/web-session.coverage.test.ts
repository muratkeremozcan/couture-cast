import type { Session } from '@supabase/supabase-js'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useMswHandlers } from '../test-utils/msw/runtime'
const sdk = vi.hoisted(() => ({
  current: null as Session | null,
  listener: undefined as undefined | ((event: string, value: Session | null) => void),
  getSession: vi.fn(),
  request: vi.fn(),
  verify: vi.fn(),
  logout: vi.fn(),
  unsubscribe: vi.fn(),
}))
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: {
      getSession: sdk.getSession,
      signInWithOtp: sdk.request,
      verifyOtp: sdk.verify,
      signOut: sdk.logout,
      onAuthStateChange: (listener: typeof sdk.listener) => {
        sdk.listener = listener
        return { data: { subscription: { unsubscribe: sdk.unsubscribe } } }
      },
    },
  }),
}))
const key = 'couturecast.access-token'
const cleanups: (() => void)[] = []
const session = (id = 'auth-a', token = 'token-a'): Session => ({
  access_token: token,
  refresh_token: 'synthetic-refresh',
  token_type: 'bearer',
  expires_in: 3600,
  user: {
    id,
    aud: 'authenticated',
    app_metadata: {},
    user_metadata: {},
    created_at: '2026-10-20T00:00:00Z',
  },
})
const profile = (id = 'app-a') => ({
  user: {
    id,
    email: 'member@example.test',
    displayName: null,
    birthdate: null,
    role: 'guardian',
  },
  linkedGuardians: [],
  linkedTeens: [],
})
beforeEach(() => {
  vi.resetModules()
  sdk.current = session()
  sdk.listener = undefined
  sdk.getSession.mockImplementation(() =>
    Promise.resolve({ data: { session: sdk.current }, error: null })
  )
  sdk.request.mockResolvedValue({ error: null })
  sdk.verify.mockImplementation(() =>
    Promise.resolve({ data: { session: sdk.current }, error: null })
  )
  sdk.logout.mockResolvedValue({ error: null })
  vi.stubEnv('NEXT_PUBLIC_E2E_AUTH', 'false')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://auth.synthetic.test')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'synthetic-anon')
  sessionStorage.clear()
  localStorage.clear()
})
afterEach(() => {
  cleanups.splice(0).forEach((stop) => stop())
  vi.unstubAllEnvs()
})
describe('verified web session failure boundaries', () => {
  it('fails closed when Auth configuration is absent', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '')
    const auth = await import('./web-session')
    expect(() => auth.webSupabase()).toThrow('Sign-in is unavailable')
    expect(sessionStorage.getItem(key)).toBeNull()
  })
  it('keeps the explicit local fixture bridge separate from SDK installation', async () => {
    vi.stubEnv('NEXT_PUBLIC_E2E_AUTH', 'true')
    sessionStorage.setItem(key, 'test-token-fixture')
    const auth = await import('./web-session')
    const stop = await auth.startWebSession()
    stop()
    expect(sdk.getSession).not.toHaveBeenCalled()
    expect(sessionStorage.getItem(key)).toBe('test-token-fixture')
  })
  it('reports issuance and verification failures without publishing a session', async () => {
    const auth = await import('./web-session')
    sdk.request.mockResolvedValue({ error: new Error('mail unavailable') })
    await expect(auth.requestWebOtp('member@example.test')).rejects.toThrow(
      'Sign-in could not be started'
    )
    sdk.verify.mockResolvedValue({ data: { session: null }, error: new Error('expired') })
    await expect(auth.verifyWebOtp('member@example.test', '123456')).rejects.toThrow(
      'Sign-in code could not be verified'
    )
    expect(auth.webSessionIdentity()).toBeNull()
    expect(sessionStorage.getItem(key)).toBeNull()
  })
  it('keeps recovery subscribed after SDK restore failure and ignores callbacks after cleanup', async () => {
    const reads = vi.fn()
    useMswHandlers(
      http.get('*/api/v1/user/profile', () => {
        reads()
        return HttpResponse.json(profile())
      })
    )
    sdk.getSession.mockResolvedValueOnce({
      data: { session: null },
      error: new Error('offline'),
    })
    const auth = await import('./web-session')
    const stop = await auth.startWebSession()
    sdk.listener!('SIGNED_IN', sdk.current)
    await vi.waitFor(() => expect(auth.webSessionIdentity()).toBe('app-a'))
    stop()
    sdk.listener!('SIGNED_OUT', null)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(auth.webSessionIdentity()).toBe('app-a')
    expect(reads).toHaveBeenCalledOnce()
    expect(sdk.unsubscribe).toHaveBeenCalledOnce()
  })
  it.each([401, 403, 404])(
    'clears a previously verified owner on affirmative profile denial %s',
    async (status) => {
      let denied = false
      useMswHandlers(
        http.get('*/api/v1/user/profile', () =>
          denied ? HttpResponse.json({}, { status }) : HttpResponse.json(profile())
        )
      )
      const auth = await import('./web-session')
      cleanups.push(await auth.startWebSession())
      expect(auth.webSessionIdentity()).toBe('app-a')
      denied = true
      sdk.current = session('auth-a', 'rotated-token')
      await expect(auth.resolveWebSessionToken()).rejects.toHaveProperty(
        'response.status',
        status
      )
      expect(auth.webSessionIdentity()).toBeNull()
      expect(sessionStorage.getItem(key)).toBeNull()
    }
  )
  it('retains verified owner state during a transient same-account verification failure', async () => {
    let unavailable = false
    useMswHandlers(
      http.get('*/api/v1/user/profile', () =>
        unavailable
          ? HttpResponse.json({}, { status: 503 })
          : HttpResponse.json(profile())
      )
    )
    const auth = await import('./web-session')
    cleanups.push(await auth.startWebSession())
    sdk.current = session('auth-a', 'new-token')
    unavailable = true
    await expect(auth.resolveWebSessionToken()).rejects.toHaveProperty(
      'response.status',
      503
    )
    expect(auth.webSessionIdentity()).toBe('app-a')
    expect(sessionStorage.getItem(key)).toBe('token-a')
    unavailable = false
    expect(await auth.resolveWebSessionToken()).toBe('new-token')
  })
  it('refuses a restored bearer whose remaining lifetime cannot cover verification', async () => {
    const reads = vi.fn()
    useMswHandlers(
      http.get('*/api/v1/user/profile', () => {
        reads()
        return HttpResponse.json(profile())
      })
    )
    sdk.current = { ...session(), expires_at: (Date.now() + 1000) / 1000 }
    const auth = await import('./web-session')
    await expect(auth.resolveWebSessionToken()).rejects.toThrow(
      'Session verification is unavailable'
    )
    expect(reads).not.toHaveBeenCalled()
    expect(sessionStorage.getItem(key)).toBeNull()
  })
  it('rechecks bearer lifetime after the profile request consumes its margin', async () => {
    const now = Date.now()
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now)
    sdk.current = { ...session(), expires_at: (now + 8000) / 1000 }
    useMswHandlers(
      http.get('*/api/v1/user/profile', () => {
        clock.mockReturnValue(now + 4000)
        return HttpResponse.json(profile())
      })
    )
    const auth = await import('./web-session')
    await expect(auth.resolveWebSessionToken()).rejects.toThrow(
      'Session verification is unavailable'
    )
  })
  it('clears both persistent keys even when SDK logout rejects', async () => {
    localStorage.setItem('couturecast.auth-session', 'session')
    localStorage.setItem('couturecast.auth-session-code-verifier', 'verifier')
    sessionStorage.setItem(key, 'old-token')
    sdk.logout.mockRejectedValue(new Error('offline'))
    const auth = await import('./web-session')
    await expect(auth.signOutWebSession()).rejects.toThrow('offline')
    expect(localStorage.getItem('couturecast.auth-session')).toBeNull()
    expect(localStorage.getItem('couturecast.auth-session-code-verifier')).toBeNull()
    expect(sessionStorage.getItem(key)).toBeNull()
    expect(await auth.resolveWebSessionToken()).toBeUndefined()
  })
  it('clears verified state when the SDK reports no session and propagates SDK uncertainty', async () => {
    useMswHandlers(http.get('*/api/v1/user/profile', () => HttpResponse.json(profile())))
    const auth = await import('./web-session')
    cleanups.push(await auth.startWebSession())
    sdk.getSession.mockResolvedValueOnce({
      data: { session: sdk.current },
      error: new Error('offline'),
    })
    await expect(auth.resolveWebSessionToken()).rejects.toThrow(
      'Session verification is unavailable'
    )
    expect(auth.webSessionIdentity()).toBe('app-a')
    sdk.current = null
    expect(await auth.resolveWebSessionToken()).toBeUndefined()
    expect(auth.webSessionIdentity()).toBeNull()
    expect(sessionStorage.getItem(key)).toBeNull()
  })
})
describe('sign-in failure reasons', () => {
  const reason = (promise: Promise<unknown>) =>
    promise.then(
      () => 'resolved',
      (error: unknown) =>
        error && typeof error === 'object' && 'reason' in error ? error.reason : 'untyped'
    )
  it('reports a code that could not be sent as temporary', async () => {
    const auth = await import('./web-session')
    sdk.request.mockResolvedValue({ error: new Error('mail unavailable') })
    expect(await reason(auth.requestWebOtp('member@example.test'))).toBe('unavailable')
  })
  it.each([
    ['an expired or wrong code', 403, 'code_invalid'],
    ['a rejected code', 400, 'code_invalid'],
    ['an Auth outage', 500, 'unavailable'],
    ['a network failure', undefined, 'unavailable'],
  ] as const)('classifies %s', async (_label, status, expected) => {
    const auth = await import('./web-session')
    sdk.verify.mockResolvedValue({
      data: { session: null },
      error: Object.assign(new Error('Auth refused'), status ? { status } : {}),
    })
    expect(await reason(auth.verifyWebOtp('member@example.test', '123456'))).toBe(
      expected
    )
    expect(sessionStorage.getItem(key)).toBeNull()
  })
  it.each([
    [401, 'denied'],
    [403, 'denied'],
    [404, 'denied'],
    [503, 'unavailable'],
  ] as const)(
    'classifies a verified code whose account check answers %i as %s',
    async (status, expected) => {
      useMswHandlers(
        http.get('*/api/v1/user/profile', () => HttpResponse.json({}, { status }))
      )
      const auth = await import('./web-session')
      expect(await reason(auth.verifyWebOtp('member@example.test', '123456'))).toBe(
        expected
      )
      expect(auth.webSessionIdentity()).toBeNull()
      expect(sessionStorage.getItem(key)).toBeNull()
    }
  )
})
