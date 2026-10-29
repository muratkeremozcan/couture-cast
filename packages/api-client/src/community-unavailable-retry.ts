// Story 6.6 owner: one bounded retry of a read the community gate refused as unavailable.
import { ResponseError } from './generated/runtime'
import { abortError } from './request-deadline'

/** The longest pause a client honours before its single retry. */
export const COMMUNITY_UNAVAILABLE_MAX_RETRY_SECONDS = 5

/**
 * The read gate fails fast under lock or pool contention and answers a 503 with
 * `code: 'unavailable'` and `retryAfterSeconds` in its body. That refusal is
 * retryable by contract, so a read waits the advised seconds (capped) and tries
 * exactly once more. Any other failure, including a second refusal, propagates.
 */
export async function retryOnceWhenCommunityUnavailable<T>(
  work: () => Promise<T>,
  signal?: AbortSignal | null
): Promise<T> {
  try {
    return await work()
  } catch (error: unknown) {
    const seconds = await communityUnavailableRetrySeconds(error)
    if (seconds === undefined) throw error
    await pause(seconds * 1000, signal)
    return work()
  }
}

/**
 * The advised wait, in seconds and capped, of a 503 the community gate marked unavailable; any
 * other failure has no hint. Every client reads the retry hint through this one function.
 */
export async function communityUnavailableRetrySeconds(
  error: unknown
): Promise<number | undefined> {
  if (!(error instanceof ResponseError) || error.response.status !== 503) return undefined
  try {
    // A clone, so the caller can still read the body to classify a second failure.
    const body: unknown = await error.response.clone().json()
    if (typeof body !== 'object' || body === null) return undefined
    const { code, retryAfterSeconds } = body as {
      code?: unknown
      retryAfterSeconds?: unknown
    }
    if (code !== 'unavailable' || typeof retryAfterSeconds !== 'number') return undefined
    if (!Number.isFinite(retryAfterSeconds) || retryAfterSeconds < 0) return undefined
    return Math.min(retryAfterSeconds, COMMUNITY_UNAVAILABLE_MAX_RETRY_SECONDS)
  } catch {
    return undefined
  }
}

function pause(ms: number, signal?: AbortSignal | null): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError('The request was aborted.'))
      return
    }
    const onAbort = () => {
      clearTimeout(timer)
      reject(abortError('The request was aborted.'))
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}
