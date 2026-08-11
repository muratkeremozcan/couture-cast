import React from 'react'
import type * as ReactNativeModule from 'react-native'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AccessibilityInfo, findNodeHandle, Platform } from 'react-native'
import { http, HttpResponse } from 'msw'

import { server } from '@/src/test-utils/msw/server'
import { setMobileAccessTokenResolver } from '@/src/lib/mobile-auth'
import { MobileGarmentCaptureModal } from './garment-capture-modal'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

const openSettingsMock = vi.hoisted(() => vi.fn())

vi.mock('react-native', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactNativeModule>()
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
    Modal: ({ children, visible }: { children: React.ReactNode; visible: boolean }) =>
      visible ? children : null,
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
  SaveFormat: { PNG: 'png' },
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

/** Picks a library photo and waits for the crop step to render. */
async function pickLibraryPhoto() {
  fireEvent.click(screen.getByTestId('garment-source-library'))
  await waitFor(() => screen.getByTestId('garment-crop-preview'))
}

/** Picks a library photo, then confirms the crop to start the upload. */
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
        HttpResponse.json({ data: committedGarment })
      )
    )

    const { onGarmentCommitted } = renderModal()
    await pickLibraryPhotoAndConfirm()

    await waitFor(() => {
      expect(screen.getByTestId('garment-capture-complete')).toBeInTheDocument()
    })
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
        expect.objectContaining({ format: 'png' })
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
