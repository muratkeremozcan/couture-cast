'use client'
// Story 6.5 owner: verified OTP session bridge into the existing bearer boundary.
import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js'
import { userProfileResponseSchema } from '@couture/api-client/contracts/http'
import { createWebApiClient } from './api-client'
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
      detectSessionInUrl: true,
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
  window.dispatchEvent(new Event('couture:session'))
  try {
    await webSupabase().auth.signOut({ scope: 'local' })
  } finally {
    window.localStorage.removeItem(authStorageKey)
    window.localStorage.removeItem(`${authStorageKey}-code-verifier`)
  }
}
