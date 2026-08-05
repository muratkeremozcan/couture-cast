// @vitest-environment jsdom
import React from 'react'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createReadyGarmentFixture,
  createSuggestGarmentTagsDataFixture,
} from '@couture/api-client/testing/wardrobe-fixtures'
import { GarmentTaggingModal } from './garment-tagging-modal'

const mockSuggestions = createSuggestGarmentTagsDataFixture({
  material: { confidence: 0.75 },
  comfortRange: { confidence: 0.9 },
})

const mockUpdatedGarment = createReadyGarmentFixture()

afterEach(() => {
  cleanup()
})

describe('GarmentTaggingModal Component', () => {
  it('renders modal dialog when open and loads suggestions', async () => {
    const suggestTagsFn = vi.fn().mockResolvedValue(mockSuggestions)
    render(
      <GarmentTaggingModal
        isOpen={true}
        onClose={vi.fn()}
        garmentId="garment-1"
        suggestTagsFn={suggestTagsFn}
      />
    )

    expect(screen.getByRole('dialog')).toBeDefined()
    expect(screen.getByText('Organize Garment Tags')).toBeDefined()

    await waitFor(() => {
      expect(suggestTagsFn).toHaveBeenCalledWith('garment-1', expect.any(AbortSignal))
    })
  })

  it('does not render when closed', () => {
    render(<GarmentTaggingModal isOpen={false} onClose={vi.fn()} garmentId="garment-1" />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('preselects confident AI suggestions and allows confirmation', async () => {
    const user = userEvent.setup()
    const suggestTagsFn = vi.fn().mockResolvedValue(mockSuggestions)
    const updateTagsFn = vi.fn().mockResolvedValue(mockUpdatedGarment)
    const onTagsConfirmed = vi.fn()

    render(
      <GarmentTaggingModal
        isOpen={true}
        onClose={vi.fn()}
        garmentId="garment-1"
        suggestTagsFn={suggestTagsFn}
        updateTagsFn={updateTagsFn}
        onTagsConfirmed={onTagsConfirmed}
      />
    )

    await waitFor(() => {
      expect(screen.getByRole('radio', { name: /Top/ })).toBeDefined()
    })

    const confirmBtn = screen.getByRole('button', { name: 'Confirm & Save Tags' })
    expect(confirmBtn).not.toHaveProperty('disabled', true)

    await user.click(confirmBtn)

    await waitFor(() => {
      expect(updateTagsFn).toHaveBeenCalledWith(
        'garment-1',
        {
          category: 'top',
          material: 'cotton',
          comfortRange: 'mild',
        },
        expect.anything()
      )
      expect(onTagsConfirmed).toHaveBeenCalledWith(mockUpdatedGarment)
    })
  })

  it('preserves fields touched while smart suggestions are loading', async () => {
    const user = userEvent.setup()
    let resolveSuggestions: (suggestions: typeof mockSuggestions) => void = () =>
      undefined
    const suggestTagsFn = vi.fn().mockReturnValue(
      new Promise<typeof mockSuggestions>((resolve) => {
        resolveSuggestions = resolve
      })
    )

    render(
      <GarmentTaggingModal
        isOpen={true}
        onClose={vi.fn()}
        garmentId="garment-1"
        suggestTagsFn={suggestTagsFn}
      />
    )

    const bottom = screen.getByRole('radio', { name: /Bottom/ })
    const cotton = screen.getByRole('radio', { name: 'Cotton' })
    const clearMaterial = screen.getByRole('radio', { name: 'Not sure / Clear' })
    const hot = screen.getByRole('radio', { name: /Hot/ })

    await user.click(bottom)
    await user.click(cotton)
    await user.click(clearMaterial)
    await user.click(hot)

    resolveSuggestions(mockSuggestions)

    await waitFor(() => {
      expect(screen.queryByText('Loading smart suggestions...')).toBeNull()
    })
    expect(bottom).toHaveAttribute('aria-checked', 'true')
    expect(clearMaterial).toHaveAttribute('aria-checked', 'true')
    expect(hot).toHaveAttribute('aria-checked', 'true')
  })
})
