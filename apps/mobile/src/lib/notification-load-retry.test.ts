import { describe, expect, it } from 'vitest'
import {
  COMMUNITY_UNAVAILABLE_MAX_RETRY_SECONDS,
  ResponseError,
} from '@couture/api-client'
import {
  LOAD_RETRY_DELAYS_MS,
  nextRetryDelayMs,
  retryAfterMs,
} from './notification-load-retry'

const failure = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new ResponseError(new Response(JSON.stringify(body), { status, headers }), 'failed')

describe('retryAfterMs', () => {
  it('reads retryAfterSeconds from a 503 body and leaves the body readable', async () => {
    const error = failure(503, { code: 'unavailable', retryAfterSeconds: 2 })
    expect(await retryAfterMs(error)).toBe(2000)
    expect(await error.response.json()).toMatchObject({ code: 'unavailable' })
  })

  it('reads the hint one way, like every other community read: the body of a 503 marked unavailable', async () => {
    // A Retry-After header alone, or a body without the unavailable code, is not a retry hint.
    expect(
      await retryAfterMs(failure(503, { retryAfterSeconds: 9 }, { 'retry-after': '1.2' }))
    ).toBeUndefined()
    expect(await retryAfterMs(failure(503, { retryAfterSeconds: 2 }))).toBeUndefined()
    expect(
      await retryAfterMs(failure(503, { code: 'other', retryAfterSeconds: 2 }))
    ).toBeUndefined()
    expect(
      await retryAfterMs(failure(503, { code: 'unavailable', retryAfterSeconds: 0.2 }))
    ).toBe(200)
  })

  it('bounds an excessive request', async () => {
    // The shared community cap: the same five seconds every other read honours.
    expect(
      await retryAfterMs(failure(503, { code: 'unavailable', retryAfterSeconds: 3600 }))
    ).toBe(COMMUNITY_UNAVAILABLE_MAX_RETRY_SECONDS * 1000)
  })

  it('ignores other statuses, bad bodies and non-HTTP errors', async () => {
    expect(await retryAfterMs(failure(500, { retryAfterSeconds: 2 }))).toBeUndefined()
    expect(await retryAfterMs(failure(503, { retryAfterSeconds: -1 }))).toBeUndefined()
    expect(
      await retryAfterMs(failure(503, { retryAfterSeconds: 'soon' }))
    ).toBeUndefined()
    expect(await retryAfterMs(failure(503, 'not an object'))).toBeUndefined()
    expect(
      await retryAfterMs(new ResponseError(new Response('{', { status: 503 }), 'failed'))
    ).toBeUndefined()
    expect(await retryAfterMs(new Error('network'))).toBeUndefined()
    expect(await retryAfterMs(undefined)).toBeUndefined()
  })
})

describe('nextRetryDelayMs', () => {
  it('uses the schedule as the floor and the request when it asks for more', () => {
    expect(nextRetryDelayMs(1500)).toBe(1500)
    expect(nextRetryDelayMs(1500, 800)).toBe(1500)
    expect(nextRetryDelayMs(1500, 2000)).toBe(2000)
    expect(LOAD_RETRY_DELAYS_MS.length).toBe(3)
  })
})
