import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { I18nextProvider } from 'react-i18next'
import { CapsuleBuilderModal } from './capsule-builder-modal'
import { getI18n } from '../../i18n'
import type {
  GarmentItemContract,
  OutfitCapsuleContract,
} from '@couture/api-client/contracts/http'

function garment(
  id: string,
  category: string,
  comfortRange = 'mild'
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

const mockGarments: GarmentItemContract[] = [
  garment('g-1', 'top'),
  garment('g-2', 'bottom'),
  garment('g-3', 'shoes'),
]

function renderModal(
  props: Partial<React.ComponentProps<typeof CapsuleBuilderModal>> = {}
) {
  const onSave = vi.fn().mockResolvedValue(undefined)
  const onClose = vi.fn()
  render(
    <I18nextProvider i18n={getI18n()}>
      <CapsuleBuilderModal
        isOpen
        onClose={onClose}
        onSave={onSave}
        ownerUserId="user-1"
        availableGarments={mockGarments}
        {...props}
      />
    </I18nextProvider>
  )
  return { onSave, onClose }
}

function selectGarments(ids: string[]) {
  for (const id of ids) {
    fireEvent.click(screen.getByTestId(`garment-select-checkbox-${id}`))
  }
}

describe('CapsuleBuilderModal', () => {
  it('4.3-WEB-MODAL-01 renders the create title and name field', () => {
    renderModal()
    expect(screen.getByText('Create capsule')).toBeInTheDocument()
    expect(screen.getByTestId('capsule-name-input')).toBeInTheDocument()
  })

  /** Nothing is pre-selected; the user chooses their own garments. */
  it('4.3-WEB-MODAL-02 starts with no garments selected', () => {
    renderModal()
    expect(screen.getByTestId('capsule-selection-count')).toHaveTextContent(
      '0 of 10 selected'
    )
  })

  it('4.3-WEB-MODAL-03 reorders garments with the move controls and saves the displayed order', async () => {
    const { onSave } = renderModal()

    fireEvent.change(screen.getByTestId('capsule-name-input'), {
      target: { value: 'My Capsule' },
    })
    selectGarments(['g-1', 'g-2'])

    fireEvent.click(screen.getByTestId('move-down-button-g-1'))
    fireEvent.click(screen.getByTestId('save-capsule-button'))

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'My Capsule', garmentIds: ['g-2', 'g-1'] }),
        expect.objectContaining({ idempotencyKey: expect.any(String) as string })
      )
    })
  })

  /**
   * Regression: focus was restored onto the control that had just become
   * disabled at the boundary, which is a no-op that drops the user on <body>.
   */
  it('4.3-WEB-MODAL-04 keeps focus on a usable reorder control after moving to a boundary', () => {
    renderModal()
    selectGarments(['g-1', 'g-2'])

    fireEvent.click(screen.getByTestId('move-up-button-g-2'))

    // g-2 is now first, so its Move up is disabled; focus lands on Move down.
    expect(screen.getByTestId('move-up-button-g-2')).toBeDisabled()
    expect(document.activeElement).toBe(screen.getByTestId('move-down-button-g-2'))
  })

  it('4.3-WEB-MODAL-05 announces the move politely with a distinguishable label', () => {
    renderModal()
    selectGarments(['g-1', 'g-2'])

    fireEvent.click(screen.getByTestId('move-down-button-g-1'))

    expect(
      screen.getByText(/Moved top, mild \(position 2\) to position 2 of 2/)
    ).toBeInTheDocument()
  })

  /** Regression: an emptied description silently kept its old value. */
  it('4.3-WEB-MODAL-06 sends null when the description is cleared', async () => {
    const initialCapsule = {
      id: 'cap-1',
      ownerUserId: 'user-1',
      name: 'Existing',
      description: 'Old description',
      occasions: ['work'],
      isFavorite: false,
      revision: 4,
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
        expect.objectContaining({ ifMatch: '"capsule:cap-1:4"' })
      )
    })
  })

  /** A capsule needing repair must tell the user why and what to do. */
  it('4.3-WEB-MODAL-07 shows a repair banner when garments are unavailable', () => {
    const initialCapsule = {
      id: 'cap-1',
      ownerUserId: 'user-1',
      name: 'Broken',
      description: null,
      occasions: ['work'],
      isFavorite: false,
      revision: 2,
      availabilityStatus: 'needs_repair',
      unavailableGarmentCount: 1,
      garments: [{ id: 'g-1', garmentOrder: 0 }],
      createdAt: '2026-08-05T10:00:00Z',
      updatedAt: '2026-08-05T10:00:00Z',
    } as unknown as OutfitCapsuleContract

    renderModal({ initialCapsule })

    expect(screen.getByTestId('capsule-repair-banner')).toHaveTextContent(
      '1 garment is no longer available'
    )
  })

  it('4.3-WEB-MODAL-08 blocks submission below the two-garment minimum', async () => {
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

  /** The user may freely deselect; the constraint is reported, not enforced by lockout. */
  it('4.3-WEB-MODAL-09 allows deselecting a garment at the minimum', () => {
    renderModal()
    selectGarments(['g-1', 'g-2'])
    expect(screen.getByTestId('capsule-selection-count')).toHaveTextContent(
      '2 of 10 selected'
    )

    fireEvent.click(screen.getByTestId('garment-select-checkbox-g-1'))

    expect(screen.getByTestId('capsule-selection-count')).toHaveTextContent(
      '1 of 10 selected'
    )
  })

  /**
   * Regression: a fresh key per attempt meant a retry after a timeout created a
   * second capsule. The key is minted once per open form.
   */
  it('4.3-WEB-MODAL-10 reuses one idempotency key across retries of the same form', async () => {
    const onSave = vi
      .fn<React.ComponentProps<typeof CapsuleBuilderModal>['onSave']>()
      .mockRejectedValueOnce(new Error('network timeout'))
      .mockResolvedValueOnce(undefined)

    render(
      <I18nextProvider i18n={getI18n()}>
        <CapsuleBuilderModal
          isOpen
          onClose={vi.fn()}
          onSave={onSave}
          ownerUserId="user-1"
          availableGarments={mockGarments}
        />
      </I18nextProvider>
    )

    fireEvent.change(screen.getByTestId('capsule-name-input'), {
      target: { value: 'Retried' },
    })
    selectGarments(['g-1', 'g-2'])

    fireEvent.click(screen.getByTestId('save-capsule-button'))
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))

    fireEvent.click(screen.getByTestId('save-capsule-button'))
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2))

    const firstKey = onSave.mock.calls[0]?.[1].idempotencyKey
    const secondKey = onSave.mock.calls[1]?.[1].idempotencyKey
    expect(firstKey).toBeTruthy()
    expect(secondKey).toBe(firstKey)
  })

  it('4.3-WEB-MODAL-11 offers a reload affordance when the precondition is stale', async () => {
    const onStaleCapsule = vi.fn()
    const onSave = vi.fn().mockRejectedValue(new Error('CAPSULE_REVISION_MISMATCH'))

    render(
      <I18nextProvider i18n={getI18n()}>
        <CapsuleBuilderModal
          isOpen
          onClose={vi.fn()}
          onSave={onSave}
          ownerUserId="user-1"
          availableGarments={mockGarments}
          onStaleCapsule={onStaleCapsule}
        />
      </I18nextProvider>
    )

    fireEvent.change(screen.getByTestId('capsule-name-input'), {
      target: { value: 'Stale' },
    })
    selectGarments(['g-1', 'g-2'])
    fireEvent.click(screen.getByTestId('save-capsule-button'))

    await waitFor(() => {
      expect(screen.getByTestId('capsule-reload-button')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('capsule-reload-button'))
    expect(onStaleCapsule).toHaveBeenCalled()
  })
})
