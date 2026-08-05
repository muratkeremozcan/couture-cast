// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  WEB_ACCESS_TOKEN_STORAGE_KEY,
  listGarmentsFromWeb,
  uploadGarmentImageFromWeb,
} from './wardrobe'

afterEach(() => {
  window.sessionStorage.clear()
  vi.restoreAllMocks()
})

describe('uploadGarmentImageFromWeb & listGarmentsFromWeb', () => {
  it('throws error when access token is missing', async () => {
    await expect(listGarmentsFromWeb()).rejects.toThrow(
      'Your session expired. Sign in again before adding a garment.'
    )
    await expect(
      uploadGarmentImageFromWeb({
        imagePreview: 'data:image/png;base64,sample',
        aspectRatio: '1:1',
        useBgCleanup: false,
      })
    ).rejects.toThrow('Your session expired. Sign in again before adding a garment.')
  })

  it('fetches list of garments when authenticated', async () => {
    window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, 'test-access-token')
    const mockGarments = [
      {
        id: 'garment_1',
        status: 'ready',
        category: 'top',
        material: null,
        comfortRange: null,
        tagsConfirmedAt: null,
        fileSizeBytes: 1024,
        mimeType: 'image/png',
        retentionStatus: 'active',
        createdAt: '2026-08-04T09:25:00.000Z',
        committedAt: '2026-08-04T09:26:22.000Z',
        imageAccess: {
          url: 'https://example.test/img.png',
          expiresAt: '2026-08-04T09:41:22.000Z',
        },
      },
    ]

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: mockGarments }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await listGarmentsFromWeb()
    expect(result).toHaveLength(1)
    expect(result[0]?.id).toBe('garment_1')
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/wardrobe/garments'),
      expect.objectContaining({
        headers: { Authorization: 'Bearer test-access-token' },
      })
    )
  })

  it('handles HTTP error response when listing garments', async () => {
    window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, 'test-access-token')
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { message: 'Unauthorized request' } }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(listGarmentsFromWeb()).rejects.toThrow('Unauthorized request')
  })
})
