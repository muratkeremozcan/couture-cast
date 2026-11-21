import { describe, expect, it } from 'vitest'
import {
  MAX_SAMPLE_BOOKMARK_BYTES,
  openSampleBookmark,
  parseSampleBookmarks,
  saveSampleBookmark,
  type SampleBookmark,
} from './bookmarks'
import { SAMPLE_CATALOG } from './catalog'
import { DEFAULT_SAMPLE_COMFORT, selectSampleOutfit } from './selector'
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

  it.each([
    ['missing data', null],
    ['malformed JSON', '{'],
    ['an invalid bookmark record', '[{"lookId":"sample:l:office-oxford"}]'],
    ['oversized data', JSON.stringify('x'.repeat(MAX_SAMPLE_BOOKMARK_BYTES))],
  ])('loads an empty list from %s', (_label, raw) => {
    expect(parseSampleBookmarks(raw, SAMPLE_CATALOG)).toEqual([])
  })

  it('keeps the first copy of each current look and drops swaps the catalog cannot apply', () => {
    const saved: SampleBookmark = {
      lookId: 'sample:l:office-oxford',
      weather: 'mild-dry',
      collection: 'all',
      comfort: DEFAULT_SAMPLE_COMFORT,
      swaps: { shoes: 'sample:g:white-sneakers', top: 'sample:g:loafers' },
    }
    const other = { ...saved, lookId: 'sample:l:silk-midi', swaps: {} }
    const raw = JSON.stringify([
      saved,
      { ...saved, lookId: 'sample:l:retired-look' },
      { ...saved, swaps: {} },
      other,
    ])

    expect(parseSampleBookmarks(raw, SAMPLE_CATALOG)).toEqual([
      { ...saved, swaps: { shoes: 'sample:g:white-sneakers' } },
      other,
    ])
  })

  it('moves an updated look to the front and preserves the other saved look', () => {
    const input = toSampleSelectionInput(createGuestPreviewState(1, SAMPLE_CATALOG))
    const original = selectSampleOutfit(input, SAMPLE_CATALOG)
    const silkMidi = selectSampleOutfit(
      { ...input, selectedLookId: 'sample:l:silk-midi' },
      SAMPLE_CATALOG
    )
    const existing = saveSampleBookmark(saveSampleBookmark([], original), silkMidi)
    const edited = selectSampleOutfit(
      {
        ...input,
        swaps: { 'sample:l:office-oxford': { shoes: 'sample:g:white-sneakers' } },
      },
      SAMPLE_CATALOG
    )

    expect(saveSampleBookmark(existing, edited)).toEqual([
      {
        lookId: 'sample:l:office-oxford',
        weather: 'mild-dry',
        collection: 'all',
        comfort: DEFAULT_SAMPLE_COMFORT,
        swaps: { shoes: 'sample:g:white-sneakers' },
      },
      existing[0],
    ])
  })

  it('preserves saved looks when the current selection cannot be saved', () => {
    const input = toSampleSelectionInput(createGuestPreviewState(1, SAMPLE_CATALOG))
    const saved = saveSampleBookmark([], selectSampleOutfit(input, SAMPLE_CATALOG))
    const example = selectSampleOutfit({ ...input, weather: 'warm-dry' }, SAMPLE_CATALOG)
    const empty = selectSampleOutfit(input, { ...SAMPLE_CATALOG, looks: [] })
    expect(example.look).toBeTruthy()
    expect(empty.look).toBeNull()
    expect(saveSampleBookmark(saved, example)).toBe(saved)
    expect(saveSampleBookmark(saved, empty)).toBe(saved)
  })
})
