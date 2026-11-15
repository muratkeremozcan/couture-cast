// Story 6.17 D5: the OAuth callback when the OS delivers it to a cold-started app (Android can
// kill the app behind the Custom Tab). An in-process round trip never routes here; see
// +native-intent. The exchange runs once per code, whichever path sees it first.
import { useEffect, useState } from 'react'
import { StyleSheet } from 'react-native'
import { useTranslation } from 'react-i18next'
import { router, useLocalSearchParams } from 'expo-router'
import { getFederatedSignInStrings, parsePreviewFrom } from '@couture/utils'
import { Text, View } from '@/components/themed'
import { continuesToPreviewReview } from '@/src/lib/post-signin-destination'

const CALLBACK_PARAMS = ['code', 'error', 'error_code', 'from'] as const

export default function OAuthCallbackRoute() {
  const params =
    useLocalSearchParams<Partial<Record<(typeof CALLBACK_PARAMS)[number], string>>>()
  const { i18n } = useTranslation()
  const strings = getFederatedSignInStrings(i18n.language)
  const [failed, setFailed] = useState(false)
  const query = new URLSearchParams()
  for (const name of CALLBACK_PARAMS) {
    const value = params[name]
    if (typeof value === 'string') query.set(name, value)
  }
  const callbackUrl = `couturecast://auth/callback?${query.toString()}`
  const fromPreview = parsePreviewFrom(params.from ?? null) !== null

  useEffect(() => {
    let active = true
    void import('../../src/lib/native-session.js')
      .then((session) => session.completeNativeOAuth(callbackUrl))
      .then(async (outcome) => {
        if (!active) return
        if (outcome.kind === 'member') {
          router.replace(
            (await continuesToPreviewReview(fromPreview)) ? '/preview-continue' : '/'
          )
          return
        }
        if (outcome.kind === 'no_account') {
          router.replace(fromPreview ? '/signup-finish?from=preview' : '/signup-finish')
          return
        }
        // The in-process path shows the same fixed message on the sign-in screen.
        router.replace(
          `/signin?google=${outcome.kind}${fromPreview ? '&from=preview' : ''}`
        )
      })
      .catch(() => {
        if (active) setFailed(true)
      })
    return () => {
      active = false
    }
  }, [callbackUrl, fromPreview])

  return (
    <View style={styles.container}>
      <Text accessibilityLiveRegion="polite">
        {failed ? strings.unavailable : strings.finishing}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, justifyContent: 'center' },
})
