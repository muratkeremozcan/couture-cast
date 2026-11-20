// Learning path Step 29: Garment capture flow.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-29-garment-capture-flow
// Learning path Step 32: Wardrobe onboarding and silhouette setup.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-32-wardrobe-onboarding-and-silhouette-setup
// Learning path Step 58: Image uploads straight to storage.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#image-uploads-straight-to-storage
import React from 'react'
import type * as ReactNativeModule from 'react-native'
import type * as EdgeToEdgeTestUtils from '@/src/test-utils/edge-to-edge-modal'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { forgetAllUploadAttempts } from '@/src/lib/upload-attempts'
import { AccessibilityInfo, findNodeHandle, Platform } from 'react-native'
import { http, HttpResponse } from 'msw'

import { server } from '@/src/test-utils/msw/server'
import {
  setMobileAccessTokenResolver,
  setMobileApplicationUserId,
} from '@/src/lib/mobile-auth'
import { MobileGarmentCaptureModal } from './garment-capture-modal'
import {
  EDGE_TO_EDGE_MODAL_PROPS,
  TEST_SAFE_AREA_INSETS,
  lastModalProps,
  paddingBottomOf,
  paddingTopOf,
  liveFontMarkerPlacement,
} from '@/src/test-utils/edge-to-edge-modal'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en-US' } }),
}))

const openSettingsMock = vi.hoisted(() => vi.fn())

vi.mock('react-native-safe-area-context', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  const { TEST_SAFE_AREA_INSETS } = await vi.importActual<typeof EdgeToEdgeTestUtils>(
    '@/src/test-utils/edge-to-edge-modal'
  )
  return { ...actual, useSafeAreaInsets: () => TEST_SAFE_AREA_INSETS }
})
vi.mock('react-native', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactNativeModule>()
  const { recordModalProps } = await vi.importActual<typeof EdgeToEdgeTestUtils>(
    '@/src/test-utils/edge-to-edge-modal'
  )
  return {
    ...actual,
    AccessibilityInfo: {
      ...actual.AccessibilityInfo,
      setAccessibilityFocus: vi.fn(),
    },
    Linking: {
      ...actual.Linking,
      openSettings: openSettingsMock,
    },
    findNodeHandle: vi.fn(),
    Modal: recordModalProps(
      ({ children, visible }: { children: React.ReactNode; visible: boolean }) =>
        visible ? children : null
    ),
  }
})

const cameraAsset = {
  uri: 'file:///camera-shot.png',
  width: 800,
  height: 800,
  fileSize: 1024,
}

const libraryAsset = {
  uri: 'file:///library-shot.png',
  width: 900,
  height: 900,
  fileSize: 2048,
}

const imagePicker = vi.hoisted(() => ({
  requestCameraPermissionsAsync: vi.fn(),
  requestMediaLibraryPermissionsAsync: vi.fn(),
  launchCameraAsync: vi.fn(),
  launchImageLibraryAsync: vi.fn(),
}))

vi.mock('expo-image-picker', () => imagePicker)

const imageManipulator = vi.hoisted(() => ({ manipulateAsync: vi.fn() }))

vi.mock('expo-image-manipulator', () => ({
  manipulateAsync: imageManipulator.manipulateAsync,
  SaveFormat: { PNG: 'png', JPEG: 'jpeg' },
}))

const fileSystem = vi.hoisted(() => {
  // Mutable so a test can hand back a file that busts the 10 MiB ceiling.
  const state = { bytes: new Uint8Array([1, 2, 3, 4]) }
  class MockFile {
    uri: string
    constructor(uri: string, name?: string) {
      this.uri = name ? `${uri}${name}` : uri
    }
    bytes() {
      return Promise.resolve(state.bytes)
    }
    static downloadFileAsync = vi.fn((sourceUri: string, target: MockFile) =>
      Promise.resolve(target)
    )
  }
  return { File: MockFile, Paths: { cache: 'file:///cache/' }, state }
})

vi.mock('expo-file-system', () => ({
  File: fileSystem.File,
  Paths: fileSystem.Paths,
}))

vi.mock('expo-crypto', () => ({
  digest: vi.fn().mockResolvedValue(new Uint8Array(32).buffer),
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  randomUUID: vi.fn(() => 'idem-key-1'),
}))

function renderModal(
  props: Partial<React.ComponentProps<typeof MobileGarmentCaptureModal>> = {}
) {
  const onClose = vi.fn()
  const onGarmentCommitted = vi.fn()
  render(
    <MobileGarmentCaptureModal
      visible
      onClose={onClose}
      onGarmentCommitted={onGarmentCommitted}
      {...props}
    />
  )
  return { onClose, onGarmentCommitted }
}

async function pickLibraryPhoto() {
  fireEvent.click(screen.getByTestId('garment-source-library'))
  await waitFor(() => screen.getByTestId('garment-crop-preview'))
}

async function pickLibraryPhotoAndConfirm() {
  await pickLibraryPhoto()
  fireEvent.click(screen.getByTestId('garment-confirm-image'))
}

describe('MobileGarmentCaptureModal', () => {
  let restoreAccessTokenResolver: () => void
  const originalBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL

  beforeEach(() => {
    process.env.EXPO_PUBLIC_API_BASE_URL = window.location.origin
    restoreAccessTokenResolver = setMobileAccessTokenResolver(() => 'test-access-token')
    fileSystem.state.bytes = new Uint8Array([1, 2, 3, 4])
    imageManipulator.manipulateAsync.mockResolvedValue({
      uri: 'file:///cropped.png',
      width: 512,
      height: 512,
    })
    imagePicker.requestCameraPermissionsAsync.mockResolvedValue({
      granted: true,
      canAskAgain: true,
    })
    imagePicker.requestMediaLibraryPermissionsAsync.mockResolvedValue({ granted: true })
    imagePicker.launchCameraAsync.mockResolvedValue({
      canceled: false,
      assets: [cameraAsset],
    })
    imagePicker.launchImageLibraryAsync.mockResolvedValue({
      canceled: false,
      assets: [libraryAsset],
    })
  })

  afterEach(() => {
    // Upload attempts live for the app session; each test starts signed out with none open.
    setMobileApplicationUserId(null)
    forgetAllUploadAttempts()
    if (originalBaseUrl === undefined) {
      delete process.env.EXPO_PUBLIC_API_BASE_URL
    } else {
      process.env.EXPO_PUBLIC_API_BASE_URL = originalBaseUrl
    }
    restoreAccessTokenResolver()
    Object.defineProperty(Platform, 'OS', { value: 'web', configurable: true })
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('4.4-MOB-CAP-01 renders the source step with camera and library actions', () => {
    renderModal()

    expect(screen.getByTestId('garment-capture-modal')).toBeInTheDocument()
    expect(screen.getByTestId('garment-source-camera')).toBeInTheDocument()
    expect(screen.getByTestId('garment-source-library')).toBeInTheDocument()
  })

  it('4.4-MOB-CAP-02 renders nothing when not visible', () => {
    renderModal({ visible: false })

    expect(screen.queryByTestId('garment-capture-modal')).not.toBeInTheDocument()
  })

  it('4.4-MOB-CAP-03 closes and resets through the close button', () => {
    const { onClose } = renderModal()

    fireEvent.click(screen.getByTestId('garment-capture-close'))

    expect(onClose).toHaveBeenCalledOnce()
  })

  it('4.4-MOB-CAP-04 moves to the crop step after picking a library photo', async () => {
    renderModal()

    await pickLibraryPhoto()

    expect(screen.getByTestId('garment-crop-preview')).toBeInTheDocument()
  })

  it('4.4-MOB-CAP-05 shows a blocked-permission error with a settings link', async () => {
    imagePicker.requestCameraPermissionsAsync.mockResolvedValue({
      granted: false,
      canAskAgain: false,
    })
    renderModal()

    fireEvent.click(screen.getByTestId('garment-source-camera'))

    await waitFor(() => {
      expect(screen.getByText('wardrobe.permission.camera_blocked')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('wardrobe.permission.open_settings'))
    expect(openSettingsMock).toHaveBeenCalledOnce()
  })

  it('4.4-MOB-CAP-06 toggles aspect ratio and background cleanup in the crop step', async () => {
    renderModal()
    await pickLibraryPhoto()

    const cleanupToggle = screen.getByRole('switch')
    expect(cleanupToggle).toBeChecked()

    fireEvent.click(cleanupToggle)
    expect(cleanupToggle).not.toBeChecked()

    fireEvent.click(screen.getByTestId('garment-aspect-portrait'))
    fireEvent.click(screen.getByTestId('garment-aspect-square'))
  })

  it('4.4-MOB-CAP-07 uploads the garment and reports the commit with the access token', async () => {
    const committedGarment = {
      id: 'garment-1',
      status: 'awaiting_tags',
      category: null,
      material: null,
      comfortRange: null,
      tagsConfirmedAt: null,
      fileSizeBytes: 1024,
      mimeType: 'image/png',
      retentionStatus: 'active',
      createdAt: '2026-08-09T00:00:00.000Z',
      committedAt: '2026-08-09T00:00:01.000Z',
      imageAccess: null,
    }
    const seen: {
      declaredMimeType?: string
      uploadedContentType?: string | null
      uploadedCacheControl?: string | null
    } = {}
    server.use(
      http.post('*/api/v1/wardrobe/upload-url', async ({ request }) => {
        seen.declaredMimeType = ((await request.json()) as { mimeType: string }).mimeType
        return HttpResponse.json({
          data: {
            garmentId: 'garment-1',
            uploadSessionId: 'session-1',
            uploadUrl: `${window.location.origin}/mock-storage/session-1`,
            uploadToken: 'upload-token-1',
            requiredHeaders: { 'content-type': 'image/jpeg' },
            expiresAt: '2026-08-09T01:00:00.000Z',
          },
        })
      }),
      http.put('*/mock-storage/session-1', ({ request }) => {
        seen.uploadedContentType = request.headers.get('content-type')
        seen.uploadedCacheControl = request.headers.get('cache-control')
        return new HttpResponse(null, { status: 204 })
      }),
      http.post('*/api/v1/wardrobe/garments', () =>
        HttpResponse.json({ data: committedGarment })
      )
    )

    const { onGarmentCommitted } = renderModal()
    await pickLibraryPhotoAndConfirm()

    await waitFor(() => {
      expect(screen.getByTestId('garment-capture-complete')).toBeInTheDocument()
    })
    expect(seen.declaredMimeType).toBe('image/jpeg')
    expect(seen.uploadedContentType).toBe('image/jpeg')
    // Review round 1, 2026-11-19: the object is a private photo; the PUT carries the policy
    // the removed server upload set.
    expect(seen.uploadedCacheControl).toBe('private, max-age=0')
    expect(onGarmentCommitted).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'garment-1' }),
      'test-access-token'
    )

    fireEvent.click(screen.getByTestId('garment-capture-done'))
  })

  it('4.4-MOB-CAP-08 shows an inline error and returns to crop on a commit failure', async () => {
    server.use(
      http.post('*/api/v1/wardrobe/upload-url', () =>
        HttpResponse.json({
          data: {
            garmentId: 'garment-1',
            uploadSessionId: 'session-1',
            uploadUrl: `${window.location.origin}/mock-storage/session-1`,
            uploadToken: 'upload-token-1',
            requiredHeaders: { 'content-type': 'image/png' },
            expiresAt: '2026-08-09T01:00:00.000Z',
          },
        })
      ),
      http.put('*/mock-storage/session-1', () => new HttpResponse(null, { status: 204 })),
      http.post('*/api/v1/wardrobe/garments', () =>
        HttpResponse.json({ message: 'Storage rejected the upload.' }, { status: 500 })
      )
    )

    renderModal()
    await pickLibraryPhotoAndConfirm()

    await waitFor(() => {
      expect(screen.getByText('Storage rejected the upload.')).toBeInTheDocument()
    })
    expect(screen.getByTestId('garment-crop-preview')).toBeInTheDocument()
  })

  /**
   * Production follow-up 2026-11-19 (review round 2, Codex 6): tapping upload again with the
   * same prepared image is the same attempt. It commits first with the attempt's key, so a
   * commit whose answer was lost replays instead of creating a second garment, and the bytes go
   * out again only when commit reports them missing.
   */
  it.each([
    {
      retryCommit: 'replays the lost commit',
      commitAnswers: [503, 200],
      expectedPuts: 1,
    },
    {
      retryCommit: 'reports the bytes missing',
      commitAnswers: [503, 409, 200],
      expectedPuts: 2,
    },
  ])(
    '4.4-MOB-CAP-08B keeps the attempt across a retry when commit $retryCommit',
    async ({ commitAnswers, expectedPuts }) => {
      const seen = { allocateKeys: [] as string[], puts: 0, commitKeys: [] as string[] }
      server.use(
        http.post('*/api/v1/wardrobe/upload-url', ({ request }) => {
          seen.allocateKeys.push(request.headers.get('idempotency-key') ?? '')
          return HttpResponse.json({
            data: {
              garmentId: 'garment-1',
              uploadSessionId: 'session-1',
              uploadUrl: `${window.location.origin}/mock-storage/session-1`,
              uploadToken: 'upload-token-1',
              requiredHeaders: { 'content-type': 'image/jpeg' },
              expiresAt: '2026-08-09T01:00:00.000Z',
            },
          })
        }),
        http.put('*/mock-storage/session-1', () => {
          seen.puts += 1
          return new HttpResponse(null, { status: 204 })
        }),
        http.post('*/api/v1/wardrobe/garments', ({ request }) => {
          seen.commitKeys.push(request.headers.get('idempotency-key') ?? '')
          const status = commitAnswers[seen.commitKeys.length - 1]
          if (status === 503) {
            return HttpResponse.json({ message: 'Service Unavailable' }, { status: 503 })
          }
          if (status === 409) {
            return HttpResponse.json(
              { statusCode: 409, message: 'UPLOAD_BYTES_MISSING', error: 'Conflict' },
              { status: 409 }
            )
          }
          return HttpResponse.json({
            data: {
              id: 'garment-1',
              status: 'processing',
              category: null,
              material: null,
              comfortRange: null,
              tagsConfirmedAt: null,
              fileSizeBytes: 4,
              mimeType: 'image/jpeg',
              retentionStatus: 'active',
              createdAt: '2026-08-09T00:00:00.000Z',
              committedAt: '2026-08-09T00:00:01.000Z',
              imageAccess: null,
            },
          })
        })
      )

      const { onGarmentCommitted } = renderModal()
      await pickLibraryPhotoAndConfirm()
      await waitFor(() => {
        expect(screen.getByText('Service Unavailable')).toBeInTheDocument()
      })
      fireEvent.click(screen.getByTestId('garment-confirm-image'))
      await waitFor(() => {
        expect(screen.getByTestId('garment-capture-complete')).toBeInTheDocument()
      })

      expect(seen.allocateKeys).toHaveLength(1)
      expect(seen.allocateKeys[0]).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
      )
      expect(seen.puts).toBe(expectedPuts)
      expect(seen.commitKeys).toHaveLength(commitAnswers.length)
      expect(new Set(seen.commitKeys).size).toBe(1)
      expect(seen.commitKeys[0]).not.toBe(seen.allocateKeys[0])
      expect(onGarmentCommitted).toHaveBeenCalledTimes(1)
    }
  )

  /**
   * Review round 4 (C3-9): an open attempt belongs to the member who opened it. An auth state
   * change to another member (no explicit sign-out) forgets it, so the next member's upload of
   * the same photo allocates its own garment and never commits the first member's session.
   */
  // Learning path Step 58: Image uploads straight to storage.
  // See _bmad-output/project-knowledge/learning-path-step-by-step.md#image-uploads-straight-to-storage
  it('4.4-MOB-CAP-08C drops the picked photo on an account change, and the same photo picked again starts a new garment', async () => {
    const seen = { allocateKeys: [] as string[], commitKeys: [] as string[] }
    server.use(
      http.post('*/api/v1/wardrobe/upload-url', ({ request }) => {
        seen.allocateKeys.push(request.headers.get('idempotency-key') ?? '')
        return HttpResponse.json({
          data: {
            garmentId: `garment-${seen.allocateKeys.length}`,
            uploadSessionId: `session-${seen.allocateKeys.length}`,
            uploadUrl: `${window.location.origin}/mock-storage/session`,
            uploadToken: 'upload-token-1',
            requiredHeaders: { 'content-type': 'image/jpeg' },
            expiresAt: '2026-08-09T01:00:00.000Z',
          },
        })
      }),
      http.put('*/mock-storage/session', () => new HttpResponse(null, { status: 204 })),
      http.post('*/api/v1/wardrobe/garments', async ({ request }) => {
        seen.commitKeys.push(request.headers.get('idempotency-key') ?? '')
        const body = (await request.json()) as { garmentId: string }
        if (seen.commitKeys.length === 1) {
          return HttpResponse.json({ message: 'Service Unavailable' }, { status: 503 })
        }
        return HttpResponse.json({
          data: {
            id: body.garmentId,
            status: 'processing',
            category: null,
            material: null,
            comfortRange: null,
            tagsConfirmedAt: null,
            fileSizeBytes: 4,
            mimeType: 'image/jpeg',
            retentionStatus: 'active',
            createdAt: '2026-08-09T00:00:00.000Z',
            committedAt: '2026-08-09T00:00:01.000Z',
            imageAccess: null,
          },
        })
      })
    )
    setMobileApplicationUserId('member-a')

    const { onGarmentCommitted } = renderModal()
    await pickLibraryPhotoAndConfirm()
    await waitFor(() => {
      expect(screen.getByText('Service Unavailable')).toBeInTheDocument()
    })
    // Round 5 account epoch: member A's photo, waiting on Retry, is dropped with the account.
    act(() => setMobileApplicationUserId('member-b'))
    expect(screen.queryByTestId('garment-crop-preview')).not.toBeInTheDocument()
    expect(screen.queryByTestId('garment-confirm-image')).not.toBeInTheDocument()
    expect(screen.getByTestId('garment-source-library')).toBeInTheDocument()
    expect(seen.allocateKeys).toHaveLength(1)

    // Member B picks the same photo: a new attempt with fresh keys, never A's open one.
    await pickLibraryPhotoAndConfirm()
    await waitFor(() => {
      expect(screen.getByTestId('garment-capture-complete')).toBeInTheDocument()
    })

    expect(seen.allocateKeys).toHaveLength(2)
    expect(seen.allocateKeys[1]).not.toBe(seen.allocateKeys[0])
    expect(seen.commitKeys).toHaveLength(2)
    expect(seen.commitKeys[1]).not.toBe(seen.commitKeys[0])
    expect(onGarmentCommitted).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'garment-2' }),
      'test-access-token'
    )
  })

  /** Counts allocation requests; none of the account-epoch cases below may reach the API. */
  function countAllocations() {
    const seen = { allocations: 0 }
    server.use(
      http.post('*/api/v1/wardrobe/upload-url', () => {
        seen.allocations += 1
        return HttpResponse.json({ message: 'Service Unavailable' }, { status: 503 })
      })
    )
    return seen
  }

  // Learning path Step 58: Image uploads straight to storage.
  // See _bmad-output/project-knowledge/learning-path-step-by-step.md#image-uploads-straight-to-storage
  it('4.4-MOB-CAP-24 drops a photo the picker returns after the account changed', async () => {
    const seen = countAllocations()
    let returnPick: (result: unknown) => void = () => undefined
    imagePicker.launchImageLibraryAsync.mockReturnValueOnce(
      new Promise((resolve) => {
        returnPick = resolve
      })
    )
    setMobileApplicationUserId('member-a')
    renderModal()

    fireEvent.click(screen.getByTestId('garment-source-library'))
    await waitFor(() => expect(imagePicker.launchImageLibraryAsync).toHaveBeenCalled())
    act(() => setMobileApplicationUserId('member-b'))
    await act(async () => {
      returnPick({ canceled: false, assets: [libraryAsset] })
      // The picker callback resumes on microtasks only, so one macrotask turn lets it finish.
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(screen.queryByTestId('garment-crop-preview')).not.toBeInTheDocument()
    expect(screen.getByTestId('garment-source-library')).toBeInTheDocument()
    expect(seen.allocations).toBe(0)
  })

  it('4.4-MOB-CAP-23 refuses the upload when resolving the bearer finds another account signed in', async () => {
    const seen = countAllocations()
    setMobileApplicationUserId('member-a')
    const { onGarmentCommitted } = renderModal()
    await pickLibraryPhoto()
    // Resolving the token is where the app notices the stored session now belongs to member B.
    const restoreSwitchingResolver = setMobileAccessTokenResolver(() => {
      setMobileApplicationUserId('member-b')
      return 'member-b-access-token'
    })

    fireEvent.click(screen.getByTestId('garment-confirm-image'))
    await waitFor(() => {
      expect(screen.getByTestId('garment-source-library')).toBeInTheDocument()
    })
    restoreSwitchingResolver()

    expect(screen.queryByTestId('garment-crop-preview')).not.toBeInTheDocument()
    expect(seen.allocations).toBe(0)
    expect(onGarmentCommitted).not.toHaveBeenCalled()
  })

  /**
   * Retry routes for the same prepared photo: each leg answers from its own queue and records
   * the idempotency key it was sent.
   */
  function garmentRetryRoutes(commitAnswers: (() => Response)[]) {
    const seen = { allocateKeys: [] as string[], puts: 0, commitKeys: [] as string[] }
    server.use(
      http.post('*/api/v1/wardrobe/upload-url', ({ request }) => {
        seen.allocateKeys.push(request.headers.get('idempotency-key') ?? '')
        return HttpResponse.json({
          data: {
            garmentId: 'garment-1',
            uploadSessionId: `session-${seen.allocateKeys.length}`,
            uploadUrl: `${window.location.origin}/mock-storage/garment-retry`,
            uploadToken: 'upload-token-1',
            requiredHeaders: { 'content-type': 'image/jpeg' },
            expiresAt: '2026-08-09T01:00:00.000Z',
          },
        })
      }),
      http.put('*/mock-storage/garment-retry', () => {
        seen.puts += 1
        return new HttpResponse(null, { status: 204 })
      }),
      http.post('*/api/v1/wardrobe/garments', ({ request }) => {
        seen.commitKeys.push(request.headers.get('idempotency-key') ?? '')
        const answer = commitAnswers.shift()
        if (!answer) throw new Error('No commit answer left')
        return answer()
      })
    )
    return seen
  }

  const committedGarmentAnswer = () =>
    HttpResponse.json({
      data: {
        id: 'garment-1',
        status: 'processing',
        category: null,
        material: null,
        comfortRange: null,
        tagsConfirmedAt: null,
        fileSizeBytes: 4,
        mimeType: 'image/jpeg',
        retentionStatus: 'active',
        createdAt: '2026-08-09T00:00:00.000Z',
        committedAt: '2026-08-09T00:00:01.000Z',
        imageAccess: null,
      },
    })

  const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

  /**
   * Production follow-up 2026-11-19: when the commit a retry resumed answers that the server
   * ended the attempt (its session expired), that same tap starts one fresh attempt: a new
   * allocation and keys, the bytes again, and a commit. The member never taps a second time.
   */
  it('4.4-MOB-CAP-08D starts one fresh attempt in the same retry tap once the session expired', async () => {
    const seen = garmentRetryRoutes([
      () => HttpResponse.json({ message: 'Service Unavailable' }, { status: 503 }),
      () =>
        HttpResponse.json(
          { statusCode: 409, message: 'UPLOAD_SESSION_EXPIRED', error: 'Conflict' },
          { status: 409 }
        ),
      committedGarmentAnswer,
    ])

    const { onGarmentCommitted } = renderModal()
    await pickLibraryPhotoAndConfirm()
    await waitFor(() => {
      expect(screen.getByText('Service Unavailable')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByTestId('garment-confirm-image'))
    await waitFor(() => {
      expect(screen.getByTestId('garment-capture-complete')).toBeInTheDocument()
    })

    expect(screen.queryByText('UPLOAD_SESSION_EXPIRED')).not.toBeInTheDocument()
    expect(onGarmentCommitted).toHaveBeenCalledTimes(1)
    expect(seen.allocateKeys).toHaveLength(2)
    expect(seen.allocateKeys[1]).toMatch(UUID_V4)
    expect(seen.allocateKeys[1]).not.toBe(seen.allocateKeys[0])
    expect(seen.puts).toBe(2)
    expect(seen.commitKeys).toHaveLength(3)
    expect(seen.commitKeys[0]).toMatch(UUID_V4)
    expect(seen.commitKeys[1]).toBe(seen.commitKeys[0])
    expect(seen.commitKeys[2]).toMatch(UUID_V4)
    expect(seen.commitKeys[2]).not.toBe(seen.commitKeys[0])
  })

  it('4.4-MOB-CAP-08E keeps the attempt on the next tap after UPLOAD_IN_PROGRESS', async () => {
    const seen = garmentRetryRoutes([
      () =>
        HttpResponse.json(
          { statusCode: 409, message: 'UPLOAD_IN_PROGRESS', error: 'Conflict' },
          { status: 409 }
        ),
      committedGarmentAnswer,
    ])

    const { onGarmentCommitted } = renderModal()
    await pickLibraryPhotoAndConfirm()
    await waitFor(() => {
      expect(
        screen.getByText('This photo is still being saved. Try again in a moment.')
      ).toBeInTheDocument()
    })
    fireEvent.click(screen.getByTestId('garment-confirm-image'))
    await waitFor(() => {
      expect(screen.getByTestId('garment-capture-complete')).toBeInTheDocument()
    })

    expect(onGarmentCommitted).toHaveBeenCalledTimes(1)
    expect(seen.allocateKeys).toHaveLength(1)
    expect(seen.puts).toBe(1)
    expect(seen.commitKeys).toHaveLength(2)
    expect(seen.commitKeys[0]).toMatch(UUID_V4)
    expect(seen.commitKeys[1]).toBe(seen.commitKeys[0])
  })

  it('4.4-MOB-CAP-10 rejects a photo below the minimum resolution', async () => {
    imagePicker.launchImageLibraryAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///tiny.png', width: 120, height: 200, fileSize: 512 }],
    })
    renderModal()

    fireEvent.click(screen.getByTestId('garment-source-library'))

    await waitFor(() => {
      expect(screen.getByText('wardrobe.error.invalid_image')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('garment-crop-preview')).not.toBeInTheDocument()
  })

  /** Rejected client-side so a doomed 10 MiB upload never leaves the device. */
  it('4.4-MOB-CAP-11 rejects a photo over the 10 MiB ceiling before uploading', async () => {
    imagePicker.launchImageLibraryAsync.mockResolvedValue({
      canceled: false,
      assets: [
        {
          uri: 'file:///huge.png',
          width: 4000,
          height: 4000,
          fileSize: 11 * 1024 * 1024,
        },
      ],
    })
    renderModal()

    fireEvent.click(screen.getByTestId('garment-source-library'))

    await waitFor(() => {
      expect(screen.getByText('wardrobe.error.image_too_large')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('garment-crop-preview')).not.toBeInTheDocument()
  })

  /** A re-askable denial gets the plain message, with no Settings deep link. */
  it('4.4-MOB-CAP-12 shows the re-askable camera denial without a settings link', async () => {
    imagePicker.requestCameraPermissionsAsync.mockResolvedValue({
      granted: false,
      canAskAgain: true,
    })
    renderModal()

    fireEvent.click(screen.getByTestId('garment-source-camera'))

    await waitFor(() => {
      expect(screen.getByText('wardrobe.permission.camera_denied')).toBeInTheDocument()
    })
    expect(
      screen.queryByText('wardrobe.permission.open_settings')
    ).not.toBeInTheDocument()
  })

  it('4.4-MOB-CAP-13 moves to the crop step after taking a photo with the camera', async () => {
    renderModal()

    fireEvent.click(screen.getByTestId('garment-source-camera'))

    await waitFor(() => {
      expect(screen.getByTestId('garment-crop-preview')).toBeInTheDocument()
    })
  })

  it('4.4-MOB-CAP-14 stays on the source step when the camera is cancelled', async () => {
    imagePicker.launchCameraAsync.mockResolvedValue({ canceled: true, assets: null })
    renderModal()

    fireEvent.click(screen.getByTestId('garment-source-camera'))

    await waitFor(() => expect(imagePicker.launchCameraAsync).toHaveBeenCalled())
    expect(screen.getByTestId('garment-source-camera')).toBeInTheDocument()
    expect(screen.queryByTestId('garment-crop-preview')).not.toBeInTheDocument()
  })

  it('4.4-MOB-CAP-15 reports a denied photo-library permission', async () => {
    imagePicker.requestMediaLibraryPermissionsAsync.mockResolvedValue({ granted: false })
    renderModal()

    fireEvent.click(screen.getByTestId('garment-source-library'))

    await waitFor(() => {
      expect(screen.getByText('wardrobe.permission.library_denied')).toBeInTheDocument()
    })
    expect(imagePicker.launchImageLibraryAsync).not.toHaveBeenCalled()
  })

  it('4.4-MOB-CAP-16 stays on the source step when the photo library is cancelled', async () => {
    imagePicker.launchImageLibraryAsync.mockResolvedValue({
      canceled: true,
      assets: null,
    })
    renderModal()

    fireEvent.click(screen.getByTestId('garment-source-library'))

    await waitFor(() => expect(imagePicker.launchImageLibraryAsync).toHaveBeenCalled())
    expect(screen.getByTestId('garment-source-library')).toBeInTheDocument()
  })

  /**
   * A landscape photo cropped to 4:3 has to be centred on the source, not
   * anchored top-left: an off-centre crop silently beheads the garment.
   */
  it('4.4-MOB-CAP-17 centres a portrait crop taken from a landscape source', async () => {
    imagePicker.launchImageLibraryAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///wide.png', width: 1600, height: 900, fileSize: 4096 }],
    })
    server.use(
      http.post('*/api/v1/wardrobe/upload-url', () =>
        HttpResponse.json({ message: 'stop here' }, { status: 500 })
      )
    )
    renderModal()
    await pickLibraryPhoto()

    fireEvent.click(screen.getByTestId('garment-aspect-portrait'))
    fireEvent.click(screen.getByTestId('garment-confirm-image'))

    await waitFor(() => {
      expect(imageManipulator.manipulateAsync).toHaveBeenCalledWith(
        'file:///wide.png',
        [
          { crop: { originX: 463, originY: 0, width: 675, height: 900 } },
          { resize: { width: 675, height: 900 } },
        ],
        // JPEG: a 12 MP photo saved as PNG came to 5 MB or more (production follow-up
        // 2026-11-19).
        { compress: 0.9, format: 'jpeg' }
      )
    })
  })

  /** A 500 with no JSON message must still say something actionable. */
  it('4.4-MOB-CAP-18 falls back to a status-based message when the error body has none', async () => {
    server.use(
      http.post(
        '*/api/v1/wardrobe/upload-url',
        () => new HttpResponse(null, { status: 503 })
      )
    )
    renderModal()
    await pickLibraryPhotoAndConfirm()

    await waitFor(() => {
      expect(screen.getByText('Wardrobe request failed with 503')).toBeInTheDocument()
    })
  })

  it('4.4-MOB-CAP-19 refuses to upload without a session token', async () => {
    restoreAccessTokenResolver()
    restoreAccessTokenResolver = setMobileAccessTokenResolver(() => undefined)
    renderModal()
    await pickLibraryPhotoAndConfirm()

    await waitFor(() => {
      expect(screen.getByText('AUTHENTICATION_REQUIRED')).toBeInTheDocument()
    })
  })

  /** The re-encoded PNG can exceed the ceiling even when the source did not. */
  it('4.4-MOB-CAP-20 rejects re-encoded bytes that exceed the 10 MiB ceiling', async () => {
    fileSystem.state.bytes = new Uint8Array(10 * 1024 * 1024 + 1)
    renderModal()
    await pickLibraryPhotoAndConfirm()

    await waitFor(() => {
      expect(screen.getByText('wardrobe.error.image_too_large')).toBeInTheDocument()
    })
    expect(screen.getByTestId('garment-crop-preview')).toBeInTheDocument()
  })

  /** Cancelling is a user decision, not a failure: no error box may appear. */
  it('4.4-MOB-CAP-21 returns to crop without an error when the upload is cancelled', async () => {
    server.use(
      http.post('*/api/v1/wardrobe/upload-url', () => new Promise<never>(() => undefined))
    )
    renderModal()
    await pickLibraryPhotoAndConfirm()
    await waitFor(() => screen.getByTestId('garment-upload-progress'))

    fireEvent.click(screen.getByTestId('garment-upload-cancel'))

    await waitFor(() => {
      expect(screen.getByTestId('garment-crop-preview')).toBeInTheDocument()
    })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('4.4-MOB-CAP-22 skips native accessibility focus when the title has no handle', () => {
    Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true })
    vi.useFakeTimers()
    vi.mocked(findNodeHandle).mockReturnValue(null)

    renderModal()
    act(() => {
      vi.advanceTimersByTime(200)
    })

    expect(AccessibilityInfo.setAccessibilityFocus).not.toHaveBeenCalled()
  })

  it('4.4-MOB-CAP-09 focuses the modal title natively and restores the invoking control on close', () => {
    Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true })
    vi.useFakeTimers()
    vi.mocked(findNodeHandle).mockReturnValue(7)

    const { rerender } = render(
      <MobileGarmentCaptureModal visible onClose={vi.fn()} invokingNodeHandle={99} />
    )

    act(() => {
      vi.advanceTimersByTime(200)
    })
    expect(AccessibilityInfo.setAccessibilityFocus).toHaveBeenCalledWith(7)

    rerender(
      <MobileGarmentCaptureModal
        visible={false}
        onClose={vi.fn()}
        invokingNodeHandle={99}
      />
    )
    expect(AccessibilityInfo.setAccessibilityFocus).toHaveBeenCalledWith(99)
  })
})

describe('R52 MobileGarmentCaptureModal over the system bars', () => {
  // Story 6.15 review P3-1: iOS hides every view outside the accessibility modal view from the
  // XCUITest hierarchy, so the modal's live-font marker must sit inside it.
  it('puts the live-font marker inside the page that is the accessibility modal', () => {
    renderModal()
    expect(liveFontMarkerPlacement().markerInside).toBe(true)
  })

  it('covers the status and navigation bars as an opaque page clear of both', () => {
    renderModal()
    expect(lastModalProps()).toMatchObject({
      ...EDGE_TO_EDGE_MODAL_PROPS,
      transparent: false,
      visible: true,
    })
    const page = screen.getByTestId('garment-capture-modal')
    expect(paddingTopOf(page)).toBe(64)
    expect(paddingBottomOf(page)).toBe(20 + TEST_SAFE_AREA_INSETS.bottom)
  })
})
