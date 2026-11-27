import type { ComfortRange } from '../comfort-rules'
import { SAMPLE_CATALOG } from './catalog'
import { sampleSwapCandidates, type SampleOutfitResult } from './selector'
import type { GuestPreviewStrings } from './strings'
import {
  SAMPLE_GARMENT_CATEGORIES,
  type SampleArtKey,
  type SampleCollectionFilter,
  type SampleGarment,
  type SampleGarmentCategory,
} from './types'

export type SampleGarmentType =
  | Exclude<
      SampleArtKey,
      'mini-skirt' | 'pleated-skirt' | 'knit-dress' | 'wrap-dress' | 'sundress'
    >
  | 'dress'

// The type comes from the sample illustration and stays within the bundled catalog.
export function sampleGarmentType(garment: SampleGarment): SampleGarmentType {
  switch (garment.art.key) {
    case 'mini-skirt':
    case 'pleated-skirt':
      return 'skirt'
    case 'knit-dress':
    case 'wrap-dress':
    case 'sundress':
      return 'dress'
    default:
      return garment.art.key
  }
}

const PICKER_TYPES = ['skirts', 'tights', 'socks'] as const
type PickerType = (typeof PICKER_TYPES)[number]
export type SampleWardrobeFilter = 'all' | SampleGarmentCategory | PickerType

const pickerGarmentType: Record<PickerType, SampleGarmentType> = {
  skirts: 'skirt',
  tights: 'tights',
  socks: 'socks',
}

export function sampleWardrobeCategories(strings: GuestPreviewStrings) {
  return [
    { value: 'all' as const, label: strings.wardrobe.allCategories },
    ...SAMPLE_GARMENT_CATEGORIES.map((value) => ({
      value,
      label: strings.values.categoryTitle[value],
    })),
    ...PICKER_TYPES.map((value) => ({
      value,
      label: strings.values.garmentType[pickerGarmentType[value]],
    })),
  ]
}

export function sampleWardrobeItems(
  filter: SampleWardrobeFilter,
  collection: SampleCollectionFilter
) {
  return SAMPLE_CATALOG.garments.filter(
    (garment) =>
      (collection === 'all' || garment.collections.includes(collection)) &&
      (filter === 'all' ||
        garment.category === filter ||
        sampleGarmentType(garment) === (filter === 'skirts' ? 'skirt' : filter))
  )
}

export const SAMPLE_SWAP_INITIAL_LIMIT = 12

export type SampleSwapOptions = {
  current: SampleGarment | undefined
  candidates: readonly SampleGarment[]
  range: ComfortRange
}

export function sampleOutfitSwapOptions(
  outfit: SampleOutfitResult,
  category: SampleGarmentCategory | null
): SampleSwapOptions {
  return {
    current: outfit.garments.find((garment) => garment.category === category),
    candidates: category
      ? sampleSwapCandidates(SAMPLE_CATALOG, category, outfit.input, outfit.context)
      : [],
    range: outfit.context.range,
  }
}

export function sampleSwapDisplay(
  current: SampleGarment | undefined,
  candidates: readonly SampleGarment[],
  range: ComfortRange,
  expanded: boolean
) {
  const exact = new Map<SampleGarmentType, SampleGarment[]>()
  const nearby = new Map<SampleGarmentType, SampleGarment[]>()
  const seen = new Set(current ? [current.id] : [])
  for (const garment of candidates) {
    if (seen.has(garment.id)) continue
    seen.add(garment.id)
    const tier = garment.comfortRanges.includes(range) ? exact : nearby
    const type = sampleGarmentType(garment)
    const group = tier.get(type)
    if (group) group.push(garment)
    else tier.set(type, [garment])
  }

  let nextIndex = current ? 1 : 0
  const limit = expanded ? Infinity : SAMPLE_SWAP_INITIAL_LIMIT
  const groups = (
    [
      ['exact', exact],
      ['nearby', nearby],
    ] as const
  ).flatMap(([fit, tier]) =>
    [...tier].flatMap(([type, group]) => {
      if (nextIndex >= limit) return []
      const firstIndex = nextIndex
      const garments = group.slice(0, limit - firstIndex)
      nextIndex += garments.length
      return [{ fit, type, garments, firstIndex }]
    })
  )

  return {
    current,
    groups,
    hasAlternatives: seen.size > Number(Boolean(current)),
    hasMore: seen.size > nextIndex,
  }
}
