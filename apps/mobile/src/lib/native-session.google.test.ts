// Learning path Step 57: Google sign-in.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-57-google-sign-in
// Story 6.17 TEA red spec: the native Google start and callback outcome.
// U-PKCE-CONFIG, U-START-PARAMS, U-SEAM-NATIVE, M-FAIL-*, M-CALLBACK-ONCE, TEA-3, TEA-11 and the
// in-flight flag `+native-intent` reads. The Supabase SDK, the auth session browser, Linking and
// SecureStore are doubled; the session module, generated client and contracts run unchanged.
// Plan: _bmad-output/test-artifacts/test-design/cc617-google-sign-in-test-design.md
import { http, HttpResponse, type JsonBodyType } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { server } from '../test-utils/msw/server'

const sdk = vi.hoisted(() => ({
  current: null as null | {
    access_token: string
    expires_at: number
    user: { id: string; email: string }
  },
  createOptions: [] as unknown[],
  signInWithOAuth: vi.fn(),
  exchangeCodeForSession: vi.fn(),
  verifyOtp: vi.fn(),
  signOut: vi.fn(),
  openAuthSessionAsync: vi.fn(),
  createURL: vi.fn(),
  secure: new Map<string, string>(),
  extra: {} as Record<string, unknown>,
}))

vi.mock('react-native', () => ({
  AppState: {
    currentState: 'active',
    addEventListener: () => ({ remove: vi.fn() }),
  },
}))
vi.mock('expo-constants', () => ({
  default: {
    get expoConfig() {
      return {
        extra: {
          supabaseUrl: 'http://127.0.0.1:54321',
          supabaseAnonKey: 'local-fixture-only',
          ...sdk.extra,
        },
      }
    },
  },
}))
vi.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 1,
  getItemAsync: vi.fn((key: string) => Promise.resolve(sdk.secure.get(key) ?? null)),
  setItemAsync: vi.fn((key: string, value: string) => {
    sdk.secure.set(key, value)
    return Promise.resolve()
  }),
  deleteItemAsync: vi.fn((key: string) => {
    sdk.secure.delete(key)
    return Promise.resolve()
  }),
}))
vi.mock('expo-linking', () => ({ createURL: sdk.createURL }))
vi.mock('expo-web-browser', () => ({
  openAuthSessionAsync: sdk.openAuthSessionAsync,
  maybeCompleteAuthSession: vi.fn(),
}))
vi.mock('@supabase/supabase-js', () => ({
  processLock: vi.fn(),
  createClient: (_url: string, _key: string, options: unknown) => {
    sdk.createOptions.push(options)
    return {
      auth: {
        getSession: () =>
          Promise.resolve({ data: { session: sdk.current }, error: null }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: vi.fn() } } }),
        startAutoRefresh: vi.fn().mockResolvedValue(undefined),
        stopAutoRefresh: vi.fn().mockResolvedValue(undefined),
        signInWithOAuth: sdk.signInWithOAuth,
        exchangeCodeForSession: sdk.exchangeCodeForSession,
        verifyOtp: sdk.verifyOtp,
        signOut: sdk.signOut,
      },
    }
  },
}))

const REDIRECT = 'couturecast://auth/callback'
const AUTHORIZE = 'http://127.0.0.1:54321/auth/v1/authorize?provider=google&flow=pkce'
const FINISH_MARKER = 'couturecast.federated-finish'

const profile = (id: string, role = 'guardian') => ({
  user: {
    id,
    email: `${id}@synthetic.test`,
    displayName: null,
    birthdate: null,
    role,
  },
  linkedGuardians: [],
  linkedTeens: [],
})

function answers(path: string, ...responses: (() => Response)[]) {
  const seen: string[] = []
  server.use(
    http.get(`*${path}`, ({ request }) => {
      seen.push(request.headers.get('authorization') ?? '')
      return responses[Math.min(seen.length - 1, responses.length - 1)]!()
    })
  )
  return seen
}
const json =
  (body: JsonBodyType, status = 200) =>
  () =>
    HttpResponse.json(body, { status })
const unauthorized = json({ message: 'Invalid access token' }, 401)

async function load() {
  return {
    session: await import('./native-session.js'),
    flight: await import('./native-oauth-flight.js'),
  }
}

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  process.env.EXPO_PUBLIC_API_BASE_URL = window.location.origin
  delete process.env.EXPO_PUBLIC_E2E_OAUTH_PROVIDER
  sdk.current = null
  sdk.createOptions = []
  sdk.secure.clear()
  sdk.extra = {}
  sdk.createURL.mockImplementation((path: string, options?: { queryParams?: object }) => {
    const query = new URLSearchParams(
      (options?.queryParams ?? {}) as Record<string, string>
    ).toString()
    return `couturecast://${path}${query ? `?${query}` : ''}`
  })
  sdk.signInWithOAuth.mockResolvedValue({
    data: { provider: 'google', url: AUTHORIZE },
    error: null,
  })
  sdk.exchangeCodeForSession.mockImplementation(() => {
    sdk.current = {
      access_token: 'signed-native-google',
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: { id: 'supabase-native-google', email: 'native@synthetic.test' },
    }
    return Promise.resolve({ data: { session: sdk.current }, error: null })
  })
  sdk.signOut.mockImplementation(() => {
    sdk.current = null
    return Promise.resolve({ error: null })
  })
  sdk.openAuthSessionAsync.mockResolvedValue({
    type: 'success',
    url: `${REDIRECT}?code=native-code`,
  })
})

afterEach(() => {
  delete process.env.EXPO_PUBLIC_E2E_OAUTH_PROVIDER
})

describe('U-PKCE-CONFIG and U-START-PARAMS (native)', () => {
  it('builds a PKCE client and asks for google with the chooser, skipping the SDK redirect', async () => {
    answers('/api/v1/user/profile', json(profile('app-native-member')))
    const { session } = await load()
    await expect(session.startNativeGoogleSignIn({})).resolves.toEqual({ kind: 'member' })
    expect(sdk.createOptions).toHaveLength(1)
    expect((sdk.createOptions[0] as { auth: object }).auth).toMatchObject({
      flowType: 'pkce',
      detectSessionInUrl: false,
    })
    // Privacy Policy: the session reaches SecureStore without Google tokens.
    const { storage } = (
      sdk.createOptions[0] as {
        auth: { storage: { setItem: (key: string, value: string) => Promise<void> } }
      }
    ).auth
    await storage.setItem(
      'couturecast.auth-session',
      JSON.stringify({ access_token: 'supabase-access', provider_token: 'google-access' })
    )
    const stored = [...sdk.secure.values()].join('')
    expect(stored).toContain('supabase-access')
    expect(stored).not.toContain('google-access')
    expect(sdk.signInWithOAuth.mock.calls).toEqual([
      [
        {
          provider: 'google',
          options: {
            redirectTo: REDIRECT,
            skipBrowserRedirect: true,
            queryParams: { prompt: 'select_account' },
          },
        },
      ],
    ])
    expect(sdk.openAuthSessionAsync.mock.calls).toEqual([[AUTHORIZE, REDIRECT]])
    expect(sdk.exchangeCodeForSession.mock.calls).toEqual([['native-code']])
  })

  it('carries from=preview only for the literal', async () => {
    answers('/api/v1/user/profile', json(profile('app-native-member')))
    const { session } = await load()
    await session.startNativeGoogleSignIn({ from: 'preview' })
    await session.startNativeGoogleSignIn({ from: 'preview2' })
    const redirects = sdk.signInWithOAuth.mock.calls.map(
      ([args]) => (args as { options: { redirectTo: string } }).options.redirectTo
    )
    expect(redirects).toEqual([`${REDIRECT}?from=preview`, REDIRECT])
    // The browser session always watches the bare callback URL.
    const returnUrls = sdk.openAuthSessionAsync.mock.calls.map(
      ([, returnUrl]) => returnUrl as string
    )
    expect(returnUrls).toEqual([REDIRECT, REDIRECT])
  })

  // Android's Custom Tabs polyfill reports success only for a URL that starts with the return
  // URL; Auth puts `code` first, so a return URL carrying `?from=preview` read as a dismissal.
  // The door (Antigravity P1-1) rides the same query, so the return URL stays bare for it too.
  it('completes a signup-door preview conversion whose callback carries extra query after the return URL', async () => {
    answers('/api/v1/user/profile', unauthorized)
    answers('/api/v1/auth/signup/federated', json({ status: 'needs_birthdate' }))
    sdk.openAuthSessionAsync.mockImplementation((_url: string, returnUrl: string) => {
      const callback = `${REDIRECT}?code=preview-code&from=preview&door=signup`
      return Promise.resolve(
        callback.startsWith(returnUrl)
          ? { type: 'success', url: callback }
          : { type: 'dismiss' }
      )
    })
    const { session } = await load()
    await expect(
      session.startNativeGoogleSignIn({ from: 'preview', door: 'signup' })
    ).resolves.toEqual({ kind: 'no_account' })
    const { redirectTo } = (
      sdk.signInWithOAuth.mock.calls[0]![0] as { options: { redirectTo: string } }
    ).options
    expect(redirectTo).toBe(`${REDIRECT}?from=preview&door=signup`)
    expect(sdk.openAuthSessionAsync.mock.calls[0]![1]).toBe(REDIRECT)
    expect(sdk.exchangeCodeForSession.mock.calls).toEqual([['preview-code']])
    expect(JSON.parse(sdk.secure.get(FINISH_MARKER) ?? 'null')).toEqual({
      from: 'preview',
      door: 'signup',
    })
    await expect(session.federatedFinishResumeHref()).resolves.toBe(
      '/signup-finish?door=signup&from=preview'
    )
  })

  it('leaves the sign-in door out of the redirect', async () => {
    answers('/api/v1/user/profile', json(profile('app-native-member')))
    const { session } = await load()
    await session.startNativeGoogleSignIn({ door: 'signin' })
    const { redirectTo } = (
      sdk.signInWithOAuth.mock.calls[0]![0] as { options: { redirectTo: string } }
    ).options
    expect(redirectTo).toBe(REDIRECT)
  })

  it('holds the in-flight flag only while the browser session is open', async () => {
    answers('/api/v1/user/profile', json(profile('app-native-member')))
    const { session, flight } = await load()
    const seenDuringBrowser: boolean[] = []
    sdk.openAuthSessionAsync.mockImplementation(() => {
      seenDuringBrowser.push(Boolean(flight.isNativeOAuthInFlight()))
      return Promise.resolve({ type: 'success', url: `${REDIRECT}?code=flag-code` })
    })
    expect(flight.isNativeOAuthInFlight()).toBe(false)
    await session.startNativeGoogleSignIn({})
    expect(seenDuringBrowser).toEqual([true])
    expect(flight.isNativeOAuthInFlight()).toBe(false)
  })

  it('clears the in-flight flag when the browser session throws', async () => {
    sdk.openAuthSessionAsync.mockRejectedValue(new Error('no browser'))
    const { session, flight } = await load()
    await expect(session.startNativeGoogleSignIn({})).resolves.toEqual({
      kind: 'unavailable',
    })
    expect(flight.isNativeOAuthInFlight()).toBe(false)
  })
})

describe('U-SEAM-NATIVE (D10): the Keycloak stand-in only in an isolated debug build', () => {
  it('uses keycloak when requested in an isolated build', async () => {
    process.env.EXPO_PUBLIC_E2E_OAUTH_PROVIDER = 'keycloak'
    sdk.extra = { isolatedNativeBuild: true }
    answers('/api/v1/user/profile', json(profile('app-native-member')))
    const { session } = await load()
    await session.startNativeGoogleSignIn({})
    expect((sdk.signInWithOAuth.mock.calls[0]![0] as { provider: string }).provider).toBe(
      'keycloak'
    )
  })

  it.each([
    ['outside an isolated build', 'keycloak', {}],
    ['for any other provider name', 'github', { isolatedNativeBuild: true }],
    ['when the flag is not literally true', 'keycloak', { isolatedNativeBuild: 'true' }],
  ])(
    'refuses the stand-in %s and never starts a sign-in',
    async (_label, provider, extra) => {
      process.env.EXPO_PUBLIC_E2E_OAUTH_PROVIDER = provider
      sdk.extra = extra
      const { session } = await load()
      await expect(session.startNativeGoogleSignIn({})).resolves.toEqual({
        kind: 'unavailable',
      })
      expect(sdk.signInWithOAuth).not.toHaveBeenCalled()
    }
  )
})

describe('M-FAIL and outcomes', () => {
  it.each(['cancel', 'dismiss'])(
    'M-FAIL-CANCEL: a %s result is cancelled',
    async (type) => {
      sdk.openAuthSessionAsync.mockResolvedValue({ type })
      const { session } = await load()
      await expect(session.startNativeGoogleSignIn({})).resolves.toEqual({
        kind: 'cancelled',
      })
      expect(sdk.exchangeCodeForSession).not.toHaveBeenCalled()
    }
  )

  it('M-FAIL-OUTAGE: an SDK start error is unavailable and opens no browser', async () => {
    sdk.signInWithOAuth.mockResolvedValue({
      data: { provider: 'google', url: null },
      error: { status: 500, message: 'provider disabled' },
    })
    const { session } = await load()
    await expect(session.startNativeGoogleSignIn({})).resolves.toEqual({
      kind: 'unavailable',
    })
    expect(sdk.openAuthSessionAsync).not.toHaveBeenCalled()
  })

  it('M-FAIL-UNVERIFIED (TEA-11): the unverified-address refusal is refused, not cancelled', async () => {
    const { session } = await load()
    await expect(
      session.completeNativeOAuth(
        `${REDIRECT}?error=access_denied&error_code=provider_email_needs_verification`
      )
    ).resolves.toEqual({ kind: 'refused' })
    await expect(
      session.completeNativeOAuth(`${REDIRECT}?error=access_denied`)
    ).resolves.toEqual({ kind: 'cancelled' })
    expect(sdk.exchangeCodeForSession).not.toHaveBeenCalled()
  })

  it('no_account: sets the finish marker with no address and keeps the session', async () => {
    answers('/api/v1/user/profile', unauthorized)
    const federated = answers(
      '/api/v1/auth/signup/federated',
      json({ status: 'needs_birthdate' })
    )
    const { session } = await load()
    await expect(
      session.completeNativeOAuth(`${REDIRECT}?code=new-native&from=preview`)
    ).resolves.toEqual({ kind: 'no_account' })
    expect(federated).toEqual(['Bearer signed-native-google'])
    expect(sdk.signOut).not.toHaveBeenCalled()
    const marker = sdk.secure.get(FINISH_MARKER)
    expect(marker).toBeDefined()
    expect(marker).not.toContain('@')
    expect(marker).not.toContain('signed-native-google')
  })

  it('L-NO-LOOP (TEA-3): complete then a second 401 refuses after two profile checks', async () => {
    const seen = answers('/api/v1/user/profile', unauthorized)
    answers('/api/v1/auth/signup/federated', json({ status: 'complete' }))
    const { session } = await load()
    await expect(session.completeNativeOAuth(`${REDIRECT}?code=loop`)).resolves.toEqual({
      kind: 'refused',
    })
    expect(seen).toHaveLength(2)
    expect(sdk.signOut).toHaveBeenCalledTimes(1)
  })

  it('M-FAIL-SLOW-API: a failing profile check keeps the session and never says no_account', async () => {
    answers('/api/v1/user/profile', json({ message: 'unavailable' }, 503))
    const federated = answers(
      '/api/v1/auth/signup/federated',
      json({ status: 'needs_birthdate' })
    )
    const { session } = await load()
    await expect(session.completeNativeOAuth(`${REDIRECT}?code=slow`)).resolves.toEqual({
      kind: 'unavailable',
    })
    expect(federated).toEqual([])
    expect(sdk.signOut).not.toHaveBeenCalled()
    expect(sdk.secure.has(FINISH_MARKER)).toBe(false)
  })

  it('M-CALLBACK-ONCE: in-process result and a router delivery of one code exchange once', async () => {
    answers('/api/v1/user/profile', json(profile('app-native-once')))
    const { session } = await load()
    const [first, second] = await Promise.all([
      session.completeNativeOAuth(`${REDIRECT}?code=same-code`),
      session.completeNativeOAuth(`${REDIRECT}?code=same-code`),
    ])
    expect(first).toEqual({ kind: 'member' })
    expect(second).toEqual({ kind: 'member' })
    expect(sdk.exchangeCodeForSession.mock.calls).toEqual([['same-code']])
  })
})

// Story 6.17 TEA sign-off additions: L-SWITCH-MEMBER-TO-GOOGLE (S-16), the D3 finish marker on
// start, cancel and refusal, and U-CALLBACK-HASH (TEA-12). Each was a seeded defect no test caught.
// Module state can outlive `vi.resetModules` in browser mode, so every case first reaches its
// starting state through the public API, with its own code.
async function waitingIdentity(
  session: Awaited<ReturnType<typeof load>>['session'],
  code: string,
  ...federated: (() => Response)[]
) {
  const checks = answers('/api/v1/user/profile', unauthorized)
  answers(
    '/api/v1/auth/signup/federated',
    json({ status: 'needs_birthdate' }),
    ...federated
  )
  await expect(
    session.completeNativeOAuth(`${REDIRECT}?code=${code}&from=preview`)
  ).resolves.toEqual({ kind: 'no_account' })
  expect(sdk.secure.has(FINISH_MARKER)).toBe(true)
  return checks
}

describe('sign-off additions: switch, finish marker and callback fragment', () => {
  it('L-SWITCH-MEMBER-TO-GOOGLE (S-16): member E is signed out before the authorize request', async () => {
    answers('/api/v1/user/profile', json(profile('app-member-e')))
    const { session } = await load()
    await expect(
      session.completeNativeOAuth(`${REDIRECT}?code=member-e`)
    ).resolves.toEqual({ kind: 'member' })
    expect(session.nativeSessionIdentity()).toBe('app-member-e')
    const order: string[] = []
    const identityAtAuthorize: (string | null)[] = []
    sdk.signOut.mockImplementation(() => {
      order.push('signOut')
      sdk.current = null
      return Promise.resolve({ error: null })
    })
    sdk.signInWithOAuth.mockImplementation(() => {
      order.push('authorize')
      identityAtAuthorize.push(session.nativeSessionIdentity())
      return Promise.resolve({
        data: { provider: 'google', url: AUTHORIZE },
        error: null,
      })
    })
    sdk.openAuthSessionAsync.mockResolvedValue({ type: 'cancel' })
    await expect(session.startNativeGoogleSignIn({})).resolves.toEqual({
      kind: 'cancelled',
    })
    expect(order).toEqual(['signOut', 'authorize'])
    expect(identityAtAuthorize).toEqual([null])
  })

  it('L-SWITCH-MEMBER-TO-GOOGLE: a waiting identity is signed out before the next authorize request', async () => {
    const { session } = await load()
    await waitingIdentity(session, 'waiting-switch')
    const order: string[] = []
    sdk.signOut.mockImplementation(() => {
      order.push('signOut')
      sdk.current = null
      return Promise.resolve({ error: null })
    })
    sdk.signInWithOAuth.mockImplementation(() => {
      order.push('authorize')
      return Promise.resolve({
        data: { provider: 'google', url: AUTHORIZE },
        error: null,
      })
    })
    sdk.openAuthSessionAsync.mockResolvedValue({ type: 'dismiss' })
    await session.startNativeGoogleSignIn({})
    expect(order).toEqual(['signOut', 'authorize'])
  })

  it('D3: a new start clears the finish marker an earlier attempt left', async () => {
    const { session } = await load()
    await waitingIdentity(session, 'waiting-restart')
    sdk.openAuthSessionAsync.mockResolvedValue({ type: 'cancel' })
    await session.startNativeGoogleSignIn({})
    expect(sdk.secure.has(FINISH_MARKER)).toBe(false)
  })

  it.each([
    ['answers', 204, 'waiting-cancel-ok'],
    ['fails', 503, 'waiting-cancel-503'],
  ])(
    'D3 Cancel: the DELETE %s, and the marker is cleared and the identity signed out',
    async (_label, status, code) => {
      const { session } = await load()
      await waitingIdentity(session, code)
      const deletes: (string | null)[] = []
      server.use(
        http.delete('*/api/v1/auth/signup/federated', ({ request }) => {
          deletes.push(request.headers.get('authorization'))
          return status === 204
            ? new HttpResponse(null, { status })
            : HttpResponse.json({ message: 'unavailable' }, { status })
        })
      )
      await session.cancelNativeFederatedSignup()
      expect(deletes).toEqual(['Bearer signed-native-google'])
      expect(sdk.secure.has(FINISH_MARKER)).toBe(false)
      expect(sdk.signOut).toHaveBeenCalledTimes(1)
      await expect(session.federatedFinishResumeHref()).resolves.toBeNull()
    }
  )

  it('D3 refusal: a 401 on the finish POST refuses, clears the marker and signs out', async () => {
    const { session } = await load()
    await waitingIdentity(session, 'waiting-refused-401')
    server.use(
      http.post('*/api/v1/auth/signup/federated', () =>
        HttpResponse.json({ message: 'Invalid access token' }, { status: 401 })
      )
    )
    await expect(session.finishNativeFederatedSignup('1990-01-01')).resolves.toEqual({
      kind: 'refused',
    })
    expect(sdk.secure.has(FINISH_MARKER)).toBe(false)
    expect(sdk.signOut).toHaveBeenCalledTimes(1)
  })

  it('D3 refusal (TEA-3): a 409 whose re-verification is denied refuses, clears the marker and signs out', async () => {
    const { session } = await load()
    const checks = await waitingIdentity(
      session,
      'waiting-refused-409',
      json({ status: 'complete' })
    )
    server.use(
      http.post('*/api/v1/auth/signup/federated', () =>
        HttpResponse.json({ message: 'Account already exists' }, { status: 409 })
      )
    )
    await expect(session.finishNativeFederatedSignup('1990-01-01')).resolves.toEqual({
      kind: 'refused',
    })
    // One check for the callback, then the 409 path's check and its one re-verification.
    expect(checks).toHaveLength(3)
    expect(sdk.secure.has(FINISH_MARKER)).toBe(false)
    expect(sdk.signOut).toHaveBeenCalledTimes(1)
  })

  it('U-CALLBACK-HASH (TEA-12): error fields only in the fragment map as they do in the query', async () => {
    const { session } = await load()
    await expect(
      session.completeNativeOAuth(
        `${REDIRECT}#error=access_denied&error_code=provider_email_needs_verification`
      )
    ).resolves.toEqual({ kind: 'refused' })
    await expect(
      session.completeNativeOAuth(`${REDIRECT}?from=preview#error=access_denied`)
    ).resolves.toEqual({ kind: 'cancelled' })
    expect(sdk.exchangeCodeForSession).not.toHaveBeenCalled()
  })
})

// Antigravity P1-2: as on web, the server's status decides whether a launch resumes the finish
// step; the marker carries only the preview hint and the door.
describe('resume decided by the server status', () => {
  it('M-FAIL-SLOW-API then relaunch: an identity stored without the marker resumes', async () => {
    answers('/api/v1/user/profile', json({ message: 'unavailable' }, 503))
    answers('/api/v1/auth/signup/federated', json({ status: 'needs_birthdate' }))
    const { session } = await load()
    await expect(
      session.completeNativeOAuth(`${REDIRECT}?code=slow-resume`)
    ).resolves.toEqual({ kind: 'unavailable' })
    expect(sdk.secure.has(FINISH_MARKER)).toBe(false)
    await expect(session.federatedFinishResumeHref()).resolves.toBe('/signup-finish')
  })

  it('a complete status never resumes and clears a stale marker', async () => {
    const { session } = await load()
    await waitingIdentity(session, 'stale-marker', json({ status: 'complete' }))
    await expect(session.federatedFinishResumeHref()).resolves.toBeNull()
    expect(sdk.secure.has(FINISH_MARKER)).toBe(false)
  })

  it('no stored identity never resumes and asks the server nothing', async () => {
    const status = answers(
      '/api/v1/auth/signup/federated',
      json({ status: 'needs_birthdate' })
    )
    const { session } = await load()
    await expect(session.federatedFinishResumeHref()).resolves.toBeNull()
    expect(status).toEqual([])
  })

  it('an email code verified over a waiting Google identity clears its marker', async () => {
    const { session } = await load()
    await waitingIdentity(session, 'waiting-then-otp')
    sdk.verifyOtp.mockImplementation(() => {
      sdk.current = {
        access_token: 'signed-native-otp',
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        user: { id: 'supabase-native-otp', email: 'otp@synthetic.test' },
      }
      return Promise.resolve({ data: { session: sdk.current }, error: null })
    })
    answers('/api/v1/user/profile', json(profile('app-native-otp')))
    await session.verifyNativeOtp('otp@synthetic.test', '123456')
    expect(sdk.secure.has(FINISH_MARKER)).toBe(false)
  })
})

describe('a teen waiting on a guardian', () => {
  const pending = (status: number) =>
    answers(
      '/api/v1/user/profile',
      status === 200
        ? json(profile('teen-pending-1', 'teen'))
        : json({ message: 'Guardian consent required' }, status)
    )
  const awaiting = () =>
    answers(
      '/api/v1/auth/signup/federated',
      json({ status: 'awaiting_guardian', accountId: 'teen-pending-1' })
    )

  it('reports unavailable when the verified teen guardian status cannot be read', async () => {
    pending(200)
    const status = answers(
      '/api/v1/auth/signup/federated',
      json({ message: 'Unavailable' }, 503)
    )
    const { session } = await load()

    await expect(
      session.completeNativeOAuth(`${REDIRECT}?code=teen-status-unavailable`)
    ).resolves.toEqual({ kind: 'unavailable' })

    expect(status).toEqual(['Bearer signed-native-google'])
    expect(sdk.signOut).not.toHaveBeenCalled()
  })

  it('recovers a duplicate Google signup into the pending guardian step for the same account', async () => {
    const { session } = await load()
    await waitingIdentity(session, 'pending-guardian-conflict')
    pending(200)
    awaiting()
    server.use(
      http.post(
        '*/api/v1/auth/signup/federated',
        json({ message: 'Account already exists' }, 409)
      )
    )

    await expect(session.finishNativeFederatedSignup('1990-01-01')).resolves.toEqual({
      kind: 'awaiting_guardian',
      accountId: 'teen-pending-1',
    })
    expect(sdk.signOut).not.toHaveBeenCalled()
  })

  it.each([403, 200])(
    'Google keeps the session and guardian step when the profile responds %i',
    async (statusCode) => {
      pending(statusCode)
      const status = awaiting()
      const { session } = await load()
      await expect(
        session.completeNativeOAuth(`${REDIRECT}?code=pending-teen-${statusCode}`)
      ).resolves.toEqual({ kind: 'awaiting_guardian' })
      expect(status).toHaveLength(1)
      expect(sdk.signOut).not.toHaveBeenCalled()
      expect(sdk.secure.has(FINISH_MARKER)).toBe(false)
      await expect(
        session.fetchNativeAwaitingGuardianAccount('signed-native-google')
      ).resolves.toBe('teen-pending-1')
    }
  )

  it.each([
    [403, 200, 'awaiting_guardian'],
    [200, 200, 'awaiting_guardian'],
    [200, 503, 'unavailable'],
  ] as const)(
    'email code handles guardian verification with profile %i and status %i',
    async (profileStatus, guardianStatus, reason) => {
      sdk.verifyOtp.mockImplementation(() => {
        sdk.current = {
          access_token: 'signed-native-otp-teen',
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          user: { id: 'supabase-native-otp-teen', email: 'teen@synthetic.test' },
        }
        return Promise.resolve({ data: { session: sdk.current }, error: null })
      })
      pending(profileStatus)
      if (guardianStatus === 200) awaiting()
      else answers('/api/v1/auth/signup/federated', json({ message: 'Unavailable' }, 503))
      const { session } = await load()
      await expect(
        session.verifyNativeOtp('teen@synthetic.test', '123456')
      ).rejects.toMatchObject({ reason })
    }
  )
})
