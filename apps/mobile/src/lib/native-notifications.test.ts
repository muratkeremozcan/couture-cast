// Learning path Step 43: Realtime engagement and push notifications.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-43-realtime-engagement-and-push-notifications
// Story 6.5 native boundaries are controlled; registration/preferences use actual HTTP wrappers.
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
import {
  enableNativeCommunityNotifications,
  reconcileNativeRegistration,
  startNativeNotifications,
} from './native-notifications'
let patches = 0
let registrations = 0
beforeEach(() => {
  device.platform = 'ios'
  device.startup = null
  device.startupError = false
  device.handler = undefined
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

const binding = (owner = 'member-a') => ({
  owner,
  registrationId: 'owned-registration',
  bindingGeneration: 4,
  platform: 'ios',
  permission: 'granted',
  lastUsedAt: new Date().toISOString(),
})
const notificationData = () => ({
  version: 1,
  notificationId: '63100000-0000-4000-8000-000000000004',
  source: 'notification',
  type: 'community',
  cardId: 'post-fixture',
  expiresAt: new Date(Date.now() + 60000).toISOString(),
})
const responseFor = (data: unknown) =>
  ({
    actionIdentifier: 'default',
    notification: { request: { content: { data } } },
  }) as NotificationResponse

describe('native OS response, cleanup and revocation boundaries', () => {
  it('buffers cold response until authenticated readiness, deduplicates and detaches every listener', async () => {
    device.owner = null
    device.startup = responseFor(notificationData())
    let ready = false
    let drain!: () => void
    const removeReady = vi.fn(),
      open = vi.fn()
    const close = await startNativeNotifications({
      ready: () => ready,
      open,
      subscribeReady: (fn) => {
        drain = fn
        return removeReady
      },
    })
    expect(open).not.toHaveBeenCalled()
    expect(
      await device.handler!.handleNotification(device.startup.notification)
    ).toMatchObject({ shouldShowBanner: true, shouldPlaySound: false })
    expect(
      await device.handler!.handleNotification(
        responseFor({ arbitrary: true }).notification
      )
    ).toMatchObject({ shouldShowBanner: false })
    device.owner = 'member-a'
    ready = true
    drain()
    expect(open).toHaveBeenCalledWith(device.startup.notification.request.content.data)
    device.response!(device.startup)
    expect(open).toHaveBeenCalledTimes(1)
    expect(device.clearResponse).toHaveBeenCalledTimes(1)
    close()
    expect(device.handler).toBeNull()
    expect(device.removals).toHaveBeenCalledTimes(5)
    expect(removeReady).toHaveBeenCalledTimes(1)
    device.rotation!({ type: 'ios', data: 'late' })
    device.auth!()
    device.lifecycle!('active')
    drain()
    device.response!(
      responseFor({
        ...notificationData(),
        notificationId: '63100000-0000-4000-8000-000000000005',
      })
    )
    expect(open).toHaveBeenCalledTimes(1)
    expect(registrations).toBe(0)
  })
  it('cleans up partial response startup failure', async () => {
    device.owner = null
    device.startupError = true
    await expect(
      startNativeNotifications({ ready: () => true, open: vi.fn() })
    ).rejects.toThrow('startup unavailable')
    expect(device.removals).toHaveBeenCalledTimes(5)
    expect(device.handler).toBeNull()
  })
  it('reconciles on foreground and owner notification, while background does no registration', async () => {
    device.owner = null
    const close = await startNativeNotifications({ ready: () => true, open: vi.fn() })
    try {
      device.lifecycle!('background')
      expect(registrations).toBe(0)
      device.owner = 'member-a'
      device.auth!()
      await reconcileNativeRegistration()
      expect(registrations).toBe(1)
      device.lifecycle!('active')
      await reconcileNativeRegistration()
      expect(registrations).toBe(2)
    } finally {
      close()
    }
  })
  it('revokes only the recorded binding generation when OS permission disappears', async () => {
    device.storage.set('couturecast.push-registration', JSON.stringify(binding()))
    device.granted = false
    const removed: unknown[] = []
    server.use(
      http.delete('*/api/v1/notifications/push-tokens/:id', ({ request, params }) => {
        removed.push({
          id: params.id,
          body: {
            bindingGeneration: Number(
              new URL(request.url).searchParams.get('bindingGeneration')
            ),
          },
        })
        return HttpResponse.json({ data: { removed: true } })
      })
    )
    await expect(reconcileNativeRegistration()).rejects.toThrow(
      'notification_permission_denied'
    )
    expect(removed).toEqual([
      { id: 'owned-registration', body: { bindingGeneration: 4 } },
    ])
    expect(device.storage.has('couturecast.push-registration')).toBe(false)
    expect(registrations).toBe(0)
  })
  it('keeps failed logout cleanup durable and retries it before a new binding', async () => {
    device.owner = null
    const close = await startNativeNotifications({ ready: () => true, open: vi.fn() })
    device.storage.set('couturecast.push-registration', JSON.stringify(binding()))
    let attempts = 0
    server.use(
      http.delete('*/api/v1/notifications/push-tokens/:id', () => {
        attempts++
        return attempts === 1
          ? HttpResponse.json({}, { status: 503 })
          : HttpResponse.json({ data: { removed: true } })
      })
    )
    try {
      await expect(device.logout!('captured-fixture-token')).rejects.toThrow()
      expect(device.storage.has('couturecast.push-registration')).toBe(false)
      expect(JSON.parse(device.storage.get('couturecast.push-cleanup')!)).toMatchObject({
        owner: 'member-a',
        bindingGeneration: 4,
      })
      device.owner = 'member-a'
      await reconcileNativeRegistration()
      expect(attempts).toBe(2)
      expect(registrations).toBe(1)
      expect(device.storage.has('couturecast.push-cleanup')).toBe(false)
    } finally {
      close()
    }
  })
  it('retains cleanup without a logout bearer and permits explicit transfer by the new owner', async () => {
    device.owner = null
    const close = await startNativeNotifications({ ready: () => true, open: vi.fn() })
    device.storage.set('couturecast.push-registration', JSON.stringify(binding()))
    const bodies: unknown[] = []
    server.use(
      http.post('*/api/v1/notifications/push-tokens', async ({ request }) => {
        bodies.push(await request.json())
        const { owner, ...publicBinding } = binding('member-b')
        expect(owner).toBe(device.owner)
        return HttpResponse.json({ data: publicBinding })
      })
    )
    try {
      await device.logout!()
      expect(device.storage.has('couturecast.push-cleanup')).toBe(true)
      device.owner = 'member-b'
      await reconcileNativeRegistration()
      expect(bodies).toEqual([
        expect.objectContaining({
          transfer: true,
          expectedBinding: { registrationId: 'owned-registration', bindingGeneration: 4 },
        }),
      ])
      expect(
        JSON.parse(device.storage.get('couturecast.push-registration')!)
      ).toMatchObject({ owner: 'member-b' })
      expect(device.storage.has('couturecast.push-cleanup')).toBe(false)
    } finally {
      close()
    }
  })
  it('creates Android channel and rejects nonnative registration before HTTP', async () => {
    device.platform = 'web'
    await expect(reconcileNativeRegistration()).rejects.toThrow(
      'Native notification device required.'
    )
    expect(registrations).toBe(0)
    device.platform = 'android'
    await reconcileNativeRegistration()
    expect(device.channel).toHaveBeenCalledWith('community', {
      name: 'CoutureCast',
      importance: 3,
    })
    expect(registrations).toBe(1)
  })
})

it('keeps response navigation available during OS registration failures and recovers on permission restoration', async () => {
  device.granted = false
  device.startup = responseFor(notificationData())
  device.clearResponse.mockRejectedValueOnce(new Error('OS response storage unavailable'))
  const open = vi.fn()
  const close = await startNativeNotifications({ ready: () => true, open })
  try {
    await expect(reconcileNativeRegistration()).rejects.toThrow(
      'notification_permission_denied'
    )
    expect(open).toHaveBeenCalledTimes(1)
    expect(device.clearResponse).toHaveBeenCalledTimes(1)
    device.rotation!({ type: 'ios', data: 'denied-token' })
    await expect(reconcileNativeRegistration()).rejects.toThrow(
      'notification_permission_denied'
    )
    device.auth!()
    await expect(reconcileNativeRegistration()).rejects.toThrow(
      'notification_permission_denied'
    )
    device.lifecycle!('active')
    await expect(reconcileNativeRegistration()).rejects.toThrow(
      'notification_permission_denied'
    )
    expect(registrations).toBe(0)
    device.granted = true
    await reconcileNativeRegistration()
    expect(registrations).toBe(1)
    device.response!(device.startup)
    expect(open).toHaveBeenCalledTimes(1)
  } finally {
    close()
  }
})
