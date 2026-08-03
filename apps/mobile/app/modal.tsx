import { useEffect } from 'react'
import { useRouter } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { Platform, Pressable, StyleSheet } from 'react-native'
import { useTranslation } from 'react-i18next'

import { Text, View } from '@/components/themed'
import { useMobileAnalytics } from '@/src/analytics/mobile-analytics'

export default function ModalScreen() {
  const analytics = useMobileAnalytics()
  const router = useRouter()
  const { t } = useTranslation()

  useEffect(() => {
    analytics.capture('modal_opened')
  }, [analytics])

  return (
    <View
      style={styles.container}
      accessibilityViewIsModal
      accessibilityLabel={t('common.about_couturecast')}
      testID="information-modal"
    >
      <Text style={styles.title} accessibilityRole="header">
        {t('common.about_couturecast')}
      </Text>
      <Text style={styles.description}>{t('common.about_description')}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('common.cancel')}
        onPress={() => router.back()}
        style={styles.closeButton}
        testID="information-modal-close"
      >
        <Text style={styles.closeButtonText}>{t('common.cancel')}</Text>
      </Pressable>
      <StatusBar style={Platform.OS === 'ios' ? 'light' : 'auto'} />
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 20,
    padding: 24,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
  },
  description: {
    maxWidth: 420,
    fontSize: 16,
    lineHeight: 24,
    textAlign: 'center',
  },
  closeButton: {
    minWidth: 120,
    minHeight: 44,
    borderRadius: 999,
    backgroundColor: '#111111',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  closeButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
})
