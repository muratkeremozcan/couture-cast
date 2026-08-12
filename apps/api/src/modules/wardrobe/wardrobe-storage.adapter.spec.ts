// Learning path Step 29: Garment capture flow.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-29-garment-capture-flow
import { ServiceUnavailableException } from '@nestjs/common'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SupabaseWardrobeStorageAdapter } from './wardrobe-storage.adapter'

const supabaseMocks = vi.hoisted(() => {
  const bucket = {
    createSignedUrl: vi.fn(),
    download: vi.fn(),
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
  })

  it('keeps the API available and fails storage operations closed without credentials', async () => {
    const adapter = new SupabaseWardrobeStorageAdapter()

    expect(supabaseMocks.createClient).not.toHaveBeenCalled()
    await expect(
      adapter.upload('path.png', Buffer.from('data'), 'image/png')
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
    supabaseMocks.bucket.upload.mockResolvedValue({ error: null })
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

    await expect(
      adapter.upload('user/garment.png', Buffer.from('garment-bytes'), 'image/png')
    ).resolves.toBeUndefined()
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
    expect(supabaseMocks.from).toHaveBeenCalledTimes(4)
    expect(supabaseMocks.from).toHaveBeenCalledWith('wardrobe-images')
    expect(supabaseMocks.bucket.upload).toHaveBeenCalledWith(
      'user/garment.png',
      Buffer.from('garment-bytes'),
      {
        cacheControl: 'private, max-age=0',
        contentType: 'image/png',
        upsert: false,
      }
    )
  })

  it('normalizes Supabase failures to a storage unavailable response', async () => {
    vi.stubEnv('SUPABASE_URL', 'https://wardrobe.supabase.co')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role-key')
    const storageError = new Error('provider details must stay private')
    supabaseMocks.bucket.upload.mockResolvedValue({ error: storageError })
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

    await expect(
      adapter.upload('user/garment.png', Buffer.from('garment-bytes'), 'image/png')
    ).rejects.toThrow('STORAGE_PERMISSION_DENIED')
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
