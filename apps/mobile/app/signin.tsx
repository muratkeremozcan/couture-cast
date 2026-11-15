import { useEffect, useState } from 'react'
import { View, Text, TextInput, Pressable, StyleSheet } from 'react-native'
import { useTranslation } from 'react-i18next'
import { router, useLocalSearchParams } from 'expo-router'
import {
  getFederatedSignInStrings,
  getGuestPreviewStrings,
  parsePreviewFrom,
} from '@couture/utils'
import {
  GoogleSignInButton,
  SignInDivider,
} from '@/src/features/signup/google-sign-in-button'
import { continuesToPreviewReview } from '@/src/lib/post-signin-destination'
import { useAccessibilityAnnouncer } from '@/src/hooks/use-accessibility-announcer'
import {
  requestNativeOtp,
  verifyNativeOtp,
  type NativeOAuthOutcome,
} from '@/src/lib/native-session'
import { traceShareCardOpener } from '@/src/lib/share-card-presentation-trace'
import {
  NativeSignInError,
  type NativeSignInFailure,
} from '@/src/lib/native-signin-error'
const FAILURE_KEYS: Record<NativeSignInFailure, string> = {
  denied: 'community.notifications.signinDenied',
  code_invalid: 'community.notifications.signinCodeInvalid',
  unavailable: 'community.notifications.signinUnavailable',
}
export default function SignInScreen() {
  const { t, i18n } = useTranslation()
  const { from, google } = useLocalSearchParams<{ from?: string; google?: string }>()
  const fromPreview = parsePreviewFrom(from) !== null
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const googleStrings = getFederatedSignInStrings(i18n.language)
  // Story 6.17 D5: a cold-started callback that signed nobody in names its outcome; only the
  // three fixed names show anything.
  const [googleMessage, setGoogleMessage] = useState<string | null>(() =>
    google === 'cancelled' || google === 'unavailable' || google === 'refused'
      ? googleStrings[google]
      : null
  )
  const { announce } = useAccessibilityAnnouncer()
  useEffect(() => {
    if (googleMessage) announce('error', googleMessage)
  }, [announce, googleMessage])
  // Story 6.17 D2, D6: Google follows the same destination rule as the email code.
  const onGoogleOutcome = async (outcome: NativeOAuthOutcome) => {
    setGoogleMessage(null)
    if (outcome.kind === 'member') {
      if (await continuesToPreviewReview(fromPreview)) router.replace('/preview-continue')
      else router.back()
      return
    }
    if (outcome.kind === 'no_account') {
      router.replace(fromPreview ? '/signup-finish?from=preview' : '/signup-finish')
      return
    }
    setGoogleMessage(googleStrings[outcome.kind])
  }
  const submit = async () => {
    setBusy(true)
    try {
      if (sent) {
        traceShareCardOpener('signin-verify-press', code.length)
        await verifyNativeOtp(email, code)
        traceShareCardOpener('signin-verify-ok')
        if (await continuesToPreviewReview(fromPreview))
          router.replace('/preview-continue')
        else router.back()
      } else {
        await requestNativeOtp(email)
        setSent(true)
        setMessage('community.notifications.codeSent')
      }
    } catch (error) {
      // Anything unclassified is treated as temporary, so the person retries.
      const reason = error instanceof NativeSignInError ? error.reason : 'unavailable'
      if (sent) traceShareCardOpener(`signin-verify-${reason}`)
      setMessage(FAILURE_KEYS[reason])
    } finally {
      setBusy(false)
    }
  }
  return (
    <View style={styles.container}>
      <GoogleSignInButton
        from={fromPreview ? 'preview' : null}
        onOutcome={(outcome) => {
          void onGoogleOutcome(outcome)
        }}
      />
      {googleMessage ? (
        <Text testID="google-sign-in-status" accessibilityRole="alert">
          {googleMessage}
        </Text>
      ) : null}
      <SignInDivider />
      <Text>{t('community.notifications.email')}</Text>
      <TextInput
        accessibilityLabel={t('community.notifications.email')}
        autoComplete="email"
        keyboardType="email-address"
        autoCapitalize="none"
        value={email}
        onChangeText={setEmail}
        editable={!sent && !busy}
        style={styles.input}
      />
      {sent && (
        <>
          <Text>{t('community.notifications.code')}</Text>
          <TextInput
            accessibilityLabel={t('community.notifications.code')}
            autoComplete="one-time-code"
            keyboardType="number-pad"
            testID="signin-code-input"
            value={code}
            onFocus={() => traceShareCardOpener('signin-code-focus')}
            onChangeText={(next) => {
              traceShareCardOpener('signin-code-change', next.length)
              setCode(next)
            }}
            style={styles.input}
          />
        </>
      )}
      <Pressable
        accessibilityRole="button"
        disabled={busy || !email || (sent && !code)}
        onPress={() => {
          void submit()
        }}
        style={styles.button}
      >
        <Text>
          {t(
            sent ? 'community.notifications.verify' : 'community.notifications.sendCode'
          )}
        </Text>
      </Pressable>
      <Text accessibilityLiveRegion="polite">{message ? t(message) : ''}</Text>
      {fromPreview ? (
        <Pressable
          testID="signin-back-to-preview"
          accessibilityRole="link"
          onPress={() => router.replace('/preview')}
          style={styles.previewLink}
        >
          <Text style={styles.previewLinkText}>
            {getGuestPreviewStrings(i18n.language).conversionDetail.backToPreview}
          </Text>
        </Pressable>
      ) : null}
    </View>
  )
}
const styles = StyleSheet.create({
  container: { padding: 24, gap: 16 },
  previewLink: { minHeight: 44, justifyContent: 'center' },
  previewLinkText: { textDecorationLine: 'underline' },
  title: { fontSize: 26, fontWeight: '600' },
  input: {
    minHeight: 48,
    padding: 12,
    borderWidth: 1,
    borderColor: '#777',
    borderRadius: 8,
  },
  button: {
    minHeight: 48,
    padding: 14,
    backgroundColor: '#C9A14A',
    borderRadius: 8,
    alignItems: 'center',
  },
})
