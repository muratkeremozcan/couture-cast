import React from 'react'
import type * as ReactNativeModule from 'react-native'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { AccessibilityInfo, Platform, findNodeHandle } from 'react-native'
import type {
  GarmentItemContract,
  OutfitCapsuleContract,
} from '@couture/api-client/contracts/http'

vi.mock('expo-localization', () => ({
  getLocales: () => [{ languageTag: 'en-US', languageCode: 'en', regionCode: 'US' }],
}))

/**
 * `Platform.OS` is redefined per test (the modal's focus management only runs
 * off web), so `Platform` has to be a plain object rather than the frozen
 * react-native-web export. `findNodeHandle` is mocked because the real
 * react-native-web implementation throws unconditionally.
 */
vi.mock('react-native', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactNativeModule>()
  return {
    ...actual,
    AccessibilityInfo: {
      ...actual.AccessibilityInfo,
      announceForAccessibility: vi.fn(),
      setAccessibilityFocus: vi.fn(),
    },
    findNodeHandle: vi.fn(),
    Platform: { ...actual.Platform, OS: 'web' },
  }
})

import i18n, { initI18n } from '@/src/lib/i18n'
import { MobileCapsuleBuilderModal } from './capsule-builder-modal'

function garment(
  id: string,
  category: string | null,
  comfortRange: string | null = 'mild'
): GarmentItemContract {
  return {
    id,
    status: 'ready',
    category,
    material: 'cotton',
    comfortRange,
    tagsConfirmedAt: '2026-08-05T10:00:00Z',
    fileSizeBytes: 1024,
    mimeType: 'image/jpeg',
    retentionStatus: 'active',
    createdAt: '2026-08-05T10:00:00Z',
    committedAt: '2026-08-05T10:00:00Z',
    imageAccess: null,
  } as unknown as GarmentItemContract
}

const garments = [
  garment('g-1', 'top'),
  garment('g-2', 'bottom'),
  garment('g-3', 'shoes'),
]

/** An awaiting-tags garment: the list has to stay usable before tagging. */
const untaggedGarment = garment('g-untagged', null, null)

function capsuleFixture(overrides: Record<string, unknown> = {}): OutfitCapsuleContract {
  return {
    id: 'cap-1',
    ownerUserId: 'user-1',
    name: 'Existing',
    description: 'Old description',
    occasions: ['work'],
    isFavorite: false,
    revision: 6,
    availabilityStatus: 'ready',
    unavailableGarmentCount: 0,
    garments: [
      { id: 'g-1', garmentOrder: 0 },
      { id: 'g-2', garmentOrder: 1 },
    ],
    createdAt: '2026-08-05T10:00:00Z',
    updatedAt: '2026-08-05T10:00:00Z',
    ...overrides,
  } as unknown as OutfitCapsuleContract
}

function renderModal(
  props: Partial<React.ComponentProps<typeof MobileCapsuleBuilderModal>> = {}
) {
  const onSave = vi.fn().mockResolvedValue(undefined)
  const onClose = vi.fn()
  render(
    <MobileCapsuleBuilderModal
      visible
      onClose={onClose}
      onSave={onSave}
      availableGarments={garments}
      {...props}
    />
  )
  return { onSave, onClose }
}

function selectGarments(ids: string[]) {
  for (const id of ids) {
    fireEvent.click(screen.getByTestId(`garment-checkbox-${id}`))
  }
}

describe('MobileCapsuleBuilderModal', () => {
  beforeAll(async () => {
    await initI18n()
    await i18n.changeLanguage('en-US')
  })

  afterEach(() => {
    Object.defineProperty(Platform, 'OS', { value: 'web', configurable: true })
  })

  it('4.3-MOB-MODAL-01 starts with nothing selected rather than auto-picking garments', () => {
    renderModal()
    expect(screen.getByText('Garments (0 of 10 selected)')).toBeInTheDocument()
  })

  it('4.3-MOB-MODAL-02 saves the user-selected garments in the displayed order', async () => {
    const { onSave } = renderModal()

    fireEvent.change(screen.getByTestId('capsule-name-input'), {
      target: { value: 'Work capsule' },
    })
    selectGarments(['g-1', 'g-2'])
    fireEvent.click(screen.getByTestId('save-capsule-button'))

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Work capsule',
          garmentIds: ['g-1', 'g-2'],
        }),
        expect.objectContaining({ idempotencyKey: expect.any(String) })
      )
    })
  })

  /**
   * Regression: mobile refused to deselect at exactly two garments, which made a
   * two-garment capsule permanently unrepairable. The web fix never reached here.
   */
  it('4.3-MOB-MODAL-03 allows deselecting a garment at the two-garment minimum', () => {
    renderModal()
    selectGarments(['g-1', 'g-2'])
    expect(screen.getByText('Garments (2 of 10 selected)')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('garment-checkbox-g-1'))

    expect(screen.getByText('Garments (1 of 10 selected)')).toBeInTheDocument()
  })

  it('4.3-MOB-MODAL-04 reports the minimum on submit instead of blocking selection', async () => {
    const { onSave } = renderModal()

    fireEvent.change(screen.getByTestId('capsule-name-input'), {
      target: { value: 'Too small' },
    })
    selectGarments(['g-1'])
    fireEvent.click(screen.getByTestId('save-capsule-button'))

    await waitFor(() => {
      expect(screen.getByText('Select 2 to 10 garments.')).toBeInTheDocument()
    })
    expect(onSave).not.toHaveBeenCalled()
  })

  it('4.3-MOB-MODAL-05 exposes reorder controls with disabled state at the boundaries', () => {
    renderModal()
    selectGarments(['g-1', 'g-2'])

    expect(screen.getByTestId('move-up-button-g-1')).toHaveAttribute(
      'aria-disabled',
      'true'
    )
    expect(screen.getByTestId('move-down-button-g-2')).toHaveAttribute(
      'aria-disabled',
      'true'
    )
  })

  it('4.3-MOB-MODAL-06 labels reorder controls so two garments of a category are distinguishable', () => {
    renderModal()
    selectGarments(['g-1', 'g-2'])

    expect(screen.getByTestId('move-down-button-g-1')).toHaveAttribute(
      'aria-label',
      'Move top, mild (position 1) down'
    )
  })

  /**
   * The component sets `accessibilityRole="checkbox"` and
   * `accessibilityState={{ checked }}`, which is what VoiceOver and TalkBack
   * consume. This suite renders through react-native-web, which maps the role
   * to the DOM but not the checked state, so the selection is asserted through
   * the user-visible indicator here and the native state is covered by the
   * on-device accessibility pass.
   */
  it('4.3-MOB-MODAL-07 exposes garment choices as checkboxes and reflects selection', () => {
    renderModal()
    const checkbox = screen.getByTestId('garment-checkbox-g-1')

    expect(checkbox).toHaveAttribute('role', 'checkbox')
    expect(checkbox.textContent ?? '').not.toContain('✓')

    fireEvent.click(checkbox)

    expect(screen.getByTestId('garment-checkbox-g-1').textContent ?? '').toContain('✓')
  })

  /** Validation and save errors must reach a screen reader. */
  it('4.3-MOB-MODAL-08 announces errors through an assertive live region', async () => {
    renderModal()
    fireEvent.click(screen.getByTestId('save-capsule-button'))

    await waitFor(() => {
      expect(screen.getByTestId('capsule-error-box')).toHaveAttribute(
        'aria-live',
        'assertive'
      )
    })
  })

  /** Regression: an emptied description silently kept its old value. */
  it('4.3-MOB-MODAL-09 sends null when the description is cleared, with the strong entity tag', async () => {
    const initialCapsule = {
      id: 'cap-1',
      ownerUserId: 'user-1',
      name: 'Existing',
      description: 'Old description',
      occasions: ['work'],
      isFavorite: false,
      revision: 6,
      availabilityStatus: 'ready',
      unavailableGarmentCount: 0,
      garments: [
        { id: 'g-1', garmentOrder: 0 },
        { id: 'g-2', garmentOrder: 1 },
      ],
      createdAt: '2026-08-05T10:00:00Z',
      updatedAt: '2026-08-05T10:00:00Z',
    } as unknown as OutfitCapsuleContract

    const { onSave } = renderModal({ initialCapsule })

    fireEvent.change(screen.getByTestId('capsule-desc-input'), { target: { value: '' } })
    fireEvent.click(screen.getByTestId('save-capsule-button'))

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({ description: null }),
        expect.objectContaining({ ifMatch: '"capsule:cap-1:6"' })
      )
    })
  })

  it('4.3-MOB-MODAL-10 shows repair guidance when constituent garments are unavailable', () => {
    const initialCapsule = {
      id: 'cap-1',
      ownerUserId: 'user-1',
      name: 'Broken',
      description: null,
      occasions: ['work'],
      isFavorite: false,
      revision: 2,
      availabilityStatus: 'needs_repair',
      unavailableGarmentCount: 2,
      garments: [{ id: 'g-1', garmentOrder: 0 }],
      createdAt: '2026-08-05T10:00:00Z',
      updatedAt: '2026-08-05T10:00:00Z',
    } as unknown as OutfitCapsuleContract

    renderModal({ initialCapsule })

    expect(screen.getByTestId('capsule-repair-banner')).toBeInTheDocument()
  })

  /** A retry must replay the original request, not create a second capsule. */
  it('4.3-MOB-MODAL-11 reuses one idempotency key across retries of the same form', async () => {
    const onSave = vi
      .fn()
      .mockRejectedValueOnce(new Error('network timeout'))
      .mockResolvedValueOnce(undefined)

    render(
      <MobileCapsuleBuilderModal
        visible
        onClose={vi.fn()}
        onSave={onSave}
        availableGarments={garments}
      />
    )

    fireEvent.change(screen.getByTestId('capsule-name-input'), {
      target: { value: 'Retried' },
    })
    selectGarments(['g-1', 'g-2'])

    fireEvent.click(screen.getByTestId('save-capsule-button'))
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    await waitFor(() =>
      expect(screen.getByTestId('capsule-error-box')).toBeInTheDocument()
    )

    fireEvent.click(screen.getByTestId('save-capsule-button'))
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2))

    expect(onSave.mock.calls[1]?.[1]?.idempotencyKey).toBe(
      onSave.mock.calls[0]?.[1]?.idempotencyKey
    )
  })

  it('4.3-MOB-MODAL-12 renders nothing while the sheet is closed', () => {
    renderModal({ visible: false })

    expect(
      screen.queryByTestId('mobile-capsule-builder-container')
    ).not.toBeInTheDocument()
  })

  /**
   * Older Android JS engines ship no `crypto.randomUUID`. Without the fallback the
   * key would be `undefined` and every retry would create a duplicate capsule.
   */
  it('4.3-MOB-MODAL-13 still mints an idempotency key without crypto.randomUUID', async () => {
    // Restored from the original descriptor: `crypto` is an own accessor on the
    // window, so deleting it would take it away from the whole worker.
    const realCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto')
    const cryptoWithoutRandomUuid = Object.create(globalThis.crypto) as Crypto
    Object.defineProperty(cryptoWithoutRandomUuid, 'randomUUID', {
      value: undefined,
      configurable: true,
    })
    Object.defineProperty(globalThis, 'crypto', {
      value: cryptoWithoutRandomUuid,
      configurable: true,
    })
    let onSave
    try {
      ;({ onSave } = renderModal())
    } finally {
      if (realCrypto) {
        Object.defineProperty(globalThis, 'crypto', realCrypto)
      }
    }

    fireEvent.change(screen.getByTestId('capsule-name-input'), {
      target: { value: 'Fallback key' },
    })
    selectGarments(['g-1', 'g-2'])
    fireEvent.click(screen.getByTestId('save-capsule-button'))

    await waitFor(() => expect(onSave).toHaveBeenCalled())
    expect(onSave.mock.calls[0]?.[1]?.idempotencyKey).toMatch(/^\d+-[0-9a-z]+$/)
  })

  /** A capsule with no occasion is unsavable, so the last chip cannot be cleared. */
  it('4.3-MOB-MODAL-14 blocks clearing the final occasion but allows swapping', () => {
    renderModal()

    fireEvent.click(screen.getByTestId('occasion-chip-work'))
    fireEvent.click(screen.getByTestId('occasion-chip-casual'))
    expect(screen.queryByTestId('capsule-error-box')).not.toBeInTheDocument()

    fireEvent.click(screen.getByTestId('occasion-chip-work'))

    expect(screen.getByText('Select at least one occasion.')).toBeInTheDocument()
  })

  it('4.3-MOB-MODAL-15 refuses an eleventh garment instead of silently dropping it', () => {
    const eleven = Array.from({ length: 11 }, (_, index) => garment(`m-${index}`, 'top'))
    renderModal({ availableGarments: eleven })

    selectGarments(eleven.slice(0, 10).map((g) => g.id))
    expect(screen.getByText('Garments (10 of 10 selected)')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('garment-checkbox-m-10'))

    expect(screen.getByText('Select 2 to 10 garments.')).toBeInTheDocument()
    expect(screen.getByText('Garments (10 of 10 selected)')).toBeInTheDocument()
  })

  it('4.3-MOB-MODAL-16 reorders garments and announces the new position', () => {
    renderModal()
    selectGarments(['g-1', 'g-2', 'g-3'])

    // Into the middle: the moved row is at neither boundary.
    fireEvent.click(screen.getByTestId('move-down-button-g-1'))
    expect(screen.getByTestId('reorder-row-g-1')).toHaveTextContent('2. top')
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith(
      'Moved top, mild (position 2) to position 2 of 3'
    )

    // Onto the first row, where the "move up" control it came from goes disabled.
    fireEvent.click(screen.getByTestId('move-up-button-g-1'))
    expect(screen.getByTestId('reorder-row-g-1')).toHaveTextContent('1. top')

    // Onto the last row, where the "move down" control goes disabled instead.
    fireEvent.click(screen.getByTestId('move-down-button-g-2'))
    expect(screen.getByTestId('reorder-row-g-2')).toHaveTextContent('3. bottom')
  })

  it('4.3-MOB-MODAL-16B leaves the order untouched at a disabled boundary control', () => {
    renderModal()
    selectGarments(['g-1', 'g-2'])

    fireEvent.click(screen.getByTestId('move-up-button-g-1'))

    expect(screen.getByTestId('reorder-row-g-1')).toHaveTextContent('1. top')
    expect(screen.getByTestId('reorder-row-g-2')).toHaveTextContent('2. bottom')
  })

  /** Server-side repair can strip every occasion; the form must say so on save. */
  it('4.3-MOB-MODAL-17 reports the occasion requirement for an edited capsule with none', async () => {
    const { onSave } = renderModal({
      initialCapsule: capsuleFixture({ occasions: [] }),
    })

    fireEvent.click(screen.getByTestId('save-capsule-button'))

    await waitFor(() => {
      expect(screen.getByText('Select at least one occasion.')).toBeInTheDocument()
    })
    expect(onSave).not.toHaveBeenCalled()
  })

  it('4.3-MOB-MODAL-18 sends a trimmed description when one is present', async () => {
    const { onSave } = renderModal({ initialCapsule: capsuleFixture() })

    fireEvent.change(screen.getByTestId('capsule-desc-input'), {
      target: { value: '  Layered for the office  ' },
    })
    fireEvent.click(screen.getByTestId('save-capsule-button'))

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({ description: 'Layered for the office' }),
        expect.anything()
      )
    })
  })

  /** A rejection that is not an Error still has to produce readable copy. */
  it('4.3-MOB-MODAL-19 falls back to the generic save error for a non-Error rejection', async () => {
    const onSave = vi.fn().mockRejectedValue('offline')
    render(
      <MobileCapsuleBuilderModal
        visible
        onClose={vi.fn()}
        onSave={onSave}
        availableGarments={garments}
      />
    )

    fireEvent.change(screen.getByTestId('capsule-name-input'), {
      target: { value: 'Rejected' },
    })
    selectGarments(['g-1', 'g-2'])
    fireEvent.click(screen.getByTestId('save-capsule-button'))

    await waitFor(() => {
      expect(screen.getByText('Unable to save the capsule.')).toBeInTheDocument()
    })
  })

  it('4.3-MOB-MODAL-20 uses singular repair copy for exactly one unavailable garment', () => {
    renderModal({
      initialCapsule: capsuleFixture({
        availabilityStatus: 'needs_repair',
        unavailableGarmentCount: 1,
      }),
    })

    expect(screen.getByTestId('capsule-repair-banner')).toHaveTextContent(
      '1 garment is no longer available'
    )
  })

  /**
   * A garment still awaiting tags has no category or comfort range, and a capsule
   * being repaired references garments that are gone from the wardrobe entirely.
   * Neither may render "undefined" to a screen reader.
   */
  it('4.3-MOB-MODAL-21 labels untagged and missing garments with readable fallbacks', () => {
    renderModal({
      availableGarments: [...garments, untaggedGarment],
      initialCapsule: capsuleFixture({
        garments: [
          { id: 'g-untagged', garmentOrder: 0 },
          { id: 'g-removed', garmentOrder: 1 },
        ],
      }),
    })

    expect(screen.getByTestId('garment-checkbox-g-untagged')).toHaveAttribute(
      'aria-label',
      'Garment mild'
    )
    expect(screen.getByTestId('reorder-row-g-removed')).toHaveTextContent('2. Garment')
    expect(screen.getByTestId('move-down-button-g-untagged')).toHaveAttribute(
      'aria-label',
      'Move garment (position 1) down'
    )
    expect(screen.getByTestId('move-up-button-g-removed')).toHaveAttribute(
      'aria-label',
      'Move Garment 2 up'
    )
  })

  it('4.3-MOB-MODAL-22 saves the capsule as a favorite once the toggle is on', async () => {
    const { onSave } = renderModal()

    fireEvent.change(screen.getByTestId('capsule-name-input'), {
      target: { value: 'Loved' },
    })
    selectGarments(['g-1', 'g-2'])
    fireEvent.click(screen.getByTestId('favorite-toggle'))
    expect(screen.getByTestId('favorite-toggle')).toHaveTextContent('★ Favorite Capsule')

    fireEvent.click(screen.getByTestId('save-capsule-button'))

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({ isFavorite: true }),
        expect.anything()
      )
    })
  })

  /**
   * VoiceOver/TalkBack focus management only runs off web. These cases are the
   * reason `Platform` is mocked as a mutable object in this file.
   */
  describe('native accessibility focus', () => {
    beforeEach(() => {
      Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true })
    })

    it('4.3-MOB-MODAL-23 moves accessibility focus to the heading when the sheet opens', () => {
      vi.mocked(findNodeHandle).mockReturnValue(42)

      renderModal()

      expect(AccessibilityInfo.setAccessibilityFocus).toHaveBeenCalledWith(42)
    })

    it('4.3-MOB-MODAL-24 skips focus when the heading has no native handle yet', () => {
      vi.mocked(findNodeHandle).mockReturnValue(null)

      renderModal()

      expect(AccessibilityInfo.setAccessibilityFocus).not.toHaveBeenCalled()
    })

    it('4.3-MOB-MODAL-25 returns focus to the invoking control after closing', () => {
      const { rerender } = render(
        <MobileCapsuleBuilderModal
          visible
          onClose={vi.fn()}
          onSave={vi.fn()}
          availableGarments={garments}
          invokingNodeHandle={99}
        />
      )
      vi.mocked(AccessibilityInfo.setAccessibilityFocus).mockClear()

      rerender(
        <MobileCapsuleBuilderModal
          visible={false}
          onClose={vi.fn()}
          onSave={vi.fn()}
          availableGarments={garments}
          invokingNodeHandle={99}
        />
      )

      expect(AccessibilityInfo.setAccessibilityFocus).toHaveBeenCalledWith(99)
    })

    /** Losing focus after a reorder strands a screen-reader user mid-list. */
    it('4.3-MOB-MODAL-26 keeps accessibility focus on a reorder control after a move', () => {
      vi.mocked(findNodeHandle).mockReturnValue(7)
      renderModal()
      selectGarments(['g-1', 'g-2'])
      vi.mocked(AccessibilityInfo.setAccessibilityFocus).mockClear()

      fireEvent.click(screen.getByTestId('move-up-button-g-2'))

      expect(AccessibilityInfo.setAccessibilityFocus).toHaveBeenCalledWith(7)
    })
  })
})
