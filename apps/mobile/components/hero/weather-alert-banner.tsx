import React, { useEffect, useMemo } from 'react'
import { StyleSheet } from 'react-native'
import { useTranslation } from 'react-i18next'
import { Text, View } from '@/components/themed'
import type { WeatherAlert } from '@couture/api-client/contracts/http'
import { useAccessibilityAnnouncer } from '@/src/hooks/use-accessibility-announcer'

type WeatherAlertBannerProps = {
  alerts?: WeatherAlert[]
}

/** Alert categories with a localized title (hero.alert.events.*). */
export const WEATHER_ALERT_EVENTS = [
  'flood',
  'winter-storm',
  'wind',
  'heat',
  'ice',
] as const
type WeatherAlertEvent = (typeof WEATHER_ALERT_EVENTS)[number]

const isAlertSlug = (value: string) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)
const alertWords = (value: string) => value.toLowerCase().match(/[a-z0-9]+/g) ?? []
// Words that add nothing to the event name, as in "winter-storm warning for local area".
const GENERIC_ALERT_WORDS = new Set([
  'warning',
  'watch',
  'alert',
  'advisory',
  'for',
  'in',
  'the',
  'local',
  'your',
  'area',
  'effect',
])

/**
 * Providers send free text ("Severe Wind Advisory"), which the client cannot translate
 * and shows as sent. Category slugs ("winter-storm") get a localized title, or a
 * readable one ("Dust storm") when the category is not catalogued, and a description
 * that only restates the event becomes a localized sentence.
 */
function useAlertText(alert: WeatherAlert | undefined) {
  const { t } = useTranslation()
  if (!alert) return null
  const event = alert.event.trim()
  let title = event
  if (isAlertSlug(event)) {
    title = (WEATHER_ALERT_EVENTS as readonly string[]).includes(event)
      ? t(`hero.alert.events.${event as WeatherAlertEvent}`)
      : `${event.charAt(0).toUpperCase()}${event.slice(1).replace(/-/g, ' ')}`
  }
  const eventWords = new Set(alertWords(event))
  const restatesEvent = alertWords(alert.description).every(
    (word) => eventWords.has(word) || GENERIC_ALERT_WORDS.has(word)
  )
  const body = restatesEvent ? t('hero.alert.body_generic') : alert.description.trim()
  return { title, body, label: `${title}: ${body}` }
}

export function WeatherAlertBanner({ alerts }: WeatherAlertBannerProps) {
  const { announce } = useAccessibilityAnnouncer()
  const alertKey = alerts
    ?.map((a) => `${a.event}:${a.severity}:${a.description}:${a.start}:${a.end}`)
    .join('|')

  const severityRank: Record<string, number> = { high: 3, medium: 2, low: 1 }
  const activeAlert = useMemo(
    () =>
      [...(alerts ?? [])].sort(
        (left, right) =>
          (severityRank[right.severity ?? 'low'] ?? 0) -
          (severityRank[left.severity ?? 'low'] ?? 0)
      )[0],
    [alertKey]
  )

  const text = useAlertText(activeAlert)
  const announcement = text?.label

  useEffect(() => {
    if (announcement) announce('alert', announcement)
  }, [announcement, announce])

  if (!activeAlert || !text) return null

  return (
    <View
      style={styles.bannerContainer}
      testID="weather-alert-banner"
      accessible
      accessibilityRole="alert"
      accessibilityLiveRegion="assertive"
      accessibilityLabel={text.label}
    >
      <View style={styles.content}>
        <Text style={styles.alertEmoji} accessible={false} aria-hidden>
          ⚠️
        </Text>
        <View style={styles.textContainer}>
          <Text style={styles.eventText}>{text.title}</Text>
          <Text style={styles.descriptionText} numberOfLines={2}>
            {text.body}
          </Text>
        </View>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  bannerContainer: {
    backgroundColor: '#361F1F',
    borderWidth: 1,
    borderColor: '#B04A4A',
    borderRadius: 8,
    padding: 12,
    marginHorizontal: 16,
    marginVertical: 8,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  alertEmoji: {
    fontSize: 20,
    marginRight: 12,
  },
  textContainer: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  eventText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14,
    fontFamily: 'Inter',
    marginBottom: 2,
  },
  descriptionText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontFamily: 'Inter',
  },
})
