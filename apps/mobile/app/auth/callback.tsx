// Story 6.17 D5: the OAuth callback when the OS delivers it to a cold-started app (Android can
// kill the app behind the Custom Tab). An in-process round trip never routes here; see
// +native-intent. The exchange runs once per code, whichever path sees it first.
import { useEffect, useState } from 'react'
import { StyleSheet } from 'react-native'
import { useTranslation } from 'react-i18next'
import { router, useLocalSearchParams, type Href } from 'expo-router'
import {
  finishStepHref,
  getFederatedSignInStrings,
  parsePreviewFrom,
  parseSignInDoor,
  signInDoorHref,
} from '@couture/utils'
import { Text, View } from '@/components/themed'
import { continuesToPreviewReview } from '@/src/lib/post-signin-destination'

const CALLBACK_PARAMS = ['code', 'error', 'error_code', 'from', 'door'] as const

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
  const door = parseSignInDoor(params.door ?? null)

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
        // The finish step asks the status itself: the birthdate, or the guardian invitation.
        if (outcome.kind === 'no_account' || outcome.kind === 'awaiting_guardian') {
          router.replace(
            finishStepHref(fromPreview ? 'preview' : null, door, '/signup-finish') as Href
          )
          return
        }
        // D5: back to the door that started, which shows the same fixed message the
        // in-process path does.
        router.replace(
          signInDoorHref(door, { google: outcome.kind, fromPreview }) as Href
        )
      })
      .catch(() => {
        if (active) setFailed(true)
      })
    return () => {
      active = false
    }
  }, [callbackUrl, door, fromPreview])

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
