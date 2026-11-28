// Learning path Step 29: Garment capture flow.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-29-garment-capture-flow
// Learning path Step 32: Wardrobe onboarding and silhouette setup.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-32-wardrobe-onboarding-and-silhouette-setup
// Learning path Step 58: Image uploads straight to storage.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#image-uploads-straight-to-storage
// Learning path Step 68: Five-tab navigation and back pattern.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-68-five-tab-navigation-and-back-pattern
// Learning path Step 83: Clean garment cutouts.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-83-clean-garment-cutouts
// Learning path Step 85: Add several photos at once.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-85-add-several-photos-at-once
// Learning path Step 86: Several garments from one flat-lay photo.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-86-several-garments-from-one-flat-lay-photo
// Story CC-7.11 test owner (TEA): 7.11-NAT-032, 7.11-NAT-033, the capture header is the layer's
// swipe handle beside its X. [Codex 7.11 #3]: the swipe takes the X's guarded close, so a
// picked photo asks "Discard this photo?" first; an upload in flight keeps the sheet open (busy guard).
// Test design: _bmad-output/test-artifacts/test-design-7-11-five-tab-navigation-back-pattern.md.
import React from 'react'
import { userEvent as browserUser } from 'vitest/browser'
import type * as ReactNativeModule from 'react-native'
import type { ImagePickerResult } from 'expo-image-picker'
import type * as EdgeToEdgeTestUtils from '@/src/test-utils/edge-to-edge-modal'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { forgetAllUploadAttempts } from '@/src/lib/upload-attempts'
import { AccessibilityInfo, Alert, findNodeHandle, Platform } from 'react-native'
import { getGuestPreviewStrings } from '@couture/utils'
import { Buffer } from 'buffer'
import { http, HttpResponse } from 'msw'
import { PNG } from 'pngjs/browser'
import {
  createGarmentItemInputSchema,
  createGarmentUploadUrlInputSchema,
  FLAT_LAY_MAX_PHOTO_BYTES,
  flatLayConfirmInputSchema,
  type FlatLaySelection,
  type CreateGarmentItemInput,
  type CreateGarmentUploadUrlInput,
} from '@couture/api-client/contracts/http'

import { server } from '@/src/test-utils/msw/server'
import {
  setMobileAccessTokenResolver,
  setMobileApplicationUserId,
} from '@/src/lib/mobile-auth'
import { MobileGarmentCaptureModal } from './garment-capture-modal'
import { LAYER_SWIPE_CLOSE_PX } from '@/components/edge-to-edge-modal'
import { dragFrom } from '@/src/test-utils/layer-swipe'
import {
  EDGE_TO_EDGE_MODAL_PROPS,
  TEST_SAFE_AREA_INSETS,
  lastModalProps,
  paddingBottomOf,
  paddingTopOf,
  liveFontMarkerPlacement,
} from '@/src/test-utils/edge-to-edge-modal'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const labels: Record<string, string> = {
        'wardrobe.tagging.options.category.outerwear': 'Outerwear',
        'wardrobe.tagging.options.material.wool': 'Wool',
        'wardrobe.tagging.options.comfort.cold': 'Cold',
        'wardrobe.detail.done': 'Done',
        'wardrobe.detail.cancel': 'Cancel',
      }
      return labels[key] ?? key
    },
    i18n: { language: 'en-US' },
  }),
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
    // react-native-web's Alert draws nothing; the recorded call is the discard prompt.
    Alert: { ...actual.Alert, alert: vi.fn() },
    // The Expo file mock owns these URIs. Record which file the native view receives.
    Image: ({ source, testID }: { source: { uri: string }; testID: string }) => (
      <div data-testid={testID} data-source-uri={source.uri} />
    ),
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
  const files = new Map<string, Uint8Array>()
  class MockFile {
    uri: string
    constructor(uri: string, name?: string) {
      this.uri = name ? `${uri}${name}` : uri
    }
    bytes() {
      return Promise.resolve(files.get(this.uri) ?? state.bytes)
    }
    get exists() {
      return files.has(this.uri)
    }
    write(bytes: Uint8Array) {
      files.set(this.uri, Uint8Array.from(bytes))
    }
    delete() {
      files.delete(this.uri)
    }
    static downloadFileAsync = vi.fn((sourceUri: string, target: MockFile) =>
      Promise.resolve(target)
    )
  }
  return { File: MockFile, Paths: { cache: 'file:///cache/' }, files, state }
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
  await screen.findByTestId('garment-crop-preview')
}

async function pickLibraryPhotoAndConfirm() {
  await pickLibraryPhoto()
  await browserUser.click(screen.getByTestId('garment-confirm-image'))
}

function captureSuccessfulGarmentUpload() {
  const seen: {
    allocation?: CreateGarmentUploadUrlInput
    uploadedContentType?: string | null
    uploadedCacheControl?: string | null
    bytes?: Uint8Array
    commit?: CreateGarmentItemInput
  } = {}
  server.use(
    http.post('*/api/v1/wardrobe/upload-url', async ({ request }) => {
      seen.allocation = createGarmentUploadUrlInputSchema.parse(await request.json())
      return HttpResponse.json({
        data: {
          garmentId: 'garment-1',
          uploadSessionId: 'session-1',
          uploadUrl: `${window.location.origin}/mock-storage/session-1`,
          uploadToken: 'upload-token-1',
          requiredHeaders: { 'content-type': seen.allocation.mimeType },
          expiresAt: '2026-08-09T01:00:00.000Z',
        },
      })
    }),
    http.put('*/mock-storage/session-1', async ({ request }) => {
      seen.uploadedContentType = request.headers.get('content-type')
      seen.uploadedCacheControl = request.headers.get('cache-control')
      seen.bytes = new Uint8Array(await request.arrayBuffer())
      return new HttpResponse(null, { status: 204 })
    }),
    http.post('*/api/v1/wardrobe/garments', async ({ request }) => {
      seen.commit = createGarmentItemInputSchema.parse(await request.json())
      return HttpResponse.json({
        data: {
          id: 'garment-1',
          status: 'awaiting_tags',
          category: null,
          material: null,
          comfortRange: null,
          tagsConfirmedAt: null,
          fileSizeBytes: seen.allocation?.fileSizeBytes,
          mimeType: seen.allocation?.mimeType,
          retentionStatus: 'active',
          createdAt: '2026-08-09T00:00:00.000Z',
          committedAt: '2026-08-09T00:00:01.000Z',
          imageAccess: null,
        },
      })
    })
  )
  return seen
}

describe('MobileGarmentCaptureModal', () => {
  let restoreAccessTokenResolver: () => void
  const originalBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL

  beforeEach(() => {
    process.env.EXPO_PUBLIC_API_BASE_URL = window.location.origin
    restoreAccessTokenResolver = setMobileAccessTokenResolver(() => 'test-access-token')
    fileSystem.state.bytes = new Uint8Array([1, 2, 3, 4])
    fileSystem.files.clear()
    imageManipulator.manipulateAsync
      .mockReset()
      .mockImplementation(
        (
          _uri: string,
          [, { resize }]: [unknown, { resize: { width: number; height: number } }],
          { format }: { format: string }
        ) =>
          Promise.resolve({
            uri: `file:///crop-${resize.width}x${resize.height}.${format}`,
            ...resize,
          })
      )
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
    vi.restoreAllMocks()
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

  it('[7.28-NAT-001] reviews scoped picker results and retries only the failed row', async () => {
    const pickerCopy = { ...libraryAsset, uri: 'file:///cache/ImagePicker/coat.png' }
    const original = { ...libraryAsset, uri: 'file:///library/boots.png', width: 800 }
    const bytes = new Uint8Array([1, 2, 3, 4])
    fileSystem.files.set(pickerCopy.uri, bytes)
    fileSystem.files.set(original.uri, bytes)
    imagePicker.launchImageLibraryAsync.mockResolvedValueOnce({
      canceled: false,
      assets: [pickerCopy, original],
    })
    imageManipulator.manipulateAsync.mockImplementation(
      (
        _uri: string,
        [, { resize }]: [unknown, { resize: { width: number; height: number } }],
        { format }: { format: string }
      ) => {
        const uri = `file:///cache/batch-crop-${resize.width}.${format}`
        fileSystem.files.set(uri, bytes)
        return Promise.resolve({ uri, ...resize })
      }
    )

    const allocations: string[] = []
    const puts: string[] = []
    const commits: { garmentId: string; key: string | null }[] = []
    server.use(
      http.post('*/api/v1/wardrobe/upload-url', ({ request }) => {
        allocations.push(request.headers.get('idempotency-key') ?? '')
        const position = allocations.length
        return HttpResponse.json({
          data: {
            garmentId: `garment-${position}`,
            uploadSessionId: `session-${position}`,
            uploadUrl: `${window.location.origin}/mock-storage/batch-${position}`,
            uploadToken: `upload-token-${position}`,
            requiredHeaders: { 'content-type': 'image/jpeg' },
            expiresAt: '2026-08-09T01:00:00.000Z',
          },
        })
      }),
      http.put('*/mock-storage/:name', ({ params }) => {
        puts.push(String(params.name))
        return new HttpResponse(null, { status: 204 })
      }),
      http.post('*/api/v1/wardrobe/garments', async ({ request }) => {
        const { garmentId } = createGarmentItemInputSchema.parse(await request.json())
        commits.push({ garmentId, key: request.headers.get('idempotency-key') })
        if (commits.length === 2) return HttpResponse.error()
        return HttpResponse.json({
          data: {
            id: garmentId,
            status: 'processing',
            category: null,
            material: null,
            comfortRange: null,
            tagsConfirmedAt: null,
            fileSizeBytes: bytes.byteLength,
            mimeType: 'image/jpeg',
            retentionStatus: 'active',
            createdAt: '2026-08-09T00:00:00.000Z',
            committedAt: '2026-08-09T00:00:01.000Z',
            imageAccess: null,
          },
        })
      })
    )
    const onBatchGarmentCommitted = vi.fn()
    const { onClose, onGarmentCommitted } = renderModal({ onBatchGarmentCommitted })
    await browserUser.click(screen.getByTestId('garment-batch-picker'))
    await screen.findByTestId('garment-batch-keep-2')

    expect(imagePicker.launchImageLibraryAsync).toHaveBeenCalledExactlyOnceWith({
      mediaTypes: ['images'],
      quality: 1,
      allowsMultipleSelection: true,
      selectionLimit: 5,
    })
    expect(imagePicker.requestMediaLibraryPermissionsAsync).not.toHaveBeenCalled()
    expect(imageManipulator.manipulateAsync).toHaveBeenCalledTimes(2)
    expect(imageManipulator.manipulateAsync).toHaveBeenNthCalledWith(
      1,
      pickerCopy.uri,
      expect.any(Array),
      expect.objectContaining({ format: 'jpeg' })
    )
    expect(imageManipulator.manipulateAsync).toHaveBeenNthCalledWith(
      2,
      original.uri,
      expect.any(Array),
      expect.objectContaining({ format: 'jpeg' })
    )
    expect(allocations).toHaveLength(0)
    expect(fileSystem.files.has(pickerCopy.uri)).toBe(false)
    expect(fileSystem.files.has(original.uri)).toBe(true)
    expect(screen.getByTestId('garment-batch-add')).toHaveAttribute(
      'aria-disabled',
      'true'
    )

    await browserUser.click(screen.getByTestId('garment-batch-keep-1'))
    expect(screen.getByTestId('garment-batch-add')).toHaveTextContent('Add 1 piece')
    await browserUser.click(screen.getByTestId('garment-batch-keep-2'))
    await browserUser.click(screen.getByRole('button', { name: 'Add 2 pieces' }))
    const retry = await screen.findByTestId('garment-batch-retry-2')
    const firstRow = within(screen.getByTestId('garment-batch-row-1'))
    const secondRow = within(screen.getByTestId('garment-batch-row-2'))
    expect(firstRow.getByText('Saved')).toBeVisible()
    expect(secondRow.getByText('Could not save')).toBeVisible()
    expect(screen.queryByTestId('garment-batch-preview-2')).toBeNull()
    expect([...fileSystem.files.keys()]).toEqual([original.uri])

    imagePicker.launchImageLibraryAsync.mockResolvedValueOnce({
      canceled: false,
      assets: [{ ...original, width: 700 }],
    })
    await browserUser.click(retry)
    expect(
      await secondRow.findByText('Choose the original photo to retry.')
    ).toBeVisible()
    expect(commits).toHaveLength(2)
    expect([...fileSystem.files.keys()]).toEqual([original.uri])

    imagePicker.launchImageLibraryAsync.mockResolvedValueOnce({
      canceled: false,
      assets: [original],
    })
    await browserUser.click(screen.getByTestId('garment-batch-retry-2'))
    expect(await secondRow.findByText('Saved')).toBeVisible()
    expect(imagePicker.launchImageLibraryAsync).toHaveBeenLastCalledWith({
      mediaTypes: ['images'],
      quality: 1,
      allowsMultipleSelection: false,
      selectionLimit: 1,
    })
    expect(commits.map(({ garmentId }) => garmentId)).toEqual([
      'garment-1',
      'garment-2',
      'garment-2',
    ])
    expect(new Set(commits.map(({ key }) => key)).size).toBe(2)
    expect(commits[1]?.key).toBe(commits[2]?.key)
    expect(allocations).toHaveLength(2)
    expect(puts).toEqual(['batch-1', 'batch-2'])
    expect(onBatchGarmentCommitted).toHaveBeenCalledTimes(2)
    expect(onBatchGarmentCommitted).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ id: 'garment-1' }),
      'test-access-token'
    )
    expect(onBatchGarmentCommitted).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ id: 'garment-2' }),
      'test-access-token'
    )
    expect(onGarmentCommitted).not.toHaveBeenCalled()
    expect([...fileSystem.files.keys()]).toEqual([original.uri])
    await browserUser.click(screen.getByTestId('garment-batch-done'))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('recovers from a canceled picker and a picker error, then shows an invalid asset row', async () => {
    imagePicker.launchImageLibraryAsync
      .mockResolvedValueOnce({ canceled: true, assets: null })
      .mockRejectedValueOnce(new Error('Picker unavailable'))
      .mockResolvedValueOnce({
        canceled: false,
        assets: [{ ...libraryAsset, width: 200 }],
      })
    renderModal({ onBatchGarmentCommitted: vi.fn() })
    const picker = screen.getByTestId('garment-batch-picker')

    await browserUser.click(picker)
    expect(screen.queryByTestId('garment-batch-row-1')).toBeNull()
    await browserUser.click(picker)
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not open the photo library.'
    )
    await browserUser.click(picker)
    expect(await screen.findByText('This photo could not be prepared.')).toBeVisible()
    expect(screen.getByTestId('garment-batch-add')).toHaveAttribute(
      'aria-disabled',
      'true'
    )
    expect(imageManipulator.manipulateAsync).not.toHaveBeenCalled()
  })

  it('shows sign-in guidance and stops the batch when the API rejects the session', async () => {
    imagePicker.launchImageLibraryAsync.mockResolvedValueOnce({
      canceled: false,
      assets: [libraryAsset, cameraAsset],
    })
    const allocate = vi.fn()
    server.use(
      http.post('*/api/v1/wardrobe/upload-url', () => {
        allocate()
        return HttpResponse.json({ message: 'SIGNED_OUT' }, { status: 401 })
      })
    )
    const onBatchGarmentCommitted = vi.fn()
    renderModal({ onBatchGarmentCommitted })

    await browserUser.click(screen.getByTestId('garment-batch-picker'))
    await browserUser.click(await screen.findByTestId('garment-batch-keep-1'))
    await browserUser.click(await screen.findByTestId('garment-batch-keep-2'))
    await browserUser.click(screen.getByRole('button', { name: 'Add 2 pieces' }))

    expect(await screen.findByTestId('garment-batch-blocked')).toHaveTextContent(
      'wardrobe.error.sign_in_required'
    )
    expect(allocate).toHaveBeenCalledOnce()
    expect(onBatchGarmentCommitted).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
    expect(screen.queryByTestId('garment-batch-preview-2')).toBeNull()
    expect(screen.getByTestId('garment-batch-done')).not.toHaveAttribute(
      'aria-disabled',
      'true'
    )
  })

  it('[7.28-CLEANUP-001] retires only app-owned picker copies returned after an account switch', async () => {
    const pickerCopy = { ...libraryAsset, uri: 'file:///cache/ImagePicker/coat.png' }
    const original = { ...libraryAsset, uri: 'file:///library/coat.png' }
    fileSystem.files.set(pickerCopy.uri, fileSystem.state.bytes)
    fileSystem.files.set(original.uri, fileSystem.state.bytes)
    let finishPick!: (result: ImagePickerResult) => void
    const picked = new Promise<ImagePickerResult>((resolve) => {
      finishPick = resolve
    })
    imagePicker.launchImageLibraryAsync.mockReturnValueOnce(picked)
    setMobileApplicationUserId('member-a')
    const onBatchGarmentCommitted = vi.fn()
    renderModal({ onBatchGarmentCommitted })

    await browserUser.click(screen.getByTestId('garment-batch-picker'))
    expect(imagePicker.launchImageLibraryAsync).toHaveBeenCalledOnce()
    act(() => setMobileApplicationUserId('member-b'))
    await act(async () => {
      finishPick({ canceled: false, assets: [pickerCopy, original] })
      await picked
    })

    expect(screen.getByTestId('garment-batch-picker')).toBeVisible()
    expect(screen.queryByTestId('garment-batch-row-1')).toBeNull()
    expect(imageManipulator.manipulateAsync).not.toHaveBeenCalled()
    expect([...fileSystem.files.keys()]).toEqual([original.uri])
    expect(onBatchGarmentCommitted).not.toHaveBeenCalled()
  })

  it('[P1] [7.29-NATIVE] keeps cutouts by default and confirms only the remaining piece with edited tags', async () => {
    const file = new File(['synthetic-flat-lay'], 'original-filename.jpg', {
      type: 'image/jpeg',
    })
    const pickerCopy = {
      ...libraryAsset,
      file,
      uri: 'file:///cache/ImagePicker/flat-lay.jpg',
    }
    const original = 'file:///library/flat-lay.jpg'
    fileSystem.files.set(pickerCopy.uri, fileSystem.state.bytes)
    fileSystem.files.set(original, fileSystem.state.bytes)
    imagePicker.launchImageLibraryAsync.mockResolvedValueOnce({
      canceled: false,
      assets: [pickerCopy],
    })
    const first = {
      id: '254ead7d-3549-4c56-8d7a-ad5b7eee1956',
      mask: 'UklGRh4AAABXRUJQVlA4TBEAAAAvA8AAAAfQn7JWqv+BiOh/AAA=',
      token: 'synthetic-top-token',
    }
    const second = {
      id: 'cf826481-68f1-4ae9-bfea-0593c4bcc034',
      mask: 'UklGRh4AAABXRUJQVlA4TBEAAAAvA8AAAAdQns50sP+BiOh/AAA=',
      token: 'synthetic-bottom-token',
    }
    const submissions: FlatLaySelection[] = []
    const reviewUpload = vi.fn()
    server.use(
      http.post('*/api/v1/wardrobe/flat-lay/review', async ({ request }) => {
        // MSW runs this handler in Chromium, which exposes the DOM FormData getters.
        const multipart = (await request.formData()) as unknown as {
          get(name: string): unknown
        }
        const part = multipart.get('photo')
        if (!(part instanceof File)) throw new Error('Expected one multipart photo')
        reviewUpload(part.name, await part.text())
        return HttpResponse.json({
          items: [
            { ...first, category: null },
            { ...second, category: 'bottom' },
          ],
          expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
        })
      }),
      http.post('*/api/v1/wardrobe/flat-lay/confirm', async ({ request }) => {
        submissions.push(flatLayConfirmInputSchema.parse(await request.json()))
        if (submissions.length === 1) return HttpResponse.error()
        return HttpResponse.json({
          garments: [
            {
              id: first.id,
              status: 'ready',
              category: 'outerwear',
              material: null,
              comfortRange: null,
              tagsConfirmedAt: '2026-11-28T14:00:00.000Z',
              fileSizeBytes: 42,
              mimeType: 'image/webp',
              retentionStatus: 'active',
              createdAt: '2026-11-28T14:00:00.000Z',
              committedAt: '2026-11-28T14:00:00.000Z',
              imageAccess: null,
            },
          ],
        })
      })
    )
    setMobileApplicationUserId('flat-lay-owner')
    const onBatchGarmentCommitted = vi.fn()
    const { onClose, onGarmentCommitted } = renderModal({ onBatchGarmentCommitted })

    await browserUser.click(
      screen.getByRole('button', { name: 'Add from flat-lay photo' })
    )
    expect(await screen.findByRole('button', { name: 'Add 2 pieces' })).toBeVisible()
    expect(screen.getAllByRole('button', { name: 'Edit tags' })).toHaveLength(2)
    expect(screen.getAllByRole('button', { name: 'Remove' })).toHaveLength(2)
    expect(imagePicker.launchImageLibraryAsync).toHaveBeenCalledOnce()
    expect(imagePicker.launchImageLibraryAsync).toHaveBeenCalledWith(
      expect.objectContaining({ allowsMultipleSelection: false })
    )
    expect(reviewUpload).toHaveBeenCalledExactlyOnceWith('photo', 'synthetic-flat-lay')
    await waitFor(() => expect([...fileSystem.files.keys()]).toEqual([original]))
    expect(submissions).toEqual([])

    await browserUser.click(screen.getAllByRole('button', { name: 'Edit tags' })[0]!)
    await browserUser.click(screen.getByRole('button', { name: 'Cancel' }))
    await browserUser.click(screen.getAllByRole('button', { name: 'Edit tags' })[0]!)
    await browserUser.click(screen.getByRole('button', { name: 'Outerwear' }))
    await browserUser.click(screen.getByRole('button', { name: 'Blazer' }))
    await browserUser.click(screen.getByRole('button', { name: 'Wool' }))
    await browserUser.click(screen.getByRole('button', { name: 'Cold' }))
    await browserUser.click(screen.getByRole('button', { name: 'Done' }))
    await browserUser.click(screen.getAllByRole('button', { name: 'Remove' })[1]!)
    await browserUser.click(screen.getByRole('button', { name: 'Add 1 piece' }))
    await browserUser.click(await screen.findByRole('button', { name: 'Try again' }))

    await waitFor(() =>
      expect(onBatchGarmentCommitted).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ id: first.id, category: 'outerwear' }),
        'test-access-token'
      )
    )
    const expected = {
      items: [
        {
          ...first,
          tags: {
            category: 'outerwear',
            subtype: 'blazer',
            material: 'wool',
            comfortRange: 'cold',
          },
        },
      ],
    }
    expect(submissions).toEqual([expected, expected])
    expect(onClose).toHaveBeenCalledOnce()
    expect(
      await screen.findByRole('button', { name: 'Add from flat-lay photo' })
    ).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Edit tags' })).toBeNull()
    expect(onGarmentCommitted).not.toHaveBeenCalled()
    expect([...fileSystem.files.keys()]).toEqual([original])
  })

  it('[P1] [7.29-NATIVE] releases a late picker copy after account change', async () => {
    const pickerCopy = { ...libraryAsset, uri: 'file:///cache/ImagePicker/flat-lay.jpg' }
    fileSystem.files.set(pickerCopy.uri, fileSystem.state.bytes)
    let finishPick!: (result: ImagePickerResult) => void
    const pendingPick = new Promise<ImagePickerResult>((resolve) => {
      finishPick = resolve
    })
    imagePicker.launchImageLibraryAsync.mockReturnValueOnce(pendingPick)
    const reviewed = vi.fn()
    server.use(
      http.post('*/api/v1/wardrobe/flat-lay/review', () => {
        reviewed()
        return HttpResponse.error()
      })
    )
    setMobileApplicationUserId('former-flat-lay-owner')
    const onBatchGarmentCommitted = vi.fn()
    renderModal({ onBatchGarmentCommitted })

    await browserUser.click(
      screen.getByRole('button', { name: 'Add from flat-lay photo' })
    )
    await browserUser.click(
      screen.getByRole('button', { name: 'Add from flat-lay photo' })
    )
    expect(imagePicker.launchImageLibraryAsync).toHaveBeenCalledOnce()
    act(() => setMobileApplicationUserId('new-flat-lay-owner'))
    await act(async () => {
      finishPick({ canceled: false, assets: [pickerCopy] })
      await pendingPick
    })

    expect(fileSystem.files.has(pickerCopy.uri)).toBe(false)
    expect(reviewed).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Edit tags' })).toBeNull()
    expect(onBatchGarmentCommitted).not.toHaveBeenCalled()
  })

  it('[P1] [7.29-NATIVE] clears batch errors and releases native URI copies after a refused review', async () => {
    const asset = {
      ...libraryAsset,
      uri: 'file:///cache/ImagePicker/flat-lay-native.jpg',
      mimeType: 'image/jpeg',
    }
    fileSystem.files.set(asset.uri, fileSystem.state.bytes)
    imagePicker.launchImageLibraryAsync
      .mockResolvedValueOnce({
        canceled: false,
        assets: Array.from({ length: 6 }, () => libraryAsset),
      })
      .mockResolvedValueOnce({ canceled: false, assets: [asset] })
    const append = vi.spyOn(FormData.prototype, 'append')
    server.use(
      http.post('*/api/v1/wardrobe/flat-lay/review', () =>
        HttpResponse.json({ message: 'FLAT_LAY_PERSON' }, { status: 422 })
      )
    )
    setMobileApplicationUserId('flat-lay-native-owner')
    renderModal({ onBatchGarmentCommitted: vi.fn() })

    await browserUser.click(screen.getByTestId('garment-batch-picker'))
    expect(await screen.findByText('Choose up to 5 photos.')).toBeVisible()
    await browserUser.click(
      screen.getByRole('button', { name: 'Add from flat-lay photo' })
    )

    expect(
      await screen.findByText('Choose a photo with only clothing laid flat.')
    ).toBeVisible()
    expect(screen.queryByText('Choose up to 5 photos.')).toBeNull()
    expect(append).toHaveBeenCalledWith('photo', {
      uri: asset.uri,
      name: 'photo',
      type: 'image/jpeg',
    })
    await waitFor(() => expect(fileSystem.files.has(asset.uri)).toBe(false))
    expect(screen.queryByRole('button', { name: 'Edit tags' })).toBeNull()
  })

  it('[P1] [7.29-NATIVE] recovers from canceled, oversized and failed picks without posting a photo', async () => {
    const tooLarge = {
      ...libraryAsset,
      fileSize: FLAT_LAY_MAX_PHOTO_BYTES + 1,
      uri: 'file:///cache/ImagePicker/oversized.jpg',
    }
    fileSystem.files.set(tooLarge.uri, fileSystem.state.bytes)
    imagePicker.launchImageLibraryAsync
      .mockResolvedValueOnce({ canceled: true, assets: null })
      .mockResolvedValueOnce({ canceled: false, assets: [tooLarge] })
      .mockRejectedValueOnce(new Error('Synthetic picker failure'))
    const reviewed = vi.fn()
    server.use(
      http.post('*/api/v1/wardrobe/flat-lay/review', () => {
        reviewed()
        return HttpResponse.error()
      })
    )
    setMobileApplicationUserId('flat-lay-pick-owner')
    renderModal({ onBatchGarmentCommitted: vi.fn() })
    const choose = screen.getByRole('button', { name: 'Add from flat-lay photo' })

    await browserUser.click(choose)
    expect(screen.queryByRole('alert')).toBeNull()
    await browserUser.click(choose)
    expect(await screen.findByText(/two to five pieces spaced apart/)).toBeVisible()
    await waitFor(() => expect(fileSystem.files.has(tooLarge.uri)).toBe(false))
    await browserUser.click(choose)
    expect(await screen.findByText(/Choose it again to retry/)).toBeVisible()
    expect(reviewed).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Edit tags' })).toBeNull()
  })

  it('4.4-MOB-CAP-03 closes and resets through the close button', () => {
    const { onClose } = renderModal()

    fireEvent.click(screen.getByTestId('garment-capture-close'))

    expect(onClose).toHaveBeenCalledOnce()
  })

  // Story CC-7.11 D13: the plan's contract keeps the X and makes the header the swipe handle.
  it('[7.11-NAT-032] [7.11-NAT-033] a swipe down on the header closes like the X; a short one does not', async () => {
    const { onClose } = renderModal()
    const handle = screen.getByTestId('layer-swipe-handle')
    expect(handle.contains(screen.getByTestId('garment-capture-close'))).toBe(true)

    await dragFrom(handle, { dy: LAYER_SWIPE_CLOSE_PX / 2 })
    expect(onClose).not.toHaveBeenCalled()

    await dragFrom(handle, { dy: LAYER_SWIPE_CLOSE_PX + 40 })
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('[Codex 7.11 #3] [7.11-NAT-032] a swipe on a picked photo asks first; Keep editing keeps the crop, Discard closes', async () => {
    const copy = getGuestPreviewStrings('en-US').firstUse
    const { onClose } = renderModal({ confirmDiscard: true })
    await pickLibraryPhoto()

    await dragFrom(screen.getByTestId('layer-swipe-handle'), {
      dy: LAYER_SWIPE_CLOSE_PX + 40,
    })
    expect(onClose).not.toHaveBeenCalled()
    const alert = vi.mocked(Alert.alert)
    expect(alert).toHaveBeenCalledTimes(1)
    const [title, message, buttons = []] = alert.mock.calls[0]!
    expect(title).toBe(copy.discardPhoto)
    expect(message).toBeUndefined()
    expect(buttons.map(({ text, style }) => ({ text, style }))).toEqual([
      { text: copy.keepEditing, style: 'cancel' },
      { text: copy.discard, style: 'destructive' },
    ])

    act(() => buttons[0]!.onPress?.())
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByTestId('garment-crop-preview')).toBeInTheDocument()

    act(() => buttons[1]!.onPress?.())
    expect(onClose).toHaveBeenCalledOnce()
    expect(screen.queryByTestId('garment-crop-preview')).not.toBeInTheDocument()
  })

  it('[Codex 7.11 #3] [7.11-NAT-032] while a photo uploads, X, swipe and back keep the sheet open and the upload running', async () => {
    let allocations = 0
    server.use(
      http.post('*/api/v1/wardrobe/upload-url', () => {
        allocations++
        return new Promise<never>(() => undefined)
      })
    )
    const { onClose, onGarmentCommitted } = renderModal()
    await pickLibraryPhotoAndConfirm()
    await waitFor(() => screen.getByTestId('garment-upload-progress'))

    // Story CC-7.11 D13 busy guard: the X is disabled and announces it.
    const close = screen.getByTestId('garment-capture-close')
    expect(close.getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(close)
    await dragFrom(screen.getByTestId('layer-swipe-handle'), {
      dy: LAYER_SWIPE_CLOSE_PX + 40,
    })
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })

    expect(onClose).not.toHaveBeenCalled()
    expect(Alert.alert).not.toHaveBeenCalled()
    expect(screen.getByTestId('garment-upload-progress')).toBeInTheDocument()
    expect(allocations, 'the upload was not restarted or dropped').toBe(1)
    expect(onGarmentCommitted).not.toHaveBeenCalled()
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

  it('4.4-MOB-CAP-06 uploads the selected portrait crop with the original background', async () => {
    const seen = captureSuccessfulGarmentUpload()
    renderModal()
    await pickLibraryPhoto()
    fireEvent.click(screen.getByRole('switch'))
    expect(screen.getByRole('switch')).not.toBeChecked()
    fireEvent.click(screen.getByTestId('garment-aspect-portrait'))
    const preview = await screen.findByTestId('garment-crop-preview')
    expect(preview).toHaveAttribute('data-source-uri', 'file:///crop-675x900.jpeg')
    await browserUser.click(screen.getByTestId('garment-confirm-image'))

    expect(await screen.findByTestId('garment-capture-complete')).toBeInTheDocument()
    expect(imageManipulator.manipulateAsync).toHaveBeenCalledWith(
      libraryAsset.uri,
      [
        { crop: { originX: 113, originY: 0, width: 675, height: 900 } },
        { resize: { width: 675, height: 900 } },
      ],
      { compress: 0.9, format: 'jpeg' }
    )
    expect(seen.bytes).toEqual(fileSystem.state.bytes)
    expect(seen.allocation).toMatchObject({ widthPx: 675, heightPx: 900 })
    expect(seen.commit).toMatchObject({ hasCropping: true, hasBgCleanup: false })
  })

  it('CC-7.26 sends the prepared PNG shown in the preview and clears its temporary file', async () => {
    const seen = captureSuccessfulGarmentUpload()
    const uri = 'file:///cutout.png'
    const width = 256
    const height = 256
    const pixels = Buffer.alloc(width * height * 3, 245)
    for (let y = 60; y < 205; y++) {
      for (let x = 50; x < 205; x++) {
        pixels.set([36, 92, 161], (y * width + x) * 3)
      }
    }
    fileSystem.files.set(
      uri,
      PNG.sync.write(
        { width, height, data: pixels },
        {
          inputColorType: 2,
          inputHasAlpha: false,
          colorType: 2,
        }
      )
    )
    imageManipulator.manipulateAsync.mockResolvedValueOnce({ uri, width, height })
    renderModal()
    await pickLibraryPhoto()

    expect(screen.getByRole('switch')).toBeChecked()
    expect(screen.getByTestId('garment-crop-preview')).toHaveAttribute(
      'data-source-uri',
      uri
    )
    expect(seen.allocation).toBeUndefined()
    const displayed = fileSystem.files.get(uri)!
    const cutout = PNG.sync.read(Buffer.from(displayed))
    expect(Array.from(cutout.data.subarray(0, 4))).toEqual([0, 0, 0, 0])
    const center = ((height / 2) * width + width / 2) * 4
    expect(Array.from(cutout.data.subarray(center, center + 4))).toEqual([
      36, 92, 161, 255,
    ])
    await browserUser.click(screen.getByTestId('garment-confirm-image'))

    expect(await screen.findByTestId('garment-capture-complete')).toBeInTheDocument()
    expect(seen.allocation).toMatchObject({
      mimeType: 'image/png',
      widthPx: width,
      heightPx: height,
    })
    expect(seen.uploadedContentType).toBe('image/png')
    expect(seen.bytes).toEqual(displayed)
    expect(seen.commit).toMatchObject({ hasCropping: true, hasBgCleanup: true })
    await waitFor(() => expect(fileSystem.files.has(uri)).toBe(false))
  })

  it('CC-7.26 waits for in-flight preparation and runs only the latest crop', async () => {
    const seen = captureSuccessfulGarmentUpload()
    const stale = { uri: 'file:///stale-crop.png', width: 900, height: 900 }
    let finishStale!: (image: typeof stale) => void
    const pendingCrop = new Promise<typeof stale>((resolve) => {
      finishStale = resolve
    })
    fileSystem.files.set(stale.uri, fileSystem.state.bytes)
    imageManipulator.manipulateAsync.mockReturnValueOnce(pendingCrop)
    renderModal()
    fireEvent.click(screen.getByTestId('garment-source-library'))

    const confirm = await screen.findByTestId('garment-confirm-image')
    expect(confirm).toHaveAttribute('aria-disabled', 'true')
    expect(screen.queryByTestId('garment-crop-preview')).not.toBeInTheDocument()
    await waitFor(() => expect(imageManipulator.manipulateAsync).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByTestId('garment-aspect-portrait'))
    fireEvent.click(screen.getByRole('switch'))
    expect(screen.getByRole('switch')).not.toBeChecked()
    expect(confirm).toHaveAttribute('aria-disabled', 'true')
    expect(seen.allocation).toBeUndefined()
    expect(imageManipulator.manipulateAsync).toHaveBeenCalledTimes(1)
    await act(async () => {
      finishStale(stale)
      await pendingCrop
    })

    expect(await screen.findByTestId('garment-crop-preview')).toHaveAttribute(
      'data-source-uri',
      'file:///crop-675x900.jpeg'
    )
    expect(fileSystem.files.has(stale.uri)).toBe(false)
    expect(imageManipulator.manipulateAsync).toHaveBeenCalledTimes(2)
    await browserUser.click(confirm)
    expect(await screen.findByTestId('garment-capture-complete')).toBeInTheDocument()
    expect(seen.allocation).toMatchObject({ widthPx: 675, heightPx: 900 })
    expect(seen.commit).toMatchObject({ hasBgCleanup: false })
  })

  it('CC-7.26 shows and uploads the original after a valid pale PNG abstains', async () => {
    const seen = captureSuccessfulGarmentUpload()
    const width = 256
    const height = 256
    const uri = 'file:///pale-crop.png'
    const pixels = Buffer.alloc(width * height * 4, 255)
    for (let y = 60; y < 205; y++) {
      for (let x = 50; x < 205; x++) {
        pixels.set([251, 251, 251, 255], (y * width + x) * 4)
      }
    }
    fileSystem.files.set(uri, PNG.sync.write({ width, height, data: pixels }))
    imageManipulator.manipulateAsync.mockResolvedValueOnce({ uri, width, height })
    renderModal()
    await pickLibraryPhoto()

    expect(screen.getByText('wardrobe.cleanup.unavailable')).toBeInTheDocument()
    expect(screen.getByTestId('garment-crop-preview')).toHaveAttribute(
      'data-source-uri',
      'file:///crop-900x900.jpeg'
    )
    expect(fileSystem.files.has(uri)).toBe(false)
    await browserUser.click(screen.getByTestId('garment-confirm-image'))

    expect(await screen.findByTestId('garment-capture-complete')).toBeInTheDocument()
    expect(seen.uploadedContentType).toBe('image/jpeg')
    expect(seen.bytes).toEqual(fileSystem.state.bytes)
    expect(seen.commit).toMatchObject({ hasBgCleanup: false })
  })

  it('CC-7.26 disables confirmation when the local crop cannot be prepared', async () => {
    const seen = captureSuccessfulGarmentUpload()
    imageManipulator.manipulateAsync
      .mockRejectedValueOnce(new Error('PNG crop unavailable'))
      .mockRejectedValueOnce(new Error('JPEG crop unavailable'))
    renderModal()
    fireEvent.click(screen.getByTestId('garment-source-library'))

    expect(await screen.findByText('wardrobe.error.invalid_image')).toHaveAttribute(
      'role',
      'alert'
    )
    const confirm = screen.getByTestId('garment-confirm-image')
    expect(confirm).toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(confirm)
    expect(seen.allocation).toBeUndefined()

    fireEvent.click(screen.getByRole('switch'))
    expect(await screen.findByTestId('garment-crop-preview')).toBeInTheDocument()
    expect(confirm).not.toHaveAttribute('aria-disabled', 'true')
    expect(screen.queryByText('wardrobe.error.invalid_image')).not.toBeInTheDocument()
  })

  it('CC-7.26 deletes a pending JPEG crop when the member changes', async () => {
    const seen = captureSuccessfulGarmentUpload()
    const uri = 'file:///member-a-crop.jpeg'
    const oldImage = { uri, width: 900, height: 900 }
    let finishCrop!: (image: typeof oldImage) => void
    const pendingCrop = new Promise<typeof oldImage>((resolve) => {
      finishCrop = resolve
    })
    imageManipulator.manipulateAsync
      .mockRejectedValueOnce(new Error('PNG crop unavailable'))
      .mockReturnValueOnce(pendingCrop)
    fileSystem.files.set(uri, fileSystem.state.bytes)
    setMobileApplicationUserId('member-a')
    renderModal()
    fireEvent.click(screen.getByTestId('garment-source-library'))
    await waitFor(() =>
      expect(imageManipulator.manipulateAsync).toHaveBeenLastCalledWith(
        libraryAsset.uri,
        expect.any(Array),
        { compress: 0.9, format: 'jpeg' }
      )
    )

    act(() => setMobileApplicationUserId('member-b'))
    expect(screen.getByTestId('garment-source-library')).toBeInTheDocument()
    await act(async () => {
      finishCrop(oldImage)
      await pendingCrop
    })
    await waitFor(() => expect(fileSystem.files.has(uri)).toBe(false))
    expect(screen.queryByTestId('garment-crop-preview')).not.toBeInTheDocument()
    expect(seen.allocation).toBeUndefined()
  })

  it('4.4-MOB-CAP-07 uploads the garment and reports the commit with the access token', async () => {
    const seen = captureSuccessfulGarmentUpload()
    const { onGarmentCommitted } = renderModal()
    await pickLibraryPhotoAndConfirm()

    await waitFor(() => {
      expect(screen.getByTestId('garment-capture-complete')).toBeInTheDocument()
    })
    expect(seen.allocation?.mimeType).toBe('image/jpeg')
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
      await browserUser.click(screen.getByTestId('garment-confirm-image'))
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

    await browserUser.click(screen.getByTestId('garment-confirm-image'))
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
    await browserUser.click(screen.getByTestId('garment-confirm-image'))
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
    await browserUser.click(screen.getByTestId('garment-confirm-image'))
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
    await screen.findByTestId('garment-crop-preview')
    await browserUser.click(screen.getByTestId('garment-confirm-image'))

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
      expect(screen.getByText('wardrobe.error.sign_in_required')).toBeInTheDocument()
    })
  })

  /** The prepared crop can exceed the ceiling even when the picked source did not. */
  it('4.4-MOB-CAP-20 rejects re-encoded bytes that exceed the 10 MiB ceiling', async () => {
    fileSystem.state.bytes = new Uint8Array(10 * 1024 * 1024 + 1)
    renderModal()
    await pickLibraryPhotoAndConfirm()

    await waitFor(() => {
      expect(screen.getByText('wardrobe.error.image_too_large')).toBeInTheDocument()
    })
    expect(screen.getByTestId('garment-crop-preview')).toBeInTheDocument()

    fileSystem.state.bytes = new Uint8Array([1, 2, 3, 4])
    fireEvent.click(screen.getByRole('switch'))
    expect(await screen.findByTestId('garment-crop-preview')).toBeInTheDocument()
    expect(screen.queryByText('wardrobe.error.image_too_large')).not.toBeInTheDocument()
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
