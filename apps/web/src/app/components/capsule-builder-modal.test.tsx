// Learning path Step 31: Outfit capsule builder.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-31-outfit-capsule-builder
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

    /*
     * The save button is disabled while a submission is in flight. Waiting on
     * the call count alone only proves onSave was entered, not that the
     * rejection was handled and isSubmitting was reset, so under load the
     * retry click landed on a disabled button and was swallowed. Wait on the
     * observable state the retry actually depends on.
     */
    await waitFor(() =>
      expect(screen.getByTestId('save-capsule-button')).not.toBeDisabled()
    )

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

function garmentWithNulls(id: string): GarmentItemContract {
  return {
    ...garment(id, 'top'),
    category: null,
    comfortRange: null,
  } as unknown as GarmentItemContract
}

describe('CapsuleBuilderModal occasion selection', () => {
  it('4.3-WEB-MODAL-12 adds and removes occasions but never drops the last one', () => {
    renderModal()

    fireEvent.click(screen.getByTestId('occasion-checkbox-work'))
    expect(screen.getByTestId('occasion-checkbox-work')).toBeChecked()

    fireEvent.click(screen.getByTestId('occasion-checkbox-casual'))
    expect(screen.getByTestId('occasion-checkbox-casual')).not.toBeChecked()

    // A capsule with no occasion cannot be matched to anything, so the last
    // one is held rather than silently allowed and rejected at save time.
    fireEvent.click(screen.getByTestId('occasion-checkbox-work'))
    expect(screen.getByText('Select at least one occasion.')).toBeInTheDocument()
    expect(screen.getByTestId('occasion-checkbox-work')).toBeChecked()
  })

  it('4.3-WEB-MODAL-13 blocks a submit for a capsule loaded with no occasions', async () => {
    const initialCapsule = {
      id: 'cap-1',
      ownerUserId: 'user-1',
      name: 'Occasionless',
      description: null,
      occasions: [],
      isFavorite: false,
      revision: 1,
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
    fireEvent.click(screen.getByTestId('save-capsule-button'))

    await waitFor(() =>
      expect(screen.getByText('Select at least one occasion.')).toBeInTheDocument()
    )
    expect(onSave).not.toHaveBeenCalled()
  })
})

describe('CapsuleBuilderModal selection limits', () => {
  it('4.3-WEB-MODAL-14 refuses an eleventh garment and says why', () => {
    const manyGarments = Array.from({ length: 11 }, (_, index) =>
      garment(`g-many-${index}`, 'top')
    )
    renderModal({ availableGarments: manyGarments })

    for (let index = 0; index < 10; index += 1) {
      fireEvent.click(screen.getByTestId(`garment-select-checkbox-g-many-${index}`))
    }
    expect(screen.getByTestId('capsule-selection-count')).toHaveTextContent(
      '10 of 10 selected'
    )

    fireEvent.click(screen.getByTestId('garment-select-checkbox-g-many-10'))

    expect(screen.getByText('Select 2 to 10 garments.')).toBeInTheDocument()
    expect(screen.getByTestId('capsule-selection-count')).toHaveTextContent(
      '10 of 10 selected'
    )
  })

  it('4.3-WEB-MODAL-15 rejects a name that is only whitespace', async () => {
    const { onSave } = renderModal()
    // `required` already blocks an empty field, so whitespace is the shape that
    // actually reaches the trim check.
    fireEvent.change(screen.getByTestId('capsule-name-input'), {
      target: { value: '   ' },
    })
    selectGarments(['g-1', 'g-2'])

    fireEvent.click(screen.getByTestId('save-capsule-button'))

    await waitFor(() =>
      expect(screen.getByText('Enter a capsule name.')).toBeInTheDocument()
    )
    expect(onSave).not.toHaveBeenCalled()
  })

  it('4.3-WEB-MODAL-16 saves the favorite flag and the trimmed description', async () => {
    const { onSave } = renderModal()

    fireEvent.change(screen.getByTestId('capsule-name-input'), {
      target: { value: 'Starred' },
    })
    fireEvent.change(screen.getByTestId('capsule-desc-input'), {
      target: { value: '  Layered for cool mornings  ' },
    })
    selectGarments(['g-1', 'g-2'])
    fireEvent.click(screen.getByTestId('capsule-favorite-checkbox'))
    fireEvent.click(screen.getByTestId('save-capsule-button'))

    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          isFavorite: true,
          description: 'Layered for cool mornings',
        }),
        expect.anything()
      )
    )
  })
})

describe('CapsuleBuilderModal labels and lifecycle', () => {
  it('4.3-WEB-MODAL-17 labels an untagged garment without leaving the row nameless', () => {
    renderModal({
      availableGarments: [garmentWithNulls('g-untagged'), garment('g-2', 'bottom')],
    })

    selectGarments(['g-untagged'])

    // An untagged garment still needs a distinguishable label for a screen
    // reader driving the reorder controls.
    expect(screen.getByTestId('ordered-garment-item-g-untagged')).toHaveTextContent(
      '1. Garment'
    )
    expect(screen.getByTestId('move-up-button-g-untagged')).toHaveAccessibleName(
      'Move garment (position 1) up'
    )
  })

  it('4.3-WEB-MODAL-18 still labels a seeded garment that is no longer in the wardrobe', () => {
    const initialCapsule = {
      id: 'cap-1',
      ownerUserId: 'user-1',
      name: 'Partly purged',
      description: null,
      occasions: ['work'],
      isFavorite: false,
      revision: 1,
      availabilityStatus: 'needs_repair',
      unavailableGarmentCount: 3,
      garments: [
        { id: 'g-1', garmentOrder: 0 },
        { id: 'g-gone', garmentOrder: 1 },
      ],
      createdAt: '2026-08-05T10:00:00Z',
      updatedAt: '2026-08-05T10:00:00Z',
    } as unknown as OutfitCapsuleContract

    renderModal({ initialCapsule })

    expect(screen.getByTestId('move-up-button-g-gone')).toHaveAccessibleName(
      'Move Garment 2 up'
    )
    expect(screen.getByTestId('capsule-repair-banner')).toHaveTextContent(
      '3 garments are no longer available'
    )
  })

  it('4.3-WEB-MODAL-19 keeps focus on the moved row when its control stays usable', () => {
    renderModal()
    selectGarments(['g-1', 'g-2', 'g-3'])

    fireEvent.click(screen.getByTestId('move-down-button-g-1'))

    // g-1 sits in the middle now, so its own Move down is still enabled and is
    // the natural place for focus to stay.
    expect(screen.getByTestId('move-down-button-g-1')).toBeEnabled()
    expect(document.activeElement).toBe(screen.getByTestId('move-down-button-g-1'))
  })

  it('4.3-WEB-MODAL-20 renders nothing until it is opened, then starts from defaults', () => {
    const { rerender } = render(
      <I18nextProvider i18n={getI18n()}>
        <CapsuleBuilderModal
          isOpen={false}
          onClose={vi.fn()}
          onSave={vi.fn().mockResolvedValue(undefined)}
          ownerUserId="user-1"
          availableGarments={mockGarments}
        />
      </I18nextProvider>
    )

    expect(screen.queryByTestId('capsule-builder-form')).not.toBeInTheDocument()

    rerender(
      <I18nextProvider i18n={getI18n()}>
        <CapsuleBuilderModal
          isOpen
          onClose={vi.fn()}
          onSave={vi.fn().mockResolvedValue(undefined)}
          ownerUserId="user-1"
          availableGarments={mockGarments}
        />
      </I18nextProvider>
    )

    expect(screen.getByTestId('capsule-name-input')).toHaveValue('')
    expect(screen.getByTestId('occasion-checkbox-casual')).toBeChecked()
  })

  it('4.3-WEB-MODAL-21 falls back to translated copy when the save rejects with a non-Error', async () => {
    const onSave = vi
      .fn<React.ComponentProps<typeof CapsuleBuilderModal>['onSave']>()
      .mockRejectedValue('socket hang up')

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
      target: { value: 'Unlucky' },
    })
    selectGarments(['g-1', 'g-2'])
    fireEvent.click(screen.getByTestId('save-capsule-button'))

    await waitFor(() =>
      expect(screen.getByText('Unable to save the capsule.')).toBeInTheDocument()
    )
    // A failed save has to hand the button back so the user can retry.
    await waitFor(() =>
      expect(screen.getByTestId('save-capsule-button')).not.toBeDisabled()
    )
  })
})
