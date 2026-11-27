// Learning path Step 57: Google sign-in.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-57-google-sign-in
// Story 6.17 TEA red spec: the web Google start and callback outcome over real HTTP doubles.
// U-PKCE-CONFIG, U-START-PARAMS, U-CALLBACK-ROUTES, W-FAIL-*, L-NO-LOOP (TEA-3),
// L-SWITCH-MEMBER-TO-GOOGLE, TEA-11, the once-per-code exchange, the finish marker on
// sign-out, cancel ordering and L-SIGNOUT-THEN-GOOGLE (the code verifier after a failed callback).
// Plan: _bmad-output/test-artifacts/test-design/cc617-google-sign-in-test-design.md
import type { Session } from '@supabase/supabase-js'
import { http, HttpResponse, type JsonBodyType } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useMswHandlers as installHandlers } from '../test-utils/msw/runtime'

// Only the external Supabase SDK is controlled; the session module, generated API client,
// contracts and browser storage run unchanged (the web-session.auth-boundary pattern).
vi.mock('@couture/api-client', () => import('../../../../packages/api-client/src/index'))
vi.mock(
  '@couture/api-client/contracts/http',
  () => import('../../../../packages/api-client/src/contracts/http/index')
)

const sdk = vi.hoisted(() => ({
  session: null as Session | null,
  createClient: vi.fn(),
  getSession: vi.fn(),
  signInWithOAuth: vi.fn(),
  exchangeCodeForSession: vi.fn(),
  signOut: vi.fn(),
  unsubscribe: vi.fn(),
}))
vi.mock('@supabase/supabase-js', () => ({
  createClient: sdk.createClient,
}))

const apiBase = 'http://localhost'
const profilePath = `${apiBase}/api/v1/user/profile`
const federatedPath = `${apiBase}/api/v1/auth/signup/federated`
const FINISH_MARKER = 'couturecast.federated-finish'
const cleanups: (() => void)[] = []

function session(principal: string, token: string): Session {
  return {
    access_token: token,
    refresh_token: 'synthetic-refresh',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: {
      id: principal,
      aud: 'authenticated',
      email: `${principal}@synthetic.test`,
      app_metadata: { provider: 'google' },
      user_metadata: { name: 'Synthetic Google Name' },
      created_at: '2026-11-15T00:00:00Z',
    },
  }
}

function profile(id: string, role = 'guardian') {
  return {
    user: {
      id,
      email: `${id}@synthetic.test`,
      displayName: null,
      birthdate: null,
      role,
    },
    linkedGuardians: [],
    linkedTeens: [],
  }
}

async function load() {
  return import('./web-session')
}

/** Profile answers in order; the last answer repeats. Counts every request. */
function profileAnswers(...answers: (() => Response)[]) {
  const seen: string[] = []
  installHandlers(
    http.get(profilePath, ({ request }) => {
      seen.push(request.headers.get('authorization') ?? '')
      const answer = answers[Math.min(seen.length - 1, answers.length - 1)]!
      return answer()
    })
  )
  return seen
}

function federatedAnswer(answer: () => Response) {
  const seen: string[] = []
  installHandlers(
    http.get(federatedPath, ({ request }) => {
      seen.push(request.headers.get('authorization') ?? '')
      return answer()
    })
  )
  return seen
}

const json =
  (body: JsonBodyType, status = 200) =>
  () =>
    HttpResponse.json(body, { status })
const unauthorized = json({ message: 'Invalid access token' }, 401)

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  vi.stubEnv('NEXT_PUBLIC_E2E_AUTH', 'false')
  vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', apiBase)
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://identity.synthetic.test')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'synthetic-anon')
  sessionStorage.clear()
  localStorage.clear()
  sdk.session = null
  sdk.createClient.mockImplementation(() => ({
    auth: {
      getSession: sdk.getSession,
      signInWithOAuth: sdk.signInWithOAuth,
      exchangeCodeForSession: sdk.exchangeCodeForSession,
      signOut: sdk.signOut,
      onAuthStateChange: () => ({
        data: { subscription: { unsubscribe: sdk.unsubscribe } },
      }),
    },
  }))
  sdk.getSession.mockImplementation(() =>
    Promise.resolve({ data: { session: sdk.session }, error: null })
  )
  sdk.signInWithOAuth.mockResolvedValue({
    data: { provider: 'google', url: null },
    error: null,
  })
  sdk.exchangeCodeForSession.mockImplementation(() => {
    sdk.session = session('supabase-google-user', 'signed-google-session')
    return Promise.resolve({
      data: { session: sdk.session, user: sdk.session.user },
      error: null,
    })
  })
  sdk.signOut.mockImplementation(() => {
    sdk.session = null
    return Promise.resolve({ error: null })
  })
})

afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup())
  sessionStorage.clear()
  localStorage.clear()
  vi.unstubAllEnvs()
})

describe('U-PKCE-CONFIG: the web client runs the PKCE flow and consumes no URL itself', () => {
  it('creates the Supabase client with flowType pkce and detectSessionInUrl false', async () => {
    const { startWebGoogleSignIn } = await load()
    await startWebGoogleSignIn({})
    expect(sdk.createClient).toHaveBeenCalledTimes(1)
    const options = sdk.createClient.mock.calls[0]![2] as {
      auth: Record<string, unknown>
    }
    expect(options.auth).toMatchObject({
      flowType: 'pkce',
      detectSessionInUrl: false,
      storageKey: 'couturecast.auth-session',
      persistSession: true,
    })
  })

  // Privacy Policy: the stored session carries no Google token.
  it('stores the session in localStorage without Google tokens', async () => {
    const { startWebGoogleSignIn } = await load()
    await startWebGoogleSignIn({})
    const { storage } = (
      sdk.createClient.mock.calls[0]![2] as {
        auth: { storage: { setItem: (key: string, value: string) => unknown } }
      }
    ).auth
    await storage.setItem(
      'couturecast.auth-session',
      JSON.stringify({
        access_token: 'supabase-access',
        provider_token: 'google-access',
        provider_refresh_token: 'google-refresh',
      })
    )
    const stored = localStorage.getItem('couturecast.auth-session') ?? ''
    expect(JSON.parse(stored)).toEqual({ access_token: 'supabase-access' })
  })
})

describe('U-START-PARAMS: one Google start, exactly these options', () => {
  it('asks for google with the account chooser and the plain callback', async () => {
    const { startWebGoogleSignIn } = await load()
    await startWebGoogleSignIn({})
    expect(sdk.signInWithOAuth.mock.calls).toEqual([
      [
        {
          provider: 'google',
          options: {
            redirectTo: `${window.location.origin}/auth/callback`,
            queryParams: { prompt: 'select_account' },
          },
        },
      ],
    ])
  })

  it('carries from=preview only for the literal', async () => {
    const { startWebGoogleSignIn } = await load()
    await startWebGoogleSignIn({ from: 'preview' })
    expect(sdk.signInWithOAuth.mock.calls[0]![0]).toEqual({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback?from=preview`,
        queryParams: { prompt: 'select_account' },
      },
    })
  })

  it.each([null, 'Preview', 'preview2', 'https://evil.test', '%70review', ' preview'])(
    'drops from=%s',
    async (from) => {
      const { startWebGoogleSignIn } = await load()
      await startWebGoogleSignIn({ from })
      expect(sdk.signInWithOAuth.mock.calls[0]![0]).toEqual({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
          queryParams: { prompt: 'select_account' },
        },
      })
    }
  )

  it('rejects with the unavailable reason when the SDK refuses to start', async () => {
    sdk.signInWithOAuth.mockResolvedValue({
      data: { provider: 'google', url: null },
      error: { status: 500, message: 'provider disabled' },
    })
    const { startWebGoogleSignIn, WebSignInError } = await load()
    const started = startWebGoogleSignIn({})
    await expect(started).rejects.toBeInstanceOf(WebSignInError)
    await expect(started).rejects.toMatchObject({ reason: 'unavailable' })
  })
})

describe('L-SWITCH-MEMBER-TO-GOOGLE: a verified member is signed out before the start', () => {
  it('signs the member out first, so no member identity survives into the Google flow', async () => {
    sdk.session = session('supabase-member-e', 'signed-member-e')
    profileAnswers(json(profile('app-member-e')))
    const auth = await load()
    cleanups.push(await auth.startWebSession())
    expect(auth.webSessionIdentity()).toBe('app-member-e')

    await auth.startWebGoogleSignIn({})

    expect(sdk.signOut).toHaveBeenCalledTimes(1)
    expect(sdk.signOut.mock.invocationCallOrder[0]!).toBeLessThan(
      sdk.signInWithOAuth.mock.invocationCallOrder[0]!
    )
    expect(auth.webSessionIdentity()).toBeNull()
  })
})

describe('completeWebOAuth: one outcome per callback, never a throw', () => {
  const params = (query: string) => new URLSearchParams(query)

  it('member: exchanges the code once, verifies the profile and answers member', async () => {
    const seen = profileAnswers(json(profile('app-member-google')))
    const federated = federatedAnswer(json({ status: 'complete' }))
    const auth = await load()
    await expect(auth.completeWebOAuth(params('code=one-time-code'))).resolves.toEqual({
      kind: 'member',
    })
    expect(sdk.exchangeCodeForSession.mock.calls).toEqual([['one-time-code']])
    expect(seen).toEqual(['Bearer signed-google-session'])
    expect(federated).toEqual([])
    expect(auth.webSessionIdentity()).toBe('app-member-google')
    expect(sessionStorage.getItem(FINISH_MARKER)).toBeNull()
  })

  it('no_account: a 401 profile check and needs_birthdate set the finish marker', async () => {
    profileAnswers(unauthorized)
    const federated = federatedAnswer(json({ status: 'needs_birthdate' }))
    const auth = await load()
    await expect(
      auth.completeWebOAuth(params('code=new-person&from=preview'))
    ).resolves.toEqual({
      kind: 'no_account',
    })
    expect(federated).toEqual(['Bearer signed-google-session'])
    expect(sdk.signOut).not.toHaveBeenCalled()
    const marker = sessionStorage.getItem(FINISH_MARKER)
    expect(marker).not.toBeNull()
    expect(marker).not.toContain('@')
    expect(marker).not.toContain('signed-google-session')
    expect(auth.webSessionIdentity()).toBeNull()
  })

  it('refused: a 401 from the federated check signs out locally', async () => {
    profileAnswers(unauthorized)
    federatedAnswer(unauthorized)
    const auth = await load()
    await expect(auth.completeWebOAuth(params('code=ambiguous'))).resolves.toEqual({
      kind: 'refused',
    })
    expect(sdk.signOut).toHaveBeenCalledTimes(1)
    expect(sessionStorage.getItem(FINISH_MARKER)).toBeNull()
  })

  it('L-NO-LOOP (TEA-3): complete then a second 401 refuses after exactly two profile checks', async () => {
    const seen = profileAnswers(unauthorized)
    const federated = federatedAnswer(json({ status: 'complete' }))
    const auth = await load()
    await expect(auth.completeWebOAuth(params('code=looping'))).resolves.toEqual({
      kind: 'refused',
    })
    expect(seen).toHaveLength(2)
    expect(federated).toHaveLength(1)
    expect(sdk.signOut).toHaveBeenCalledTimes(1)
  })

  it.each([403, 200])(
    'awaiting_guardian preserves the identity when the profile responds %i',
    async (status) => {
      const seen = profileAnswers(
        status === 200
          ? json(profile('teen-pending-1', 'teen'))
          : json({ message: 'Guardian consent required' }, status)
      )
      const federated = federatedAnswer(
        json({ status: 'awaiting_guardian', accountId: 'teen-pending-1' })
      )
      const auth = await load()
      await expect(auth.completeWebOAuth(params('code=pending-teen'))).resolves.toEqual({
        kind: 'awaiting_guardian',
      })
      expect(seen).toHaveLength(1)
      expect(federated).toHaveLength(1)
      expect(sdk.signOut).not.toHaveBeenCalled()
      expect(sessionStorage.getItem(FINISH_MARKER)).toBeNull()
      await expect(auth.fetchWebAwaitingGuardianAccount('signed-google')).resolves.toBe(
        'teen-pending-1'
      )
    }
  )

  it('complete then a 200 re-verify answers member', async () => {
    const seen = profileAnswers(unauthorized, json(profile('app-member-raced')))
    federatedAnswer(json({ status: 'complete' }))
    const auth = await load()
    await expect(auth.completeWebOAuth(params('code=raced'))).resolves.toEqual({
      kind: 'member',
    })
    expect(seen).toHaveLength(2)
    expect(auth.webSessionIdentity()).toBe('app-member-raced')
  })

  it('W-FAIL-CANCEL: error=access_denied is cancelled and nothing is exchanged', async () => {
    const auth = await load()
    await expect(
      auth.completeWebOAuth(
        params('error=access_denied&error_description=The+user+cancelled&state=s')
      )
    ).resolves.toEqual({ kind: 'cancelled' })
    expect(sdk.exchangeCodeForSession).not.toHaveBeenCalled()
  })

  it('W-FAIL-UNVERIFIED (TEA-11): GoTrue unverified-address refusal is refused, not cancelled', async () => {
    const auth = await load()
    await expect(
      auth.completeWebOAuth(
        params(
          'error=access_denied&error_code=provider_email_needs_verification&error_description=Unverified+email'
        )
      )
    ).resolves.toEqual({ kind: 'refused' })
    expect(sdk.exchangeCodeForSession).not.toHaveBeenCalled()
  })

  it.each([
    ['a provider error', 'error=server_error&error_description=boom'],
    ['a temporarily unavailable provider', 'error=temporarily_unavailable'],
    ['no code at all', 'from=preview'],
  ])('W-FAIL-OUTAGE: %s is unavailable', async (_label, query) => {
    const auth = await load()
    await expect(auth.completeWebOAuth(params(query))).resolves.toEqual({
      kind: 'unavailable',
    })
    expect(sdk.exchangeCodeForSession).not.toHaveBeenCalled()
  })

  it('W-FAIL-REPLAY: a refused exchange is unavailable and changes no session', async () => {
    sdk.exchangeCodeForSession.mockResolvedValue({
      data: { session: null, user: null },
      error: { status: 400, message: 'invalid flow state' },
    })
    const auth = await load()
    await expect(auth.completeWebOAuth(params('code=used-code'))).resolves.toEqual({
      kind: 'unavailable',
    })
    expect(sdk.signOut).not.toHaveBeenCalled()
    expect(auth.webSessionIdentity()).toBeNull()
  })

  it('never throws when the SDK exchange throws', async () => {
    sdk.exchangeCodeForSession.mockRejectedValue(new TypeError('network down'))
    const auth = await load()
    await expect(auth.completeWebOAuth(params('code=network'))).resolves.toEqual({
      kind: 'unavailable',
    })
  })

  it('W-FAIL-SLOW-API: a failing profile check keeps the session and never says no_account', async () => {
    profileAnswers(json({ message: 'unavailable' }, 503))
    const federated = federatedAnswer(json({ status: 'needs_birthdate' }))
    const auth = await load()
    await expect(auth.completeWebOAuth(params('code=slow-api'))).resolves.toEqual({
      kind: 'unavailable',
    })
    expect(federated).toEqual([])
    expect(sdk.signOut).not.toHaveBeenCalled()
    expect(sessionStorage.getItem(FINISH_MARKER)).toBeNull()
  })

  it('exchanges a code once even when two callbacks race (StrictMode double effect)', async () => {
    profileAnswers(json(profile('app-member-strict')))
    const auth = await load()
    const [first, second] = await Promise.all([
      auth.completeWebOAuth(params('code=strict-mode')),
      auth.completeWebOAuth(params('code=strict-mode')),
    ])
    expect(first).toEqual({ kind: 'member' })
    expect(second).toEqual({ kind: 'member' })
    expect(sdk.exchangeCodeForSession.mock.calls).toEqual([['strict-mode']])
  })
})

describe('sign-out, switch and cancel leave nothing of the Google attempt behind', () => {
  const AUTH_STORAGE_KEY = 'couturecast.auth-session'
  const CODE_VERIFIER_KEY = 'couturecast.auth-session-code-verifier'

  it('signOutWebSession clears couturecast.federated-finish', async () => {
    sessionStorage.setItem(FINISH_MARKER, JSON.stringify({ from: 'preview' }))
    const auth = await load()
    await auth.signOutWebSession()
    expect(sessionStorage.getItem(FINISH_MARKER)).toBeNull()
  })

  it('L-SWITCH: a stored session with no verified member is signed out before the Google start', async () => {
    sdk.session = session('supabase-waiting-identity', 'signed-waiting-identity')
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ synthetic: true }))
    const auth = await load()
    expect(auth.webSessionIdentity()).toBeNull()

    await auth.startWebGoogleSignIn({})

    expect(sdk.signOut).toHaveBeenCalledTimes(1)
    expect(sdk.signOut.mock.invocationCallOrder[0]!).toBeLessThan(
      sdk.signInWithOAuth.mock.invocationCallOrder[0]!
    )
  })

  it('cancelWebFederatedSignup sends DELETE with the bearer before signing out', async () => {
    sdk.session = session('supabase-waiting-identity', 'signed-waiting-identity')
    sessionStorage.setItem(FINISH_MARKER, JSON.stringify({ from: null }))
    const order: string[] = []
    const deletes: string[] = []
    installHandlers(
      http.delete(federatedPath, ({ request }) => {
        order.push('delete')
        deletes.push(request.headers.get('authorization') ?? '')
        return new HttpResponse(null, { status: 204 })
      })
    )
    sdk.signOut.mockImplementation(() => {
      order.push('signOut')
      sdk.session = null
      return Promise.resolve({ error: null })
    })
    const auth = await load()

    await auth.cancelWebFederatedSignup()

    expect(deletes).toEqual(['Bearer signed-waiting-identity'])
    expect(order).toEqual(['delete', 'signOut'])
    expect(sessionStorage.getItem(FINISH_MARKER)).toBeNull()
  })

  // L-SIGNOUT-THEN-GOOGLE (review finding 6): a round trip that ends without a session leaves
  // no PKCE verifier from its start behind.
  it.each([
    ['a cancelled chooser', 'error=access_denied&error_description=closed'],
    ['a provider error', 'error=server_error&error_description=boom'],
    [
      'an unverified address (TEA-11)',
      'error=access_denied&error_code=provider_email_needs_verification',
    ],
  ])('removes the PKCE code verifier after %s', async (_label, query) => {
    localStorage.setItem(CODE_VERIFIER_KEY, 'synthetic-code-verifier')
    const auth = await load()
    await auth.completeWebOAuth(new URLSearchParams(query))
    expect(localStorage.getItem(CODE_VERIFIER_KEY)).toBeNull()
  })
})
