import React, { useState } from 'react'
import { StyleSheet, ScrollView, Pressable, Platform } from 'react-native'
import { Text, View } from '@/components/themed'
import type { WeatherHourlyEntry } from '@couture/api-client/contracts/http'
import { formatTemperature } from './weather-header'
import { useHeroPalette } from './hero-theme'
import { weatherConditionGlyphs } from './weather-glyphs'
import { useTranslation } from 'react-i18next'
import i18n from '@/src/lib/i18n'

type HourlyForecastRibbonProps = {
  hourly?: WeatherHourlyEntry[]
  isLoading?: boolean
  onToggleExpand?: (isExpanded: boolean) => void
}

function formatHour(isoString: string) {
  try {
    const date = new Date(isoString)
    return new Intl.DateTimeFormat(i18n.resolvedLanguage ?? i18n.language, {
      hour: 'numeric',
      timeZone: 'UTC', // contract specifies UTC timestamps
    }).format(date)
  } catch {
    return ''
  }
}

export function HourlyForecastRibbon({
  hourly,
  isLoading,
  onToggleExpand,
}: HourlyForecastRibbonProps) {
  const { t } = useTranslation()
  const [isExpanded, setIsExpanded] = useState(false)
  const palette = useHeroPalette()

  const handleToggle = () => {
    const nextState = !isExpanded
    setIsExpanded(nextState)
    if (onToggleExpand) {
      onToggleExpand(nextState)
    }
  }

  if (isLoading) {
    return (
      <View style={styles.skeletonContainer} testID="hourly-forecast-ribbon-skeleton">
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {Array.from({ length: 6 }).map((_, idx) => (
            <View
              key={idx}
              style={[styles.skeletonItem, { backgroundColor: palette.skeleton }]}
            />
          ))}
        </ScrollView>
      </View>
    )
  }

  if (!hourly || hourly.length === 0) {
    return null
  }

  // If collapsed, show 8 items, otherwise show all 48
  const visibleEntries = isExpanded ? hourly : hourly.slice(0, 8)

  return (
    <View style={styles.container} testID="hourly-forecast-ribbon">
      <View style={styles.headerRow}>
        <Text style={[styles.title, { color: palette.text }]}>
          {t('hero.hourly_forecast', { defaultValue: 'Hourly Forecast' })}
        </Text>
        <Pressable
          onPress={handleToggle}
          style={[styles.toggleButton, { backgroundColor: palette.subtleSurface }]}
          testID="ribbon-expand-toggle"
        >
          <Text style={styles.toggleText}>
            {isExpanded
              ? t('hero.collapse', { defaultValue: 'Collapse' })
              : t('hero.expand_hours', {
                  hours: hourly.length,
                  defaultValue: `Expand (${hourly.length}h)`,
                })}
          </Text>
        </Pressable>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {visibleEntries.map((item, index) => {
          const glyph = weatherConditionGlyphs[item.condition] || '❓'
          const precipPercent = Math.round(item.precipitationProbability * 100)

          return (
            <View
              key={item.forecastAt || index}
              style={[
                styles.itemCard,
                { backgroundColor: palette.surface, borderColor: palette.divider },
              ]}
              testID="hourly-item"
            >
              <Text style={[styles.hourText, { color: palette.mutedText }]}>
                {formatHour(item.forecastAt)}
              </Text>
              <Text style={styles.glyph}>{glyph}</Text>
              <Text style={[styles.tempText, { color: palette.text }]}>
                {formatTemperature(item.temperature)}
              </Text>
              {precipPercent > 0 && (
                <Text style={styles.precipText}>{precipPercent}%</Text>
              )}
            </View>
          )
        })}
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: 12,
    backgroundColor: 'transparent',
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    marginBottom: 8,
    backgroundColor: 'transparent',
  },
  title: {
    fontSize: 14,
    fontWeight: '700',
    fontFamily: Platform.select({
      ios: 'SF Pro Text',
      android: 'Roboto',
      web: 'Inter, "SF Pro Text", -apple-system, sans-serif',
      default: 'System',
    }),
    color: '#111111',
  },
  toggleButton: {
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(0,0,0,0.05)',
  },
  toggleText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#C9A14A',
  },
  scrollContent: {
    paddingHorizontal: 16,
    gap: 8,
  },
  itemCard: {
    width: 70,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E6E6ED',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
    gap: 4,
    ...Platform.select({
      ios: {
        shadowColor: '#000000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.08,
        shadowRadius: 2,
      },
      android: {
        elevation: 1,
      },
      web: {
        boxShadow: '0 1px 2px rgba(0, 0, 0, 0.08)',
      },
    }),
  },
  hourText: {
    fontSize: 11,
    color: '#a3a3a3',
    fontFamily: Platform.select({
      ios: 'Space Grotesk Bold',
      android: 'Space Grotesk Bold',
      web: 'Space Grotesk, "SF Mono", monospace',
      default: 'System',
    }),
  },
  glyph: {
    fontSize: 20,
  },
  tempText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#111111',
    fontFamily: Platform.select({
      ios: 'Space Grotesk',
      android: 'Space Grotesk',
      web: 'Space Grotesk, "SF Mono", monospace',
      default: 'System',
    }),
  },
  precipText: {
    fontSize: 10,
    color: '#2f95dc',
    fontWeight: '600',
  },
  skeletonContainer: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: 'transparent',
  },
  skeletonItem: {
    width: 70,
    height: 90,
    backgroundColor: '#E6E6ED',
    borderRadius: 8,
    marginRight: 8,
  },
})
