import { describe, expect, it } from 'vitest'
import { openSampleBookmark, saveSampleBookmark } from './bookmarks'
import { SAMPLE_CATALOG } from './catalog'
import { selectSampleOutfit } from './selector'
import {
  createGuestPreviewState,
  parseGuestPreviewState,
  serializeGuestPreviewState,
  toSampleSelectionInput,
} from './state'

describe('style ideas and bookmarks', () => {
  it('keeps the default and prioritizes preferences among the same eligible examples', () => {
    const initial = toSampleSelectionInput(createGuestPreviewState(1, SAMPLE_CATALOG))
    const before = selectSampleOutfit(initial, SAMPLE_CATALOG)
    const result = selectSampleOutfit(
      {
        ...initial,
        preferences: { style: 'cozy', palette: 'colorful', texture: 'textured' },
      },
      SAMPLE_CATALOG
    )
    expect(before.look?.id).toBe('sample:l:office-oxford')
    expect(result.look?.id).toBe('sample:l:mini-and-tights')
    expect(new Set(result.eligibleLookIds)).toEqual(new Set(before.eligibleLookIds))
  })

  it('reopens the edited look, weather and hosiery after reading persisted guest data', () => {
    const guest = createGuestPreviewState(1, SAMPLE_CATALOG)
    const edited = selectSampleOutfit(
      {
        ...toSampleSelectionInput(guest),
        selectedLookId: 'sample:l:mini-and-tights',
        swaps: { 'sample:l:mini-and-tights': { accessory: 'sample:g:ribbed-socks' } },
      },
      SAMPLE_CATALOG
    )
    const stored = serializeGuestPreviewState({
      ...guest,
      bookmarks: saveSampleBookmark([], edited),
    })
    const restored = parseGuestPreviewState(stored, 2, SAMPLE_CATALOG)
    const bookmark = restored?.bookmarks?.[0]
    expect(bookmark).toBeDefined()
    const reopened = selectSampleOutfit(
      {
        ...toSampleSelectionInput(guest),
        ...openSampleBookmark(bookmark!, { votes: {}, swaps: {} }),
      },
      SAMPLE_CATALOG
    )
    expect(reopened.look?.id).toBe(edited.look?.id)
    expect(reopened.context.weather).toBe(edited.context.weather)
    expect(reopened.garments.map((garment) => garment.id)).toEqual(
      edited.garments.map((garment) => garment.id)
    )
    expect(
      reopened.garments.some((garment) => garment.id === 'sample:g:ribbed-socks')
    ).toBe(true)
  })

  it('keeps Community-only weather out of saved looks', () => {
    const input = toSampleSelectionInput(createGuestPreviewState(1, SAMPLE_CATALOG))
    const example = selectSampleOutfit({ ...input, weather: 'warm-dry' }, SAMPLE_CATALOG)
    expect(example.look).toBeTruthy()
    expect(saveSampleBookmark([], example)).toEqual([])
  })
})
