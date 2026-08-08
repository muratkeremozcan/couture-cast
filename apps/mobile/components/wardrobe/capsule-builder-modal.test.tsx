import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type {
  GarmentItemContract,
  OutfitCapsuleContract,
} from '@couture/api-client/contracts/http'

vi.mock('expo-localization', () => ({
  getLocales: () => [{ languageTag: 'en-US', languageCode: 'en', regionCode: 'US' }],
}))
import i18n, { initI18n } from '@/src/lib/i18n'
import { MobileCapsuleBuilderModal } from './capsule-builder-modal'

function garment(id: string, category: string): GarmentItemContract {
  return {
    id,
    status: 'ready',
    category,
    material: 'cotton',
    comfortRange: 'mild',
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
})
