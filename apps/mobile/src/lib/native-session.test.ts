// Story 6.5: native SDK/storage boundaries are controlled; canonical HTTP profile remains real.
import { http, HttpResponse } from 'msw'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { server } from '../test-utils/msw/server'
import { mobileApplicationUserId, resolveMobileAccessToken } from './mobile-auth'
const sdk = vi.hoisted(() => ({
  current: null as {
    expires_at?: number
    access_token: string
    user: { id: string }
  } | null,
  error: null as Error | null,
  unsubscribe: vi.fn(),
  callback: undefined as ((event: string, session: unknown) => void) | undefined,
  deleted: [] as string[],
  lifecycle: undefined as ((state: string) => void) | undefined,
  removeLifecycle: vi.fn(),
  startRefresh: vi.fn().mockResolvedValue(undefined),
  stopRefresh: vi.fn().mockResolvedValue(undefined),
  installFailure: false,
  signIn: vi
    .fn<() => Promise<{ error: Error | null }>>()
    .mockResolvedValue({ error: null }),
  signOut: vi.fn().mockResolvedValue(undefined),
  storage: undefined as
    | undefined
    | {
        getItem: (key: string) => Promise<string | null>
        setItem: (key: string, value: string) => Promise<void>
        removeItem: (key: string) => Promise<void>
      },
}))
vi.mock('react-native', () => ({
  AppState: {
    currentState: 'active',
    addEventListener: (_event: string, callback: (state: string) => void) => {
      if (sdk.installFailure) throw new Error('lifecycle installation failed')
      sdk.lifecycle = callback
      return { remove: sdk.removeLifecycle }
    },
  },
}))
vi.mock('expo-constants', () => ({
  default: {
    expoConfig: {
      extra: {
        supabaseUrl: 'http://127.0.0.1:54321',
        supabaseAnonKey: 'local-fixture-only',
      },
    },
  },
}))
vi.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 1,
  getItemAsync: vi.fn().mockResolvedValue(null),
  setItemAsync: vi.fn().mockResolvedValue(undefined),
  deleteItemAsync: vi.fn((key: string) => {
    sdk.deleted.push(key)
    return Promise.resolve()
  }),
}))
vi.mock('@supabase/supabase-js', () => ({
  processLock: vi.fn(),
  createClient: (
    _url: string,
    _key: string,
    options: { auth: { storage: typeof sdk.storage } }
  ) => {
    sdk.storage = options.auth.storage
    return {
      auth: {
        getSession: () =>
          Promise.resolve({ data: { session: sdk.current }, error: sdk.error }),
        verifyOtp: () =>
          Promise.resolve({ data: { session: sdk.current }, error: sdk.error }),
        signOut: sdk.signOut,
        signInWithOtp: sdk.signIn,
        startAutoRefresh: sdk.startRefresh,
        stopAutoRefresh: sdk.stopRefresh,
        onAuthStateChange: (callback: typeof sdk.callback) => {
          sdk.callback = callback
          return { data: { subscription: { unsubscribe: sdk.unsubscribe } } }
        },
      },
    }
  },
}))
import {
  beforeNativeLogout,
  subscribeNativeSession,
  nativeSupabase,
  requestNativeOtp,
  nativeSessionIdentity,
  resolveNativeSessionToken,
  signOutNativeSession,
  startNativeSession,
  verifyNativeOtp,
} from './native-session'
const profile = (id: string) => ({
  user: {
    id,
    email: 'session@synthetic.test',
    displayName: null,
    birthdate: '1990-01-01T00:00:00.000Z',
    role: 'teen',
  },
  linkedGuardians: [],
  linkedTeens: [],
})
let status = 200
let owner = 'canonical-member-a'
let cleanup: (() => void) | undefined
beforeEach(async () => {
  process.env.EXPO_PUBLIC_API_BASE_URL = window.location.origin
  await signOutNativeSession()
  sdk.installFailure = false
  sdk.error = null
  sdk.deleted.length = 0
  status = 200
  owner = 'canonical-member-a'
  sdk.current = {
    access_token: 'local-session-a',
    user: { id: 'distinct-auth-principal-a' },
  }
  server.use(
    http.get('*/api/v1/user/profile', () => HttpResponse.json(profile(owner), { status }))
  )
})
afterEach(async () => {
  cleanup?.()
  cleanup = undefined
  await signOutNativeSession()
})
describe('native verified session ownership', () => {
  it('C01 concurrent cold suppliers join canonical verification without reporting signed out', async () => {
    await verifyNativeOtp('session@synthetic.test', 'fixture-code')
    sdk.current = null
    await resolveNativeSessionToken()
    sdk.current = {
      access_token: 'cold-race-fixture',
      user: { id: 'cold-race-principal' },
    }
    status = 503
    cleanup = await startNativeSession()
    expect(nativeSessionIdentity()).toBeNull()
    let releaseFirst!: () => void
    let releaseSecond!: () => void
    let releaseRest!: () => void
    const first = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const second = new Promise<void>((resolve) => {
      releaseSecond = resolve
    })
    const rest = new Promise<void>((resolve) => {
      releaseRest = resolve
    })
    let calls = 0
    server.use(
      http.get('*/api/v1/user/profile', async () => {
        const number = ++calls
        await (number === 1 ? first : number === 2 ? second : rest)
        return HttpResponse.json(profile(owner))
      })
    )
    const observed: (string | undefined)[] = []
    const suppliers = [resolveMobileAccessToken(), resolveNativeSessionToken()]
    for (const supplier of suppliers)
      void supplier.then(
        (value) => observed.push(value),
        () => undefined
      )
    try {
      await vi.waitFor(() => expect(calls).toBeGreaterThan(0))
      releaseFirst()
      // Permit either the coalesced completion or the old extra verification to
      // progress before releasing the second independently held HTTP response.
      await new Promise((resolve) => setTimeout(resolve, 50))
      releaseSecond()
      await vi.waitFor(() => expect(observed.length).toBeGreaterThan(0))
      expect(observed.some((value) => value === undefined)).toBe(false)
      releaseRest()
      const results = await Promise.allSettled(suppliers)
      expect(
        results.every(
          (result) =>
            result.status === 'fulfilled' && result.value === sdk.current?.access_token
        )
      ).toBe(true)
      expect(calls).toBe(1)
      expect(nativeSessionIdentity()).toBe('canonical-member-a')
    } finally {
      releaseFirst()
      releaseSecond()
      releaseRest()
      await Promise.allSettled(suppliers)
    }
  })
  it.each([503, 403])(
    'C01 shared verification settles HTTP%s and permits a fresh retry',
    async (failure) => {
      await verifyNativeOtp('session@synthetic.test', 'fixture-code')
      sdk.current = null
      await resolveNativeSessionToken()
      sdk.current = {
        access_token: 'settlement-fixture',
        user: { id: 'settlement-principal' },
      }
      let release!: () => void
      const held = new Promise<void>((resolve) => {
        release = resolve
      })
      let calls = 0
      server.use(
        http.get('*/api/v1/user/profile', async () => {
          calls++
          await held
          return HttpResponse.json(profile(owner), { status: failure })
        })
      )
      const pending = [resolveNativeSessionToken(), resolveNativeSessionToken()]
      try {
        await vi.waitFor(() => expect(calls).toBeGreaterThan(0))
        release()
        const results = await Promise.allSettled(pending)
        expect(
          results.every((result) =>
            failure === 503
              ? result.status === 'rejected'
              : result.status === 'fulfilled' && result.value === undefined
          )
        ).toBe(true)
        expect(calls).toBe(1)
        expect(nativeSessionIdentity()).toBeNull()
        server.use(
          http.get('*/api/v1/user/profile', () => {
            calls++
            return HttpResponse.json(profile(owner))
          })
        )
        expect(typeof (await resolveNativeSessionToken())).toBe('string')
        expect(calls).toBe(2)
        expect(nativeSessionIdentity()).toBe('canonical-member-a')
      } finally {
        release()
        await Promise.allSettled(pending)
      }
    }
  )
  it('C01 never joins an old shared flight after logout and a new OTP epoch', async () => {
    await verifyNativeOtp('session@synthetic.test', 'fixture-code')
    sdk.current = null
    await resolveNativeSessionToken()
    sdk.current = { access_token: 'epoch-fixture', user: { id: 'epoch-principal' } }
    let release!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    let calls = 0
    server.use(
      http.get('*/api/v1/user/profile', async () => {
        if (++calls === 1) {
          await held
          return HttpResponse.json(profile('old-epoch-member'))
        }
        return HttpResponse.json(profile('new-epoch-member'))
      })
    )
    const pending = [resolveNativeSessionToken(), resolveNativeSessionToken()]
    try {
      await vi.waitFor(() => expect(calls).toBeGreaterThan(0))
      await signOutNativeSession()
      expect(nativeSessionIdentity()).toBeNull()
      // Same principal/token still requires fresh canonical verification after logout.
      await verifyNativeOtp('session@synthetic.test', 'fixture-code')
      expect(nativeSessionIdentity()).toBe('new-epoch-member')
      release()
      const results = await Promise.allSettled(pending)
      expect(results.every((result) => result.status === 'rejected')).toBe(true)
      expect(nativeSessionIdentity()).toBe('new-epoch-member')
      expect(typeof (await resolveNativeSessionToken())).toBe('string')
      expect(calls).toBe(2)
    } finally {
      release()
      await Promise.allSettled(pending)
    }
  })
  it('A02 insufficient bearer lifetime is retryable and retains same-owner scope', async () => {
    await verifyNativeOtp('session@synthetic.test', 'fixture-code')
    sdk.current = { ...sdk.current!, expires_at: (Date.now() + 1400) / 1000 }
    await expect(resolveNativeSessionToken()).rejects.toThrow(
      'Session verification is unavailable.'
    )
    expect(nativeSessionIdentity()).toBe('canonical-member-a')
    expect(mobileApplicationUserId()).toBe('canonical-member-a')
  })
  it('uses the profile application ID and fences account switching', async () => {
    await verifyNativeOtp('session@synthetic.test', 'fixture-code')
    expect(nativeSessionIdentity()).toBe('canonical-member-a')
    expect(mobileApplicationUserId()).toBe('canonical-member-a')
    expect(await resolveNativeSessionToken()).toBe('local-session-a')
    owner = 'canonical-member-b'
    sdk.current = {
      access_token: 'local-session-b',
      user: { id: 'distinct-auth-principal-b' },
    }
    expect(await resolveNativeSessionToken()).toBe('local-session-b')
    expect(mobileApplicationUserId()).toBe('canonical-member-b')
    await signOutNativeSession()
    expect(nativeSessionIdentity()).toBeNull()
    expect(await resolveNativeSessionToken()).toBeUndefined()
    expect(sdk.deleted).toContain('couturecast.auth-session')
  })
  it('retains permitted same-owner scope during transient refresh and clears affirmative denial', async () => {
    await verifyNativeOtp('session@synthetic.test', 'fixture-code')
    sdk.current = {
      access_token: 'refreshed-token',
      user: { id: 'distinct-auth-principal-a' },
    }
    status = 503
    await expect(resolveNativeSessionToken()).rejects.toThrow()
    expect(nativeSessionIdentity()).toBe('canonical-member-a')
    status = 403
    expect(await resolveNativeSessionToken()).toBeUndefined()
    expect(nativeSessionIdentity()).toBeNull()
  })
  it.each(['profile', 'offline', 'lifetime', 'restore'])(
    'B01 startup %s failure retains the production resolver, lifecycle and SDK updates',
    async (failure) => {
      // Model a cold unverified owner without disabling local sign-in intent.
      await verifyNativeOtp('session@synthetic.test', 'fixture-code')
      sdk.current = null
      expect(await resolveNativeSessionToken()).toBeUndefined()
      sdk.current = { access_token: 'cold-token', user: { id: 'cold-principal' } }
      if (failure === 'restore') sdk.error = new Error('restore offline')
      if (failure === 'lifetime') sdk.current.expires_at = (Date.now() + 1400) / 1000
      if (failure === 'profile') status = 503
      if (failure === 'offline')
        server.use(http.get('*/api/v1/user/profile', () => HttpResponse.error()))
      cleanup = await startNativeSession()
      expect(nativeSessionIdentity()).toBeNull()
      expect(sdk.unsubscribe).not.toHaveBeenCalled()
      expect(sdk.removeLifecycle).not.toHaveBeenCalled()
      await expect(resolveMobileAccessToken()).rejects.toThrow()
      status = 200
      sdk.error = null
      server.use(
        http.get('*/api/v1/user/profile', () => HttpResponse.json(profile(owner)))
      )
      sdk.current = { access_token: 'recovered-token', user: { id: 'cold-principal' } }
      expect(await resolveMobileAccessToken()).toBe('recovered-token')
      expect(nativeSessionIdentity()).toBe('canonical-member-a')
      const refreshStarts = sdk.startRefresh.mock.calls.length
      sdk.lifecycle?.('background')
      sdk.lifecycle?.('active')
      await vi.waitFor(() =>
        expect(sdk.startRefresh.mock.calls.length).toBeGreaterThan(refreshStarts)
      )
      owner = 'canonical-member-refreshed'
      sdk.current = { access_token: 'rotated-token', user: { id: 'cold-principal' } }
      sdk.callback?.('TOKEN_REFRESHED', sdk.current)
      await vi.waitFor(() =>
        expect(mobileApplicationUserId()).toBe('canonical-member-refreshed')
      )
      expect(await resolveMobileAccessToken()).toBe('rotated-token')
      sdk.callback?.('SIGNED_OUT', null)
      await vi.waitFor(() => expect(nativeSessionIdentity()).toBeNull())
      sdk.current = { access_token: 'otp-token', user: { id: 'later-principal' } }
      await verifyNativeOtp('session@synthetic.test', 'fixture-code')
      expect(await resolveMobileAccessToken()).toBe('otp-token')
      await signOutNativeSession()
      expect(await resolveMobileAccessToken()).toBeUndefined()
      cleanup()
      cleanup = undefined
      expect(sdk.unsubscribe).toHaveBeenCalledTimes(1)
      expect(sdk.removeLifecycle).toHaveBeenCalledTimes(1)
      expect(await resolveMobileAccessToken()).toBeUndefined()
    }
  )
  it('B01 releases partial installation when lifecycle registration fails', async () => {
    sdk.installFailure = true
    await expect(startNativeSession()).rejects.toThrow('lifecycle installation failed')
    expect(sdk.unsubscribe).toHaveBeenCalledTimes(1)
    expect(await resolveMobileAccessToken()).toBeUndefined()
  })
  it('B02 superseded same-owner verification stays retryable without supplying the old token', async () => {
    await verifyNativeOtp('session@synthetic.test', 'fixture-code')
    let release!: () => void
    let observed!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const started = new Promise<void>((resolve) => {
      observed = resolve
    })
    server.use(
      http.get('*/api/v1/user/profile', async ({ request }) => {
        if (request.headers.get('authorization') === 'Bearer held-refresh') {
          observed()
          await held
        }
        return HttpResponse.json(profile(owner))
      })
    )
    sdk.current = {
      access_token: 'held-refresh',
      user: { id: 'distinct-auth-principal-a' },
    }
    const pending = resolveNativeSessionToken()
    await started
    sdk.current = { ...sdk.current, access_token: 'newer-refresh' }
    expect(await resolveNativeSessionToken()).toBe('newer-refresh')
    release()
    await expect(pending).rejects.toThrow('Session verification is unavailable.')
    expect(nativeSessionIdentity()).toBe('canonical-member-a')
    expect(await resolveNativeSessionToken()).toBe('newer-refresh')
  })
  it('B02 rejects a bearer whose held canonical profile consumes its lifetime margin', async () => {
    await verifyNativeOtp('session@synthetic.test', 'fixture-code')
    sdk.current = {
      access_token: 'short-after-profile',
      expires_at: (Date.now() + 5500) / 1000,
      user: { id: 'distinct-auth-principal-a' },
    }
    let profileCalls = 0
    server.use(
      http.get('*/api/v1/user/profile', async () => {
        profileCalls++
        await new Promise((resolve) => setTimeout(resolve, 4000))
        return HttpResponse.json(profile(owner))
      })
    )
    await expect(resolveNativeSessionToken()).rejects.toThrow(
      'Session verification is unavailable.'
    )
    expect(profileCalls).toBe(1)
    expect(nativeSessionIdentity()).toBe('canonical-member-a')
    expect(mobileApplicationUserId()).toBe('canonical-member-a')
    sdk.current = {
      ...sdk.current,
      access_token: 'fresh-token',
      expires_at: (Date.now() + 120000) / 1000,
    }
    server.use(http.get('*/api/v1/user/profile', () => HttpResponse.json(profile(owner))))
    expect(await resolveNativeSessionToken()).toBe('fresh-token')
  }, 10000)
})

describe('native session recovery and secure lifecycle', () => {
  it('passes secure storage operations through the SDK adapter', async () => {
    await nativeSupabase()
    const secure = await import('expo-secure-store')
    await sdk.storage!.setItem('session-fixture', 'synthetic-value')
    expect(secure.setItemAsync).toHaveBeenCalledWith(
      'session-fixture',
      'synthetic-value',
      { keychainAccessible: 1 }
    )
    expect(await sdk.storage!.getItem('session-fixture')).toBeNull()
    expect(secure.getItemAsync).toHaveBeenCalledWith('session-fixture')
    await sdk.storage!.removeItem('session-fixture')
    expect(sdk.deleted).toContain('session-fixture')
  })
  it('requests email OTP, reports provider refusal, and rejects an absent verification session', async () => {
    await requestNativeOtp('session@synthetic.test')
    expect(sdk.signIn).toHaveBeenCalledWith({
      email: 'session@synthetic.test',
      options: { shouldCreateUser: true },
    })
    sdk.signIn.mockResolvedValueOnce({ error: new Error('offline') })
    await expect(requestNativeOtp('session@synthetic.test')).rejects.toThrow(
      'Sign-in could not be started.'
    )
    sdk.current = null
    await expect(verifyNativeOtp('session@synthetic.test', 'bad')).rejects.toThrow(
      'Sign-in code could not be verified.'
    )
    expect(nativeSessionIdentity()).toBeNull()
  })
  it('clears visible identity before bounded logout hooks and clears storage even when SDK logout fails', async () => {
    await verifyNativeOtp('session@synthetic.test', 'fixture')
    const observed = vi.fn()
    const unsubscribe = subscribeNativeSession(observed)
    const hook = vi.fn((token?: string) => {
      expect(token).toBe('local-session-a')
      expect(nativeSessionIdentity()).toBeNull()
      return Promise.reject(new Error('unbind offline'))
    })
    const removeHook = beforeNativeLogout(hook)
    sdk.signOut.mockRejectedValueOnce(new Error('logout offline'))
    try {
      await expect(signOutNativeSession()).rejects.toThrow('logout offline')
      expect(hook).toHaveBeenCalledTimes(1)
      expect(observed).toHaveBeenCalledTimes(1)
      expect(sdk.deleted).toEqual(
        expect.arrayContaining([
          'couturecast.auth-session',
          'couturecast.auth-session-code-verifier',
        ])
      )
    } finally {
      unsubscribe()
      removeHook()
    }
    await signOutNativeSession()
    expect(hook).toHaveBeenCalledTimes(1)
    expect(observed).toHaveBeenCalledTimes(1)
  })
  it('ignores queued auth after cleanup and makes teardown idempotent', async () => {
    await verifyNativeOtp('session@synthetic.test', 'fixture')
    cleanup = await startNativeSession()
    const callback = sdk.callback!
    cleanup()
    cleanup()
    cleanup = undefined
    callback('SIGNED_IN', { access_token: 'late', user: { id: 'late-principal' } })
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(nativeSessionIdentity()).toBe('canonical-member-a')
    expect(sdk.unsubscribe).toHaveBeenCalledTimes(1)
    expect(sdk.removeLifecycle).toHaveBeenCalledTimes(1)
  })
})

it('contains background SDK failures, retains verified scope, and recovers bearer supply on foreground', async () => {
  await verifyNativeOtp('session@synthetic.test', 'fixture')
  sdk.startRefresh.mockRejectedValue(new Error('refresh offline'))
  sdk.stopRefresh.mockRejectedValue(new Error('stop offline'))
  try {
    cleanup = await startNativeSession()
    sdk.error = new Error('SDK offline')
    sdk.lifecycle!('background')
    sdk.lifecycle!('active')
    await expect(resolveMobileAccessToken()).rejects.toThrow(
      'Session verification is unavailable.'
    )
    expect(nativeSessionIdentity()).toBe('canonical-member-a')
    expect(sdk.startRefresh).toHaveBeenCalledTimes(2)
    expect(sdk.stopRefresh).toHaveBeenCalledTimes(1)
    sdk.error = null
    sdk.startRefresh.mockResolvedValue(undefined)
    sdk.lifecycle!('active')
    expect(await resolveMobileAccessToken()).toBe('local-session-a')
    cleanup()
    cleanup = undefined
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(sdk.stopRefresh).toHaveBeenCalledTimes(2)
    expect(sdk.unsubscribe).toHaveBeenCalledTimes(1)
    expect(sdk.removeLifecycle).toHaveBeenCalledTimes(1)
  } finally {
    sdk.error = null
    sdk.startRefresh.mockResolvedValue(undefined)
    sdk.stopRefresh.mockResolvedValue(undefined)
  }
})
