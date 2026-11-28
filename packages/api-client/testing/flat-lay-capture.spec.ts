// Learning path Step 86: Several garments from one flat-lay photo.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-86-several-garments-from-one-flat-lay-photo
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createFlatLayClient, FlatLayCapture } from '../src/flat-lay-capture'
import {
  flatLayConfirmInputSchema,
  flatLayConfirmResponseSchema,
  flatLayReviewResponseSchema,
  flatLayTagsSchema,
} from '../src/contracts/http'

const source = { account: 'synthetic-flat-lay-owner', epoch: 1 }
const baseUrl = 'https://api.example.test'
const fixedTime = '2026-11-28T14:00:00.000Z'
const lifetime = 15 * 60_000
const first = {
  id: 'a5e5d098-ca6a-4222-a01e-171824992f38',
  mask: 'UklGRh4AAABXRUJQVlA4TBEAAAAvA8AAAAfQn7JWqv+BiOh/AAA=',
  token: 'synthetic-top-token',
}
const second = {
  id: 'aa72d0a9-bad6-47a4-aa99-5be296e3e0f2',
  mask: 'UklGRh4AAABXRUJQVlA4TBEAAAAvA8AAAAdQns50sP+BiOh/AAA=',
  token: 'synthetic-bottom-token',
}
const saved = flatLayConfirmResponseSchema.parse({
  garments: [
    {
      id: first.id,
      status: 'ready',
      category: 'outerwear',
      material: 'wool',
      comfortRange: null,
      tagsConfirmedAt: fixedTime,
      fileSizeBytes: 42,
      mimeType: 'image/webp',
      retentionStatus: 'active',
      createdAt: fixedTime,
      committedAt: fixedTime,
      imageAccess: null,
    },
  ],
})

function accepted(expiresAt = new Date(Date.now() + lifetime).toISOString()) {
  return Response.json(
    flatLayReviewResponseSchema.parse({
      items: [
        { ...first, category: null },
        { ...second, category: 'bottom' },
      ],
      expiresAt,
    })
  )
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function selection(body: unknown) {
  if (typeof body !== 'string') throw new Error('Expected a JSON confirmation body')
  return flatLayConfirmInputSchema.parse(JSON.parse(body))
}

function harness() {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(fixedTime))
  const fetch = vi.fn<(url: string, init: RequestInit) => Promise<Response>>()
  vi.stubGlobal('fetch', fetch)
  const bearer = vi.fn<() => string | null>(() => 'synthetic-bearer')
  const isCurrent = vi.fn(() => true)
  const onCommitted = vi.fn()
  const onComplete = vi.fn()
  const notify = vi.fn()
  const capture = new FlatLayCapture(
    {
      ...createFlatLayClient(() => baseUrl, bearer),
      isCurrent,
      onCommitted,
      onComplete,
    },
    notify
  )
  const ticket = capture.open(source)
  const body = new FormData()
  body.set('photo', new Blob(['synthetic-photo'], { type: 'image/jpeg' }), 'flat-lay.jpg')
  return {
    capture,
    ticket,
    body,
    fetch,
    bearer,
    isCurrent,
    onCommitted,
    onComplete,
    notify,
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('CC-7.29 shared flat-lay capture', () => {
  it('[P0] [7.29-REVIEW] keeps subtype with its compatible category', () => {
    const correct = { category: 'top', subtype: 'camisole' }
    const wrong = { category: 'outerwear', subtype: 'camisole' }

    expect(flatLayTagsSchema.parse(correct)).toEqual(correct)
    expect(flatLayTagsSchema.safeParse(wrong).success).toBe(false)
  })

  it('[P0] [7.29-REVIEW] posts one multipart photo and commits only the kept mask with edited tags', async () => {
    const { capture, ticket, body, fetch, onCommitted, onComplete } = harness()
    fetch.mockResolvedValueOnce(accepted()).mockResolvedValueOnce(Response.json(saved))

    await capture.review(ticket, body)
    const [reviewUrl, reviewRequest] = fetch.mock.calls[0]!
    expect(reviewUrl).toBe(`${baseUrl}/api/v1/wardrobe/flat-lay/review`)
    expect(reviewRequest.method).toBe('POST')
    expect(reviewRequest.body).toBe(body)
    expect(reviewRequest.headers).toEqual({ Authorization: 'Bearer synthetic-bearer' })
    expect(reviewRequest.signal).toBeInstanceOf(AbortSignal)
    expect(capture.state).toMatchObject({
      phase: 'review',
      pieces: [
        { ...first, tags: { category: null } },
        { ...second, tags: { category: 'bottom' } },
      ],
    })
    capture.setTags(first.id, { category: 'outerwear', material: 'wool' })
    capture.remove(second.id)
    await capture.save()

    const [url, request] = fetch.mock.calls[1]!
    expect(url).toBe(`${baseUrl}/api/v1/wardrobe/flat-lay/confirm`)
    expect(request.headers).toEqual({
      Authorization: 'Bearer synthetic-bearer',
      'Content-Type': 'application/json',
    })
    expect(selection(request.body)).toEqual({
      items: [{ ...first, tags: { category: 'outerwear', material: 'wool' } }],
    })
    expect(onCommitted).toHaveBeenCalledExactlyOnceWith(
      saved.garments[0],
      'synthetic-bearer'
    )
    expect(onComplete).toHaveBeenCalledOnce()
    expect(capture.state).toMatchObject({ phase: 'source', pieces: [] })
    expect(ticket.abort.signal.aborted).toBe(true)
  })

  it.each([
    { status: 422, body: { message: 'FLAT_LAY_PERSON' }, error: 'person' },
    { status: 422, body: { code: 'FLAT_LAY_UNCERTAIN' }, error: 'uncertain' },
    { status: 413, body: 'Unexpected response', error: 'uncertain' },
    {
      status: 403,
      body: { code: 'GUARDIAN_CONSENT_REQUIRED' },
      error: 'consentRequired',
    },
    { status: 503, body: { code: 'UNAVAILABLE' }, error: 'unavailable' },
  ])(
    '[P0] [7.29-REJECT] clears the review on $error',
    async ({ status, body: responseBody, error }) => {
      const { capture, ticket, body, fetch } = harness()
      fetch.mockResolvedValueOnce(
        typeof responseBody === 'string'
          ? new Response(responseBody, { status })
          : Response.json(responseBody, { status })
      )

      await capture.review(ticket, body)
      expect(capture.state).toEqual({ phase: 'source', pieces: [], error })
      expect(ticket.abort.signal.aborted).toBe(true)
    }
  )

  it('[P0] [7.29-PRIVATE] clears an unsigned-in review before sending the photo', async () => {
    const { capture, ticket, body, bearer, fetch } = harness()
    bearer.mockReturnValueOnce(null)

    await capture.review(ticket, body)
    expect(capture.state).toEqual({ phase: 'source', pieces: [], error: 'signedOut' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each([
    { status: 409, code: 'UPLOAD_IN_PROGRESS' },
    { status: 408, code: 'REQUEST_TIMEOUT' },
    { status: 429, code: 'RATE_LIMIT' },
    { status: 503, code: 'UNAVAILABLE' },
  ])(
    '[P0] [7.29-REPLAY] freezes the exact submission after $code',
    async ({ status, code }) => {
      const { capture, ticket, body, fetch, onCommitted } = harness()
      fetch
        .mockResolvedValueOnce(accepted())
        .mockResolvedValueOnce(Response.json({ code }, { status }))
        .mockResolvedValueOnce(Response.json(saved))
      await capture.review(ticket, body)
      capture.remove(second.id)

      await capture.save()
      expect(capture.state).toMatchObject({ phase: 'retry', error: 'saveFailed' })
      expect(onCommitted).not.toHaveBeenCalled()
      capture.setTags(first.id, { category: 'outerwear' })
      capture.remove(first.id)
      await capture.save()

      expect(fetch).toHaveBeenCalledTimes(3)
      const attempted = fetch.mock.calls[1]![1].body
      expect(selection(attempted)).toEqual({
        items: [{ ...first, tags: { category: null } }],
      })
      expect(fetch.mock.calls[2]![1].body).toBe(attempted)
      expect(onCommitted).toHaveBeenCalledOnce()
    }
  )

  it.each([
    { status: 400, code: 'FLAT_LAY_INVALID', error: 'expired' },
    { status: 422, code: 'TERMINAL_FAILURE', error: 'saveFailed' },
  ])(
    '[P0] [7.29-PURGE] clears previews after $code during confirmation',
    async ({ status, code, error }) => {
      const { capture, ticket, body, fetch, onCommitted } = harness()
      fetch
        .mockResolvedValueOnce(accepted())
        .mockResolvedValueOnce(Response.json({ code }, { status }))
      await capture.review(ticket, body)

      await capture.save()
      await capture.save()

      expect(fetch).toHaveBeenCalledTimes(2)
      expect(capture.state).toEqual({ phase: 'source', pieces: [], error })
      expect(onCommitted).not.toHaveBeenCalled()
      expect(ticket.abort.signal.aborted).toBe(true)
    }
  )

  it('[P0] [7.29-PURGE] caps preview lifetime at 15 minutes and skips requests with no kept pieces', async () => {
    const { capture, ticket, body, fetch } = harness()
    const longerExpiry = new Date(Date.now() + lifetime * 2).toISOString()
    fetch.mockResolvedValueOnce(accepted(longerExpiry))
    await capture.review(ticket, body)
    capture.remove(first.id)
    capture.remove(second.id)
    await capture.save()
    expect(fetch).toHaveBeenCalledOnce()
    expect(capture.state).toMatchObject({ phase: 'review', pieces: [] })

    await vi.advanceTimersByTimeAsync(lifetime)
    expect(capture.state).toEqual({ phase: 'source', pieces: [], error: 'expired' })
    expect(ticket.abort.signal.aborted).toBe(true)
  })

  it('[P0] [7.29-PRIVATE] cannot restore previews from an obsolete response', async () => {
    const { capture, ticket, body, fetch, notify, isCurrent } = harness()
    const response = deferred<Response>()
    const started = deferred<void>()
    fetch.mockImplementationOnce(() => {
      started.resolve()
      return response.promise
    })
    const reviewing = capture.review(ticket, body)
    await started.promise
    expect(capture.state.phase).toBe('scanning')

    isCurrent.mockReturnValue(false)
    capture.reset(false)
    notify.mockClear()
    response.resolve(accepted())
    await reviewing
    await capture.review(ticket, body)

    expect(ticket.abort.signal.aborted).toBe(true)
    expect(capture.state).toMatchObject({ phase: 'source', pieces: [] })
    expect(notify).not.toHaveBeenCalled()
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('[P0] [7.29-PURGE] discards a review response already expired when it arrives', async () => {
    const { capture, ticket, body, fetch } = harness()
    fetch.mockResolvedValueOnce(accepted(fixedTime))

    await capture.review(ticket, body)

    expect(capture.state).toEqual({ phase: 'source', pieces: [], error: 'expired' })
    expect(ticket.abort.signal.aborted).toBe(true)
  })

  it.each(['remove', 'setTags', 'save'] as const)(
    '[P0] [7.29-PURGE] clears an expired review on %s before timers fire',
    async (action) => {
      const { capture, ticket, body, fetch } = harness()
      fetch.mockResolvedValueOnce(accepted())
      await capture.review(ticket, body)
      vi.setSystemTime(new Date(Date.parse(fixedTime) + lifetime))

      const commands = {
        remove: () => capture.remove(first.id),
        setTags: () => capture.setTags(first.id, { category: 'outerwear' }),
        save: () => capture.save(),
      }
      await commands[action]()

      expect(capture.state).toEqual({ phase: 'source', pieces: [], error: 'expired' })
      expect(fetch).toHaveBeenCalledOnce()
    }
  )

  it('[P0] [7.29-PRIVATE] suppresses obsolete confirmation callbacks and aborts pending transport', async () => {
    const { capture, ticket, body, fetch, onCommitted, onComplete } = harness()
    const started = deferred<void>()
    const confirmed = deferred<Response>()
    fetch.mockResolvedValueOnce(accepted()).mockImplementationOnce(() => {
      started.resolve()
      return confirmed.promise
    })
    await capture.review(ticket, body)
    const saving = capture.save()
    await started.promise
    await capture.save()

    capture.open({ account: 'another-member', epoch: 2 })
    capture.cancelPick(ticket, 'unavailable')
    confirmed.resolve(Response.json(saved))
    await saving

    expect(fetch).toHaveBeenCalledTimes(2)
    expect(fetch.mock.calls[1]?.[1].signal?.aborted).toBe(true)
    expect(onCommitted).not.toHaveBeenCalled()
    expect(onComplete).not.toHaveBeenCalled()
    expect(capture.state).toMatchObject({ phase: 'source', pieces: [], error: undefined })
  })

  it('[P0] [7.29-REPLAY] retains reviewed pieces during transport loss and clears previews on an expired retry', async () => {
    const { capture, ticket, body, fetch, onCommitted } = harness()
    fetch.mockRejectedValueOnce(new TypeError('Synthetic review network error'))
    await capture.review(ticket, body)
    expect(capture.state).toMatchObject({
      phase: 'source',
      pieces: [],
      error: 'unavailable',
    })

    const retryTicket = capture.open(source)
    fetch
      .mockResolvedValueOnce(accepted())
      .mockRejectedValueOnce(new TypeError('Synthetic confirm network error'))
    await capture.review(retryTicket, body)
    await capture.save()
    expect(capture.state).toMatchObject({ phase: 'retry', error: 'saveFailed' })
    expect(capture.state.pieces).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(lifetime)
    expect(capture.state).toEqual({ phase: 'source', pieces: [], error: 'expired' })
    expect(onCommitted).not.toHaveBeenCalled()
  })

  it('[P0] [7.29-REPLAY] reports an already-started save after its previews expire', async () => {
    const { capture, ticket, body, fetch, onCommitted, onComplete } = harness()
    const started = deferred<void>()
    const response = deferred<Response>()
    fetch.mockResolvedValueOnce(accepted()).mockImplementationOnce(() => {
      started.resolve()
      return response.promise
    })
    await capture.review(ticket, body)
    await vi.advanceTimersByTimeAsync(lifetime - 1000)
    const saving = capture.save()
    await started.promise

    await vi.advanceTimersByTimeAsync(1000)
    expect(capture.state).toMatchObject({ phase: 'saving', pieces: [] })
    expect(onCommitted).not.toHaveBeenCalled()
    expect(fetch.mock.calls[1]?.[1].signal?.aborted).toBe(false)
    await capture.save()
    expect(fetch).toHaveBeenCalledTimes(2)

    response.resolve(Response.json(saved))
    await saving

    expect(onCommitted).toHaveBeenCalledExactlyOnceWith(
      saved.garments[0],
      'synthetic-bearer'
    )
    expect(onComplete).toHaveBeenCalledOnce()
    expect(capture.state).toMatchObject({ phase: 'source', pieces: [], error: undefined })
  })
})
