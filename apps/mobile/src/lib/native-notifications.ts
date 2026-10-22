import Constants from 'expo-constants'
import { AppState, Platform } from 'react-native'
// Story 6.5 owner: Expo installation binding and actual OS response lifecycle.
import { communitySyncClient, CommunityNotificationResponses } from '@couture/api-client'
import {
  pushRegistrationSchema,
  communityNotificationDataSchema,
  type RegisterPushTokenInput,
} from '@couture/api-client/contracts/http'
import { z } from 'zod'
import type * as ExpoNotifications from 'expo-notifications'
import type { NotificationResponse, DevicePushToken } from 'expo-notifications'
import { createMobileApiClient } from './api-client'
import { resolveMobileAccessToken } from './mobile-auth'
import {
  beforeNativeLogout,
  nativeSessionIdentity,
  subscribeNativeSession,
} from './native-session'
import { NativeNotificationFailure } from './native-notification-errors'
import { secureSessionStorage } from './secure-session-storage'

const installationKey = 'couturecast.push-installation'
const registrationKey = 'couturecast.push-registration'
const pendingKey = 'couturecast.push-cleanup'
// An earlier build kept the signed-out member's access token here. D5 forbids that, so
// startup purges any value still stored.
const legacyCredentialKey = 'couturecast.push-cleanup-credential'
function notificationProjectId(): string | undefined {
  const extra: unknown = Constants.expoConfig?.extra
  const eas: unknown =
    extra && typeof extra === 'object' && 'eas' in extra ? extra.eas : undefined
  const configured =
    eas &&
    typeof eas === 'object' &&
    'projectId' in eas &&
    typeof eas.projectId === 'string'
      ? eas.projectId
      : undefined
  return Constants.easConfig?.projectId ?? configured
}
const storedBindingSchema = pushRegistrationSchema.extend({ owner: z.string().min(1) })
// Cleanup needs only the ownership fence. Stored bindings also retain platform
// metadata for transfer recovery, including records persisted by older clients.
const pendingBindingSchema = storedBindingSchema
  .pick({ owner: true, registrationId: true, bindingGeneration: true })
  .strip()
type StoredBinding = z.infer<typeof storedBindingSchema>
function readJson(raw: string | null): unknown {
  try {
    return raw ? JSON.parse(raw) : undefined
  } catch {
    return undefined
  }
}
async function readBinding(includePending = false): Promise<StoredBinding | undefined> {
  const secure = await import('expo-secure-store')
  const raw =
    (await secure.getItemAsync(registrationKey)) ??
    (includePending ? await secure.getItemAsync(pendingKey) : null)
  const result = storedBindingSchema.safeParse(readJson(raw))
  return result.success ? result.data : undefined
}
const tokenApi = (token: string, timeout = 5000) =>
  communitySyncClient(createMobileApiClient({ accessToken: token }), undefined, timeout)
async function forgetPending() {
  const secure = await import('expo-secure-store')
  await secure.deleteItemAsync(pendingKey)
}
async function purgeLegacyCredential() {
  // The chunked store also removes any chunks a long token was split into.
  await secureSessionStorage(await import('expo-secure-store')).removeItem(
    legacyCredentialKey
  )
}
async function clearPending(owner: string, client: ReturnType<typeof tokenApi>) {
  const secure = await import('expo-secure-store')
  const pending = pendingBindingSchema.safeParse(
    readJson(await secure.getItemAsync(pendingKey))
  )
  if (!pending.success || pending.data.owner !== owner) return
  await client.remove(pending.data.registrationId, pending.data.bindingGeneration)
  await forgetPending()
}
async function requirePermission(
  notifications: typeof ExpoNotifications,
  previous: StoredBinding | undefined,
  owner: string,
  client: ReturnType<typeof tokenApi>,
  request: boolean,
  current: () => boolean
) {
  let permission = await notifications.getPermissionsAsync()
  if (request && !permission.granted)
    permission = await notifications.requestPermissionsAsync()
  if (permission.granted) return
  if (previous?.owner === owner) {
    await client.remove(previous.registrationId, previous.bindingGeneration)
    if (current()) {
      const secure = await import('expo-secure-store')
      await secure.deleteItemAsync(registrationKey)
    }
  }
  throw new Error('notification_permission_denied')
}
type RegistrationFlight = {
  owner: string
  epoch: number
  promise: Promise<void>
  dirty: boolean
  permission: boolean
  deviceToken?: DevicePushToken
}
let registrationFlight: RegistrationFlight | undefined
// Logout advances the epoch. A registration started under an earlier epoch belongs to a
// signed-out session: whatever it obtains later is never registered or stored for it.
let registrationEpoch = 0
// Logout gives an in-flight registration this long to finish its own fenced cleanup.
const LOGOUT_REGISTRATION_WAIT_MS = 1000
async function registration(
  owner: string,
  epoch: number,
  requestPermission: boolean,
  devicePushToken?: DevicePushToken
): Promise<void> {
  const current = () => epoch === registrationEpoch && nativeSessionIdentity() === owner
  const token = await resolveMobileAccessToken()
  if (!token || !current()) throw new Error('Sign in first.')
  const client = tokenApi(token)
  const [notifications, secure, crypto] = await Promise.all([
    import('expo-notifications'),
    import('expo-secure-store'),
    import('expo-crypto'),
  ])
  if (Platform.OS !== 'ios' && Platform.OS !== 'android')
    throw new NativeNotificationFailure(
      'pushUnavailable',
      'Native notification device required.'
    )
  await clearPending(owner, client)
  const previous = await readBinding(true)
  if (Platform.OS === 'android')
    await notifications.setNotificationChannelAsync('community', {
      name: 'CoutureCast',
      importance: notifications.AndroidImportance.DEFAULT,
    })
  await requirePermission(
    notifications,
    previous,
    owner,
    client,
    requestPermission,
    current
  )
  const projectId = notificationProjectId()
  if (!projectId)
    throw new NativeNotificationFailure(
      'pushUnavailable',
      'Notification project unavailable.'
    )
  const expoToken = await notifications
    .getExpoPushTokenAsync({
      projectId,
      ...(devicePushToken ? { devicePushToken } : {}),
    })
    .catch((error: unknown) => {
      // A network or token-service failure is worth retrying. Anything else means this
      // device cannot produce a push token (for example Android without FCM).
      const code =
        error && typeof error === 'object' && 'code' in error ? error.code : undefined
      if (
        code === 'ERR_NOTIFICATIONS_NETWORK_ERROR' ||
        code === 'ERR_NOTIFICATIONS_SERVER_ERROR'
      )
        throw error
      throw new NativeNotificationFailure(
        'pushUnavailable',
        'Push notifications are not available on this device.',
        error
      )
    })
  let installationId = await secure.getItemAsync(installationKey)
  if (!installationId) {
    installationId = crypto.randomUUID()
    await secure.setItemAsync(installationKey, installationId)
  }
  if (!current()) return
  const input = {
    token: expoToken.data,
    installationId,
    platform: Platform.OS,
    permission: 'granted',
    ...(previous
      ? {
          expectedBinding: {
            registrationId: previous.registrationId,
            bindingGeneration: previous.bindingGeneration,
          },
          transfer: previous.owner !== owner,
        }
      : {}),
  } as const
  const bound = await registerBinding(client, owner, previous, input, current, () =>
    secure.deleteItemAsync(registrationKey)
  ).catch(async (error: unknown) => {
    throw (await bindingConflict(error))
      ? new NativeNotificationFailure(
          'bindingConflict',
          'Notification binding changed.',
          error
        )
      : error
  })
  if (!bound) return
  const stored = { ...bound, owner }
  if (!current()) {
    await secure.setItemAsync(pendingKey, JSON.stringify(stored))
    await client.remove(bound.registrationId, bound.bindingGeneration)
    await forgetPending()
    return
  }
  await secure.setItemAsync(registrationKey, JSON.stringify(stored))
  // A successful explicit transfer also completes an old owner's pending cleanup.
  await forgetPending()
}
async function bindingConflict(error: unknown) {
  const response =
    error && typeof error === 'object' && 'response' in error ? error.response : undefined
  if (!(response instanceof Response) || response.status !== 409) return false
  const body: unknown = await response
    .clone()
    .json()
    .catch(() => undefined)
  return Boolean(
    body && typeof body === 'object' && 'code' in body && body.code === 'binding_changed'
  )
}
async function registerBinding(
  client: ReturnType<typeof tokenApi>,
  owner: string,
  previous: StoredBinding | undefined,
  input: RegisterPushTokenInput,
  current: () => boolean,
  forgetStale: () => Promise<void>
) {
  let bound
  try {
    bound = await client.register(input)
  } catch (error) {
    if (!previous || !(await bindingConflict(error))) throw error
    const fresh = {
      token: input.token,
      installationId: input.installationId,
      platform: input.platform,
      permission: input.permission,
    }
    if (previous.owner !== owner) {
      // The previous owner's binding no longer exists as remembered (receipt cleanup or
      // retention pruned it), so the transfer cannot match. Forget it and register fresh.
      // The server still refuses a token that is live for another owner without a valid
      // transfer, so this never takes over someone else's binding.
      await forgetStale()
      return client.register(fresh)
    }
    const { registrations } = await client.registrations()
    if (!current()) return
    const listed = registrations.find(
      (row) => row.registrationId === previous.registrationId
    )
    // Listing proves only this owner's bindings. A concurrent transfer remains rejected by the server.
    bound = await client.register({
      ...fresh,
      ...(listed
        ? {
            expectedBinding: {
              registrationId: listed.registrationId,
              bindingGeneration: listed.bindingGeneration,
            },
          }
        : {}),
    })
  }
  return bound
}

export async function reconcileNativeRegistration(
  requestPermission = false,
  deviceToken?: DevicePushToken
): Promise<void> {
  const owner = nativeSessionIdentity()
  if (!owner) throw new Error('Sign in first.')
  // A flight from before a logout is fenced and never writes, so nothing waits on it.
  if (registrationFlight?.epoch === registrationEpoch) {
    const existing = registrationFlight
    if (existing.owner === owner) {
      if (requestPermission && !existing.permission) {
        existing.permission = true
        existing.dirty = true
      }
      if (deviceToken) {
        existing.deviceToken = deviceToken
        existing.dirty = true
      }
      return existing.promise
    }
    await existing.promise.catch(() => undefined)
    return reconcileNativeRegistration(requestPermission, deviceToken)
  }
  const flight: RegistrationFlight = {
    owner,
    epoch: registrationEpoch,
    promise: Promise.resolve(),
    dirty: true,
    permission: requestPermission,
    ...(deviceToken ? { deviceToken } : {}),
  }
  registrationFlight = flight
  flight.promise = (async () => {
    do {
      flight.dirty = false
      try {
        await registration(owner, flight.epoch, flight.permission, flight.deviceToken)
      } catch (error) {
        if (!flight.dirty) throw error
      }
    } while (
      flight.dirty &&
      flight.epoch === registrationEpoch &&
      nativeSessionIdentity() === owner
    )
  })().finally(() => {
    if (registrationFlight === flight) registrationFlight = undefined
  })
  return flight.promise
}
export async function enableNativeCommunityNotifications() {
  const owner = nativeSessionIdentity()
  if (!owner) throw new Error('Sign in first.')
  await reconcileNativeRegistration(true)
  const token = await resolveMobileAccessToken()
  const binding = await readBinding()
  if (
    !token ||
    nativeSessionIdentity() !== owner ||
    binding?.owner !== owner ||
    binding.permission !== 'granted'
  )
    throw new Error('Notification account changed.')
  const client = tokenApi(token)
  const settings = await client.preferences()
  if (nativeSessionIdentity() !== owner) throw new Error('Notification account changed.')
  const result = await client.patchPreferences({
    baseRevision: settings.revision,
    enabled: true,
  })
  if (nativeSessionIdentity() !== owner) throw new Error('Notification account changed.')
  return result
}
/**
 * Logout makes one bounded removal attempt with the session it is ending (D5). When that
 * attempt fails (for example offline), only the opaque pending registration is kept; no
 * credential outlives the logout, so network restoration alone never authenticates a
 * deletion.
 *
 * Residual window: the device can keep receiving the signed-out member's notifications
 * until that member signs in again on this device (`clearPending`), another member's
 * sign-in transfers the installation explicitly, or the 30-day inactive-binding retention
 * removes the binding.
 */
async function unbind(accessToken?: string) {
  registrationEpoch++
  const flight = registrationFlight?.promise.catch(() => undefined)
  // Bounded: a registration stalled on the OS push token cannot hold logout open.
  if (flight) {
    let timer: ReturnType<typeof setTimeout> | undefined
    await Promise.race([
      flight,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, LOGOUT_REGISTRATION_WAIT_MS)
      }),
    ])
    clearTimeout(timer)
  }
  const secure = await import('expo-secure-store')
  try {
    const value = await readBinding()
    if (!value) return
    // Best effort: a keychain failure must not stop the removal attempt below.
    await secure.setItemAsync(pendingKey, JSON.stringify(value)).catch(() => undefined)
    if (!accessToken) return
    await tokenApi(accessToken, 2000).remove(
      value.registrationId,
      value.bindingGeneration
    )
    await forgetPending()
  } finally {
    // Defense in depth: the signed-out member's record never outlives the logout, even
    // when it is unreadable or the cleanup record could not be written.
    await secure.deleteItemAsync(registrationKey)
  }
}
export async function startNativeNotifications(options: {
  ready: () => boolean
  subscribeReady?: (listener: () => void) => () => void
  open: (params: {
    source: 'notification'
    type: 'community'
    cardId: string
    commentId?: string
    parentId?: string
    expiresAt?: string
  }) => void
}): Promise<() => void> {
  const notifications = await import('expo-notifications')
  notifications.setNotificationHandler({
    handleNotification: (notification) => {
      const community = communityNotificationDataSchema.safeParse(
        notification.request.content.data
      ).success
      return Promise.resolve({
        shouldShowBanner: community,
        shouldShowList: community,
        shouldPlaySound: false,
        shouldSetBadge: false,
      })
    },
  })
  let stopped = false
  const responses = new CommunityNotificationResponses({
    ready: () => !stopped && options.ready() && Boolean(nativeSessionIdentity()),
    open: options.open,
    consumed: () => {
      void notifications.clearLastNotificationResponseAsync().catch(() => undefined)
    },
  })
  const drain = () => responses.drain()
  const receive = (response: NotificationResponse) => {
    responses.receive(
      response.notification.request.content.data,
      response.actionIdentifier
    )
  }
  const responseListener = notifications.addNotificationResponseReceivedListener(receive)
  const tokenListener = notifications.addPushTokenListener((token) => {
    if (stopped) return
    void reconcileNativeRegistration(false, token).catch(() => undefined)
  })
  const auth = subscribeNativeSession(() => {
    if (stopped) return
    drain()
    if (nativeSessionIdentity()) void reconcileNativeRegistration().catch(() => undefined)
  })
  const logout = beforeNativeLogout(unbind)
  const readiness = options.subscribeReady?.(drain)
  const lifecycle = AppState.addEventListener('change', (state) => {
    if (!stopped && state === 'active') {
      drain()
      void reconcileNativeRegistration().catch(() => undefined)
    }
  })
  const cleanup = () => {
    stopped = true
    responses.stop()
    notifications.setNotificationHandler(null)
    responseListener.remove()
    tokenListener.remove()
    auth()
    logout()
    lifecycle.remove()
    readiness?.()
  }
  void purgeLegacyCredential().catch(() => undefined)
  if (nativeSessionIdentity()) void reconcileNativeRegistration().catch(() => undefined)
  try {
    const startup = await notifications.getLastNotificationResponseAsync()
    if (startup) receive(startup)
    drain()
    return cleanup
  } catch (error) {
    cleanup()
    throw error
  }
}
