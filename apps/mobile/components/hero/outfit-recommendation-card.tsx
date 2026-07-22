import React, { useState } from 'react'
import { StyleSheet, Platform, Pressable } from 'react-native'
import { Text, View } from '@/components/themed'
import type { ScenarioOutfit } from '@couture/api-client/contracts/http'
import { GarmentItemTile } from './garment-item-tile'
import { useHeroPalette } from './hero-theme'

type OutfitRecommendationCardProps = {
  outfit?: ScenarioOutfit
  onSwapGarment: (garmentId: string) => void
  isLoading?: boolean
}

export function OutfitRecommendationCard({
  outfit,
  onSwapGarment,
  isLoading,
}: OutfitRecommendationCardProps) {
  const [selectedBadgeKey, setSelectedBadgeKey] = useState<string | null>(null)
  const palette = useHeroPalette()

  if (isLoading) {
    return (
      <View style={styles.skeletonContainer} testID="outfit-recommendation-card-skeleton">
        <View style={[styles.skeletonNotes, { backgroundColor: palette.skeleton }]} />
        <View style={styles.skeletonBadgeRow}>
          <View style={[styles.skeletonBadge, { backgroundColor: palette.skeleton }]} />
          <View style={[styles.skeletonBadge, { backgroundColor: palette.skeleton }]} />
        </View>
        <View style={[styles.skeletonTile, { backgroundColor: palette.skeleton }]} />
        <View style={[styles.skeletonTile, { backgroundColor: palette.skeleton }]} />
      </View>
    )
  }

  if (!outfit) {
    return null
  }

  const handleBadgePress = (key: string) => {
    setSelectedBadgeKey(selectedBadgeKey === key ? null : key)
  }

  const activeBadgeInfo = outfit.reasoningBadges?.find((b) => b.key === selectedBadgeKey)

  return (
    <View style={styles.container} testID="outfit-recommendation-card">
      {/* Comfort Notes */}
      <View
        style={[
          styles.notesContainer,
          { backgroundColor: palette.subtleSurface, borderColor: palette.divider },
        ]}
      >
        <Text style={[styles.comfortNotes, { color: palette.text }]}>
          {outfit.comfortNotes}
        </Text>
      </View>

      {/* Reasoning Badges */}
      {outfit.reasoningBadges && outfit.reasoningBadges.length > 0 && (
        <View style={styles.badgesSection}>
          <View style={styles.badgeRow}>
            {outfit.reasoningBadges.map((badge) => {
              const isSelected = selectedBadgeKey === badge.key
              return (
                <Pressable
                  key={badge.key}
                  onPress={() => handleBadgePress(badge.key)}
                  style={[
                    styles.badge,
                    { backgroundColor: palette.surface, borderColor: palette.divider },
                    isSelected && styles.badgeSelected,
                  ]}
                  testID={`reasoning-badge-${badge.key}`}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isSelected }}
                >
                  <Text
                    style={[
                      styles.badgeLabel,
                      { color: palette.text },
                      isSelected && styles.badgeLabelSelected,
                    ]}
                  >
                    {badge.label}
                  </Text>
                </Pressable>
              )
            })}
          </View>

          {/* Expanded Badge Details */}
          {activeBadgeInfo && (
            <View
              style={[
                styles.badgeDetails,
                { backgroundColor: palette.surface, borderColor: palette.divider },
              ]}
              testID="badge-details-panel"
            >
              <Text style={styles.detailsTitle}>
                {activeBadgeInfo.label} Justification:
              </Text>
              {activeBadgeInfo.bullets.map((bullet, idx) => (
                <Text key={idx} style={[styles.bulletText, { color: palette.text }]}>
                  • {bullet}
                </Text>
              ))}
            </View>
          )}
        </View>
      )}

      {/* Garments List */}
      <View style={styles.garmentsList}>
        {outfit.garmentIds.map((garmentId) => (
          <GarmentItemTile key={garmentId} garmentId={garmentId} onSwap={onSwapGarment} />
        ))}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: 'transparent',
  },
  notesContainer: {
    backgroundColor: 'rgba(0,0,0,0.02)',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E6E6ED',
    padding: 14,
    marginBottom: 16,
  },
  comfortNotes: {
    fontSize: 14,
    lineHeight: 20,
    color: '#111111',
    fontStyle: 'italic',
    fontFamily: Platform.select({
      ios: 'Playfair Display',
      android: 'Playfair Display',
      web: 'Playfair Display, serif',
      default: 'System',
    }),
  },
  badgesSection: {
    marginBottom: 16,
    backgroundColor: 'transparent',
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    backgroundColor: 'transparent',
  },
  badge: {
    borderWidth: 1,
    borderColor: '#E6E6ED',
    borderRadius: 16,
    paddingVertical: 6,
    paddingHorizontal: 12,
    backgroundColor: '#FFFFFF',
  },
  badgeSelected: {
    backgroundColor: '#C9A14A', // gold color
    borderColor: '#C9A14A',
  },
  badgeLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#111111',
    fontFamily: Platform.select({
      ios: 'SF Pro Text',
      android: 'Roboto',
      web: 'Inter, "SF Pro Text", -apple-system, sans-serif',
      default: 'System',
    }),
  },
  badgeLabelSelected: {
    color: '#FFFFFF',
  },
  badgeDetails: {
    marginTop: 8,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E6E6ED',
    borderRadius: 8,
    padding: 12,
    gap: 4,
    ...Platform.select({
      ios: {
        shadowColor: '#000000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.05,
        shadowRadius: 2,
      },
      android: {
        elevation: 1,
      },
      web: {
        boxShadow: '0 1px 2px rgba(0, 0, 0, 0.05)',
      },
    }),
  },
  detailsTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#C9A14A',
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    marginBottom: 4,
  },
  bulletText: {
    fontSize: 13,
    color: '#111111',
    lineHeight: 18,
  },
  garmentsList: {
    backgroundColor: 'transparent',
    gap: 8,
  },
  skeletonContainer: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: 'transparent',
    gap: 12,
  },
  skeletonNotes: {
    height: 60,
    backgroundColor: '#E6E6ED',
    borderRadius: 8,
  },
  skeletonBadgeRow: {
    flexDirection: 'row',
    gap: 8,
    backgroundColor: 'transparent',
  },
  skeletonBadge: {
    width: 80,
    height: 28,
    backgroundColor: '#E6E6ED',
    borderRadius: 14,
  },
  skeletonTile: {
    height: 60,
    backgroundColor: '#E6E6ED',
    borderRadius: 8,
  },
})
