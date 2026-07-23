import React from 'react'
import { StyleSheet, Platform } from 'react-native'
import { Text, View } from '@/components/themed'
import {
  defaultSupportedLocale,
  resolveSupportedLocale,
  type WeatherCurrent,
} from '@couture/api-client/contracts/http'
import { useHeroPalette } from './hero-theme'
import { weatherConditionGlyphs } from './weather-glyphs'
import { useTranslation } from 'react-i18next'
import { formatTemperature as localizedFormatTemperature } from '@/src/lib/formatters'
import i18n from '@/src/lib/i18n'

type WeatherHeaderProps = {
  current?: WeatherCurrent
  isLoading?: boolean
}

export function formatTemperature(celsius: number, forceFahrenheit?: boolean) {
  if (forceFahrenheit !== undefined) {
    return localizedFormatTemperature(celsius, forceFahrenheit ? 'en-US' : 'tr-TR')
  }
  const locale =
    resolveSupportedLocale(i18n.resolvedLanguage ?? i18n.language) ??
    defaultSupportedLocale
  return localizedFormatTemperature(celsius, locale)
}

const conditionNames: Record<string, string> = {
  clear: 'Clear Sky',
  partly_cloudy: 'Partly Cloudy',
  cloudy: 'Cloudy',
  fog: 'Foggy',
  drizzle: 'Drizzle',
  rain: 'Rainy',
  sleet: 'Sleet',
  snow: 'Snowy',
  thunderstorm: 'Thunderstorm',
  wind: 'Windy',
  unknown: 'Unknown',
}

export function WeatherHeader({ current, isLoading }: WeatherHeaderProps) {
  const { t } = useTranslation()
  const palette = useHeroPalette()

  if (isLoading) {
    return (
      <View style={styles.skeletonContainer} testID="weather-header-skeleton">
        <View style={[styles.skeletonTemp, { backgroundColor: palette.skeleton }]} />
        <View style={[styles.skeletonText, { backgroundColor: palette.skeleton }]} />
      </View>
    )
  }

  if (!current) {
    return null
  }

  const glyph = weatherConditionGlyphs[current.condition] || '❓'
  const text = t(`hero.conditions.${current.condition}`, {
    defaultValue: conditionNames[current.condition] || 'Unknown',
  })

  return (
    <View style={styles.container} testID="weather-header">
      <View style={styles.row}>
        <Text
          style={[styles.temperature, { color: palette.text }]}
          testID="current-temperature"
        >
          {formatTemperature(current.temperature)}
        </Text>
        <Text style={styles.glyph}>{glyph}</Text>
      </View>
      <Text style={[styles.conditionText, { color: palette.mutedText }]}>{text}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    alignItems: 'flex-start',
    backgroundColor: 'transparent',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  temperature: {
    fontSize: 48,
    fontWeight: '700',
    fontFamily: Platform.select({
      ios: 'Space Grotesk Bold',
      android: 'Space Grotesk Bold',
      web: 'Space Grotesk, "SF Mono", monospace',
      default: 'System',
    }),
    color: '#111111',
  },
  glyph: {
    fontSize: 40,
    marginLeft: 12,
  },
  conditionText: {
    fontSize: 14,
    color: '#a3a3a3',
    fontFamily: Platform.select({
      ios: 'SF Pro Text',
      android: 'Roboto',
      web: 'Inter, "SF Pro Text", -apple-system, sans-serif',
      default: 'System',
    }),
    marginTop: 4,
  },
  skeletonContainer: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: 'transparent',
  },
  skeletonTemp: {
    width: 120,
    height: 48,
    backgroundColor: '#E6E6ED',
    borderRadius: 8,
    marginBottom: 8,
  },
  skeletonText: {
    width: 80,
    height: 16,
    backgroundColor: '#E6E6ED',
    borderRadius: 4,
  },
})
