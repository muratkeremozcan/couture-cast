// Story 4.4 Task 6 owner: standalone silhouette settings screen, reachable
// outside onboarding (decision 3: bodies and closets change over time). Reuses
// the same SilhouetteEditor the onboarding silhouette step renders. Lives
// under src/features so it stays covered by the component test runner, the
// same split app/guardian-accept.tsx already uses for
// src/features/guardian/guardian-accept-screen.tsx.
//
// Deliberately does not render `<Stack.Screen options={{ title }} />` itself:
// that import chain pulls in native-only expo-asset/EventEmitter modules this
// browser-based test runner can't polyfill (the same reason
// wardrobe-capsules.tsx, which does use Stack.Screen, has no tests today). The
// thin app/wardrobe-silhouette.tsx route sets the nav title instead.
import { useEffect, useState } from 'react'
import { ActivityIndicator, StyleSheet, View } from 'react-native'
import { useTranslation } from 'react-i18next'

import { Text } from '@/components/themed'
import { SilhouetteEditor } from '@/components/wardrobe/silhouette-editor'
import { resolveMobileAccessToken } from '@/src/lib/mobile-auth'

export function WardrobeSilhouetteScreen() {
  const { t } = useTranslation()
  const [accessToken, setAccessToken] = useState<string | null>(null)
  const [isResolvingToken, setIsResolvingToken] = useState(true)

  useEffect(() => {
    let cancelled = false
    void resolveMobileAccessToken().then((token) => {
      if (cancelled) return
      setAccessToken(token ?? null)
      setIsResolvingToken(false)
    })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <View style={styles.screen} testID="wardrobe-silhouette-screen">
      {isResolvingToken ? (
        <ActivityIndicator accessibilityLabel={t('wardrobe.silhouette.title')} />
      ) : accessToken ? (
        <SilhouetteEditor accessToken={accessToken} />
      ) : (
        <Text accessibilityRole="alert">Sign in to edit your silhouette.</Text>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: 20 },
})
