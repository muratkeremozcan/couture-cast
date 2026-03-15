import { useEffect } from 'react'
import { StatusBar } from 'expo-status-bar'
import { Platform, StyleSheet } from 'react-native'

import EditScreenInfo from '@/components/edit-screen-info'
import { Text, View } from '@/components/themed'
import { useMobileAnalytics } from '@/src/analytics/mobile-analytics'

export default function ModalScreen() {
  const analytics = useMobileAnalytics()

  // Track when user opens the modal
  // @see https://posthog.com/docs/libraries/react-native#capturing-events
  useEffect(() => {
    analytics.capture('modal_opened')
  }, [analytics])

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Modal</Text>
      <View
        style={styles.separator}
        lightColor="#eee"
        darkColor="rgba(255,255,255,0.1)"
      />
      <EditScreenInfo path="app/modal.tsx" />

      {/* Use a light status bar on iOS to account for the black space above the modal */}
      <StatusBar style={Platform.OS === 'ios' ? 'light' : 'auto'} />
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
})
