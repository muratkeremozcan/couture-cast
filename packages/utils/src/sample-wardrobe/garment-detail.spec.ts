// Story 7.5 test plan 7.5-UNIT-009: shared garment detail rules (draft, unchanged check, labels,
// save failure names) that web and native both use.
// Learning path Step 63: Garment detail and tag edit.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-63-garment-detail-and-tag-edit
import { describe, expect, it } from 'vitest'
import {
  classifyGarmentTagSaveError,
  formatGarmentTagLabels,
  garmentTagDraft,
  garmentTagsEqual,
} from './garment-detail'

describe('garmentTagDraft', () => {
  it('[P1] [7.5-UNIT-009] drafts the editable tags, keeping a missing material as null', () => {
    expect(
      garmentTagDraft({ category: 'top', material: null, comfortRange: 'mild' })
    ).toEqual({ category: 'top', material: null, comfortRange: 'mild' })
  })

  it('[P1] [7.5-UNIT-009] has no draft when a required tag is missing', () => {
    expect(
      garmentTagDraft({ category: null, material: 'wool', comfortRange: 'mild' })
    ).toBeNull()
    expect(
      garmentTagDraft({ category: 'top', material: 'wool', comfortRange: null })
    ).toBeNull()
  })
})

describe('garmentTagsEqual', () => {
  const saved = { category: 'top', material: 'cotton', comfortRange: 'mild' } as const

  it('[P0] [7.5-UNIT-009] treats identical tags as unchanged (Done sends nothing)', () => {
    expect(garmentTagsEqual({ ...saved }, saved)).toBe(true)
  })

  it.each([
    [{ ...saved, category: 'bottom' }],
    [{ ...saved, material: null }],
    [{ ...saved, material: 'wool' }],
    [{ ...saved, comfortRange: 'cold' }],
  ] as const)('[P0] [7.5-UNIT-009] sees a change in %j', (draft) => {
    expect(garmentTagsEqual(draft, saved)).toBe(false)
  })
})

describe('formatGarmentTagLabels', () => {
  it.each([
    ['top', 'Top'],
    ['bottom', 'Bottom'],
    ['outerwear', 'Outer layer'],
    ['dress', 'Dress'],
    ['shoes', 'Shoes'],
    ['accessory', 'Accessory'],
  ] as const)(
    '[P1] [7.5-UNIT-009] names one %s garment in the singular: %s',
    (category, expected) => {
      expect(formatGarmentTagLabels('en-US', { category }).category).toBe(expected)
    }
  )

  it('[P1] [7.5-UNIT-009] localizes material and comfort, with null for a missing tag', () => {
    expect(
      formatGarmentTagLabels('en-US', { material: 'wool', comfortRange: 'cold' })
    ).toMatchObject({ material: 'Wool', comfort: 'Cold' })
    expect(formatGarmentTagLabels('en-US', {})).toEqual({
      category: null,
      material: null,
      comfort: null,
    })
  })
})

describe('classifyGarmentTagSaveError', () => {
  it.each([
    [{ status: 409, code: 'CONCURRENT_TAG_UPDATE' }, 'conflict'],
    [{ status: 409, message: 'CONCURRENT_TAG_UPDATE' }, 'conflict'],
    [{ status: 409, code: 'GARMENT_NOT_TAGGABLE' }, 'failed'],
    [{ status: 403, code: 'GUARDIAN_CONSENT_REQUIRED' }, 'not-allowed'],
    [{ status: 500 }, 'failed'],
    [{ status: 404, code: 'GARMENT_NOT_FOUND' }, 'failed'],
    [new TypeError('Failed to fetch'), 'offline'],
    [new Error('boom'), 'failed'],
    [null, 'failed'],
  ] as const)('[P0] [7.5-UNIT-009] names %j as %s', (error, expected) => {
    expect(classifyGarmentTagSaveError(error)).toBe(expected)
  })

  it('[P1] [7.5-UNIT-009] calls a status-less failure offline when the device is offline', () => {
    expect(classifyGarmentTagSaveError(new Error('boom'), false)).toBe('offline')
    // An API answer is never "offline", even if the connection dropped right after.
    expect(classifyGarmentTagSaveError({ status: 500 }, false)).toBe('failed')
  })
})
