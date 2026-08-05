import React from 'react'
import type * as ReactNativeModule from 'react-native'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import { MobileGarmentTaggingModal } from './garment-tagging-modal'
import {
  createReadyGarmentFixture,
  createSuggestGarmentTagsDataFixture,
} from '@couture/api-client/testing/wardrobe-fixtures'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('react-native', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactNativeModule>()
  return {
    ...actual,
    BackHandler: {
      addEventListener: vi.fn(() => ({ remove: vi.fn() })),
    },
    Modal: ({ children, visible }: { children: React.ReactNode; visible: boolean }) =>
      visible ? children : null,
  }
})

describe('MobileGarmentTaggingModal Component', () => {
  const originalConsoleWarn = console.warn.bind(console)
  const mockSuggestTagsFn = vi.fn().mockResolvedValue(
    createSuggestGarmentTagsDataFixture({
      garmentId: 'g_123',
      category: { confidence: 0.88 },
      material: { confidence: 0.75 },
    })
  )

  const mockUpdateTagsFn = vi
    .fn()
    .mockResolvedValue(createReadyGarmentFixture({ id: 'g_123' }))

  beforeEach(() => {
    vi.clearAllMocks()
    mockSuggestTagsFn.mockResolvedValue(
      createSuggestGarmentTagsDataFixture({
        garmentId: 'g_123',
        category: { confidence: 0.88 },
        material: { confidence: 0.75 },
      })
    )
    mockUpdateTagsFn.mockResolvedValue(createReadyGarmentFixture({ id: 'g_123' }))
    vi.spyOn(console, 'warn').mockImplementation((message) => {
      if (message === 'props.pointerEvents is deprecated. Use style.pointerEvents') {
        return
      }
      originalConsoleWarn(message)
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('fetches suggestions and pre-fills confident values when opened', async () => {
    const handleClose = vi.fn()
    const handleConfirmed = vi.fn()

    render(
      <MobileGarmentTaggingModal
        visible={true}
        onClose={handleClose}
        garmentId="g_123"
        accessToken="test_token"
        onTagsConfirmed={handleConfirmed}
        suggestTagsFn={mockSuggestTagsFn}
        updateTagsFn={mockUpdateTagsFn}
      />
    )

    expect(screen.getByText('wardrobe.tagging.title')).toBeDefined()

    await waitFor(() => {
      expect(mockSuggestTagsFn).toHaveBeenCalledWith(
        'test_token',
        'g_123',
        expect.any(AbortSignal)
      )
    })

    // Wait for the modal state to settle with selected category and comfort
    const confirmBtn = await screen.findByRole('button', {
      name: 'wardrobe.tagging.save',
    })
    await waitFor(() => {
      expect(confirmBtn.getAttribute('aria-disabled')).not.toBe('true')
    })

    fireEvent.click(confirmBtn)

    await waitFor(() => {
      expect(mockUpdateTagsFn).toHaveBeenCalledWith(
        'test_token',
        'g_123',
        {
          category: 'top',
          material: 'cotton',
          comfortRange: 'mild',
        },
        expect.any(AbortSignal)
      )
      expect(handleConfirmed).toHaveBeenCalled()
      expect(handleClose).toHaveBeenCalled()
    })
  })

  it('displays error message when suggestion API fails', async () => {
    const mockFailingSuggest = vi.fn().mockRejectedValue(new Error('Network error'))

    render(
      <MobileGarmentTaggingModal
        visible={true}
        onClose={vi.fn()}
        garmentId="g_err"
        accessToken="test_token"
        suggestTagsFn={mockFailingSuggest}
        updateTagsFn={mockUpdateTagsFn}
      />
    )

    await waitFor(() => {
      expect(screen.getByText('Network error')).toBeDefined()
    })
  })
})
