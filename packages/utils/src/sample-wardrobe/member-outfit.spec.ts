import { describe, expect, it } from 'vitest'
import { SAMPLE_CATALOG } from './catalog'
import {
  createMemberSampleOutfit,
  rotateMemberSampleOutfit,
  swapMemberSampleGarment,
  undoMemberSampleSwaps,
} from './member-outfit'
import { sampleSwapCandidates, selectSampleOutfit } from './selector'

describe('member sample outfit', () => {
  it('rotates through example outfits and returns to the same look', () => {
    const sample = createMemberSampleOutfit()
    const next = rotateMemberSampleOutfit(sample)
    expect(sample.input.weather).toBe('mild-dry')
    expect(sample.eligibleLookIds.length).toBeGreaterThan(1)
    expect(next.look?.id).not.toBe(sample.look?.id)

    let rotated = next
    for (let count = 1; count < sample.eligibleLookIds.length; count++) {
      rotated = rotateMemberSampleOutfit(rotated)
    }
    expect(rotated.look?.id).toBe(sample.look?.id)
    expect(rotated.garments).toEqual(sample.garments)
  })

  it('swaps an eligible shoe and restores the original outfit on undo', () => {
    const sample = createMemberSampleOutfit()
    const shoes = sample.garments.find((garment) => garment.category === 'shoes')
    const replacement = sampleSwapCandidates(
      SAMPLE_CATALOG,
      'shoes',
      sample.input,
      sample.context
    ).find((garment) => garment.id !== shoes?.id)
    expect(shoes).toBeDefined()
    expect(replacement).toBeDefined()
    const changed = swapMemberSampleGarment(sample, 'shoes', replacement!.id)
    expect(changed.look?.id).toBe(sample.look?.id)
    expect(changed.garments.map((garment) => garment.id)).toContain(replacement!.id)
    expect(changed.garments.map((garment) => garment.id)).not.toContain(shoes!.id)
    expect(undoMemberSampleSwaps(changed).garments).toEqual(sample.garments)
  })

  it('keeps an empty result stable when no sample look is available', () => {
    const empty = selectSampleOutfit(createMemberSampleOutfit().input, {
      ...SAMPLE_CATALOG,
      looks: [],
    })
    expect(empty.look).toBeNull()
    expect(rotateMemberSampleOutfit(empty)).toBe(empty)
    expect(swapMemberSampleGarment(empty, 'shoes', 'sample:g:loafers')).toBe(empty)
    expect(undoMemberSampleSwaps(empty)).toBe(empty)
  })
})
