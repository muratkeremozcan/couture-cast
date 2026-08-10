// @vitest-environment jsdom
import React from 'react'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GarmentItemContract } from '@couture/api-client/contracts/http'
import {
  createReadyGarmentFixture,
  createSuggestGarmentTagsDataFixture,
} from '@couture/api-client/testing/wardrobe-fixtures'
import { WardrobeRequestError } from '../../lib/wardrobe'
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

const lowConfidenceSuggestions = createSuggestGarmentTagsDataFixture({
  category: { confidence: 0.2, isConfident: false },
  material: { confidence: 0.2, isConfident: false },
  comfortRange: { confidence: 0.2, isConfident: false },
})

function renderModal(
  props: Partial<React.ComponentProps<typeof GarmentTaggingModal>> = {}
) {
  const onClose = vi.fn()
  const onTagsConfirmed = vi.fn()
  const view = render(
    <GarmentTaggingModal
      isOpen
      onClose={onClose}
      garmentId="garment-1"
      onTagsConfirmed={onTagsConfirmed}
      suggestTagsFn={vi.fn().mockResolvedValue(mockSuggestions)}
      {...props}
    />
  )
  return { ...view, onClose, onTagsConfirmed }
}

/** The confident fixture preselects every field, which is the loaded state. */
async function waitForConfidentPreselection() {
  await waitFor(() =>
    expect(screen.getByRole('radio', { name: /Top/ })).toHaveAttribute(
      'aria-checked',
      'true'
    )
  )
}

describe('GarmentTaggingModal degraded suggestion paths', () => {
  it('withholds the form while garment analysis is still pending', async () => {
    renderModal({
      suggestTagsFn: vi
        .fn()
        .mockRejectedValue(
          new WardrobeRequestError('analysis pending', 'GARMENT_ANALYSIS_PENDING')
        ),
    })

    expect(
      await screen.findByText('Garment analysis is still pending. Please retry shortly.')
    ).toBeInTheDocument()
    // Tags saved against an unanalyzed garment are rejected server-side, so the
    // form is withheld entirely rather than offered and then refused.
    expect(screen.queryByRole('radio', { name: /Top/ })).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Retry smart suggestions' })
    ).toBeInTheDocument()
  })

  it('keeps manual tagging available when inference is unavailable', async () => {
    renderModal({
      suggestTagsFn: vi
        .fn()
        .mockRejectedValue(
          new WardrobeRequestError('inference down', 'TAGGING_INFERENCE_UNAVAILABLE')
        ),
    })

    expect(
      await screen.findByText(
        'Smart suggestion inference is unavailable. Please select tags manually.'
      )
    ).toBeInTheDocument()
    // A degraded inference dependency must not block the core tagging ritual.
    expect(screen.getByRole('radio', { name: /Top/ })).toBeInTheDocument()
  })

  it('surfaces the transport reason for an unclassified suggestion failure', async () => {
    renderModal({
      suggestTagsFn: vi.fn().mockRejectedValue(new Error('gateway timeout')),
    })

    expect(await screen.findByText('gateway timeout')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /Top/ })).toBeInTheDocument()
  })

  it('falls back to generic copy when the suggestion rejection has no message', async () => {
    renderModal({ suggestTagsFn: vi.fn().mockRejectedValue(new Error('')) })

    expect(
      await screen.findByText('Unable to load smart suggestions.')
    ).toBeInTheDocument()
  })

  it('names the failure even when the rejection is not an Error', async () => {
    renderModal({ suggestTagsFn: vi.fn().mockRejectedValue('ECONNRESET') })

    expect(await screen.findByText('Suggestion unavailable')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /Top/ })).toBeInTheDocument()
  })

  it('reloads suggestions when the user retries', async () => {
    const user = userEvent.setup()
    const suggestTagsFn = vi
      .fn()
      .mockRejectedValueOnce(new Error('gateway timeout'))
      .mockResolvedValueOnce(mockSuggestions)
    renderModal({ suggestTagsFn })

    await screen.findByText('gateway timeout')
    await user.click(screen.getByRole('button', { name: 'Retry smart suggestions' }))

    await waitFor(() =>
      expect(screen.queryByText('gateway timeout')).not.toBeInTheDocument()
    )
    expect(screen.getByRole('radio', { name: /Top/ })).toHaveAttribute(
      'aria-checked',
      'true'
    )
  })

  it('labels low-confidence suggestions as needing review and preselects nothing', async () => {
    renderModal({ suggestTagsFn: vi.fn().mockResolvedValue(lowConfidenceSuggestions) })

    await waitFor(() =>
      expect(screen.getAllByText(/Needs review suggested:/)).toHaveLength(3)
    )
    // An unconfident guess is shown but never applied on the user's behalf.
    expect(screen.getByRole('radio', { name: /Top/ })).toHaveAttribute(
      'aria-checked',
      'false'
    )
    expect(screen.getByRole('button', { name: 'Confirm & Save Tags' })).toBeDisabled()
  })

  it('ignores a stale suggestion response after the user moves to another garment', async () => {
    let settleStale: (data: typeof mockSuggestions) => void = () => undefined
    const suggestTagsFn = vi
      .fn()
      .mockReturnValueOnce(
        new Promise<typeof mockSuggestions>((resolve) => {
          settleStale = resolve
        })
      )
      .mockResolvedValueOnce(
        createSuggestGarmentTagsDataFixture({
          category: { value: 'dress' },
          material: { value: 'wool' },
          comfortRange: { value: 'cold' },
        })
      )

    const { rerender, onClose } = renderModal({ garmentId: 'garment-1', suggestTagsFn })
    rerender(
      <GarmentTaggingModal
        isOpen
        onClose={onClose}
        garmentId="garment-2"
        suggestTagsFn={suggestTagsFn}
      />
    )

    const dress = await screen.findByRole('radio', { name: /Dress/ })
    await waitFor(() => expect(dress).toHaveAttribute('aria-checked', 'true'))

    await act(async () => {
      settleStale(mockSuggestions)
      await Promise.resolve()
    })

    // The abandoned garment's answer must not silently retag the current one.
    expect(dress).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('radio', { name: /Top/ })).toHaveAttribute(
      'aria-checked',
      'false'
    )
  })

  it('ignores a stale suggestion failure after the user moves to another garment', async () => {
    let failStale: (reason: Error) => void = () => undefined
    const suggestTagsFn = vi
      .fn()
      .mockReturnValueOnce(
        new Promise<typeof mockSuggestions>((_resolve, reject) => {
          failStale = reject
        })
      )
      .mockResolvedValueOnce(mockSuggestions)

    const { rerender, onClose } = renderModal({ garmentId: 'garment-1', suggestTagsFn })
    rerender(
      <GarmentTaggingModal
        isOpen
        onClose={onClose}
        garmentId="garment-2"
        suggestTagsFn={suggestTagsFn}
      />
    )
    await waitForConfidentPreselection()

    await act(async () => {
      failStale(new Error('garment-1 lookup failed'))
      await Promise.resolve()
    })

    // An error banner for a garment the user left would be unexplainable.
    expect(screen.queryByText('garment-1 lookup failed')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Confirm & Save Tags' })).toBeEnabled()
  })
})

describe('GarmentTaggingModal keyboard radiogroup navigation', () => {
  it('moves category selection with the arrow keys and wraps at both ends', async () => {
    const user = userEvent.setup()
    renderModal()
    await waitForConfidentPreselection()

    const top = screen.getByRole('radio', { name: /Top/ })
    const bottom = screen.getByRole('radio', { name: /Bottom/ })
    const accessory = screen.getByRole('radio', { name: /Accessory/ })
    top.focus()

    await user.keyboard('{ArrowRight}')
    expect(bottom).toHaveAttribute('aria-checked', 'true')
    // Roving tabindex: the newly selected option must also take focus.
    expect(bottom).toHaveFocus()

    await user.keyboard('{ArrowLeft}')
    expect(top).toHaveAttribute('aria-checked', 'true')

    await user.keyboard('{ArrowLeft}')
    expect(accessory).toHaveAttribute('aria-checked', 'true')

    await user.keyboard('{ArrowDown}')
    expect(top).toHaveAttribute('aria-checked', 'true')
  })

  it('jumps to either end with Home and End and ignores unrelated keys', async () => {
    const user = userEvent.setup()
    renderModal()
    await waitForConfidentPreselection()

    const top = screen.getByRole('radio', { name: /Top/ })
    top.focus()

    await user.keyboard('{End}')
    expect(screen.getByRole('radio', { name: /Accessory/ })).toHaveAttribute(
      'aria-checked',
      'true'
    )

    await user.keyboard('{Home}')
    expect(top).toHaveAttribute('aria-checked', 'true')

    // Typing must not silently change the answer under the user.
    await user.keyboard('a')
    expect(top).toHaveAttribute('aria-checked', 'true')
  })

  it('starts from the first option when nothing is selected yet', async () => {
    const user = userEvent.setup()
    renderModal({ suggestTagsFn: vi.fn().mockResolvedValue(lowConfidenceSuggestions) })
    await waitFor(() =>
      expect(screen.getAllByText(/Needs review suggested:/)).toHaveLength(3)
    )

    screen.getByRole('radio', { name: /Top/ }).focus()
    await user.keyboard('{ArrowRight}')

    expect(screen.getByRole('radio', { name: /Bottom/ })).toHaveAttribute(
      'aria-checked',
      'true'
    )
  })

  it('moves material selection through the clear option with the arrow keys', async () => {
    const user = userEvent.setup()
    renderModal()
    await waitForConfidentPreselection()

    const clear = screen.getByRole('radio', { name: 'Not sure / Clear' })
    const cotton = screen.getByRole('radio', { name: 'Cotton' })
    cotton.focus()

    await user.keyboard('{ArrowLeft}')
    // "Not sure / Clear" is the null material, reachable by keyboard like any
    // other option rather than only by pointer.
    expect(clear).toHaveAttribute('aria-checked', 'true')
    expect(clear).toHaveFocus()

    await user.keyboard('{ArrowRight}')
    expect(cotton).toHaveAttribute('aria-checked', 'true')

    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('radio', { name: 'Wool' })).toHaveAttribute(
      'aria-checked',
      'true'
    )

    await user.keyboard('{Home}')
    expect(clear).toHaveAttribute('aria-checked', 'true')
    expect(clear).toHaveFocus()

    // Home from the clear option is a no-op rather than a wrap-around.
    await user.keyboard('{Home}')
    expect(clear).toHaveAttribute('aria-checked', 'true')
  })

  it('navigates materials from an option that is not the selected one', async () => {
    const user = userEvent.setup()
    renderModal({ suggestTagsFn: vi.fn().mockResolvedValue(lowConfidenceSuggestions) })
    await waitFor(() =>
      expect(screen.getAllByText(/Needs review suggested:/)).toHaveLength(3)
    )

    // With no material chosen, only "Not sure / Clear" is in the tab order, but
    // assistive tech can still land focus on any option. Movement is measured
    // from the current selection, which here is the null "clear" slot, so the
    // group stays predictable instead of jumping relative to stray focus.
    const cotton = screen.getByRole('radio', { name: 'Cotton' })
    cotton.focus()
    await user.keyboard('{ArrowRight}')

    expect(cotton).toHaveAttribute('aria-checked', 'true')
    expect(cotton).toHaveFocus()
  })

  it('moves comfort selection with the arrow keys', async () => {
    const user = userEvent.setup()
    renderModal()
    await waitForConfidentPreselection()

    screen.getByRole('radio', { name: /Mild/ }).focus()
    await user.keyboard('{ArrowDown}')

    expect(screen.getByRole('radio', { name: /Warm/ })).toHaveAttribute(
      'aria-checked',
      'true'
    )
  })
})

describe('GarmentTaggingModal save failures', () => {
  it('surfaces the failure reason and keeps the dialog open', async () => {
    const user = userEvent.setup()
    const { onClose, onTagsConfirmed } = renderModal({
      updateTagsFn: vi.fn().mockRejectedValue(new Error('Tag service unavailable')),
    })
    await waitForConfidentPreselection()

    await user.click(screen.getByRole('button', { name: 'Confirm & Save Tags' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Tag service unavailable')
    // Closing on failure would discard the choices the user just made.
    expect(onClose).not.toHaveBeenCalled()
    expect(onTagsConfirmed).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('falls back to generic copy when the save rejection is not an Error', async () => {
    const user = userEvent.setup()
    renderModal({ updateTagsFn: vi.fn().mockRejectedValue('gateway reset') })
    await waitForConfidentPreselection()

    await user.click(screen.getByRole('button', { name: 'Confirm & Save Tags' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to save tags. Please try again.'
    )
  })

  it('discards a save that resolves after the dialog was closed', async () => {
    const user = userEvent.setup()
    let settleSave: (garment: GarmentItemContract) => void = () => undefined
    const updateTagsFn = vi.fn().mockReturnValue(
      new Promise<GarmentItemContract>((resolve) => {
        settleSave = resolve
      })
    )
    const { rerender, onClose, onTagsConfirmed } = renderModal({ updateTagsFn })
    await waitForConfidentPreselection()

    await user.click(screen.getByRole('button', { name: 'Confirm & Save Tags' }))
    await waitFor(() => expect(updateTagsFn).toHaveBeenCalledOnce())

    rerender(
      <GarmentTaggingModal
        isOpen={false}
        onClose={onClose}
        garmentId="garment-1"
        onTagsConfirmed={onTagsConfirmed}
        suggestTagsFn={vi.fn().mockResolvedValue(mockSuggestions)}
        updateTagsFn={updateTagsFn}
      />
    )
    await act(async () => {
      settleSave(mockUpdatedGarment)
      await Promise.resolve()
    })

    // The user walked away from this edit; applying it afterwards would retag a
    // garment behind their back.
    expect(onTagsConfirmed).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('leaves the confirm button usable after a save is abandoned by closing', async () => {
    const user = userEvent.setup()
    let failSave: (reason: Error) => void = () => undefined
    const updateTagsFn = vi.fn().mockReturnValue(
      new Promise<GarmentItemContract>((_resolve, reject) => {
        failSave = reject
      })
    )
    const suggestTagsFn = vi.fn().mockResolvedValue(mockSuggestions)
    const { rerender, onClose, onTagsConfirmed } = renderModal({
      updateTagsFn,
      suggestTagsFn,
    })
    await waitForConfidentPreselection()

    await user.click(screen.getByRole('button', { name: 'Confirm & Save Tags' }))
    await waitFor(() => expect(updateTagsFn).toHaveBeenCalledOnce())

    const closed = (
      <GarmentTaggingModal
        isOpen={false}
        onClose={onClose}
        garmentId="garment-1"
        onTagsConfirmed={onTagsConfirmed}
        suggestTagsFn={suggestTagsFn}
        updateTagsFn={updateTagsFn}
      />
    )
    rerender(closed)
    await act(async () => {
      failSave(new Error('aborted in flight'))
      await Promise.resolve()
    })

    rerender(
      <GarmentTaggingModal
        isOpen
        onClose={onClose}
        garmentId="garment-2"
        onTagsConfirmed={onTagsConfirmed}
        suggestTagsFn={suggestTagsFn}
        updateTagsFn={updateTagsFn}
      />
    )
    await waitForConfidentPreselection()

    // Regression: the abandoned request never cleared `isSaving`, so every later
    // open of the tagging dialog rendered a permanently disabled "Saving..."
    // button and the garment could never be tagged again.
    const confirm = screen.getByRole('button', { name: 'Confirm & Save Tags' })
    expect(confirm).toBeEnabled()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
