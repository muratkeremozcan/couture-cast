import React from 'react'
import { StyleSheet, Pressable, Platform } from 'react-native'
import { Text, View } from '@/components/themed'
import { useHeroPalette } from './hero-theme'

type GarmentItemTileProps = {
  garmentId: string
  onSwap: (garmentId: string) => void
}

export function parseGarmentId(id: string) {
  const clean = id.replace(/-/g, ' ')
  const name = clean
    .split(' ')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')

  const lowercaseId = id.toLowerCase()
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

  const matched = mapping.find((m) => m.keys.some((k) => lowercaseId.includes(k)))
  const category = matched ? matched.category : 'Garment'

  return { name, category }
}

export function GarmentItemTile({ garmentId, onSwap }: GarmentItemTileProps) {
  const { name, category } = parseGarmentId(garmentId)
  const palette = useHeroPalette()

  return (
    <Pressable
      style={[
        styles.card,
        { backgroundColor: palette.surface, borderColor: palette.divider },
      ]}
      onPress={() => onSwap(garmentId)}
      testID={`garment-tile-${garmentId}`}
    >
      <View style={styles.content}>
        <View style={styles.textColumn}>
          <Text style={[styles.categoryText, { color: palette.mutedText }]}>
            {category}
          </Text>
          <Text style={[styles.nameText, { color: palette.text }]}>{name}</Text>
        </View>
        <View
          style={[
            styles.swapButton,
            { backgroundColor: palette.subtleSurface, borderColor: palette.divider },
          ]}
        >
          <Text style={styles.swapIcon}>⇄</Text>
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
    color: '#C9A14A', // accent gold color
    fontWeight: 'bold',
  },
})
