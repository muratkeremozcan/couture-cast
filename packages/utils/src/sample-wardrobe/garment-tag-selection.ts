import {
  garmentSubtypeMatchesCategory,
  garmentSubtypesForCategory,
  type GarmentSubtype,
} from './garment-subtypes'
import type { SampleGarmentCategory } from './types'

export function confidentGarmentTag<T>(suggestion?: { value: T; isConfident: boolean }) {
  return suggestion?.isConfident ? suggestion.value : undefined
}

export function resolveGarmentSubtypeSelection(
  category: SampleGarmentCategory | null,
  chosen: GarmentSubtype | null | undefined,
  stored?: { category: SampleGarmentCategory | null; subtype?: GarmentSubtype | null },
  suggestions?: {
    category: { value: SampleGarmentCategory }
    subtype?: { value: GarmentSubtype | null; isConfident: boolean }
  }
) {
  const options = garmentSubtypesForCategory(category)
  const required = options.length > 0 && suggestions?.subtype !== undefined
  if (chosen === null || garmentSubtypeMatchesCategory(category, chosen)) {
    return { options, selected: chosen, save: chosen }
  }
  if (
    stored?.category === category &&
    garmentSubtypeMatchesCategory(category, stored.subtype)
  ) {
    return { options, selected: stored.subtype, save: undefined }
  }
  const suggested =
    suggestions?.category.value === category
      ? confidentGarmentTag(suggestions.subtype)
      : undefined
  const validSuggestion =
    suggested === null || garmentSubtypeMatchesCategory(category, suggested)
      ? suggested
      : undefined
  return {
    options,
    selected: required ? validSuggestion : null,
    save: required ? validSuggestion : undefined,
  }
}
