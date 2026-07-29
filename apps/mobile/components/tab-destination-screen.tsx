import { StyleSheet } from 'react-native'

import { Text, View } from '@/components/themed'

export function TabDestinationScreen({
  testID,
  title,
}: {
  testID: string
  title: string
}) {
  return (
    <View style={styles.container} testID={testID}>
      <Text style={styles.title}>{title}</Text>
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
    fontSize: 24,
    fontWeight: 'bold',
  },
})
