import { useEffect } from 'react'
import { StyleSheet } from 'react-native'
import { usePostHog } from 'posthog-react-native'

import EditScreenInfo from '@/components/edit-screen-info'
import { Text, View } from '@/components/themed'

export default function TabOneScreen() {
  const posthog = usePostHog()

  // Track when user views Tab One — top of the engagement funnel
  // @see https://posthog.com/docs/libraries/react-native#capturing-events
  useEffect(() => {
    posthog.capture('tab_one_viewed')
  }, [posthog])

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Tab One</Text>
      <View
        style={styles.separator}
        lightColor="#eee"
        darkColor="rgba(255,255,255,0.1)"
      />
      <EditScreenInfo path="app/(tabs)/index.tsx" />
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
