// Learning path Step 43: Realtime engagement and push notifications.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-43-realtime-engagement-and-push-notifications
import { describe, expect, it } from 'vitest'
import { Configuration, DefaultApi, ResponseError } from '../src/generated'
import { communitySyncClient } from '../src/community-sync-client'

/**
 * A handled error response whose body is never read or cancelled keeps its loader and
 * connection until GC. Repeated resync (409) or denial (403) answers then exhaust the
 * per-host pool and stall later requests. The stream here records whether the client
 * released it.
 */
function trackedResponse(status: number, body: unknown) {
  const state = { cancelled: false, drained: false }
  const bytes = new TextEncoder().encode(JSON.stringify(body))
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.enqueue(bytes)
      controller.close()
      state.drained = true
    },
    cancel() {
      state.cancelled = true
    },
  })
  const response = new Response(stream, {
    status,
    headers: { 'content-type': 'application/json' },
  })
  return {
    response,
    released: () => state.cancelled || (response.bodyUsed && state.drained),
  }
}
function client(response: Response) {
  return communitySyncClient(
    new DefaultApi(
      new Configuration({
        basePath: 'https://api.synthetic.test',
        fetchApi: () => Promise.resolve(response),
      })
    )
  )
}
async function rejection(work: Promise<unknown>) {
  const error = await work.then(
    () => {
      throw new Error('Expected the request to fail')
    },
    (reason: unknown) => reason
  )
  expect(error).toBeInstanceOf(ResponseError)
  return error as ResponseError
}

describe('community sync client error bodies', () => {
  it.each([
    [409, { statusCode: 409, message: 'Resync required.', error: 'Conflict' }],
    [
      403,
      { statusCode: 403, message: 'Community account unavailable.', error: 'Forbidden' },
    ],
    [503, { statusCode: 503, code: 'unavailable', retryAfterSeconds: 2 }],
  ])(
    'releases a handled %i events body and keeps the typed status',
    async (status, body) => {
      const tracked = trackedResponse(status, body)
      const error = await rejection(client(tracked.response).events('all', 'cursor'))
      expect(tracked.released()).toBe(true)
      expect(error.response.status).toBe(status)
    }
  )

  it('passes an error whose body was already read through with its original response', async () => {
    const response = new Response(JSON.stringify({ statusCode: 403 }), { status: 403 })
    await response.text()
    const error = await rejection(client(response).events('all', 'cursor'))
    // Nothing is left to drain or buffer, so the caller sees the response it was given.
    expect(error.response).toBe(response)
    expect(error.response.status).toBe(403)
  })

  it('releases a handled 403 target resolution body', async () => {
    const tracked = trackedResponse(403, { statusCode: 403, error: 'Forbidden' })
    const error = await rejection(
      client(tracked.response).resolve({ targets: [{ key: 'post-1', postId: 'post-1' }] })
    )
    expect(tracked.released()).toBe(true)
    expect(error.response.status).toBe(403)
  })

  it('releases a 409 registration body while its typed conflict code stays readable', async () => {
    const tracked = trackedResponse(409, {
      statusCode: 409,
      code: 'binding_changed',
      message: 'Binding changed.',
    })
    const error = await rejection(
      client(tracked.response).register({
        token: 'ExpoPushToken[synthetic]',
        installationId: '6f4d8a52-58f5-4a1f-9a2e-0f2b8c1d9e10',
        platform: 'ios',
        permission: 'granted',
      })
    )
    expect(tracked.released()).toBe(true)
    expect(error.response).toBeInstanceOf(Response)
    expect(error.response.status).toBe(409)
    expect(error.response.headers.get('content-type')).toBe('application/json')
    // Native `bindingConflict` reads the code through a clone; that read must still work.
    await expect(error.response.clone().json()).resolves.toMatchObject({
      code: 'binding_changed',
    })
  })
})
