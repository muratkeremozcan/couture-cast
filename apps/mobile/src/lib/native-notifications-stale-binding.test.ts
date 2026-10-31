// Learning path Step 43: Realtime engagement and push notifications.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-43-realtime-engagement-and-push-notifications
// Story 6.5: a stale local binding from a previous owner never blocks the next owner's
// registration. Native boundaries are controlled; registration uses the actual HTTP wrappers.
import { http, HttpResponse } from 'msw'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  NotificationResponse,
  Notification,
  DevicePushToken,
  ExpoPushTokenOptions,
} from 'expo-notifications'
import { server } from '../test-utils/msw/server'
const device = vi.hoisted(() => ({
  owner: 'member-a' as string | null,
  granted: true,
  transferDuringToken: false,
  storage: new Map<string, string>(),
  tokenDelay: 0,
  tokenHook: undefined as
    | ((options: ExpoPushTokenOptions) => Promise<{ data: string }>)
    | undefined,
  rotation: undefined as ((token: DevicePushToken) => void) | undefined,
  permissionHook: undefined as (() => Promise<{ granted: boolean }>) | undefined,
  requestGranted: false,
  requests: 0,
  platform: 'ios',
  handler: undefined as
    | undefined
    | { handleNotification: (notification: Notification) => Promise<unknown> },
  response: undefined as undefined | ((value: NotificationResponse) => void),
  startup: null as NotificationResponse | null,
  startupError: false,
  lifecycle: undefined as undefined | ((state: string) => void),
  auth: undefined as undefined | (() => void),
  logout: undefined as undefined | ((token?: string) => Promise<void>),
  removals: vi.fn(),
  clearResponse: vi.fn().mockResolvedValue(undefined),
  channel: vi.fn().mockResolvedValue(undefined),
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
  setNotificationHandler: (value: typeof device.handler) => {
    device.handler = value
  },
  addNotificationResponseReceivedListener: (callback: typeof device.response) => {
    device.response = callback
    return { remove: device.removals }
  },
  setNotificationChannelAsync: device.channel,
  AndroidImportance: { DEFAULT: 3 },
  addPushTokenListener: (callback: (token: DevicePushToken) => void) => {
    device.rotation = callback
    return { remove: device.removals }
  },
  getLastNotificationResponseAsync: () =>
    device.startupError
      ? Promise.reject(new Error('startup unavailable'))
      : Promise.resolve(device.startup),
  clearLastNotificationResponseAsync: device.clearResponse,
  getPermissionsAsync: () =>
    device.permissionHook?.() ?? Promise.resolve({ granted: device.granted }),
  requestPermissionsAsync: () => {
    device.requests++
    return Promise.resolve({ granted: device.granted || device.requestGranted })
  },
  getExpoPushTokenAsync: async (options: ExpoPushTokenOptions) => {
    if (device.tokenHook) return device.tokenHook(options)
    if (device.tokenDelay)
      await new Promise((resolve) => setTimeout(resolve, device.tokenDelay))
    if (device.transferDuringToken) device.owner = 'member-b'
    return Promise.resolve({ data: 'ExpoPushToken[synthetic_local_device]' })
  },
}))
vi.mock('./native-session', () => ({
  nativeSessionIdentity: () => device.owner,
  subscribeNativeSession: (callback: () => void) => {
    device.auth = callback
    return device.removals
  },
  beforeNativeLogout: (callback: typeof device.logout) => {
    device.logout = callback
    return device.removals
  },
}))
vi.mock('./mobile-auth', () => ({
  resolveMobileAccessToken: () => Promise.resolve(`fixture-${device.owner}`),
}))
import { reconcileNativeRegistration } from './native-notifications'

type RegisterBody = {
  token: string
  installationId: string
  expectedBinding?: { registrationId: string; bindingGeneration: number }
  transfer?: boolean
}
const STALE = {
  registrationId: '63100000-0000-4000-8000-0000000000aa',
  bindingGeneration: 3,
  platform: 'ios',
  permission: 'granted',
  lastUsedAt: '2026-10-01T00:00:00.000Z',
  owner: 'member-a',
}
const binding = (registrationId: string) => ({
  registrationId,
  bindingGeneration: 1,
  platform: 'ios',
  permission: 'granted',
  lastUsedAt: new Date().toISOString(),
})
const conflict = () =>
  HttpResponse.json(
    {
      statusCode: 409,
      code: 'binding_changed',
      message: 'Installation binding changed.',
    },
    { status: 409 }
  )

beforeEach(() => {
  device.platform = 'ios'
  device.granted = true
  device.storage.clear()
  process.env.EXPO_PUBLIC_API_BASE_URL = window.location.origin
})

describe('cross-owner stale binding recovery', () => {
  it('drops a pruned previous-owner binding and registers the new owner fresh', async () => {
    const bodies: RegisterBody[] = []
    // The previous owner's row was pruned server-side (receipt cleanup or retention), so
    // the expected binding no longer exists; a fresh registration has nothing to take over.
    server.use(
      http.post('*/api/v1/notifications/push-tokens', async ({ request }) => {
        const body = (await request.json()) as RegisterBody
        bodies.push(body)
        if (body.expectedBinding || body.transfer) return conflict()
        return HttpResponse.json({
          data: binding('63100000-0000-4000-8000-0000000000bb'),
        })
      })
    )
    device.storage.set('couturecast.push-registration', JSON.stringify(STALE))
    device.owner = 'member-b'
    await reconcileNativeRegistration()
    expect(bodies).toHaveLength(2)
    expect(bodies[0]).toMatchObject({
      expectedBinding: { registrationId: STALE.registrationId, bindingGeneration: 3 },
      transfer: true,
    })
    expect(bodies[1]).not.toHaveProperty('expectedBinding')
    expect(bodies[1]).not.toHaveProperty('transfer')
    expect(
      JSON.parse(device.storage.get('couturecast.push-registration')!)
    ).toMatchObject({
      registrationId: '63100000-0000-4000-8000-0000000000bb',
      owner: 'member-b',
    })
  })

  it('still fails, leaving no new local binding, when the token is live for another owner', async () => {
    let calls = 0
    // The server refuses an implicit transfer of a live binding with or without expectation.
    server.use(
      http.post('*/api/v1/notifications/push-tokens', () => {
        calls++
        return conflict()
      })
    )
    device.storage.set('couturecast.push-registration', JSON.stringify(STALE))
    device.owner = 'member-b'
    await expect(reconcileNativeRegistration()).rejects.toThrow()
    expect(calls).toBe(2)
    const stored = device.storage.get('couturecast.push-registration')
    expect(stored === undefined || JSON.parse(stored).owner !== 'member-b').toBe(true)
  })
})
