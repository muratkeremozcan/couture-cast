// Learning path Step 75: Find mini skirts, tights and socks.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-75-find-mini-skirts-tights-and-socks
import { expect, it } from 'vitest'
import { SAMPLE_CATALOG } from './catalog'
import {
  sampleOutfitSwapOptions,
  sampleSwapDisplay,
  sampleWardrobeCategories,
  sampleWardrobeItems,
} from './display'
import { getGuestPreviewStrings } from './format'
import { createMemberSampleOutfit } from './member-outfit'

function garment(id: string) {
  return SAMPLE_CATALOG.garments.find((item) => item.id === `sample:g:${id}`)!
}

it('[7.18-SWAP-001] builds the active slot options from the sample outfit weather', () => {
  const outfit = createMemberSampleOutfit('cool-windy')
  const options = sampleOutfitSwapOptions(outfit, 'accessory')
  expect(options.current).toEqual(garment('wool-scarf'))
  expect(options.range).toBe('cold')
  expect(options.candidates).toEqual(
    expect.arrayContaining([garment('opaque-tights'), garment('ribbed-socks')])
  )
  expect(sampleOutfitSwapOptions(outfit, null)).toEqual({
    current: undefined,
    candidates: [],
    range: 'cold',
  })
})

it('[7.18-PICK-001] exposes type filters and respects the selected collection', () => {
  const categories = sampleWardrobeCategories(getGuestPreviewStrings('en-US'))
  expect(categories).toEqual(
    expect.arrayContaining([
      { value: 'skirts', label: 'Skirts' },
      { value: 'tights', label: 'Tights' },
      { value: 'socks', label: 'Socks' },
    ])
  )
  expect(sampleWardrobeItems('skirts', 'all').map(({ id }) => id)).toEqual([
    'sample:g:midi-skirt',
    'sample:g:pleated-skirt',
    'sample:g:maxi-skirt',
    'sample:g:mini-skirt',
  ])
  expect(sampleWardrobeItems('tights', 'all')).toEqual([garment('opaque-tights')])
  expect(sampleWardrobeItems('socks', 'all')).toEqual([garment('ribbed-socks')])
  expect(sampleWardrobeItems('socks', 'menswear')).toEqual([])
})

it('[7.18-SWAP-001] groups within weather tiers and carries the current choice once', () => {
  const mini = garment('mini-skirt')
  const nearby = garment('midi-skirt')
  const trousers = garment('wool-trousers')
  const pleated = garment('pleated-skirt')
  const skirt = { ...pleated, id: 'sample:g:skirt-fixture' }
  expect(
    sampleSwapDisplay(
      mini,
      [nearby, pleated, trousers, mini, skirt, pleated],
      'cool',
      false
    )
  ).toEqual({
    current: mini,
    tiers: [
      {
        fit: 'exact',
        groups: [
          { type: 'skirt', garments: [pleated, skirt], firstIndex: 1 },
          { type: 'trousers', garments: [trousers], firstIndex: 3 },
        ],
      },
      { fit: 'nearby', groups: [{ type: 'skirt', garments: [nearby], firstIndex: 4 }] },
    ],
    hasAlternatives: true,
    hasMore: false,
  })
  expect(sampleSwapDisplay(undefined, [nearby], 'cool', false)).toEqual({
    current: undefined,
    tiers: [
      { fit: 'nearby', groups: [{ type: 'skirt', garments: [nearby], firstIndex: 0 }] },
    ],
    hasAlternatives: true,
    hasMore: false,
  })
  expect(sampleSwapDisplay(mini, [mini], 'cool', false)).toEqual({
    current: mini,
    tiers: [],
    hasAlternatives: false,
    hasMore: false,
  })
})

it('[7.18-SWAP-002] applies the 12-row limit across groups and retains order on expansion', () => {
  const tights = garment('opaque-tights')
  const sock = garment('ribbed-socks')
  const socks = Array.from({ length: 11 }, (_, index) => ({
    ...sock,
    id: `sample:g:socks-fixture-${index + 1}`,
  }))
  const scarf = garment('wool-scarf')
  const candidates = [scarf, ...socks]
  const collapsed = sampleSwapDisplay(tights, candidates, 'mild', false)
  expect(collapsed.tiers).toEqual([
    { fit: 'exact', groups: [{ type: 'socks', garments: socks, firstIndex: 1 }] },
  ])
  expect(collapsed.hasMore).toBe(true)
  const expanded = sampleSwapDisplay(tights, candidates, 'mild', true)
  expect(expanded.tiers).toEqual([
    ...collapsed.tiers,
    { fit: 'nearby', groups: [{ type: 'scarf', garments: [scarf], firstIndex: 12 }] },
  ])
  expect(expanded.hasMore).toBe(false)
})
