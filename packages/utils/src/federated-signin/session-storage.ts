/**
 * Story 6.17: the stored sign-in session never holds a Google token.
 *
 * After a Google sign-in, Supabase returns the session with `provider_token` (Google's
 * short-lived access token) and sometimes `provider_refresh_token`. CoutureCast never calls
 * Google with them, so both clients wrap their auth storage with this adapter, which drops
 * both fields before the session reaches localStorage or SecureStore. Reads strip them too,
 * so a session stored before this change loses them on its next load.
 */
export type AuthSessionStorage = {
  getItem: (key: string) => string | null | Promise<string | null>
  setItem: (key: string, value: string) => void | Promise<void>
  removeItem: (key: string) => void | Promise<void>
}

const PROVIDER_TOKEN_FIELDS = ['provider_token', 'provider_refresh_token'] as const

/** Returns the stored session JSON without Google's tokens; anything else passes unchanged. */
export function stripProviderTokens(value: string): string {
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    return value
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return value
  const session = parsed as Record<string, unknown>
  if (!PROVIDER_TOKEN_FIELDS.some((field) => field in session)) return value
  const kept = { ...session }
  for (const field of PROVIDER_TOKEN_FIELDS) delete kept[field]
  return JSON.stringify(kept)
}

/**
 * Wraps auth storage so the session stored under `sessionKey` carries no Google token.
 * Other keys (the PKCE verifier) pass through untouched.
 */
export function withoutProviderTokens(
  storage: AuthSessionStorage,
  sessionKey: string
): AuthSessionStorage {
  return {
    getItem: async (key) => {
      const value = await storage.getItem(key)
      return key === sessionKey && value !== null ? stripProviderTokens(value) : value
    },
    setItem: (key, value) =>
      storage.setItem(key, key === sessionKey ? stripProviderTokens(value) : value),
    removeItem: (key) => storage.removeItem(key),
  }
}
