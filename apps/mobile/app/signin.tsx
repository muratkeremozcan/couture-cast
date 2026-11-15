import { useEffect, useState } from 'react'
import { View, Text, TextInput, Pressable } from 'react-native'
import { useTranslation } from 'react-i18next'
import { router, useLocalSearchParams, type Href } from 'expo-router'
import {
  finishStepHref,
  getFederatedSignInStrings,
  getGuestPreviewStrings,
  parsePreviewFrom,
} from '@couture/utils'
import {
  GoogleSignInButton,
  SignInDivider,
} from '@/src/features/signup/google-sign-in-button'
import { createSchemeStyles } from '@/components/themed'
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
  const styles = useStyles()
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
  // A signed-in member returns to the screen that opened sign-in. Sign-in can also be the
  // stack's root (a cold OAuth callback replaced into it), where there is nothing to go
  // back to, so Home takes its place.
  const leaveSignedIn = async () => {
    if (await continuesToPreviewReview(fromPreview)) router.replace('/preview-continue')
    else if (router.canGoBack()) router.back()
    else router.replace('/')
  }
  // Story 6.17 D2, D6: Google follows the same destination rule as the email code.
  const onGoogleOutcome = async (outcome: NativeOAuthOutcome) => {
    setGoogleMessage(null)
    if (outcome.kind === 'member') {
      await leaveSignedIn()
      return
    }
    if (outcome.kind === 'no_account') {
      router.replace(
        finishStepHref(fromPreview ? 'preview' : null, 'signin', '/signup-finish') as Href
      )
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
        await leaveSignedIn()
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
  const canSubmit = !busy && Boolean(email) && (!sent || Boolean(code))
  return (
    <View testID="signin-screen" style={styles.container}>
      <GoogleSignInButton
        from={fromPreview ? 'preview' : null}
        onOutcome={(outcome) => {
          void onGoogleOutcome(outcome)
        }}
      />
      {googleMessage ? (
        <Text
          testID="google-sign-in-status"
          accessibilityRole="alert"
          style={styles.body}
        >
          {googleMessage}
        </Text>
      ) : null}
      <SignInDivider />
      <Text style={styles.label}>{t('community.notifications.email')}</Text>
      <TextInput
        testID="signin-email-input"
        accessibilityLabel={t('community.notifications.email')}
        placeholderTextColor={styles.placeholder.color}
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
          <Text style={styles.label}>{t('community.notifications.code')}</Text>
          <TextInput
            accessibilityLabel={t('community.notifications.code')}
            placeholderTextColor={styles.placeholder.color}
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
        disabled={!canSubmit}
        onPress={() => {
          void submit()
        }}
        style={[styles.button, canSubmit ? null : styles.buttonDisabled]}
      >
        <Text style={styles.buttonText}>
          {t(
            sent ? 'community.notifications.verify' : 'community.notifications.sendCode'
          )}
        </Text>
      </Pressable>
      <Text accessibilityLiveRegion="polite" style={styles.body}>
        {message ? t(message) : ''}
      </Text>
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
/**
 * Layout plus the OS light/dark chrome tokens (`constants/colors.ts`), as signup draws them.
 * The plain React Native text here had no color, so the dark page showed black labels.
 */
const useStyles = createSchemeStyles((colors) => ({
  container: { flex: 1, padding: 24, gap: 16, backgroundColor: colors.background },
  body: { fontSize: 15, lineHeight: 22, color: colors.text },
  label: { fontSize: 13, fontWeight: '600', color: colors.text },
  placeholder: { color: colors.mutedText },
  previewLink: { minHeight: 44, justifyContent: 'center' },
  previewLinkText: { textDecorationLine: 'underline', color: colors.text },
  input: {
    minHeight: 48,
    padding: 12,
    borderWidth: 1,
    borderColor: colors.strongBorder,
    borderRadius: 14,
    fontSize: 16,
    color: colors.text,
  },
  button: {
    minHeight: 48,
    padding: 14,
    backgroundColor: colors.accent,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: colors.onAccent, fontSize: 15, fontWeight: '700' },
}))
