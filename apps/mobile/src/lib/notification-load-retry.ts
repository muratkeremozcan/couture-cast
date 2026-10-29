import { communityUnavailableRetrySeconds } from '@couture/api-client'

// Waits before each retry of a settings load that ended without settings. A retryable 503 raises
// a wait to its advised seconds (at most 5), so the worst case is 5 + 5 + 6 = 16 s of waiting
// plus four request times; with no advice it is 10.5 s plus the requests.
export const LOAD_RETRY_DELAYS_MS = [1500, 3000, 6000]

/**
 * The wait a failed request asked for, in ms: the retry hint of a 503 the community gate marked
 * unavailable, read and capped by the shared client helper like every other community read.
 */
export async function retryAfterMs(error: unknown): Promise<number | undefined> {
  const seconds = await communityUnavailableRetrySeconds(error)
  return seconds === undefined ? undefined : Math.ceil(seconds * 1000)
}

/** The scheduled delay, raised to the requested wait when the server asked for more. */
export const nextRetryDelayMs = (scheduled: number, requested?: number) =>
  Math.max(scheduled, requested ?? 0)
