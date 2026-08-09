// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  WEB_ACCESS_TOKEN_STORAGE_KEY,
  listGarmentsFromWeb,
  uploadGarmentImageFromWeb,
  getOnboardingStateFromWeb,
  advanceOnboardingStepFromWeb,
  getSilhouetteProfileFromWeb,
  updateSilhouetteSlidersFromWeb,
  uploadMyFormPhotoFromWeb,
  deleteMyFormPhotoFromWeb,
  onboardingETag,
  silhouetteETag,
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

describe('onboardingETag & silhouetteETag', () => {
  it('builds the strong entity tag the API requires back on every mutation', () => {
    expect(onboardingETag('user-1', 0)).toBe('"onboarding:user-1:0"')
    expect(silhouetteETag('user-1', 3)).toBe('"silhouette:user-1:3"')
  })
})

describe('wardrobe onboarding state', () => {
  const mockState = {
    status: 'in_progress',
    currentStep: 'capture',
    usedStarterWardrobe: false,
    garmentsCapturedCount: 1,
    startedAt: '2026-08-09T09:00:00.000Z',
    completedAt: null,
    revision: 1,
  }

  it('throws when access token is missing', async () => {
    await expect(getOnboardingStateFromWeb()).rejects.toThrow('Your session expired.')
    await expect(
      advanceOnboardingStepFromWeb({ targetStep: 'capture' }, '"onboarding:u:0"')
    ).rejects.toThrow('Your session expired.')
  })

  it('fetches the current onboarding state when authenticated', async () => {
    window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, 'test-access-token')
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: mockState }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await getOnboardingStateFromWeb()
    expect(result.currentStep).toBe('capture')
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/wardrobe/onboarding'),
      expect.objectContaining({
        headers: { Authorization: 'Bearer test-access-token' },
      })
    )
  })

  it('sends the If-Match header and target step when advancing', async () => {
    window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, 'test-access-token')
    const advanced = { ...mockState, currentStep: 'tagging', revision: 2 }
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: advanced }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await advanceOnboardingStepFromWeb(
      { targetStep: 'tagging' },
      onboardingETag('user-1', 1)
    )
    expect(result.currentStep).toBe('tagging')
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(init.method).toBe('PATCH')
    expect((init.headers as Record<string, string>)['if-match']).toBe(
      '"onboarding:user-1:1"'
    )
    expect(JSON.parse(init.body as string)).toEqual({ targetStep: 'tagging' })
  })

  it('surfaces a stale-revision conflict as an actionable error', async () => {
    window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, 'test-access-token')
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: 'ONBOARDING_REVISION_MISMATCH' }), {
        status: 412,
        headers: { 'Content-Type': 'application/json' },
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      advanceOnboardingStepFromWeb({ targetStep: 'tagging' }, onboardingETag('user-1', 0))
    ).rejects.toThrow('ONBOARDING_REVISION_MISMATCH')
  })
})

describe('silhouette profile', () => {
  const mockProfile = {
    mode: 'default_mannequin',
    heightSlider: 50,
    buildSlider: 50,
    myForm: null,
    revision: 0,
    updatedAt: '2026-08-09T09:00:00.000Z',
  }

  it('throws when access token is missing', async () => {
    await expect(getSilhouetteProfileFromWeb()).rejects.toThrow('Your session expired.')
    await expect(
      updateSilhouetteSlidersFromWeb(
        { heightSlider: 40, buildSlider: 60 },
        '"silhouette:u:0"'
      )
    ).rejects.toThrow('Your session expired.')
    await expect(deleteMyFormPhotoFromWeb('"silhouette:u:0"')).rejects.toThrow(
      'Your session expired.'
    )
    await expect(
      uploadMyFormPhotoFromWeb({
        imagePreview: 'data:image/png;base64,sample',
        idempotencyKey: 'key-1',
      })
    ).rejects.toThrow('Your session expired.')
  })

  it('fetches the current silhouette profile when authenticated', async () => {
    window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, 'test-access-token')
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: mockProfile }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await getSilhouetteProfileFromWeb()
    expect(result.mode).toBe('default_mannequin')
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/wardrobe/silhouette'),
      expect.objectContaining({
        headers: { Authorization: 'Bearer test-access-token' },
      })
    )
  })

  it('sends slider values and the If-Match header when saving', async () => {
    window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, 'test-access-token')
    const saved = { ...mockProfile, heightSlider: 40, buildSlider: 60, revision: 1 }
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: saved }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await updateSilhouetteSlidersFromWeb(
      { heightSlider: 40, buildSlider: 60 },
      silhouetteETag('user-1', 0)
    )
    expect(result.heightSlider).toBe(40)
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(init.method).toBe('PUT')
    expect((init.headers as Record<string, string>)['if-match']).toBe(
      '"silhouette:user-1:0"'
    )
  })

  it('sends the If-Match header when removing the My Form photo', async () => {
    window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, 'test-access-token')
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: mockProfile }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await deleteMyFormPhotoFromWeb(silhouetteETag('user-1', 2))
    expect(result.mode).toBe('default_mannequin')
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(init.method).toBe('DELETE')
    expect((init.headers as Record<string, string>)['if-match']).toBe(
      '"silhouette:user-1:2"'
    )
  })
})
