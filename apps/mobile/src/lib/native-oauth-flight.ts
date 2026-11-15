/**
 * Story 6.17 D5: true while a Google round trip runs in this process. `openAuthSessionAsync`
 * hands the callback URL back in process; the OS may also deliver the same link to the router,
 * and `+native-intent` drops it then, so the screen that started sign-in stays put. With no
 * round trip in flight (a cold start from the link), the router opens `/auth/callback`.
 */
let inFlight = false

export function isNativeOAuthInFlight(): boolean {
  return inFlight
}

export function setNativeOAuthInFlight(value: boolean): void {
  inFlight = value
}

/**
 * The OAuth callback link on any of the app's schemes: `<scheme>://auth/callback`, or Expo
 * Go's `exp://<host>/--/auth/callback`. Nothing else matches, a longer or prefixed path
 * included.
 */
export function isNativeOAuthCallbackPath(path: string): boolean {
  let url: URL
  try {
    url = new URL(path)
  } catch {
    return false
  }
  if (url.protocol === 'exp:') return url.pathname === '/--/auth/callback'
  return url.host === 'auth' && url.pathname === '/callback'
}
