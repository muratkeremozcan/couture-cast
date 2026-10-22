// Story 3.6 Task 3 step 1 owner: implement mobile React Native chip navigation component with touch snap scrolling in apps/mobile/components/chip-navigation.tsx
import React from 'react'
import { ScrollView, Pressable, Text, StyleSheet, View } from 'react-native'
import { useMobileAnalytics } from '@/src/analytics/mobile-analytics'
import { useTranslation } from 'react-i18next'
import { useAccessibilityAnnouncer } from '@/src/hooks/use-accessibility-announcer'

export type ChipCategory = 'Personal' | 'Community' | 'Sponsored'

const CHIP_CATEGORIES: ChipCategory[] = ['Personal', 'Community', 'Sponsored']

export interface MobileChipNavigationProps {
  activeCategory: ChipCategory
  onCategoryChange: (category: ChipCategory) => void
}

export function MobileChipNavigation({
  activeCategory,
  onCategoryChange,
}: MobileChipNavigationProps) {
  const analytics = useMobileAnalytics()
  const { t } = useTranslation()
  const { announce } = useAccessibilityAnnouncer()

  const handleSelect = (category: ChipCategory) => {
    if (category === activeCategory) {
      return
    }

    const previousCategory = activeCategory
    onCategoryChange(category)
    announce(
      'chip_change',
      t(`accessibility.chip_${category.toLowerCase()}`, { defaultValue: category })
    )

    try {
      analytics.capture('chip_changed', {
        chipCategory: category,
        previousCategory,
        surface: 'mobile',
      })
    } catch {
      // Analytics must never block selection.
    }
  }

  return (
    <View style={styles.container} testID="mobile-chip-navigation">
      {/* Chips size to their localized label, so there is no fixed snap interval. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        decelerationRate="fast"
        contentContainerStyle={styles.scrollContent}
      >
        {CHIP_CATEGORIES.map((category) => {
          const isActive = activeCategory === category
          const localizedCategory = t(`accessibility.chip_${category.toLowerCase()}`, {
            defaultValue: category,
          })

          return (
            <Pressable
              key={category}
              testID={`chip-${category.toLowerCase()}`}
              accessibilityRole="button"
              accessibilityState={{ selected: isActive }}
              aria-selected={isActive}
              accessibilityLabel={t('accessibility.chip_filter_label', {
                chip: localizedCategory,
              })}
              onPress={() => handleSelect(category)}
              style={({ pressed }) => [
                styles.chip,
                isActive ? styles.chipActive : styles.chipInactive,
                pressed && styles.chipPressed,
              ]}
            >
              <Text
                numberOfLines={1}
                style={[
                  styles.chipText,
                  isActive ? styles.chipTextActive : styles.chipTextInactive,
                ]}
              >
                {localizedCategory}
              </Text>
            </Pressable>
          )
        })}
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: 8,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E6E6ED',
  },
  scrollContent: {
    paddingHorizontal: 16,
    gap: 8,
  },
  chip: {
    // A minimum, not a fixed width: COMMUNAUTÉ, SPONSORISÉ and SPONSORIZZATO need more
    // label space than a fixed chip had and must never break mid-word. The minimum and
    // padding keep all three chips of the longest locale (it-IT) on a 360-point-wide
    // phone without scrolling.
    minWidth: 96,
    flexShrink: 0,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 9999,
    borderWidth: 1,
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  chipActive: {
    backgroundColor: '#C9A14A',
    borderColor: '#C9A14A',
  },
  chipInactive: {
    backgroundColor: '#F5F5F7',
    borderColor: '#E6E6ED',
  },
  chipPressed: {
    opacity: 0.8,
  },
  chipText: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  chipTextActive: {
    color: '#111111',
  },
  chipTextInactive: {
    color: '#5C5C66',
  },
})
