'use client'
// Story 6.5 owner: verified OTP session bridge into the existing bearer boundary.
import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js'
import {
  userProfileResponseSchema,
  type SignupResponse,
} from '@couture/api-client/contracts/http'
import {
  finishStepHref,
  parsePreviewFrom,
  parseSignInDoor,
  type AuthSessionStorage,
  type SignInDoor,
  withoutProviderTokens,
} from '@couture/utils'
import { createWebApiClient } from './api-client'
import {
  abandonWebFederatedSignup,
  FederatedSignupError,
  fetchWebFederatedSignupStatus,
  submitWebFederatedSignup,
} from './signup'
import { APP_SIGNED_OUT_EVENT } from './app-history'
import { readStorage, WEB_ACCESS_TOKEN_STORAGE_KEY } from './browser-persistence'
import { forgetAllUploadAttempts, setUploadAttemptAccount } from './upload-attempts'
let client: SupabaseClient | undefined
let member: string | null = null
let principal: string | null = null
let acceptedToken: string | null = null
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
const WEB_BEARER_MIN_REMAINING_MS = 5_000
/**
 * Stored in sessionStorage beside the bearer, and written and removed with it: the Supabase
 * user (`session.user.id`) the stored bearer was verified for, and the app member that
 * verification named, as `{"principal":…,"member":…}`. A fresh document of this tab (a reload,
 * a typed URL) restores both from here, so a restored Supabase session of the same user keeps
 * the bearer and the identity in place while verification runs again.
 */
export const WEB_SESSION_PRINCIPAL_STORAGE_KEY = 'couturecast.access-principal'
export const webSessionIdentity = () => member
export const webSessionVerifiedBearer = () => acceptedToken
/** Calls `listener` after every identity publication; returns the unsubscribe. */
export function onWebSessionIdentity(listener: () => void): () => void {
  window.addEventListener('couture:session', listener)
  return () => window.removeEventListener('couture:session', listener)
}
/**
 * Every change of verified account goes through here, so upload attempts follow it: an auth
 * state change that switches or drops the account forgets every open attempt and fences
 * uploads still under way, the same as an explicit sign-out.
 *
 * The account and its bearer are published together (final review F-1): the stored bearer is
 * replaced (or removed) before subscribers hear of the change, so a listener that reads at once
 * never pairs the new account with the previous account's token, and the next account's read
 * finds its own token already stored. The verified principal is stored and removed with it.
 */
function setMember(
  verified: { principal: string; member: string; token: string } | null
) {
  acceptedToken = verified?.token ?? null
  if (verified === null) {
    window.sessionStorage.removeItem(WEB_ACCESS_TOKEN_STORAGE_KEY)
    window.sessionStorage.removeItem(WEB_SESSION_PRINCIPAL_STORAGE_KEY)
  } else {
    window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, verified.token)
    window.sessionStorage.setItem(
      WEB_SESSION_PRINCIPAL_STORAGE_KEY,
      JSON.stringify({ principal: verified.principal, member: verified.member })
    )
  }
  member = verified?.member ?? null
  setUploadAttemptAccount(member)
}
function parseStored(raw: string | null): unknown {
  try {
    return raw === null ? null : JSON.parse(raw)
  } catch {
    return null
  }
}
/**
 * A fresh document of this tab (a reload or a typed URL) starts here, before any page reads the
 * bearer. Without this, verification saw no principal, took the restored session for an account
 * change and removed the bearer until the profile check answered, so a page that read the bearer
 * at mount in that window found none ("Your session expired" on a reload of /wardrobe).
 *
 * The stored principal is restored only while the browser's stored Supabase session is still
 * that same user; verification then re-runs as for a token refresh. When another account signed
 * in from another tab (the auth session is shared, the bearer is per tab), or the session is
 * gone, the previous account's bearer and principal are removed here, before anything reads
 * them, and the next account's bearer is stored only once its own verification passes. An
 * expired session waits for the SDK to refresh. Local E2E fixture bearers have no principal.
 */
function restoreVerifiedPrincipal() {
  const raw = readStorage('session', WEB_SESSION_PRINCIPAL_STORAGE_KEY)
  const token = readStorage('session', WEB_ACCESS_TOKEN_STORAGE_KEY)
  if (raw === null && (token === null || isE2EFixtureBearer(token))) return
  const stored = parseStored(raw) as { principal?: unknown; member?: unknown } | null
  const auth = parseStored(readStorage('local', authStorageKey)) as {
    user?: { id?: unknown }
    expires_at?: unknown
  } | null
  if (
    typeof stored?.principal === 'string' &&
    stored.principal === auth?.user?.id &&
    typeof stored.member === 'string' &&
    stored.member !== '' &&
    typeof auth.expires_at === 'number' &&
    auth.expires_at * 1000 - Date.now() > WEB_BEARER_MIN_REMAINING_MS &&
    token
  ) {
    principal = stored.principal
    member = stored.member
    acceptedToken = token
    setUploadAttemptAccount(member)
    return
  }
  window.sessionStorage.removeItem(WEB_ACCESS_TOKEN_STORAGE_KEY)
  window.sessionStorage.removeItem(WEB_SESSION_PRINCIPAL_STORAGE_KEY)
}
restoreVerifiedPrincipal()
/** A stored session that verification has not yet named a member for, or cleared. */
export const hasStoredWebSession = () =>
  !localSignedOut && readStorage('local', authStorageKey) !== null
/**
 * Why sign-in failed, in terms a person can act on: `denied` means this address has no
 * CoutureCast account that can sign in (retrying will not help); `code_invalid` means the
 * code was wrong or expired; `unavailable` means a transient failure worth retrying.
 */
export type WebSignInFailure =
  | 'denied'
  | 'code_invalid'
  | 'unavailable'
  | 'awaiting_guardian'
export class WebSignInError extends Error {
  constructor(
    readonly reason: WebSignInFailure,
    message: string
  ) {
    super(message)
    this.name = 'WebSignInError'
  }
}
/**
 * Auth answers a wrong or expired code with a 4xx. A 429 rate limit and anything else are
 * not the code's fault, so they read as a temporary failure.
 */
function codeRejected(error: unknown) {
  if (!error || typeof error !== 'object' || !('status' in error)) return false
  const status: unknown = error.status
  return typeof status === 'number' && status >= 400 && status < 500 && status !== 429
}
/**
 * The browser's localStorage, or memory where storage is blocked (the SDK's own fallback),
 * wrapped so the stored session carries no Google token (Privacy Policy, Story 6.17).
 */
function webAuthStorage(): AuthSessionStorage {
  try {
    const probe = `${authStorageKey}-probe`
    window.localStorage.setItem(probe, probe)
    // Safari's Block All Cookies can refuse reads as well as writes (TEA H-2).
    window.localStorage.getItem(probe)
    window.localStorage.removeItem(probe)
    return withoutProviderTokens(window.localStorage, authStorageKey)
  } catch {
    const memory = new Map<string, string>()
    return withoutProviderTokens(
      {
        getItem: (key) => memory.get(key) ?? null,
        setItem: (key, value) => void memory.set(key, value),
        removeItem: (key) => void memory.delete(key),
      },
      authStorageKey
    )
  }
}
export function webSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) throw new Error('Sign-in is unavailable.')
  client ??= createClient(url, key, {
    auth: {
      storageKey: authStorageKey,
      storage: webAuthStorage(),
      persistSession: true,
      autoRefreshToken: true,
      // Story 6.17 D1, D5: Google returns a one-time code to /auth/callback, which exchanges
      // it explicitly; no other page may consume a code, and no token ever rides in a URL.
      flowType: 'pkce',
      detectSessionInUrl: false,
    },
  })
  return client
}
/**
 * The API refused this identity (401, 403 or 404 on the profile check): a definitive answer,
 * where a timeout or a 5xx is a temporary failure worth retrying.
 */
export const isWebSessionDenial = (error: unknown) => sessionDenied(error)
function sessionDenied(error: unknown) {
  if (!error || typeof error !== 'object' || !('response' in error)) return false
  const response: unknown = error.response
  return response instanceof Response && [401, 403, 404].includes(response.status)
}
function publishIdentity() {
  window.dispatchEvent(new Event('couture:session'))
}
function requireBearerLifetime(session: Session) {
  // The HTTP attempt can consume five seconds. SDK refresh failure may return a
  // still-valid stored JWT inside that window. Keep the session for retry.
  if (
    session.expires_at !== undefined &&
    session.expires_at * 1000 - Date.now() <= WEB_BEARER_MIN_REMAINING_MS
  )
    throw new Error('Session verification is unavailable.')
}
function accept(session: Session | null): Promise<void> {
  const current = verification
  if (
    session &&
    current &&
    current.generation === generation &&
    current.principal === session.user.id &&
    current.token === session.access_token
  )
    return current.promise
  const promise = verifySession(session)
  if (!session) {
    verification = undefined
    return promise
  }
  const flight: VerificationFlight = {
    principal: session.user.id,
    token: session.access_token,
    generation,
    promise,
  }
  flight.promise = promise.finally(() => {
    if (verification === flight) verification = undefined
  })
  verification = flight
  return flight.promise
}
async function verifySession(session: Session | null) {
  const request = ++generation
  const previous = member
  const changed = principal !== (session?.user.id ?? null)
  principal = session?.user.id ?? null
  if (changed || !session) {
    setMember(null)
    publishIdentity()
  }
  if (!session) return
  try {
    requireBearerLifetime(session)
    const profile = userProfileResponseSchema.parse(
      await createWebApiClient({ accessToken: session.access_token }).apiV1UserProfileGet(
        { signal: AbortSignal.timeout(5000) }
      )
    )
    if (request !== generation || localSignedOut) {
      if (localSignedOut) return
      throw new Error('Session verification is unavailable.')
    }
    setMember({
      principal: session.user.id,
      member: profile.user.id,
      token: session.access_token,
    })
    // Token refresh preserves same-owner draft/cache scope; account switching changes identity.
    publishIdentity()
  } catch (error) {
    if (request !== generation) {
      if (localSignedOut) return
      throw new Error('Session verification is unavailable.')
    }
    if (changed || sessionDenied(error)) {
      setMember(null)
      if (previous !== null) publishIdentity()
    }
    throw error
  }
}
/**
 * The e2e fixture bearer: only under NEXT_PUBLIC_E2E_AUTH, and only a `test-token` prefix. It
 * skips verification; any other bearer counts only once verification names its member.
 */
export function isE2EFixtureBearer(token: string | null | undefined): boolean {
  return (
    process.env.NEXT_PUBLIC_E2E_AUTH === 'true' &&
    Boolean(token?.startsWith('test-token'))
  )
}
export async function startWebSession() {
  const fixture = readStorage('session', WEB_ACCESS_TOKEN_STORAGE_KEY)
  if (isE2EFixtureBearer(fixture)) return () => undefined
  const auth = webSupabase().auth
  let stopped = false
  const { data } = auth.onAuthStateChange((_event, session) => {
    setTimeout(() => {
      if (!stopped && !localSignedOut) void accept(session).catch(() => undefined)
    }, 0)
  })
  // Story CC-7.11 (WebKit real-session burn-in): another tab's sign-in or sign-out reaches this
  // tab through a storage event, which WebKit and iOS Safari can deliver late or drop for a
  // background or frozen page. A return to the tab compares the stored session's user with the
  // one in memory and, only when they differ, settles it the way that event would have; an
  // unchanged session asks nothing.
  const resync = () => {
    if (stopped || localSignedOut || storedAuthPrincipal() === principal) return
    void auth
      .getSession()
      .then((restored) => {
        if (!stopped && !localSignedOut && !restored.error)
          return accept(restored.data.session)
      })
      .catch(() => undefined)
  }
  const onVisibility = () => {
    if (document.visibilityState === 'visible') resync()
  }
  window.addEventListener('focus', resync)
  window.addEventListener('pageshow', resync)
  document.addEventListener('visibilitychange', onVisibility)
  const cleanup = () => {
    stopped = true
    generation++
    verification = undefined
    data.subscription.unsubscribe()
    window.removeEventListener('focus', resync)
    window.removeEventListener('pageshow', resync)
    document.removeEventListener('visibilitychange', onVisibility)
  }
  try {
    const restored = await auth.getSession()
    if (restored.error) throw new Error('Session restore is unavailable.')
    await accept(restored.data.session)
    return cleanup
  } catch {
    // Keep automatic recovery installed while the owner is unverified.
    return cleanup
  }
}
export async function resolveWebSessionToken() {
  if (localSignedOut) return undefined
  const { data, error } = await webSupabase().auth.getSession()
  if (error) throw new Error('Session verification is unavailable.')
  if (!data.session) {
    await accept(null)
    return undefined
  }
  if (
    principal !== data.session.user.id ||
    !member ||
    acceptedToken !== data.session.access_token
  )
    await accept(data.session)
  else requireBearerLifetime(data.session)
  if (localSignedOut || !member) return undefined
  if (principal !== data.session.user.id || acceptedToken !== data.session.access_token)
    throw new Error('Session verification is unavailable.')
  // Canonical verification may consume the lifetime margin checked above.
  requireBearerLifetime(data.session)
  return data.session.access_token
}
export async function requestWebOtp(email: string) {
  const { error } = await webSupabase().auth.signInWithOtp({
    email,
    options: { shouldCreateUser: true },
  })
  if (error) throw new WebSignInError('unavailable', 'Sign-in could not be started.')
}
export async function verifyWebOtp(email: string, token: string) {
  const { data, error } = await webSupabase().auth.verifyOtp({
    email,
    token,
    type: 'email',
  })
  if (error || !data.session)
    throw new WebSignInError(
      codeRejected(error) ? 'code_invalid' : 'unavailable',
      'Sign-in code could not be verified.'
    )
  localSignedOut = false
  try {
    await accept(data.session)
  } catch (failure) {
    // A 401/403/404 account check is the server saying this identity has no account, unless
    // the account is a teen the guardian lock refuses until a guardian approves.
    if (sessionDenied(failure) && (await awaitingGuardian(data.session.access_token)))
      throw new WebSignInError(
        'awaiting_guardian',
        'A guardian has to approve this account.'
      )
    throw new WebSignInError(
      sessionDenied(failure) ? 'denied' : 'unavailable',
      'Session verification is unavailable.'
    )
  }
  if (!member) {
    if (await awaitingGuardian(data.session.access_token))
      throw new WebSignInError(
        'awaiting_guardian',
        'A guardian has to approve this account.'
      )
    throw new WebSignInError('denied', 'This account is unavailable.')
  }
}

/**
 * The account behind this token is a teen the guardian lock refuses on every
 * signed-in endpoint (the profile check included), or false when the status is anything else
 * or unknown. Only the identity-keyed status endpoint answers for such a teen.
 */
async function awaitingGuardian(accessToken: string) {
  try {
    return (
      (await fetchWebFederatedSignupStatus(accessToken)).status === 'awaiting_guardian'
    )
  } catch {
    return false
  }
}

/**
 * The teen account a stored identity is waiting on a guardian for, or null. The finish step
 * shows the guardian invitation for it instead of the birthdate question.
 */
export async function fetchWebAwaitingGuardianAccount(
  accessToken: string
): Promise<string | null> {
  try {
    const status = await fetchWebFederatedSignupStatus(accessToken)
    return status.status === 'awaiting_guardian' ? (status.accountId ?? null) : null
  } catch {
    return null
  }
}
export async function signOutWebSession() {
  localSignedOut = true
  generation++
  verification = undefined
  principal = null
  // The bearer goes before any subscriber hears of the sign-out (final review F-1).
  setMember(null)
  // An open upload attempt belongs to the account that allocated it; this also fences uploads
  // still under way when no account was verified (the E2E fixture token).
  forgetAllUploadAttempts()
  clearFederatedFinishMarker()
  // The stored session goes before the announcement too: a listener reading it while a session
  // start's profile check is still out would see a valid stored session and stay pending, and
  // no later event would correct it (CC-7.9 L-4b). The SDK's local sign-out needs no storage.
  removeStoredAuthSession()
  window.dispatchEvent(new Event('couture:session'))
  // Story CC-7.11 P8: the in-app back stack and any open layer belong to the member who left.
  window.dispatchEvent(new Event(APP_SIGNED_OUT_EVENT))
  try {
    await webSupabase().auth.signOut({ scope: 'local' })
  } finally {
    removeStoredAuthSession()
  }
}

/** The user id of the auth session stored for every tab, or null when none is stored. */
function storedAuthPrincipal(): string | null {
  const raw = readStorage('local', authStorageKey)
  if (raw === null) return null
  try {
    const stored: unknown = JSON.parse(raw)
    const user = (stored as { user?: { id?: unknown } } | null)?.user
    return typeof user?.id === 'string' ? user.id : null
  } catch {
    return null
  }
}

function removeStoredAuthSession() {
  window.localStorage.removeItem(authStorageKey)
  window.localStorage.removeItem(`${authStorageKey}-code-verifier`)
}

/** Story 6.17: what a finished Google round trip means for the person. */
export type WebOAuthOutcome =
  | { kind: 'member' }
  | { kind: 'no_account' }
  // A teen whose guardian has not approved (or has revoked): the session stays, and the finish
  // step shows the guardian invitation (the lock refuses every other signed-in request).
  | { kind: 'awaiting_guardian' }
  | { kind: 'refused' }
  | { kind: 'cancelled' }
  | { kind: 'unavailable' }

/**
 * Story 6.17 D3: set while a Google identity waits on the finish step, so a reload or a
 * return visit routes back to it. It holds no address and no token, only where the person
 * came from.
 */
export const FEDERATED_FINISH_MARKER_KEY = 'couturecast.federated-finish'

type FinishMarker = { from: 'preview' | null; door: SignInDoor }

export function readFederatedFinishMarker(): FinishMarker | null {
  try {
    const raw = readStorage('session', FEDERATED_FINISH_MARKER_KEY)
    if (raw === null) return null
    const parsed: unknown = JSON.parse(raw)
    const record = parsed && typeof parsed === 'object' ? parsed : {}
    const from = 'from' in record && typeof record.from === 'string' ? record.from : null
    const door = 'door' in record && typeof record.door === 'string' ? record.door : null
    return { from: parsePreviewFrom(from), door: parseSignInDoor(door) }
  } catch {
    return null
  }
}

function writeFederatedFinishMarker(marker: FinishMarker) {
  try {
    window.sessionStorage.setItem(FEDERATED_FINISH_MARKER_KEY, JSON.stringify(marker))
  } catch {
    // Without storage the finish step still works; only a reload loses the way back.
  }
}

export function clearFederatedFinishMarker() {
  try {
    window.sessionStorage.removeItem(FEDERATED_FINISH_MARKER_KEY)
  } catch {
    // Nothing stored.
  }
}

/**
 * Story 6.17 D1, D2: leaves for Google's account chooser. A verified member is signed out
 * first, because the PKCE verifier and the next session must belong to the person choosing.
 * `prompt=select_account` makes a shared family device always ask which account.
 */
export async function startWebGoogleSignIn(
  options: { from?: string | null; door?: SignInDoor } = {}
) {
  if (member !== null || hasStoredWebSession()) await signOutWebSession()
  clearFederatedFinishMarker()
  const redirect = new URL('/auth/callback', window.location.origin)
  if (options.door === 'signup') redirect.searchParams.set('door', 'signup')
  if (parsePreviewFrom(options.from ?? null) !== null)
    redirect.searchParams.set('from', 'preview')
  localSignedOut = false
  const { error } = await webSupabase().auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: redirect.toString(),
      queryParams: { prompt: 'select_account' },
    },
  })
  if (error)
    throw new WebSignInError('unavailable', 'Google sign-in could not be started.')
}

function sessionStatus(error: unknown) {
  return error instanceof FederatedSignupError ? error.status : undefined
}

async function refuseFederatedIdentity(): Promise<WebOAuthOutcome> {
  clearFederatedFinishMarker()
  await signOutWebSession().catch(() => undefined)
  return { kind: 'refused' }
}

/**
 * After a session exists: a member is done; a 401 profile check asks the API whether the
 * finish step applies. `complete` gets exactly one more verification (TEA-3).
 */
async function settleFederatedSession(session: Session): Promise<WebOAuthOutcome> {
  try {
    await accept(session)
    if (member) return { kind: 'member' }
  } catch (failure) {
    if (!sessionDenied(failure)) return { kind: 'unavailable' }
  }
  let status
  try {
    status = (await fetchWebFederatedSignupStatus(session.access_token)).status
  } catch (error) {
    return sessionStatus(error) === 401
      ? refuseFederatedIdentity()
      : { kind: 'unavailable' }
  }
  if (status === 'needs_birthdate') return { kind: 'no_account' }
  if (status === 'awaiting_guardian') return { kind: 'awaiting_guardian' }
  try {
    await accept(session)
  } catch (failure) {
    if (!sessionDenied(failure)) return { kind: 'unavailable' }
  }
  return member ? { kind: 'member' } : refuseFederatedIdentity()
}

const exchanges = new Map<string, Promise<WebOAuthOutcome>>()
/**
 * The last settled exchange, so a late second delivery of the same code gets its outcome
 * instead of spending a used code; entries leave `exchanges` once they settle.
 */
let lastSettled: { code: string; flight: Promise<WebOAuthOutcome> } | undefined

/**
 * Story 6.17 D5: the callback's half of the round trip. Never throws. One exchange per
 * code, so React's double effect or a second tab shares the first attempt.
 */
/** A round trip that ends without a session leaves no PKCE verifier behind. */
function dropCodeVerifier() {
  try {
    window.localStorage.removeItem(`${authStorageKey}-code-verifier`)
  } catch {
    // Nothing stored.
  }
}

export function completeWebOAuth(params: URLSearchParams): Promise<WebOAuthOutcome> {
  const from = parsePreviewFrom(params.get('from'))
  const door = parseSignInDoor(params.get('door'))
  const providerError = params.get('error')
  if (providerError || !params.get('code')) dropCodeVerifier()
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
  const flight = (async (): Promise<WebOAuthOutcome> => {
    try {
      const { data, error } = await webSupabase().auth.exchangeCodeForSession(code)
      if (error || !data.session) {
        dropCodeVerifier()
        return { kind: 'unavailable' }
      }
      localSignedOut = false
      const outcome = await settleFederatedSession(data.session)
      if (outcome.kind === 'no_account') writeFederatedFinishMarker({ from, door })
      else clearFederatedFinishMarker()
      return outcome
    } catch {
      dropCodeVerifier()
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
 * Story 6.17 D3: where a page load should send a stored identity that has no account, or null.
 * The server decides (GET status answers needs_birthdate); the marker only carries
 * `from=preview` and the door, so a new tab with no marker still resumes.
 */
export async function resolveFederatedFinishRoute(): Promise<string | null> {
  if (member !== null || !hasStoredWebSession()) return null
  const identity = await readWebFederatedIdentity().catch(() => null)
  if (!identity) return null
  let status
  try {
    status = (await fetchWebFederatedSignupStatus(identity.accessToken)).status
  } catch {
    return null
  }
  if (status !== 'needs_birthdate' || member !== null) return null
  const marker = readFederatedFinishMarker()
  return finishStepHref(marker?.from ?? null, marker?.door ?? 'signin')
}

/** The Google identity waiting on the finish step, or null when there is none. */
export async function readWebFederatedIdentity(): Promise<{
  accessToken: string
  email: string | null
} | null> {
  if (localSignedOut) return null
  const { data, error } = await webSupabase().auth.getSession()
  if (error || !data.session) return null
  return {
    accessToken: data.session.access_token,
    email: data.session.user.email ?? null,
  }
}

export type WebFederatedFinishResult =
  | { kind: 'created'; account: SignupResponse }
  | { kind: 'signed_in' }
  | { kind: 'underage' }
  | { kind: 'guardian_minor' }
  | { kind: 'refused' }
  | { kind: 'no_session' }
  | { kind: 'unavailable' }

/**
 * Story 6.17 D3: submits the birthdate for the waiting identity. A created account is then
 * verified like any sign-in. Under 13 the server deletes the identity, so this signs out.
 */
export async function finishWebFederatedSignup(
  birthdate: string
): Promise<WebFederatedFinishResult> {
  const identity = await readWebFederatedIdentity()
  if (!identity) return { kind: 'no_session' }
  let account: SignupResponse
  try {
    account = await submitWebFederatedSignup(identity.accessToken, { birthdate })
  } catch (error) {
    const status = sessionStatus(error)
    if (status === 409) {
      const { data } = await webSupabase().auth.getSession()
      if (!data.session) return { kind: 'no_session' }
      const outcome = await settleFederatedSession(data.session)
      if (outcome.kind === 'member') {
        clearFederatedFinishMarker()
        return { kind: 'signed_in' }
      }
      return outcome.kind === 'refused' ? { kind: 'refused' } : { kind: 'unavailable' }
    }
    if (status === 403) {
      if (
        error instanceof FederatedSignupError &&
        error.code === 'federated_guardian_minor'
      )
        return { kind: 'guardian_minor' }
      clearFederatedFinishMarker()
      await signOutWebSession().catch(() => undefined)
      return { kind: 'underage' }
    }
    if (status === 401) {
      await refuseFederatedIdentity()
      return { kind: 'refused' }
    }
    return { kind: 'unavailable' }
  }
  clearFederatedFinishMarker()
  const { data } = await webSupabase().auth.getSession()
  if (data.session) {
    try {
      await accept(data.session)
    } catch {
      // The account exists; the bridge's own verification retries the session.
    }
  }
  return { kind: 'created', account }
}

/** Story 6.17 D3 Cancel: deletes a waiting identity that has no account, then signs out. */
export async function cancelWebFederatedSignup(): Promise<void> {
  const identity = await readWebFederatedIdentity()
  clearFederatedFinishMarker()
  try {
    if (identity) await abandonWebFederatedSignup(identity.accessToken)
  } catch {
    // The orphan sweep removes an identity whose deletion did not land.
  } finally {
    await signOutWebSession().catch(() => undefined)
  }
}
