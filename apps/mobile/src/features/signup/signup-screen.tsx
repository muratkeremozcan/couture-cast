import { useState } from 'react'
import { Pressable, StyleSheet, TextInput } from 'react-native'
import type { SignupInput, SignupResponse } from '@couture/api-client/contracts/http'
import { AGE_GATE_MESSAGES, evaluateAgeGate, parseBirthdateInput } from '@couture/utils'
import { Text, View } from '@/components/themed'
import { submitMobileSignup } from '@/src/lib/signup'

type SignupScreenProps = {
  submitSignup?: (input: SignupInput) => Promise<SignupResponse>
}

function toInlineMessage(birthdate: string) {
  if (!birthdate) {
    return null
  }

  try {
    const gate = evaluateAgeGate(parseBirthdateInput(birthdate))
    return gate.message
  } catch {
    return 'Enter your birthdate as YYYY-MM-DD'
  }
}

export function SignupScreen({ submitSignup = submitMobileSignup }: SignupScreenProps) {
  const [email, setEmail] = useState('')
  const [birthdate, setBirthdate] = useState('')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const inlineMessage = toInlineMessage(birthdate)

  async function handleSubmit() {
    setErrorMessage(null)
    setSuccessMessage(null)

    let gate = null

    try {
      gate = evaluateAgeGate(parseBirthdateInput(birthdate))
    } catch {
      setErrorMessage('Enter your birthdate as YYYY-MM-DD')
      return
    }

    if (!gate.allowed) {
      setErrorMessage(AGE_GATE_MESSAGES.underage)
      return
    }

    setIsSubmitting(true)

    try {
      const response = await submitSignup({ email, birthdate })
      setSuccessMessage(
        response.guardianConsentRequired
          ? AGE_GATE_MESSAGES.guardianRequired
          : 'Account created. You can continue to onboarding.'
      )
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Signup failed')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.eyebrow}>COPPA-ready signup</Text>
      <Text style={styles.title}>Create your account with age verification first.</Text>
      <Text style={styles.description}>
        Ages 13 to 15 require guardian consent before wardrobe access is enabled.
      </Text>

      <View style={styles.form}>
        <Text style={styles.label}>Email</Text>
        <TextInput
          accessibilityLabel="Email"
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          value={email}
          onChangeText={setEmail}
          style={styles.input}
        />

        <Text style={styles.label}>Birthdate</Text>
        <TextInput
          accessibilityLabel="Birthdate"
          placeholder="YYYY-MM-DD"
          placeholderTextColor="#737373"
          value={birthdate}
          onChangeText={setBirthdate}
          style={styles.input}
        />

        {inlineMessage ? (
          <Text testID="signup-inline-message" style={styles.inlineMessage}>
            {inlineMessage}
          </Text>
        ) : null}

        {errorMessage ? (
          <Text testID="signup-error-message" style={styles.errorMessage}>
            {errorMessage}
          </Text>
        ) : null}

        {successMessage ? (
          <Text testID="signup-success-message" style={styles.successMessage}>
            {successMessage}
          </Text>
        ) : null}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={isSubmitting ? 'Creating account' : 'Create account'}
          style={[styles.button, isSubmitting ? styles.buttonDisabled : null]}
          onPress={() => {
            void handleSubmit()
          }}
          disabled={isSubmitting}
        >
          <Text style={styles.buttonText}>
            {isSubmitting ? 'Creating account…' : 'Create account'}
          </Text>
        </Pressable>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 24,
    paddingVertical: 32,
    gap: 12,
  },
  eyebrow: {
    fontSize: 12,
    letterSpacing: 3,
    textTransform: 'uppercase',
    color: '#fcd34d',
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    lineHeight: 34,
  },
  description: {
    fontSize: 15,
    lineHeight: 22,
    color: '#a3a3a3',
  },
  form: {
    marginTop: 12,
    gap: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    borderRadius: 24,
    padding: 20,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
  },
  input: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: '#ffffff',
  },
  inlineMessage: {
    fontSize: 13,
    color: '#fde68a',
  },
  errorMessage: {
    fontSize: 13,
    color: '#fecaca',
  },
  successMessage: {
    fontSize: 13,
    color: '#bbf7d0',
  },
  button: {
    marginTop: 8,
    borderRadius: 999,
    backgroundColor: '#fcd34d',
    paddingVertical: 14,
    alignItems: 'center',
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  buttonText: {
    color: '#111827',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
})
