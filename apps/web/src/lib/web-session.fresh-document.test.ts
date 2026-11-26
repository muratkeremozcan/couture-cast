// Learning path Step 58: Image uploads straight to storage.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#image-uploads-straight-to-storage
//
// Pre-existing bug found by the real-session AS-0 (2026-11-19): a full document load of /wardrobe
// after a real sign-in showed "Your session expired". The fresh document's verification saw no
// principal, took the restored session for an account change and removed the bearer until the
// profile check answered, so a page that read the bearer at mount in that window found none.
// Each `vi.resetModules()` + import below is a fresh document of the same tab: sessionStorage
// (per tab) and localStorage (the Supabase session, shared by every tab) carry over.
import type { AuthChangeEvent, Session } from '@supabase/supabase-js'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useMswHandlers as installHandlers } from '../test-utils/msw/runtime'

// Only the external Supabase SDK is controlled; the session module, the generated API client,
// the contract parsers and browser storage run unchanged (source, not dist).
vi.mock('@couture/api-client', () => import('../../../../packages/api-client/src/index'))
vi.mock(
  '@couture/api-client/contracts/http',
  () => import('../../../../packages/api-client/src/contracts/http/index')
)

const sdk = vi.hoisted(() => ({
  session: null as Session | null,
  listener: undefined as
    | ((event: AuthChangeEvent, session: Session | null) => void)
    | undefined,
  getSession: vi.fn(),
  signOut: vi.fn(),
}))
vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    auth: {
      getSession: sdk.getSession,
      signOut: sdk.signOut,
      onAuthStateChange: (listener: typeof sdk.listener) => {
        sdk.listener = listener
        return { data: { subscription: { unsubscribe: vi.fn() } } }
      },
    },
  })),
}))

const bearerKey = 'couturecast.access-token'
const principalKey = 'couturecast.access-principal'
const authKey = 'couturecast.auth-session'
const profilePath = 'http://localhost/api/v1/user/profile'
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
      app_metadata: {},
      user_metadata: {},
      created_at: '2026-11-19T00:00:00Z',
    },
  }
}
function profile(id: string) {
  return {
    user: {
      id,
      email: `${id}@synthetic.test`,
      displayName: null,
      birthdate: null,
      role: 'guardian',
    },
    linkedGuardians: [],
    linkedTeens: [],
  }
}
function gate() {
  let release!: () => void
  const promise = new Promise<void>((resolve) => {
    release = resolve
  })
  return { promise, release }
}

/** What this tab held when it was last verified for `principal` (member `member`). */
function seedTab(principal: string, member: string, bearer: string) {
  sessionStorage.setItem(bearerKey, bearer)
  sessionStorage.setItem(principalKey, JSON.stringify({ principal, member }))
}
/** The Supabase session every tab of the browser shares, as the SDK stores it. */
function seedBrowserSession(value: Session | null) {
  sdk.session = value
  if (value) localStorage.setItem(authKey, JSON.stringify(value))
  else localStorage.removeItem(authKey)
}
function storedPrincipal(): unknown {
  const raw = sessionStorage.getItem(principalKey)
  return raw === null ? null : JSON.parse(raw)
}

type Publication = { identity: string | null; bearer: string | null; principal: unknown }
/** What a subscriber reading at once sees on every identity publication. */
function recordPublications(identity: () => string | null): Publication[] {
  const seen: Publication[] = []
  const listener = () =>
    seen.push({
      identity: identity(),
      bearer: sessionStorage.getItem(bearerKey),
      principal: storedPrincipal(),
    })
  window.addEventListener('couture:session', listener)
  cleanups.push(() => window.removeEventListener('couture:session', listener))
  return seen
}
function answerProfiles(
  answer: (bearer: string | null) => Promise<Response> | Response
): (string | null)[] {
  const bearers: (string | null)[] = []
  installHandlers(
    http.get(profilePath, ({ request }) => {
      const bearer = request.headers.get('authorization')
      bearers.push(bearer)
      return answer(bearer)
    })
  )
  return bearers
}

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  vi.stubEnv('NEXT_PUBLIC_E2E_AUTH', 'false')
  vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', 'http://localhost')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://identity.synthetic.test')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'synthetic-anon')
  sessionStorage.clear()
  localStorage.clear()
  sdk.session = null
  sdk.listener = undefined
  sdk.getSession.mockImplementation(() =>
    Promise.resolve({ data: { session: sdk.session }, error: null })
  )
  sdk.signOut.mockResolvedValue({ error: null })
})
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup())
  sessionStorage.clear()
  localStorage.clear()
  vi.unstubAllEnvs()
})

describe('Step 58 follow-up: a fresh document keeps the verified session of the same user', () => {
  it('keeps the stored bearer and identity through verification of the same restored user', async () => {
    seedTab('principal-a', 'member-a', 'bearer-a')
    seedBrowserSession(session('principal-a', 'bearer-a-refreshed'))
    const verified = gate()
    const bearers = answerProfiles(async () => {
      await verified.promise
      return HttpResponse.json(profile('member-a'))
    })

    const auth = await import('./web-session')
    const uploads = await import('./upload-attempts')
    // A page that mounts before the session bridge starts already finds the account.
    expect(auth.webSessionIdentity()).toBe('member-a')
    expect(uploads.currentUploadSession().account).toBe('member-a')
    const publications = recordPublications(auth.webSessionIdentity)

    const starting = auth.startWebSession().then((stop) => cleanups.push(stop))
    try {
      await vi.waitFor(() => expect(bearers).toHaveLength(1))
      // Mid-verification: the bearer a mount-time read needs is still stored.
      expect(sessionStorage.getItem(bearerKey)).toBe('bearer-a')
      expect(auth.webSessionIdentity()).toBe('member-a')
      expect(publications).toEqual([])
    } finally {
      verified.release()
    }
    await starting

    expect(bearers).toEqual(['Bearer bearer-a-refreshed'])
    expect(publications).toEqual([
      {
        identity: 'member-a',
        bearer: 'bearer-a-refreshed',
        principal: { principal: 'principal-a', member: 'member-a' },
      },
    ])
  })

  it("clears another tab's account before anything reads and stores B only after B's verification", async () => {
    // Tab 1 was verified for A; B then signed in from another tab, replacing the shared session.
    seedTab('principal-a', 'member-a', 'bearer-a')
    seedBrowserSession(session('principal-b', 'bearer-b'))
    const verified = gate()
    const bearers = answerProfiles(async () => {
      await verified.promise
      return HttpResponse.json(profile('member-b'))
    })

    const auth = await import('./web-session')
    // The reload of tab 1 holds nothing of A's from its first line on.
    expect(sessionStorage.getItem(bearerKey)).toBeNull()
    expect(storedPrincipal()).toBeNull()
    expect(auth.webSessionIdentity()).toBeNull()
    const publications = recordPublications(auth.webSessionIdentity)

    const starting = auth.startWebSession().then((stop) => cleanups.push(stop))
    try {
      await vi.waitFor(() => expect(bearers).toHaveLength(1))
      expect(sessionStorage.getItem(bearerKey)).toBeNull()
      expect(auth.webSessionIdentity()).toBeNull()
    } finally {
      verified.release()
    }
    await starting

    expect(bearers).toEqual(['Bearer bearer-b'])
    expect(publications).toEqual([
      { identity: null, bearer: null, principal: null },
      {
        identity: 'member-b',
        bearer: 'bearer-b',
        principal: { principal: 'principal-b', member: 'member-b' },
      },
    ])
  })

  it('clears a stored account whose browser session is gone before anything reads', async () => {
    seedTab('principal-a', 'member-a', 'bearer-a')
    seedBrowserSession(null)

    const auth = await import('./web-session')

    expect(sessionStorage.getItem(bearerKey)).toBeNull()
    expect(storedPrincipal()).toBeNull()
    expect(auth.webSessionIdentity()).toBeNull()
  })

  it.each([
    ['an unreadable principal record', 'not-json', session('principal-a', 'bearer-a')],
    [
      'a record with no member',
      JSON.stringify({ principal: 'principal-a' }),
      session('principal-a', 'bearer-a'),
    ],
    [
      'a browser session it cannot read',
      JSON.stringify({ principal: 'principal-a', member: 'member-a' }),
      'not-json',
    ],
  ])('clears %s before anything reads', async (_case, record, browserSession) => {
    sessionStorage.setItem(bearerKey, 'bearer-a')
    sessionStorage.setItem(principalKey, record)
    localStorage.setItem(
      authKey,
      typeof browserSession === 'string' ? browserSession : JSON.stringify(browserSession)
    )

    const auth = await import('./web-session')

    expect(sessionStorage.getItem(bearerKey)).toBeNull()
    expect(sessionStorage.getItem(principalKey)).toBeNull()
    expect(auth.webSessionIdentity()).toBeNull()
  })

  it('clears the bearer and identity when verification denies the restored session', async () => {
    seedTab('principal-a', 'member-a', 'bearer-a')
    seedBrowserSession(session('principal-a', 'bearer-a'))
    const verified = gate()
    answerProfiles(async () => {
      await verified.promise
      return HttpResponse.json({ message: 'Unauthorized' }, { status: 401 })
    })

    const auth = await import('./web-session')
    const publications = recordPublications(auth.webSessionIdentity)
    const starting = auth.startWebSession().then((stop) => cleanups.push(stop))
    await vi.waitFor(() => expect(sdk.getSession).toHaveBeenCalled())
    expect(auth.webSessionIdentity()).toBe('member-a')
    expect(sessionStorage.getItem(bearerKey)).toBe('bearer-a')
    verified.release()
    await starting

    expect(auth.webSessionIdentity()).toBeNull()
    // The bearer and principal are gone before the denial is announced.
    expect(publications).toEqual([{ identity: null, bearer: null, principal: null }])
  })

  it('removes the bearer and principal before announcing a sign-out, then reads nothing', async () => {
    seedTab('principal-a', 'member-a', 'bearer-a')
    seedBrowserSession(session('principal-a', 'bearer-a'))
    const bearers = answerProfiles(() => HttpResponse.json(profile('member-a')))
    const auth = await import('./web-session')
    cleanups.push(await auth.startWebSession())
    expect(storedPrincipal()).toEqual({ principal: 'principal-a', member: 'member-a' })
    const publications = recordPublications(auth.webSessionIdentity)

    await auth.signOutWebSession()

    expect(publications).toEqual([{ identity: null, bearer: null, principal: null }])
    expect(bearers).toEqual(['Bearer bearer-a'])

    // The next document of this tab restores nothing.
    vi.resetModules()
    const next = await import('./web-session')
    expect(next.webSessionIdentity()).toBeNull()
    expect(sessionStorage.getItem(bearerKey)).toBeNull()
  })

  // CC-7.9 real-session L-4 (webkit, 5f2043f2): after Sign out the page still showed the member.
  // Every path that could name a member again is held open across the sign-out here: the page's
  // session start (its getSession and its profile check), an SDK auth event delivered late, and
  // a page's own bearer read. None may store a bearer or name a member once the sign-out ran.
  it('7.9-L4-RACE-001 keeps a sign-out against every verification still in flight on the page', async () => {
    seedTab('principal-a', 'member-a', 'bearer-a')
    seedBrowserSession(session('principal-a', 'bearer-a'))
    const restored = gate()
    sdk.getSession.mockImplementation(async () => {
      await restored.promise
      return {
        data: { session: session('principal-a', 'bearer-a-refreshed') },
        error: null,
      }
    })
    const profileHeld = gate()
    answerProfiles(async () => {
      await profileHeld.promise
      return HttpResponse.json(profile('member-a'))
    })
    const auth = await import('./web-session')
    // Restored for the same user at module start, as the member landing painted it.
    expect(auth.webSessionIdentity()).toBe('member-a')
    const start = auth.startWebSession()
    const read = auth.resolveWebSessionToken().catch(() => undefined)

    await auth.signOutWebSession()
    expect(auth.webSessionIdentity()).toBeNull()

    // Everything held answers after the sign-out, the SDK's refresh event included.
    restored.release()
    sdk.listener?.('TOKEN_REFRESHED', session('principal-a', 'bearer-a-refreshed'))
    profileHeld.release()
    cleanups.push(await start)
    await read
    await new Promise((resolve) => setTimeout(resolve, 0))
    await vi.waitFor(() => expect(sdk.getSession).toHaveBeenCalled())
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(auth.webSessionIdentity()).toBeNull()
    expect(sessionStorage.getItem(bearerKey)).toBeNull()
    expect(storedPrincipal()).toBeNull()
    expect(await auth.resolveWebSessionToken()).toBeUndefined()
  })

  it('leaves the local E2E fixture bearer, which has no stored principal, untouched', async () => {
    vi.stubEnv('NEXT_PUBLIC_E2E_AUTH', 'true')
    sessionStorage.setItem(bearerKey, 'test-token-fixture')

    const auth = await import('./web-session')
    cleanups.push(await auth.startWebSession())

    expect(sessionStorage.getItem(bearerKey)).toBe('test-token-fixture')
    expect(auth.webSessionIdentity()).toBeNull()
    expect(sdk.getSession).not.toHaveBeenCalled()
  })
})
