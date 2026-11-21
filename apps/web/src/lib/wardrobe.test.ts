// Learning path Step 29: Garment capture flow.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-29-garment-capture-flow
// Learning path Step 30: Smart tagging and comfort metadata.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-30-smart-tagging-and-comfort-metadata
// Learning path Step 31: Outfit capsule builder.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-31-outfit-capsule-builder
// Learning path Step 32: Wardrobe onboarding and silhouette setup.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-32-wardrobe-onboarding-and-silhouette-setup
// Learning path Step 58: Image uploads straight to storage.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#image-uploads-straight-to-storage
// Learning path Step 58: Hosted wardrobe workers and manual tagging.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#hosted-wardrobe-workers-and-manual-tagging
// @vitest-environment jsdom
import { Blob as NodeBlob } from 'node:buffer'
import {
  GARMENT_TAGGING_ANALYSIS_VERSION,
  UploadSessionChangedError,
} from '@couture/api-client/contracts/http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  WEB_ACCESS_TOKEN_STORAGE_KEY,
  WardrobeRequestError,
  createCapsuleFromWeb,
  deleteCapsuleFromWeb,
  favoriteCapsuleFromWeb,
  generateIdempotencyKey,
  getCapsuleFromWeb,
  isStaleRevisionError,
  listCapsulesFromWeb,
  listGarmentsFromWeb,
  resolveCurrentUserId,
  suggestGarmentTagsFromWeb,
  updateCapsuleFromWeb,
  updateGarmentTagsFromWeb,
  uploadGarmentImageFromWeb,
  preparedImageEncoding,
  prepareGarmentImage,
  getOnboardingStateFromWeb,
  advanceOnboardingStepFromWeb,
  getSilhouetteProfileFromWeb,
  updateSilhouetteSlidersFromWeb,
  uploadMyFormPhotoFromWeb,
  deleteMyFormPhotoFromWeb,
  onboardingETag,
  silhouetteETag,
} from './wardrobe'
import {
  currentUploadSession,
  forgetAllUploadAttempts,
  setUploadAttemptAccount,
} from './upload-attempts'

afterEach(() => {
  // Open upload attempts live for the whole tab and are keyed by the prepared photo, which is
  // the same in every test here; each test starts signed out of the store with none open.
  setUploadAttemptAccount(null)
  forgetAllUploadAttempts()
  window.sessionStorage.clear()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

/**
 * `prepareGarmentImage` (shared by every upload wrapper) decodes the source
 * image and re-encodes it through a real `<canvas>`, neither of which jsdom
 * implements. Stubbed here rather than skipped so `uploadMyFormPhotoFromWeb`'s
 * actual transport sequence (allocate -> upload bytes -> commit) gets real
 * coverage instead of only ever being exercised through a fully-mocked
 * component-level `uploadMyFormPhotoFromWeb` stub.
 */
interface ImagePrepOverrides {
  naturalWidth?: number
  naturalHeight?: number
  /** Fail decoding, the way a corrupt or cross-origin file would. */
  failsToDecode?: boolean
  /** Replace the 2D context, e.g. with `null` for a browser that cannot supply one. */
  context?: CanvasRenderingContext2D | null
  /** Replace the encoded output, e.g. an unsupported format or an oversized blob. */
  encoded?: Blob | null
}

function installImagePrepMocks(overrides: ImagePrepOverrides = {}) {
  const failsToDecode = overrides.failsToDecode ?? false
  class FakeImage {
    naturalWidth = overrides.naturalWidth ?? 900
    naturalHeight = overrides.naturalHeight ?? 1200
    onload: (() => void) | null = null
    onerror: (() => void) | null = null
    set src(_value: string) {
      queueMicrotask(() => (failsToDecode ? this.onerror?.() : this.onload?.()))
    }
  }
  vi.stubGlobal('Image', FakeImage as unknown as typeof Image)
  const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    overrides.context === undefined
      ? ({
          drawImage: vi.fn(),
          fillRect: vi.fn(),
        } as unknown as CanvasRenderingContext2D)
      : overrides.context
  )
  const toBlob = vi
    .spyOn(HTMLCanvasElement.prototype, 'toBlob')
    .mockImplementation(function (
      this: HTMLCanvasElement,
      callback: BlobCallback,
      type?: string
    ) {
      if (overrides.encoded !== undefined) {
        callback(overrides.encoded)
        return
      }
      // jsdom's own `Blob` lacks `arrayBuffer()`, which `prepareGarmentImage`
      // needs to compute the sha256 digest; Node's `Blob` implements it.
      callback(
        new NodeBlob(['fixture-image-bytes'], {
          type: type ?? 'image/png',
        }) as unknown as Blob
      )
    })
  return { getContext, toBlob }
}

describe('uploadGarmentImageFromWeb & listGarmentsFromWeb', () => {
  it('throws error when access token is missing', async () => {
    await expect(listGarmentsFromWeb()).rejects.toThrow(
      'Your session expired. Sign in again before adding a garment.'
    )
    await expect(
      uploadGarmentImageFromWeb({
        imagePreview: 'data:image/png;base64,sample',
        uploadSession: currentUploadSession(),
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
        uploadSession: currentUploadSession(),
        confirmsBasewearGuidance: true,
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

// Learning path Step 58: Image uploads straight to storage.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#image-uploads-straight-to-storage
//
// Production follow-up 2026-11-19 (review round 6, Codex C5-1): the My Form panel removes for
// the account its profile was read under; the remover resolves the bearer for that session and
// refuses once another account is signed in.
describe('deleteMyFormPhotoFromWeb for the session the profile was read under', () => {
  const removedProfile = {
    mode: 'default_mannequin',
    heightSlider: 50,
    buildSlider: 50,
    myForm: null,
    revision: 10,
    updatedAt: '2026-08-09T09:00:00.000Z',
  }

  it('removes with the bearer resolved for a session that is still current', async () => {
    window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, 'member-b-token')
    setUploadAttemptAccount('member-b')
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: removedProfile }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    await deleteMyFormPhotoFromWeb(
      silhouetteETag('member-b', 9),
      undefined,
      currentUploadSession()
    )

    expect(fetchMock).toHaveBeenCalledOnce()
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer member-b-token')
  })

  it('refuses without a request once another account is signed in', async () => {
    window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, 'member-b-token')
    setUploadAttemptAccount('member-a')
    const memberASession = currentUploadSession()
    setUploadAttemptAccount('member-b')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      deleteMyFormPhotoFromWeb(silhouetteETag('member-a', 4), undefined, memberASession)
    ).rejects.toBeInstanceOf(UploadSessionChangedError)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

/** `input.toString()` on a `Request` yields `"[object Request]"`, not its URL. */
function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  return input.url
}

describe('uploadMyFormPhotoFromWeb transport sequence', () => {
  const mockAllocation = {
    uploadSessionId: 'upload-session-1',
    uploadUrl: 'https://storage.test/silhouette/upload-session-1',
    uploadToken: 'upload-token-1',
    requiredHeaders: { 'content-type': 'image/png' },
    expiresAt: '2026-08-09T10:00:00.000Z',
  }
  const processingProfile = {
    mode: 'my_form',
    heightSlider: 50,
    buildSlider: 50,
    myForm: {
      status: 'processing',
      failureReason: null,
      committedAt: '2026-08-09T09:05:00.000Z',
      imageAccess: null,
    },
    revision: 1,
    updatedAt: '2026-08-09T09:05:00.000Z',
  }

  function jsonResponse(body: unknown) {
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  /** Routes each leg (allocate, upload PUT, commit) to its own canned response. */
  function installTransportFetchMock(
    overrides: {
      allocation?: unknown
      uploadStatus?: number
      commitBody?: unknown
      commitStatus?: number
    } = {}
  ) {
    const handleFetch = (
      input: RequestInfo | URL,
      _init?: RequestInit
    ): Promise<Response> => {
      const url = requestUrl(input)
      if (url.includes('/silhouette/my-form/upload-url')) {
        return Promise.resolve(
          jsonResponse({ data: overrides.allocation ?? mockAllocation })
        )
      }
      if (url === mockAllocation.uploadUrl) {
        return Promise.resolve(
          new Response(null, { status: overrides.uploadStatus ?? 200 })
        )
      }
      if (url.includes('/silhouette/my-form/commit')) {
        return Promise.resolve(
          new Response(
            JSON.stringify(overrides.commitBody ?? { data: processingProfile }),
            {
              status: overrides.commitStatus ?? 200,
              headers: { 'Content-Type': 'application/json' },
            }
          )
        )
      }
      return Promise.reject(new Error(`Unhandled fetch in test: ${url}`))
    }
    const fetchMock = vi.fn(handleFetch)
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  it('runs allocate, upload, and commit in sequence and returns the committed profile', async () => {
    window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, 'test-access-token')
    installImagePrepMocks()
    const fetchMock = installTransportFetchMock()

    const result = await uploadMyFormPhotoFromWeb({
      imagePreview: 'data:image/png;base64,c2FtcGxl',
      uploadSession: currentUploadSession(),
      confirmsBasewearGuidance: true,
    })

    expect(result.myForm?.status).toBe('processing')

    const calledUrls = fetchMock.mock.calls.map(([input]) => requestUrl(input))
    expect(calledUrls.some((url) => url.includes('/silhouette/my-form/upload-url'))).toBe(
      true
    )
    expect(calledUrls).toContain(mockAllocation.uploadUrl)
    expect(calledUrls.some((url) => url.includes('/silhouette/my-form/commit'))).toBe(
      true
    )
  })

  // Learning path Step 58: Image uploads straight to storage.
  // See _bmad-output/project-knowledge/learning-path-step-by-step.md#image-uploads-straight-to-storage
  it('refuses a photo picked under another account before preparing or sending anything', async () => {
    window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, 'member-b-access-token')
    const { toBlob } = installImagePrepMocks()
    const fetchMock = installTransportFetchMock()
    setUploadAttemptAccount('member-a')
    const pickedUnderA = currentUploadSession()
    setUploadAttemptAccount('member-b')

    await expect(
      uploadMyFormPhotoFromWeb({
        imagePreview: 'data:image/png;base64,c2FtcGxl',
        uploadSession: pickedUnderA,
        confirmsBasewearGuidance: true,
      })
    ).rejects.toBeInstanceOf(UploadSessionChangedError)

    expect(toBlob).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  /** A full-body photo has no transparency; as PNG it was several megabytes. */
  it('prepares the My Form photo as JPEG and declares it so', async () => {
    window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, 'test-access-token')
    const { toBlob } = installImagePrepMocks()
    const fetchMock = installTransportFetchMock()

    await uploadMyFormPhotoFromWeb({
      imagePreview: 'data:image/png;base64,c2FtcGxl',
      uploadSession: currentUploadSession(),
      confirmsBasewearGuidance: true,
    })

    expect(toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/jpeg', 0.9)
    const allocateCall = fetchMock.mock.calls.find(([input]) =>
      requestUrl(input).includes('/silhouette/my-form/upload-url')
    )
    expect(
      (
        JSON.parse((allocateCall?.[1] as RequestInit).body as string) as {
          mimeType: string
        }
      ).mimeType
    ).toBe('image/jpeg')
  })

  it('sends a UUID idempotency key on the allocate request and its own on the commit', async () => {
    window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, 'test-access-token')
    installImagePrepMocks()
    const fetchMock = installTransportFetchMock()

    await uploadMyFormPhotoFromWeb({
      imagePreview: 'data:image/png;base64,c2FtcGxl',
      uploadSession: currentUploadSession(),
      confirmsBasewearGuidance: true,
    })

    const allocateCall = fetchMock.mock.calls.find(([input]) =>
      requestUrl(input).includes('/silhouette/my-form/upload-url')
    )
    const commitCall = fetchMock.mock.calls.find(([input]) =>
      requestUrl(input).includes('/silhouette/my-form/commit')
    )
    const allocateHeaders = (allocateCall?.[1] as RequestInit).headers as Record<
      string,
      string
    >
    const commitHeaders = (commitCall?.[1] as RequestInit).headers as Record<
      string,
      string
    >
    const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    expect(allocateHeaders['idempotency-key']).toMatch(uuidV4)
    expect(commitHeaders['idempotency-key']).toMatch(uuidV4)
    expect(commitHeaders['idempotency-key']).not.toBe(allocateHeaders['idempotency-key'])
  })

  it('sends the confirmed basewear guidance flag in the commit payload', async () => {
    window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, 'test-access-token')
    installImagePrepMocks()
    const fetchMock = installTransportFetchMock()

    await uploadMyFormPhotoFromWeb({
      imagePreview: 'data:image/png;base64,c2FtcGxl',
      uploadSession: currentUploadSession(),
      confirmsBasewearGuidance: true,
    })

    const commitCall = fetchMock.mock.calls.find(([input]) =>
      requestUrl(input).includes('/silhouette/my-form/commit')
    )
    const body = JSON.parse((commitCall?.[1] as RequestInit).body as string) as {
      confirmsBasewearGuidance: boolean
      uploadSessionId: string
    }
    expect(body.confirmsBasewearGuidance).toBe(true)
    expect(body.uploadSessionId).toBe(mockAllocation.uploadSessionId)
  })

  it('rejects instead of silently accepting a malformed allocation response', async () => {
    window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, 'test-access-token')
    installImagePrepMocks()
    // Missing the required `uploadToken` field the schema demands.
    installTransportFetchMock({
      allocation: { ...mockAllocation, uploadToken: undefined },
    })

    await expect(
      uploadMyFormPhotoFromWeb({
        imagePreview: 'data:image/png;base64,c2FtcGxl',
        uploadSession: currentUploadSession(),
        confirmsBasewearGuidance: true,
      })
    ).rejects.toThrow()
  })

  /**
   * Storage rejecting the bytes is the leg most likely to fail on a phone, and
   * it must not read as a generic "something went wrong" with no next step.
   */
  it('reports a byte-upload rejection without attempting the commit', async () => {
    window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, 'test-access-token')
    installImagePrepMocks()
    const fetchMock = installTransportFetchMock({ uploadStatus: 500 })

    await expect(
      uploadMyFormPhotoFromWeb({
        imagePreview: 'data:image/png;base64,c2FtcGxl',
        uploadSession: currentUploadSession(),
        confirmsBasewearGuidance: true,
      })
    ).rejects.toThrow('Upload failed with HTTP 500')

    const calledUrls = fetchMock.mock.calls.map(([input]) => requestUrl(input))
    expect(calledUrls.some((url) => url.includes('/silhouette/my-form/commit'))).toBe(
      false
    )
  })

  /** A moderation rejection arrives at commit time and has to reach the user verbatim. */
  it('reports a commit rejection with the server message', async () => {
    window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, 'test-access-token')
    installImagePrepMocks()
    installTransportFetchMock({
      commitStatus: 422,
      commitBody: { message: 'Photo did not pass the basewear check' },
    })

    await expect(
      uploadMyFormPhotoFromWeb({
        imagePreview: 'data:image/png;base64,c2FtcGxl',
        uploadSession: currentUploadSession(),
        confirmsBasewearGuidance: true,
      })
    ).rejects.toThrow('Photo did not pass the basewear check')
  })
})

/**
 * Production follow-up 2026-11-19, review round 2 (C2-6): one upload attempt keeps its session
 * and both idempotency keys across the member's retries. A retry commits first, because the
 * bytes or the commit itself may already have landed with only the answer lost, and re-sends the
 * bytes only when commit answers UPLOAD_BYTES_MISSING.
 */
describe('upload attempts across retries', () => {
  type Leg = 'allocate' | 'upload' | 'commit'
  type Answer = () => Promise<Response>

  const ok =
    (body: unknown): Answer =>
    () =>
      Promise.resolve(
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )
  const fails =
    (status: number, message: string): Answer =>
    () =>
      Promise.resolve(
        new Response(JSON.stringify({ statusCode: status, message, error: 'Conflict' }), {
          status,
          headers: { 'Content-Type': 'application/json' },
        })
      )
  const stored: Answer = () => Promise.resolve(new Response(null, { status: 200 }))
  const networkDown: Answer = () => Promise.reject(new TypeError('Failed to fetch'))

  /** Answers each leg from its own queue, in order, and records every call per leg. */
  function installLegs(
    routes: { allocate: string; upload: string; commit: string },
    queues: Record<Leg, Answer[]>
  ) {
    const calls: Record<Leg, RequestInit[]> = { allocate: [], upload: [], commit: [] }
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input)
      const leg: Leg | null = url.includes(routes.allocate)
        ? 'allocate'
        : url === routes.upload
          ? 'upload'
          : url.includes(routes.commit)
            ? 'commit'
            : null
      if (!leg) return Promise.reject(new Error(`Unhandled fetch in test: ${url}`))
      calls[leg].push(init ?? {})
      const answer = queues[leg].shift()
      if (!answer) return Promise.reject(new Error(`No answer left for ${leg}`))
      return answer()
    })
    vi.stubGlobal('fetch', fetchMock)
    return calls
  }

  const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

  function keyOf(init: RequestInit | undefined): string | undefined {
    return (init?.headers as Record<string, string> | undefined)?.['idempotency-key']
  }

  describe('My Form', () => {
    const routes = {
      allocate: '/silhouette/my-form/upload-url',
      upload: 'https://storage.test/staging/my-form-session',
      commit: '/silhouette/my-form/commit',
    }
    const allocation = {
      data: {
        uploadSessionId: 'my-form-session',
        uploadUrl: routes.upload,
        uploadToken: 'upload-token',
        requiredHeaders: { 'content-type': 'image/jpeg' },
        expiresAt: '2026-11-19T10:15:00.000Z',
      },
    }
    const committed = {
      data: {
        mode: 'default_mannequin',
        heightSlider: null,
        buildSlider: null,
        myForm: {
          status: 'processing',
          failureReason: null,
          committedAt: '2026-11-19T10:01:00.000Z',
          imageAccess: null,
        },
        revision: 2,
        updatedAt: '2026-11-19T10:01:00.000Z',
      },
    }
    const upload = () =>
      uploadMyFormPhotoFromWeb({
        imagePreview: 'data:image/png;base64,c2FtcGxl',
        uploadSession: currentUploadSession(),
        confirmsBasewearGuidance: true,
      })

    it('replays a commit whose answer was lost with the same key, without allocating or uploading again', async () => {
      authenticate()
      installImagePrepMocks()
      const calls = installLegs(routes, {
        allocate: [ok(allocation)],
        upload: [stored],
        commit: [networkDown, ok(committed)],
      })

      await expect(upload()).rejects.toThrow()
      const profile = await upload()

      expect(profile.myForm?.status).toBe('processing')
      expect(calls.allocate).toHaveLength(1)
      expect(calls.upload).toHaveLength(1)
      expect(calls.commit).toHaveLength(2)
      expect(keyOf(calls.commit[1])).toBe(keyOf(calls.commit[0]))
    })

    it('re-sends the bytes on a retry only after commit answers UPLOAD_BYTES_MISSING', async () => {
      authenticate()
      installImagePrepMocks()
      const calls = installLegs(routes, {
        allocate: [ok(allocation)],
        upload: [() => Promise.resolve(new Response(null, { status: 503 })), stored],
        commit: [fails(409, 'UPLOAD_BYTES_MISSING'), ok(committed)],
      })

      await expect(upload()).rejects.toThrow('Upload failed with HTTP 503')
      await upload()

      expect(calls.allocate).toHaveLength(1)
      expect(calls.upload).toHaveLength(2)
      expect(calls.commit).toHaveLength(2)
      expect(keyOf(calls.commit[1])).toBe(keyOf(calls.commit[0]))
    })

    it('starts one fresh attempt in the same retry when its commit answers UPLOAD_SESSION_EXPIRED', async () => {
      authenticate()
      installImagePrepMocks()
      const calls = installLegs(routes, {
        allocate: [ok(allocation), ok(allocation)],
        upload: [stored, stored],
        commit: [networkDown, fails(409, 'UPLOAD_SESSION_EXPIRED'), ok(committed)],
      })

      await expect(upload()).rejects.toThrow(
        'The request failed and the interceptors did not return an alternative response'
      )
      // The retry commits the open attempt first; the server ended it, so the same retry
      // allocates, uploads and commits once more with fresh keys.
      const profile = await upload()

      expect(profile.myForm?.status).toBe('processing')
      expect(calls.allocate).toHaveLength(2)
      expect(calls.upload).toHaveLength(2)
      expect(calls.commit).toHaveLength(3)
      expect(keyOf(calls.allocate[1])).toMatch(UUID_V4)
      expect(keyOf(calls.allocate[1])).not.toBe(keyOf(calls.allocate[0]))
      expect(keyOf(calls.commit[0])).toMatch(UUID_V4)
      expect(keyOf(calls.commit[1])).toBe(keyOf(calls.commit[0]))
      expect(keyOf(calls.commit[2])).toMatch(UUID_V4)
      expect(keyOf(calls.commit[2])).not.toBe(keyOf(calls.commit[0]))
    })

    it('keeps the attempt after UPLOAD_IN_PROGRESS, so the retry commits again with the same key', async () => {
      authenticate()
      installImagePrepMocks()
      const calls = installLegs(routes, {
        allocate: [ok(allocation)],
        upload: [stored],
        commit: [fails(409, 'UPLOAD_IN_PROGRESS'), ok(committed)],
      })

      await expect(upload()).rejects.toThrow(
        'This photo is still being saved. Try again in a moment.'
      )
      const profile = await upload()

      expect(profile.myForm?.status).toBe('processing')
      expect(calls.allocate).toHaveLength(1)
      expect(calls.upload).toHaveLength(1)
      expect(calls.commit).toHaveLength(2)
      expect(keyOf(calls.commit[1])).toBe(keyOf(calls.commit[0]))
    })

    it('forgets a committed attempt, so the same photo uploads again from allocation', async () => {
      authenticate()
      installImagePrepMocks()
      const calls = installLegs(routes, {
        allocate: [ok(allocation), ok(allocation)],
        upload: [stored, stored],
        commit: [ok(committed), ok(committed)],
      })

      await upload()
      await upload()

      expect(calls.allocate).toHaveLength(2)
      expect(calls.upload).toHaveLength(2)
      expect(calls.commit).toHaveLength(2)
    })
  })

  describe('garment', () => {
    const routes = {
      allocate: '/api/v1/wardrobe/upload-url',
      upload: 'https://storage.test/staging/garment-session',
      commit: '/api/v1/wardrobe/garments',
    }
    const allocation = {
      data: {
        garmentId: 'garment-1',
        uploadSessionId: 'garment-session',
        uploadUrl: routes.upload,
        uploadToken: 'upload-token',
        requiredHeaders: { 'content-type': 'image/jpeg' },
        expiresAt: '2026-11-19T10:15:00.000Z',
      },
    }
    const committed = { data: { ...garmentFixture, status: 'processing' } }
    const upload = () =>
      uploadGarmentImageFromWeb({
        imagePreview: 'data:image/png;base64,c2FtcGxl',
        uploadSession: currentUploadSession(),
        aspectRatio: '1:1',
        useBgCleanup: false,
      })

    // Each test prepares a differently sized image, so no attempt one test leaves open is a
    // retry of another test's upload.
    it('keeps both keys for a retry of the same prepared image and commits first', async () => {
      authenticate()
      installImagePrepMocks({ naturalWidth: 1001, naturalHeight: 1001 })
      const calls = installLegs(routes, {
        allocate: [ok(allocation)],
        upload: [stored],
        commit: [networkDown, ok(committed)],
      })

      await expect(upload()).rejects.toThrow()
      const garment = await upload()

      expect(garment.status).toBe('processing')
      expect(calls.allocate).toHaveLength(1)
      expect(calls.upload).toHaveLength(1)
      expect(calls.commit).toHaveLength(2)
      expect(keyOf(calls.commit[1])).toBe(keyOf(calls.commit[0]))
      expect(keyOf(calls.commit[0])).not.toBe(keyOf(calls.allocate[0]))
    })

    it('re-sends the bytes only after commit answers UPLOAD_BYTES_MISSING', async () => {
      authenticate()
      installImagePrepMocks({ naturalWidth: 1002, naturalHeight: 1002 })
      const calls = installLegs(routes, {
        allocate: [ok(allocation)],
        upload: [networkDown, stored],
        commit: [fails(409, 'UPLOAD_BYTES_MISSING'), ok(committed)],
      })

      await expect(upload()).rejects.toThrow('Failed to fetch')
      await upload()

      expect(calls.allocate).toHaveLength(1)
      expect(calls.upload).toHaveLength(2)
      expect(calls.commit).toHaveLength(2)
    })

    it('starts a new garment after a terminal commit failure and after a success', async () => {
      authenticate()
      installImagePrepMocks({ naturalWidth: 1003, naturalHeight: 1003 })
      const calls = installLegs(routes, {
        allocate: [ok(allocation), ok(allocation), ok(allocation)],
        upload: [stored, stored, stored],
        commit: [fails(422, 'IMAGE_CHECKSUM_MISMATCH'), ok(committed), ok(committed)],
      })

      await expect(upload()).rejects.toThrow('IMAGE_CHECKSUM_MISMATCH')
      await upload()
      await upload()

      expect(calls.allocate).toHaveLength(3)
      const allocateKeys = calls.allocate.map(keyOf)
      expect(new Set(allocateKeys).size).toBe(3)
    })

    /** Review round 4 (C3-9): attempts belong to the account that opened them. */
    it("never commits another account's open session when the next account picks the same photo", async () => {
      authenticate()
      installImagePrepMocks({ naturalWidth: 1004, naturalHeight: 1004 })
      setUploadAttemptAccount('account-a')
      const calls = installLegs(routes, {
        allocate: [ok(allocation), ok(allocation)],
        upload: [networkDown, stored],
        commit: [ok(committed)],
      })

      await expect(upload()).rejects.toThrow('Failed to fetch')
      setUploadAttemptAccount('account-b')
      await upload()

      expect(calls.allocate).toHaveLength(2)
      expect(keyOf(calls.allocate[1])).not.toBe(keyOf(calls.allocate[0]))
      expect(calls.commit).toHaveLength(1)
    })

    it('fences an allocation that answers after the account changed and keeps nothing from it', async () => {
      authenticate()
      installImagePrepMocks({ naturalWidth: 1005, naturalHeight: 1005 })
      setUploadAttemptAccount('account-a')
      let answerAllocation: () => void = () => undefined
      const lateAllocation: () => Promise<Response> = () =>
        new Promise((resolve) => {
          answerAllocation = () => void ok(allocation)().then(resolve)
        })
      const calls = installLegs(routes, {
        allocate: [lateAllocation, ok(allocation)],
        upload: [stored],
        commit: [ok(committed)],
      })

      const first = upload()
      await vi.waitFor(() => expect(calls.allocate).toHaveLength(1))
      setUploadAttemptAccount('account-b')
      answerAllocation()

      await expect(first).rejects.toBeInstanceOf(UploadSessionChangedError)
      expect(calls.upload).toHaveLength(0)
      await upload()
      expect(calls.allocate).toHaveLength(2)
      expect(keyOf(calls.allocate[1])).not.toBe(keyOf(calls.allocate[0]))
      expect(calls.upload).toHaveLength(1)
    })
  })
})

// ---------------------------------------------------------------------------
// Shared fixtures for the account, tagging, and capsule wrappers
// ---------------------------------------------------------------------------

function authenticate() {
  window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, 'test-access-token')
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function stubFetchOnce(response: Response) {
  const fetchMock = vi.fn().mockResolvedValue(response)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const profileFixture = {
  user: {
    id: 'user-1',
    email: 'owner@example.test',
    displayName: 'Owner',
    birthdate: null,
    role: 'teen',
  },
  linkedGuardians: [],
  linkedTeens: [],
}

const capsuleFixture = {
  id: 'cap-1',
  ownerUserId: 'user-1',
  name: 'Rainy commute',
  description: 'Layered for drizzle',
  occasions: ['work'],
  isFavorite: false,
  revision: 3,
  availabilityStatus: 'ready',
  unavailableGarmentCount: 0,
  garments: [
    {
      id: 'g-1',
      category: 'top',
      material: 'cotton',
      comfortRange: 'mild',
      imageAccess: null,
      availabilityStatus: 'ready',
      garmentOrder: 0,
    },
    {
      id: 'g-2',
      category: 'bottom',
      material: 'denim',
      comfortRange: 'mild',
      imageAccess: null,
      availabilityStatus: 'ready',
      garmentOrder: 1,
    },
  ],
  createdAt: '2026-08-05T10:00:00.000Z',
  updatedAt: '2026-08-06T10:00:00.000Z',
}

const garmentFixture = {
  id: 'garment-1',
  status: 'awaiting_tags',
  category: null,
  material: null,
  comfortRange: null,
  tagsConfirmedAt: null,
  fileSizeBytes: 1024,
  mimeType: 'image/png',
  retentionStatus: 'active',
  createdAt: '2026-08-04T09:25:00.000Z',
  committedAt: '2026-08-04T09:26:22.000Z',
  imageAccess: null,
}

describe('resolveCurrentUserId', () => {
  it('throws before any request when the session token is missing', async () => {
    await expect(resolveCurrentUserId()).rejects.toThrow(
      'Your session expired. Sign in again before adding a garment.'
    )
  })

  /**
   * Capsule routes take an explicit owner segment, so the wrapper asks the API
   * who the caller is rather than decoding the bearer token client-side.
   */
  it('reads the signed-in user id from the profile endpoint', async () => {
    authenticate()
    const fetchMock = stubFetchOnce(jsonResponse(profileFixture))

    await expect(resolveCurrentUserId()).resolves.toBe('user-1')
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/api/v1/user/profile')
    expect(init.method).toBe('GET')
  })

  /** A rejected profile read must not leave the page guessing at an owner id. */
  it('reports an unusable profile response as an account problem', async () => {
    authenticate()
    stubFetchOnce(jsonResponse({ message: 'Unauthorized' }, 401))

    await expect(resolveCurrentUserId()).rejects.toThrow(
      'Unable to confirm your account. Sign in again.'
    )
  })

  it('carries the underlying failure through as the error code', async () => {
    authenticate()
    stubFetchOnce(jsonResponse({ user: { id: 'user-1' } }))

    const error = await resolveCurrentUserId().catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(WardrobeRequestError)
    expect((error as WardrobeRequestError).code).toEqual(expect.any(String))
  })
})

describe('garment tagging wrappers', () => {
  // The wire shape the API sends for a suggested answer: no `mode`.
  const suggestionsFixture = {
    garmentId: 'garment-1',
    analysisVersion: GARMENT_TAGGING_ANALYSIS_VERSION,
    suggestions: {
      category: { value: 'top', confidence: 0.91, isConfident: true },
      material: { value: 'cotton', confidence: 0.44, isConfident: false },
      comfortRange: { value: 'mild', confidence: 0.77, isConfident: true },
    },
  }

  it('throws before any request when the session token is missing', async () => {
    await expect(suggestGarmentTagsFromWeb('garment-1')).rejects.toThrow(
      'Your session expired.'
    )
    await expect(
      updateGarmentTagsFromWeb('garment-1', { category: 'top', comfortRange: 'mild' })
    ).rejects.toThrow('Your session expired.')
  })

  it('returns suggestions with their confidence flags intact', async () => {
    authenticate()
    const fetchMock = stubFetchOnce(jsonResponse({ data: suggestionsFixture }))

    const result = await suggestGarmentTagsFromWeb('garment-1')

    // The low-confidence flag is what makes the UI ask instead of pre-filling.
    expect(result).toMatchObject({
      mode: 'suggested',
      suggestions: {
        material: { isConfident: false },
        category: { value: 'top' },
      },
    })
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/api/v1/wardrobe/garments/garment-1/suggest-tags')
    expect(init.method).toBe('POST')
  })

  it('returns the manual-mode answer, with no suggestions, as the API sent it', async () => {
    authenticate()
    stubFetchOnce(jsonResponse({ data: { mode: 'manual', garmentId: 'garment-1' } }))

    await expect(suggestGarmentTagsFromWeb('garment-1')).resolves.toEqual({
      mode: 'manual',
      garmentId: 'garment-1',
    })
  })

  it('normalizes an answer with no mode to suggested (every suggested answer on the wire)', async () => {
    authenticate()
    stubFetchOnce(jsonResponse({ data: suggestionsFixture }))

    await expect(suggestGarmentTagsFromWeb('garment-1')).resolves.toEqual({
      ...suggestionsFixture,
      mode: 'suggested',
    })
  })

  it('still rejects a no-mode answer that is not a complete suggestion', async () => {
    authenticate()
    const { suggestions: _suggestions, ...withoutSuggestions } = suggestionsFixture
    void _suggestions
    stubFetchOnce(jsonResponse({ data: withoutSuggestions }))

    // The schema error surfaces, not a half-read answer.
    await expect(suggestGarmentTagsFromWeb('garment-1')).rejects.toMatchObject({
      name: 'ZodError',
    })
  })

  /**
   * The tagging model is a degraded-dependency path: when inference is
   * unavailable the caller must be able to branch on the code, not string-match
   * a message, so it can offer manual tagging instead.
   */
  it('preserves the inference-unavailable code so the caller can fall back', async () => {
    authenticate()
    stubFetchOnce(
      jsonResponse(
        {
          error: {
            code: 'TAGGING_INFERENCE_UNAVAILABLE',
            message: 'Suggestions are temporarily unavailable.',
          },
        },
        503
      )
    )

    const error = await suggestGarmentTagsFromWeb('garment-1').catch(
      (caught: unknown) => caught
    )
    expect(error).toBeInstanceOf(WardrobeRequestError)
    expect((error as WardrobeRequestError).code).toBe('TAGGING_INFERENCE_UNAVAILABLE')
    expect((error as Error).message).toBe('Suggestions are temporarily unavailable.')
  })

  /** Some server errors send the sentinel as the message; it still has to become a code. */
  it('promotes a known sentinel message to an error code', async () => {
    authenticate()
    stubFetchOnce(jsonResponse({ message: 'GARMENT_ANALYSIS_PENDING' }, 409))

    const error = await suggestGarmentTagsFromWeb('garment-1').catch(
      (caught: unknown) => caught
    )
    expect((error as WardrobeRequestError).code).toBe('GARMENT_ANALYSIS_PENDING')
  })

  /** An HTML error page from a proxy must not surface as a JSON parse crash. */
  it('falls back to a status message when the error body is not JSON', async () => {
    authenticate()
    stubFetchOnce(new Response('<html>Bad Gateway</html>', { status: 502 }))

    await expect(suggestGarmentTagsFromWeb('garment-1')).rejects.toThrow(
      'Wardrobe request failed with status 502'
    )
  })

  it('sends the confirmed tags and returns the updated garment', async () => {
    authenticate()
    const confirmed = {
      ...garmentFixture,
      status: 'ready',
      category: 'top',
      material: 'cotton',
      comfortRange: 'mild',
      tagsConfirmedAt: '2026-08-06T10:00:00.000Z',
    }
    const fetchMock = stubFetchOnce(jsonResponse({ data: confirmed }))

    const result = await updateGarmentTagsFromWeb('garment-1', {
      category: 'top',
      material: 'cotton',
      comfortRange: 'mild',
    })

    expect(result.tagsConfirmedAt).toBe('2026-08-06T10:00:00.000Z')
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/api/v1/wardrobe/garments/garment-1/tags')
    expect(init.method).toBe('PATCH')
    expect(JSON.parse(init.body as string)).toEqual({
      category: 'top',
      material: 'cotton',
      comfortRange: 'mild',
    })
  })

  it('surfaces a save failure with the server message', async () => {
    authenticate()
    stubFetchOnce(jsonResponse({ message: 'Invalid garment tags' }, 400))

    await expect(
      updateGarmentTagsFromWeb('garment-1', { category: 'top', comfortRange: 'mild' })
    ).rejects.toThrow('Invalid garment tags')
  })
})

describe('withRequestTimeout', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  /** A hung tagging request must become an actionable retry prompt, not a spinner forever. */
  it('turns a stalled request into a timeout message', async () => {
    vi.useFakeTimers()
    authenticate()
    const fetchMock = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted.', 'AbortError'))
          })
        })
    )
    vi.stubGlobal('fetch', fetchMock)

    const pending = suggestGarmentTagsFromWeb('garment-1')
    const assertion = expect(pending).rejects.toThrow(
      'Wardrobe request timed out. Please try again.'
    )
    await vi.advanceTimersByTimeAsync(15_000)
    await assertion
  })

  /** A caller that already aborted (component unmounted) must not be told it timed out. */
  it('propagates a caller abort rather than reporting a timeout', async () => {
    authenticate()
    const controller = new AbortController()
    controller.abort(new Error('caller navigated away'))
    const fetchMock = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          if (init?.signal?.aborted) {
            reject(new DOMException('The operation was aborted.', 'AbortError'))
            return
          }
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted.', 'AbortError'))
          })
        })
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      suggestGarmentTagsFromWeb('garment-1', controller.signal)
    ).rejects.not.toThrow('Wardrobe request timed out. Please try again.')
  })
})

describe('outfit capsule wrappers', () => {
  it('throws before any request when the session token is missing', async () => {
    await expect(listCapsulesFromWeb('user-1')).rejects.toThrow('Your session expired.')
    await expect(getCapsuleFromWeb('user-1', 'cap-1')).rejects.toThrow(
      'Your session expired.'
    )
    await expect(
      createCapsuleFromWeb(
        'user-1',
        { name: 'x', occasions: ['work'], garmentIds: ['g-1', 'g-2'], isFavorite: false },
        'key-1'
      )
    ).rejects.toThrow('Your session expired.')
    await expect(
      updateCapsuleFromWeb('user-1', 'cap-1', { name: 'y' }, '"capsule:cap-1:1"')
    ).rejects.toThrow('Your session expired.')
    await expect(
      favoriteCapsuleFromWeb('user-1', 'cap-1', true, '"capsule:cap-1:1"')
    ).rejects.toThrow('Your session expired.')
    await expect(
      deleteCapsuleFromWeb('user-1', 'cap-1', '"capsule:cap-1:1"')
    ).rejects.toThrow('Your session expired.')
  })

  /** The page shows "x of y"; without the totals it cannot say what is not shown. */
  it('returns the page alongside its totals and applies the default window', async () => {
    authenticate()
    const fetchMock = stubFetchOnce(
      jsonResponse({ data: [capsuleFixture], total: 87, limit: 50, offset: 0 })
    )

    const result = await listCapsulesFromWeb('user-1')

    expect(result.items).toHaveLength(1)
    expect(result.total).toBe(87)
    expect(result.limit).toBe(50)
    const [url] = fetchMock.mock.calls[0] as [string]
    expect(url).toContain('/api/v1/wardrobe/user-1/capsules')
    expect(url).toContain('limit=50')
    expect(url).toContain('offset=0')
  })

  it('lets an explicit query override the default window and add filters', async () => {
    authenticate()
    const fetchMock = stubFetchOnce(
      jsonResponse({ data: [], total: 0, limit: 10, offset: 20 })
    )

    await listCapsulesFromWeb('user-1', {
      limit: 10,
      offset: 20,
      occasion: 'work',
      isFavorite: true,
    })

    const [url] = fetchMock.mock.calls[0] as [string]
    expect(url).toContain('limit=10')
    expect(url).toContain('offset=20')
    expect(url).toContain('occasion=work')
    expect(url).toContain('isFavorite=true')
  })

  it('surfaces a list failure with the server message', async () => {
    authenticate()
    stubFetchOnce(jsonResponse({ message: 'Owner wardrobe is not accessible' }, 403))

    await expect(listCapsulesFromWeb('user-1')).rejects.toThrow(
      'Owner wardrobe is not accessible'
    )
  })

  it('reads a single capsule with its garment order', async () => {
    authenticate()
    const fetchMock = stubFetchOnce(jsonResponse({ data: capsuleFixture }))

    const result = await getCapsuleFromWeb('user-1', 'cap-1')

    expect(result.garments.map((garment) => garment.id)).toEqual(['g-1', 'g-2'])
    const [url] = fetchMock.mock.calls[0] as [string]
    expect(url).toContain('/api/v1/wardrobe/user-1/capsules/cap-1')
  })

  it('surfaces a missing capsule with the server message', async () => {
    authenticate()
    stubFetchOnce(jsonResponse({ message: 'Capsule not found' }, 404))

    await expect(getCapsuleFromWeb('user-1', 'cap-1')).rejects.toThrow(
      'Capsule not found'
    )
  })

  /**
   * The key is supplied by the caller and replayed on retry: minting one per
   * call is exactly how a timed-out create ends up making two capsules.
   */
  it('sends the caller-supplied idempotency key when creating', async () => {
    authenticate()
    const fetchMock = stubFetchOnce(jsonResponse({ data: capsuleFixture }, 201))

    const result = await createCapsuleFromWeb(
      'user-1',
      {
        name: 'Rainy commute',
        occasions: ['work'],
        garmentIds: ['g-1', 'g-2'],
        isFavorite: false,
      },
      'idempotency-key-1'
    )

    expect(result.id).toBe('cap-1')
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>)['idempotency-key']).toBe(
      'idempotency-key-1'
    )
    expect(JSON.parse(init.body as string)).toMatchObject({
      name: 'Rainy commute',
      garmentIds: ['g-1', 'g-2'],
    })
  })

  it('surfaces a create failure with the server message', async () => {
    authenticate()
    stubFetchOnce(
      jsonResponse({ message: 'garmentIds must not contain duplicates' }, 400)
    )

    await expect(
      createCapsuleFromWeb(
        'user-1',
        {
          name: 'Dupes',
          occasions: ['work'],
          garmentIds: ['g-1', 'g-1'],
          isFavorite: false,
        },
        'idempotency-key-1'
      )
    ).rejects.toThrow('garmentIds must not contain duplicates')
  })

  /** Every capsule mutation is revision-gated; losing If-Match means losing lost-update protection. */
  it('sends If-Match when updating a capsule', async () => {
    authenticate()
    const fetchMock = stubFetchOnce(
      jsonResponse({ data: { ...capsuleFixture, name: 'Renamed', revision: 4 } })
    )

    const result = await updateCapsuleFromWeb(
      'user-1',
      'cap-1',
      { name: 'Renamed' },
      '"capsule:cap-1:3"'
    )

    expect(result.name).toBe('Renamed')
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(init.method).toBe('PATCH')
    expect((init.headers as Record<string, string>)['if-match']).toBe('"capsule:cap-1:3"')
  })

  it('surfaces a stale-revision update conflict', async () => {
    authenticate()
    stubFetchOnce(jsonResponse({ message: 'CAPSULE_REVISION_MISMATCH' }, 412))

    await expect(
      updateCapsuleFromWeb('user-1', 'cap-1', { name: 'Renamed' }, '"capsule:cap-1:1"')
    ).rejects.toThrow('CAPSULE_REVISION_MISMATCH')
  })

  it('sends the favorite flag and If-Match when toggling a favorite', async () => {
    authenticate()
    const fetchMock = stubFetchOnce(
      jsonResponse({ data: { ...capsuleFixture, isFavorite: true, revision: 4 } })
    )

    const result = await favoriteCapsuleFromWeb(
      'user-1',
      'cap-1',
      true,
      '"capsule:cap-1:3"'
    )

    expect(result.isFavorite).toBe(true)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/api/v1/wardrobe/user-1/capsules/cap-1/favorite')
    expect(JSON.parse(init.body as string)).toEqual({ isFavorite: true })
    expect((init.headers as Record<string, string>)['if-match']).toBe('"capsule:cap-1:3"')
  })

  it('surfaces a favorite-toggle failure with the server message', async () => {
    authenticate()
    stubFetchOnce(jsonResponse({ message: 'Favorite limit reached' }, 409))

    await expect(
      favoriteCapsuleFromWeb('user-1', 'cap-1', true, '"capsule:cap-1:3"')
    ).rejects.toThrow('Favorite limit reached')
  })

  it('sends If-Match when deleting and resolves without a payload', async () => {
    authenticate()
    const fetchMock = stubFetchOnce(new Response(null, { status: 204 }))

    await expect(
      deleteCapsuleFromWeb('user-1', 'cap-1', '"capsule:cap-1:3"')
    ).resolves.toBeUndefined()

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(init.method).toBe('DELETE')
    expect((init.headers as Record<string, string>)['if-match']).toBe('"capsule:cap-1:3"')
  })

  it('surfaces a delete precondition failure', async () => {
    authenticate()
    stubFetchOnce(jsonResponse({ message: 'If-Match header required' }, 428))

    await expect(
      deleteCapsuleFromWeb('user-1', 'cap-1', '"capsule:cap-1:1"')
    ).rejects.toThrow('If-Match header required')
  })
})

describe('isStaleRevisionError', () => {
  it('recognizes both revision-mismatch sentinels', () => {
    expect(isStaleRevisionError(new Error('ONBOARDING_REVISION_MISMATCH'))).toBe(true)
    expect(isStaleRevisionError(new Error('SILHOUETTE_REVISION_MISMATCH'))).toBe(true)
  })

  /** Only a precondition failure earns the reload affordance; other errors must not. */
  it('rejects unrelated failures and non-error values', () => {
    expect(isStaleRevisionError(new Error('Network request failed'))).toBe(false)
    expect(isStaleRevisionError('ONBOARDING_REVISION_MISMATCH')).toBe(false)
    expect(isStaleRevisionError(null)).toBe(false)
  })
})

describe('generateIdempotencyKey', () => {
  it('returns a distinct key per call', () => {
    const first = generateIdempotencyKey()
    const second = generateIdempotencyKey()
    expect(first).toMatch(/^[0-9a-f-]{36}$/)
    expect(second).not.toBe(first)
  })

  /**
   * `crypto.randomUUID` needs a secure context. Without the guard an insecure
   * origin would throw a bare TypeError instead of telling the user what to do.
   */
  it('explains the problem when the browser cannot mint a key', () => {
    vi.stubGlobal('crypto', { subtle: globalThis.crypto.subtle })

    expect(() => generateIdempotencyKey()).toThrow(
      'Unable to start this upload in this browser. Try a different browser.'
    )
  })
})

describe('prepareGarmentImage guards', () => {
  async function upload() {
    return uploadGarmentImageFromWeb({
      imagePreview: 'data:image/png;base64,c2FtcGxl',
      uploadSession: currentUploadSession(),
      aspectRatio: '1:1',
      useBgCleanup: false,
    })
  }

  it('rejects an image that cannot be decoded', async () => {
    authenticate()
    installImagePrepMocks({ failsToDecode: true })

    await expect(upload()).rejects.toThrow('The selected image could not be decoded.')
  })

  /** Upscaling a thumbnail produces a garment card nobody can tag from. */
  it('rejects an image smaller than the 256px minimum', async () => {
    authenticate()
    installImagePrepMocks({ naturalWidth: 120, naturalHeight: 160 })

    await expect(upload()).rejects.toThrow(
      'Choose an image at least 256 pixels wide and tall.'
    )
  })

  it('rejects a browser that cannot provide a 2D canvas context', async () => {
    authenticate()
    installImagePrepMocks({ context: null })

    await expect(upload()).rejects.toThrow(
      'Image preparation is unavailable in this browser.'
    )
  })

  it('rejects when the canvas cannot encode the image at all', async () => {
    authenticate()
    installImagePrepMocks({ encoded: null })

    await expect(upload()).rejects.toThrow('The selected image could not be prepared.')
  })

  /** The upload contract only accepts jpeg/png/webp; catch it before allocating a session. */
  it('rejects an encoded format the upload contract does not accept', async () => {
    authenticate()
    installImagePrepMocks({
      encoded: new NodeBlob(['gif-bytes'], { type: 'image/gif' }) as unknown as Blob,
    })

    await expect(upload()).rejects.toThrow('The prepared image format is unsupported.')
  })

  it('rejects an encoded image above the 10 MiB limit', async () => {
    authenticate()
    const oversized = new NodeBlob(['png-bytes'], { type: 'image/png' })
    Object.defineProperty(oversized, 'size', { value: 10 * 1024 * 1024 + 1 })
    installImagePrepMocks({ encoded: oversized as unknown as Blob })

    await expect(upload()).rejects.toThrow('The prepared image exceeds the 10 MiB limit.')
  })
})

describe('uploadGarmentImageFromWeb transport sequence', () => {
  const allocation = {
    garmentId: 'garment-1',
    uploadSessionId: 'upload-session-1',
    uploadUrl:
      'https://project.supabase.test/storage/v1/object/upload/sign/wardrobe-images/users/user-1/garments/garment-1.jpg?token=signed-upload-token',
    uploadToken: 'upload-token-1',
    requiredHeaders: { 'content-type': 'image/png' },
    expiresAt: '2026-08-09T10:00:00.000Z',
  }

  function installTransportFetchMock(
    overrides: {
      allocationStatus?: number
      allocationBody?: unknown
      commitStatus?: number
      commitBody?: unknown
    } = {}
  ) {
    const fetchMock = vi.fn(
      (input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
        const url = requestUrl(input)
        if (url.includes('/wardrobe/upload-url')) {
          return Promise.resolve(
            jsonResponse(
              overrides.allocationBody ?? { data: allocation },
              overrides.allocationStatus ?? 201
            )
          )
        }
        if (url === allocation.uploadUrl) {
          return Promise.resolve(new Response(null, { status: 200 }))
        }
        if (url.includes('/wardrobe/garments')) {
          return Promise.resolve(
            jsonResponse(
              overrides.commitBody ?? { data: garmentFixture },
              overrides.commitStatus ?? 201
            )
          )
        }
        return Promise.reject(new Error(`Unhandled fetch in test: ${url}`))
      }
    )
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  // Learning path Step 58: Image uploads straight to storage.
  // See _bmad-output/project-knowledge/learning-path-step-by-step.md#image-uploads-straight-to-storage
  it('refuses a garment photo picked under another account before preparing or sending anything', async () => {
    authenticate()
    const { toBlob } = installImagePrepMocks()
    const fetchMock = installTransportFetchMock()
    setUploadAttemptAccount('member-a')
    const pickedUnderA = currentUploadSession()
    setUploadAttemptAccount('member-b')

    await expect(
      uploadGarmentImageFromWeb({
        imagePreview: 'data:image/png;base64,c2FtcGxl',
        uploadSession: pickedUnderA,
        aspectRatio: '1:1',
        useBgCleanup: false,
      })
    ).rejects.toBeInstanceOf(UploadSessionChangedError)

    expect(toBlob).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  /** The three legs must run in order; a commit before the bytes land orphans the garment. */
  it('allocates, uploads the bytes, then commits, reporting progress along the way', async () => {
    authenticate()
    installImagePrepMocks()
    const fetchMock = installTransportFetchMock()
    const states: string[] = []
    const progress: number[] = []

    const result = await uploadGarmentImageFromWeb({
      imagePreview: 'data:image/png;base64,c2FtcGxl',
      uploadSession: currentUploadSession(),
      aspectRatio: '1:1',
      useBgCleanup: false,
      onStateChange: (state) => states.push(state),
      onProgress: (value) => progress.push(value),
    })

    expect(result.id).toBe('garment-1')
    expect(states).toEqual([
      'preparing',
      'requesting_upload',
      'uploading',
      'verifying',
      'processing',
    ])
    expect(progress.at(-1)).toBe(100)

    const calledUrls = fetchMock.mock.calls.map(([input]) => requestUrl(input))
    const allocateIndex = calledUrls.findIndex((url) =>
      url.includes('/wardrobe/upload-url')
    )
    const putIndex = calledUrls.indexOf(allocation.uploadUrl)
    const commitIndex = calledUrls.findIndex(
      (url) => url.includes('/wardrobe/garments') && !url.includes('upload-url')
    )
    expect(allocateIndex).toBeLessThan(putIndex)
    expect(putIndex).toBeLessThan(commitIndex)
  })

  it('commits the allocated garment and upload session with the cleanup choice', async () => {
    authenticate()
    installImagePrepMocks()
    const fetchMock = installTransportFetchMock()

    await uploadGarmentImageFromWeb({
      imagePreview: 'data:image/png;base64,c2FtcGxl',
      uploadSession: currentUploadSession(),
      aspectRatio: '1:1',
      useBgCleanup: false,
    })

    const commitCall = fetchMock.mock.calls.find(
      ([input]) =>
        requestUrl(input).includes('/wardrobe/garments') &&
        !requestUrl(input).includes('upload-url')
    )
    expect(JSON.parse((commitCall?.[1] as RequestInit).body as string)).toEqual({
      garmentId: allocation.garmentId,
      uploadSessionId: allocation.uploadSessionId,
      hasCropping: true,
      hasBgCleanup: false,
    })
  })

  it('reports an allocation refusal with the server message', async () => {
    authenticate()
    installImagePrepMocks()
    installTransportFetchMock({
      allocationStatus: 429,
      allocationBody: { message: 'Daily upload limit reached' },
    })

    await expect(
      uploadGarmentImageFromWeb({
        imagePreview: 'data:image/png;base64,c2FtcGxl',
        uploadSession: currentUploadSession(),
        aspectRatio: '1:1',
        useBgCleanup: false,
      })
    ).rejects.toThrow('Daily upload limit reached')
  })

  function plainBackgroundImageData() {
    const width = 5
    const height = 5
    const data = new Uint8ClampedArray(width * height * 4).fill(255)
    // A dark ring represents a garment with a white detail enclosed in it.
    for (const index of [6, 7, 8, 11, 13, 16, 17, 18]) {
      data.set([10, 20, 30, 255], index * 4)
    }
    return { data, width, height }
  }

  it('removes the connected background and preserves the garment and its light detail', async () => {
    authenticate()
    const imageData = plainBackgroundImageData()
    const { width, height, data } = imageData
    const putImageData = vi.fn()
    const context = {
      canvas: { width, height },
      drawImage: vi.fn(),
      getImageData: vi.fn().mockReturnValue(imageData),
      putImageData,
    } as unknown as CanvasRenderingContext2D
    const { getContext } = installImagePrepMocks({ context })
    installTransportFetchMock()

    await uploadGarmentImageFromWeb({
      imagePreview: 'data:image/png;base64,c2FtcGxl',
      uploadSession: currentUploadSession(),
      aspectRatio: '1:1',
      useBgCleanup: true,
    })

    // Cleanup reads pixels back every frame, so the context must be told.
    expect(getContext).toHaveBeenCalledWith('2d', { willReadFrequently: true })
    expect(putImageData).toHaveBeenCalledWith(imageData, 0, 0)
    expect(data[3]).toBe(0)
    expect(Array.from(data.slice(6 * 4, 7 * 4))).toEqual([10, 20, 30, 255])
    expect(Array.from(data.slice(12 * 4, 13 * 4))).toEqual([255, 255, 255, 255])
  })

  /**
   * A landscape source has to be centre-cropped to the requested portrait
   * frame. Sending the uncropped dimensions would allocate a session the
   * committed bytes cannot satisfy.
   */
  it('centre-crops a landscape source to the requested aspect ratio', async () => {
    authenticate()
    installImagePrepMocks({ naturalWidth: 1600, naturalHeight: 900 })
    const fetchMock = installTransportFetchMock()

    await uploadGarmentImageFromWeb({
      imagePreview: 'data:image/png;base64,c2FtcGxl',
      uploadSession: currentUploadSession(),
      aspectRatio: '4:3',
      useBgCleanup: false,
    })

    const allocateCall = fetchMock.mock.calls.find(([input]) =>
      requestUrl(input).includes('/wardrobe/upload-url')
    )
    const body = JSON.parse((allocateCall?.[1] as RequestInit).body as string) as {
      widthPx: number
      heightPx: number
    }
    expect(body.widthPx).toBe(675)
    expect(body.heightPx).toBe(900)
  })

  /**
   * The bytes are already in storage by the time commit runs, so a commit
   * failure must be reported rather than swallowed into a stuck garment.
   */
  it('reports a commit refusal with the server message', async () => {
    authenticate()
    installImagePrepMocks()
    installTransportFetchMock({
      commitStatus: 409,
      commitBody: { message: 'Upload session already committed' },
    })

    await expect(
      uploadGarmentImageFromWeb({
        imagePreview: 'data:image/png;base64,c2FtcGxl',
        uploadSession: currentUploadSession(),
        aspectRatio: '1:1',
        useBgCleanup: false,
      })
    ).rejects.toThrow('Upload session already committed')
  })

  function declaredMimeType(fetchMock: ReturnType<typeof installTransportFetchMock>) {
    const allocateCall = fetchMock.mock.calls.find(([input]) =>
      requestUrl(input).includes('/wardrobe/upload-url')
    )
    return (
      JSON.parse((allocateCall?.[1] as RequestInit).body as string) as {
        mimeType: string
      }
    ).mimeType
  }

  function uploadedContentType(fetchMock: ReturnType<typeof installTransportFetchMock>) {
    const putCall = fetchMock.mock.calls.find(
      ([input]) => requestUrl(input) === allocation.uploadUrl
    )
    return ((putCall?.[1] as RequestInit).headers as Record<string, string>)[
      'Content-Type'
    ]
  }

  /**
   * Production follow-up 2026-11-19: a 12 MP phone photo prepared as PNG came to 5 MB or more.
   * Without cleanup nothing is transparent, so it is JPEG, painted on white first because
   * JPEG has no alpha.
   */
  it('encodes JPEG at 0.9 on a white ground when cleanup is off', async () => {
    authenticate()
    const fillRect = vi.fn()
    const drawImage = vi.fn()
    const context = { drawImage, fillRect } as unknown as CanvasRenderingContext2D
    const { toBlob } = installImagePrepMocks({ context })
    const fetchMock = installTransportFetchMock()

    await uploadGarmentImageFromWeb({
      imagePreview: 'data:image/jpeg;base64,c2FtcGxl',
      uploadSession: currentUploadSession(),
      aspectRatio: '1:1',
      useBgCleanup: false,
    })

    expect(toBlob).toHaveBeenCalledTimes(1)
    expect(toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/jpeg', 0.9)
    expect(context.fillStyle).toBe('#ffffff')
    expect(fillRect).toHaveBeenCalledWith(0, 0, 900, 900)
    expect(fillRect.mock.invocationCallOrder[0]).toBeLessThan(
      drawImage.mock.invocationCallOrder[0]!
    )
    expect(declaredMimeType(fetchMock)).toBe('image/jpeg')
    expect(uploadedContentType(fetchMock)).toBe('image/jpeg')
  })

  /** Cleanup cuts the garment out, and JPEG would lose the cut; WebP keeps the alpha. */
  it('encodes WebP at 0.9 with no white ground when cleanup is on', async () => {
    authenticate()
    const fillRect = vi.fn()
    const imageData = plainBackgroundImageData()
    const context = {
      canvas: { width: imageData.width, height: imageData.height },
      drawImage: vi.fn(),
      fillRect,
      getImageData: vi.fn().mockReturnValue(imageData),
      putImageData: vi.fn(),
    } as unknown as CanvasRenderingContext2D
    const { toBlob } = installImagePrepMocks({ context })
    const fetchMock = installTransportFetchMock()

    await uploadGarmentImageFromWeb({
      imagePreview: 'data:image/jpeg;base64,c2FtcGxl',
      uploadSession: currentUploadSession(),
      aspectRatio: '1:1',
      useBgCleanup: true,
    })

    expect(toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/webp', 0.9)
    expect(fillRect).not.toHaveBeenCalled()
    expect(declaredMimeType(fetchMock)).toBe('image/webp')
    expect(uploadedContentType(fetchMock)).toBe('image/webp')
  })

  it('keeps a light garment when the detected background reaches the center', async () => {
    authenticate()
    const width = 10
    const height = 10
    const pixels = new Uint8ClampedArray(width * height * 4).fill(255)
    // These off-center dark accents do not identify a separated garment.
    for (let row = 3; row < 8; row++) {
      pixels.set([20, 25, 30, 255, 20, 25, 30, 255], (row * width + 1) * 4)
    }
    const putImageData = vi.fn()
    const context = {
      canvas: { width, height },
      drawImage: vi.fn(),
      fillRect: vi.fn(),
      getImageData: vi.fn().mockReturnValue({ data: pixels, width, height }),
      putImageData,
    } as unknown as CanvasRenderingContext2D
    installImagePrepMocks({ context })
    const fetchMock = installTransportFetchMock()

    await uploadGarmentImageFromWeb({
      imagePreview: 'data:image/jpeg;base64,c2FtcGxl',
      uploadSession: currentUploadSession(),
      aspectRatio: '1:1',
      useBgCleanup: true,
    })

    expect(putImageData).not.toHaveBeenCalled()
    expect(pixels[(5 * width + 5) * 4 + 3]).toBe(255)
    expect(declaredMimeType(fetchMock)).toBe('image/jpeg')
  })

  /** A browser that cannot encode WebP hands back PNG, and the upload declares what it got. */
  it('declares PNG when the browser falls back from WebP', async () => {
    authenticate()
    const imageData = plainBackgroundImageData()
    const context = {
      canvas: { width: imageData.width, height: imageData.height },
      drawImage: vi.fn(),
      fillRect: vi.fn(),
      getImageData: vi.fn().mockReturnValue(imageData),
      putImageData: vi.fn(),
    } as unknown as CanvasRenderingContext2D
    const { toBlob } = installImagePrepMocks({
      context,
      encoded: new NodeBlob(['png-bytes'], { type: 'image/png' }) as unknown as Blob,
    })
    const fetchMock = installTransportFetchMock()

    await uploadGarmentImageFromWeb({
      imagePreview: 'data:image/jpeg;base64,c2FtcGxl',
      uploadSession: currentUploadSession(),
      aspectRatio: '1:1',
      useBgCleanup: true,
    })

    expect(toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/webp', 0.9)
    expect(declaredMimeType(fetchMock)).toBe('image/png')
    expect(uploadedContentType(fetchMock)).toBe('image/png')
  })

  /**
   * The bytes go straight to storage: a Vercel Function refuses a body over about 4.5 MB.
   * The signed URL is used exactly as the API gave it, never moved onto the API's base.
   */
  it('PUTs the bytes to the storage signed URL as given, never through /api/v1', async () => {
    authenticate()
    installImagePrepMocks()
    const fetchMock = installTransportFetchMock()

    await uploadGarmentImageFromWeb({
      imagePreview: 'data:image/jpeg;base64,c2FtcGxl',
      uploadSession: currentUploadSession(),
      aspectRatio: '1:1',
      useBgCleanup: false,
    })

    const puts = fetchMock.mock.calls.filter(([, init]) => init?.method === 'PUT')
    expect(puts.map(([input]) => requestUrl(input))).toEqual([allocation.uploadUrl])
  })
})

describe('onboarding and silhouette failure paths', () => {
  it('reports an onboarding read failure with the server message', async () => {
    authenticate()
    stubFetchOnce(jsonResponse({ message: 'Onboarding state unavailable' }, 503))

    await expect(getOnboardingStateFromWeb()).rejects.toThrow(
      'Onboarding state unavailable'
    )
  })

  it('reports a silhouette read failure with the server message', async () => {
    authenticate()
    stubFetchOnce(jsonResponse({ message: 'Silhouette profile unavailable' }, 503))

    await expect(getSilhouetteProfileFromWeb()).rejects.toThrow(
      'Silhouette profile unavailable'
    )
  })

  it('reports a slider save conflict so the caller can reload and retry', async () => {
    authenticate()
    stubFetchOnce(jsonResponse({ message: 'SILHOUETTE_REVISION_MISMATCH' }, 412))

    const error = await updateSilhouetteSlidersFromWeb(
      { heightSlider: 40, buildSlider: 60 },
      silhouetteETag('user-1', 0)
    ).catch((caught: unknown) => caught)

    expect(isStaleRevisionError(error)).toBe(true)
  })

  it('reports a My Form deletion failure with the server message', async () => {
    authenticate()
    stubFetchOnce(jsonResponse({ message: 'My Form photo is already removed' }, 409))

    await expect(deleteMyFormPhotoFromWeb(silhouetteETag('user-1', 2))).rejects.toThrow(
      'My Form photo is already removed'
    )
  })

  /**
   * Some error envelopes carry neither `error.message` nor `message`. The user
   * still needs something better than `undefined` on screen.
   */
  it('falls back to a status message when the error envelope carries no text', async () => {
    authenticate()
    stubFetchOnce(jsonResponse({ statusCode: 500 }, 500))

    await expect(getOnboardingStateFromWeb()).rejects.toThrow(
      'Wardrobe request failed with status 500'
    )
  })
})

describe('preparedImageEncoding', () => {
  it('chooses JPEG without cleanup and WebP with it, both at quality 0.9', () => {
    expect(preparedImageEncoding(false)).toEqual({ mimeType: 'image/jpeg', quality: 0.9 })
    expect(preparedImageEncoding(true)).toEqual({ mimeType: 'image/webp', quality: 0.9 })
  })
})

describe('prepareGarmentImage source encoding', () => {
  /**
   * Community posts keep the picked file's own format (review round 1, 2026-11-19): the
   * community pipeline re-encodes them itself, and flattening a transparent PNG to JPEG would
   * paint its background white.
   */
  it('keeps a PNG source as PNG at 0.92 with no white ground', async () => {
    const fillRect = vi.fn()
    const context = {
      drawImage: vi.fn(),
      fillRect,
    } as unknown as CanvasRenderingContext2D
    const { toBlob } = installImagePrepMocks({ context })
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(new Blob(['png'], { type: 'image/png' }), {
          headers: { 'Content-Type': 'image/png' },
        })
      )
    )
    vi.stubGlobal('fetch', fetchMock)

    const prepared = await prepareGarmentImage(
      'data:image/png;base64,c2FtcGxl',
      '4:3',
      false,
      'source'
    )

    expect(fetchMock).toHaveBeenCalledWith('data:image/png;base64,c2FtcGxl')
    expect(toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/png', 0.92)
    expect(fillRect).not.toHaveBeenCalled()
    expect(prepared.mimeType).toBe('image/png')
  })

  it('compact never reads the source back', async () => {
    const { toBlob } = installImagePrepMocks()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await prepareGarmentImage('data:image/png;base64,c2FtcGxl', '4:3', false, 'compact')

    expect(fetchMock).not.toHaveBeenCalled()
    expect(toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/jpeg', 0.9)
  })
})

describe('wardrobe uploads to storage', () => {
  /**
   * Review round 1, 2026-11-19: the removed server upload set `private, max-age=0` on the
   * object; the client PUT carries it now. A retry after a lost PUT answer finds the object
   * already there and must go on to commit, which verifies the sha256.
   */
  it('sends private cache-control and accepts an object a lost answer left', async () => {
    authenticate()
    installImagePrepMocks()
    const uploadUrl =
      'https://project.supabase.test/storage/v1/object/upload/sign/wardrobe-images/staging/session-1.jpg?token=t'
    let putHeaders: Record<string, string> = {}
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input)
      if (url.includes('/wardrobe/upload-url')) {
        return Promise.resolve(
          jsonResponse(
            {
              data: {
                garmentId: 'garment-1',
                uploadSessionId: 'session-1',
                uploadUrl,
                uploadToken: 't',
                requiredHeaders: { 'content-type': 'image/jpeg' },
                expiresAt: '2026-08-09T10:00:00.000Z',
              },
            },
            201
          )
        )
      }
      if (url === uploadUrl) {
        putHeaders = init?.headers as Record<string, string>
        return Promise.resolve(
          jsonResponse({ statusCode: '409', error: 'Duplicate', message: 'exists' }, 400)
        )
      }
      if (url.includes('/wardrobe/garments')) {
        return Promise.resolve(jsonResponse({ data: garmentFixture }, 201))
      }
      return Promise.reject(new Error(`Unhandled fetch in test: ${url}`))
    })
    vi.stubGlobal('fetch', fetchMock)

    const garment = await uploadGarmentImageFromWeb({
      imagePreview: 'data:image/jpeg;base64,c2FtcGxl',
      uploadSession: currentUploadSession(),
      aspectRatio: '1:1',
      useBgCleanup: false,
    })

    expect(garment.id).toBe(garmentFixture.id)
    expect(putHeaders['Cache-Control']).toBe('private, max-age=0')
  })
})
