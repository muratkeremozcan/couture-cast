// Story 6.5 (D5 privacy): a logout that cannot reach the API keeps only the opaque pending
// registration. No credential outlives the logout, and network restoration alone never
// authenticates a deletion; cleanup waits for the owner to sign in again, an explicit
// transfer on the next sign-in, or inactive-binding expiry. Native boundaries are
// controlled; removal and registration use the actual HTTP wrappers.
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
  it('keeps only the opaque pending registration and no credential', async () => {
    await offlineLogout()
    expect(device.storage.has(registrationKey)).toBe(false)
    expect(JSON.parse(device.storage.get(pendingKey)!)).toMatchObject({
      owner: 'member-a',
      registrationId: stored.registrationId,
      bindingGeneration: stored.bindingGeneration,
    })
    expect(
      [...device.storage.values()].some((value) => value.includes('captured-token-a'))
    ).toBe(false)
  })

  it('sends no deletion on restart or foreground without reauthentication', async () => {
    await offlineLogout()
    const before = removals.length
    answer = () => removed(true)
    close = await startNativeNotifications({ ready: () => true, open: vi.fn() })
    device.lifecycle!('active')
    await settle()
    expect(removals).toHaveLength(before)
    expect(device.storage.has(pendingKey)).toBe(true)
  })

  it('purges a credential an earlier build retained, without sending it', async () => {
    device.owner = null
    device.storage.set(pendingKey, JSON.stringify(stored))
    device.storage.set(
      credentialKey,
      JSON.stringify({ owner: 'member-a', accessToken: 'captured-token-a' })
    )
    close = await startNativeNotifications({ ready: () => true, open: vi.fn() })
    await vi.waitFor(() => expect(device.storage.has(credentialKey)).toBe(false))
    device.lifecycle!('active')
    await settle()
    expect(removals).toHaveLength(0)
    expect(device.storage.has(pendingKey)).toBe(true)
  })

  it('removes the pending registration once its owner signs in again', async () => {
    await offlineLogout()
    answer = () => removed(true)
    server.use(
      http.post('*/api/v1/notifications/push-tokens', () =>
        HttpResponse.json({
          data: {
            ...stored,
            owner: undefined,
            registrationId: '63100000-0000-4000-8000-0000000000bb',
          },
        })
      )
    )
    device.owner = 'member-a'
    await reconcileNativeRegistration()
    expect(removals.at(-1)).toEqual({
      id: stored.registrationId,
      bearer: 'Bearer fixture-member-a',
    })
    expect(device.storage.has(pendingKey)).toBe(false)
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
