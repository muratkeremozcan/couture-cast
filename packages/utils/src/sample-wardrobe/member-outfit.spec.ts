// Learning path Step 75: Find mini skirts, tights and socks.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-75-find-mini-skirts-tights-and-socks
import { describe, expect, it } from 'vitest'
import { saveSampleBookmark } from './bookmarks'
import { SAMPLE_CATALOG } from './catalog'
import {
  applyMemberSampleGarment,
  COMMUNITY_SAMPLE_WEATHER_BY_BAND,
  communitySampleOutfits,
  createMemberSampleOutfit,
  memberSampleWardrobeChoices,
  reopenMemberSampleOutfit,
  rotateMemberSampleOutfit,
  swapMemberSampleGarment,
  undoMemberSampleSwaps,
  updateMemberSampleOutfit,
} from './member-outfit'
import { SAMPLE_WEATHER_KEYS, sampleSwapCandidates, selectSampleOutfit } from './selector'

const miniSkirt = SAMPLE_CATALOG.garments.find(({ id }) => id === 'sample:g:mini-skirt')!
const socks = SAMPLE_CATALOG.garments.find(({ id }) => id === 'sample:g:ribbed-socks')!

describe('member sample outfit', () => {
  it.each([
    ['cold_wet', 'cool-rainy', 9, true],
    ['cold_dry', 'cool-windy', 9, false],
    ['temperate_wet', 'mild-rainy', 16, true],
    ['temperate_dry', 'mild-dry', 16, false],
    ['warm_wet', 'warm-rainy', 22, true],
    ['warm_dry', 'warm-dry', 22, false],
  ] as const)(
    'shows canonical example weather for %s',
    (band, key, feelsLike, rainReady) => {
      expect(COMMUNITY_SAMPLE_WEATHER_BY_BAND[band]).toBe(key)
      const examples = communitySampleOutfits(band)
      expect(examples).toHaveLength(3)
      for (const example of examples) {
        expect(example.context).toMatchObject({ weather: key, feelsLike, rainReady })
        if (rainReady)
          expect(
            example.garments.find((garment) => garment.category === 'outerwear')
              ?.waterResistant
          ).toBe(true)
      }
      expect(SAMPLE_WEATHER_KEYS).toEqual(['cool-windy', 'mild-dry', 'warm-rainy'])
    }
  )
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

  it('reranks a rotated outfit with the new preferences and keeps them when weather changes', () => {
    const rotated = rotateMemberSampleOutfit(createMemberSampleOutfit())
    const preferences = {
      style: 'cozy',
      palette: 'colorful',
      texture: 'textured',
    } as const
    const mild = updateMemberSampleOutfit(rotated, { preferences })
    expect(rotated.look?.id).toBe('sample:l:silk-midi')
    expect(mild.look?.id).toBe('sample:l:mini-and-tights')
    expect(mild.garments.map(({ id }) => id)).toContain('sample:g:opaque-tights')

    const windy = updateMemberSampleOutfit(mild, { weather: 'cool-windy' })
    expect(windy.input.preferences).toEqual(preferences)
    expect(windy.context).toMatchObject({ weather: 'cool-windy', windLayer: true })
    expect(windy.look?.id).toBe('sample:l:winter-knit')
    expect(
      windy.garments.find(({ category }) => category === 'outerwear')?.windResistant
    ).toBe(true)
  })

  it('restores the saved weather and shoe swap after the look was dismissed', () => {
    const original = createMemberSampleOutfit()
    const edited = swapMemberSampleGarment(original, 'shoes', 'sample:g:white-sneakers')
    const [bookmark] = saveSampleBookmark([], edited)
    expect(bookmark).toBeDefined()
    const current = selectSampleOutfit(
      {
        ...original.input,
        weather: 'cool-windy',
        votes: { 'sample:l:office-oxford': 'dislike', 'sample:l:city-wool': 'like' },
      },
      SAMPLE_CATALOG
    )
    expect(current.look?.id).toBe('sample:l:city-wool')

    const reopened = reopenMemberSampleOutfit(current, bookmark!)
    expect(reopened.look?.id).toBe('sample:l:office-oxford')
    expect(reopened.context.weather).toBe('mild-dry')
    expect(reopened.garments).toEqual(edited.garments)
    expect(reopened.input.votes).toEqual({ 'sample:l:city-wool': 'like' })
    expect(current.input.votes['sample:l:office-oxford']).toBe('dislike')
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

  it('[7.18-PICK-001] replaces a present slot and keeps the other pieces', () => {
    const original = createMemberSampleOutfit('mild-dry')
    const lookId = memberSampleWardrobeChoices(original).get(miniSkirt.id)
    expect(lookId).toBe('sample:l:office-oxford')
    const selected = applyMemberSampleGarment(original, miniSkirt, lookId!)
    expect(selected.garments.map(({ id }) => id)).toEqual([
      'sample:g:oxford-shirt',
      'sample:g:mini-skirt',
      'sample:g:loafers',
    ])
  })

  it('[7.18-PICK-001] opens the eligible mini skirt look when the slot is missing', () => {
    const original = createMemberSampleOutfit('cool-windy')
    expect(original.look?.id).toBe('sample:l:winter-knit')
    const lookId = memberSampleWardrobeChoices(original).get(miniSkirt.id)
    expect(lookId).toBe('sample:l:mini-and-tights')
    const selected = applyMemberSampleGarment(original, miniSkirt, lookId!)
    expect(selected.garments.map(({ id }) => id)).toContain('sample:g:opaque-tights')
    expect(selected.garments.map(({ id }) => id)).toContain(miniSkirt.id)
    expect(selected.input.swaps).toEqual({})
  })

  it('[7.18-PICK-001] uses an eligible accessory slot when no look includes the selected socks', () => {
    const original = createMemberSampleOutfit('mild-dry')
    expect(original.garments.some(({ category }) => category === 'accessory')).toBe(false)
    const lookId = memberSampleWardrobeChoices(original).get(socks.id)
    expect(lookId).toBe('sample:l:wrap-day')
    const selected = applyMemberSampleGarment(original, socks, lookId!)
    expect(selected.input.swaps[lookId!]).toEqual({ accessory: socks.id })
    expect(selected.garments.map(({ id }) => id)).toContain(socks.id)
  })

  it('[7.18-PICK-001] keeps the chosen mini skirt when adding socks to a Mild look', () => {
    const original = createMemberSampleOutfit('mild-dry')
    const withSkirt = swapMemberSampleGarment(original, 'bottom', miniSkirt.id)
    const lookId = memberSampleWardrobeChoices(withSkirt).get(socks.id)
    expect(lookId).toBe('sample:l:mini-and-tights')
    const withSocks = applyMemberSampleGarment(withSkirt, socks, lookId!)
    expect(withSocks.garments.map(({ id }) => id)).toEqual([
      'sample:g:ribbed-knit',
      'sample:g:mini-skirt',
      'sample:g:ankle-boots',
      'sample:g:ribbed-socks',
    ])
  })

  it('[7.18-PICK-001] omits an unavailable piece and keeps the result for a stale look', () => {
    const original = updateMemberSampleOutfit(createMemberSampleOutfit(), {
      collection: 'menswear',
    })
    expect(memberSampleWardrobeChoices(original).has(miniSkirt.id)).toBe(false)
    expect(original.look?.id).toBe('sample:l:office-oxford')
    expect(original.garments.map(({ category }) => category)).toContain('bottom')
    expect(swapMemberSampleGarment(original, 'bottom', miniSkirt.id)).toBe(original)
    expect(applyMemberSampleGarment(original, miniSkirt, 'sample:l:office-oxford')).toBe(
      original
    )
    expect(
      applyMemberSampleGarment(original, miniSkirt, 'sample:l:mini-and-tights')
    ).toBe(original)
    expect(swapMemberSampleGarment(original, 'accessory', socks.id)).toBe(original)
  })

  it('[7.18-SWAP-001] leaves the same choice and the previous swap intact', () => {
    const original = createMemberSampleOutfit('mild-dry')
    const selected = swapMemberSampleGarment(original, 'bottom', miniSkirt.id)
    expect(selected).not.toBe(original)
    expect(swapMemberSampleGarment(selected, 'bottom', miniSkirt.id)).toBe(selected)
    expect(applyMemberSampleGarment(selected, miniSkirt, 'sample:l:office-oxford')).toBe(
      selected
    )
    expect(undoMemberSampleSwaps(selected).garments).toEqual(original.garments)
  })

  it('keeps an empty result stable when no sample look is available', () => {
    const empty = selectSampleOutfit(createMemberSampleOutfit().input, {
      ...SAMPLE_CATALOG,
      looks: [],
    })
    expect(empty.look).toBeNull()
    expect(rotateMemberSampleOutfit(empty)).toBe(empty)
    expect(swapMemberSampleGarment(empty, 'shoes', 'sample:g:loafers')).toBe(empty)
    expect(memberSampleWardrobeChoices(empty).size).toBe(0)
    expect(undoMemberSampleSwaps(empty)).toBe(empty)
  })
})
