import { SAMPLE_CATALOG } from './catalog'
import {
  DEFAULT_SAMPLE_COMFORT,
  nextSampleLook,
  selectSampleOutfit,
  type SampleSelectionInput,
  type SampleWeatherKey,
} from './selector'
import type { ClimateBand } from '../climate-band'
import { openSampleBookmark, type SampleBookmark } from './bookmarks'
import type { SampleGarmentCategory } from './types'

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
  const lookId = result.look?.id
  if (!lookId) return result
  return selectSampleOutfit(
    {
      ...result.input,
      swaps: {
        ...result.input.swaps,
        [lookId]: { ...result.input.swaps[lookId], [category]: garmentId },
      },
    },
    SAMPLE_CATALOG
  )
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
