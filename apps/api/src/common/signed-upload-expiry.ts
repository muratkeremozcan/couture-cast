/**
 * How long a Supabase Storage signed upload token lets a request start. Storage sets this per
 * deployment and clients cannot shorten it: Supabase documents 2 hours, and the storage server
 * checks the token's expiry when a request starts, before it reads the body.
 */
export const SIGNED_UPLOAD_LIFETIME_MS = 2 * 60 * 60 * 1000

/** Allowance for the storage server's clock when reading a token's expiry. */
const TOKEN_CLOCK_SKEW_MS = 60 * 1000

/**
 * The expiry written in a signed upload token, or null when the token cannot be read, has
 * already expired, or lives longer than `SIGNED_UPLOAD_LIFETIME_MS`. Callers fail closed on
 * null: windows sized for the documented lifetime (community erasure, the upload windows that
 * clients are told) do not hold for a deployment that signs longer tokens.
 */
export function signedUploadExpiry(token: string): Date | null {
  const payload = token.split('.')[1]
  let exp: unknown
  try {
    exp = (
      JSON.parse(Buffer.from(payload ?? '', 'base64url').toString()) as { exp?: unknown }
    ).exp
  } catch {
    return null
  }
  if (typeof exp !== 'number') return null
  const expiresAt = new Date(exp * 1000)
  const latest = Date.now() + SIGNED_UPLOAD_LIFETIME_MS + TOKEN_CLOCK_SKEW_MS
  if (expiresAt.getTime() > latest || expiresAt.getTime() <= Date.now()) {
    return null
  }
  return expiresAt
}
