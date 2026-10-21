// Story 6.5 native boundaries are controlled; registration/preferences use actual HTTP wrappers.
import { http, HttpResponse } from 'msw'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DevicePushToken, ExpoPushTokenOptions } from 'expo-notifications'
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
}))
vi.mock('expo-constants', () => ({
  default: { easConfig: { projectId: 'isolated-test-project' } },
}))
vi.mock('react-native', () => ({
  Platform: { OS: 'ios' },
  AppState: { addEventListener: () => ({ remove: vi.fn() }) },
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
  setNotificationHandler: vi.fn(),
  addNotificationResponseReceivedListener: () => ({ remove: vi.fn() }),
  addPushTokenListener: (callback: (token: DevicePushToken) => void) => {
    device.rotation = callback
    return { remove: vi.fn() }
  },
  getLastNotificationResponseAsync: () => Promise.resolve(null),
  clearLastNotificationResponseAsync: () => Promise.resolve(),
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
  subscribeNativeSession: () => vi.fn(),
  beforeNativeLogout: () => vi.fn(),
}))
vi.mock('./mobile-auth', () => ({
  resolveMobileAccessToken: () => Promise.resolve(`fixture-${device.owner}`),
}))
import {
  enableNativeCommunityNotifications,
  reconcileNativeRegistration,
  startNativeNotifications,
} from './native-notifications'
let patches = 0
let registrations = 0
beforeEach(() => {
  device.owner = 'member-a'
  device.granted = true
  device.transferDuringToken = false
  device.storage.clear()
  device.tokenDelay = 0
  device.tokenHook = undefined
  device.rotation = undefined
  device.permissionHook = undefined
  device.requestGranted = false
  device.requests = 0
  patches = 0
  registrations = 0
  process.env.EXPO_PUBLIC_API_BASE_URL = window.location.origin
  const settings = {
    enabled: false,
    pushEnabled: true,
    quietHoursEnabled: false,
    quietHoursStart: '22:00',
    quietHoursEnd: '07:00',
    timezone: 'UTC',
    revision: 'owned-settings',
  }
  server.use(
    http.post('*/api/v1/notifications/push-tokens', () => {
      registrations++
      return HttpResponse.json({
        data: {
          registrationId: '63100000-0000-4000-8000-000000000002',
          bindingGeneration: 1,
          platform: 'ios',
          permission: 'granted',
          lastUsedAt: new Date().toISOString(),
        },
      })
    }),
    http.get('*/api/v1/community/notification-preferences', () =>
      HttpResponse.json({ data: settings })
    ),
    http.patch('*/api/v1/community/notification-preferences', () => {
      patches++
      return HttpResponse.json({ data: { ...settings, enabled: true } })
    })
  )
})
describe('native permission and binding enablement', () => {
  it('R10 escalates an enable request joined to background permission work', async () => {
    device.granted = false
    device.requestGranted = true
    let release!: (value: { granted: boolean }) => void
    device.permissionHook = () => {
      device.permissionHook = undefined
      return new Promise((resolve) => {
        release = resolve
      })
    }
    const background = reconcileNativeRegistration()
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    const enabling = enableNativeCommunityNotifications()
    release({ granted: false })
    await background
    await enabling
    expect(device.requests).toBe(1)
    expect(patches).toBe(1)
  })
  it('R10 initially reconciles and drains the latest delivered native rotation after an older flight', async () => {
    let release!: (value: { data: string }) => void
    const options: ExpoPushTokenOptions[] = []
    device.tokenHook = (value) => {
      options.push(value)
      if (options.length === 1)
        return new Promise((resolve) => {
          release = resolve
        })
      return Promise.resolve({ data: 'ExpoPushToken[rotated_local_device]' })
    }
    const bound: string[] = []
    server.use(
      http.post('*/api/v1/notifications/push-tokens', async ({ request }) => {
        const body = (await request.json()) as { token: string }
        bound.push(body.token)
        return HttpResponse.json({
          data: {
            registrationId: '63100000-0000-4000-8000-000000000002',
            bindingGeneration: bound.length,
            platform: 'ios',
            permission: 'granted',
            lastUsedAt: new Date().toISOString(),
          },
        })
      })
    )
    const close = await startNativeNotifications({ ready: () => true, open: vi.fn() })
    try {
      await vi.waitFor(() => expect(release).toBeTypeOf('function'))
      const delivered: DevicePushToken = { type: 'ios', data: 'new-native-token' }
      device.rotation!(delivered)
      const flight = reconcileNativeRegistration()
      release({ data: 'ExpoPushToken[older_local_device]' })
      await flight
      expect(options).toHaveLength(2)
      expect(options[1]?.devicePushToken).toEqual(delivered)
      expect(bound).toEqual([
        'ExpoPushToken[older_local_device]',
        'ExpoPushToken[rotated_local_device]',
      ])
    } finally {
      close()
    }
  })
  it('R10 gives HTTP a fresh deadline after slow OS token work', async () => {
    device.tokenDelay = 5100
    expect((await enableNativeCommunityNotifications()).enabled).toBe(true)
    expect(registrations).toBe(1)
  }, 10000)
  it('R10 reconciles a server-pruned binding through the authenticated listing before retry', async () => {
    device.storage.set(
      'couturecast.push-registration',
      JSON.stringify({
        owner: 'member-a',
        registrationId: 'stale-owned-binding',
        bindingGeneration: 3,
        platform: 'ios',
        permission: 'granted',
        lastUsedAt: new Date().toISOString(),
      })
    )
    const bodies: Record<string, unknown>[] = []
    let lists = 0
    server.use(
      http.get('*/api/v1/notifications/push-tokens', () => {
        lists++
        return HttpResponse.json({ data: { registrations: [] } })
      }),
      http.post('*/api/v1/notifications/push-tokens', async ({ request }) => {
        bodies.push((await request.json()) as Record<string, unknown>)
        return bodies.length === 1
          ? HttpResponse.json({ code: 'binding_changed' }, { status: 409 })
          : HttpResponse.json({
              data: {
                registrationId: 'fresh-owned-binding',
                bindingGeneration: 1,
                platform: 'ios',
                permission: 'granted',
                lastUsedAt: new Date().toISOString(),
              },
            })
      })
    )
    await enableNativeCommunityNotifications()
    expect(lists).toBe(1)
    expect(bodies).toHaveLength(2)
    expect(bodies[0]).toMatchObject({
      expectedBinding: { registrationId: 'stale-owned-binding', bindingGeneration: 3 },
    })
    expect(bodies[1]?.expectedBinding).toBeUndefined()
    expect(bodies[1]?.transfer).toBeUndefined()
  })
  it('keeps opt-in off when OS permission is denied', async () => {
    device.granted = false
    await expect(enableNativeCommunityNotifications()).rejects.toThrow(
      'notification_permission_denied'
    )
    expect(registrations).toBe(0)
    expect(patches).toBe(0)
  })
  it('fences a switch while the OS token request is outstanding', async () => {
    device.transferDuringToken = true
    await expect(enableNativeCommunityNotifications()).rejects.toThrow()
    expect(registrations).toBe(0)
    expect(patches).toBe(0)
  })
  it('enables only after successful registration for the same canonical owner', async () => {
    expect((await enableNativeCommunityNotifications()).enabled).toBe(true)
    expect(registrations).toBe(1)
    expect(patches).toBe(1)
    expect(
      JSON.parse(device.storage.get('couturecast.push-registration')!)
    ).toMatchObject({ owner: 'member-a', bindingGeneration: 1 })
  })
})
