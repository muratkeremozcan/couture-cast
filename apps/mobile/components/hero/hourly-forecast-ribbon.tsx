import React, { useState } from 'react'
import { StyleSheet, ScrollView, Pressable, useWindowDimensions } from 'react-native'
import { Text, View } from '@/components/themed'
import {
  type WeatherHourlyEntry,
  defaultSupportedLocale,
  resolveSupportedLocale,
} from '@couture/api-client/contracts/http'
import { formatTemperature } from './weather-header'
import { useHeroPalette } from './hero-theme'
import { elevationStyle } from '@/src/theme/tokens'
import { weatherConditionGlyphs } from './weather-glyphs'
import { useTranslation } from 'react-i18next'
import i18n from '@/src/lib/i18n'
import {
  formatRainChance,
  formatWeatherAltText,
  getGuestPreviewStrings,
} from '@couture/utils'
import { getTemperatureUnit } from '@/src/lib/formatters'

type HourlyForecastRibbonProps = {
  hourly?: WeatherHourlyEntry[]
  isLoading?: boolean
  timeZone?: string
  showAll?: boolean
  onToggleExpand?: (isExpanded: boolean) => void
}

function formatHour(isoString: string, timeZone: string) {
  try {
    const date = new Date(isoString)
    return new Intl.DateTimeFormat(i18n.resolvedLanguage ?? i18n.language, {
      hour: 'numeric',
      timeZone,
    }).format(date)
  } catch {
    return ''
  }
}

export function HourlyForecastRibbon({
  hourly,
  isLoading,
  onToggleExpand,
  timeZone = 'UTC',
  showAll = false,
}: HourlyForecastRibbonProps) {
  const { t } = useTranslation()
  const [isExpanded, setIsExpanded] = useState(false)
  const palette = useHeroPalette()
  const { width, fontScale } = useWindowDimensions()
  const cardWidth = Math.min(width - 32, 88 * Math.max(1, fontScale))

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
              style={[styles.skeletonItem, { backgroundColor: palette.cardMuted }]}
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
  const visibleEntries = showAll || isExpanded ? hourly : hourly.slice(0, 8)

  return (
    <View style={styles.container} testID="hourly-forecast-ribbon">
      <View style={styles.headerRow}>
        <Text style={[styles.title, { color: palette.ink }]}>
          {t('hero.hourly_forecast', { defaultValue: 'Weather by hour' })}
        </Text>
        {!showAll && (
          <Pressable
            onPress={handleToggle}
            accessibilityRole="button"
            aria-expanded={isExpanded}
            style={[styles.toggleButton, { backgroundColor: palette.card }]}
            testID="ribbon-expand-toggle"
          >
            <Text style={[styles.toggleText, { color: palette.ink }]}>
              {isExpanded
                ? t('hero.collapse', { defaultValue: 'Collapse' })
                : t('hero.expand_hours', {
                    hours: hourly.length,
                    defaultValue: `Expand (${hourly.length}h)`,
                  })}
            </Text>
          </Pressable>
        )}
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {visibleEntries.map((item, index) => {
          const glyph = weatherConditionGlyphs[item.condition] || '❓'
          const locale =
            resolveSupportedLocale(i18n.resolvedLanguage ?? i18n.language) ??
            defaultSupportedLocale
          const rainChance = formatRainChance(
            item.precipitationProbability * 100,
            getGuestPreviewStrings(locale)
          )
          const condition = t(`hero.conditions.${item.condition}`, {
            defaultValue: item.condition,
          })
          const unit = getTemperatureUnit(locale)
          const temperature =
            unit === 'F' ? (item.temperature * 9) / 5 + 32 : item.temperature
          const description = formatWeatherAltText({
            conditionLabel: condition,
            temperature,
            unit,
            locale,
            descriptor: `${formatHour(item.forecastAt, timeZone)}, ${rainChance}`,
          })

          return (
            <View
              key={item.forecastAt || index}
              style={[
                styles.itemCard,
                {
                  backgroundColor: palette.card,
                  borderColor: palette.line,
                  width: cardWidth,
                },
              ]}
              testID="hourly-item"
              accessible
              accessibilityLabel={description}
            >
              <Text
                style={[styles.hourText, { color: palette.inkMuted }]}
                accessible={false}
              >
                {formatHour(item.forecastAt, timeZone)}
              </Text>
              <Text style={styles.glyph} accessible={false} aria-hidden>
                {glyph}
              </Text>
              <Text style={[styles.tempText, { color: palette.ink }]} accessible={false}>
                {formatTemperature(item.temperature)}
              </Text>
              {item.precipitationProbability > 0 && (
                <Text
                  style={[styles.precipText, { color: palette.inkSoft }]}
                  accessible={false}
                >
                  {rainChance}
                </Text>
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
    gap: 8,
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    marginBottom: 8,
    backgroundColor: 'transparent',
  },
  title: {
    flexShrink: 1,
    fontSize: 14,
    fontWeight: '700',
  },
  toggleButton: {
    // Centered, so the 44-pt box no longer hangs below a top-aligned label.
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 4,
  },
  toggleText: {
    fontSize: 12,
    fontWeight: '600',
  },
  scrollContent: {
    paddingHorizontal: 16,
    gap: 8,
  },
  itemCard: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 8,
    alignItems: 'center',
    gap: 4,
    ...elevationStyle('card'),
  },
  hourText: {
    fontSize: 12,
    fontWeight: '700',
  },
  glyph: {
    fontSize: 20,
  },
  tempText: {
    fontSize: 14,
    fontWeight: '700',
  },
  precipText: {
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
  },
  skeletonContainer: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: 'transparent',
  },
  skeletonItem: {
    width: 70,
    height: 90,
    borderRadius: 8,
    marginRight: 8,
  },
})
