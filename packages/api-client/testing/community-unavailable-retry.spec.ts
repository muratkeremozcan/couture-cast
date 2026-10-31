// Learning path Step 44: Community city spotlight.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-44-community-city-spotlight
// Story 6.6: the single bounded retry of a gate refusal marked unavailable.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ResponseError } from '../src/generated/runtime'
import {
  COMMUNITY_UNAVAILABLE_MAX_RETRY_SECONDS,
  communityUnavailableRetrySeconds,
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
    // The advised 45 seconds are capped: no retry one millisecond short of the
    // cap, the retry exactly at it.
    await vi.advanceTimersByTimeAsync(COMMUNITY_UNAVAILABLE_MAX_RETRY_SECONDS * 1000 - 1)
    expect(work).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
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

  it('6.6-CON-012a never retries a 503 whose body is not JSON and leaves that body readable', async () => {
    const error = new ResponseError(
      new Response('Service Unavailable', { status: 503 }),
      'refused'
    )
    const work = vi.fn().mockRejectedValue(error)
    await expect(retryOnceWhenCommunityUnavailable(work)).rejects.toBe(error)
    expect(work).toHaveBeenCalledTimes(1)
    await expect(error.response.text()).resolves.toBe('Service Unavailable')
  })

  it('6.6-CON-012b never retries an unavailable 503 that advises no usable pause', async () => {
    for (const error of [
      refusal(503, null),
      refusal(503, 'unavailable'),
      unavailable(-1),
    ]) {
      const work = vi.fn().mockRejectedValue(error)
      await expect(retryOnceWhenCommunityUnavailable(work)).rejects.toBe(error)
      expect(work).toHaveBeenCalledTimes(1)
    }
  })

  it('6.6-CON-013 stops waiting when the caller aborts during the pause', async () => {
    const controller = new AbortController()
    const work = vi.fn().mockRejectedValueOnce(unavailable(2))
    let outcome: unknown = 'pending'
    void retryOnceWhenCommunityUnavailable(work, controller.signal).then(
      (value: unknown) => (outcome = { resolved: value }),
      (error: unknown) => (outcome = error)
    )
    await vi.advanceTimersByTimeAsync(1000)
    expect(work).toHaveBeenCalledTimes(1)
    controller.abort()
    // Settled without moving the clock: the abort ends the pause itself.
    await vi.advanceTimersByTimeAsync(0)
    expect(outcome).toMatchObject({ name: 'AbortError' })
    // Past the advised two seconds, the retry still never runs.
    await vi.advanceTimersByTimeAsync(2000)
    expect(work).toHaveBeenCalledTimes(1)
  })

  it('6.6-CON-014 never starts the pause when the caller aborted first', async () => {
    const controller = new AbortController()
    const work = vi.fn().mockRejectedValueOnce(unavailable(2))
    const result = retryOnceWhenCommunityUnavailable(work, controller.signal)
    const settled = expect(result).rejects.toMatchObject({ name: 'AbortError' })
    controller.abort()
    await settled
    await vi.advanceTimersByTimeAsync(2000)
    expect(work).toHaveBeenCalledTimes(1)
  })
})

describe('community unavailable retry hint, read by every client', () => {
  it('returns the advised seconds, capped, only for a 503 marked unavailable', async () => {
    expect(await communityUnavailableRetrySeconds(unavailable(2))).toBe(2)
    expect(await communityUnavailableRetrySeconds(unavailable(3600))).toBe(
      COMMUNITY_UNAVAILABLE_MAX_RETRY_SECONDS
    )
    expect(
      await communityUnavailableRetrySeconds(refusal(503, { retryAfterSeconds: 2 }))
    ).toBeUndefined()
    expect(
      await communityUnavailableRetrySeconds(
        refusal(500, { code: 'unavailable', retryAfterSeconds: 2 })
      )
    ).toBeUndefined()
    expect(await communityUnavailableRetrySeconds(new Error('network'))).toBeUndefined()
  })

  it('leaves the response body readable for the caller', async () => {
    const error = unavailable(2)
    await communityUnavailableRetrySeconds(error)
    expect(await error.response.json()).toMatchObject({ code: 'unavailable' })
  })
})
