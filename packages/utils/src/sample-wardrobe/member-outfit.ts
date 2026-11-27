import { SAMPLE_CATALOG } from './catalog'
import {
  DEFAULT_SAMPLE_COMFORT,
  nextSampleLook,
  sampleSwapCandidates,
  selectSampleOutfit,
  type SampleOutfitResult,
  type SampleSelectionInput,
  type SampleWeatherKey,
} from './selector'
import type { ClimateBand } from '../climate-band'
import { openSampleBookmark, type SampleBookmark } from './bookmarks'
import {
  SAMPLE_GARMENT_CATEGORIES,
  type SampleGarment,
  type SampleGarmentCategory,
} from './types'

export function createMemberSampleOutfit(weather: SampleWeatherKey = 'mild-dry') {
  const input: SampleSelectionInput = {
    weather,
    collection: 'all',
    comfort: DEFAULT_SAMPLE_COMFORT,
    votes: {},
    swaps: {},
  }
  return selectSampleOutfit(input, SAMPLE_CATALOG)
}

export const COMMUNITY_SAMPLE_WEATHER_BY_BAND = {
  cold_wet: 'cool-rainy',
  cold_dry: 'cool-windy',
  temperate_dry: 'mild-dry',
  temperate_wet: 'mild-rainy',
  warm_wet: 'warm-rainy',
  warm_dry: 'warm-dry',
} as const satisfies Record<ClimateBand, SampleWeatherKey>

export function communitySampleOutfits(band: ClimateBand | null) {
  const result = createMemberSampleOutfit(
    band ? COMMUNITY_SAMPLE_WEATHER_BY_BAND[band] : 'mild-dry'
  )
  return result.eligibleLookIds
    .slice(0, 3)
    .map((selectedLookId) =>
      selectSampleOutfit({ ...result.input, selectedLookId }, SAMPLE_CATALOG)
    )
}

export function updateMemberSampleOutfit(
  result: ReturnType<typeof createMemberSampleOutfit>,
  change:
    | Pick<SampleSelectionInput, 'preferences'>
    | Pick<SampleSelectionInput, 'weather'>
    | Pick<SampleSelectionInput, 'collection'>
) {
  return selectSampleOutfit(
    { ...result.input, ...change, selectedLookId: undefined },
    SAMPLE_CATALOG
  )
}

export function reopenMemberSampleOutfit(
  result: ReturnType<typeof createMemberSampleOutfit>,
  bookmark: SampleBookmark
) {
  return selectSampleOutfit(
    { ...result.input, ...openSampleBookmark(bookmark, result.input) },
    SAMPLE_CATALOG
  )
}

export function rotateMemberSampleOutfit(
  result: ReturnType<typeof createMemberSampleOutfit>
) {
  const next = nextSampleLook(result)
  return 'lookId' in next
    ? selectSampleOutfit({ ...result.input, selectedLookId: next.lookId }, SAMPLE_CATALOG)
    : result
}

export function swapMemberSampleGarment(
  result: ReturnType<typeof createMemberSampleOutfit>,
  category: SampleGarmentCategory,
  garmentId: string
) {
  return resolveMemberSampleSwap(result, category, garmentId) ?? result
}

function resolveMemberSampleSwap(
  result: SampleOutfitResult,
  category: SampleGarmentCategory,
  garmentId: string
) {
  const lookId = result.look?.id
  const current = result.garments.find((garment) => garment.category === category)
  if (!lookId || !current) return null
  const eligible = sampleSwapCandidates(
    SAMPLE_CATALOG,
    category,
    result.input,
    result.context
  )
  if (!eligible.some((garment) => garment.id === garmentId)) return null
  if (current.id === garmentId) return result
  return selectSampleOutfit(
    {
      ...result.input,
      selectedLookId: lookId,
      swaps: {
        ...result.input.swaps,
        [lookId]: { ...result.input.swaps[lookId], [category]: garmentId },
      },
    },
    SAMPLE_CATALOG
  )
}

export function memberSampleWardrobeChoices(result: SampleOutfitResult) {
  const garments = new Map(SAMPLE_CATALOG.garments.map((piece) => [piece.id, piece]))
  const looks = new Map(SAMPLE_CATALOG.looks.map((look) => [look.id, look]))
  const currentIds = new Set(result.garments.map((piece) => piece.id))
  const activeSwaps = result.look ? result.input.swaps[result.look.id] : undefined
  const swappedIds = new Set(
    result.garments.flatMap((piece) =>
      activeSwaps?.[piece.category] === piece.id ? [piece.id] : []
    )
  )
  const eligibleLooks = result.eligibleLookIds.flatMap((id) => looks.get(id) ?? [])
  const sharedPieces = (core: readonly string[], ids: ReadonlySet<string>) =>
    core.filter((id) => ids.has(id)).length
  eligibleLooks.sort(
    (first, second) =>
      sharedPieces(second.core, currentIds) - sharedPieces(first.core, currentIds) ||
      sharedPieces(second.core, swappedIds) - sharedPieces(first.core, swappedIds)
  )
  const choices = new Map<string, string>()

  for (const category of SAMPLE_GARMENT_CATEGORIES) {
    const current = result.garments.find((piece) => piece.category === category)
    if (current && result.look) choices.set(current.id, result.look.id)

    const canUseSlot = eligibleLooks.filter((look) =>
      look.core.some((id) => garments.get(id)?.category === category)
    )
    for (const garment of sampleSwapCandidates(
      SAMPLE_CATALOG,
      category,
      result.input,
      result.context
    )) {
      const lookId = current
        ? result.look?.id
        : (canUseSlot.find((look) => look.core.includes(garment.id)) ?? canUseSlot[0])?.id
      if (lookId) choices.set(garment.id, lookId)
    }
  }
  return choices
}

export function applyMemberSampleGarment(
  result: SampleOutfitResult,
  garment: SampleGarment,
  lookId: string
) {
  const target =
    lookId === result.look?.id
      ? result
      : selectSampleOutfit({ ...result.input, selectedLookId: lookId }, SAMPLE_CATALOG)
  return target.look?.id === lookId
    ? (resolveMemberSampleSwap(target, garment.category, garment.id) ?? result)
    : result
}

export function undoMemberSampleSwaps(
  result: ReturnType<typeof createMemberSampleOutfit>
) {
  const lookId = result.look?.id
  if (!lookId) return result
  const swaps = { ...result.input.swaps }
  delete swaps[lookId]
  return selectSampleOutfit({ ...result.input, swaps }, SAMPLE_CATALOG)
}
