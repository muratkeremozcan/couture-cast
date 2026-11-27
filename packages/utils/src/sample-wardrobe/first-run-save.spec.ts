// Learning path Step 78: First run with the look first and the account on save.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-78-first-look-and-account-save
import { describe, expect, it, vi } from 'vitest'
import { SAMPLE_CATALOG } from './catalog'
import { beginGuestLookSave, completeGuestLookSave } from './first-run-save'
import { selectSampleOutfit } from './selector'
import { createGuestPreviewState, toSampleSelectionInput } from './state'

function createReview() {
  const guest = createGuestPreviewState(Date.UTC(2026, 10, 27), SAMPLE_CATALOG)
  guest.preferences = { style: 'cozy', palette: 'colorful' }
  const outfit = selectSampleOutfit(toSampleSelectionInput(guest), SAMPLE_CATALOG)
  const { conversion: intent } = beginGuestLookSave(guest, outfit)
  if (intent?.intent !== 'guest-preview-save-look') {
    throw new Error('The supplied sample look cannot be reviewed')
  }
  const lookClient = {
    readStyle: vi.fn().mockResolvedValue(null),
    writeStyle: vi.fn().mockResolvedValue(undefined),
    save: vi.fn().mockResolvedValue({ id: 'approved-look' }),
  }
  const comfortClient = {
    read: vi.fn().mockResolvedValue(guest.comfort),
    write: vi.fn().mockResolvedValue(undefined),
  }
  return { intent, lookClient, comfortClient }
}

describe('CC-7.21 guest look review', () => {
  it('can retry an uncertain save with the original composition and idempotency key', async () => {
    const review = createReview()
    const { intent, lookClient, comfortClient } = review
    lookClient.save.mockRejectedValueOnce(new Error('Save response was lost'))
    const save = () =>
      completeGuestLookSave({ ...review, applySettings: false, isCurrent: () => true })

    await expect(save()).rejects.toThrow('Save response was lost')
    await expect(save()).resolves.toEqual({ id: 'approved-look' })
    expect(lookClient.save.mock.calls).toEqual([
      [intent.look, intent.key],
      [intent.look, intent.key],
    ])
    expect(lookClient.readStyle).not.toHaveBeenCalled()
    expect(lookClient.writeStyle).not.toHaveBeenCalled()
    expect(comfortClient.read).not.toHaveBeenCalled()
    expect(comfortClient.write).not.toHaveBeenCalled()
  })

  it('stops the write sequence when the session changes during the style read', async () => {
    const review = createReview()
    let current = true
    review.lookClient.readStyle.mockImplementationOnce(() => {
      current = false
      return Promise.resolve(null)
    })

    await expect(
      completeGuestLookSave({ ...review, applySettings: true, isCurrent: () => current })
    ).resolves.toBeNull()
    expect(review.lookClient.readStyle).toHaveBeenCalledOnce()
    expect(review.lookClient.writeStyle).not.toHaveBeenCalled()
    expect(review.lookClient.save).not.toHaveBeenCalled()
  })
})
