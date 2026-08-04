// Story 4.1 Task 8 step 3 owner: unit-test web garment capture modal dialog rendering and close interaction
// @vitest-environment jsdom
import React from 'react'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { describe, expect, it, vi, afterEach } from 'vitest'
import { GarmentCaptureModal } from './garment-capture-modal'

describe('GarmentCaptureModal Component', () => {
  afterEach(() => {
    cleanup()
  })

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

  it('calls onClose when close button clicked', () => {
    const handleClose = vi.fn()
    render(<GarmentCaptureModal isOpen={true} onClose={handleClose} />)
    const closeBtn = screen.getByLabelText('Close capture modal')
    fireEvent.click(closeBtn)
    expect(handleClose).toHaveBeenCalledOnce()
  })
})
