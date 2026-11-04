// Learning path Step 38: Community feed by climate band.
import { ServiceUnavailableException } from '@nestjs/common'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const supabaseHarness = vi.hoisted(() => ({
  from: vi.fn(),
  createClient: vi.fn(),
}))

vi.mock('@supabase/supabase-js', () => ({
  createClient: supabaseHarness.createClient,
}))

import {
  COMMUNITY_SIGNED_UPLOAD_LIFETIME_MS,
  COMMUNITY_IMAGES_BUCKET,
  SupabaseCommunityStorageAdapter,
} from './community-storage.adapter'

const tokenExpiringIn = (ms: number): string =>
  `h.${Buffer.from(JSON.stringify({ exp: Math.floor((Date.now() + ms) / 1000) })).toString('base64url')}.s`
const validToken = tokenExpiringIn(COMMUNITY_SIGNED_UPLOAD_LIFETIME_MS)

const capability = {
  objectPath: 'community/p/s.jpg',
  token: 'signed-token',
  expiresAt: new Date('2026-11-04T12:00:00.000Z'),
}

describe('SupabaseCommunityStorageAdapter', () => {
  const originalUrl = process.env.SUPABASE_URL
  const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const originalNodeEnv = process.env.NODE_ENV
  const originalTestEnv = process.env.TEST_ENV

  const bucketApi = {
    createSignedUrl: vi.fn(),
    createSignedUrls: vi.fn(),
    createSignedUploadUrl: vi.fn(),
    download: vi.fn(),
    upload: vi.fn(),
    uploadToSignedUrl: vi.fn(),
    remove: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.SUPABASE_URL = 'https://project.supabase.test'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key'
    supabaseHarness.from.mockReturnValue(bucketApi)
    supabaseHarness.createClient.mockReturnValue({
      storage: { from: supabaseHarness.from },
    })
  })

  afterEach(() => {
    process.env.SUPABASE_URL = originalUrl
    process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey
    process.env.NODE_ENV = originalNodeEnv
    if (originalTestEnv === undefined) {
      delete process.env.TEST_ENV
    } else {
      process.env.TEST_ENV = originalTestEnv
    }
  })

  describe('construction fails closed', () => {
    it('throws outside the test environment when Supabase credentials are absent', () => {
      // The previous shape kept a null client and answered `download()` with
      // placeholder bytes that screened clean, so a missing environment variable
      // auto-published unscreened content.
      delete process.env.SUPABASE_URL
      delete process.env.SUPABASE_SERVICE_ROLE_KEY
      process.env.NODE_ENV = 'production'
      delete process.env.TEST_ENV

      expect(() => new SupabaseCommunityStorageAdapter()).toThrow(
        /SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required/
      )
    })

    it('constructs without credentials in the test environment, but refuses every call', async () => {
      delete process.env.SUPABASE_URL
      delete process.env.SUPABASE_SERVICE_ROLE_KEY
      process.env.NODE_ENV = 'test'

      const adapter = new SupabaseCommunityStorageAdapter()

      await expect(adapter.signReadUrl('community/p/s.jpg', 900)).rejects.toThrow(
        ServiceUnavailableException
      )
      await expect(adapter.signReadUrls(['community/p/s.jpg'], 900)).rejects.toThrow(
        ServiceUnavailableException
      )
      await expect(adapter.createUploadSession('community/p/s.jpg')).rejects.toThrow(
        ServiceUnavailableException
      )
      await expect(adapter.download('community/p/s.jpg')).rejects.toThrow(
        ServiceUnavailableException
      )
      await expect(
        adapter.upload('community/p/s.jpg', Buffer.from('x'), 'image/jpeg', capability)
      ).rejects.toThrow(ServiceUnavailableException)
      await expect(adapter.remove(['community/p/s.jpg'])).rejects.toThrow(
        ServiceUnavailableException
      )
    })

    it('creates a client against the configured bucket when credentials are present', () => {
      new SupabaseCommunityStorageAdapter()
      expect(supabaseHarness.createClient).toHaveBeenCalledWith(
        'https://project.supabase.test',
        'service-role-key',
        { auth: { autoRefreshToken: false, persistSession: false } }
      )
    })
  })

  describe('signReadUrl', () => {
    it('returns the signed URL', async () => {
      bucketApi.createSignedUrl.mockResolvedValueOnce({
        data: { signedUrl: 'https://signed.test/one' },
        error: null,
      })

      const adapter = new SupabaseCommunityStorageAdapter()
      await expect(adapter.signReadUrl('community/p/s.jpg', 900)).resolves.toBe(
        'https://signed.test/one'
      )
      expect(supabaseHarness.from).toHaveBeenCalledWith(COMMUNITY_IMAGES_BUCKET)
      expect(bucketApi.createSignedUrl).toHaveBeenCalledWith('community/p/s.jpg', 900)
    })

    it('raises STORAGE_PERMISSION_DENIED on an error result', async () => {
      bucketApi.createSignedUrl.mockResolvedValueOnce({
        data: null,
        error: { message: 'denied' },
      })

      const adapter = new SupabaseCommunityStorageAdapter()
      await expect(adapter.signReadUrl('community/p/s.jpg', 900)).rejects.toThrow(
        'STORAGE_PERMISSION_DENIED'
      )
    })
  })

  describe('signReadUrls', () => {
    it('signs a whole page in one round trip', async () => {
      bucketApi.createSignedUrls.mockResolvedValueOnce({
        data: [
          { path: 'community/a/1.jpg', signedUrl: 'https://signed.test/a' },
          { path: 'community/b/2.jpg', signedUrl: 'https://signed.test/b' },
        ],
        error: null,
      })

      const adapter = new SupabaseCommunityStorageAdapter()
      const signed = await adapter.signReadUrls(
        ['community/a/1.jpg', 'community/b/2.jpg'],
        900
      )

      expect(bucketApi.createSignedUrls).toHaveBeenCalledTimes(1)
      expect(signed.get('community/a/1.jpg')).toBe('https://signed.test/a')
      expect(signed.get('community/b/2.jpg')).toBe('https://signed.test/b')
    })

    it('omits an entry that failed to sign rather than failing the page', async () => {
      bucketApi.createSignedUrls.mockResolvedValueOnce({
        data: [
          { path: 'community/a/1.jpg', signedUrl: 'https://signed.test/a' },
          { path: 'community/b/2.jpg', signedUrl: null, error: 'missing' },
        ],
        error: null,
      })

      const adapter = new SupabaseCommunityStorageAdapter()
      const signed = await adapter.signReadUrls(
        ['community/a/1.jpg', 'community/b/2.jpg'],
        900
      )

      expect(signed.size).toBe(1)
      expect(signed.has('community/b/2.jpg')).toBe(false)
    })

    it('short-circuits an empty request without calling storage', async () => {
      const adapter = new SupabaseCommunityStorageAdapter()
      await expect(adapter.signReadUrls([], 900)).resolves.toEqual(new Map())
      expect(bucketApi.createSignedUrls).not.toHaveBeenCalled()
    })

    it('raises STORAGE_PERMISSION_DENIED on an error result', async () => {
      bucketApi.createSignedUrls.mockResolvedValueOnce({
        data: null,
        error: { message: 'denied' },
      })

      const adapter = new SupabaseCommunityStorageAdapter()
      await expect(adapter.signReadUrls(['community/a/1.jpg'], 900)).rejects.toThrow(
        'STORAGE_PERMISSION_DENIED'
      )
    })
  })

  describe('createUploadSession', () => {
    describe('R10-3: an expiry the token can honor', () => {
      const tokenExpiry = (token: string) =>
        (
          JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString()) as {
            exp: number
          }
        ).exp * 1000

      afterEach(() => {
        vi.useRealTimers()
      })

      it('advertises no later than the token when the clock runs on during the mint', async () => {
        vi.useFakeTimers({ now: new Date('2026-11-04T00:00:00.000Z') })
        const token = tokenExpiringIn(COMMUNITY_SIGNED_UPLOAD_LIFETIME_MS)
        bucketApi.createSignedUploadUrl.mockImplementationOnce(() => {
          vi.setSystemTime(tokenExpiry(token) - 60_000)
          return Promise.resolve({
            data: { signedUrl: 'https://storage.local/upload', token },
            error: null,
          })
        })

        const session = await new SupabaseCommunityStorageAdapter().createUploadSession(
          'community/p/s.jpg',
          900
        )

        expect(new Date(session.expiresAt).getTime()).toBeLessThanOrEqual(
          tokenExpiry(token)
        )
      })

      it('keeps the planned window while the token outlasts it', async () => {
        vi.useFakeTimers({ now: new Date('2026-11-04T00:00:00.000Z') })
        const token = tokenExpiringIn(COMMUNITY_SIGNED_UPLOAD_LIFETIME_MS)
        bucketApi.createSignedUploadUrl.mockResolvedValueOnce({
          data: { signedUrl: 'https://storage.local/upload', token },
          error: null,
        })

        const session = await new SupabaseCommunityStorageAdapter().createUploadSession(
          'community/p/s.jpg',
          900
        )

        expect(new Date(session.expiresAt).getTime()).toBe(Date.now() + 900_000)
      })

      it('refuses a token already expired', async () => {
        vi.useFakeTimers({ now: new Date('2026-11-04T00:00:00.000Z') })
        const token = tokenExpiringIn(-1000)
        bucketApi.createSignedUploadUrl.mockResolvedValueOnce({
          data: { signedUrl: 'https://storage.local/upload', token },
          error: null,
        })

        await expect(
          new SupabaseCommunityStorageAdapter().createUploadSession(
            'community/p/s.jpg',
            900
          )
        ).rejects.toBeInstanceOf(ServiceUnavailableException)
      })
    })

    it('returns the signed upload URL, token, and expiry', async () => {
      bucketApi.createSignedUploadUrl.mockResolvedValueOnce({
        data: { signedUrl: 'https://upload.test/put', token: validToken },
        error: null,
      })

      const adapter = new SupabaseCommunityStorageAdapter()
      const session = await adapter.createUploadSession('community/p/s.jpg', 900)

      expect(session.uploadUrl).toBe('https://upload.test/put')
      expect(session.uploadToken).toBe(validToken)
      expect(new Date(session.expiresAt).getTime()).toBeGreaterThan(Date.now())
    })

    it('advertises no later than the token can honor', async () => {
      const token = tokenExpiringIn(60 * 1000)
      bucketApi.createSignedUploadUrl.mockResolvedValueOnce({
        data: { signedUrl: 'https://upload.test/put', token },
        error: null,
      })

      const adapter = new SupabaseCommunityStorageAdapter()
      const session = await adapter.createUploadSession('community/p/s.jpg', 900)

      expect(new Date(session.expiresAt).getTime()).toBeLessThanOrEqual(
        Date.now() + 60 * 1000
      )
    })

    it('refuses a token that has already expired', async () => {
      bucketApi.createSignedUploadUrl.mockResolvedValueOnce({
        data: { signedUrl: 'https://upload.test/put', token: tokenExpiringIn(-1000) },
        error: null,
      })

      const adapter = new SupabaseCommunityStorageAdapter()
      await expect(adapter.createUploadSession('community/p/s.jpg')).rejects.toThrow(
        'STORAGE_PERMISSION_DENIED'
      )
    })

    it('raises STORAGE_PERMISSION_DENIED on an error result', async () => {
      bucketApi.createSignedUploadUrl.mockResolvedValueOnce({
        data: null,
        error: { message: 'denied' },
      })

      const adapter = new SupabaseCommunityStorageAdapter()
      await expect(adapter.createUploadSession('community/p/s.jpg')).rejects.toThrow(
        'STORAGE_PERMISSION_DENIED'
      )
    })
  })

  describe('download', () => {
    it('returns the object bytes', async () => {
      bucketApi.download.mockResolvedValueOnce({
        data: { arrayBuffer: () => Promise.resolve(Buffer.from('real-bytes').buffer) },
        error: null,
      })

      const adapter = new SupabaseCommunityStorageAdapter()
      const bytes = await adapter.download('community/p/s.jpg')
      expect(Buffer.isBuffer(bytes)).toBe(true)
    })

    it('raises STORAGE_PERMISSION_DENIED rather than returning placeholder bytes', async () => {
      bucketApi.download.mockResolvedValueOnce({ data: null, error: { message: 'gone' } })

      const adapter = new SupabaseCommunityStorageAdapter()
      await expect(adapter.download('community/p/s.jpg')).rejects.toThrow(
        'STORAGE_PERMISSION_DENIED'
      )
    })
  })

  describe('upload', () => {
    it('mints an overwriting token for the path, with the lifetime storage enforces', async () => {
      bucketApi.createSignedUploadUrl.mockResolvedValueOnce({
        data: { token: validToken, signedUrl: 'https://x/y', path: 'community/p/s.jpg' },
        error: null,
      })

      const adapter = new SupabaseCommunityStorageAdapter()
      const minted = await adapter.createOverwriteCapability('community/p/s.jpg')

      expect(bucketApi.createSignedUploadUrl).toHaveBeenCalledWith('community/p/s.jpg', {
        upsert: true,
      })
      expect(minted.token).toBe(validToken)
      expect(minted.expiresAt.getTime()).toBeLessThanOrEqual(
        Date.now() + COMMUNITY_SIGNED_UPLOAD_LIFETIME_MS
      )
    })

    it.each([
      [
        'longer than the erasure window allows',
        () => tokenExpiringIn(3 * 60 * 60 * 1000),
      ],
      ['unreadable', () => 'not-a-jwt'],
    ])('fails closed on a token %s', async (_name, token) => {
      bucketApi.createSignedUploadUrl.mockResolvedValueOnce({
        data: { token: token(), signedUrl: 'https://x/y', path: 'community/p/s.jpg' },
        error: null,
      })

      const adapter = new SupabaseCommunityStorageAdapter()
      await expect(
        adapter.createOverwriteCapability('community/p/s.jpg')
      ).rejects.toThrow('STORAGE_PERMISSION_DENIED')
    })

    it('raises STORAGE_PERMISSION_DENIED when no token can be minted', async () => {
      bucketApi.createSignedUploadUrl.mockResolvedValueOnce({
        data: null,
        error: { message: 'denied' },
      })

      const adapter = new SupabaseCommunityStorageAdapter()
      await expect(
        adapter.createOverwriteCapability('community/p/s.jpg')
      ).rejects.toThrow('STORAGE_PERMISSION_DENIED')
    })

    it('overwrites through the signed token and never with service-role authority', async () => {
      bucketApi.uploadToSignedUrl.mockResolvedValueOnce({ error: null })

      const adapter = new SupabaseCommunityStorageAdapter()
      await adapter.upload(
        'community/p/s.jpg',
        Buffer.from('bytes'),
        'image/jpeg',
        capability
      )

      expect(bucketApi.uploadToSignedUrl).toHaveBeenCalledWith(
        'community/p/s.jpg',
        capability.token,
        expect.any(Buffer),
        { cacheControl: 'private, max-age=0', contentType: 'image/jpeg', upsert: true }
      )
      expect(bucketApi.upload).not.toHaveBeenCalled()
    })

    it('raises STORAGE_PERMISSION_DENIED on an error result', async () => {
      bucketApi.uploadToSignedUrl.mockResolvedValueOnce({ error: { message: 'denied' } })

      const adapter = new SupabaseCommunityStorageAdapter()
      await expect(
        adapter.upload(
          'community/p/s.jpg',
          Buffer.from('bytes'),
          'image/jpeg',
          capability
        )
      ).rejects.toThrow('STORAGE_PERMISSION_DENIED')
    })
  })

  describe('remove', () => {
    it('short-circuits an empty list', async () => {
      const adapter = new SupabaseCommunityStorageAdapter()
      await adapter.remove([])
      expect(bucketApi.remove).not.toHaveBeenCalled()
    })

    it('raises when the delete fails instead of ignoring the error result', async () => {
      // A silent failure here is the difference between "content removed" and
      // "content still served from a signed URL", which is a takedown defect.
      bucketApi.remove.mockResolvedValueOnce({ error: { message: 'denied' } })

      const adapter = new SupabaseCommunityStorageAdapter()
      await expect(adapter.remove(['community/p/s.jpg'])).rejects.toThrow(
        'STORAGE_PERMISSION_DENIED'
      )
    })

    it('resolves when the delete succeeds', async () => {
      bucketApi.remove.mockResolvedValueOnce({ error: null })

      const adapter = new SupabaseCommunityStorageAdapter()
      await expect(adapter.remove(['community/p/s.jpg'])).resolves.toBeUndefined()
    })
  })
})
