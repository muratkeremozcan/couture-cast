/**
 * Why native sign-in failed, in terms a person can act on: `denied` means this address has
 * no CoutureCast account that can sign in (retrying will not help), `code_invalid` means the
 * code was wrong or expired, and `unavailable` is a transient failure worth retrying.
 * Kept free of SDK imports so the screen and its tests can use it directly.
 */
export type NativeSignInFailure = 'denied' | 'code_invalid' | 'unavailable'
export class NativeSignInError extends Error {
  constructor(
    readonly reason: NativeSignInFailure,
    message: string
  ) {
    super(message)
    this.name = 'NativeSignInError'
  }
}
/**
 * Auth answers a wrong or expired code with a 4xx. A 429 rate limit and anything else are
 * not the code's fault, so they read as a temporary failure.
 */
export function codeRejected(error: unknown) {
  if (!error || typeof error !== 'object' || !('status' in error)) return false
  const status: unknown = error.status
  return typeof status === 'number' && status >= 400 && status < 500 && status !== 429
}
