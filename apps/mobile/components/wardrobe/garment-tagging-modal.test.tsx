// Learning path Step 30: Smart tagging and comfort metadata.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-30-smart-tagging-and-comfort-metadata
import React from 'react'
import type * as ReactNativeModule from 'react-native'
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import { AccessibilityInfo, findNodeHandle, Platform } from 'react-native'
import type { GarmentItemContract } from '@couture/api-client/contracts/http'
import { MobileGarmentTaggingModal } from './garment-tagging-modal'
import {
  createReadyGarmentFixture,
  createSuggestGarmentTagsDataFixture,
} from '@couture/api-client/testing/wardrobe-fixtures'

/**
 * `t` has to keep a stable identity across renders, exactly as real
 * react-i18next does: the component lists it in the suggestions effect's
 * dependency array, so a fresh function per render re-runs that effect on every
 * state change and refetches suggestions in a loop.
 */
const translate = vi.hoisted(() => (key: string) => key)
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: translate }),
}))

/** Held on a plain object so assertions never reference an unbound method. */
const backHandler = vi.hoisted(() => ({
  addEventListener: vi.fn(() => ({ remove: vi.fn() })),
}))

vi.mock('react-native', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactNativeModule>()
  return {
    ...actual,
    AccessibilityInfo: {
      ...actual.AccessibilityInfo,
      setAccessibilityFocus: vi.fn(),
    },
    BackHandler: backHandler,
    findNodeHandle: vi.fn(),
    Modal: ({ children, visible }: { children: React.ReactNode; visible: boolean }) =>
      visible ? children : null,
    Platform: { ...actual.Platform, OS: 'web' },
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
    Object.defineProperty(Platform, 'OS', { value: 'web', configurable: true })
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('does not schedule native accessibility focus in the web renderer', () => {
    vi.useFakeTimers()

    render(
      <MobileGarmentTaggingModal
        visible={true}
        onClose={vi.fn()}
        garmentId={null}
        accessToken="test_token"
      />
    )

    act(() => {
      vi.advanceTimersByTime(150)
    })

    expect(findNodeHandle).not.toHaveBeenCalled()
  })

  it('focuses the modal title after the native accessibility delay', () => {
    vi.useFakeTimers()
    Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true })
    vi.mocked(findNodeHandle).mockReturnValue(42)

    render(
      <MobileGarmentTaggingModal
        visible={true}
        onClose={vi.fn()}
        garmentId={null}
        accessToken="test_token"
      />
    )

    act(() => {
      vi.advanceTimersByTime(150)
    })

    expect(findNodeHandle).toHaveBeenCalledOnce()
    expect(AccessibilityInfo.setAccessibilityFocus).toHaveBeenCalledWith(42)
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

  it('does not fetch suggestions or capture the back button while closed', () => {
    render(
      <MobileGarmentTaggingModal
        visible={false}
        onClose={vi.fn()}
        garmentId="g_123"
        accessToken="test_token"
        suggestTagsFn={mockSuggestTagsFn}
        updateTagsFn={mockUpdateTagsFn}
      />
    )

    expect(screen.queryByTestId('garment-tagging-modal')).not.toBeInTheDocument()
    expect(mockSuggestTagsFn).not.toHaveBeenCalled()
    expect(backHandler.addEventListener).not.toHaveBeenCalled()
  })

  it('skips native accessibility focus when the title has no handle yet', () => {
    vi.useFakeTimers()
    Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true })
    vi.mocked(findNodeHandle).mockReturnValue(null)

    render(
      <MobileGarmentTaggingModal
        visible={true}
        onClose={vi.fn()}
        garmentId={null}
        accessToken="test_token"
      />
    )

    act(() => {
      vi.advanceTimersByTime(150)
    })

    expect(AccessibilityInfo.setAccessibilityFocus).not.toHaveBeenCalled()
  })

  /** Closing the sheet must hand focus back, or the reader lands at the page top. */
  it('restores accessibility focus to the invoking control on close', () => {
    Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true })

    const withoutInvoker = render(
      <MobileGarmentTaggingModal
        visible={true}
        onClose={vi.fn()}
        garmentId={null}
        accessToken="test_token"
      />
    )
    withoutInvoker.unmount()
    expect(AccessibilityInfo.setAccessibilityFocus).not.toHaveBeenCalled()

    const withInvoker = render(
      <MobileGarmentTaggingModal
        visible={true}
        onClose={vi.fn()}
        garmentId={null}
        accessToken="test_token"
        invokingNodeHandle={55}
      />
    )
    withInvoker.unmount()

    expect(AccessibilityInfo.setAccessibilityFocus).toHaveBeenCalledWith(55)
  })

  /**
   * A low-confidence suggestion is shown but never pre-selected: silently
   * accepting a guess is how a garment ends up mis-tagged without the user
   * ever seeing the choice.
   */
  it('shows low-confidence suggestions without pre-selecting them', async () => {
    mockSuggestTagsFn.mockResolvedValue(
      createSuggestGarmentTagsDataFixture({
        garmentId: 'g_123',
        category: { confidence: 0.31, isConfident: false },
        material: { confidence: 0.28, isConfident: false },
        comfortRange: { confidence: 0.3, isConfident: false },
      })
    )

    render(
      <MobileGarmentTaggingModal
        visible={true}
        onClose={vi.fn()}
        garmentId="g_123"
        accessToken="test_token"
        suggestTagsFn={mockSuggestTagsFn}
        updateTagsFn={mockUpdateTagsFn}
      />
    )

    await waitFor(() => {
      expect(
        screen.getAllByText('wardrobe.tagging.low_confidence_suggested')
      ).toHaveLength(3)
    })
    expect(screen.getByTestId('garment-tagging-save')).toHaveAttribute(
      'aria-disabled',
      'true'
    )
  })

  /** Analysis still running: there is nothing to tag yet, so hide the form. */
  it('hides the tagging form while the garment analysis is still pending', async () => {
    const pendingError = Object.assign(new Error('still analysing'), {
      code: 'GARMENT_ANALYSIS_PENDING',
    })
    const mockPendingSuggest = vi.fn().mockRejectedValue(pendingError)

    render(
      <MobileGarmentTaggingModal
        visible={true}
        onClose={vi.fn()}
        garmentId="g_123"
        accessToken="test_token"
        suggestTagsFn={mockPendingSuggest}
        updateTagsFn={mockUpdateTagsFn}
      />
    )

    await waitFor(() => {
      expect(screen.getByText('wardrobe.tagging.pending_analysis')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('garment-tag-category-top')).not.toBeInTheDocument()
    expect(screen.queryByTestId('garment-tagging-save')).not.toBeInTheDocument()
  })

  it('offers a retry when the tagging inference service is unavailable', async () => {
    const mockUnavailableSuggest = vi
      .fn()
      .mockRejectedValueOnce(
        Object.assign(new Error('inference down'), {
          code: 'TAGGING_INFERENCE_UNAVAILABLE',
        })
      )
      .mockResolvedValueOnce(createSuggestGarmentTagsDataFixture({ garmentId: 'g_123' }))

    render(
      <MobileGarmentTaggingModal
        visible={true}
        onClose={vi.fn()}
        garmentId="g_123"
        accessToken="test_token"
        suggestTagsFn={mockUnavailableSuggest}
        updateTagsFn={mockUpdateTagsFn}
      />
    )

    await waitFor(() => {
      expect(
        screen.getByText('wardrobe.tagging.inference_unavailable')
      ).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('wardrobe.tagging.retry'))

    await waitFor(() => {
      expect(mockUnavailableSuggest).toHaveBeenCalledTimes(2)
      expect(
        screen.queryByText('wardrobe.tagging.inference_unavailable')
      ).not.toBeInTheDocument()
    })
  })

  it.each([
    ['a rejection that is not an Error', undefined],
    ['an error carrying a non-string code', Object.assign(new Error(''), { code: 42 })],
  ])('falls back to the generic load failure for %s', async (_label, rejection) => {
    const mockOddSuggest = vi.fn().mockRejectedValue(rejection)

    render(
      <MobileGarmentTaggingModal
        visible={true}
        onClose={vi.fn()}
        garmentId="g_123"
        accessToken="test_token"
        suggestTagsFn={mockOddSuggest}
        updateTagsFn={mockUpdateTagsFn}
      />
    )

    await waitFor(() => {
      expect(screen.getByText('wardrobe.tagging.load_failed')).toBeInTheDocument()
    })
  })

  it('surfaces a failed tag save inline and keeps the form open', async () => {
    mockUpdateTagsFn.mockRejectedValue(new Error('Tag service unavailable'))
    const handleClose = vi.fn()

    render(
      <MobileGarmentTaggingModal
        visible={true}
        onClose={handleClose}
        garmentId="g_123"
        accessToken="test_token"
        suggestTagsFn={mockSuggestTagsFn}
        updateTagsFn={mockUpdateTagsFn}
      />
    )

    const saveButton = await screen.findByTestId('garment-tagging-save')
    await waitFor(() => {
      expect(saveButton.getAttribute('aria-disabled')).not.toBe('true')
    })
    fireEvent.click(saveButton)

    await waitFor(() => {
      expect(screen.getByText('Tag service unavailable')).toBeInTheDocument()
    })
    expect(handleClose).not.toHaveBeenCalled()
  })

  it('falls back to generic save copy when the save rejects with a non-Error', async () => {
    mockUpdateTagsFn.mockRejectedValue('socket hang up')

    render(
      <MobileGarmentTaggingModal
        visible={true}
        onClose={vi.fn()}
        garmentId="g_123"
        accessToken="test_token"
        suggestTagsFn={mockSuggestTagsFn}
        updateTagsFn={mockUpdateTagsFn}
      />
    )

    const saveButton = await screen.findByTestId('garment-tagging-save')
    await waitFor(() => {
      expect(saveButton.getAttribute('aria-disabled')).not.toBe('true')
    })
    fireEvent.click(saveButton)

    await waitFor(() => {
      expect(screen.getByText('wardrobe.tagging.save_failed')).toBeInTheDocument()
    })
  })

  /**
   * Regression guard: a slow save that lands after the user moved to a different
   * garment must not confirm tags for, or close, the garment now on screen.
   */
  it('ignores a save that resolves after the modal moved to another garment', async () => {
    let resolveUpdate: ((garment: GarmentItemContract) => void) | undefined
    const deferredUpdate = vi.fn(
      () =>
        new Promise<GarmentItemContract>((resolve) => {
          resolveUpdate = resolve
        })
    )
    const handleClose = vi.fn()
    const handleConfirmed = vi.fn()

    const view = render(
      <MobileGarmentTaggingModal
        visible={true}
        onClose={handleClose}
        garmentId="g_123"
        accessToken="test_token"
        onTagsConfirmed={handleConfirmed}
        suggestTagsFn={mockSuggestTagsFn}
        updateTagsFn={deferredUpdate}
      />
    )

    const saveButton = await screen.findByTestId('garment-tagging-save')
    await waitFor(() => {
      expect(saveButton.getAttribute('aria-disabled')).not.toBe('true')
    })
    fireEvent.click(saveButton)
    await waitFor(() => expect(deferredUpdate).toHaveBeenCalled())

    view.rerender(
      <MobileGarmentTaggingModal
        visible={true}
        onClose={handleClose}
        garmentId="g_456"
        accessToken="test_token"
        onTagsConfirmed={handleConfirmed}
        suggestTagsFn={mockSuggestTagsFn}
        updateTagsFn={deferredUpdate}
      />
    )
    resolveUpdate?.(createReadyGarmentFixture({ id: 'g_123' }))

    await waitFor(() => {
      expect(mockSuggestTagsFn).toHaveBeenCalledWith(
        'test_token',
        'g_456',
        expect.any(AbortSignal)
      )
    })
    expect(handleConfirmed).not.toHaveBeenCalled()
    expect(handleClose).not.toHaveBeenCalled()
  })
})
