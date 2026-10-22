import { withRequestDeadline } from '@couture/api-client'
// Story 6.5 owner: secure Supabase restore/refresh and API-resolved application identity.
import {
  createClient,
  processLock,
  type Session,
  type SupabaseClient,
} from '@supabase/supabase-js'
import Constants from 'expo-constants'
import { AppState } from 'react-native'
import { userProfileResponseSchema } from '@couture/api-client/contracts/http'
import { createMobileApiClient } from './api-client'
import { setMobileAccessTokenResolver, setMobileApplicationUserId } from './mobile-auth'
import { secureSessionStorage } from './secure-session-storage'
import { codeRejected, NativeSignInError } from './native-signin-error'

let clientPromise: Promise<SupabaseClient> | undefined
let session: Session | null = null
let member: string | null = null
let verifiedAccessToken: string | null = null
let generation = 0
type VerificationFlight = {
  principal: string
  token: string
  generation: number
  promise: Promise<void>
}
let verification: VerificationFlight | undefined
let localSignedOut = false
const authStorageKey = 'couturecast.auth-session'
const listeners = new Set<() => void>()
const logoutHooks = new Set<(token?: string) => Promise<void>>()
// Logout cleanup hooks get at most this long before sign-out returns.
const LOGOUT_HOOK_DEADLINE_MS = 3500
const emit = () => listeners.forEach((fn) => fn())
export const nativeSessionIdentity = () => member
export const subscribeNativeSession = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
export const beforeNativeLogout = (hook: (token?: string) => Promise<void>) => {
  logoutHooks.add(hook)
  return () => {
    logoutHooks.delete(hook)
  }
}

export function nativeSupabase(): Promise<SupabaseClient> {
  clientPromise ??= (async () => {
    const secure = await import('expo-secure-store')
    const extra: unknown = Constants.expoConfig?.extra
    const config = extra && typeof extra === 'object' ? extra : {}
    const url =
      process.env.EXPO_PUBLIC_SUPABASE_URL ??
      ('supabaseUrl' in config && typeof config.supabaseUrl === 'string'
        ? config.supabaseUrl
        : '')
    const key =
      process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ??
      ('supabaseAnonKey' in config && typeof config.supabaseAnonKey === 'string'
        ? config.supabaseAnonKey
        : '')
    if (!url || !key) throw new Error('Sign-in is unavailable.')
    return createClient(url, key, {
      auth: {
        storageKey: authStorageKey,
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        lock: processLock,
        // Sessions routinely exceed SecureStore's 2048-byte value limit; see the module.
        storage: secureSessionStorage(secure),
      },
    })
  })()
  return clientPromise
}
function requireBearerLifetime(session: Session) {
  // The HTTP attempt can consume five seconds. SDK refresh failure may return a
  // still-valid stored JWT inside that window. Keep the session for retry.
  if (session.expires_at !== undefined && session.expires_at * 1000 - Date.now() <= 5000)
    throw new Error('Session verification is unavailable.')
}
function sessionDenied(error: unknown) {
  const response: unknown =
    error && typeof error === 'object' && 'response' in error ? error.response : undefined
  return response instanceof Response && [401, 403, 404].includes(response.status)
}
function acceptSession(next: Session | null): Promise<void> {
  const current = verification
  if (
    next &&
    current &&
    current.generation === generation &&
    current.principal === next.user.id &&
    current.token === next.access_token
  )
    return current.promise
  const promise = verifySession(next)
  if (!next) {
    verification = undefined
    return promise
  }
  const flight: VerificationFlight = {
    principal: next.user.id,
    token: next.access_token,
    generation,
    promise,
  }
  flight.promise = promise.finally(() => {
    if (verification === flight) verification = undefined
  })
  verification = flight
  return flight.promise
}
async function verifySession(next: Session | null) {
  const request = ++generation
  const previousMember = member
  const changedPrincipal = session?.user.id !== next?.user.id
  session = next
  if (changedPrincipal) {
    member = null
    verifiedAccessToken = null
    setMobileApplicationUserId(null)
    emit()
  }
  if (!next) {
    member = null
    verifiedAccessToken = null
    setMobileApplicationUserId(null)
    emit()
    return
  }
  try {
    requireBearerLifetime(next)
    const result = await withRequestDeadline(5000, [], (signal) =>
      createMobileApiClient({
        accessToken: next.access_token,
      }).apiV1UserProfileGet({ signal })
    )
    const profile = userProfileResponseSchema.parse(result)
    if (request !== generation || localSignedOut) {
      if (localSignedOut) return
      throw new Error('Session verification is unavailable.')
    }
    member = profile.user.id
    verifiedAccessToken = next.access_token
    setMobileApplicationUserId(member)
  } catch (error) {
    if (request !== generation) {
      if (localSignedOut) return
      throw new Error('Session verification is unavailable.')
    }
    const denied = sessionDenied(error)
    if (changedPrincipal || denied) {
      session = null
      member = null
      verifiedAccessToken = null
      setMobileApplicationUserId(null)
    }
    if (!denied) throw error
  }
  if (request === generation && previousMember !== member) emit()
}
export async function resolveNativeSessionToken(): Promise<string | undefined> {
  if (localSignedOut) return undefined
  const client = await nativeSupabase()
  const { data, error } = await client.auth.getSession()
  if (error) throw new Error('Session verification is unavailable.')
  if (!data.session) {
    await acceptSession(null)
    return undefined
  }
  if (
    session?.user.id !== data.session.user.id ||
    !member ||
    verifiedAccessToken !== data.session.access_token
  )
    await acceptSession(data.session)
  else requireBearerLifetime(data.session)
  if (localSignedOut || !member) return undefined
  if (
    session?.user.id !== data.session.user.id ||
    verifiedAccessToken !== data.session.access_token
  )
    throw new Error('Session verification is unavailable.')
  // Canonical verification may consume the lifetime margin checked above.
  requireBearerLifetime(data.session)
  return data.session.access_token
}
export async function startNativeSession(): Promise<() => void> {
  if (
    __DEV__ &&
    process.env.EXPO_PUBLIC_E2E_AUTH_MODE !== 'real' &&
    (process.env.EXPO_PUBLIC_E2E_ACCESS_TOKEN ||
      process.env.EXPO_PUBLIC_E2E_ACCESS_TOKEN_BY_DEVICE)
  )
    return () => undefined
  const client = await nativeSupabase()
  let stopped = false
  const restore = setMobileAccessTokenResolver(resolveNativeSessionToken)
  let unsubscribe: () => void = () => undefined
  let removeLifecycle: () => void = () => undefined
  const cleanup = () => {
    if (stopped) return
    stopped = true
    generation++
    verification = undefined
    unsubscribe()
    removeLifecycle()
    void client.auth.stopAutoRefresh().catch(() => undefined)
    restore()
  }
  try {
    const { data } = client.auth.onAuthStateChange((_event, next) => {
      // Supabase's auth callback must return before making another SDK request.
      setTimeout(() => {
        if (!stopped && !localSignedOut) void acceptSession(next).catch(() => undefined)
      }, 0)
    })
    unsubscribe = () => data.subscription.unsubscribe()
    const lifecycle = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void client.auth.startAutoRefresh().catch(() => undefined)
        void resolveNativeSessionToken().catch(() => undefined)
      } else void client.auth.stopAutoRefresh().catch(() => undefined)
    })
    removeLifecycle = () => lifecycle.remove()
    try {
      const restored = await client.auth.getSession()
      if (restored.error) throw new Error('Session restore is unavailable.')
      await acceptSession(restored.data.session)
    } catch {
      // Recovery remains installed; bearer supply independently verifies the owner.
    }
    if (AppState.currentState === 'active')
      void client.auth.startAutoRefresh().catch(() => undefined)
    return cleanup
  } catch (error) {
    // Incomplete installation cannot leave a resolver or subscription behind.
    cleanup()
    throw error
  }
}
export async function requestNativeOtp(email: string) {
  const client = await nativeSupabase()
  const { error } = await client.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: true },
  })
  if (error) throw new NativeSignInError('unavailable', 'Sign-in could not be started.')
}
export async function verifyNativeOtp(email: string, token: string) {
  const client = await nativeSupabase()
  if (member) await signOutNativeSession()
  const { data, error } = await client.auth.verifyOtp({ email, token, type: 'email' })
  if (error || !data.session)
    throw new NativeSignInError(
      codeRejected(error) ? 'code_invalid' : 'unavailable',
      'Sign-in code could not be verified.'
    )
  localSignedOut = false
  try {
    await acceptSession(data.session)
  } catch (failure) {
    // A 401/403/404 account check is the server saying this identity has no account.
    throw new NativeSignInError(
      sessionDenied(failure) ? 'denied' : 'unavailable',
      'Session verification is unavailable.'
    )
  }
  if (!member) throw new NativeSignInError('denied', 'This account is unavailable.')
}
export async function signOutNativeSession() {
  const client = await nativeSupabase()
  const token = session?.access_token
  // Clear visible account state immediately; captured credentials serve only bounded unbinding.
  localSignedOut = true
  generation++
  verification = undefined
  member = null
  verifiedAccessToken = null
  session = null
  setMobileApplicationUserId(null)
  emit()
  // Hooks start with the captured credential, but durable sign-out never waits on them:
  // a hook stalled on a provider (for example the OS push token) cannot leave the
  // previous session stored for a fresh process to restore.
  const hooks = Promise.allSettled([...logoutHooks].map((hook) => hook(token)))
  try {
    await client.auth.signOut({ scope: 'local' })
  } finally {
    const storage = secureSessionStorage(await import('expo-secure-store'))
    await storage.removeItem(authStorageKey)
    await storage.removeItem(`${authStorageKey}-code-verifier`)
    let timer: ReturnType<typeof setTimeout> | undefined
    await Promise.race([
      hooks,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, LOGOUT_HOOK_DEADLINE_MS)
      }),
    ])
    clearTimeout(timer)
  }
}
