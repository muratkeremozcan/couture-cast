import { useEffect } from 'react'
import { StyleSheet } from 'react-native'

import EditScreenInfo from '@/components/edit-screen-info'
import { Text, View } from '@/components/themed'
import { useMobileAnalytics } from '@/src/analytics/mobile-analytics'

export default function TabTwoScreen() {
  const analytics = useMobileAnalytics()

  // Track when user views Tab Two — secondary content engagement
  // @see https://posthog.com/docs/libraries/react-native#capturing-events
  useEffect(() => {
    analytics.capture('tab_two_viewed')
  }, [analytics])

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Tab Two</Text>
      <View
        style={styles.separator}
        lightColor="#eee"
        darkColor="rgba(255,255,255,0.1)"
      />
      <EditScreenInfo path="app/(tabs)/two.tsx" />
      <Text style={styles.infoText}>
        alert_received tracking is wired to real push notification receipt listeners.
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
  },
  separator: {
    marginVertical: 30,
    height: 1,
    width: '80%',
  },
  infoText: {
    marginTop: 16,
    fontSize: 14,
    fontWeight: '500',
    textAlign: 'center',
    maxWidth: '80%',
  },
})
