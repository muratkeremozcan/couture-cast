// Learning path Step 29: Garment capture flow.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-29-garment-capture-flow
// Learning path Step 58: Image uploads straight to storage.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#image-uploads-straight-to-storage
// Story 4.1 Task 8 step 3 owner: unit-test web garment capture behavior
// @vitest-environment jsdom
import React from 'react'
import { Blob as NodeBlob } from 'node:buffer'
import {
  act,
  cleanup,
  fireEvent,
  render as renderUnwrapped,
  screen,
  waitFor,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nextProvider } from 'react-i18next'
import {
  UploadSessionChangedError,
  type GarmentItemContract,
} from '@couture/api-client/contracts/http'
import { GarmentCaptureModal } from './garment-capture-modal'
import * as wardrobe from '../../lib/wardrobe'
import { getI18n } from '../../i18n'
import {
  forgetAllUploadAttempts,
  setUploadAttemptAccount,
} from '../../lib/upload-attempts'

const mockCommittedGarment: GarmentItemContract = {
  id: 'garment-committed-1',
  status: 'processing',
  category: null,
  material: null,
  comfortRange: null,
  tagsConfirmedAt: null,
  fileSizeBytes: 1024,
  mimeType: 'image/png',
  retentionStatus: 'active',
  createdAt: '2026-08-04T09:25:00.000Z',
  committedAt: '2026-08-04T09:26:22.000Z',
  imageAccess: {
    url: 'https://example.test/garment.png',
    expiresAt: '2026-08-04T09:41:22.000Z',
  },
}

const globalRestorers: (() => void)[] = []
const { WEB_ACCESS_TOKEN_STORAGE_KEY, WardrobeRequestError } = wardrobe

/**
 * The modal renders inside the app's i18n provider, as the wardrobe page mounts it; every
 * string it shows comes from the web catalog (en-US unless a test switches the language).
 */
function render(ui: React.ReactElement) {
  return renderUnwrapped(ui, {
    wrapper: ({ children }) => (
      <I18nextProvider i18n={getI18n()}>{children}</I18nextProvider>
    ),
  })
}

/** The en-US catalog's generic upload failure copy (wardrobe.capture.errors.failed). */
const GENERIC_UPLOAD_FAILURE = 'Upload failed. Please try again.'

const preparedPhoto: wardrobe.PreparedImage = {
  blob: new Blob(['crop'], { type: 'image/webp' }),
  widthPx: 400,
  heightPx: 400,
  mimeType: 'image/webp',
  sha256: 'prepared-photo-checksum',
  backgroundRemoved: true,
}
const revokePreviewUrl = vi.fn()

beforeEach(() => {
  vi.spyOn(wardrobe, 'prepareGarmentImage').mockResolvedValue(preparedPhoto)
  revokePreviewUrl.mockClear()
  vi.stubGlobal(
    'URL',
    class extends URL {
      static createObjectURL = vi.fn(() => 'blob:prepared-photo')
      static revokeObjectURL = revokePreviewUrl
    }
  )
})

afterEach(async () => {
  for (const restore of globalRestorers.splice(0).reverse()) {
    restore()
  }
  cleanup()
  vi.unstubAllGlobals()
  if (getI18n().language !== 'en-US') await getI18n().changeLanguage('en-US')
  vi.restoreAllMocks()
})

function installCameraMock(getUserMedia: ReturnType<typeof vi.fn>) {
  const originalDescriptor = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices')
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia },
  })

  globalRestorers.push(() => {
    if (originalDescriptor) {
      Object.defineProperty(navigator, 'mediaDevices', originalDescriptor)
    } else {
      Reflect.deleteProperty(navigator, 'mediaDevices')
    }
  })
}

describe('GarmentCaptureModal Component', () => {
  it('renders modal dialog when open', () => {
    render(<GarmentCaptureModal isOpen={true} onClose={vi.fn()} />)
    expect(screen.getByRole('dialog')).toBeDefined()
    expect(screen.getByText('Add a piece')).toBeDefined()
    expect(screen.getByText('Take Photo')).toBeDefined()
    expect(screen.getByText('Choose File')).toBeDefined()
  })

  it('does not render when closed', () => {
    render(<GarmentCaptureModal isOpen={false} onClose={vi.fn()} />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('calls onClose when close button clicked using userEvent', async () => {
    const user = userEvent.setup()
    const handleClose = vi.fn()
    render(<GarmentCaptureModal isOpen={true} onClose={handleClose} />)
    const closeBtn = screen.getByLabelText('Close capture modal')
    await user.click(closeBtn)
    expect(handleClose).toHaveBeenCalledOnce()
  })

  it('keeps the camera track live through the camera-step transition and stops it on cancel', async () => {
    const user = userEvent.setup()
    const stop = vi.fn()
    const stream = { getTracks: () => [{ stop }] } as unknown as MediaStream
    const getUserMedia = vi.fn().mockResolvedValue(stream)
    installCameraMock(getUserMedia)

    render(<GarmentCaptureModal isOpen={true} onClose={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Take Photo' }))
    await screen.findByRole('button', { name: 'Snap Photo' })

    expect(getUserMedia).toHaveBeenCalledOnce()
    expect(stop).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(stop).toHaveBeenCalledOnce()
  })

  it('stops each camera stream when two camera requests resolve', async () => {
    const first = Promise.withResolvers<MediaStream>()
    const second = Promise.withResolvers<MediaStream>()
    const stopFirst = vi.fn()
    const stopSecond = vi.fn()
    installCameraMock(
      vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    )
    const user = userEvent.setup()
    render(<GarmentCaptureModal isOpen onClose={vi.fn()} />)
    const take = screen.getByRole('button', { name: 'Take Photo' })

    await user.dblClick(take)
    await act(async () => {
      first.resolve({ getTracks: () => [{ stop: stopFirst }] } as unknown as MediaStream)
      second.resolve({
        getTracks: () => [{ stop: stopSecond }],
      } as unknown as MediaStream)
      await Promise.all([first.promise, second.promise])
    })
    expect(stopFirst).toHaveBeenCalledOnce()
    expect(stopSecond).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(stopSecond).toHaveBeenCalledOnce()
  })

  it('stops a camera stream returned after leaving the page', async () => {
    const camera = Promise.withResolvers<MediaStream>()
    const stop = vi.fn()
    installCameraMock(vi.fn().mockReturnValue(camera.promise))
    const user = userEvent.setup()
    const view = render(<GarmentCaptureModal isOpen onClose={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'Take Photo' }))
    view.unmount()
    await act(async () => {
      camera.resolve({ getTracks: () => [{ stop }] } as unknown as MediaStream)
      await camera.promise
    })
    expect(stop).toHaveBeenCalledOnce()
  })

  it('reports completion after confirming and uploading photo', async () => {
    const user = userEvent.setup()
    const onGarmentCommitted = vi.fn()
    const uploadGarment = vi.fn().mockResolvedValue(mockCommittedGarment)

    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D)
    const toDataURL = vi
      .spyOn(HTMLCanvasElement.prototype, 'toDataURL')
      .mockReturnValue('data:image/jpeg;base64,sample')

    render(
      <GarmentCaptureModal
        isOpen={true}
        onClose={vi.fn()}
        uploadGarment={uploadGarment}
        onGarmentCommitted={onGarmentCommitted}
      />
    )

    expect(screen.queryByText('Piece added')).toBeNull()

    const stop = vi.fn()
    const stream = { getTracks: () => [{ stop }] } as unknown as MediaStream
    installCameraMock(vi.fn().mockResolvedValue(stream))

    await user.click(screen.getByRole('button', { name: 'Take Photo' }))
    await screen.findByRole('button', { name: 'Snap Photo' })
    await user.click(screen.getByRole('button', { name: 'Snap Photo' }))
    // A camera frame has no transparency, and as PNG it carried its grain at several times
    // the size (production follow-up 2026-11-19).
    expect(toDataURL).toHaveBeenCalledWith('image/jpeg', 0.9)

    await user.click(await readyCropButton())

    await waitFor(() => {
      expect(screen.getByText('Piece added')).toBeDefined()
    })
    expect(uploadGarment).toHaveBeenCalledOnce()
    expect(uploadGarment).toHaveBeenCalledWith(
      expect.objectContaining({ prepared: preparedPhoto })
    )
    expect(onGarmentCommitted).toHaveBeenCalledWith(mockCommittedGarment)
  })
})

async function chooseValidImage(user: ReturnType<typeof userEvent.setup>) {
  await user.upload(
    screen.getByLabelText('Garment image file'),
    new File(['fixture-image'], 'garment.png', { type: 'image/png' })
  )
  await readyCropButton()
}

async function readyCropButton() {
  const button = await screen.findByRole('button', { name: 'Use This Image' })
  await waitFor(() => expect(button).toBeEnabled())
  return button
}

describe('GarmentCaptureModal camera unavailability', () => {
  it('explains that the camera is unavailable in this context', async () => {
    const user = userEvent.setup()
    const originalDescriptor = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices')
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: undefined,
    })
    globalRestorers.push(() => {
      if (originalDescriptor) {
        Object.defineProperty(navigator, 'mediaDevices', originalDescriptor)
      } else {
        Reflect.deleteProperty(navigator, 'mediaDevices')
      }
    })

    render(<GarmentCaptureModal isOpen onClose={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Take Photo' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Camera access is unavailable on this device or context.'
    )
    // The file-import route must stay available as the fallback.
    expect(screen.getByRole('button', { name: 'Choose File' })).toBeInTheDocument()
  })

  it('explains a denied camera permission and keeps file import available', async () => {
    const user = userEvent.setup()
    installCameraMock(vi.fn().mockRejectedValue(new Error('NotAllowedError')))

    render(<GarmentCaptureModal isOpen onClose={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Take Photo' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Camera permission denied or camera unavailable. Please select a photo file.'
    )
    expect(screen.getByRole('button', { name: 'Choose File' })).toBeInTheDocument()
  })

  it('stops a camera stream that arrives after the modal was closed', async () => {
    const user = userEvent.setup()
    const stop = vi.fn()
    let settleStream: (stream: MediaStream) => void = () => undefined
    installCameraMock(
      vi.fn().mockReturnValue(
        new Promise<MediaStream>((resolve) => {
          settleStream = resolve
        })
      )
    )

    const { rerender } = render(<GarmentCaptureModal isOpen onClose={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Take Photo' }))

    rerender(<GarmentCaptureModal isOpen={false} onClose={vi.fn()} />)
    settleStream({ getTracks: () => [{ stop }] } as unknown as MediaStream)

    // Leaving the camera track live after the modal closed keeps the device
    // indicator on with no UI explaining why.
    await waitFor(() => expect(stop).toHaveBeenCalledOnce())
  })
})

describe('GarmentCaptureModal file validation', () => {
  it('rejects a file type the upload pipeline cannot decode', async () => {
    render(<GarmentCaptureModal isOpen onClose={vi.fn()} />)

    // `accept` filters the picker but not a drag-drop or an OS dialog set to
    // "All Files", so the guard has to be exercised past that filter.
    fireEvent.change(screen.getByLabelText('Garment image file'), {
      target: {
        files: [new File(['not an image'], 'notes.txt', { type: 'text/plain' })],
      },
    })

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Unsupported file type. Please upload a JPEG, PNG, or WebP image.'
    )
    expect(
      screen.queryByRole('button', { name: 'Use This Image' })
    ).not.toBeInTheDocument()
  })

  it('rejects a file over the 10 MiB server limit before uploading anything', async () => {
    const user = userEvent.setup()
    const uploadGarment = vi.fn()
    const oversized = new File(['x'], 'huge.png', { type: 'image/png' })
    Object.defineProperty(oversized, 'size', { value: 11 * 1024 * 1024 })
    render(<GarmentCaptureModal isOpen onClose={vi.fn()} uploadGarment={uploadGarment} />)

    await user.upload(screen.getByLabelText('Garment image file'), oversized)

    // Catching this client-side saves a guaranteed 413 round trip.
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'File size exceeds 10 MiB limit.'
    )
    expect(uploadGarment).not.toHaveBeenCalled()
  })
})

describe('GarmentCaptureModal crop controls', () => {
  it('focuses Retake after Keep editing when preparation is pending', async () => {
    const user = userEvent.setup()
    const preparation = Promise.withResolvers<wardrobe.PreparedImage>()
    vi.mocked(wardrobe.prepareGarmentImage).mockReturnValueOnce(preparation.promise)
    render(<GarmentCaptureModal isOpen confirmDiscard onClose={vi.fn()} />)
    await user.upload(
      screen.getByLabelText('Garment image file'),
      new File(['fixture-image'], 'garment.png', { type: 'image/png' })
    )
    expect(await screen.findByRole('button', { name: 'Use This Image' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Close capture modal' }))
    await user.click(screen.getByRole('button', { name: 'Keep editing' }))
    const retake = screen.getByRole('button', { name: 'Retake / Choose Another' })
    expect(retake).toHaveFocus()
    await act(async () => {
      preparation.resolve(preparedPhoto)
      await preparation.promise
    })
    expect(retake).toHaveFocus()
    expect(screen.getByRole('button', { name: 'Use This Image' })).toBeEnabled()
  })

  it('keeps the selected photo and restores crop focus until discard is confirmed', async () => {
    const user = userEvent.setup()
    const close = vi.fn()
    const upload = vi.fn()
    render(
      <GarmentCaptureModal isOpen confirmDiscard onClose={close} uploadGarment={upload} />
    )
    await chooseValidImage(user)

    const closeButton = screen.getByRole('button', { name: 'Close capture modal' })
    await user.click(closeButton)
    const keep = screen.getByRole('button', { name: 'Keep editing' })
    expect(keep).toHaveFocus()
    await user.click(keep)
    expect(screen.getByRole('button', { name: 'Use This Image' })).toHaveFocus()
    expect(close).not.toHaveBeenCalled()

    await user.click(closeButton)
    await user.keyboard('{Escape}')
    expect(screen.getByRole('button', { name: 'Use This Image' })).toHaveFocus()

    await user.click(closeButton)
    await user.click(screen.getByRole('button', { name: /^Discard$/ }))
    expect(close).toHaveBeenCalledOnce()
    expect(upload).not.toHaveBeenCalled()
  })

  it('switches aspect ratio and toggles background cleanup', async () => {
    const user = userEvent.setup()
    const uploadGarment = vi.fn().mockResolvedValue(mockCommittedGarment)
    render(<GarmentCaptureModal isOpen onClose={vi.fn()} uploadGarment={uploadGarment} />)
    await chooseValidImage(user)

    const cleanupToggle = screen.getByRole('switch', { name: 'Auto Background Cleanup' })
    expect(cleanupToggle).toHaveAttribute('aria-checked', 'true')

    await user.click(screen.getByRole('button', { name: '4:3 Portrait' }))
    await user.click(cleanupToggle)
    expect(cleanupToggle).toHaveAttribute('aria-checked', 'false')

    await user.click(screen.getByRole('button', { name: '1:1 Square' }))
    await user.click(screen.getByRole('button', { name: 'Use This Image' }))

    // Both crop choices have to reach the request, not just render.
    await waitFor(() =>
      expect(uploadGarment).toHaveBeenCalledWith(
        expect.objectContaining({ aspectRatio: '1:1', useBgCleanup: false })
      )
    )
  })

  it('waits for the newly selected crop before enabling upload', async () => {
    const user = userEvent.setup()
    const uploadGarment = vi.fn().mockResolvedValue(mockCommittedGarment)
    render(<GarmentCaptureModal isOpen onClose={vi.fn()} uploadGarment={uploadGarment} />)
    await chooseValidImage(user)

    const portrait = { ...preparedPhoto, heightPx: 532, sha256: 'portrait-checksum' }
    const preparation = Promise.withResolvers<wardrobe.PreparedImage>()
    vi.mocked(wardrobe.prepareGarmentImage).mockReturnValueOnce(preparation.promise)

    await user.click(screen.getByRole('button', { name: '4:3 Portrait' }))
    const confirm = screen.getByRole('button', { name: 'Use This Image' })
    expect(confirm).toBeDisabled()
    await user.click(confirm)
    expect(uploadGarment).not.toHaveBeenCalled()

    await act(async () => {
      preparation.resolve(portrait)
      await preparation.promise
    })
    await user.click(await readyCropButton())
    expect(uploadGarment).toHaveBeenCalledWith(
      expect.objectContaining({ aspectRatio: '4:3', prepared: portrait })
    )
  })

  it('keeps the preparation error when the selected crop ratio is tapped again', async () => {
    const user = userEvent.setup()
    const prepare = vi.mocked(wardrobe.prepareGarmentImage)
    prepare.mockRejectedValueOnce(
      new WardrobeRequestError('too small', 'IMAGE_TOO_SMALL')
    )
    render(<GarmentCaptureModal isOpen onClose={vi.fn()} />)
    await user.upload(
      screen.getByLabelText('Garment image file'),
      new File(['photo'], 'small.png', { type: 'image/png' })
    )
    const error = await screen.findByRole('alert')
    expect(error).toHaveTextContent('Choose an image at least 256 pixels wide and tall.')
    await user.click(screen.getByRole('button', { name: '1:1 Square' }))
    expect(screen.getByRole('alert')).toBe(error)
    expect(prepare).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: 'Use This Image' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: '4:3 Portrait' }))
    expect(await readyCropButton()).toBeEnabled()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('discards the crop and releases its preview when the parent closes the modal', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const { rerender } = render(<GarmentCaptureModal isOpen onClose={onClose} />)
    await chooseValidImage(user)
    const preview = screen.getByRole('img', { name: 'Garment preview' })
    expect(preview).toHaveAttribute('src', 'blob:prepared-photo')

    rerender(<GarmentCaptureModal isOpen={false} onClose={onClose} />)
    expect(revokePreviewUrl).toHaveBeenCalledWith('blob:prepared-photo')
    rerender(<GarmentCaptureModal isOpen onClose={onClose} />)

    expect(screen.getByLabelText('Garment image file')).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: 'Garment preview' })).not.toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('narrates each upload phase the client is waiting on', async () => {
    const user = userEvent.setup()
    const phases: string[] = []
    const uploadGarment = vi.fn(
      async (input: { onStateChange: (state: string) => void }) => {
        for (const phase of [
          'requesting_upload',
          'uploading',
          'verifying',
          'processing',
        ]) {
          input.onStateChange(phase)
          phases.push(phase)
          await new Promise((resolve) => setTimeout(resolve, 0))
        }
        return mockCommittedGarment
      }
    )
    render(
      <GarmentCaptureModal
        isOpen
        onClose={vi.fn()}
        uploadGarment={uploadGarment as never}
      />
    )
    await chooseValidImage(user)

    await user.click(screen.getByRole('button', { name: 'Use This Image' }))

    await screen.findByText('Piece added')
    // A silent progress bar gives the user nothing to judge a stall by.
    expect(phases).toEqual(['requesting_upload', 'uploading', 'verifying', 'processing'])
  })

  it('ignores upload progress and phase from the canceled photo while uploading another', async () => {
    const user = userEvent.setup()
    const oldUpload = Promise.withResolvers<GarmentItemContract>()
    const newUpload = Promise.withResolvers<GarmentItemContract>()
    const upload = vi
      .fn<typeof wardrobe.uploadGarmentImageFromWeb>()
      .mockReturnValueOnce(oldUpload.promise)
      .mockReturnValueOnce(newUpload.promise)
    const view = render(
      <GarmentCaptureModal isOpen onClose={vi.fn()} uploadGarment={upload} />
    )
    await chooseValidImage(user)
    await user.click(screen.getByRole('button', { name: 'Use This Image' }))
    view.rerender(
      <GarmentCaptureModal isOpen={false} onClose={vi.fn()} uploadGarment={upload} />
    )
    view.rerender(<GarmentCaptureModal isOpen onClose={vi.fn()} uploadGarment={upload} />)
    await chooseValidImage(user)
    await user.click(screen.getByRole('button', { name: 'Use This Image' }))
    const previous = upload.mock.calls[0]![0]
    const current = upload.mock.calls[1]![0]

    expect(previous.signal?.aborted).toBe(true)
    act(() => {
      current.onStateChange?.('uploading')
      current.onProgress?.(35)
      previous.onProgress?.(80)
      previous.onStateChange?.('verifying')
    })
    expect(screen.getByText('Saving your photo…', { exact: true })).toBeVisible()
    expect(screen.queryByText('Checking the upload…', { exact: true })).toBeNull()
    expect(screen.queryByText(/(?:35|80)%/)).toBeNull()
    await act(async () => {
      oldUpload.resolve(mockCommittedGarment)
      newUpload.resolve(mockCommittedGarment)
      await Promise.all([oldUpload.promise, newUpload.promise])
    })
    expect(screen.getByText('Piece added')).toBeVisible()
  })

  it('returns to the crop step with localized copy, never the raw error text, when the upload fails', async () => {
    const user = userEvent.setup()
    const uploadGarment = vi.fn().mockRejectedValue(new Error('storage unavailable'))
    render(<GarmentCaptureModal isOpen onClose={vi.fn()} uploadGarment={uploadGarment} />)
    await chooseValidImage(user)

    await user.click(screen.getByRole('button', { name: 'Use This Image' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(GENERIC_UPLOAD_FAILURE)
    expect(alert).not.toHaveTextContent('storage unavailable')
    // The chosen image survives, so a retry does not mean re-picking the file.
    expect(screen.getByRole('button', { name: 'Use This Image' })).toBeInTheDocument()
  })

  it('falls back to generic copy when the upload rejection is not an Error', async () => {
    const user = userEvent.setup()
    const uploadGarment = vi.fn().mockRejectedValue('socket hang up')
    render(<GarmentCaptureModal isOpen onClose={vi.fn()} uploadGarment={uploadGarment} />)
    await chooseValidImage(user)

    await user.click(screen.getByRole('button', { name: 'Use This Image' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Upload failed. Please try again.'
    )
  })

  // Learning path Step 58: Image uploads straight to storage.
  // See _bmad-output/project-knowledge/learning-path-step-by-step.md#image-uploads-straight-to-storage
  // Round 5 follow-up: every failure maps to a catalog key; raw error text never reaches the member.
  it.each([
    [
      'an upload fenced by an account change',
      new UploadSessionChangedError(),
      'You signed out or switched accounts during this upload. Choose the photo again.',
    ],
    [
      'a sign-in that lapsed before the upload',
      new WardrobeRequestError('raw sign-in text', 'SIGNED_OUT'),
      'Your session expired. Sign in again before adding a garment.',
    ],
    [
      'a photo too small to prepare',
      new WardrobeRequestError('raw size text', 'IMAGE_TOO_SMALL'),
      'Choose an image at least 256 pixels wide and tall.',
    ],
    [
      'a request that timed out',
      new WardrobeRequestError('raw timeout text', 'REQUEST_TIMEOUT'),
      'The upload timed out. Please try again.',
    ],
  ])('shows the catalog copy for %s', async (_case, failure, copy) => {
    const user = userEvent.setup()
    const uploadGarment = vi.fn().mockRejectedValue(failure)
    render(<GarmentCaptureModal isOpen onClose={vi.fn()} uploadGarment={uploadGarment} />)
    await chooseValidImage(user)

    await user.click(screen.getByRole('button', { name: 'Use This Image' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(copy)
    expect(alert).not.toHaveTextContent('raw')
  })

  it('renders every step and failure in the member language', async () => {
    const user = userEvent.setup()
    await act(async () => {
      await getI18n().changeLanguage('de-DE')
    })
    const uploadGarment = vi.fn().mockRejectedValue(new Error('storage unavailable'))
    render(<GarmentCaptureModal isOpen onClose={vi.fn()} uploadGarment={uploadGarment} />)

    expect(screen.getByText('Kleidungsstück erfassen')).toBeInTheDocument()
    await user.upload(
      screen.getByLabelText('Bilddatei des Kleidungsstücks'),
      new File(['fixture-image'], 'garment.png', { type: 'image/png' })
    )
    await user.click(await screen.findByRole('button', { name: 'Dieses Bild verwenden' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Der Upload ist fehlgeschlagen. Versuche es erneut.'
    )
    expect(
      screen.getByRole('switch', { name: 'Automatische Hintergrundbereinigung' })
    ).toBeInTheDocument()
  })

  it('discards an upload failure that lands after the modal was closed', async () => {
    const user = userEvent.setup()
    let failUpload: (reason: Error) => void = () => undefined
    const uploadGarment = vi.fn().mockReturnValue(
      new Promise<GarmentItemContract>((_resolve, reject) => {
        failUpload = reject
      })
    )
    const { rerender } = render(
      <GarmentCaptureModal isOpen onClose={vi.fn()} uploadGarment={uploadGarment} />
    )
    await chooseValidImage(user)
    await user.click(screen.getByRole('button', { name: 'Use This Image' }))
    await waitFor(() => expect(uploadGarment).toHaveBeenCalledOnce())

    rerender(
      <GarmentCaptureModal
        isOpen={false}
        onClose={vi.fn()}
        uploadGarment={uploadGarment}
      />
    )
    failUpload(new Error('late upload failure'))

    rerender(
      <GarmentCaptureModal isOpen onClose={vi.fn()} uploadGarment={uploadGarment} />
    )

    // Reopening must offer a clean capture flow, not an error about a request
    // the user already walked away from.
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
  })

  it('resets back to the source step from the retake action', async () => {
    const user = userEvent.setup()
    render(<GarmentCaptureModal isOpen onClose={vi.fn()} />)
    await chooseValidImage(user)

    await user.click(screen.getByRole('button', { name: 'Retake / Choose Another' }))

    expect(screen.getByRole('button', { name: 'Take Photo' })).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Use This Image' })
    ).not.toBeInTheDocument()
  })
})

describe('GarmentCaptureModal source step edge cases', () => {
  it('proxies the visible Choose File button to the hidden input', async () => {
    const user = userEvent.setup()
    const click = vi.spyOn(HTMLInputElement.prototype, 'click')
    render(<GarmentCaptureModal isOpen onClose={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'Choose File' }))

    // The real input is visually hidden, so the styled button is the only way in.
    expect(click).toHaveBeenCalled()
  })

  it('ignores a file picker the user dismissed', () => {
    const uploadGarment = vi.fn()
    render(<GarmentCaptureModal isOpen onClose={vi.fn()} uploadGarment={uploadGarment} />)

    fireEvent.change(screen.getByLabelText('Garment image file'))

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Use This Image' })
    ).not.toBeInTheDocument()
    expect(uploadGarment).not.toHaveBeenCalled()
  })

  it('stays on the source step when the file cannot be read as a data URL', async () => {
    class NonStringResultFileReader {
      onload: ((event: { target: { result: unknown } }) => void) | null = null
      readAsDataURL() {
        setTimeout(() => this.onload?.({ target: { result: new ArrayBuffer(8) } }), 0)
      }
    }
    vi.stubGlobal('FileReader', NonStringResultFileReader)
    globalRestorers.push(() => vi.unstubAllGlobals())

    const user = userEvent.setup()
    render(<GarmentCaptureModal isOpen onClose={vi.fn()} />)

    await user.upload(
      screen.getByLabelText('Garment image file'),
      new File(['fixture-image'], 'garment.png', { type: 'image/png' })
    )

    // Advancing to a crop step with no preview would render a broken image.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Take Photo' })).toBeInTheDocument()
    )
    expect(
      screen.queryByRole('button', { name: 'Use This Image' })
    ).not.toBeInTheDocument()
  })

  it('stops the camera without advancing when the canvas gives no drawing context', async () => {
    const user = userEvent.setup()
    const stop = vi.fn()
    installCameraMock(
      vi.fn().mockResolvedValue({ getTracks: () => [{ stop }] } as unknown as MediaStream)
    )
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)

    render(<GarmentCaptureModal isOpen onClose={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Take Photo' }))
    await user.click(await screen.findByRole('button', { name: 'Snap Photo' }))

    // No context means no image bytes; releasing the camera is still required.
    expect(stop).toHaveBeenCalledOnce()
    expect(
      screen.queryByRole('button', { name: 'Use This Image' })
    ).not.toBeInTheDocument()
  })
})

/**
 * Production follow-up 2026-11-19: Use This Image drives the real upload lib here, with only the
 * network and jsdom's missing image decoder and canvas stood in for. Tapping it again after a
 * failure is the member's retry of the same attempt: it resumes the attempt while the outcome is
 * ambiguous, and when the server has ended it, that same tap starts one fresh attempt.
 */
/**
 * Production follow-up 2026-11-19, review round 5 (C4-1): the photo, its preview and its upload
 * belong to the account signed in when the camera or picker opened. An account change drops
 * them, so nothing one account picked ever uploads under the next.
 */
describe('GarmentCaptureModal account epoch', () => {
  afterEach(() => {
    setUploadAttemptAccount(null)
    forgetAllUploadAttempts()
  })

  /** FileReader loads held until the test finishes them, so a switch can land mid-read. */
  function holdFileReads() {
    const pending: ((result?: string) => void)[] = []
    class HeldFileReader {
      onload: ((event: { target: { result: unknown } }) => void) | null = null
      readAsDataURL() {
        pending.push((result = 'data:image/png;base64,ZmFrZQ==') =>
          this.onload?.({ target: { result } })
        )
      }
    }
    vi.stubGlobal('FileReader', HeldFileReader)
    globalRestorers.push(() => vi.unstubAllGlobals())
    return {
      started: () => pending.length,
      finishAt: (index: number, result: string) =>
        act(() => pending.splice(index, 1)[0]?.(result)),
      finish: () =>
        act(() => {
          for (const load of pending.splice(0)) load()
        }),
    }
  }

  const garmentFile = () =>
    new File(['fixture-image'], 'garment.png', { type: 'image/png' })

  it('keeps the most recent selection when an older file finishes reading last', async () => {
    const user = userEvent.setup()
    const reads = holdFileReads()
    const prepare = vi.mocked(wardrobe.prepareGarmentImage)
    render(<GarmentCaptureModal isOpen onClose={vi.fn()} />)
    const picker = screen.getByLabelText('Garment image file')
    await user.upload(picker, garmentFile())
    await user.upload(picker, new File(['later'], 'latest.png', { type: 'image/png' }))

    const latest = 'data:image/png;base64,bGF0ZXI='
    reads.finishAt(1, latest)
    expect(await screen.findByRole('img', { name: 'Garment preview' })).toBeVisible()
    reads.finishAt(0, 'data:image/png;base64,ZmFrZQ==')
    expect(prepare).toHaveBeenCalledExactlyOnceWith(latest, '1:1', true, 'compact')
  })

  // Learning path Step 58: Image uploads straight to storage.
  // See _bmad-output/project-knowledge/learning-path-step-by-step.md#image-uploads-straight-to-storage
  it('drops a file the picker returns after the account changed', async () => {
    const user = userEvent.setup()
    const reads = holdFileReads()
    const uploadGarment = vi.fn()
    setUploadAttemptAccount('member-a')
    render(<GarmentCaptureModal isOpen onClose={vi.fn()} uploadGarment={uploadGarment} />)

    await user.click(screen.getByRole('button', { name: 'Choose File' }))
    act(() => setUploadAttemptAccount('member-b'))
    fireEvent.change(screen.getByLabelText('Garment image file'), {
      target: { files: [garmentFile()] },
    })
    reads.finish()

    expect(reads.started()).toBe(0)
    expect(
      screen.queryByRole('button', { name: 'Use This Image' })
    ).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Choose File' })).toBeInTheDocument()
    expect(uploadGarment).not.toHaveBeenCalled()
  })

  it('drops a file read that finishes after the account changed', async () => {
    const user = userEvent.setup()
    const reads = holdFileReads()
    const uploadGarment = vi.fn()
    setUploadAttemptAccount('member-a')
    render(<GarmentCaptureModal isOpen onClose={vi.fn()} uploadGarment={uploadGarment} />)

    await user.upload(screen.getByLabelText('Garment image file'), garmentFile())
    expect(reads.started()).toBe(1)
    act(() => setUploadAttemptAccount('member-b'))
    reads.finish()

    expect(
      screen.queryByRole('button', { name: 'Use This Image' })
    ).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Choose File' })).toBeInTheDocument()
    expect(uploadGarment).not.toHaveBeenCalled()
  })

  it("clears A's photo waiting on Use This Image, so a retry cannot upload it under B", async () => {
    const user = userEvent.setup()
    const uploadGarment = vi.fn().mockRejectedValue(new Error('storage unavailable'))
    setUploadAttemptAccount('member-a')
    render(<GarmentCaptureModal isOpen onClose={vi.fn()} uploadGarment={uploadGarment} />)
    await chooseValidImage(user)
    await user.click(screen.getByRole('button', { name: 'Use This Image' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(GENERIC_UPLOAD_FAILURE)

    act(() => setUploadAttemptAccount('member-b'))

    expect(
      screen.queryByRole('button', { name: 'Use This Image' })
    ).not.toBeInTheDocument()
    expect(screen.queryByAltText('Garment preview')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(uploadGarment).toHaveBeenCalledOnce()
    expect(uploadGarment).toHaveBeenCalledWith(
      expect.objectContaining({
        uploadSession: expect.objectContaining({ account: 'member-a' }) as unknown,
      })
    )
  })
})

describe('GarmentCaptureModal Use This Image retry through the real upload', () => {
  type Leg = 'allocate' | 'upload' | 'commit'
  const STAGING_URL = 'https://storage.test/staging/garment-session'
  const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

  const json = (status: number, body: unknown) => () =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      })
    )
  const allocated = json(200, {
    data: {
      garmentId: mockCommittedGarment.id,
      uploadSessionId: 'garment-session',
      uploadUrl: STAGING_URL,
      uploadToken: 'upload-token',
      requiredHeaders: { 'content-type': 'image/jpeg' },
      expiresAt: '2026-11-19T10:15:00.000Z',
    },
  })
  const stored = () => Promise.resolve(new Response(null, { status: 200 }))
  const networkDown = () => Promise.reject(new TypeError('Failed to fetch'))
  const committed = json(200, { data: mockCommittedGarment })

  afterEach(() => {
    vi.unstubAllGlobals()
    window.sessionStorage.clear()
    forgetAllUploadAttempts()
  })

  /**
   * Every prepared image encodes to the same bytes, as a re-encode of one photo does. The 2D
   * context carries its canvas and pixel access, which the default background cleanup reads.
   */
  function standInForImagePreparation() {
    class DecodedImage {
      naturalWidth = 640
      naturalHeight = 640
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      set src(_value: string) {
        queueMicrotask(() => this.onload?.())
      }
    }
    vi.stubGlobal('Image', DecodedImage as unknown as typeof Image)
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (
      this: HTMLCanvasElement
    ) {
      return {
        canvas: this,
        drawImage: vi.fn(),
        fillRect: vi.fn(),
        getImageData: (_x: number, _y: number, width: number, height: number) => ({
          data: new Uint8ClampedArray(width * height * 4),
        }),
        putImageData: vi.fn(),
      } as unknown as CanvasRenderingContext2D
    } as unknown as HTMLCanvasElement['getContext'])
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(
      (callback: BlobCallback, type?: string) => {
        callback(
          new NodeBlob(['same-garment-photo'], {
            type: type ?? 'image/jpeg',
          }) as unknown as Blob
        )
      }
    )
  }

  /** Answers each leg from its own queue and records the idempotency key of every call. */
  function installLegs(queues: Record<Leg, (() => Promise<Response>)[]>) {
    const keys: Record<Leg, (string | undefined)[]> = {
      allocate: [],
      upload: [],
      commit: [],
    }
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = input instanceof Request ? input.url : String(input)
        const leg: Leg | null = url.includes('/api/v1/wardrobe/upload-url')
          ? 'allocate'
          : url === STAGING_URL
            ? 'upload'
            : url.includes('/api/v1/wardrobe/garments')
              ? 'commit'
              : null
        if (!leg) return Promise.reject(new Error(`Unhandled fetch in test: ${url}`))
        keys[leg].push(
          (init?.headers as Record<string, string> | undefined)?.['idempotency-key']
        )
        const answer = queues[leg].shift()
        if (!answer) return Promise.reject(new Error(`No answer left for ${leg}`))
        return answer()
      })
    )
    return keys
  }

  async function renderWithRealUpload(user: ReturnType<typeof userEvent.setup>) {
    window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, 'test-access-token')
    standInForImagePreparation()
    const onGarmentCommitted = vi.fn()
    render(
      <GarmentCaptureModal
        isOpen
        onClose={vi.fn()}
        onGarmentCommitted={onGarmentCommitted}
      />
    )
    await chooseValidImage(user)
    return onGarmentCommitted
  }

  it('starts one fresh attempt in the same tap once the commit it resumed answers UPLOAD_SESSION_EXPIRED', async () => {
    const user = userEvent.setup()
    const keys = installLegs({
      allocate: [allocated, allocated],
      upload: [stored, stored],
      commit: [
        networkDown,
        json(409, {
          statusCode: 409,
          message: 'UPLOAD_SESSION_EXPIRED',
          error: 'Conflict',
        }),
        committed,
      ],
    })
    const onGarmentCommitted = await renderWithRealUpload(user)

    await user.click(screen.getByRole('button', { name: 'Use This Image' }))
    // A network fault reads as the generic retry copy, never the fetch layer's own text.
    const networkAlert = await screen.findByRole('alert')
    expect(networkAlert).toHaveTextContent(GENERIC_UPLOAD_FAILURE)
    expect(networkAlert).not.toHaveTextContent('interceptors')
    expect(keys.commit).toHaveLength(1)

    // One tap: it commits the open attempt again with its key, the server says the session
    // expired, and the same tap allocates, uploads and commits with fresh keys.
    await user.click(screen.getByRole('button', { name: 'Use This Image' }))

    expect(await screen.findByText('Piece added')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(onGarmentCommitted).toHaveBeenCalledOnce()
    expect(onGarmentCommitted).toHaveBeenCalledWith(
      expect.objectContaining({ id: mockCommittedGarment.id })
    )
    expect(keys.allocate).toHaveLength(2)
    expect(keys.allocate[1]).toMatch(UUID_V4)
    expect(keys.allocate[1]).not.toBe(keys.allocate[0])
    expect(keys.upload).toHaveLength(2)
    expect(keys.commit).toHaveLength(3)
    expect(keys.commit[0]).toMatch(UUID_V4)
    expect(keys.commit[1]).toBe(keys.commit[0])
    expect(keys.commit[2]).toMatch(UUID_V4)
    expect(keys.commit[2]).not.toBe(keys.commit[0])
  })

  it('keeps the attempt on the next tap after UPLOAD_IN_PROGRESS and commits it again with its key', async () => {
    const user = userEvent.setup()
    const keys = installLegs({
      allocate: [allocated],
      upload: [stored],
      commit: [
        json(409, { statusCode: 409, message: 'UPLOAD_IN_PROGRESS', error: 'Conflict' }),
        committed,
      ],
    })
    const onGarmentCommitted = await renderWithRealUpload(user)

    await user.click(screen.getByRole('button', { name: 'Use This Image' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This photo is still being saved. Try again in a moment.'
    )

    await user.click(screen.getByRole('button', { name: 'Use This Image' }))

    expect(await screen.findByText('Piece added')).toBeInTheDocument()
    expect(onGarmentCommitted).toHaveBeenCalledOnce()
    expect(keys.allocate).toHaveLength(1)
    expect(keys.upload).toHaveLength(1)
    expect(keys.commit).toHaveLength(2)
    expect(keys.commit[0]).toMatch(UUID_V4)
    expect(keys.commit[1]).toBe(keys.commit[0])
  })
})
