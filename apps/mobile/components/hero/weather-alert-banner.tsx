import React from 'react'
import { StyleSheet } from 'react-native'
import { Text, View } from '@/components/themed'
import type { WeatherAlert } from '@couture/api-client/contracts/http'

type WeatherAlertBannerProps = {
  alerts?: WeatherAlert[]
}

export function WeatherAlertBanner({ alerts }: WeatherAlertBannerProps) {
  if (!alerts || alerts.length === 0) {
    return null
  }

  const severityRank = { high: 3, medium: 2, low: 1 }
  const activeAlert = [...alerts].sort(
    (left, right) =>
      (severityRank[right.severity ?? 'low'] ?? 0) -
      (severityRank[left.severity ?? 'low'] ?? 0)
  )[0]
  if (!activeAlert) return null

  return (
    <View style={styles.bannerContainer} testID="weather-alert-banner">
      <View style={styles.content}>
        <Text style={styles.alertEmoji}>⚠️</Text>
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
