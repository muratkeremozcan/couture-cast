// Story 4.1 Task 8 step 3 owner: unit-test web garment capture behavior
// @vitest-environment jsdom
import React from 'react'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
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
