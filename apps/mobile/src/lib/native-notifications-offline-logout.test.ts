// Story 6.5 (D7/D8 privacy): a logout that cannot reach the API keeps retrying the binding
// removal with the signed-out member's own credential, so the device stops receiving that
// member's notifications as soon as it is back online. Native boundaries are controlled;
// removal and registration use the actual HTTP wrappers.
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExpoPushTokenOptions } from 'expo-notifications'
import { server } from '../test-utils/msw/server'
const device = vi.hoisted(() => ({
  owner: 'member-a' as string | null,
  platform: 'ios',
  storage: new Map<string, string>(),
  failWrites: new Set<string>(),
  tokenError: undefined as Error | undefined,
  lifecycle: undefined as undefined | ((state: string) => void),
  logout: undefined as undefined | ((token?: string) => Promise<void>),
  removals: vi.fn(),
}))
vi.mock('expo-constants', () => ({
  default: { easConfig: { projectId: 'isolated-test-project' } },
}))
vi.mock('react-native', () => ({
  Platform: {
    get OS() {
      return device.platform
    },
  },
  AppState: {
    addEventListener: (_: string, callback: (state: string) => void) => {
      device.lifecycle = callback
      return { remove: device.removals }
    },
  },
}))
vi.mock('expo-secure-store', () => ({
  getItemAsync: (key: string) => Promise.resolve(device.storage.get(key) ?? null),
  setItemAsync: (key: string, value: string) => {
    if (device.failWrites.has(key)) return Promise.reject(new Error('Keychain locked'))
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
  getExpoPushTokenAsync: (_options: ExpoPushTokenOptions) =>
    device.tokenError
      ? Promise.reject(device.tokenError)
      : Promise.resolve({ data: 'ExpoPushToken[synthetic_local_device]' }),
}))
vi.mock('./native-session', () => ({
  nativeSessionIdentity: () => device.owner,
  subscribeNativeSession: () => device.removals,
  beforeNativeLogout: (callback: typeof device.logout) => {
    device.logout = callback
    return device.removals
  },
}))
vi.mock('./mobile-auth', () => ({
  resolveMobileAccessToken: () =>
    Promise.resolve(device.owner ? `fixture-${device.owner}` : undefined),
}))
import {
  reconcileNativeRegistration,
  startNativeNotifications,
} from './native-notifications'
import { nativeNotificationFailureKey } from './native-notification-errors'

const registrationKey = 'couturecast.push-registration'
const pendingKey = 'couturecast.push-cleanup'
const credentialKey = 'couturecast.push-cleanup-credential'
const stored = {
  registrationId: '63100000-0000-4000-8000-0000000000aa',
  bindingGeneration: 4,
  platform: 'ios',
  permission: 'granted',
  lastUsedAt: '2026-10-22T00:00:00.000Z',
  owner: 'member-a',
}
type Removal = { id: string; bearer: string | null }
let removals: Removal[]
let answer: () => Response
function removalEndpoint() {
  server.use(
    http.delete('*/api/v1/notifications/push-tokens/:id', ({ request, params }) => {
      removals.push({
        id: String(params.id),
        bearer: request.headers.get('authorization'),
      })
      return answer()
    })
  )
}
const offline = () => HttpResponse.error() as Response
const removed = (value: boolean) => HttpResponse.json({ data: { removed: value } })
const credential = (): unknown => {
  const raw = device.storage.get(credentialKey)
  return raw ? JSON.parse(raw) : undefined
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 50))
let close: (() => void) | undefined

beforeEach(() => {
  device.owner = 'member-a'
  device.platform = 'ios'
  device.storage.clear()
  device.failWrites.clear()
  device.tokenError = undefined
  removals = []
  answer = () => removed(true)
  process.env.EXPO_PUBLIC_API_BASE_URL = window.location.origin
  removalEndpoint()
})
afterEach(() => {
  close?.()
  close = undefined
})
/** Signs member-a out while the API is unreachable, as the app's logout does. */
async function offlineLogout() {
  close = await startNativeNotifications({ ready: () => true, open: vi.fn() })
  device.storage.set(registrationKey, JSON.stringify(stored))
  device.owner = null
  answer = offline
  await expect(device.logout!('captured-token-a')).rejects.toThrow()
  close()
  close = undefined
}

describe('offline logout binding cleanup', () => {
  it('retries the removal with the signed-out member credential on the next app start', async () => {
    await offlineLogout()
    expect(device.storage.has(registrationKey)).toBe(false)
    expect(device.storage.has(pendingKey)).toBe(true)
    expect(credential()).toEqual({ owner: 'member-a', accessToken: 'captured-token-a' })
    answer = () => removed(true)
    close = await startNativeNotifications({ ready: () => true, open: vi.fn() })
    await vi.waitFor(() => expect(device.storage.has(pendingKey)).toBe(false))
    expect(removals.at(-1)).toEqual({
      id: stored.registrationId,
      bearer: 'Bearer captured-token-a',
    })
    expect(device.storage.has(credentialKey)).toBe(false)
  })

  it('keeps retrying on foreground while offline and stops once the binding is gone', async () => {
    await offlineLogout()
    close = await startNativeNotifications({ ready: () => true, open: vi.fn() })
    await settle()
    expect(credential()).toEqual({ owner: 'member-a', accessToken: 'captured-token-a' })
    const before = removals.length
    // The server reports nothing left to remove: the binding is already gone.
    answer = () => removed(false)
    device.lifecycle!('active')
    await vi.waitFor(() => expect(device.storage.has(pendingKey)).toBe(false))
    expect(removals.length).toBe(before + 1)
    expect(device.storage.has(credentialKey)).toBe(false)
    device.lifecycle!('active')
    await settle()
    expect(removals.length).toBe(before + 1)
  })

  it('discards a rejected credential but keeps the binding for the next sign-in to take over', async () => {
    await offlineLogout()
    answer = () =>
      HttpResponse.json({ statusCode: 401, message: 'Unauthorized' }, { status: 401 })
    close = await startNativeNotifications({ ready: () => true, open: vi.fn() })
    await vi.waitFor(() => expect(device.storage.has(credentialKey)).toBe(false))
    expect(device.storage.has(pendingKey)).toBe(true)
    const before = removals.length
    device.lifecycle!('active')
    await settle()
    expect(removals.length).toBe(before)
  })

  it('never pairs one member credential with another member binding', async () => {
    await offlineLogout()
    device.storage.set(pendingKey, JSON.stringify({ ...stored, owner: 'member-b' }))
    const before = removals.length
    answer = () => removed(true)
    close = await startNativeNotifications({ ready: () => true, open: vi.fn() })
    await vi.waitFor(() => expect(device.storage.has(credentialKey)).toBe(false))
    expect(removals.length).toBe(before)
    expect(device.storage.has(pendingKey)).toBe(true)
  })
})

describe('logout clears the local registration record', () => {
  it('clears an unreadable record', async () => {
    close = await startNativeNotifications({ ready: () => true, open: vi.fn() })
    device.storage.set(registrationKey, '{not json')
    device.owner = null
    await device.logout!('captured-token-a')
    expect(device.storage.has(registrationKey)).toBe(false)
  })

  it('clears the record even when the cleanup record cannot be written', async () => {
    close = await startNativeNotifications({ ready: () => true, open: vi.fn() })
    device.storage.set(registrationKey, JSON.stringify(stored))
    device.failWrites.add(pendingKey)
    device.owner = null
    await device.logout!('captured-token-a').catch(() => undefined)
    expect(device.storage.has(registrationKey)).toBe(false)
  })
})

describe('registration failure copy', () => {
  it('reports push as unavailable when the device cannot produce a push token', async () => {
    device.platform = 'android'
    device.tokenError = Object.assign(
      new Error('Default FirebaseApp is not initialized'),
      {
        code: 'E_REGISTRATION_FAILED',
      }
    )
    const failure = await reconcileNativeRegistration().catch((error: unknown) => error)
    expect(nativeNotificationFailureKey(failure)).toBe(
      'community.notifications.pushUnavailable'
    )
  })

  it('keeps a transient token service failure retryable', async () => {
    device.tokenError = Object.assign(
      new Error('Error encountered while fetching Expo token'),
      {
        code: 'ERR_NOTIFICATIONS_NETWORK_ERROR',
      }
    )
    const failure = await reconcileNativeRegistration().catch((error: unknown) => error)
    expect(nativeNotificationFailureKey(failure)).toBeUndefined()
  })

  it('reports a binding conflict the client cannot resolve', async () => {
    server.use(
      http.post('*/api/v1/notifications/push-tokens', () =>
        HttpResponse.json(
          {
            statusCode: 409,
            code: 'binding_changed',
            message: 'Installation binding changed.',
          },
          { status: 409 }
        )
      )
    )
    const failure = await reconcileNativeRegistration().catch((error: unknown) => error)
    expect(nativeNotificationFailureKey(failure)).toBe(
      'community.notifications.bindingConflict'
    )
  })
})
