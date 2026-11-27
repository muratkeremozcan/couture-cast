import { formatGarmentCategory } from './garment-alt'
import type { GarmentTagSource } from './garment-detail'
import { garmentSubtypeStrings } from './garment-subtype-strings'
import { garmentSubtypesForCategory, type GarmentSubtype } from './garment-subtypes'
import { SAMPLE_GARMENT_CATEGORIES, type SampleGarmentCategory } from './types'

export type ClosetGarmentFilter = {
  category: SampleGarmentCategory | 'all'
  subtype: GarmentSubtype | 'all'
}

type ClosetFilterChip = {
  id: string
  selected: boolean
  label: string
  filter: ClosetGarmentFilter
}

export function filterCloset<T extends Pick<GarmentTagSource, 'category' | 'subtype'>>(
  garments: readonly T[],
  filter: ClosetGarmentFilter,
  locale: string,
  allCategories: string
) {
  const categories = SAMPLE_GARMENT_CATEGORIES.filter((category) =>
    garments.some((garment) => garment.category === category)
  )
  const activeCategory =
    filter.category !== 'all' && categories.includes(filter.category)
      ? filter.category
      : 'all'
  const categoryGarments =
    activeCategory === 'all'
      ? garments
      : garments.filter((garment) => garment.category === activeCategory)
  const subtypes = garmentSubtypesForCategory(
    activeCategory === 'all' ? null : activeCategory
  ).filter((subtype) => categoryGarments.some((garment) => garment.subtype === subtype))
  const activeSubtype =
    filter.subtype !== 'all' && subtypes.includes(filter.subtype) ? filter.subtype : 'all'

  const subtypeStrings = garmentSubtypeStrings(locale)
  const filterChips = (['all', ...categories] as const).flatMap<ClosetFilterChip>(
    (category) => {
      const selected = category === activeCategory
      const categoryChip = {
        id: `closet-category-${category}`,
        selected,
        label:
          category === 'all' ? allCategories : formatGarmentCategory(locale, category),
        filter: { category, subtype: 'all' } as const,
      }
      if (!selected || subtypes.length === 0) return [categoryChip]
      return [
        categoryChip,
        ...(['all', ...subtypes] as const).map((subtype) => ({
          id: `closet-subtype-${subtype}`,
          selected: activeSubtype === subtype,
          label: subtype === 'all' ? subtypeStrings.all : subtypeStrings.values[subtype],
          filter: { category, subtype },
        })),
      ]
    }
  )
  const filteredGarments =
    activeSubtype === 'all'
      ? categoryGarments
      : categoryGarments.filter((garment) => garment.subtype === activeSubtype)
  return { filterChips, filteredGarments }
}
