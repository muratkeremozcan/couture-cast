// Learning path Step 72: Calm Community with an empty state.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-72-calm-community-with-an-empty-state
import { describe, expect, it } from 'vitest'
import { communityFeedClimate, mergeCommunityLooks } from './community-feed'

describe('Community feed climate', () => {
  it('uses a resolved automatic band and an explicit band', () => {
    expect(communityFeedClimate('auto', 'cold_wet', true)).toBe('cold_wet')
    expect(communityFeedClimate('warm_dry', 'cold_wet', false)).toBe('warm_dry')
  })

  it('leaves an unresolved automatic, all-climates or absent mode unfiltered', () => {
    expect(communityFeedClimate('auto', 'cold_wet', false)).toBeNull()
    expect(communityFeedClimate('all', 'cold_wet', true)).toBeNull()
    expect(communityFeedClimate(null, 'cold_wet', true)).toBeNull()
  })
})

describe('Community feed ordering', () => {
  const near = { id: 'near', climateBand: 'cold_wet', rank: 1 } as const
  const other = { id: 'other', climateBand: 'warm_dry', rank: 2 } as const
  const copy = { id: 'near', climateBand: 'cold_wet' } as const
  const ordinary = { id: 'ordinary', climateBand: 'warm_dry' } as const

  it('keeps the first ranked copy and the ordinary order', () => {
    expect(
      mergeCommunityLooks([near, near, other], [ordinary, copy], null, null)
    ).toEqual([near, other, ordinary])
    expect(mergeCommunityLooks([], [], null, null)).toEqual([])
  })

  it('uses the ordinary response and allows an explicitly targeted ranked look', () => {
    expect(
      mergeCommunityLooks([near, other], [ordinary, copy], 'cold_wet', null)
    ).toEqual([near, ordinary])
    expect(
      mergeCommunityLooks([near, other], [ordinary, copy], 'cold_wet', other.id)
    ).toEqual([near, other, ordinary])
  })
})
