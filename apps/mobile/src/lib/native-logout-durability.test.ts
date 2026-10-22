// Story 6.5 (PR #157 review P1): native logout removes the persisted session even while
// push registration is stalled on the OS token, and a late token never registers or
// stores a binding for the signed-out account. The actual session, notification module
// and logout hook run together; only the SDK, OS and storage boundaries are controlled.
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExpoPushTokenOptions } from 'expo-notifications'
import { server } from '../test-utils/msw/server'
const device = vi.hoisted(() => ({
  storage: new Map<string, string>(),
  tokens: [] as { resolve: (value: { data: string }) => void }[],
  authStorage: undefined as
    | undefined
    | {
        getItem: (key: string) => Promise<string | null>
        setItem: (key: string, value: string) => Promise<void>
        removeItem: (key: string) => Promise<void>
      },
  removals: vi.fn(),
}))
vi.mock('react-native', () => ({
  Platform: { OS: 'ios' },
  AppState: {
    currentState: 'active',
    addEventListener: () => ({ remove: device.removals }),
  },
}))
vi.mock('expo-constants', () => ({
  default: {
    easConfig: { projectId: 'isolated-test-project' },
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
  getItemAsync: (key: string) => Promise.resolve(device.storage.get(key) ?? null),
  setItemAsync: (key: string, value: string) => {
    device.storage.set(key, value)
    return Promise.resolve()
  },
  deleteItemAsync: (key: string) => {
    device.storage.delete(key)
    return Promise.resolve()
  },
}))
vi.mock('expo-crypto', () => ({
  randomUUID: () => '63100000-0000-4000-8000-000000000001',
}))
vi.mock('expo-notifications', () => ({
  setNotificationHandler: vi.fn(),
  addNotificationResponseReceivedListener: () => ({ remove: device.removals }),
  setNotificationChannelAsync: vi.fn().mockResolvedValue(undefined),
  AndroidImportance: { DEFAULT: 3 },
  addPushTokenListener: () => ({ remove: device.removals }),
  getLastNotificationResponseAsync: () => Promise.resolve(null),
  clearLastNotificationResponseAsync: vi.fn().mockResolvedValue(undefined),
  getPermissionsAsync: () => Promise.resolve({ granted: true }),
  requestPermissionsAsync: () => Promise.resolve({ granted: true }),
  // The OS token request stays pending until the test releases it.
  getExpoPushTokenAsync: (_options: ExpoPushTokenOptions) =>
    new Promise<{ data: string }>((resolve) => {
      device.tokens.push({ resolve })
    }),
}))
const SESSION_KEY = 'couturecast.auth-session'
// The SDK persists through the app's storage adapter, as Supabase does.
vi.mock('@supabase/supabase-js', () => ({
  processLock: vi.fn(),
  createClient: (
    _url: string,
    _key: string,
    options: { auth: { storage: NonNullable<typeof device.authStorage> } }
  ) => {
    device.authStorage = options.auth.storage
    const stored = async () => {
      const raw = await options.auth.storage.getItem(SESSION_KEY)
      return raw ? (JSON.parse(raw) as unknown) : null
    }
    return {
      auth: {
        getSession: async () => ({ data: { session: await stored() }, error: null }),
        verifyOtp: async ({ email }: { email: string }) => {
          const member = email.startsWith('b') ? 'b' : 'a'
          const session = {
            access_token: `token-${member}`,
            user: { id: `principal-${member}` },
          }
          await options.auth.storage.setItem(SESSION_KEY, JSON.stringify(session))
          return { data: { session }, error: null }
        },
        signOut: () => options.auth.storage.removeItem(SESSION_KEY),
        signInWithOtp: () => Promise.resolve({ error: null }),
        startAutoRefresh: () => Promise.resolve(),
        stopAutoRefresh: () => Promise.resolve(),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: vi.fn() } } }),
      },
    }
  },
}))
import {
  nativeSessionIdentity,
  signOutNativeSession,
  startNativeSession,
  verifyNativeOtp,
} from './native-session'
import { startNativeNotifications } from './native-notifications'

const registrationKey = 'couturecast.push-registration'
let registrations: string[]
let close: (() => void) | undefined
let stopSession: (() => void) | undefined
const settle = (ms = 50) => new Promise((resolve) => setTimeout(resolve, ms))
const within = (work: Promise<unknown>, ms: number) =>
  Promise.race([
    work.then(() => 'settled' as const),
    new Promise<'stalled'>((resolve) => setTimeout(() => resolve('stalled'), ms)),
  ])
const persistedSession = () =>
  [...device.storage.keys()].filter((key) => key.startsWith(SESSION_KEY))

beforeEach(async () => {
  process.env.EXPO_PUBLIC_API_BASE_URL = window.location.origin
  await signOutNativeSession()
  device.storage.clear()
  device.tokens.length = 0
  registrations = []
  server.use(
    http.get('*/api/v1/user/profile', ({ request }) => {
      const member = request.headers.get('authorization') === 'Bearer token-b' ? 'b' : 'a'
      return HttpResponse.json({
        user: {
          id: `member-${member}`,
          email: `${member}@synthetic.test`,
          displayName: null,
          birthdate: '1990-01-01T00:00:00.000Z',
          role: 'teen',
        },
        linkedGuardians: [],
        linkedTeens: [],
      })
    }),
    http.post('*/api/v1/notifications/push-tokens', ({ request }) => {
      registrations.push(request.headers.get('authorization') ?? '')
      return HttpResponse.json({
        data: {
          registrationId: '63100000-0000-4000-8000-0000000000aa',
          bindingGeneration: 1,
          platform: 'ios',
          permission: 'granted',
          lastUsedAt: new Date().toISOString(),
        },
      })
    })
  )
})
afterEach(async () => {
  close?.()
  close = undefined
  stopSession?.()
  stopSession = undefined
  device.tokens.forEach((token) => token.resolve({ data: 'ExpoPushToken[released]' }))
  await settle()
})

/** Member A is signed in and registration is waiting on the OS push token. */
async function stalledRegistration() {
  stopSession = await startNativeSession()
  await verifyNativeOtp('a@synthetic.test', '123456')
  expect(nativeSessionIdentity()).toBe('member-a')
  close = await startNativeNotifications({ ready: () => true, open: vi.fn() })
  await vi.waitFor(() => expect(device.tokens).toHaveLength(1))
  expect(persistedSession()).not.toEqual([])
}

describe('logout while push registration is stalled', () => {
  it('removes the persisted session within the logout bound, so a fresh process restores nobody', async () => {
    await stalledRegistration()
    expect(await within(signOutNativeSession(), 5000)).toBe('settled')
    expect(persistedSession()).toEqual([])
    // A fresh process restores from storage alone.
    vi.resetModules()
    const fresh = await import('./native-session.js')
    const stop = await fresh.startNativeSession()
    try {
      await settle()
      expect(fresh.nativeSessionIdentity()).toBeNull()
    } finally {
      stop()
    }
  })

  it('never registers or stores a binding when the token arrives after logout', async () => {
    await stalledRegistration()
    await within(signOutNativeSession(), 5000)
    device.tokens[0]!.resolve({ data: 'ExpoPushToken[late_device]' })
    await settle(200)
    expect(registrations).toEqual([])
    expect(device.storage.has(registrationKey)).toBe(false)
  })

  it('registers the next member without waiting on, or being overwritten by, the stale flight', async () => {
    await stalledRegistration()
    await within(signOutNativeSession(), 5000)
    await verifyNativeOtp('b@synthetic.test', '123456')
    expect(nativeSessionIdentity()).toBe('member-b')
    await vi.waitFor(() => expect(device.tokens).toHaveLength(2))
    device.tokens[1]!.resolve({ data: 'ExpoPushToken[member_b_device]' })
    await vi.waitFor(() => expect(registrations).toEqual(['Bearer token-b']))
    device.tokens[0]!.resolve({ data: 'ExpoPushToken[late_device]' })
    await settle(200)
    expect(registrations).toEqual(['Bearer token-b'])
    expect(JSON.parse(device.storage.get(registrationKey)!)).toMatchObject({
      owner: 'member-b',
    })
  })
})
