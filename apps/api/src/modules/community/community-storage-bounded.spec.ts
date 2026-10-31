// Learning path Step 48: Safe branded share-card export.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-48-safe-branded-share-card-export
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SupabaseCommunityStorageAdapter } from './community-storage.adapter.js'
const validPath = 'community/own-post/random.png'
beforeEach(() => {
  vi.stubEnv('SUPABASE_URL', 'http://127.0.0.1:54321')
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'local-test-key')
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.useRealTimers()
})
describe('export-only bounded private media stream', () => {
  it('U-BOUNDS: rejects unsafe paths before a storage request', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    await expect(
      new SupabaseCommunityStorageAdapter().downloadBounded(
        'community/own-post/../private.png',
        10,
        new AbortController().signal
      )
    ).rejects.toMatchObject({ status: 503 })
    expect(fetch).not.toHaveBeenCalled()
  })
  it('U-BOUNDS: validates fixed private bucket and cancels a declared overrun immediately', async () => {
    const cancel = vi.fn()
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array([1]))
      },
      cancel,
    })
    const fetch = vi.fn((_url: string) =>
      Promise.resolve(new Response(body, { headers: { 'Content-Length': '11' } }))
    )
    vi.stubGlobal('fetch', fetch)
    await expect(
      new SupabaseCommunityStorageAdapter().downloadBounded(
        validPath,
        10,
        new AbortController().signal
      )
    ).rejects.toMatchObject({ status: 503 })
    expect(cancel).toHaveBeenCalledOnce()
    expect(fetch.mock.calls[0]?.[0]).toBe(
      `http://127.0.0.1:54321/storage/v1/object/authenticated/community-images/${validPath}`
    )
  })
  it('U-BOUNDS: cancels an actual stream overrun before concatenation', async () => {
    const cancel = vi.fn()
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(11))
      },
      cancel,
    })
    vi.stubGlobal('fetch', () => Promise.resolve(new Response(body)))
    await expect(
      new SupabaseCommunityStorageAdapter().downloadBounded(
        validPath,
        10,
        new AbortController().signal
      )
    ).rejects.toMatchObject({ status: 503 })
    expect(cancel).toHaveBeenCalledOnce()
  })
  it('U-BOUNDS: stalled storage stops at five seconds and cannot return partial bytes', async () => {
    vi.useFakeTimers()
    const cancel = vi.fn()
    vi.stubGlobal('fetch', () =>
      Promise.resolve(new Response(new ReadableStream({ cancel })))
    )
    const result = new SupabaseCommunityStorageAdapter().downloadBounded(
      validPath,
      10,
      new AbortController().signal
    )
    const rejected = expect(result).rejects.toMatchObject({ status: 503 })
    await vi.advanceTimersByTimeAsync(5000)
    await rejected
    expect(cancel).toHaveBeenCalledOnce()
  })
  it('U-BOUNDS: a permitted complete stream returns its exact bytes', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(new Response(new Uint8Array([1, 2, 3]))))
    expect(
      await new SupabaseCommunityStorageAdapter().downloadBounded(
        validPath,
        10,
        new AbortController().signal
      )
    ).toEqual(Buffer.from([1, 2, 3]))
  })
})
