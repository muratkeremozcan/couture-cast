import React from 'react'
import { Pressable, StyleSheet } from 'react-native'
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
import { TAB_BODY_INSET } from '@/src/theme/tokens'

type WeatherHeaderProps = {
  current?: WeatherCurrent
  isLoading?: boolean
  unavailable?: boolean
  hourlyOpen?: boolean
  onHourlyToggle?: () => void
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

export function WeatherHeader({
  current,
  isLoading,
  unavailable,
  hourlyOpen,
  onHourlyToggle,
}: WeatherHeaderProps) {
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
    return unavailable ? (
      <View style={styles.container} testID="weather-header">
        <Text style={[styles.conditionText, { color: palette.inkMuted }]}>
          {t('home.today.weatherUnavailable')}
        </Text>
      </View>
    ) : null
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

  const contents = (
    <>
      <Text style={styles.glyph} accessible={false} aria-hidden>
        {glyph}
      </Text>
      <Text
        style={[styles.temperature, { color: palette.ink }]}
        testID="current-temperature"
        accessible={false}
      >
        {formatTemperature(current.temperature)}
      </Text>
      <Text
        style={[styles.conditionText, { color: palette.inkMuted }]}
        testID="current-condition"
        accessible={false}
      >
        {text}
      </Text>
    </>
  )

  if (onHourlyToggle) {
    return (
      <Pressable
        style={styles.container}
        testID="weather-header"
        accessibilityRole="button"
        accessibilityState={{ expanded: hourlyOpen }}
        aria-expanded={hourlyOpen}
        accessibilityLabel={accessibilityLabel}
        accessibilityHint={t('hero.hourly_forecast')}
        onPress={onHourlyToggle}
      >
        {contents}
        <Text accessible={false} aria-hidden style={{ color: palette.inkMuted }}>
          {hourlyOpen ? '⌃' : '⌄'}
        </Text>
      </Pressable>
    )
  }

  return (
    <View
      style={styles.container}
      testID="weather-header"
      accessible
      accessibilityLabel={accessibilityLabel}
    >
      {contents}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    minHeight: 44,
    paddingHorizontal: TAB_BODY_INSET,
    paddingVertical: 8,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'transparent',
  },
  temperature: { fontSize: 18, fontWeight: '700' },
  glyph: { fontSize: 18 },
  conditionText: { fontSize: 14, flexShrink: 1 },
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
