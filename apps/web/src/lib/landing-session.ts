// Owner report 2026-11-16, iPhone Safari: Google sign-in succeeded, but the landing still offered
// Start signup and Sign in, so a signed-in teen ran Google again: a sign-in loop from the
// person's side. The session lives in this browser's storage, which the server never sees, so
// the server cannot render the member landing. Instead an inline script in the document head
// names the state on <html data-session> before first paint, and CSS shows the matching landing
// actions (globals.css). SessionBridge keeps the attribute current afterwards.
//
//   member   this tab holds a verified bearer and the stored session it came from;
//   pending  a stored session that this page has not verified yet: neither set of actions shows,
//            so a member never sees Sign in and an identity without an account never sees the
//            member actions (it goes on to the finish step);
//   none     signed out, or verification ended without a member.
export type LandingSession = 'member' | 'pending' | 'none'

export const LANDING_SESSION_ATTRIBUTE = 'data-session'
/** Supabase's stored session (web-session.ts, authStorageKey). */
export const AUTH_SESSION_STORAGE_KEY = 'couturecast.auth-session'
/**
 * The verified bearer this tab holds: wardrobe.ts WEB_ACCESS_TOKEN_STORAGE_KEY, repeated here
 * because the root layout (a server component) renders the head script and cannot import a
 * client module. landing-session.test.ts pins the two together.
 */
export const LANDING_BEARER_STORAGE_KEY = 'couturecast.access-token'

type StorageReader = Pick<Storage, 'getItem'>

/**
 * The one decision, from the raw stored values. Self-contained (no imports, no closures, no
 * syntax that compiles to a helper) because its own source is inlined into the head script, so
 * the head script and the page can never decide differently.
 *
 * A stored session counts only when it parses and carries a refresh token and a numeric expiry
 * (TEA H-2: corrupt storage is signed out). A member needs this tab's verified bearer and a
 * stored session that has not expired (TEA H-1: an expired session may be revoked, so it waits
 * for the refresh instead of painting the member landing). `settled` is true once this page's
 * session start finished: a stored session it did not turn into a member is then signed out.
 * `e2eAuth` accepts the local end-to-end fixture bearer, which has no stored Supabase session.
 */
export function decideLandingSession(
  stored: string | null,
  bearer: string | null,
  settled: boolean,
  e2eAuth: boolean,
  now: number
): LandingSession {
  let session: { expires_at?: unknown; refresh_token?: unknown } | null = null
  if (stored !== null) {
    try {
      session = JSON.parse(stored) as { expires_at?: unknown; refresh_token?: unknown }
    } catch {
      session = null
    }
  }
  const valid =
    session !== null &&
    typeof session === 'object' &&
    typeof session.expires_at === 'number' &&
    typeof session.refresh_token === 'string' &&
    session.refresh_token !== ''
  const live = valid && (session!.expires_at as number) * 1000 > now
  const token = (bearer || '').trim()
  const fixture = e2eAuth && token.indexOf('test-token') === 0
  if (token !== '' && (live || fixture)) return 'member'
  if (valid && !settled) return 'pending'
  return 'none'
}

/** The state from this browser's two stores. */
export function landingSessionFrom(
  storage: { local: StorageReader; session: StorageReader },
  options: { settled: boolean; e2eAuth: boolean; now?: number }
): LandingSession {
  return decideLandingSession(
    storage.local.getItem(AUTH_SESSION_STORAGE_KEY),
    storage.session.getItem(LANDING_BEARER_STORAGE_KEY),
    options.settled,
    options.e2eAuth,
    options.now ?? Date.now()
  )
}

const e2eAuth = () => process.env.NEXT_PUBLIC_E2E_AUTH === 'true'

/** Reads the state in this browser; `none` where storage is blocked. */
export function readLandingSession(settled: boolean): LandingSession {
  try {
    return landingSessionFrom(
      { local: window.localStorage, session: window.sessionStorage },
      { settled, e2eAuth: e2eAuth() }
    )
  } catch {
    return 'none'
  }
}

/** Writes the state onto <html>, where the landing's CSS reads it. */
export function applyLandingSession(session: LandingSession) {
  document.documentElement.setAttribute(LANDING_SESSION_ATTRIBUTE, session)
}

/**
 * The head script: decideLandingSession's own source, run with `settled` false before React
 * or any paint. Storage that throws leaves the page signed out, silently (TEA H-2). It writes
 * only the state word (TEA H-5).
 */
export function landingSessionScript(options: { e2eAuth: boolean }): string {
  return `(function(){var s='none';try{s=(${decideLandingSession.toString()})(window.localStorage.getItem(${JSON.stringify(
    AUTH_SESSION_STORAGE_KEY
  )}),window.sessionStorage.getItem(${JSON.stringify(
    LANDING_BEARER_STORAGE_KEY
  )}),false,${options.e2eAuth ? 'true' : 'false'},Date.now())}catch(e){s='none'}if(s!=='member'&&s!=='pending')s='none';document.documentElement.setAttribute(${JSON.stringify(
    LANDING_SESSION_ATTRIBUTE
  )},s)})()`
}
