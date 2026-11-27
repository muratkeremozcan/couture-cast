// Learning path Step 68: Five-tab navigation and back pattern.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-68-five-tab-navigation-and-back-pattern
// Learning path Step 77: Account style profile.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-77-account-style-profile
// Story CC-7.11 test owner (TEA): 7.11-UNIT-030..034, the return-to-tab resync in
// startWebSession (b78ecca9). WebKit can deliver another tab's storage event late or drop it, so
// focus, pageshow and visibilitychange to visible compare the stored auth session's user with
// the one in memory and settle a difference through auth.getSession() and accept().
// Only the external Supabase SDK is controlled; web-session, browser storage and the profile
// HTTP call (MSW) run unchanged. The mocked SDK does not write storage, so each test writes the
// shared couturecast.auth-session entry the way the real SDK would. The return-to-tab cases
// leave its storage event undelivered.
import type { Session } from '@supabase/supabase-js'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useMswHandlers } from '../test-utils/msw/runtime'

const sdk = vi.hoisted(() => ({
  current: null as Session | null,
  getSession: vi.fn(),
  unsubscribe: vi.fn(),
}))
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: {
      getSession: sdk.getSession,
      signInWithOtp: vi.fn(),
      verifyOtp: vi.fn(),
      signOut: vi.fn(),
      onAuthStateChange: () => ({
        data: { subscription: { unsubscribe: sdk.unsubscribe } },
      }),
    },
  }),
}))

const bearerKey = 'couturecast.access-token'
const authKey = 'couturecast.auth-session'
const cleanups: (() => void)[] = []
const members: Record<string, string> = {
  'token-a': 'app-a',
  'token-a-refreshed': 'app-a',
  'token-b': 'app-b',
}
const session = (id: string, token: string): Session => ({
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
const profile = (id: string) => ({
  user: {
    id,
    email: `${id}@example.test`,
    displayName: null,
    birthdate: null,
    role: 'guardian',
  },
  linkedGuardians: [],
  linkedTeens: [],
})
/** Another tab (or this one) holding `value` as the shared stored auth session. */
function storeAuthSession(value: Session | null) {
  sdk.current = value
  if (value) localStorage.setItem(authKey, JSON.stringify(value))
  else localStorage.removeItem(authKey)
}
function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: state })
}
const returns = {
  visibilitychange: () => {
    setVisibility('visible')
    document.dispatchEvent(new Event('visibilitychange'))
  },
  focus: () => window.dispatchEvent(new Event('focus')),
  pageshow: () => window.dispatchEvent(new Event('pageshow')),
}
const styleScopeEvents = {
  ...returns,
  storage: () =>
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: authKey,
        newValue: localStorage.getItem(authKey),
        storageArea: localStorage,
      })
    ),
}
const settle = async () => {
  for (let turn = 0; turn < 3; turn++)
    await new Promise((resolve) => setTimeout(resolve, 0))
}
let profileReads: string[]
let sessionEvents: number
const countSessionEvent = () => {
  sessionEvents++
}
/** Member auth-a is verified as app-a in this tab; returns the module and its stop. */
async function liveMember() {
  storeAuthSession(session('auth-a', 'token-a'))
  const auth = await import('./web-session')
  const stop = await auth.startWebSession()
  cleanups.push(stop)
  expect(auth.webSessionIdentity()).toBe('app-a')
  expect(sdk.getSession).toHaveBeenCalledOnce()
  sessionEvents = 0
  return { auth, stop }
}

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  sessionStorage.clear()
  localStorage.clear()
  sdk.current = null
  sdk.getSession.mockImplementation(() =>
    Promise.resolve({ data: { session: sdk.current }, error: null })
  )
  vi.stubEnv('NEXT_PUBLIC_E2E_AUTH', 'false')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://auth.synthetic.test')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'synthetic-anon')
  profileReads = []
  sessionEvents = 0
  window.addEventListener('couture:session', countSessionEvent)
  useMswHandlers(
    http.get('*/api/v1/user/profile', ({ request }) => {
      const token = request.headers.get('authorization')?.replace('Bearer ', '') ?? ''
      profileReads.push(token)
      const member = members[token]
      return member
        ? HttpResponse.json(profile(member))
        : HttpResponse.json({}, { status: 401 })
    })
  )
})

describe('CC-7.20 style scope across tabs', () => {
  it.each(Object.keys(styleScopeEvents) as (keyof typeof styleScopeEvents)[])(
    '[7.20-ACCOUNT] %s clears the previous style scope before a changed principal is verified',
    async (trigger) => {
      await liveMember()
      const { currentWebStyleScope, captureWebStyleBearer, subscribeWebStyleScope } =
        await import('./use-web-session')
      const first = currentWebStyleScope()
      expect(first).toEqual(expect.any(String))
      expect(captureWebStyleBearer(first!)).toBe('token-a')
      const subscriber = vi.fn(currentWebStyleScope)
      cleanups.push(subscribeWebStyleScope(subscriber))

      let finishVerification!: () => void
      const pendingVerification = new Promise<{
        data: { session: Session | null }
        error: null
      }>((resolve) => {
        finishVerification = () =>
          resolve({ data: { session: sdk.current }, error: null })
      })
      sdk.getSession.mockReturnValue(pendingVerification)
      storeAuthSession(session('auth-b', 'token-b'))
      try {
        styleScopeEvents[trigger]()
        expect(subscriber).toHaveReturnedWith(null)
        expect(currentWebStyleScope()).toBeNull()
        expect(captureWebStyleBearer(first!)).toBeNull()
        expect(profileReads).toEqual(['token-a'])
        if (trigger === 'storage') returns.focus()
      } finally {
        finishVerification()
      }

      await vi.waitFor(() => {
        const next = currentWebStyleScope()
        expect(next).toEqual(expect.any(String))
        expect(next).not.toBe(first)
        expect(captureWebStyleBearer(next!)).toBe('token-b')
      })
      expect(profileReads).toEqual(['token-a', 'token-b'])
    }
  )

  it('[7.20-ACCOUNT] keeps the style scope across a verified same-principal token refresh', async () => {
    const { auth } = await liveMember()
    const { currentWebStyleScope, captureWebStyleBearer } = await import(
      './use-web-session'
    )
    const scope = currentWebStyleScope()
    expect(scope).toEqual(expect.any(String))
    storeAuthSession(session('auth-a', 'token-a-refreshed'))
    styleScopeEvents.storage()
    expect(currentWebStyleScope()).toBe(scope)
    expect(captureWebStyleBearer(scope!)).toBe('token-a')

    await expect(auth.resolveWebSessionToken()).resolves.toBe('token-a-refreshed')
    expect(currentWebStyleScope()).toBe(scope)
    expect(captureWebStyleBearer(scope!)).toBe('token-a-refreshed')
    expect(profileReads).toEqual(['token-a', 'token-a-refreshed'])
  })
})
afterEach(() => {
  cleanups.splice(0).forEach((stop) => stop())
  window.removeEventListener('couture:session', countSessionEvent)
  Reflect.deleteProperty(document, 'visibilityState')
  sessionStorage.clear()
  localStorage.clear()
  vi.unstubAllEnvs()
})

describe('7.11-UNIT-030..034 startWebSession resync on return to the tab', () => {
  it.each(Object.keys(returns) as (keyof typeof returns)[])(
    '7.11-UNIT-030 follows another tab sign-out on %s when its storage event was lost',
    async (trigger) => {
      const { auth } = await liveMember()
      storeAuthSession(null)
      expect(auth.webSessionIdentity()).toBe('app-a')

      returns[trigger]()

      await vi.waitFor(() => expect(auth.webSessionIdentity()).toBeNull())
      expect(sdk.getSession).toHaveBeenCalledTimes(2)
      expect(sessionEvents).toBeGreaterThan(0)
      expect(sessionStorage.getItem(bearerKey)).toBeNull()
      expect(profileReads).toEqual(['token-a'])
    }
  )

  it('7.11-UNIT-031 asks nothing on return while the stored session is unchanged', async () => {
    const { auth } = await liveMember()

    for (let round = 0; round < 2; round++)
      Object.values(returns).forEach((fire) => fire())
    await settle()

    expect(sdk.getSession).toHaveBeenCalledOnce()
    expect(profileReads).toEqual(['token-a'])
    expect(sessionEvents).toBe(0)
    expect(auth.webSessionIdentity()).toBe('app-a')
    expect(sessionStorage.getItem(bearerKey)).toBe('token-a')
  })

  it('7.11-UNIT-032 ignores visibilitychange to hidden, then settles on visible', async () => {
    const { auth } = await liveMember()
    storeAuthSession(null)

    setVisibility('hidden')
    document.dispatchEvent(new Event('visibilitychange'))
    await settle()

    expect(sdk.getSession).toHaveBeenCalledOnce()
    expect(sessionEvents).toBe(0)
    expect(auth.webSessionIdentity()).toBe('app-a')

    // Control: the same stored change is picked up once the page is visible again.
    returns.visibilitychange()
    await vi.waitFor(() => expect(auth.webSessionIdentity()).toBeNull())
    expect(sdk.getSession).toHaveBeenCalledTimes(2)
  })

  it('7.11-UNIT-033 removes every return listener on stop', async () => {
    const { auth, stop } = await liveMember()
    stop()
    storeAuthSession(null)

    Object.values(returns).forEach((fire) => fire())
    await settle()

    expect(sdk.getSession).toHaveBeenCalledOnce()
    expect(sessionEvents).toBe(0)
    expect(auth.webSessionIdentity()).toBe('app-a')
  })

  it('7.11-UNIT-034 accepts another tab sign-in as a different member on return', async () => {
    const { auth } = await liveMember()
    storeAuthSession(session('auth-b', 'token-b'))

    returns.focus()

    await vi.waitFor(() => expect(auth.webSessionIdentity()).toBe('app-b'))
    expect(sdk.getSession).toHaveBeenCalledTimes(2)
    expect(profileReads).toEqual(['token-a', 'token-b'])
    expect(sessionStorage.getItem(bearerKey)).toBe('token-b')
    expect(sessionEvents).toBeGreaterThan(0)

    // Settled: the next return finds the stored and in-memory users equal and asks nothing.
    returns.pageshow()
    await settle()
    expect(sdk.getSession).toHaveBeenCalledTimes(2)
  })
})
