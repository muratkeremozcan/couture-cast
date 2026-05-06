import { useEffect, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'

export type MobileAnalyticsRecordedEvent = {
  event: string
  properties?: Record<string, unknown>
  recordedAt: string
}

type AnalyticsDiagnosticsSubscriber = (
  records: readonly MobileAnalyticsRecordedEvent[]
) => void

export const isMobileAnalyticsDiagnosticsEnabled =
  process.env.MOBILE_ANALYTICS_DIAGNOSTICS === '1' ||
  process.env.EXPO_PUBLIC_MOBILE_ANALYTICS_DIAGNOSTICS === '1'

const records: MobileAnalyticsRecordedEvent[] = []
const subscribers = new Set<AnalyticsDiagnosticsSubscriber>()

const notifySubscribers = () => {
  const snapshot = records.slice()
  for (const subscriber of subscribers) {
    subscriber(snapshot)
  }
}

export function recordMobileAnalyticsEvent(
  event: string,
  properties?: Record<string, unknown>
) {
  if (!isMobileAnalyticsDiagnosticsEnabled) {
    return
  }

  const record = {
    event,
    properties,
    recordedAt: new Date().toISOString(),
  }
  records.push(record)

  if (records.length > 20) {
    records.splice(0, records.length - 20)
  }

  console.info(`[mobile-analytics] ${JSON.stringify(record)}`)
  notifySubscribers()
}

export function getMobileAnalyticsRecordedEvents() {
  return records.slice()
}

export function subscribeMobileAnalyticsEvents(
  subscriber: AnalyticsDiagnosticsSubscriber
) {
  subscribers.add(subscriber)
  subscriber(records.slice())

  return () => {
    subscribers.delete(subscriber)
  }
}

function useMobileAnalyticsDiagnostics(limit = 5) {
  const [visibleRecords, setVisibleRecords] = useState(() =>
    getMobileAnalyticsRecordedEvents().slice(-limit)
  )

  useEffect(() => {
    if (!isMobileAnalyticsDiagnosticsEnabled) {
      return undefined
    }

    return subscribeMobileAnalyticsEvents((nextRecords) => {
      setVisibleRecords(nextRecords.slice(-limit))
    })
  }, [limit])

  return visibleRecords
}

export function MobileAnalyticsDiagnosticsPanel() {
  const visibleRecords = useMobileAnalyticsDiagnostics()

  if (!isMobileAnalyticsDiagnosticsEnabled) {
    return null
  }

  return (
    <View
      accessibilityLabel="Mobile analytics diagnostics"
      style={styles.container}
      testID="mobile-analytics-diagnostics"
    >
      <Text style={styles.heading}>Mobile analytics diagnostics</Text>
      {visibleRecords.length === 0 ? (
        <Text style={styles.record}>Analytics event: none</Text>
      ) : (
        visibleRecords.map((record, index) => (
          <Text
            key={`${record.event}-${record.recordedAt}-${index}`}
            style={styles.record}
            testID={`mobile-analytics-event-${record.event}`}
          >
            Analytics event: {record.event}
          </Text>
        ))
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    marginTop: 16,
    width: '80%',
    borderWidth: 1,
    borderColor: '#737373',
    borderRadius: 6,
    padding: 10,
    gap: 6,
  },
  heading: {
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
  },
  record: {
    fontSize: 12,
    fontWeight: '500',
    textAlign: 'center',
  },
})
