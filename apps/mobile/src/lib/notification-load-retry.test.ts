import { describe, expect, it } from 'vitest'
import {
  LOAD_RETRY_DELAYS_MS,
  MAX_RETRY_AFTER_MS,
  nextRetryDelayMs,
  retryAfterMs,
} from './notification-load-retry'

const failure = (
  status: number,
  body: unknown,
  headers: Record<string, string> = {}
) => ({
  response: new Response(JSON.stringify(body), { status, headers }),
})

describe('retryAfterMs', () => {
  it('reads retryAfterSeconds from a 503 body and leaves the body readable', async () => {
    const error = failure(503, { code: 'unavailable', retryAfterSeconds: 2 })
    expect(await retryAfterMs(error)).toBe(2000)
    expect(await error.response.json()).toMatchObject({ code: 'unavailable' })
  })

  it('prefers a Retry-After header and rounds fractions up', async () => {
    expect(
      await retryAfterMs(failure(503, { retryAfterSeconds: 9 }, { 'retry-after': '1.2' }))
    ).toBe(1200)
    expect(await retryAfterMs(failure(503, { retryAfterSeconds: 0.2 }))).toBe(200)
  })

  it('bounds an excessive request', async () => {
    expect(await retryAfterMs(failure(503, { retryAfterSeconds: 3600 }))).toBe(
      MAX_RETRY_AFTER_MS
    )
  })

  it('ignores other statuses, bad bodies and non-HTTP errors', async () => {
    expect(await retryAfterMs(failure(500, { retryAfterSeconds: 2 }))).toBeUndefined()
    expect(await retryAfterMs(failure(503, { retryAfterSeconds: -1 }))).toBeUndefined()
    expect(
      await retryAfterMs(failure(503, { retryAfterSeconds: 'soon' }))
    ).toBeUndefined()
    expect(await retryAfterMs(failure(503, 'not an object'))).toBeUndefined()
    expect(
      await retryAfterMs({ response: new Response('{', { status: 503 }) })
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
