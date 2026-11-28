import { withRequestDeadline } from '@couture/api-client'
// Story 6.5 owner: secure Supabase restore/refresh and API-resolved application identity.
import {
  createClient,
  processLock,
  type Session,
  type SupabaseClient,
} from '@supabase/supabase-js'
import Constants from 'expo-constants'
import type * as SecureStore from 'expo-secure-store'
import { AppState } from 'react-native'
import {
  userProfileResponseSchema,
  type SignupResponse,
  type UserProfileResponse,
} from '@couture/api-client/contracts/http'
import {
  finishStepHref,
  parsePreviewFrom,
  parseSignInDoor,
  type SignInDoor,
  withoutProviderTokens,
} from '@couture/utils'
import { createMobileApiClient } from './api-client'
import { setNativeOAuthInFlight } from './native-oauth-flight'
import {
  abandonMobileFederatedSignup,
  FederatedSignupError,
  fetchMobileFederatedSignupStatus,
  submitMobileFederatedSignup,
} from './signup'
import { resolveMobileAccessToken, setMobileApplicationUserId } from './mobile-auth'
import { secureSessionStorage } from './secure-session-storage'
import { forgetAllUploadAttempts } from './upload-attempts'
import { codeRejected, NativeSignInError } from './native-signin-error'

let clientPromise: Promise<SupabaseClient> | undefined
let session: Session | null = null
let member: string | null = null
let verifiedAccessToken: string | null = null
let memberRole: UserProfileResponse['user']['role'] | undefined
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
const logoutMarkerKey = `${authStorageKey}-logout-pending`
type SessionLifecycle = {
  owners: Set<object>
  ready: Promise<void>
  dispose: () => void
}
// Roots lease one process lifecycle. Verification survives an interval with no roots.
let sessionLifecycle: SessionLifecycle | undefined
const listeners = new Set<() => void>()
const logoutHooks = new Set<(token?: string) => Promise<void>>()
// Logout cleanup hooks get at most this long before sign-out returns.
const LOGOUT_HOOK_DEADLINE_MS = 3500
const ACCOUNT_CHECK_ATTEMPTS = 3
const ACCOUNT_CHECK_RETRY_MS = 400
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

async function clearStoredNativeSession(secure: typeof SecureStore) {
  const storage = secureSessionStorage(secure)
  await storage.removeItem(authStorageKey)
  await storage.removeItem(`${authStorageKey}-code-verifier`)
  await secure.deleteItemAsync(logoutMarkerKey)
}

export function nativeSupabase(): Promise<SupabaseClient> {
  clientPromise ??= (async () => {
    const secure = await import('expo-secure-store')
    // Finish an interrupted logout before the SDK has a chance to restore the session.
    if (await secure.getItemAsync(logoutMarkerKey)) await clearStoredNativeSession(secure)
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
        // Story 6.17 D1: Google returns a one-time code bound to a verifier kept in SecureStore.
        flowType: 'pkce',
        lock: processLock,
        // Sessions routinely exceed SecureStore's 2048-byte value limit; see the module.
        // Story 6.17: the stored session carries no Google token (Privacy Policy).
        storage: withoutProviderTokens(secureSessionStorage(secure), authStorageKey),
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
    memberRole = profile.user.role
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
async function installSessionLifecycle(lifecycle: SessionLifecycle) {
  const client = await nativeSupabase()
  let stopped = false
  let unsubscribe: () => void = () => undefined
  let removeLifecycle: () => void = () => undefined
  lifecycle.dispose = () => {
    if (stopped) return
    stopped = true
    unsubscribe()
    removeLifecycle()
    void client.auth.stopAutoRefresh().catch(() => undefined)
  }
  try {
    const { data } = client.auth.onAuthStateChange((_event, next) => {
      // Supabase's auth callback must return before making another SDK request.
      setTimeout(() => {
        if (!stopped && !localSignedOut) void acceptSession(next).catch(() => undefined)
      }, 0)
    })
    unsubscribe = () => data.subscription.unsubscribe()
    const subscription = AppState.addEventListener('change', (state) => {
      if (stopped) return
      if (state === 'active') {
        void client.auth.startAutoRefresh().catch(() => undefined)
        void resolveNativeSessionToken().catch(() => undefined)
      } else void client.auth.stopAutoRefresh().catch(() => undefined)
    })
    removeLifecycle = () => subscription.remove()
    try {
      const restored = await client.auth.getSession()
      if (restored.error) throw new Error('Session restore is unavailable.')
      await acceptSession(restored.data.session)
    } catch {
      // Recovery remains installed; bearer supply independently verifies the owner.
    }
    if (AppState.currentState === 'active')
      void client.auth.startAutoRefresh().catch(() => undefined)
  } catch (error) {
    lifecycle.dispose()
    throw error
  }
}
/**
 * Story 7.5: the dev-only fixture lane (Maestro injects a bearer at bundle time) still names
 * its member the way a real session does, from the API's own profile answer for that bearer,
 * so owner-checked actions (tag edits, Style this piece, saved looks) behave as they do for a
 * signed-in member. A failed check leaves the lane without an owner, as before.
 */
async function verifyFixtureIdentity(): Promise<void> {
  for (let attempt = 1; attempt <= ACCOUNT_CHECK_ATTEMPTS; attempt += 1) {
    try {
      const token = await resolveMobileAccessToken()
      if (!token) return
      const result = await withRequestDeadline(5000, [], (signal) =>
        createMobileApiClient({ accessToken: token }).apiV1UserProfileGet({ signal })
      )
      setMobileApplicationUserId(userProfileResponseSchema.parse(result).user.id)
      return
    } catch (error) {
      if (sessionDenied(error) || attempt === ACCOUNT_CHECK_ATTEMPTS) return
      await new Promise((resolve) => setTimeout(resolve, ACCOUNT_CHECK_RETRY_MS))
    }
  }
}
export async function startNativeSession(): Promise<() => void> {
  if (
    __DEV__ &&
    process.env.EXPO_PUBLIC_E2E_AUTH_MODE !== 'real' &&
    (process.env.EXPO_PUBLIC_E2E_ACCESS_TOKEN ||
      process.env.EXPO_PUBLIC_E2E_ACCESS_TOKEN_BY_DEVICE)
  ) {
    await verifyFixtureIdentity()
    return () => undefined
  }
  let lifecycle = sessionLifecycle
  if (!lifecycle) {
    lifecycle = { owners: new Set(), ready: Promise.resolve(), dispose: () => undefined }
    sessionLifecycle = lifecycle
    lifecycle.ready = installSessionLifecycle(lifecycle)
  }
  const ownedLifecycle = lifecycle
  const owner = {}
  ownedLifecycle.owners.add(owner)
  const cleanup = () => {
    if (!ownedLifecycle.owners.delete(owner) || ownedLifecycle.owners.size > 0) return
    if (sessionLifecycle === ownedLifecycle) sessionLifecycle = undefined
    ownedLifecycle.dispose()
  }
  try {
    await ownedLifecycle.ready
    return cleanup
  } catch (error) {
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
export async function verifyNativeOtp(email: string, token: string, fromPreview = false) {
  const client = await nativeSupabase()
  if (member) await signOutNativeSession()
  const { data, error } = await client.auth.verifyOtp({ email, token, type: 'email' })
  if (error || !data.session)
    throw new NativeSignInError(
      codeRejected(error) ? 'code_invalid' : 'unavailable',
      'Sign-in code could not be verified.'
    )
  localSignedOut = false
  // The code's session replaced any Google identity waiting on the finish step.
  await clearFederatedFinishMarker()
  // Auth has spent the one-time code, so a slow account check (a cold API on a busy host)
  // would strand the person with a code that cannot be sent again. The session is valid;
  // check the account again before asking them to start over.
  let failure: unknown
  for (let attempt = 0; attempt < ACCOUNT_CHECK_ATTEMPTS; attempt++) {
    if (attempt) {
      await new Promise((resolve) => setTimeout(resolve, ACCOUNT_CHECK_RETRY_MS))
      if (localSignedOut) break
    }
    try {
      await acceptSession(data.session)
      failure = undefined
      break
    } catch (error) {
      failure = error
      // A 401/403/404 account check is the server saying this identity has no account.
      if (sessionDenied(error)) break
    }
  }
  await finishNativeOtpVerification(data.session.access_token, fromPreview, failure)
}

async function finishNativeOtpVerification(
  accessToken: string,
  fromPreview: boolean,
  failure: unknown
) {
  if (failure && !sessionDenied(failure))
    throw new NativeSignInError('unavailable', 'Session verification is unavailable.')
  if (failure || !member) {
    // A denial is the server saying this identity has no account, unless the account is a
    // teen the guardian lock refuses until a guardian approves.
    if (await awaitingGuardian(accessToken))
      throw new NativeSignInError(
        'awaiting_guardian',
        'A guardian has to approve this account.'
      )
    throw new NativeSignInError('denied', 'This account is unavailable.')
  }
  const needsInvitation = await needsGuardianInvitation(accessToken, fromPreview)
  if (needsInvitation === null)
    throw new NativeSignInError('unavailable', 'Session verification is unavailable.')
  if (needsInvitation)
    throw new NativeSignInError(
      'awaiting_guardian',
      'A guardian has to approve this account.'
    )
}
export async function signOutNativeSession() {
  const client = await nativeSupabase()
  const secure = await import('expo-secure-store')
  // The SDK uses the stored credential to sign out this device's session. A cold launch
  // seeing this marker clears it locally before any credentials can be restored.
  await secure.setItemAsync(logoutMarkerKey, '1', {
    keychainAccessible: secure.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
  })
  const token = session?.access_token
  // Clear visible account state immediately; captured credentials serve only bounded unbinding.
  localSignedOut = true
  generation++
  verification = undefined
  member = null
  verifiedAccessToken = null
  session = null
  setMobileApplicationUserId(null)
  // An open upload attempt belongs to the account that allocated it.
  forgetAllUploadAttempts()
  emit()
  // Hooks start with the captured credential, but durable sign-out never waits on them:
  // a hook stalled on a provider (for example the OS push token) cannot leave the
  // previous session stored for a fresh process to restore.
  const hooks = Promise.allSettled([...logoutHooks].map((hook) => hook(token)))
  try {
    await client.auth.signOut({ scope: 'local' })
  } finally {
    await clearStoredNativeSession(secure)
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

/** Story 6.17: what a finished Google round trip means for the person. */
export type NativeOAuthOutcome =
  | { kind: 'member' }
  | { kind: 'no_account' }
  // A teen whose guardian has not approved (or has revoked): the session stays, and the finish
  // step shows the guardian invitation (the lock refuses every other signed-in request).
  | { kind: 'awaiting_guardian' }
  | { kind: 'refused' }
  | { kind: 'cancelled' }
  | { kind: 'unavailable' }

/**
 * Story 6.17 D3: set while a Google identity waits on the finish step, so the next launch
 * routes back to it. It holds no address and no token, only where the person came from.
 */
export const FEDERATED_FINISH_MARKER_KEY = 'couturecast.federated-finish'

export async function readFederatedFinishMarker(): Promise<{
  from: 'preview' | null
  door: SignInDoor
} | null> {
  try {
    const secure = await import('expo-secure-store')
    const raw = await secure.getItemAsync(FEDERATED_FINISH_MARKER_KEY)
    if (raw === null) return null
    const parsed: unknown = JSON.parse(raw)
    const field = (name: string) => {
      const value: unknown =
        parsed && typeof parsed === 'object' && name in parsed
          ? (parsed as Record<string, unknown>)[name]
          : null
      return typeof value === 'string' ? value : null
    }
    return { from: parsePreviewFrom(field('from')), door: parseSignInDoor(field('door')) }
  } catch {
    return null
  }
}

async function writeFederatedFinishMarker(from: 'preview' | null, door: SignInDoor) {
  try {
    const secure = await import('expo-secure-store')
    await secure.setItemAsync(FEDERATED_FINISH_MARKER_KEY, JSON.stringify({ from, door }))
  } catch {
    // Without storage the finish step still works; only a relaunch loses the way back.
  }
}

export async function clearFederatedFinishMarker() {
  try {
    const secure = await import('expo-secure-store')
    await secure.deleteItemAsync(FEDERATED_FINISH_MARKER_KEY)
  } catch {
    // Nothing stored.
  }
}

/**
 * Story 6.17 D10: the provider name. The real-stack test lane swaps in a Keycloak stand-in,
 * only in a development bundle of an isolated story build; anywhere else the request is
 * refused. A release bundle drops this whole branch with `__DEV__`, and the bundle scan
 * proves the variable is absent.
 */
function oauthProvider(): 'google' | 'keycloak' | null {
  if (__DEV__) {
    const requested = process.env.EXPO_PUBLIC_E2E_OAUTH_PROVIDER?.trim()
    if (requested) {
      const extra: unknown = Constants.expoConfig?.extra
      const isolated =
        !!extra &&
        typeof extra === 'object' &&
        'isolatedNativeBuild' in extra &&
        extra.isolatedNativeBuild === true
      return requested === 'keycloak' && isolated ? 'keycloak' : null
    }
  }
  return 'google'
}

/**
 * Story 6.17 D1, D2: opens Google's account chooser in the system browser session
 * (ASWebAuthenticationSession, Custom Tabs) and completes in process. A member or a waiting
 * identity is signed out first, so the verifier and the next session belong to the chooser.
 */
export async function startNativeGoogleSignIn(
  options: { from?: string | null; door?: SignInDoor } = {}
): Promise<NativeOAuthOutcome> {
  const provider = oauthProvider()
  if (!provider) return { kind: 'unavailable' }
  try {
    const client = await nativeSupabase()
    const stored = await client.auth.getSession()
    if (member || stored.data.session) await signOutNativeSession()
    await clearFederatedFinishMarker()
    const Linking = await import('expo-linking')
    const WebBrowser = await import('expo-web-browser')
    const fromPreview = parsePreviewFrom(options.from ?? null) !== null
    // The app declares two schemes; the callback always uses the first (couturecast, or an
    // isolated story build's own), named explicitly so expo-linking need not guess.
    const declared: unknown = Constants.expoConfig?.scheme
    const scheme: unknown = Array.isArray(declared)
      ? (declared as unknown[])[0]
      : declared
    const schemeOption = typeof scheme === 'string' ? { scheme } : {}
    // The browser session watches for the bare callback URL. Android's Custom Tabs polyfill
    // accepts only a URL that starts with it, and Auth appends `code` before `from` and
    // `door`, so the preview hint and the door ride only in `redirectTo` (D5).
    const returnUrl = Linking.createURL('auth/callback', schemeOption)
    const queryParams: Record<string, string> = {}
    if (fromPreview) queryParams.from = 'preview'
    if (parseSignInDoor(options.door) === 'signup') queryParams.door = 'signup'
    const redirectTo = Linking.createURL('auth/callback', {
      ...schemeOption,
      ...(Object.keys(queryParams).length ? { queryParams } : {}),
    })
    localSignedOut = false
    const { data, error } = await client.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo,
        queryParams: { prompt: 'select_account' },
        skipBrowserRedirect: true,
      },
    })
    if (error || !data.url) return { kind: 'unavailable' }
    setNativeOAuthInFlight(true)
    try {
      const result = await WebBrowser.openAuthSessionAsync(data.url, returnUrl)
      if (result.type !== 'success') return { kind: 'cancelled' }
      return await completeNativeOAuth(result.url)
    } finally {
      setNativeOAuthInFlight(false)
    }
  } catch {
    return { kind: 'unavailable' }
  }
}

async function refuseFederatedIdentity(): Promise<NativeOAuthOutcome> {
  await clearFederatedFinishMarker()
  await signOutNativeSession().catch(() => undefined)
  return { kind: 'refused' }
}

/** Verification with the OTP path's retry for a cold API; a denial stops at once. */
async function verifyWithRetry(
  next: Session
): Promise<'member' | 'denied' | 'unavailable'> {
  for (let attempt = 0; attempt < ACCOUNT_CHECK_ATTEMPTS; attempt++) {
    if (attempt)
      await new Promise((resolve) => setTimeout(resolve, ACCOUNT_CHECK_RETRY_MS))
    try {
      await acceptSession(next)
      return member ? 'member' : 'denied'
    } catch {
      // Transient: try again.
    }
  }
  return 'unavailable'
}

/**
 * After a session exists: a member is done; a denied profile check asks the API whether the
 * finish step applies. `complete` gets exactly one more verification (TEA-3).
 */
async function settleFederatedSession(
  next: Session,
  fromPreview = false
): Promise<NativeOAuthOutcome> {
  const first = await verifyWithRetry(next)
  if (first === 'member') {
    const needsInvitation = await needsGuardianInvitation(next.access_token, fromPreview)
    if (needsInvitation === null) return { kind: 'unavailable' }
    return needsInvitation ? { kind: 'awaiting_guardian' } : { kind: 'member' }
  }
  if (first === 'unavailable') return { kind: 'unavailable' }
  let status
  try {
    status = (await fetchMobileFederatedSignupStatus(next.access_token)).status
  } catch (error) {
    return error instanceof FederatedSignupError && error.status === 401
      ? refuseFederatedIdentity()
      : { kind: 'unavailable' }
  }
  if (status === 'needs_birthdate') return { kind: 'no_account' }
  if (status === 'awaiting_guardian') return { kind: 'awaiting_guardian' }
  const second = await verifyWithRetry(next)
  if (second === 'member') return { kind: 'member' }
  return second === 'denied' ? refuseFederatedIdentity() : { kind: 'unavailable' }
}

const exchanges = new Map<string, Promise<NativeOAuthOutcome>>()
/**
 * The last settled exchange, so a late second delivery of the same code gets its outcome
 * instead of spending a used code; entries leave `exchanges` once they settle.
 */
let lastSettled: { code: string; flight: Promise<NativeOAuthOutcome> } | undefined

function callbackParams(url: string): URLSearchParams {
  try {
    const parsed = new URL(url)
    const params = new URLSearchParams(parsed.search)
    new URLSearchParams(parsed.hash.replace(/^#/, '')).forEach((value, key) => {
      if (!params.has(key)) params.set(key, value)
    })
    return params
  } catch {
    return new URLSearchParams()
  }
}

/**
 * Story 6.17 D5: completes a Google round trip from its callback URL. Never throws. One
 * exchange per code, whether the URL came back in process or through the router.
 */
/** A round trip that ends without a session leaves no PKCE verifier behind. */
async function dropCodeVerifier() {
  try {
    const storage = secureSessionStorage(await import('expo-secure-store'))
    await storage.removeItem(`${authStorageKey}-code-verifier`)
  } catch {
    // Nothing stored.
  }
}

export function completeNativeOAuth(url: string): Promise<NativeOAuthOutcome> {
  const params = callbackParams(url)
  const from = parsePreviewFrom(params.get('from'))
  const door = parseSignInDoor(params.get('door'))
  const providerError = params.get('error')
  if (providerError || !params.get('code')) void dropCodeVerifier()
  if (providerError) {
    // TEA-11: Auth refuses a provider address it cannot treat as verified with
    // access_denied plus this code; that is a refusal of the identity, not a cancel.
    if (params.get('error_code') === 'provider_email_needs_verification')
      return Promise.resolve({ kind: 'refused' })
    return Promise.resolve(
      providerError === 'access_denied' ? { kind: 'cancelled' } : { kind: 'unavailable' }
    )
  }
  const code = params.get('code')
  if (!code) return Promise.resolve({ kind: 'unavailable' })
  const existing = exchanges.get(code)
  if (existing) return existing
  if (lastSettled?.code === code) return lastSettled.flight
  const flight = (async (): Promise<NativeOAuthOutcome> => {
    try {
      const client = await nativeSupabase()
      const { data, error } = await client.auth.exchangeCodeForSession(code)
      if (error || !data.session) {
        await dropCodeVerifier()
        return { kind: 'unavailable' }
      }
      localSignedOut = false
      const outcome = await settleFederatedSession(data.session, from === 'preview')
      if (outcome.kind === 'no_account') await writeFederatedFinishMarker(from, door)
      else await clearFederatedFinishMarker()
      return outcome
    } catch {
      return { kind: 'unavailable' }
    }
  })()
  exchanges.set(code, flight)
  void flight.then(() => {
    exchanges.delete(code)
    lastSettled = { code, flight }
  })
  return flight
}

/**
 * Story 6.17 D3: where a launch should resume a finish step left open (a killed app), or null.
 * As on web, the server's status decides, so an identity stored without the marker (a slow
 * account check during the round trip) resumes too; the marker carries only the preview hint
 * and the door. A member never resumes.
 */
export async function federatedFinishResumeHref(): Promise<string | null> {
  if (member) return null
  const identity = await readNativeFederatedIdentity().catch(() => null)
  if (!identity) {
    await clearFederatedFinishMarker()
    return null
  }
  let status
  try {
    status = (await fetchMobileFederatedSignupStatus(identity.accessToken)).status
  } catch {
    return null
  }
  if (member) return null
  if (status !== 'needs_birthdate') {
    await clearFederatedFinishMarker()
    return null
  }
  const marker = await readFederatedFinishMarker()
  return finishStepHref(marker?.from ?? null, marker?.door ?? 'signin', '/signup-finish')
}

async function awaitingGuardian(accessToken: string) {
  return (await fetchNativeAwaitingGuardianAccount(accessToken)) !== null
}

async function needsGuardianInvitation(accessToken: string, fromPreview: boolean) {
  if (memberRole !== 'teen' || verifiedAccessToken !== accessToken) return false
  if (
    fromPreview &&
    (await (await import('./post-signin-destination.js')).hasGuestLookSave())
  )
    return false
  return fetchMobileFederatedSignupStatus(accessToken).then(
    ({ status }) => status === 'awaiting_guardian',
    () => null
  )
}

/**
 * The teen account a stored identity is waiting on a guardian for, or null. Only the
 * identity-keyed status endpoint answers for such a teen; the finish step shows the guardian
 * invitation for it instead of the birthdate question.
 */
export async function fetchNativeAwaitingGuardianAccount(
  accessToken: string
): Promise<string | null> {
  try {
    const status = await fetchMobileFederatedSignupStatus(accessToken)
    return status.status === 'awaiting_guardian' ? (status.accountId ?? null) : null
  } catch {
    return null
  }
}

/** The Google identity waiting on the finish step, or null when there is none. */
export async function readNativeFederatedIdentity(): Promise<{
  accessToken: string
  email: string | null
} | null> {
  if (localSignedOut) return null
  const client = await nativeSupabase()
  const { data, error } = await client.auth.getSession()
  if (error || !data.session) return null
  return {
    accessToken: data.session.access_token,
    email: data.session.user.email ?? null,
  }
}

export type NativeFederatedFinishResult =
  | { kind: 'created'; account: SignupResponse }
  | { kind: 'signed_in' }
  | { kind: 'awaiting_guardian'; accountId: string }
  | { kind: 'underage' }
  | { kind: 'guardian_minor' }
  | { kind: 'refused' }
  | { kind: 'no_session' }
  | { kind: 'unavailable' }

async function recoverNativeFederatedSignup(
  accessToken: string,
  fromPreview: boolean
): Promise<NativeFederatedFinishResult> {
  const client = await nativeSupabase()
  const { data } = await client.auth.getSession()
  if (!data.session) return { kind: 'no_session' }
  if (data.session.access_token !== accessToken) return { kind: 'unavailable' }
  const outcome = await settleFederatedSession(data.session, fromPreview)
  if (outcome.kind === 'member') {
    await clearFederatedFinishMarker()
    return { kind: 'signed_in' }
  }
  if (outcome.kind === 'awaiting_guardian') {
    const accountId = await fetchNativeAwaitingGuardianAccount(accessToken)
    const current = await readNativeFederatedIdentity()
    if (accountId && current?.accessToken === accessToken)
      return { kind: 'awaiting_guardian', accountId }
  }
  return outcome.kind === 'refused' ? { kind: 'refused' } : { kind: 'unavailable' }
}

/**
 * Story 6.17 D3: submits the birthdate for the waiting identity, then verifies the new account
 * like any sign-in. Under 13 the server deletes the identity, so this signs out.
 */
export async function finishNativeFederatedSignup(
  birthdate: string,
  fromPreview = false
): Promise<NativeFederatedFinishResult> {
  const identity = await readNativeFederatedIdentity()
  if (!identity) return { kind: 'no_session' }
  let account: SignupResponse
  try {
    account = await submitMobileFederatedSignup(identity.accessToken, { birthdate })
  } catch (error) {
    const status = error instanceof FederatedSignupError ? error.status : undefined
    if (status === 409)
      return recoverNativeFederatedSignup(identity.accessToken, fromPreview)
    if (status === 403) {
      if (
        error instanceof FederatedSignupError &&
        error.code === 'federated_guardian_minor'
      )
        return { kind: 'guardian_minor' }
      await clearFederatedFinishMarker()
      await signOutNativeSession().catch(() => undefined)
      return { kind: 'underage' }
    }
    if (status === 401) {
      await refuseFederatedIdentity()
      return { kind: 'refused' }
    }
    return { kind: 'unavailable' }
  }
  await clearFederatedFinishMarker()
  const client = await nativeSupabase()
  const { data } = await client.auth.getSession()
  if (data.session) await verifyWithRetry(data.session)
  return { kind: 'created', account }
}

/** Story 6.17 D3 Cancel: deletes a waiting identity that has no account, then signs out. */
export async function cancelNativeFederatedSignup(): Promise<void> {
  const identity = await readNativeFederatedIdentity()
  await clearFederatedFinishMarker()
  try {
    if (identity) await abandonMobileFederatedSignup(identity.accessToken)
  } catch {
    // The orphan sweep removes an identity whose deletion did not land.
  } finally {
    await signOutNativeSession().catch(() => undefined)
  }
}
