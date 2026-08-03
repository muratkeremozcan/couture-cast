import React, { useEffect, useMemo } from 'react'
import { StyleSheet } from 'react-native'
import { Text, View } from '@/components/themed'
import type { WeatherAlert } from '@couture/api-client/contracts/http'
import { useAccessibilityAnnouncer } from '@/src/hooks/use-accessibility-announcer'

type WeatherAlertBannerProps = {
  alerts?: WeatherAlert[]
}

export function WeatherAlertBanner({ alerts }: WeatherAlertBannerProps) {
  const { announce } = useAccessibilityAnnouncer()
  const severityRank = { high: 3, medium: 2, low: 1 }
  const activeAlert = useMemo(
    () =>
      [...(alerts ?? [])].sort(
        (left, right) =>
          (severityRank[right.severity ?? 'low'] ?? 0) -
          (severityRank[left.severity ?? 'low'] ?? 0)
      )[0],
    [alerts]
  )

  useEffect(() => {
    if (activeAlert) {
      announce('alert', `${activeAlert.event}: ${activeAlert.description}`)
    }
  }, [activeAlert, announce])

  if (!activeAlert) return null

  return (
    <View
      style={styles.bannerContainer}
      testID="weather-alert-banner"
      accessible
      accessibilityRole="alert"
      accessibilityLiveRegion="assertive"
      accessibilityLabel={`${activeAlert.event}: ${activeAlert.description}`}
    >
      <View style={styles.content}>
        <Text style={styles.alertEmoji} accessible={false} aria-hidden>
          ⚠️
        </Text>
        <View style={styles.textContainer}>
          <Text style={styles.eventText}>{activeAlert.event}</Text>
          <Text style={styles.descriptionText} numberOfLines={2}>
            {activeAlert.description}
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
