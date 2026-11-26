import React from 'react'
import { StyleSheet } from 'react-native'
import { Text, View } from '@/components/themed'
import {
  defaultSupportedLocale,
  resolveSupportedLocale,
  type WeatherCurrent,
} from '@couture/api-client/contracts/http'
import { useHeroPalette } from './hero-theme'
import { weatherConditionGlyphs } from './weather-glyphs'
import { useTranslation } from 'react-i18next'
import {
  formatTemperature as localizedFormatTemperature,
  getTemperatureUnit,
} from '@/src/lib/formatters'
import i18n from '@/src/lib/i18n'
import { formatWeatherAltText } from '@couture/utils'

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
        <View style={[styles.skeletonTemp, { backgroundColor: palette.cardMuted }]} />
        <View style={[styles.skeletonText, { backgroundColor: palette.cardMuted }]} />
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
  const locale =
    resolveSupportedLocale(i18n.resolvedLanguage ?? i18n.language) ??
    defaultSupportedLocale
  const unit = getTemperatureUnit(locale)
  const temperature =
    unit === 'F' ? (current.temperature * 9) / 5 + 32 : current.temperature
  const accessibilityLabel = formatWeatherAltText({
    conditionLabel: text,
    temperature,
    unit,
    locale,
  })

  return (
    <View
      style={styles.container}
      testID="weather-header"
      accessible
      accessibilityLabel={accessibilityLabel}
    >
      <View style={styles.row}>
        <Text
          style={[styles.temperature, { color: palette.ink }]}
          testID="current-temperature"
          accessible={false}
        >
          {formatTemperature(current.temperature)}
        </Text>
        <Text style={styles.glyph} accessible={false} aria-hidden>
          {glyph}
        </Text>
      </View>
      <Text
        style={[styles.conditionText, { color: palette.inkMuted }]}
        testID="current-condition"
        accessible={false}
      >
        {text}
      </Text>
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
    fontSize: 30,
    fontWeight: '700',
  },
  glyph: {
    fontSize: 30,
    marginLeft: 12,
  },
  conditionText: {
    fontSize: 14,
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
    borderRadius: 8,
    marginBottom: 8,
  },
  skeletonText: {
    width: 80,
    height: 16,
    borderRadius: 4,
  },
})
