// Learning path Step 78: First run with the look first and the account on save.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-78-first-look-and-account-save
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createGuestPreviewBirthdateHandoff } from './birthdate-handoff'
import { SAMPLE_CATALOG } from './catalog'
import {
  beginGuestLookSave,
  completeGuestLookSave,
  guestLookStyleRows,
  guestPreviewReviewProposal,
  isGuestLookAvailable,
} from './first-run-save'
import { doesSavedLookResolve } from './saved-looks'
import { selectSampleOutfit, type SampleComfort } from './selector'
import {
  createGuestPreviewState,
  GUEST_PREVIEW_GARMENT_INTENT,
  parseGuestPreviewState,
  serializeGuestPreviewState,
  toSampleSelectionInput,
  type GuestPreviewState,
} from './state'

const START = Date.UTC(2026, 10, 27)

function createReview() {
  const guest = createGuestPreviewState(START, SAMPLE_CATALOG)
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
  let savedComfort = guest.comfort
  const comfortClient = {
    read: vi.fn(() => Promise.resolve(savedComfort)),
    write: vi.fn((values: SampleComfort) => {
      savedComfort = values
      return Promise.resolve(undefined)
    }),
  }
  return { guest, intent, lookClient, comfortClient }
}

describe('CC-7.21 birthdate handoff', () => {
  const date = '2000-01-15'
  const started = createGuestPreviewState(START, SAMPLE_CATALOG)
  afterEach(() => {
    vi.useRealTimers()
  })

  it('keeps the trimmed date in memory until the same preview expires', () => {
    vi.useFakeTimers()
    vi.setSystemTime(START)
    const handoff = createGuestPreviewBirthdateHandoff(() => started)
    expect(handoff.read()).toBeUndefined()
    handoff.remember(started, ` ${date} `)
    expect(handoff.read()).toBe(date)
    vi.advanceTimersByTime(started.eligibility.expiresAt - START)
    expect(handoff.read()).toBeUndefined()
  })

  it('drops the date when its preview disappears or a new preview starts', () => {
    vi.useFakeTimers()
    vi.setSystemTime(START)
    let current: GuestPreviewState | null = started
    const handoff = createGuestPreviewBirthdateHandoff(() => current)
    handoff.remember(started, date)
    current = null
    expect(handoff.read()).toBeUndefined()
    current = createGuestPreviewState(START + 1, SAMPLE_CATALOG)
    handoff.remember(started, date)
    expect(handoff.read()).toBeUndefined()
  })

  it('clears explicitly and refuses a handoff from an expired preview', () => {
    vi.useFakeTimers()
    vi.setSystemTime(START)
    const handoff = createGuestPreviewBirthdateHandoff(() => started)
    handoff.remember(started, date)
    handoff.clear()
    expect(handoff.read()).toBeUndefined()
    handoff.remember(started, date)
    // Changing the clock without firing timers also expires the entry on read.
    vi.setSystemTime(started.eligibility.expiresAt)
    expect(handoff.read()).toBeUndefined()
    handoff.remember(started, date)
    expect(handoff.read()).toBeUndefined()
  })
})

describe('CC-7.21 review proposal', () => {
  it('reads account and guest answers while preserving legacy comfort-only review', () => {
    const { guest, intent } = createReview()
    expect(guestPreviewReviewProposal(null)).toBeNull()
    expect(guestPreviewReviewProposal(guest)).toBeNull()
    expect(
      guestPreviewReviewProposal({
        ...guest,
        conversion: { intent: GUEST_PREVIEW_GARMENT_INTENT },
      })
    ).toEqual({ intent: null, comfort: guest.comfort })
    expect(guestPreviewReviewProposal({ ...guest, conversion: intent })).toEqual({
      intent,
      comfort: intent.comfort,
    })
    const emptyRows = guestLookStyleRows(null, 'en-US')
    expect(guestLookStyleRows({ mood: 'cozy' }, 'en-US')).toEqual([
      ['Style mood', 'Cozy'],
      emptyRows[1],
    ])
    expect(guestLookStyleRows({ palette: 'colorful' }, 'en-US')).toEqual([
      emptyRows[0],
      ['Colors', 'Colorful'],
    ])
  })

  it('keeps the current preview when a result has no valid catalog payload', () => {
    const { guest } = createReview()
    const outfit = selectSampleOutfit(toSampleSelectionInput(guest), SAMPLE_CATALOG)
    expect(beginGuestLookSave(guest, { ...outfit, look: null })).toBe(guest)
    expect(
      beginGuestLookSave(guest, {
        ...outfit,
        garments: [{ ...outfit.garments[0]!, id: 'invalid' }],
      })
    ).toBe(guest)
  })

  it('retains a matching catalog look and drops a stale composition during restore', () => {
    const { guest, intent } = createReview()
    const shoes = intent.look.composition.find(({ category }) => category === 'shoes')!
    intent.look.swaps = { shoes: shoes.itemId }
    const restored = (conversion: typeof intent) =>
      parseGuestPreviewState(
        serializeGuestPreviewState({ ...guest, conversion }),
        START,
        SAMPLE_CATALOG
      )?.conversion
    expect(isGuestLookAvailable(intent, SAMPLE_CATALOG)).toBe(true)
    expect(restored(intent)).toEqual(intent)

    const missingLook = { ...intent.look, lookId: 'sample:l:missing' }
    const staleSwap = { ...intent.look, swaps: { shoes: 'sample:g:missing' } }
    const badSlot = {
      ...intent.look,
      composition: [{ ...intent.look.composition[0]!, slotIndex: 10 }],
    }
    for (const look of [missingLook, staleSwap, badSlot]) {
      const unavailable = { ...intent, look }
      expect(isGuestLookAvailable(unavailable, SAMPLE_CATALOG)).toBe(false)
      expect(restored(unavailable)).toBeUndefined()
    }
  })

  it('reopens composition-only catalog records only when their pieces are available', () => {
    const { intent } = createReview()
    const saved = intent.look
    const slot = saved.composition[0]!
    expect(doesSavedLookResolve(saved)).toBe(true)
    expect(doesSavedLookResolve({ ...saved, lookId: 'sample:l:missing' })).toBe(false)
    expect(doesSavedLookResolve({ ...saved, composition: [] })).toBe(false)
    expect(
      doesSavedLookResolve({
        ...saved,
        composition: [{ ...slot, itemId: 'sample:g:missing' }],
      })
    ).toBe(false)
    expect(
      doesSavedLookResolve({
        ...saved,
        composition: [{ ...slot, kind: 'garment' }],
      })
    ).toBe(false)
  })
})

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

  it('writes the confirmed comfort values and only changed style answers before saving', async () => {
    const review = createReview()
    review.intent.comfort.runsColdWarm = 'cold'
    review.lookClient.readStyle.mockResolvedValue({ mood: 'cozy', texture: 'smooth' })
    await expect(
      completeGuestLookSave({ ...review, applySettings: true, isCurrent: () => true })
    ).resolves.toEqual({ id: 'approved-look' })
    expect(review.comfortClient.write).toHaveBeenCalledWith(review.intent.comfort)
    expect(review.lookClient.writeStyle).toHaveBeenCalledExactlyOnceWith({
      palette: 'colorful',
    })
    expect(review.lookClient.save).toHaveBeenCalledWith(
      review.intent.look,
      review.intent.key
    )
  })

  it.each([{}, { mood: 'cozy', palette: 'colorful' }] as const)(
    'skips style writes for unchanged answers %j',
    async (answers) => {
      const review = createReview()
      review.intent.style = answers
      review.lookClient.readStyle.mockResolvedValue(answers)
      await completeGuestLookSave({
        ...review,
        applySettings: true,
        isCurrent: () => true,
      })
      expect(review.lookClient.writeStyle).not.toHaveBeenCalled()
      expect(review.lookClient.save).toHaveBeenCalledOnce()
    }
  )

  it('keeps the look unsaved when the comfort read fails', async () => {
    const review = createReview()
    review.comfortClient.read.mockRejectedValueOnce(new Error('offline'))
    await expect(
      completeGuestLookSave({ ...review, applySettings: true, isCurrent: () => true })
    ).rejects.toThrow('Comfort carryover failed')
    expect(review.lookClient.save).not.toHaveBeenCalled()
  })

  it('discards the save when a consent check refuses the comfort write', async () => {
    const review = createReview()
    const denied = new Error('Guardian consent required')
    review.intent.comfort.runsColdWarm = 'cold'
    review.comfortClient.write.mockRejectedValueOnce(denied)
    await expect(
      completeGuestLookSave({
        ...review,
        applySettings: true,
        isCurrent: () => true,
        isRejection: (error) => error === denied,
      })
    ).resolves.toBe('rejected')
    expect(review.lookClient.writeStyle).not.toHaveBeenCalled()
    expect(review.lookClient.save).not.toHaveBeenCalled()
  })

  it.each(['at entry', 'during the comfort read', 'during the save'])(
    'discards completion if the session changes %s',
    async (when) => {
      const review = createReview()
      let current = when !== 'at entry'
      if (when === 'during the comfort read') {
        review.comfortClient.read.mockImplementationOnce(() => {
          current = false
          return Promise.resolve(review.intent.comfort)
        })
      }
      if (when === 'during the save') {
        review.lookClient.save.mockImplementationOnce(() => {
          current = false
          return Promise.resolve({ id: 'old-account-look' })
        })
      }
      await expect(
        completeGuestLookSave({
          ...review,
          applySettings: true,
          isCurrent: () => current,
        })
      ).resolves.toBeNull()
      expect(review.lookClient.save).toHaveBeenCalledTimes(
        when === 'during the save' ? 1 : 0
      )
    }
  )
})
