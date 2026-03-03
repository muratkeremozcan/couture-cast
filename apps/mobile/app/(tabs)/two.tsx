import { useEffect } from 'react'
import { StyleSheet } from 'react-native'
import { usePostHog } from 'posthog-react-native'

import EditScreenInfo from '@/components/edit-screen-info'
import { Text, View } from '@/components/themed'

export default function TabTwoScreen() {
  const posthog = usePostHog()

  // Track when user views Tab Two — secondary content engagement
  // @see https://posthog.com/docs/libraries/react-native#capturing-events
  useEffect(() => {
    posthog.capture('tab_two_viewed')
  }, [posthog])

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Tab Two</Text>
      <View
        style={styles.separator}
        lightColor="#eee"
        darkColor="rgba(255,255,255,0.1)"
      />
      <EditScreenInfo path="app/(tabs)/two.tsx" />
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
