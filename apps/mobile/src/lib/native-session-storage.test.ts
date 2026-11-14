// Learning path Step 43: Realtime engagement and push notifications.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-43-realtime-engagement-and-push-notifications
// Story 6.5 owner: the persisted Supabase session survives SecureStore's 2048-byte limit.
// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
// Story 6.15 U-04: the SecureStore key names and options are pinned, so a rename across SDK steps
// cannot sign members out after an in-place upgrade (R02).
import { beforeEach, describe, expect, it, vi } from 'vitest'

const store = vi.hoisted(() => {
  const values = new Map<string, string>()
  const bytes = (value: string) => new TextEncoder().encode(value).length
  return {
    values,
    bytes,
    // iOS Keychain can refuse a value above SecureStore's documented 2048-byte limit.
    getItemAsync: vi.fn((key: string) => Promise.resolve(values.get(key) ?? null)),
    setItemAsync: vi.fn((key: string, value: string) => {
      if (bytes(value) > 2048)
        return Promise.reject(new Error('Value larger than 2048 bytes refused'))
      values.set(key, value)
      return Promise.resolve()
    }),
    deleteItemAsync: vi.fn((key: string) => {
      values.delete(key)
      return Promise.resolve()
    }),
    signOut: vi.fn(() => Promise.resolve({ error: null })),
    auth: undefined as undefined | Record<string, unknown>,
    storage: undefined as
      | undefined
      | {
          getItem: (key: string) => Promise<string | null>
          setItem: (key: string, value: string) => Promise<void>
          removeItem: (key: string) => Promise<void>
        },
  }
})
vi.mock('react-native', () => ({
  AppState: { currentState: 'active', addEventListener: () => ({ remove: vi.fn() }) },
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
// Every accessibility constant is distinct, so the pinned option names exactly one of them.
vi.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK: 0,
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 1,
  ALWAYS: 2,
  ALWAYS_THIS_DEVICE_ONLY: 3,
  WHEN_PASSCODE_SET_THIS_DEVICE_ONLY: 4,
  WHEN_UNLOCKED: 5,
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 6,
  getItemAsync: store.getItemAsync,
  setItemAsync: store.setItemAsync,
  deleteItemAsync: store.deleteItemAsync,
}))
vi.mock('@supabase/supabase-js', () => ({
  processLock: vi.fn(),
  createClient: (
    _url: string,
    _key: string,
    options: {
      auth: Record<string, unknown> & { storage: NonNullable<typeof store.storage> }
    }
  ) => {
    store.auth = options.auth
    store.storage = options.auth.storage
    return { auth: { signOut: store.signOut } }
  },
}))

import { nativeSupabase, signOutNativeSession } from './native-session'

const KEY = 'couturecast.auth-session'
/** A realistic persisted session: two JWTs, the user and non-ASCII profile metadata. */
function session(size: number) {
  return JSON.stringify({
    access_token: `eyJ${'a'.repeat(size / 3)}`,
    refresh_token: 'refresh-synthetic',
    user: {
      id: 'auth-user',
      user_metadata: { display_name: 'Zoë Çelik 日本', bio: 'é'.repeat(size / 6) },
    },
    expires_at: 1_900_000_000,
  })
}

beforeEach(async () => {
  store.values.clear()
  vi.clearAllMocks()
  await nativeSupabase()
})

describe('native session storage', () => {
  it('persists and restores a session larger than 2048 bytes without any value over the limit', async () => {
    const value = session(6000)
    expect(store.bytes(value)).toBeGreaterThan(2048)
    await store.storage!.setItem(KEY, value)
    expect(
      [...store.values.values()].every((stored) => store.bytes(stored) <= 2048)
    ).toBe(true)
    expect(await store.storage!.getItem(KEY)).toBe(value)
  })

  it('replaces a large session with a smaller one and leaves no stale chunks', async () => {
    await store.storage!.setItem(KEY, session(6000))
    const small = session(300)
    await store.storage!.setItem(KEY, small)
    expect(await store.storage!.getItem(KEY)).toBe(small)
    expect([...store.values.keys()]).toEqual([KEY])
  })

  it('removes every chunk on sign-out', async () => {
    await store.storage!.setItem(KEY, session(6000))
    await store.storage!.removeItem(KEY)
    expect(store.values.size).toBe(0)
    expect(await store.storage!.getItem(KEY)).toBeNull()
  })

  it('reports no session, never a corrupt one, when a chunk is missing', async () => {
    await store.storage!.setItem(KEY, session(6000))
    const chunk = [...store.values.keys()].find((key) => key !== KEY)!
    store.values.delete(chunk)
    expect(await store.storage!.getItem(KEY)).toBeNull()
  })

  it('keeps the previous session intact when a new write is interrupted', async () => {
    const previous = session(6000)
    await store.storage!.setItem(KEY, previous)
    let writes = 0
    store.setItemAsync.mockImplementation((key: string, value: string) => {
      if (++writes === 2) return Promise.reject(new Error('Keychain write interrupted'))
      store.values.set(key, value)
      return Promise.resolve()
    })
    await expect(store.storage!.setItem(KEY, session(7000))).rejects.toThrow(
      'interrupted'
    )
    expect(await store.storage!.getItem(KEY)).toBe(previous)
  })

  it('leaves no keys after an interrupted write followed by sign-out', async () => {
    await store.storage!.setItem(KEY, session(6000))
    const write = (key: string, value: string) => {
      store.values.set(key, value)
      return Promise.resolve()
    }
    // The new generation's first chunk lands, then the write is interrupted.
    store.setItemAsync
      .mockImplementationOnce(write)
      .mockImplementationOnce(write)
      .mockImplementationOnce(() =>
        Promise.reject(new Error('Keychain write interrupted'))
      )
    await expect(store.storage!.setItem(KEY, session(9000))).rejects.toThrow(
      'interrupted'
    )
    await store.storage!.removeItem(KEY)
    expect([...store.values.keys()]).toEqual([])
  })

  it('sweeps chunks a failed cleanup of the previous generation left behind', async () => {
    await store.storage!.setItem(KEY, session(6000))
    const previousChunks = [...store.values.keys()].filter((key) => key !== KEY)
    store.deleteItemAsync.mockImplementationOnce(() =>
      Promise.reject(new Error('Keychain delete interrupted'))
    )
    await store.storage!.setItem(KEY, session(6000)).catch(() => undefined)
    const current = session(300)
    await store.storage!.setItem(KEY, current)
    expect(await store.storage!.getItem(KEY)).toBe(current)
    expect([...store.values.keys()]).toEqual([KEY])
    for (const key of previousChunks) expect(store.values.has(key)).toBe(false)
  })

  it('keeps reading a session stored whole by an earlier build', async () => {
    const legacy = session(300)
    store.values.set(KEY, legacy)
    expect(await store.storage!.getItem(KEY)).toBe(legacy)
  })
})

describe('pinned SecureStore contract (U-04)', () => {
  // Literal names, not the module's constants: these are what an installed build already wrote.
  it('persists the Supabase session under couturecast.auth-session', () => {
    expect(store.auth).toMatchObject({
      storageKey: 'couturecast.auth-session',
      persistSession: true,
    })
  })

  it('writes every value, whole or chunked, readable after first unlock on this device only', async () => {
    await store.storage!.setItem('couturecast.auth-session', session(300))
    await store.storage!.setItem('couturecast.auth-session', session(6000))
    expect(store.setItemAsync.mock.calls.length).toBeGreaterThan(2)
    for (const [, , options] of store.setItemAsync.mock.calls as unknown as [
      string,
      string,
      unknown,
    ][])
      expect(options).toEqual({ keychainAccessible: 1 })
  })

  it('names the manifest, its chunks and the journal as the installed build does', async () => {
    await store.storage!.setItem('couturecast.auth-session', session(6000))
    const written = store.setItemAsync.mock.calls.map(([key]) => key)
    expect(written[0]).toBe('couturecast.auth-session.journal')
    expect(written.at(-1)).toBe('couturecast.auth-session')
    const manifest = /^chunked:v1:([a-z0-9]+):(\d+)$/.exec(
      store.values.get('couturecast.auth-session')!
    )
    expect(manifest).not.toBeNull()
    const [, generation, count] = manifest!
    expect(written.slice(1, -1)).toEqual(
      Array.from(
        { length: Number(count) },
        (_, index) => `couturecast.auth-session.${generation}.${index}`
      )
    )
  })

  it('restores a chunked session an earlier build stored under the pinned names', async () => {
    store.values.set('couturecast.auth-session', 'chunked:v1:k3x9a1:2')
    store.values.set('couturecast.auth-session.k3x9a1.0', '{"access_token":"eyJ')
    store.values.set('couturecast.auth-session.k3x9a1.1', 'stored"}')
    expect(await store.storage!.getItem('couturecast.auth-session')).toBe(
      '{"access_token":"eyJstored"}'
    )
  })

  it('signs out by deleting the session and its PKCE code verifier', async () => {
    store.values.set('couturecast.auth-session', session(300))
    store.values.set('couturecast.auth-session-code-verifier', 'verifier-synthetic')
    await signOutNativeSession()
    expect(store.signOut).toHaveBeenCalledWith({ scope: 'local' })
    expect(store.deleteItemAsync.mock.calls.map(([key]) => key)).toEqual([
      'couturecast.auth-session',
      'couturecast.auth-session-code-verifier',
    ])
    expect(store.values.size).toBe(0)
  })
})
