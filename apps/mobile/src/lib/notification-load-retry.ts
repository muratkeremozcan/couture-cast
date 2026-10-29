// Waits before each retry of a settings load that ended without settings (about 10 s in total).
export const LOAD_RETRY_DELAYS_MS = [1500, 3000, 6000]
// A retryable answer may ask for a longer wait than the schedule; this bounds how long.
export const MAX_RETRY_AFTER_MS = 10_000

/**
 * The wait a failed request asked for: the `Retry-After` header, else the `retryAfterSeconds` of
 * a 503 body (the API's "access could not be verified" answer). Anything else is no request.
 */
export async function retryAfterMs(error: unknown): Promise<number | undefined> {
  const response: unknown =
    error && typeof error === 'object' && 'response' in error ? error.response : undefined
  if (!(response instanceof Response) || response.status !== 503) return undefined
  let seconds = Number(response.headers.get('retry-after'))
  if (!Number.isFinite(seconds) || seconds <= 0) {
    try {
      const body: unknown = await response.clone().json()
      seconds =
        typeof body === 'object' && body !== null && 'retryAfterSeconds' in body
          ? Number(body.retryAfterSeconds)
          : NaN
    } catch {
      return undefined
    }
  }
  return Number.isFinite(seconds) && seconds > 0
    ? Math.min(Math.ceil(seconds * 1000), MAX_RETRY_AFTER_MS)
    : undefined
}

/** The scheduled delay, raised to the requested wait when the server asked for more. */
export const nextRetryDelayMs = (scheduled: number, requested?: number) =>
  Math.max(scheduled, requested ?? 0)
