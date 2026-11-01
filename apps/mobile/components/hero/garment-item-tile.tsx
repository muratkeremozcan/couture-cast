import React, { type ComponentRef } from 'react'
import { StyleSheet, Pressable, Platform } from 'react-native'
import { Text, View } from '@/components/themed'
import { useHeroPalette } from './hero-theme'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import type { GarmentCategory } from '@couture/api-client/contracts/http'
import { formatGarmentAltText } from '@couture/utils'

type GarmentItemTileProps = {
  garmentId: string
  /** Wardrobe category from the ritual response, when it sent one. */
  category?: GarmentCategory | null
  onSwap: (garmentId: string, trigger?: number | { focus?: () => void }) => void
  onRef?: (garmentId: string, element: ComponentRef<typeof Pressable> | null) => void
}

const PLACEHOLDER_PREFIX = 'default-'

/**
 * The fixed swap catalogue, by tile group. Its ids are readable names
 * (`blazer`, `classic-trench-coat`), unlike wardrobe ids (UUIDs, cuids).
 */
export const SWAP_CATALOGUE: Record<string, string[]> = {
  Outerwear: [
    'classic-trench-coat',
    'leather-jacket',
    'denim-jacket',
    'wool-coat',
    'blazer',
  ],
  Bottoms: ['navy-chinos', 'denim-jeans', 'corduroy-pants', 'shorts', 'linen-trousers'],
  Tops: ['crewneck-sweater', 'hoodie', 'casual-tee', 'button-down-shirt', 'knit-polo'],
  Footwear: ['leather-boots', 'canvas-sneakers', 'loafers', 'derby-shoes'],
  Accessories: ['umbrella', 'wool-scarf', 'leather-gloves', 'sunglasses', 'beanie'],
  Garment: ['basic-socks', 'leather-belt'],
}

const CATALOGUE_GROUP_BY_ID = new Map(
  Object.entries(SWAP_CATALOGUE).flatMap(([group, ids]) =>
    ids.map((id) => [id, group] as const)
  )
)

/**
 * A hyphenated readable slug such as `trench-coat`, for catalogue-style ids
 * outside `SWAP_CATALOGUE`. A wardrobe id never matches: UUIDs carry digits and
 * cuids carry no hyphen.
 */
const READABLE_SLUG = /^[a-z]+(?:-[a-z]+)+$/

const CATEGORY_GROUP: Record<GarmentCategory, string> = {
  top: 'Tops',
  bottom: 'Bottoms',
  outerwear: 'Outerwear',
  dress: 'Garment',
  shoes: 'Footwear',
  accessory: 'Accessories',
}

function isGarmentCategory(value: string): value is GarmentCategory {
  return value in CATEGORY_GROUP
}

export type GarmentDisplayParts = {
  /** Readable name, or null when the id carries none (see `parseGarmentId`). */
  name: string | null
  /** Tile group: Outerwear, Tops, Bottoms, Footwear, Accessories or Garment. */
  category: string
  /** Wardrobe category when known, for a localized label. */
  wardrobeCategory: GarmentCategory | null
}

/**
 * Display parts for a garment id. Only catalogue slugs (`trench-coat`) carry a
 * readable name. Wardrobe ids are opaque and `default-<category>` placeholders
 * name only a slot, so for those `name` is null and callers label the garment by
 * its category. Title-casing every id is what put a raw UUID on the home card.
 */
export function parseGarmentId(
  id: string,
  knownCategory?: GarmentCategory | null
): GarmentDisplayParts {
  const placeholder = id.startsWith(PLACEHOLDER_PREFIX)
    ? id.slice(PLACEHOLDER_PREFIX.length)
    : undefined
  const wardrobeCategory =
    knownCategory ?? (placeholder && isGarmentCategory(placeholder) ? placeholder : null)
  if (wardrobeCategory) {
    return { name: null, category: CATEGORY_GROUP[wardrobeCategory], wardrobeCategory }
  }
  const catalogueGroup = CATALOGUE_GROUP_BY_ID.get(id)
  if (!catalogueGroup && !READABLE_SLUG.test(id)) {
    return { name: null, category: 'Garment', wardrobeCategory: null }
  }

  const name = id
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')

  const mapping = [
    {
      keys: ['coat', 'jacket', 'trench', 'blazer', 'cardigan'],
      category: 'Outerwear',
    },
    {
      keys: ['pants', 'chinos', 'jeans', 'trousers', 'shorts'],
      category: 'Bottoms',
    },
    { keys: ['shirt', 'tee', 'sweater', 'hoodie', 'top'], category: 'Tops' },
    { keys: ['shoes', 'boots', 'sneakers', 'loafers'], category: 'Footwear' },
    { keys: ['scarf', 'beanie', 'umbrella', 'gloves', 'hat'], category: 'Accessories' },
  ]

  if (catalogueGroup) {
    return { name, category: catalogueGroup, wardrobeCategory: null }
  }

  const matched = mapping.find((m) => m.keys.some((k) => id.includes(k)))
  return {
    name,
    category: matched ? matched.category : 'Garment',
    wardrobeCategory: null,
  }
}

/**
 * The title shown and announced for a garment: its name, else its localized
 * wardrobe category, else the localized word "garment". Never the id.
 */
export function garmentTitle(
  parts: GarmentDisplayParts,
  t: TFunction,
  locale: string
): string {
  if (parts.name) return parts.name
  if (parts.wardrobeCategory) {
    return t(`wardrobe.tagging.options.category.${parts.wardrobeCategory}`)
  }
  const word = t('accessibility.garment_category_garment', { defaultValue: 'garment' })
  return word.charAt(0).toLocaleUpperCase(locale) + word.slice(1)
}

export function GarmentItemTile({
  garmentId,
  category: knownCategory,
  onSwap,
  onRef,
}: GarmentItemTileProps) {
  const parts = parseGarmentId(garmentId, knownCategory)
  const palette = useHeroPalette()
  const { i18n, t } = useTranslation()
  const locale = i18n.resolvedLanguage ?? i18n.language
  const title = garmentTitle(parts, t, locale)
  const localizedCategory = t(
    `accessibility.garment_category_${parts.category.toLowerCase()}`,
    { defaultValue: parts.category }
  )
  // A garment with no name is already titled by its category; repeating the
  // group as a descriptor would read "Shoes: footwear".
  const label = formatGarmentAltText(
    t('accessibility.garment_item_alt', { title }),
    parts.name ? [localizedCategory] : [],
    locale
  )

  return (
    <Pressable
      ref={(element) => onRef?.(garmentId, element)}
      style={[
        styles.card,
        { backgroundColor: palette.surface, borderColor: palette.divider },
      ]}
      onPress={(event) =>
        onSwap(
          garmentId,
          event.currentTarget as unknown as number | { focus?: () => void }
        )
      }
      testID={`garment-tile-${garmentId}`}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={t('accessibility.garment_swap_hint')}
    >
      <View style={styles.content}>
        <View style={styles.textColumn}>
          {/* A named catalogue item gets its group above the name. A wardrobe
              garment has no name, so its category is the title on its own
              rather than repeated as a group above itself. */}
          {parts.name && (
            <Text style={[styles.categoryText, { color: palette.mutedText }]}>
              {localizedCategory}
            </Text>
          )}
          <Text style={[styles.nameText, { color: palette.text }]}>{title}</Text>
        </View>
        <View
          style={[
            styles.swapButton,
            { backgroundColor: palette.subtleSurface, borderColor: palette.divider },
          ]}
        >
          <Text style={[styles.swapIcon, { color: palette.accentText }]}>⇄</Text>
        </View>
      </View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E6E6ED',
    padding: 14,
    marginVertical: 4,
    ...Platform.select({
      ios: {
        shadowColor: '#000000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.08,
        shadowRadius: 4,
      },
      android: {
        elevation: 2,
      },
      web: {
        boxShadow: '0 2px 4px rgba(0, 0, 0, 0.08)',
      },
    }),
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'transparent',
  },
  textColumn: {
    backgroundColor: 'transparent',
    flex: 1,
  },
  categoryText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#a3a3a3',
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    fontFamily: Platform.select({
      ios: 'SF Pro Text',
      android: 'Roboto',
      web: 'Inter, "SF Pro Text", -apple-system, sans-serif',
      default: 'System',
    }),
    marginBottom: 4,
  },
  nameText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#111111',
    fontFamily: Platform.select({
      ios: 'SF Pro Text',
      android: 'Roboto',
      web: 'Inter, "SF Pro Text", -apple-system, sans-serif',
      default: 'System',
    }),
  },
  swapButton: {
    backgroundColor: 'rgba(0,0,0,0.02)',
    borderRadius: 15,
    width: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#E6E6ED',
  },
  swapIcon: {
    fontSize: 14,
    fontWeight: 'bold',
  },
})
