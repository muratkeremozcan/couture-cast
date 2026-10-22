// Story 6.5 owner: the persisted Supabase session survives SecureStore's 2048-byte limit.
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
vi.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 1,
  getItemAsync: store.getItemAsync,
  setItemAsync: store.setItemAsync,
  deleteItemAsync: store.deleteItemAsync,
}))
vi.mock('@supabase/supabase-js', () => ({
  processLock: vi.fn(),
  createClient: (
    _url: string,
    _key: string,
    options: { auth: { storage: NonNullable<typeof store.storage> } }
  ) => {
    store.storage = options.auth.storage
    return { auth: {} }
  },
}))

import { nativeSupabase } from './native-session'

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

  it('keeps reading a session stored whole by an earlier build', async () => {
    const legacy = session(300)
    store.values.set(KEY, legacy)
    expect(await store.storage!.getItem(KEY)).toBe(legacy)
  })
})
