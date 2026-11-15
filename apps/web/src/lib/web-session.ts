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
  type SignInDoor,
} from '@couture/utils'
import { createWebApiClient } from './api-client'
import {
  abandonWebFederatedSignup,
  FederatedSignupError,
  fetchWebFederatedSignupStatus,
  submitWebFederatedSignup,
} from './signup'
import { WEB_ACCESS_TOKEN_STORAGE_KEY } from './wardrobe'
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
export const webSessionIdentity = () => member
/** A stored session that verification has not yet named a member for, or cleared. */
export const hasStoredWebSession = () =>
  !localSignedOut && window.localStorage.getItem(authStorageKey) !== null
/**
 * Why sign-in failed, in terms a person can act on: `denied` means this address has no
 * CoutureCast account that can sign in (retrying will not help); `code_invalid` means the
 * code was wrong or expired; `unavailable` means a transient failure worth retrying.
 */
export type WebSignInFailure = 'denied' | 'code_invalid' | 'unavailable'
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
export function webSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) throw new Error('Sign-in is unavailable.')
  client ??= createClient(url, key, {
    auth: {
      storageKey: authStorageKey,
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
  if (session.expires_at !== undefined && session.expires_at * 1000 - Date.now() <= 5000)
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
    member = null
    acceptedToken = null
    window.sessionStorage.removeItem(WEB_ACCESS_TOKEN_STORAGE_KEY)
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
    member = profile.user.id
    acceptedToken = session.access_token
    window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, session.access_token)
    // Token refresh preserves same-owner draft/cache scope; account switching changes identity.
    publishIdentity()
  } catch (error) {
    if (request !== generation) {
      if (localSignedOut) return
      throw new Error('Session verification is unavailable.')
    }
    if (changed || sessionDenied(error)) {
      member = null
      acceptedToken = null
      window.sessionStorage.removeItem(WEB_ACCESS_TOKEN_STORAGE_KEY)
      if (previous !== null) publishIdentity()
    }
    throw error
  }
}
export async function startWebSession() {
  const fixture = window.sessionStorage.getItem(WEB_ACCESS_TOKEN_STORAGE_KEY)
  if (process.env.NEXT_PUBLIC_E2E_AUTH === 'true' && fixture?.startsWith('test-token'))
    return () => undefined
  const auth = webSupabase().auth
  let stopped = false
  const { data } = auth.onAuthStateChange((_event, session) => {
    setTimeout(() => {
      if (!stopped && !localSignedOut) void accept(session).catch(() => undefined)
    }, 0)
  })
  const cleanup = () => {
    stopped = true
    generation++
    verification = undefined
    data.subscription.unsubscribe()
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
    // A 401/403/404 account check is the server saying this identity has no account.
    throw new WebSignInError(
      sessionDenied(failure) ? 'denied' : 'unavailable',
      'Session verification is unavailable.'
    )
  }
  if (!member) throw new WebSignInError('denied', 'This account is unavailable.')
}
export async function signOutWebSession() {
  localSignedOut = true
  generation++
  verification = undefined
  member = null
  principal = null
  acceptedToken = null
  window.sessionStorage.removeItem(WEB_ACCESS_TOKEN_STORAGE_KEY)
  clearFederatedFinishMarker()
  window.dispatchEvent(new Event('couture:session'))
  try {
    await webSupabase().auth.signOut({ scope: 'local' })
  } finally {
    window.localStorage.removeItem(authStorageKey)
    window.localStorage.removeItem(`${authStorageKey}-code-verifier`)
  }
}

/** Story 6.17: what a finished Google round trip means for the person. */
export type WebOAuthOutcome =
  | { kind: 'member' }
  | { kind: 'no_account' }
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
    const raw = window.sessionStorage.getItem(FEDERATED_FINISH_MARKER_KEY)
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
    status = await fetchWebFederatedSignupStatus(session.access_token)
  } catch (error) {
    return sessionStatus(error) === 401
      ? refuseFederatedIdentity()
      : { kind: 'unavailable' }
  }
  if (status === 'needs_birthdate') return { kind: 'no_account' }
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
    status = await fetchWebFederatedSignupStatus(identity.accessToken)
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
