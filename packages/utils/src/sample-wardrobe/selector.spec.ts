// Story 6.16 U-SEL-*, U-SWAP and U-VOTES: the shared deterministic sample policy.
import { describe, expect, it } from 'vitest'
import { SAMPLE_CATALOG } from './catalog'
import {
  buildSampleContext,
  DEFAULT_SAMPLE_COMFORT,
  garmentSuitsRange,
  nextSampleLook,
  SAMPLE_POLICY_VERSION,
  sampleFeedbackProgress,
  sampleSwapCandidates,
  selectSampleOutfit,
  toggleSampleVote,
  type SampleComfort,
  type SampleOutfitResult,
  type SampleSelectionInput,
} from './selector'
import type { SampleCatalog } from './types'

function input(overrides: Partial<SampleSelectionInput> = {}): SampleSelectionInput {
  return {
    weather: 'mild-dry',
    collection: 'all',
    comfort: { ...DEFAULT_SAMPLE_COMFORT },
    votes: {},
    swaps: {},
    ...overrides,
  }
}

function comfort(overrides: Partial<SampleComfort>): SampleComfort {
  return { ...DEFAULT_SAMPLE_COMFORT, ...overrides }
}

const ids = (result: SampleOutfitResult) => result.garments.map((garment) => garment.id)
const keys = (result: SampleOutfitResult) => result.explanation.map((item) => item.key)
const run = (overrides: Partial<SampleSelectionInput> = {}) =>
  selectSampleOutfit(input(overrides), SAMPLE_CATALOG)

describe('sample policy determinism (U-SEL-DETERMINISTIC)', () => {
  it('pins the policy version', () => {
    expect(SAMPLE_POLICY_VERSION).toBe(1)
  })

  it('gives the same result over 1,000 runs and after a JSON round trip', () => {
    const state = input({
      weather: 'cool-windy',
      votes: { 'sample:l:city-wool': 'like' },
    })
    const first = selectSampleOutfit(state, SAMPLE_CATALOG)
    for (let index = 0; index < 1000; index += 1) {
      expect(selectSampleOutfit(state, SAMPLE_CATALOG)).toEqual(first)
    }
    const roundTripped = JSON.parse(JSON.stringify(state)) as SampleSelectionInput
    expect(selectSampleOutfit(roundTripped, SAMPLE_CATALOG)).toEqual(first)
  })
})

describe('sample policy material changes (U-SEL-MATERIAL, D5 pairs)', () => {
  it('mild-dry: cold adds a layer at 13 degrees', () => {
    const neutral = run()
    const cold = run({ comfort: comfort({ runsColdWarm: 'cold' }) })
    expect(neutral.context.adjustedFeelsLike).toBe(16)
    expect(cold.context.adjustedFeelsLike).toBe(13)
    expect(ids(neutral)).toEqual([
      'sample:g:oxford-shirt',
      'sample:g:dark-jeans',
      'sample:g:loafers',
    ])
    expect(ids(cold)[0]).toBe('sample:g:fleece-zip')
    expect(keys(cold)).toContain('layer-cold')
    expect(keys(neutral)).toContain('no-layer')
  })

  it('cool-windy: warm moves cold to cool and changes the layer', () => {
    const neutral = run({ weather: 'cool-windy' })
    const warm = run({
      weather: 'cool-windy',
      comfort: comfort({ runsColdWarm: 'warm' }),
    })
    expect([neutral.context.range, warm.context.range]).toEqual(['cold', 'cool'])
    expect(ids(neutral)[0]).toBe('sample:g:wool-overcoat')
    expect(ids(warm)[0]).toBe('sample:g:trench-coat')
  })

  it('cool-windy: wind high drops the wind requirement at 6.5 m/s', () => {
    const medium = run({ weather: 'cool-windy' })
    const high = run({
      weather: 'cool-windy',
      comfort: comfort({ windTolerance: 'high' }),
    })
    expect(medium.context.windLayer).toBe(true)
    expect(high.context.windLayer).toBe(false)
    expect(keys(medium)).toContain('layer-wind')
    expect(keys(high)).toContain('wind-within')
    expect(ids(medium)[0]).toBe('sample:g:wool-overcoat')
    expect(ids(high)[0]).toBe('sample:g:fleece-zip')
  })

  it('warm-rainy: rain low drops the rain requirement at 0.6 and 1.2 mm', () => {
    const medium = run({ weather: 'warm-rainy' })
    const low = run({
      weather: 'warm-rainy',
      comfort: comfort({ precipPreparedness: 'low' }),
    })
    expect(medium.context.rainReady).toBe(true)
    expect(low.context.rainReady).toBe(false)
    expect(ids(medium)[0]).toBe('sample:g:rain-shell')
    expect(ids(low).some((id) => id === 'sample:g:rain-shell')).toBe(false)
    expect(keys(low)).toContain('rain-within')
  })

  it('warm-rainy: warm reaches hot at exactly 25 and the eligible looks change', () => {
    const neutral = run({ weather: 'warm-rainy' })
    const warm = run({
      weather: 'warm-rainy',
      comfort: comfort({ runsColdWarm: 'warm' }),
    })
    expect(warm.context.adjustedFeelsLike).toBe(25)
    expect([neutral.context.range, warm.context.range]).toEqual(['warm', 'hot'])
    expect(warm.eligibleLookIds).not.toEqual(neutral.eligibleLookIds)
    expect(warm.look?.id).not.toBe(neutral.look?.id)
  })

  it('a like moves that look first', () => {
    const before = run()
    const liked = before.eligibleLookIds[3] as string
    const after = run({ votes: { [liked]: 'like' } })
    expect(after.eligibleLookIds[0]).toBe(liked)
    expect(after.look?.id).toBe(liked)
    expect(after.explanation).toContainEqual({
      key: 'liked-first',
      params: { lookId: liked },
    })
  })
})

describe('sample policy explanations', () => {
  it('adds still-suits when a control change leaves the outfit unchanged (U-SEL-UNCHANGED-EXPLAINED)', () => {
    const neutral = run()
    const warm = selectSampleOutfit(
      input({ comfort: comfort({ runsColdWarm: 'warm' }) }),
      SAMPLE_CATALOG,
      neutral
    )
    expect(ids(warm)).toEqual(ids(neutral))
    expect(warm.explanation).toContainEqual({
      key: 'still-suits',
      params: { control: 'runsColdWarm' },
    })
  })

  it('adds no still-suits when the outfit changes or nothing changed', () => {
    const neutral = run()
    const cold = selectSampleOutfit(
      input({ comfort: comfort({ runsColdWarm: 'cold' }) }),
      SAMPLE_CATALOG,
      neutral
    )
    expect(keys(cold)).not.toContain('still-suits')
    const same = selectSampleOutfit(input(), SAMPLE_CATALOG, neutral)
    expect(keys(same)).not.toContain('still-suits')
  })

  it('names the control for each comfort and weather change', () => {
    const base = run({
      weather: 'warm-rainy',
      comfort: comfort({ precipPreparedness: 'low' }),
    })
    const wind = selectSampleOutfit(
      input({
        weather: 'warm-rainy',
        comfort: comfort({ precipPreparedness: 'low', windTolerance: 'low' }),
      }),
      SAMPLE_CATALOG,
      base
    )
    expect(wind.explanation).toContainEqual({
      key: 'still-suits',
      params: { control: 'windTolerance' },
    })
    const mild = run()
    const lowRain = selectSampleOutfit(
      input({ comfort: comfort({ precipPreparedness: 'low' }) }),
      SAMPLE_CATALOG,
      mild
    )
    expect(lowRain.explanation).toContainEqual({
      key: 'still-suits',
      params: { control: 'precipPreparedness' },
    })
  })

  it('references only garments and context values in the same result (U-SEL-EXPLANATION-MATCH)', () => {
    const states = [
      input({ weather: 'cool-windy' }),
      input({ weather: 'warm-rainy', comfort: comfort({ runsColdWarm: 'cold' }) }),
      input({ comfort: comfort({ runsColdWarm: 'cold' }) }),
    ]
    for (const state of states) {
      const result = selectSampleOutfit(state, SAMPLE_CATALOG)
      for (const item of result.explanation) {
        if ('garmentId' in item.params)
          expect(ids(result)).toContain(item.params.garmentId)
        if ('lookId' in item.params) expect(result.look?.id).toBe(item.params.lookId)
        if ('range' in item.params) expect(item.params.range).toBe(result.context.range)
        if ('windSpeed' in item.params)
          expect(item.params.windSpeed).toBe(result.context.windSpeed)
        if ('rainPercent' in item.params) {
          expect(item.params.rainPercent).toBe(result.context.rainPercent)
        }
        if ('adjustedFeelsLike' in item.params) {
          expect(item.params.adjustedFeelsLike).toBe(result.context.adjustedFeelsLike)
        }
      }
    }
  })

  it('reports the weather and thermal reading first', () => {
    const cold = run({ comfort: comfort({ runsColdWarm: 'cold' }) })
    expect(cold.explanation.slice(0, 2)).toEqual([
      { key: 'weather', params: { weather: 'mild-dry', feelsLike: 16 } },
      {
        key: 'thermal-adjusted',
        params: { runsColdWarm: 'cold', adjustedFeelsLike: 13, range: 'cool' },
      },
    ])
    expect(cold.explanation).toContainEqual({
      key: 'layer-cold',
      params: { garmentId: 'sample:g:fleece-zip', adjustedFeelsLike: 13, threshold: 15 },
    })
  })
})

describe('sample policy weather first (U-SEL-WEATHER-FIRST)', () => {
  it('never lets a liked look that fails the range win', () => {
    const result = run({
      weather: 'cool-windy',
      votes: { 'sample:l:summer-linen': 'like' },
    })
    expect(result.eligibleLookIds).not.toContain('sample:l:summer-linen')
    expect(result.look?.id).not.toBe('sample:l:summer-linen')
  })

  it('ignores a layer swap that fails protection, with its cause', () => {
    const base = run({ weather: 'cool-windy' })
    const lookId = base.look?.id as string
    const result = run({
      weather: 'cool-windy',
      selectedLookId: lookId,
      swaps: { [lookId]: { outerwear: 'sample:g:fleece-zip' } },
    })
    expect(ids(result)[0]).toBe('sample:g:wool-overcoat')
    expect(result.explanation).toContainEqual({
      key: 'swap-ignored',
      params: { category: 'outerwear', cause: 'protection' },
    })
  })
})

describe('sample policy look cycling and empty states', () => {
  it('never returns the current look and cycles in order (U-SEL-ANOTHER)', () => {
    let result = run()
    const seen: string[] = []
    for (const _step of [...result.eligibleLookIds]) {
      void _step
      const current = result.look?.id as string
      seen.push(current)
      const next = nextSampleLook(result)
      expect(next).not.toEqual({ lookId: current })
      if (!('lookId' in next)) throw new Error('expected another look')
      result = run({ selectedLookId: next.lookId })
    }
    expect(seen).toEqual(result.eligibleLookIds)
    expect(result.look?.id).toBe(seen[0])
  })

  it('returns no-alternative with one eligible look', () => {
    const only = run()
    const votes = Object.fromEntries(
      only.eligibleLookIds.slice(1).map((lookId) => [lookId, 'dislike' as const])
    )
    const result = run({ votes })
    expect(result.eligibleLookIds).toHaveLength(1)
    expect(nextSampleLook(result)).toEqual({ reason: 'no-alternative' })
  })

  it('returns all-disliked with no look when every suitable look is disliked (U-SEL-ALL-DISLIKED)', () => {
    const base = run()
    const votes = Object.fromEntries(
      base.eligibleLookIds.map((id) => [id, 'dislike' as const])
    )
    const result = run({ votes })
    expect(result.reason).toBe('all-disliked')
    expect(result.look).toBeNull()
    expect(result.garments).toEqual([])
    expect(keys(result)).toContain('all-disliked')
    expect(nextSampleLook(result)).toEqual({ reason: 'no-alternative' })
  })

  it('returns no-eligible when nothing in the catalog suits (U-SEL-NO-ELIGIBLE)', () => {
    const tiny: SampleCatalog = {
      ...SAMPLE_CATALOG,
      looks: SAMPLE_CATALOG.looks.filter((look) => look.id === 'sample:l:summer-linen'),
    }
    const result = selectSampleOutfit(input({ weather: 'cool-windy' }), tiny)
    expect(result.reason).toBe('no-eligible')
    expect(result.look).toBeNull()
    expect(result.explanation.at(-1)).toEqual({
      key: 'no-eligible',
      params: { collection: 'all' },
    })
  })

  it('falls back from a stale selection and reports it (U-SEL-STALE-SELECTION)', () => {
    const result = run({ weather: 'cool-windy', selectedLookId: 'sample:l:summer-linen' })
    expect(result.look?.id).toBe(result.eligibleLookIds[0])
    expect(result.explanation).toContainEqual({
      key: 'stale-selection',
      params: { lookId: result.eligibleLookIds[0] },
    })
  })
})

describe('sample swaps (U-SWAP)', () => {
  it('offers alternatives that share the category, collection, range and protection', () => {
    const state = input({ weather: 'cool-windy', collection: 'menswear' })
    const context = buildSampleContext(state)
    const options = sampleSwapCandidates(SAMPLE_CATALOG, 'outerwear', state)
    expect(options.length).toBeGreaterThan(0)
    for (const option of options) {
      expect(option.category).toBe('outerwear')
      expect(option.collections).toContain('menswear')
      expect(option.windResistant).toBe(true)
      expect(garmentSuitsRange(option, context.range)).toBe(true)
    }
  })

  it('applies a valid swap and names it', () => {
    const base = run()
    const lookId = base.look?.id as string
    const result = run({
      selectedLookId: lookId,
      swaps: { [lookId]: { shoes: 'sample:g:white-sneakers' } },
    })
    expect(ids(result)).toContain('sample:g:white-sneakers')
    expect(ids(result)).not.toContain('sample:g:loafers')
    expect(result.explanation).toContainEqual({
      key: 'swap-applied',
      params: { category: 'shoes', garmentId: 'sample:g:white-sneakers' },
    })
  })

  it.each([
    ['unknown', 'sample:g:nope'],
    ['category', 'sample:g:sandals'],
    ['collection', 'sample:g:polo-shirt'],
    ['range', 'sample:g:cotton-tee'],
  ] as const)('ignores a %s swap and keeps the last valid outfit', (cause, garmentId) => {
    const category = 'top'
    const state = input({
      weather: 'cool-windy',
      collection: cause === 'collection' ? 'womenswear' : 'all',
      selectedLookId: 'sample:l:city-wool',
    })
    const base = selectSampleOutfit(state, SAMPLE_CATALOG)
    const result = selectSampleOutfit(
      { ...state, swaps: { 'sample:l:city-wool': { [category]: garmentId } } },
      SAMPLE_CATALOG
    )
    expect(ids(result)).toEqual(ids(base))
    expect(result.explanation).toContainEqual({
      key: 'swap-ignored',
      params: { category, cause },
    })
  })

  it('ignores a swap for a slot the outfit does not have', () => {
    const base = run()
    const lookId = base.look?.id as string
    const result = run({
      selectedLookId: lookId,
      swaps: { [lookId]: { outerwear: 'sample:g:denim-jacket' } },
    })
    expect(ids(result)).toEqual(ids(base))
    expect(keys(result)).not.toContain('swap-applied')
  })

  it('restores the starting composition when swaps are cleared ("Undo swaps")', () => {
    const base = run()
    const lookId = base.look?.id as string
    const swapped = run({
      selectedLookId: lookId,
      swaps: { [lookId]: { shoes: 'sample:g:white-sneakers' } },
    })
    const undone = run({ selectedLookId: lookId, swaps: {} })
    expect(ids(swapped)).not.toEqual(ids(base))
    expect(ids(undone)).toEqual(ids(base))
  })

  it('ranks exact range before close matches', () => {
    const state = input({
      weather: 'warm-rainy',
      comfort: comfort({ runsColdWarm: 'cold' }),
    })
    const options = sampleSwapCandidates(SAMPLE_CATALOG, 'outerwear', state)
    expect(options.map((option) => option.id)).toEqual([
      'sample:g:trench-coat',
      'sample:g:rain-shell',
    ])
  })
})

describe('sample feedback votes (U-VOTES)', () => {
  it('likes, dislikes, clears the active choice and replaces the other', () => {
    const id = 'sample:l:city-wool'
    const liked = toggleSampleVote({}, id, 'like')
    expect(liked).toEqual({ [id]: 'like' })
    expect(toggleSampleVote(liked, id, 'like')).toEqual({})
    expect(toggleSampleVote(liked, id, 'dislike')).toEqual({ [id]: 'dislike' })
  })

  it('counts progress over the nine cards only', () => {
    const progress = sampleFeedbackProgress(
      {
        'sample:l:city-wool': 'like',
        'sample:l:winter-knit': 'dislike',
        'sample:l:office-oxford': 'like',
        'sample:l:court-polo': 'like',
      },
      SAMPLE_CATALOG
    )
    expect(progress.reviewed).toBe(3)
    expect(progress.total).toBe(9)
    expect(progress.cards.every((card) => card.feedbackCard)).toBe(true)
  })
})

describe('sample policy layer gaps (G3)', () => {
  it('says layer-unavailable when a needed layer has no candidate', () => {
    const noOuterwear: SampleCatalog = {
      ...SAMPLE_CATALOG,
      garments: SAMPLE_CATALOG.garments.filter(
        (garment) => garment.category !== 'outerwear'
      ),
    }
    const result = selectSampleOutfit(input({ weather: 'cool-windy' }), noOuterwear)
    expect(result.garments.some((garment) => garment.category === 'outerwear')).toBe(
      false
    )
    expect(keys(result)).toContain('layer-unavailable')
    expect(keys(result)).not.toContain('no-layer')
  })
})
