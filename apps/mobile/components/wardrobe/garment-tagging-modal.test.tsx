// Learning path Step 30: Smart tagging and comfort metadata.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-30-smart-tagging-and-comfort-metadata
// Learning path Step 58: Hosted wardrobe workers and manual tagging.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#hosted-wardrobe-workers-and-manual-tagging
// Learning path Step 68: Five-tab navigation and back pattern.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-68-five-tab-navigation-and-back-pattern
// Story CC-7.11 test owner (TEA): [Codex 7.11 #3], 7.11-NAT-032: the tagging header is the
// layer's swipe handle, through the same close as its X.
// Test design: _bmad-output/test-artifacts/test-design-7-11-five-tab-navigation-back-pattern.md.
// Learning path Step 76: Garment subtypes.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-76-garment-subtypes
import React from 'react'
import type * as ReactNativeModule from 'react-native'
import type * as EdgeToEdgeTestUtils from '@/src/test-utils/edge-to-edge-modal'
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import { AccessibilityInfo, findNodeHandle, Platform } from 'react-native'
import type { GarmentItemContract } from '@couture/api-client/contracts/http'
import { MobileGarmentTaggingModal } from './garment-tagging-modal'
import { dragFrom } from '@/src/test-utils/layer-swipe'
import { LAYER_SWIPE_CLOSE_PX } from '@/components/edge-to-edge-modal'
import {
  EDGE_TO_EDGE_MODAL_PROPS,
  TEST_SAFE_AREA_INSETS,
  lastModalProps,
  paddingBottomOf,
  liveFontMarkerPlacement,
} from '@/src/test-utils/edge-to-edge-modal'
import {
  createManualSuggestGarmentTagsDataFixture,
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
  useTranslation: () => ({ t: translate, i18n: { language: 'en-US' } }),
}))

/** Held on a plain object so assertions never reference an unbound method. */
const backHandler = vi.hoisted(() => ({
  addEventListener: vi.fn((_event: string, _listener: () => boolean) => ({
    remove: vi.fn(),
  })),
}))

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
    BackHandler: backHandler,
    findNodeHandle: vi.fn(),
    Modal: recordModalProps(
      ({ children, visible }: { children: React.ReactNode; visible: boolean }) =>
        visible ? children : null
    ),
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

  it('answers hardware Back on a native OS and leaves the web stub alone', () => {
    const onClose = vi.fn()
    const webSheet = render(
      <MobileGarmentTaggingModal
        visible={true}
        onClose={onClose}
        garmentId={null}
        accessToken="test_token"
      />
    )
    expect(backHandler.addEventListener).not.toHaveBeenCalled()
    webSheet.unmount()

    Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true })
    const remove = vi.fn()
    let onBack: (() => boolean) | undefined
    backHandler.addEventListener.mockImplementationOnce(
      (_event: string, listener: () => boolean) => {
        onBack = listener
        return { remove }
      }
    )
    const nativeSheet = render(
      <MobileGarmentTaggingModal
        visible={true}
        onClose={onClose}
        garmentId={null}
        accessToken="test_token"
      />
    )
    expect(backHandler.addEventListener).toHaveBeenCalledWith(
      'hardwareBackPress',
      expect.any(Function)
    )
    expect(onBack?.()).toBe(true)
    expect(onClose).toHaveBeenCalledTimes(1)
    nativeSheet.unmount()
    expect(remove).toHaveBeenCalledTimes(1)
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

    // Pending: the title is neutral until suggestions are in hand.
    expect(screen.getByText('wardrobe.tagging.pending_title')).toBeDefined()
    expect(screen.queryByText('wardrobe.tagging.title')).toBeNull()

    await waitFor(() => {
      expect(mockSuggestTagsFn).toHaveBeenCalledWith(
        'test_token',
        'g_123',
        expect.any(AbortSignal)
      )
    })

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

  it('[Codex 7.11 #3] [7.11-NAT-032] a swipe down on the header closes the sheet like its X and saves nothing', async () => {
    const onClose = vi.fn()
    render(
      <MobileGarmentTaggingModal
        visible={true}
        onClose={onClose}
        garmentId="g_123"
        accessToken="test_token"
        suggestTagsFn={mockSuggestTagsFn}
        updateTagsFn={mockUpdateTagsFn}
      />
    )
    await waitFor(() => expect(mockSuggestTagsFn).toHaveBeenCalledTimes(1))
    const handle = screen.getByTestId('layer-swipe-handle')
    expect(handle.contains(screen.getByTestId('garment-tagging-close'))).toBe(true)

    await dragFrom(handle, { dy: LAYER_SWIPE_CLOSE_PX / 2 })
    expect(onClose).not.toHaveBeenCalled()
    await dragFrom(handle, { dy: LAYER_SWIPE_CLOSE_PX + 40 })
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(mockUpdateTagsFn).not.toHaveBeenCalled()
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

describe('R52 MobileGarmentTaggingModal over the system bars', () => {
  // Story 6.15 review P3-1: iOS hides every view outside the accessibility modal view from the
  // XCUITest hierarchy, so the modal's live-font marker must sit inside it.
  it('puts the live-font marker inside the sheet that is the accessibility modal', () => {
    render(
      <MobileGarmentTaggingModal
        visible={true}
        onClose={vi.fn()}
        garmentId={null}
        accessToken="test_token"
      />
    )
    expect(liveFontMarkerPlacement().markerInside).toBe(true)
  })

  it('covers the status and navigation bars and keeps the sheet above the gesture bar', () => {
    render(
      <MobileGarmentTaggingModal
        visible={true}
        onClose={vi.fn()}
        garmentId={null}
        accessToken="test_token"
      />
    )
    expect(lastModalProps()).toMatchObject({
      ...EDGE_TO_EDGE_MODAL_PROPS,
      transparent: true,
      visible: true,
    })
    expect(paddingBottomOf(screen.getByTestId('garment-tagging-modal'))).toBe(
      20 + TEST_SAFE_AREA_INSETS.bottom
    )
  })
})

describe('MobileGarmentTaggingModal manual mode', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  function renderManual(
    overrides: Pick<
      React.ComponentProps<typeof MobileGarmentTaggingModal>,
      'initialGarment' | 'updateTagsFn'
    > = {}
  ) {
    const suggestTagsFn = vi
      .fn()
      .mockResolvedValue(
        createManualSuggestGarmentTagsDataFixture({ garmentId: 'g_123' })
      )
    render(
      <MobileGarmentTaggingModal
        visible={true}
        onClose={vi.fn()}
        garmentId="g_123"
        initialGarment={overrides.initialGarment}
        accessToken="test_token"
        suggestTagsFn={suggestTagsFn}
        updateTagsFn={
          overrides.updateTagsFn ??
          vi.fn().mockResolvedValue(createReadyGarmentFixture({ id: 'g_123' }))
        }
      />
    )
    return { suggestTagsFn }
  }

  it('says the member chooses the tags and shows no spinner and no suggestion text once the API answers manual', async () => {
    renderManual()

    expect(await screen.findByTestId('garment-tagging-manual-notice')).toBeDefined()
    expect(screen.getByText('wardrobe.tagging.manual_title')).toBeDefined()
    expect(screen.getAllByText('wardrobe.tagging.manual_desc')).toHaveLength(1)
    expect(screen.queryByText('wardrobe.tagging.title')).toBeNull()
    expect(screen.queryByLabelText('wardrobe.tagging.loading')).toBeNull()
    expect(screen.queryByText(/ai_suggested|low_confidence_suggested/)).toBeNull()
    expect(screen.queryByText('wardrobe.tagging.retry')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('[7.19-CLOSET] starts unset, resets the subtype on category change, and saves the new subtype', async () => {
    const updateTagsFn = vi
      .fn()
      .mockResolvedValue(createReadyGarmentFixture({ id: 'g_123' }))
    renderManual({ updateTagsFn })
    await screen.findByTestId('garment-tagging-manual-notice')

    const save = screen.getByRole('button', { name: 'wardrobe.tagging.save' })
    expect(save.getAttribute('aria-disabled')).toBe('true')

    expect(screen.queryByTestId('garment-tagging-subtype-picker')).toBeNull()
    fireEvent.click(screen.getByTestId('garment-tag-category-top'))
    const camisole = screen.getByTestId('garment-tagging-subtype-camisole')
    fireEvent.click(camisole)
    expect(camisole).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(screen.getByTestId('garment-tag-category-outerwear'))
    expect(screen.getByTestId('garment-tagging-subtype-none')).toHaveAttribute(
      'aria-checked',
      'true'
    )
    expect(screen.queryByTestId('garment-tagging-subtype-camisole')).toBeNull()
    fireEvent.click(screen.getByTestId('garment-tagging-subtype-blazer'))
    fireEvent.click(screen.getByTestId('garment-tag-comfort-cool'))
    await waitFor(() => {
      expect(save.getAttribute('aria-disabled')).not.toBe('true')
    })
    fireEvent.click(save)

    await waitFor(() => {
      expect(updateTagsFn).toHaveBeenCalledWith(
        'test_token',
        'g_123',
        {
          category: 'outerwear',
          material: null,
          comfortRange: 'cool',
          subtype: 'blazer',
        },
        expect.any(AbortSignal)
      )
    })
  })

  it.each([
    {
      behavior: 'omits a stored subtype that the member left untouched',
      clear: false,
      expectedSubtype: {},
    },
    {
      behavior: 'sends null when the member chooses None',
      clear: true,
      expectedSubtype: { subtype: null },
    },
  ])('[7.19-CLOSET] $behavior', async ({ clear, expectedSubtype }) => {
    const updateTagsFn = vi
      .fn()
      .mockResolvedValue(createReadyGarmentFixture({ id: 'g_123' }))
    renderManual({
      updateTagsFn,
      initialGarment: { id: 'g_123', category: 'top', subtype: 'camisole' },
    })
    await screen.findByTestId('garment-tagging-manual-notice')
    expect(screen.getByTestId('garment-tagging-subtype-camisole')).toHaveAttribute(
      'aria-checked',
      'true'
    )
    if (clear) fireEvent.click(screen.getByTestId('garment-tagging-subtype-none'))
    fireEvent.click(screen.getByTestId('garment-tag-comfort-cool'))
    fireEvent.click(screen.getByTestId('garment-tagging-save'))

    await waitFor(() =>
      expect(updateTagsFn).toHaveBeenCalledExactlyOnceWith(
        'test_token',
        'g_123',
        { category: 'top', material: null, comfortRange: 'cool', ...expectedSubtype },
        expect.any(AbortSignal)
      )
    )
  })
})

describe('MobileGarmentTaggingModal while the mode is pending (the response is held)', () => {
  afterEach(() => {
    Object.defineProperty(Platform, 'OS', { value: 'web', configurable: true })
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  function held() {
    let resolve: (data: unknown) => void = () => undefined
    const suggestTagsFn = vi.fn().mockReturnValue(
      new Promise((settle) => {
        resolve = settle
      })
    )
    return { suggestTagsFn, resolve: (data: unknown) => resolve(data) }
  }

  type SuggestTagsFn = React.ComponentProps<
    typeof MobileGarmentTaggingModal
  >['suggestTagsFn']

  function renderHeld(suggestTagsFn: SuggestTagsFn) {
    return render(
      <MobileGarmentTaggingModal
        visible={true}
        onClose={vi.fn()}
        garmentId="g_123"
        accessToken="test_token"
        suggestTagsFn={suggestTagsFn}
        updateTagsFn={vi.fn()}
      />
    )
  }

  it('shows neutral copy and a labelled spinner until the answer, then the manual copy and no spinner', async () => {
    const { suggestTagsFn, resolve } = held()
    renderHeld(suggestTagsFn)

    expect(screen.getByText('wardrobe.tagging.pending_title')).toBeDefined()
    expect(screen.getByLabelText('wardrobe.tagging.loading')).toBeDefined()
    expect(screen.queryByText('wardrobe.tagging.title')).toBeNull()
    expect(screen.queryByText('wardrobe.tagging.manual_title')).toBeNull()
    expect(screen.queryByTestId('garment-tagging-manual-notice')).toBeNull()

    await act(async () => {
      resolve(createManualSuggestGarmentTagsDataFixture({ garmentId: 'g_123' }))
      await Promise.resolve()
    })

    expect(await screen.findByTestId('garment-tagging-manual-notice')).toBeDefined()
    expect(screen.getByText('wardrobe.tagging.manual_title')).toBeDefined()
    expect(screen.queryByText('wardrobe.tagging.pending_title')).toBeNull()
    expect(screen.queryByText('wardrobe.tagging.title')).toBeNull()
    expect(screen.queryByLabelText('wardrobe.tagging.loading')).toBeNull()
  })

  it('takes the suggestion title only when suggestions arrive', async () => {
    const { suggestTagsFn, resolve } = held()
    renderHeld(suggestTagsFn)
    expect(screen.queryByText('wardrobe.tagging.title')).toBeNull()

    await act(async () => {
      resolve(createSuggestGarmentTagsDataFixture({ garmentId: 'g_123' }))
      await Promise.resolve()
    })

    expect(await screen.findByText('wardrobe.tagging.title')).toBeDefined()
    expect(screen.queryByText('wardrobe.tagging.pending_title')).toBeNull()
  })

  it('does not move accessibility focus to the title until the mode is known', async () => {
    vi.useFakeTimers()
    Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true })
    vi.mocked(findNodeHandle).mockReturnValue(42)
    vi.mocked(AccessibilityInfo.setAccessibilityFocus).mockClear()
    const { suggestTagsFn, resolve } = held()
    renderHeld(suggestTagsFn)

    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(AccessibilityInfo.setAccessibilityFocus).not.toHaveBeenCalled()

    await act(async () => {
      resolve(createManualSuggestGarmentTagsDataFixture({ garmentId: 'g_123' }))
      await Promise.resolve()
    })
    act(() => {
      vi.advanceTimersByTime(150)
    })

    expect(AccessibilityInfo.setAccessibilityFocus).toHaveBeenCalledTimes(1)
    expect(AccessibilityInfo.setAccessibilityFocus).toHaveBeenCalledWith(42)
  })

  it('keeps the close control on the neutral label in every state', async () => {
    const { suggestTagsFn, resolve } = held()
    renderHeld(suggestTagsFn)
    expect(screen.getByLabelText('wardrobe.tagging.close')).toBeDefined()

    await act(async () => {
      resolve(createManualSuggestGarmentTagsDataFixture({ garmentId: 'g_123' }))
      await Promise.resolve()
    })
    await screen.findByTestId('garment-tagging-manual-notice')
    expect(screen.getByLabelText('wardrobe.tagging.close')).toBeDefined()
  })
})
