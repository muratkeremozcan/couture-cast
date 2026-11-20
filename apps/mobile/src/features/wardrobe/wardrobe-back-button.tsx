import { router } from 'expo-router'
import { getGuestPreviewStrings } from '@couture/utils'
import { Pressable, StyleSheet } from 'react-native'
import { useTranslation } from 'react-i18next'
import { Text } from '@/components/themed'

export function WardrobeBackButton() {
  const { i18n } = useTranslation()
  const label = getGuestPreviewStrings(i18n.language).firstUse.backToWardrobe
  return (
    <Pressable
      accessibilityRole="button"
      style={styles.button}
      testID="wardrobe-back"
      onPress={() => router.dismissTo('/wardrobe')}
    >
      <Text>{label}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  button: { minHeight: 44, paddingHorizontal: 12, justifyContent: 'center' },
})
