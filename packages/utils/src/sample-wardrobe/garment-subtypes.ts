import type { SampleGarmentCategory } from './types'

export const GARMENT_SUBTYPES_BY_CATEGORY = {
  top: ['camisole', 'tank', 'crop-top'],
  bottom: ['mini-skirt', 'midi-skirt', 'maxi-skirt', 'leggings'],
  outerwear: ['blazer', 'moto-jacket'],
  dress: [],
  shoes: ['moto-boots', 'ankle-boots', 'knee-boots'],
  accessory: ['tights', 'socks'],
} as const satisfies Record<SampleGarmentCategory, readonly string[]>

export type GarmentSubtype =
  (typeof GARMENT_SUBTYPES_BY_CATEGORY)[SampleGarmentCategory][number]

export const GARMENT_SUBTYPES: readonly GarmentSubtype[] = Object.values(
  GARMENT_SUBTYPES_BY_CATEGORY
).flat()

export function garmentSubtypesForCategory(
  category: SampleGarmentCategory | null | undefined
): readonly GarmentSubtype[] {
  return category ? GARMENT_SUBTYPES_BY_CATEGORY[category] : []
}

export function garmentSubtypeMatchesCategory(
  category: SampleGarmentCategory | null,
  subtype: unknown
): subtype is GarmentSubtype {
  return garmentSubtypesForCategory(category).some((value) => value === subtype)
}

/** Stable within a group, so the caller's existing eligibility and ordering still apply. */
export function preferGarmentSubtypes<T extends { subtype?: GarmentSubtype | null }>(
  choices: readonly T[],
  preferred: readonly GarmentSubtype[]
): T[] {
  const matches = (item: T) => item.subtype != null && preferred.includes(item.subtype)
  return [...choices.filter(matches), ...choices.filter((item) => !matches(item))]
}
