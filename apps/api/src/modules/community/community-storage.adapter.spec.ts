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
  COMMUNITY_IMAGES_BUCKET,
  SupabaseCommunityStorageAdapter,
} from './community-storage.adapter'

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
        adapter.upload('community/p/s.jpg', Buffer.from('x'), 'image/jpeg')
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
    it('returns the signed upload URL, token, and expiry', async () => {
      bucketApi.createSignedUploadUrl.mockResolvedValueOnce({
        data: { signedUrl: 'https://upload.test/put', token: 'tok-1' },
        error: null,
      })

      const adapter = new SupabaseCommunityStorageAdapter()
      const session = await adapter.createUploadSession('community/p/s.jpg', 900)

      expect(session.uploadUrl).toBe('https://upload.test/put')
      expect(session.uploadToken).toBe('tok-1')
      expect(new Date(session.expiresAt).getTime()).toBeGreaterThan(Date.now())
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
    it('overwrites the object in place for the re-encode step', async () => {
      bucketApi.upload.mockResolvedValueOnce({ error: null })

      const adapter = new SupabaseCommunityStorageAdapter()
      await adapter.upload('community/p/s.jpg', Buffer.from('bytes'), 'image/jpeg')

      expect(bucketApi.upload).toHaveBeenCalledWith(
        'community/p/s.jpg',
        expect.any(Buffer),
        { cacheControl: 'private, max-age=0', contentType: 'image/jpeg', upsert: true }
      )
    })

    it('raises STORAGE_PERMISSION_DENIED on an error result', async () => {
      bucketApi.upload.mockResolvedValueOnce({ error: { message: 'denied' } })

      const adapter = new SupabaseCommunityStorageAdapter()
      await expect(
        adapter.upload('community/p/s.jpg', Buffer.from('bytes'), 'image/jpeg')
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
