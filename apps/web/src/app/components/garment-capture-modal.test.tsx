// Learning path Step 29: Garment capture flow.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-29-garment-capture-flow
// Story 4.1 Task 8 step 3 owner: unit-test web garment capture behavior
// @vitest-environment jsdom
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GarmentItemContract } from '@couture/api-client/contracts/http'
import { GarmentCaptureModal } from './garment-capture-modal'

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

afterEach(() => {
  for (const restore of globalRestorers.splice(0).reverse()) {
    restore()
  }
  cleanup()
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
    expect(screen.getByText('Garment Capture Flow')).toBeDefined()
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

  it('reports completion after confirming and uploading photo', async () => {
    const user = userEvent.setup()
    const onGarmentCommitted = vi.fn()
    const uploadGarment = vi.fn().mockResolvedValue(mockCommittedGarment)

    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D)
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(
      'data:image/png;base64,sample'
    )

    render(
      <GarmentCaptureModal
        isOpen={true}
        onClose={vi.fn()}
        uploadGarment={uploadGarment}
        onGarmentCommitted={onGarmentCommitted}
      />
    )

    expect(screen.queryByText('Garment Upload Complete!')).toBeNull()

    const stop = vi.fn()
    const stream = { getTracks: () => [{ stop }] } as unknown as MediaStream
    installCameraMock(vi.fn().mockResolvedValue(stream))

    await user.click(screen.getByRole('button', { name: 'Take Photo' }))
    await screen.findByRole('button', { name: 'Snap Photo' })
    await user.click(screen.getByRole('button', { name: 'Snap Photo' }))

    await user.click(await screen.findByRole('button', { name: 'Use This Image' }))

    await waitFor(() => {
      expect(screen.getByText('Garment Upload Complete!')).toBeDefined()
    })
    expect(uploadGarment).toHaveBeenCalledOnce()
    expect(onGarmentCommitted).toHaveBeenCalledWith(mockCommittedGarment)
  })
})

/** Uploads a valid image through the file picker and lands on the crop step. */
async function chooseValidImage(user: ReturnType<typeof userEvent.setup>) {
  await user.upload(
    screen.getByLabelText('Garment image file'),
    new File(['fixture-image'], 'garment.png', { type: 'image/png' })
  )
  await screen.findByRole('button', { name: 'Use This Image' })
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

    await screen.findByText('Garment Upload Complete!')
    // A silent progress bar gives the user nothing to judge a stall by.
    expect(phases).toEqual(['requesting_upload', 'uploading', 'verifying', 'processing'])
  })

  it('returns to the crop step with the reason when the upload fails', async () => {
    const user = userEvent.setup()
    const uploadGarment = vi.fn().mockRejectedValue(new Error('storage unavailable'))
    render(<GarmentCaptureModal isOpen onClose={vi.fn()} uploadGarment={uploadGarment} />)
    await chooseValidImage(user)

    await user.click(screen.getByRole('button', { name: 'Use This Image' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('storage unavailable')
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
