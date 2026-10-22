import { useState } from 'react'
import { View, Text, TextInput, Pressable, StyleSheet } from 'react-native'
import { useTranslation } from 'react-i18next'
import { router } from 'expo-router'
import { requestNativeOtp, verifyNativeOtp } from '@/src/lib/native-session'
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
  const { t } = useTranslation()
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const submit = async () => {
    setBusy(true)
    try {
      if (sent) {
        await verifyNativeOtp(email, code)
        router.back()
      } else {
        await requestNativeOtp(email)
        setSent(true)
        setMessage('community.notifications.codeSent')
      }
    } catch (error) {
      // Anything unclassified is treated as temporary, so the person retries.
      setMessage(
        FAILURE_KEYS[error instanceof NativeSignInError ? error.reason : 'unavailable']
      )
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
            value={code}
            onChangeText={setCode}
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
    </View>
  )
}
const styles = StyleSheet.create({
  container: { padding: 24, gap: 16 },
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
