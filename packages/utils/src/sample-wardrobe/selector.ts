// Story 6.16 D5: the one deterministic, versioned sample policy both clients run.
// It reads the shared comfort rules, so the guest preview and the authenticated ritual
// engine agree on thresholds. Outfit and explanation come from one result object.
import {
  adjustFeelsLike,
  CLOSE_COMFORT_MATCHES,
  needsOuterwear,
  OUTERWEAR_THRESHOLD_CELSIUS,
  rainAmountExceeds,
  rainProbabilityExceeds,
  resolveComfortRangeFromTemperature,
  getRainProbThreshold,
  getWindThreshold,
  windExceeds,
  type ComfortRange,
  type ComfortRun,
  type ComfortTolerance,
} from '../comfort-rules'
import type {
  SampleCatalog,
  SampleCollectionFilter,
  SampleGarment,
  SampleGarmentCategory,
  SampleLook,
} from './types'

export const SAMPLE_POLICY_VERSION = 1

export const SAMPLE_WEATHER_KEYS = ['cool-windy', 'mild-dry', 'warm-rainy'] as const
export type SampleWeatherKey = (typeof SAMPLE_WEATHER_KEYS)[number]

export type SampleWeather = {
  feelsLike: number
  windSpeed: number
  precipitationProbability: number
  precipitationAmount: number
}

/** Example conditions on the rule thresholds, so each control visibly matters. */
export const SAMPLE_WEATHER: Readonly<Record<SampleWeatherKey, SampleWeather>> = {
  'cool-windy': {
    feelsLike: 9,
    windSpeed: 6.5,
    precipitationProbability: 0.1,
    precipitationAmount: 0,
  },
  'mild-dry': {
    feelsLike: 16,
    windSpeed: 2,
    precipitationProbability: 0,
    precipitationAmount: 0,
  },
  'warm-rainy': {
    feelsLike: 22,
    windSpeed: 3,
    precipitationProbability: 0.6,
    precipitationAmount: 1.2,
  },
}

export type SampleComfort = {
  runsColdWarm: ComfortRun
  windTolerance: ComfortTolerance
  precipPreparedness: ComfortTolerance
}

export const DEFAULT_SAMPLE_COMFORT: SampleComfort = {
  runsColdWarm: 'neutral',
  windTolerance: 'medium',
  precipPreparedness: 'medium',
}

export type SampleVote = 'like' | 'dislike'

export type SampleSelectionInput = {
  weather: SampleWeatherKey
  collection: SampleCollectionFilter
  comfort: SampleComfort
  selectedLookId?: string
  votes: Readonly<Record<string, SampleVote>>
  swaps: Readonly<
    Record<string, Readonly<Partial<Record<SampleGarmentCategory, string>>>>
  >
}

export type SampleContext = {
  weather: SampleWeatherKey
  feelsLike: number
  adjustedFeelsLike: number
  range: ComfortRange
  coldLayer: boolean
  windLayer: boolean
  rainReady: boolean
  windSpeed: number
  windThreshold: number
  rainPercent: number
  rainThresholdPercent: number
}

export type SampleExplanationKey =
  | 'weather'
  | 'thermal-neutral'
  | 'thermal-adjusted'
  | 'layer-cold'
  | 'layer-wind'
  | 'layer-rain'
  | 'no-layer'
  | 'layer-unavailable'
  | 'wind-within'
  | 'rain-within'
  | 'liked-first'
  | 'stale-selection'
  | 'swap-applied'
  | 'swap-ignored'
  | 'still-suits'
  | 'all-disliked'
  | 'no-eligible'

export type SampleExplanation = {
  key: SampleExplanationKey
  params: Readonly<Record<string, string | number>>
}

export type SampleOutfitReason = 'ok' | 'all-disliked' | 'no-eligible'

export type SampleOutfitResult = {
  policyVersion: number
  catalogVersion: string
  input: SampleSelectionInput
  reason: SampleOutfitReason
  context: SampleContext
  look: SampleLook | null
  /** Display order: outerwear, top, dress, bottom, shoes, accessory. */
  garments: SampleGarment[]
  eligibleLookIds: string[]
  explanation: SampleExplanation[]
}

const DISPLAY_ORDER: readonly SampleGarmentCategory[] = [
  'outerwear',
  'top',
  'dress',
  'bottom',
  'shoes',
  'accessory',
]

export function buildSampleContext(
  input: Pick<SampleSelectionInput, 'weather' | 'comfort'>
): SampleContext {
  const weather = SAMPLE_WEATHER[input.weather]
  const { runsColdWarm, windTolerance, precipPreparedness } = input.comfort
  const adjustedFeelsLike = adjustFeelsLike(weather.feelsLike, runsColdWarm)
  return {
    weather: input.weather,
    feelsLike: weather.feelsLike,
    adjustedFeelsLike,
    range: resolveComfortRangeFromTemperature(adjustedFeelsLike),
    coldLayer: needsOuterwear(adjustedFeelsLike),
    windLayer: windExceeds(weather.windSpeed, windTolerance),
    rainReady:
      rainProbabilityExceeds(weather.precipitationProbability, precipPreparedness) ||
      rainAmountExceeds(weather.precipitationAmount, precipPreparedness),
    windSpeed: weather.windSpeed,
    windThreshold: getWindThreshold(windTolerance),
    rainPercent: Math.round(weather.precipitationProbability * 100),
    rainThresholdPercent: Math.round(getRainProbThreshold(precipPreparedness) * 100),
  }
}

export function garmentSuitsRange(garment: SampleGarment, range: ComfortRange): boolean {
  return (
    garment.comfortRanges.includes(range) ||
    CLOSE_COMFORT_MATCHES[range].some((close) => garment.comfortRanges.includes(close))
  )
}

function inCollection(
  collections: readonly string[],
  filter: SampleCollectionFilter
): boolean {
  return filter === 'all' || collections.includes(filter)
}

function needsLayer(context: SampleContext): boolean {
  return context.coldLayer || context.windLayer || context.rainReady
}

function meetsProtection(garment: SampleGarment, context: SampleContext): boolean {
  if (garment.category !== 'outerwear') return true
  return (
    (!context.windLayer || garment.windResistant) &&
    (!context.rainReady || garment.waterResistant)
  )
}

function garmentById(catalog: SampleCatalog): Map<string, SampleGarment> {
  return new Map(catalog.garments.map((garment) => [garment.id, garment]))
}

function lookSuits(
  lookItem: SampleLook,
  garments: Map<string, SampleGarment>,
  input: SampleSelectionInput,
  context: SampleContext
): boolean {
  if (!inCollection(lookItem.collections, input.collection)) return false
  return lookItem.core.every((id) => {
    const garment = garments.get(id)
    return garment !== undefined && garmentSuitsRange(garment, context.range)
  })
}

function exactRangeShare(
  lookItem: SampleLook,
  garments: Map<string, SampleGarment>,
  range: ComfortRange
): number {
  const exact = lookItem.core.filter((id) =>
    garments.get(id)?.comfortRanges.includes(range)
  )
  return exact.length / lookItem.core.length
}

/** Exact range first, then the close matches in table order, then catalog order. */
function rankByRange(
  candidates: readonly SampleGarment[],
  range: ComfortRange
): SampleGarment[] {
  const order = [range, ...CLOSE_COMFORT_MATCHES[range]]
  const rank = (garment: SampleGarment) => {
    const index = order.findIndex((value) => garment.comfortRanges.includes(value))
    return index === -1 ? order.length : index
  }
  return candidates
    .map((garment, index) => ({ garment, index, rank: rank(garment) }))
    .filter((entry) => entry.rank < order.length)
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((entry) => entry.garment)
}

/** Every garment of a category that fits the context, ranked as the policy picks. */
export function sampleSwapCandidates(
  catalog: SampleCatalog,
  category: SampleGarmentCategory,
  input: Pick<SampleSelectionInput, 'collection' | 'weather' | 'comfort'>,
  context: SampleContext = buildSampleContext(input)
): SampleGarment[] {
  const candidates = catalog.garments.filter(
    (garment) =>
      garment.category === category &&
      inCollection(garment.collections, input.collection) &&
      meetsProtection(garment, context)
  )
  return rankByRange(candidates, context.range)
}

type SwapCheck =
  | { garment: SampleGarment }
  | { cause: 'unknown' | 'category' | 'collection' | 'range' | 'protection' }

function checkSwap(
  garmentId: string,
  category: SampleGarmentCategory,
  garments: Map<string, SampleGarment>,
  input: SampleSelectionInput,
  context: SampleContext
): SwapCheck {
  const garment = garments.get(garmentId)
  if (!garment) return { cause: 'unknown' }
  if (garment.category !== category) return { cause: 'category' }
  if (!inCollection(garment.collections, input.collection)) return { cause: 'collection' }
  if (!garmentSuitsRange(garment, context.range)) return { cause: 'range' }
  if (!meetsProtection(garment, context)) return { cause: 'protection' }
  return { garment }
}

function contextExplanation(
  context: SampleContext,
  comfort: SampleComfort
): SampleExplanation[] {
  const items: SampleExplanation[] = [
    {
      key: 'weather',
      params: { weather: context.weather, feelsLike: context.feelsLike },
    },
    comfort.runsColdWarm === 'neutral'
      ? {
          key: 'thermal-neutral',
          params: { feelsLike: context.feelsLike, range: context.range },
        }
      : {
          key: 'thermal-adjusted',
          params: {
            runsColdWarm: comfort.runsColdWarm,
            adjustedFeelsLike: context.adjustedFeelsLike,
            range: context.range,
          },
        },
  ]
  if (!context.windLayer && context.windSpeed > 0) {
    items.push({
      key: 'wind-within',
      params: { windSpeed: context.windSpeed, windThreshold: context.windThreshold },
    })
  }
  if (!context.rainReady && context.rainPercent > 0) {
    items.push({
      key: 'rain-within',
      params: {
        rainPercent: context.rainPercent,
        rainThresholdPercent: context.rainThresholdPercent,
      },
    })
  }
  return items
}

function layerExplanation(
  layer: SampleGarment | null,
  context: SampleContext
): SampleExplanation[] {
  if (!layer) {
    // G3: a needed layer the catalog cannot supply is said plainly, never as "no layer needed".
    const key = needsLayer(context) ? 'layer-unavailable' : 'no-layer'
    return [{ key, params: { range: context.range } }]
  }
  const items: SampleExplanation[] = []
  if (context.coldLayer) {
    items.push({
      key: 'layer-cold',
      params: {
        garmentId: layer.id,
        adjustedFeelsLike: context.adjustedFeelsLike,
        threshold: OUTERWEAR_THRESHOLD_CELSIUS,
      },
    })
  }
  if (context.windLayer) {
    items.push({
      key: 'layer-wind',
      params: {
        garmentId: layer.id,
        windSpeed: context.windSpeed,
        windThreshold: context.windThreshold,
      },
    })
  }
  if (context.rainReady) {
    items.push({
      key: 'layer-rain',
      params: {
        garmentId: layer.id,
        rainPercent: context.rainPercent,
        rainThresholdPercent: context.rainThresholdPercent,
      },
    })
  }
  return items
}

const CHANGE_CONTROLS = [
  ['weather', (input: SampleSelectionInput) => input.weather],
  ['runsColdWarm', (input: SampleSelectionInput) => input.comfort.runsColdWarm],
  ['windTolerance', (input: SampleSelectionInput) => input.comfort.windTolerance],
  [
    'precipPreparedness',
    (input: SampleSelectionInput) => input.comfort.precipPreparedness,
  ],
] as const

function sameOutfit(a: SampleOutfitResult, b: SampleOutfitResult): boolean {
  return (
    a.look?.id === b.look?.id &&
    a.garments.map((garment) => garment.id).join('|') ===
      b.garments.map((garment) => garment.id).join('|')
  )
}

/**
 * Runs the policy. Pass the previous result to get the `still-suits` explanation when a
 * weather or comfort change leaves the outfit as it was.
 */
// eslint-disable-next-line complexity
export function selectSampleOutfit(
  input: SampleSelectionInput,
  catalog: SampleCatalog,
  previous?: SampleOutfitResult
): SampleOutfitResult {
  const context = buildSampleContext(input)
  const garments = garmentById(catalog)
  const base = {
    policyVersion: SAMPLE_POLICY_VERSION,
    catalogVersion: catalog.catalogVersion,
    input,
    context,
  }

  const suitable = catalog.looks.filter((lookItem) =>
    lookSuits(lookItem, garments, input, context)
  )
  const notDisliked = suitable.filter(
    (lookItem) => input.votes[lookItem.id] !== 'dislike'
  )
  // Liked looks first, then the share of core garments made for this exact range,
  // then catalog order. Votes only reorder looks the weather already allows.
  const ordered = notDisliked
    .map((lookItem, index) => ({
      lookItem,
      index,
      liked: input.votes[lookItem.id] === 'like' ? 1 : 0,
      fit: exactRangeShare(lookItem, garments, context.range),
    }))
    .sort((a, b) => b.liked - a.liked || b.fit - a.fit || a.index - b.index)
    .map((entry) => entry.lookItem)
  const eligibleLookIds = ordered.map((lookItem) => lookItem.id)
  const explanation = contextExplanation(context, input.comfort)

  if (ordered.length === 0) {
    const reason: SampleOutfitReason =
      suitable.length > 0 ? 'all-disliked' : 'no-eligible'
    return {
      ...base,
      reason,
      look: null,
      garments: [],
      eligibleLookIds,
      explanation: [
        ...explanation,
        { key: reason, params: { collection: input.collection } },
      ],
    }
  }

  const stored = input.selectedLookId
  const storedLook = ordered.find((lookItem) => lookItem.id === stored)
  const selected = storedLook ?? (ordered[0] as SampleLook)
  if (stored !== undefined && !storedLook) {
    explanation.push({ key: 'stale-selection', params: { lookId: selected.id } })
  }
  if (input.votes[selected.id] === 'like') {
    explanation.push({ key: 'liked-first', params: { lookId: selected.id } })
  }

  const swaps = input.swaps[selected.id] ?? {}
  const outfit = new Map<SampleGarmentCategory, SampleGarment>()
  for (const id of selected.core) {
    const garment = garments.get(id) as SampleGarment
    outfit.set(garment.category, garment)
  }
  if (needsLayer(context)) {
    const layer = sampleSwapCandidates(catalog, 'outerwear', input, context)[0]
    if (layer) outfit.set('outerwear', layer)
  }

  for (const category of DISPLAY_ORDER) {
    const swapId = swaps[category]
    if (swapId === undefined || !outfit.has(category)) continue
    const check = checkSwap(swapId, category, garments, input, context)
    if ('garment' in check) {
      outfit.set(category, check.garment)
      explanation.push({
        key: 'swap-applied',
        params: { category, garmentId: check.garment.id },
      })
    } else {
      explanation.push({ key: 'swap-ignored', params: { category, cause: check.cause } })
    }
  }

  const layer = outfit.get('outerwear') ?? null
  explanation.push(...layerExplanation(layer, context))

  const result: SampleOutfitResult = {
    ...base,
    reason: 'ok',
    look: selected,
    garments: DISPLAY_ORDER.flatMap((category) => {
      const garment = outfit.get(category)
      return garment ? [garment] : []
    }),
    eligibleLookIds,
    explanation,
  }

  if (previous && sameOutfit(previous, result)) {
    const changed = CHANGE_CONTROLS.find(
      ([, read]) => read(previous.input) !== read(input)
    )
    if (changed) explanation.push({ key: 'still-suits', params: { control: changed[0] } })
  }
  return result
}

export type SampleNextLook = { lookId: string } | { reason: 'no-alternative' }

/** "Try another look": the next eligible look in order, cycling, never the current one. */
export function nextSampleLook(result: SampleOutfitResult): SampleNextLook {
  const ids = result.eligibleLookIds
  const current = result.look?.id
  if (current === undefined || ids.length < 2) return { reason: 'no-alternative' }
  const index = ids.indexOf(current)
  return { lookId: ids[(index + 1) % ids.length] as string }
}

/** The nine optional feedback cards and how many carry a vote. */
export function sampleFeedbackProgress(
  votes: Readonly<Record<string, SampleVote>>,
  catalog: SampleCatalog
): { reviewed: number; total: number; cards: SampleLook[] } {
  const cards = catalog.looks.filter((lookItem) => lookItem.feedbackCard)
  return {
    reviewed: cards.filter((card) => votes[card.id] !== undefined).length,
    total: cards.length,
    cards,
  }
}

/** Pressing the active choice clears it; pressing the other choice replaces it. */
export function toggleSampleVote(
  votes: Readonly<Record<string, SampleVote>>,
  lookId: string,
  vote: SampleVote
): Record<string, SampleVote> {
  const next = { ...votes }
  if (next[lookId] === vote) delete next[lookId]
  else next[lookId] = vote
  return next
}
