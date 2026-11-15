import { useState } from 'react'
import { View, Text, TextInput, Pressable, StyleSheet } from 'react-native'
import { useTranslation } from 'react-i18next'
import { router, useLocalSearchParams } from 'expo-router'
import { getGuestPreviewStrings, parsePreviewFrom } from '@couture/utils'
import { mobileGuestPreviewStore } from '@/src/lib/guest-preview-store'
import { requestNativeOtp, verifyNativeOtp } from '@/src/lib/native-session'
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
/**
 * Story 6.16 D7, D8: a sign-in that came from the preview with a stored carryover intent
 * goes to the review step. Any other sign-in deletes guest state, so a proposal left on a
 * shared device never reaches whoever signs in next.
 */
async function continuesToPreviewReview(fromPreview: boolean): Promise<boolean> {
  const store = mobileGuestPreviewStore()
  const snapshot = await store.load()
  if (fromPreview && snapshot.state?.conversion) return true
  store.clear()
  await store.flush()
  return false
}

export default function SignInScreen() {
  const { t, i18n } = useTranslation()
  const { from } = useLocalSearchParams<{ from?: string }>()
  const fromPreview = parsePreviewFrom(from) !== null
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
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
