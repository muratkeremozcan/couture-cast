import type { AuthChangeEvent, Session } from '@supabase/supabase-js'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useMswHandlers as installHandlers } from '../test-utils/msw/runtime'

// Only the external Supabase SDK is controlled. Session, generated API client,
// contract parsers, browser storage and the community HTTP wrapper execute unchanged.
// Package exports point at dist. Load actual source in this focused suite so
// concurrent source repairs are exercised without rebuilding shared dependencies.
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
  unsubscribe: vi.fn(),
  getSession: vi.fn(),
  signInWithOtp: vi.fn(),
  verifyOtp: vi.fn(),
  signOut: vi.fn(),
}))
vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    auth: {
      getSession: sdk.getSession,
      signInWithOtp: sdk.signInWithOtp,
      verifyOtp: sdk.verifyOtp,
      signOut: sdk.signOut,
      onAuthStateChange: (listener: typeof sdk.listener) => {
        sdk.listener = listener
        return { data: { subscription: { unsubscribe: sdk.unsubscribe } } }
      },
    },
  })),
}))

const bearerKey = 'couturecast.access-token'
const apiBase = 'http://localhost'
const profilePath = `${apiBase}/api/v1/user/profile`
const eventsPath = `${apiBase}/api/v1/community/events`
const cleanups: (() => void)[] = []
function session(principal: string, token: string): Session {
  return {
    access_token: token,
    refresh_token: 'synthetic-refresh',
    token_type: 'bearer',
    expires_in: 3600,
    user: {
      id: principal,
      aud: 'authenticated',
      app_metadata: {},
      user_metadata: {},
      created_at: '2026-10-20T00:00:00Z',
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
async function modules() {
  return { auth: await import('./web-session'), community: await import('./community') }
}
function recordEvents() {
  const seen: (string | null)[] = []
  installHandlers(
    http.get(eventsPath, ({ request }) => {
      seen.push(request.headers.get('authorization'))
      return HttpResponse.json({
        data: {
          events: [],
          nextCursor: 'verified-cursor',
          hasMore: false,
          resyncRequired: false,
        },
      })
    })
  )
  return seen
}
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
  sdk.listener = undefined
  sdk.getSession.mockImplementation(() =>
    Promise.resolve({ data: { session: sdk.session }, error: null })
  )
  sdk.signInWithOtp.mockResolvedValue({ error: null })
  sdk.verifyOtp.mockImplementation(() =>
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

describe('Story 6.5 R16 V1: session publication across real authenticated HTTP', () => {
  it('restores the SDK session, verifies profile bearer, then publishes canonical app identity and community bearer', async () => {
    sdk.session = session('supabase-principal-a', 'signed-session-a')
    const response = gate()
    const headers: (string | null)[] = []
    installHandlers(
      http.get(profilePath, async ({ request }) => {
        headers.push(request.headers.get('authorization'))
        await response.promise
        return HttpResponse.json(profile('app-member-a'))
      })
    )
    const events = recordEvents()
    const { auth, community } = await modules()
    const restoring = auth.startWebSession().then((cleanup) => {
      cleanups.push(cleanup)
    })
    try {
      await vi.waitFor(() => expect(headers).toHaveLength(1))
      expect(headers).toEqual(['Bearer signed-session-a'])
      expect(auth.webSessionIdentity()).toBeNull()
      expect(sessionStorage.getItem(bearerKey)).toBeNull()
    } finally {
      response.release()
    }
    await restoring
    expect(auth.webSessionIdentity()).toBe('app-member-a')
    expect(auth.webSessionIdentity()).not.toBe(sdk.session.user.id)
    expect(community.communityCommentsSessionFromWeb()).toBe('app-member-a')
    await community.communitySyncFromWeb().events('all')
    expect(events).toEqual(['Bearer signed-session-a'])
  })

  it('T07 C01 concurrent cold suppliers join canonical verification before publishing a bearer', async () => {
    sdk.session = session('cold-principal', 'cold-session-token')
    const first = gate(),
      second = gate(),
      rest = gate()
    let profileCalls = 0
    installHandlers(
      http.get(profilePath, async ({ request }) => {
        const number = ++profileCalls
        expect(request.headers.has('authorization')).toBe(true)
        await (number === 1
          ? first.promise
          : number === 2
            ? second.promise
            : rest.promise)
        return HttpResponse.json(profile('cold-canonical-member'))
      })
    )
    const events = recordEvents()
    const { auth, community } = await modules()
    const observed: boolean[] = []
    const calls = [
      auth.resolveWebSessionToken(),
      community.communityRealtimeTokenFromWeb(),
    ]
    const settled = Promise.allSettled(calls)
    for (const call of calls)
      void call.then(
        (value) => observed.push(value === undefined),
        () => undefined
      )
    try {
      await vi.waitFor(() => expect(profileCalls).toBeGreaterThan(0))
      expect(auth.webSessionIdentity()).toBeNull()
      expect(sessionStorage.getItem(bearerKey)).toBeNull()
      first.release()
      // The repaired single flight settles both callers. The old implementation
      // starts a third profile verification after the first response is superseded.
      await vi.waitFor(() => expect(observed.length > 0 || profileCalls >= 3).toBe(true))
      second.release()
      await vi.waitFor(() => expect(observed.length).toBeGreaterThan(0))
      expect(observed.some(Boolean)).toBe(false)
      rest.release()
      const results = await settled
      // Boolean assertions keep all bearer values out of failure output.
      expect(
        results.map(
          (result) =>
            result.status === 'fulfilled' && result.value === sdk.session?.access_token
        )
      ).toEqual([true, true])
      expect(profileCalls).toBe(1)
      expect(auth.webSessionIdentity()).toBe('cold-canonical-member')
      await community.communitySyncFromWeb().events('all')
      expect(
        events.map((value) => value === `Bearer ${sdk.session?.access_token}`)
      ).toEqual([true])
    } finally {
      first.release()
      second.release()
      rest.release()
      await settled
    }
  })

  it('verifies an OTP using the SDK and publishes its bearer through the existing community wrapper', async () => {
    const profiles: (string | null)[] = []
    installHandlers(
      http.get(profilePath, ({ request }) => {
        profiles.push(request.headers.get('authorization'))
        return HttpResponse.json(profile('otp-app-member'))
      })
    )
    const events = recordEvents()
    const { auth, community } = await modules()
    cleanups.push(await auth.startWebSession())
    await auth.requestWebOtp('member@synthetic.test')
    expect(sdk.signInWithOtp).toHaveBeenCalledWith({
      email: 'member@synthetic.test',
      options: { shouldCreateUser: true },
    })
    sdk.session = session('otp-supabase-sub', 'otp-signed-session')
    await auth.verifyWebOtp('member@synthetic.test', '123456')
    expect(sdk.verifyOtp).toHaveBeenCalledWith({
      email: 'member@synthetic.test',
      token: '123456',
      type: 'email',
    })
    expect(profiles).toEqual(['Bearer otp-signed-session'])
    expect(auth.webSessionIdentity()).toBe('otp-app-member')
    await community.communitySyncFromWeb().events('all')
    expect(events).toEqual(['Bearer otp-signed-session'])
  })

  it('removes the old bearer during an SDK account switch and publishes only the verified new owner', async () => {
    sdk.session = session('principal-a', 'bearer-a')
    const response = gate()
    const profiles: (string | null)[] = []
    installHandlers(
      http.get(profilePath, async ({ request }) => {
        const header = request.headers.get('authorization')
        profiles.push(header)
        if (header === 'Bearer bearer-b') await response.promise
        return HttpResponse.json(
          profile(header === 'Bearer bearer-a' ? 'app-a' : 'app-b')
        )
      })
    )
    const events = recordEvents()
    const { auth, community } = await modules()
    cleanups.push(await auth.startWebSession())
    await community.communitySyncFromWeb().events('all')
    sdk.session = session('principal-b', 'bearer-b')
    sdk.listener!('SIGNED_IN', sdk.session)
    try {
      await vi.waitFor(() => expect(profiles).toHaveLength(2))
      expect(sessionStorage.getItem(bearerKey)).toBeNull()
      expect(auth.webSessionIdentity()).toBeNull()
      await expect(community.communitySyncFromWeb().events('all')).rejects.toThrow(
        'Sign in'
      )
      expect(events).toEqual(['Bearer bearer-a'])
    } finally {
      response.release()
    }
    await vi.waitFor(() => expect(auth.webSessionIdentity()).toBe('app-b'))
    await community.communitySyncFromWeb().events('all')
    expect(profiles).toEqual(['Bearer bearer-a', 'Bearer bearer-b'])
    expect(events).toEqual(['Bearer bearer-a', 'Bearer bearer-b'])
  })

  it('refreshes a same-owner SDK token and sends the fresh bearer while keeping canonical identity', async () => {
    sdk.session = session('principal-a', 'initial-token')
    const profiles: (string | null)[] = []
    installHandlers(
      http.get(profilePath, ({ request }) => {
        profiles.push(request.headers.get('authorization'))
        return HttpResponse.json(profile('canonical-a'))
      })
    )
    const events = recordEvents()
    const { auth, community } = await modules()
    cleanups.push(await auth.startWebSession())
    sdk.session = session('principal-a', 'refreshed-token')
    expect(await community.communityRealtimeTokenFromWeb()).toBe('refreshed-token')
    expect(auth.webSessionIdentity()).toBe('canonical-a')
    await community.communitySyncFromWeb().events('all')
    expect(profiles).toEqual(['Bearer initial-token', 'Bearer refreshed-token'])
    expect(events).toEqual(['Bearer refreshed-token'])
  })

  it('keeps sign-out final when an earlier profile response completes late', async () => {
    sdk.session = session('principal-a', 'late-token')
    const response = gate()
    const requested = vi.fn()
    installHandlers(
      http.get(profilePath, async ({ request }) => {
        requested(request.headers.get('authorization'))
        await response.promise
        return HttpResponse.json(profile('late-app-member'))
      })
    )
    const events = recordEvents()
    const { auth, community } = await modules()
    const restoring = auth.startWebSession().then((cleanup) => {
      cleanups.push(cleanup)
    })
    try {
      await vi.waitFor(() => expect(requested).toHaveBeenCalledWith('Bearer late-token'))
      await auth.signOutWebSession()
    } finally {
      response.release()
    }
    await restoring
    expect(auth.webSessionIdentity()).toBeNull()
    expect(sessionStorage.getItem(bearerKey)).toBeNull()
    expect(await community.communityRealtimeTokenFromWeb()).toBeUndefined()
    await expect(community.communitySyncFromWeb().events('all')).rejects.toThrow(
      'Sign in'
    )
    expect(events).toEqual([])
    expect(sdk.signOut).toHaveBeenCalledWith({ scope: 'local' })
  })

  it('retains recovery installation after profile denial while blocking bearer publication until actual cleanup', async () => {
    sdk.session = session('unapproved-principal', 'unapproved-token')
    const headers: (string | null)[] = []
    installHandlers(
      http.get(profilePath, ({ request }) => {
        headers.push(request.headers.get('authorization'))
        return HttpResponse.json({ message: 'Profile unavailable' }, { status: 403 })
      })
    )
    const events = recordEvents()
    const { auth, community } = await modules()
    const cleanup = await auth.startWebSession()
    try {
      expect(headers).toEqual(['Bearer unapproved-token'])
      expect(auth.webSessionIdentity()).toBeNull()
      expect(sessionStorage.getItem(bearerKey)).toBeNull()
      expect(sdk.listener).toBeTypeOf('function')
      expect(sdk.unsubscribe).not.toHaveBeenCalled()

      await expect(auth.resolveWebSessionToken()).rejects.toHaveProperty(
        'response.status',
        403
      )
      await expect(community.communityRealtimeTokenFromWeb()).rejects.toHaveProperty(
        'response.status',
        403
      )
      expect(headers).toEqual([
        'Bearer unapproved-token',
        'Bearer unapproved-token',
        'Bearer unapproved-token',
      ])
      expect(auth.webSessionIdentity()).toBeNull()
      expect(sessionStorage.getItem(bearerKey)).toBeNull()
      await expect(community.communitySyncFromWeb().events('all')).rejects.toThrow(
        'Sign in'
      )
      expect(events).toEqual([])
      expect(sdk.unsubscribe).not.toHaveBeenCalled()
    } finally {
      cleanup()
    }
    expect(sdk.unsubscribe).toHaveBeenCalledOnce()
  })
})
