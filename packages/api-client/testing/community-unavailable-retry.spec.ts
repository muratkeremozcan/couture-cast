// Story 6.6: the single bounded retry of a gate refusal marked unavailable.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ResponseError } from '../src/generated/runtime'
import {
  COMMUNITY_UNAVAILABLE_MAX_RETRY_SECONDS,
  retryOnceWhenCommunityUnavailable,
} from '../src/community-unavailable-retry'

const refusal = (status: number, body: unknown) =>
  new ResponseError(new Response(JSON.stringify(body), { status }), 'refused')
const unavailable = (retryAfterSeconds: number) =>
  refusal(503, {
    statusCode: 503,
    code: 'unavailable',
    retryAfterSeconds,
    message: 'Access could not be verified.',
  })

describe('6.6 community unavailable retry', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('6.6-CON-010 waits the advised seconds and retries exactly once', async () => {
    const work = vi
      .fn()
      .mockRejectedValueOnce(unavailable(2))
      .mockResolvedValueOnce('page')
    const result = retryOnceWhenCommunityUnavailable(work)
    await vi.advanceTimersByTimeAsync(1999)
    expect(work).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    await expect(result).resolves.toBe('page')
    expect(work).toHaveBeenCalledTimes(2)
  })

  it('6.6-CON-011 caps the pause and lets a second refusal propagate with a readable body', async () => {
    const second = unavailable(45)
    const work = vi
      .fn()
      .mockRejectedValueOnce(unavailable(45))
      .mockRejectedValueOnce(second)
    const result = retryOnceWhenCommunityUnavailable(work)
    const settled = expect(result).rejects.toBe(second)
    await vi.advanceTimersByTimeAsync(COMMUNITY_UNAVAILABLE_MAX_RETRY_SECONDS * 1000)
    await settled
    expect(work).toHaveBeenCalledTimes(2)
    await expect(second.response.json()).resolves.toMatchObject({ code: 'unavailable' })
  })

  it('6.6-CON-012 never retries a refusal that is not an unavailable 503', async () => {
    for (const error of [
      refusal(503, { statusCode: 503, message: 'Community read rollout is disabled.' }),
      refusal(403, { statusCode: 403, code: 'denied', message: 'Denied.' }),
      new Error('network down'),
    ]) {
      const work = vi.fn().mockRejectedValue(error)
      await expect(retryOnceWhenCommunityUnavailable(work)).rejects.toBe(error)
      expect(work).toHaveBeenCalledTimes(1)
    }
  })

  it('6.6-CON-013 stops waiting when the caller aborts', async () => {
    const controller = new AbortController()
    const work = vi.fn().mockRejectedValueOnce(unavailable(2))
    const result = retryOnceWhenCommunityUnavailable(work, controller.signal)
    const settled = expect(result).rejects.toMatchObject({ name: 'AbortError' })
    controller.abort()
    await settled
    expect(work).toHaveBeenCalledTimes(1)
  })
})
