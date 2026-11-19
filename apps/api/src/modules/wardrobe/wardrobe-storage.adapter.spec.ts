// Learning path Step 29: Garment capture flow.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-29-garment-capture-flow
// Learning path Step 58: Image uploads straight to storage.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#image-uploads-straight-to-storage
import { ConflictException, ServiceUnavailableException } from '@nestjs/common'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  SupabaseWardrobeStorageAdapter,
  wardrobeStorageLogger,
} from './wardrobe-storage.adapter'

const supabaseMocks = vi.hoisted(() => {
  const bucket = {
    createSignedUploadUrl: vi.fn(),
    createSignedUrl: vi.fn(),
    download: vi.fn(),
    listV2: vi.fn(),
    remove: vi.fn(),
    upload: vi.fn(),
  }
  const from = vi.fn(() => bucket)
  const createClient = vi.fn(() => ({ storage: { from } }))

  return { bucket, createClient, from }
})

vi.mock('@supabase/supabase-js', () => ({
  createClient: supabaseMocks.createClient,
}))

const FIXTURE_NOW = new Date('2026-11-19T15:00:00.000Z')
const TWO_HOURS_MS = 2 * 60 * 60 * 1000

/** A storage signed upload token: only its `exp` claim is read. */
function signedUploadToken(exp: unknown): string {
  return `header.${Buffer.from(JSON.stringify({ exp })).toString('base64url')}.signature`
}

describe('SupabaseWardrobeStorageAdapter', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    supabaseMocks.from.mockReturnValue(supabaseMocks.bucket)
    supabaseMocks.createClient.mockReturnValue({
      storage: { from: supabaseMocks.from },
    })
    vi.stubEnv('SUPABASE_URL', '')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('keeps the API available and fails storage operations closed without credentials', async () => {
    const adapter = new SupabaseWardrobeStorageAdapter()

    expect(supabaseMocks.createClient).not.toHaveBeenCalled()
    await expect(adapter.createUploadSession('path.png')).rejects.toThrow(
      ServiceUnavailableException
    )
    await expect(adapter.downloadBounded('path.png', 1024)).rejects.toThrow(
      ServiceUnavailableException
    )
    await expect(
      adapter.publish('path.png', Buffer.from('x'), 'image/png')
    ).rejects.toThrow(ServiceUnavailableException)
    await expect(adapter.download('path.png')).rejects.toThrow(
      ServiceUnavailableException
    )
    await expect(adapter.signReadUrl('path.png', 600)).rejects.toThrow(
      ServiceUnavailableException
    )
    await expect(adapter.remove(['path.png'])).rejects.toThrow(
      ServiceUnavailableException
    )
  })

  it('no-ops remove when empty array provided', async () => {
    const adapter = new SupabaseWardrobeStorageAdapter()
    await expect(adapter.remove([])).resolves.toBeUndefined()
  })

  it('uses the private wardrobe bucket when storage credentials are configured', async () => {
    vi.stubEnv('SUPABASE_URL', 'https://wardrobe.supabase.co')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role-key')
    supabaseMocks.bucket.download.mockResolvedValue({
      data: new Blob([Buffer.from('garment-bytes')]),
      error: null,
    })
    supabaseMocks.bucket.createSignedUrl.mockResolvedValue({
      data: { signedUrl: 'https://wardrobe.supabase.co/signed/garment' },
      error: null,
    })
    supabaseMocks.bucket.remove.mockResolvedValue({ error: null })

    const adapter = new SupabaseWardrobeStorageAdapter()

    await expect(adapter.download('user/garment.png')).resolves.toEqual(
      Buffer.from('garment-bytes')
    )
    await expect(adapter.signReadUrl('user/garment.png', 600)).resolves.toBe(
      'https://wardrobe.supabase.co/signed/garment'
    )
    await expect(adapter.remove(['user/garment.png'])).resolves.toBeUndefined()

    expect(supabaseMocks.createClient).toHaveBeenCalledWith(
      'https://wardrobe.supabase.co',
      'service-role-key',
      { auth: { autoRefreshToken: false, persistSession: false } }
    )
    expect(supabaseMocks.from).toHaveBeenCalledTimes(3)
    expect(supabaseMocks.from).toHaveBeenCalledWith('wardrobe-images')
  })

  describe('createUploadSession', () => {
    beforeEach(() => {
      vi.useFakeTimers()
      vi.setSystemTime(FIXTURE_NOW)
      vi.stubEnv('SUPABASE_URL', 'https://wardrobe.supabase.co')
      vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role-key')
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    /**
     * One object per URL, signed without upsert (round 4, Codex C3-3): the first write to a
     * staging key wins, so a pending garment's staged source stays immutable once it comes under
     * legal hold. Commit verifies what is staged and publishes the verified buffer itself.
     */
    it('signs a one-write upload URL for exactly that object and reads the expiry from the token', async () => {
      const exp = Math.floor((FIXTURE_NOW.getTime() + TWO_HOURS_MS) / 1000)
      const token = signedUploadToken(exp)
      supabaseMocks.bucket.createSignedUploadUrl.mockResolvedValue({
        data: {
          signedUrl: `https://wardrobe.supabase.co/storage/v1/object/upload/sign/wardrobe-images/user/garment.jpg?token=${token}`,
          token,
          path: 'user/garment.jpg',
        },
        error: null,
      })
      const adapter = new SupabaseWardrobeStorageAdapter()

      const session = await adapter.createUploadSession('user/garment.jpg')

      expect(supabaseMocks.from).toHaveBeenCalledWith('wardrobe-images')
      expect(supabaseMocks.bucket.createSignedUploadUrl).toHaveBeenCalledExactlyOnceWith(
        'user/garment.jpg'
      )
      expect(session).toEqual({
        uploadUrl: `https://wardrobe.supabase.co/storage/v1/object/upload/sign/wardrobe-images/user/garment.jpg?token=${token}`,
        uploadToken: token,
        tokenExpiresAt: new Date(exp * 1000),
      })
    })

    /**
     * Round 4 (Codex C3-3): a replayed allocation cannot re-sign a key that already holds bytes.
     * Storage answers its Duplicate error, which the SDK reports as status code 409; the adapter
     * answers 409 UPLOAD_BYTES_PRESENT so the client commits the bytes it already stored.
     */
    it.each([
      [
        'its 409 status code',
        { name: 'StorageApiError', message: 'Conflict', statusCode: '409' },
      ],
      [
        'its "already exists" message',
        {
          name: 'StorageApiError',
          message: 'The resource already exists',
          statusCode: '400',
        },
      ],
    ])(
      'answers 409 UPLOAD_BYTES_PRESENT for an occupied key, read from %s',
      async (_label, error) => {
        supabaseMocks.bucket.createSignedUploadUrl.mockResolvedValue({
          data: null,
          error,
        })
        const adapter = new SupabaseWardrobeStorageAdapter()

        const refusal = adapter.createUploadSession('user/garment.jpg')

        await expect(refusal).rejects.toBeInstanceOf(ConflictException)
        await expect(refusal).rejects.toThrow('UPLOAD_BYTES_PRESENT')
      }
    )

    it('fails closed when storage refuses to sign', async () => {
      supabaseMocks.bucket.createSignedUploadUrl.mockResolvedValue({
        data: null,
        error: {
          name: 'StorageApiError',
          message: 'Bucket not found',
          statusCode: '404',
        },
      })
      const adapter = new SupabaseWardrobeStorageAdapter()

      await expect(adapter.createUploadSession('user/garment.jpg')).rejects.toThrow(
        'STORAGE_PERMISSION_DENIED'
      )
    })

    it.each([
      ['an unreadable token', 'not-a-jwt'],
      ['a token with no exp claim', signedUploadToken('soon')],
      [
        'a token signed for longer than storage documents',
        signedUploadToken(
          Math.floor((FIXTURE_NOW.getTime() + TWO_HOURS_MS + 5 * 60 * 1000) / 1000)
        ),
      ],
      [
        'a token that has already expired',
        signedUploadToken(Math.floor(FIXTURE_NOW.getTime() / 1000) - 1),
      ],
    ])('fails closed on %s', async (_label, token) => {
      supabaseMocks.bucket.createSignedUploadUrl.mockResolvedValue({
        data: { signedUrl: 'https://wardrobe.supabase.co/signed', token, path: 'p' },
        error: null,
      })
      const warn = vi
        .spyOn(wardrobeStorageLogger, 'warn')
        .mockImplementation(() => undefined)
      const adapter = new SupabaseWardrobeStorageAdapter()

      await expect(adapter.createUploadSession('user/garment.jpg')).rejects.toThrow(
        ServiceUnavailableException
      )
      expect(warn).toHaveBeenCalledWith(
        {
          operation: 'sign_upload',
          reason: 'other',
          errorName: 'SignedUploadTokenRejected',
          statusCode: null,
        },
        'wardrobe_storage_failed'
      )
    })
  })

  /**
   * Codex round 2 finding 10: commit used to buffer the whole stored object before the size
   * check. The bounded read streams storage's authenticated object route and stops at the
   * ceiling, from the declared length or by counting the stream.
   */
  describe('downloadBounded', () => {
    const OBJECT_URL =
      'https://wardrobe.supabase.co/storage/v1/object/authenticated/wardrobe-images/staging/u/garment/s.png'

    beforeEach(() => {
      vi.stubEnv('SUPABASE_URL', 'https://wardrobe.supabase.co/')
      vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role-key')
    })

    function stubFetch(response: Response) {
      const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response)
      vi.stubGlobal('fetch', fetchMock)
      return fetchMock
    }

    /** A body with no declared length, so only counting the stream can find its size. */
    function streamedBody(chunks: Uint8Array[]) {
      const cancel = vi.fn()
      let index = 0
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          const chunk = chunks[index]
          index += 1
          if (chunk) controller.enqueue(chunk)
          else controller.close()
        },
        cancel,
      })
      return { body, cancel }
    }

    it('returns the stored bytes read with the service key', async () => {
      const fetchMock = stubFetch(
        new Response(Buffer.from('garment-bytes'), {
          status: 200,
          headers: { 'content-length': '13' },
        })
      )
      const adapter = new SupabaseWardrobeStorageAdapter()

      await expect(
        adapter.downloadBounded('staging/u/garment/s.png', 1024)
      ).resolves.toEqual({ status: 'present', bytes: Buffer.from('garment-bytes') })
      expect(fetchMock).toHaveBeenCalledExactlyOnceWith(OBJECT_URL, {
        headers: { Authorization: 'Bearer service-role-key', apikey: 'service-role-key' },
      })
    })

    /**
     * Storage has answered a missing object both ways: HTTP 404, and HTTP 400 with a 404 body.
     * Round 4 (Codex C3-10): only the object-not-found code means missing.
     */
    it.each([
      [
        'an HTTP 404 whose body names the object missing',
        new Response(
          JSON.stringify({
            statusCode: '404',
            error: 'not_found',
            message: 'Object not found',
          }),
          { status: 404 }
        ),
      ],
      [
        'an HTTP 404 with the NoSuchKey code',
        new Response(JSON.stringify({ statusCode: '404', code: 'NoSuchKey' }), {
          status: 404,
        }),
      ],
      [
        'an HTTP 400 that names the object missing',
        new Response(
          JSON.stringify({
            statusCode: '404',
            error: 'not_found',
            message: 'Object not found',
          }),
          { status: 400 }
        ),
      ],
    ])('answers missing for %s', async (_label, response) => {
      stubFetch(response)
      const adapter = new SupabaseWardrobeStorageAdapter()

      await expect(
        adapter.downloadBounded('staging/u/garment/s.png', 1024)
      ).resolves.toEqual({ status: 'missing' })
    })

    it('answers too_large from the declared length without reading the body', async () => {
      const { body, cancel } = streamedBody([new Uint8Array(8)])
      stubFetch(
        new Response(body, { status: 200, headers: { 'content-length': '2048' } })
      )
      const adapter = new SupabaseWardrobeStorageAdapter()

      await expect(
        adapter.downloadBounded('staging/u/garment/s.png', 1024)
      ).resolves.toEqual({ status: 'too_large' })
      expect(cancel).toHaveBeenCalledTimes(1)
    })

    it('answers too_large by counting a stream with no declared length, and cancels it', async () => {
      const { body, cancel } = streamedBody([
        new Uint8Array(600),
        new Uint8Array(600),
        new Uint8Array(600),
      ])
      stubFetch(new Response(body, { status: 200 }))
      const adapter = new SupabaseWardrobeStorageAdapter()

      await expect(
        adapter.downloadBounded('staging/u/garment/s.png', 1024)
      ).resolves.toEqual({ status: 'too_large' })
      expect(cancel).toHaveBeenCalledTimes(1)
    })

    it('returns a counted stream that stays within the ceiling', async () => {
      const { body } = streamedBody([new Uint8Array([1, 2]), new Uint8Array([3])])
      stubFetch(new Response(body, { status: 200 }))
      const adapter = new SupabaseWardrobeStorageAdapter()

      await expect(
        adapter.downloadBounded('staging/u/garment/s.png', 3)
      ).resolves.toEqual({
        status: 'present',
        bytes: Buffer.from([1, 2, 3]),
      })
    })

    /**
     * A missing bucket or a refused key is a fault, never "the client has not uploaded yet":
     * answering missing bytes would tell the client to upload again while storage is down.
     * Round 4 (Codex C3-10): a missing bucket also answers 404, and so can a proxy with no body.
     */
    it.each([
      [
        'an HTTP 400 that is not a missing object',
        new Response(JSON.stringify({ statusCode: '400', error: 'Bucket not found' }), {
          status: 400,
        }),
      ],
      [
        'an HTTP 404 for a missing bucket',
        new Response(
          JSON.stringify({
            statusCode: '404',
            error: 'not_found',
            message: 'Bucket not found',
          }),
          { status: 404 }
        ),
      ],
      ['an HTTP 404 with no body', new Response(null, { status: 404 })],
      [
        'an HTTP 404 that is not JSON',
        new Response('<html>gone</html>', { status: 404 }),
      ],
      ['a refused key', new Response('{}', { status: 403 })],
      ['a server error', new Response('{}', { status: 500 })],
    ])('throws 503 STORAGE_UNAVAILABLE for %s', async (_label, response) => {
      stubFetch(response)
      const adapter = new SupabaseWardrobeStorageAdapter()

      const read = adapter.downloadBounded('staging/u/garment/s.png', 1024)

      await expect(read).rejects.toBeInstanceOf(ServiceUnavailableException)
      await expect(read).rejects.toThrow('STORAGE_UNAVAILABLE')
    })

    // Round 4 (Codex C3-10): an error body is read through a small ceiling.
    it('stops reading an oversized error body and answers 503', async () => {
      const { body, cancel } = streamedBody([
        new Uint8Array(3 * 1024).fill(0x20),
        new Uint8Array(3 * 1024).fill(0x20),
        new Uint8Array(3 * 1024).fill(0x20),
      ])
      stubFetch(new Response(body, { status: 404 }))
      const adapter = new SupabaseWardrobeStorageAdapter()

      await expect(
        adapter.downloadBounded('staging/u/garment/s.png', 1024 * 1024)
      ).rejects.toThrow('STORAGE_UNAVAILABLE')
      expect(cancel).toHaveBeenCalledTimes(1)
    })

    // Round 4 (Codex C3-10): a body that breaks off is a storage fault (503).
    it('throws 503 STORAGE_UNAVAILABLE when the body fails mid-stream', async () => {
      let pulls = 0
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          pulls += 1
          if (pulls === 1) controller.enqueue(new Uint8Array([1, 2]))
          else controller.error(new TypeError('terminated'))
        },
      })
      stubFetch(new Response(body, { status: 200 }))
      const adapter = new SupabaseWardrobeStorageAdapter()

      const read = adapter.downloadBounded('staging/u/garment/s.png', 1024)

      await expect(read).rejects.toBeInstanceOf(ServiceUnavailableException)
      await expect(read).rejects.toThrow('STORAGE_UNAVAILABLE')
    })

    it('throws 503 STORAGE_UNAVAILABLE when storage cannot be reached', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn<typeof fetch>().mockRejectedValue(new TypeError('fetch failed'))
      )
      const adapter = new SupabaseWardrobeStorageAdapter()

      await expect(
        adapter.downloadBounded('staging/u/garment/s.png', 1024)
      ).rejects.toThrow('STORAGE_UNAVAILABLE')
    })
  })

  /**
   * Codex round 2 findings 1 and 9: commit writes the verified buffer to the final key itself,
   * with server-owned type and the private cache policy, so neither later staged bytes nor a
   * client's metadata can reach the final object. Upsert, because a retried commit writes the
   * same verified bytes again.
   */
  describe('publish', () => {
    beforeEach(() => {
      vi.stubEnv('SUPABASE_URL', 'https://wardrobe.supabase.co')
      vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role-key')
    })

    it('uploads exactly those bytes with the verified type, upsert and a private cache policy', async () => {
      supabaseMocks.bucket.upload.mockResolvedValue({ data: { path: 'p' }, error: null })
      const bytes = Buffer.from('verified-bytes')
      const adapter = new SupabaseWardrobeStorageAdapter()

      await expect(
        adapter.publish('wardrobe/user-1/garment-1.jpg', bytes, 'image/jpeg')
      ).resolves.toBeUndefined()
      expect(supabaseMocks.bucket.upload).toHaveBeenCalledExactlyOnceWith(
        'wardrobe/user-1/garment-1.jpg',
        bytes,
        {
          contentType: 'image/jpeg',
          upsert: true,
          headers: { 'cache-control': 'private, max-age=0' },
        }
      )
      expect(supabaseMocks.from).toHaveBeenCalledWith('wardrobe-images')
    })

    it('throws 503 when storage refuses the write', async () => {
      supabaseMocks.bucket.upload.mockResolvedValue({
        data: null,
        error: { name: 'StorageApiError', message: 'boom', statusCode: '500' },
      })
      const adapter = new SupabaseWardrobeStorageAdapter()

      await expect(
        adapter.publish('wardrobe/u/g.jpg', Buffer.from('x'), 'image/jpeg')
      ).rejects.toThrow(ServiceUnavailableException)
    })
  })

  /**
   * Round 5 (Codex C4-6): the held copy of a held garment's source is written once, without
   * upsert, so nothing can replace what the hold preserves.
   */
  describe('publishOnce', () => {
    beforeEach(() => {
      vi.stubEnv('SUPABASE_URL', 'https://wardrobe.supabase.co')
      vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role-key')
    })

    it('writes without upsert, with the verified type and the private cache policy', async () => {
      supabaseMocks.bucket.upload.mockResolvedValue({ data: { path: 'p' }, error: null })
      const bytes = Buffer.from('held-bytes')
      const adapter = new SupabaseWardrobeStorageAdapter()

      await expect(
        adapter.publishOnce('held/user-1/garment-1.jpg', bytes, 'image/jpeg')
      ).resolves.toBe('created')
      expect(supabaseMocks.bucket.upload).toHaveBeenCalledExactlyOnceWith(
        'held/user-1/garment-1.jpg',
        bytes,
        {
          contentType: 'image/jpeg',
          upsert: false,
          headers: { 'cache-control': 'private, max-age=0' },
        }
      )
    })

    it('answers exists when the key already holds an object', async () => {
      supabaseMocks.bucket.upload.mockResolvedValue({
        data: null,
        error: {
          name: 'StorageApiError',
          message: 'The resource already exists',
          statusCode: '409',
        },
      })
      const adapter = new SupabaseWardrobeStorageAdapter()

      await expect(
        adapter.publishOnce('held/u/g.jpg', Buffer.from('x'), 'image/jpeg')
      ).resolves.toBe('exists')
    })

    it('throws 503 for any other storage failure', async () => {
      supabaseMocks.bucket.upload.mockResolvedValue({
        data: null,
        error: { name: 'StorageApiError', message: 'boom', statusCode: '500' },
      })
      const adapter = new SupabaseWardrobeStorageAdapter()

      await expect(
        adapter.publishOnce('held/u/g.jpg', Buffer.from('x'), 'image/jpeg')
      ).rejects.toThrow(ServiceUnavailableException)
    })
  })

  describe('listStagedUploads', () => {
    beforeEach(() => {
      vi.stubEnv('SUPABASE_URL', 'https://wardrobe.supabase.co')
      vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role-key')
    })

    /** Round 3 nests staging keys by owner and kind, so the listing is flat and paged. */
    it('lists every staged key oldest first, flat, and hands back the next cursor', async () => {
      supabaseMocks.bucket.listV2.mockResolvedValue({
        data: {
          hasNext: true,
          nextCursor: 'cursor-2',
          folders: [],
          objects: [
            {
              id: 'o-1',
              name: 'staging/u-1/garment/s-1.jpg',
              created_at: '2026-11-19T10:00:00.000Z',
            },
            { id: 'o-2', name: 'staging/u-1/palette/s-2.png', created_at: 'not a date' },
            {
              id: 'o-3',
              name: 'staging/u-2/silhouette/s-3.webp',
              created_at: '2026-11-19T11:00:00.000Z',
            },
          ],
        },
        error: null,
      })
      const adapter = new SupabaseWardrobeStorageAdapter()

      await expect(adapter.listStagedUploads(50, 'cursor-1')).resolves.toEqual({
        objects: [
          {
            objectPath: 'staging/u-1/garment/s-1.jpg',
            createdAt: new Date('2026-11-19T10:00:00.000Z'),
          },
          {
            objectPath: 'staging/u-2/silhouette/s-3.webp',
            createdAt: new Date('2026-11-19T11:00:00.000Z'),
          },
        ],
        nextCursor: 'cursor-2',
      })
      expect(supabaseMocks.bucket.listV2).toHaveBeenCalledExactlyOnceWith({
        prefix: 'staging/',
        limit: 50,
        sortBy: { column: 'created_at', order: 'asc' },
        cursor: 'cursor-1',
      })
    })

    it('starts from the beginning without a cursor and reports the last page', async () => {
      supabaseMocks.bucket.listV2.mockResolvedValue({
        data: { hasNext: false, nextCursor: 'ignored', folders: [], objects: [] },
        error: null,
      })
      const adapter = new SupabaseWardrobeStorageAdapter()

      await expect(adapter.listStagedUploads(50)).resolves.toEqual({
        objects: [],
        nextCursor: null,
      })
      expect(supabaseMocks.bucket.listV2).toHaveBeenCalledExactlyOnceWith({
        prefix: 'staging/',
        limit: 50,
        sortBy: { column: 'created_at', order: 'asc' },
      })
    })

    it('throws 503 when storage cannot list', async () => {
      supabaseMocks.bucket.listV2.mockResolvedValue({
        data: null,
        error: { name: 'StorageApiError', message: 'boom', statusCode: '500' },
      })
      const adapter = new SupabaseWardrobeStorageAdapter()

      await expect(adapter.listStagedUploads(50)).rejects.toThrow(
        ServiceUnavailableException
      )
    })
  })

  it('logs an allow-listed reason and the status, never the storage message', async () => {
    vi.stubEnv('SUPABASE_URL', 'http://storage.test')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role-key')
    const warn = vi
      .spyOn(wardrobeStorageLogger, 'warn')
      .mockImplementation(() => undefined)
    supabaseMocks.bucket.createSignedUrl.mockResolvedValue({
      data: null,
      error: {
        name: 'StorageApiError',
        message: 'Object not found: users/owner-7f3a/garments/g-2.png',
        statusCode: '400',
      },
    })
    const adapter = new SupabaseWardrobeStorageAdapter()

    await expect(
      adapter.signReadUrl('users/owner-7f3a/garments/g-2.png', 600)
    ).rejects.toThrow(ServiceUnavailableException)

    expect(warn).toHaveBeenCalledWith(
      {
        operation: 'sign',
        reason: 'object_missing',
        errorName: 'StorageApiError',
        statusCode: 400,
      },
      'wardrobe_storage_failed'
    )
    expect(JSON.stringify(warn.mock.calls)).not.toContain('owner-7f3a')
  })

  it('normalizes Supabase failures to a storage unavailable response', async () => {
    vi.stubEnv('SUPABASE_URL', 'https://wardrobe.supabase.co')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role-key')
    const storageError = new Error('provider details must stay private')
    supabaseMocks.bucket.createSignedUploadUrl.mockResolvedValue({
      data: null,
      error: storageError,
    })
    supabaseMocks.bucket.download.mockResolvedValue({
      data: null,
      error: storageError,
    })
    supabaseMocks.bucket.createSignedUrl.mockResolvedValue({
      data: null,
      error: storageError,
    })
    supabaseMocks.bucket.remove.mockResolvedValue({ error: storageError })

    const adapter = new SupabaseWardrobeStorageAdapter()

    await expect(adapter.createUploadSession('user/garment.png')).rejects.toThrow(
      'STORAGE_PERMISSION_DENIED'
    )
    await expect(adapter.download('user/garment.png')).rejects.toThrow(
      'STORAGE_PERMISSION_DENIED'
    )
    await expect(adapter.signReadUrl('user/garment.png', 600)).rejects.toThrow(
      'STORAGE_PERMISSION_DENIED'
    )
    await expect(adapter.remove(['user/garment.png'])).rejects.toThrow(
      'STORAGE_PERMISSION_DENIED'
    )
  })
})
