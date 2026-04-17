import { useState } from 'react'
import { Pressable, StyleSheet } from 'react-native'
import type {
  GuardianInvitationAcceptInput,
  GuardianInvitationAcceptResponse,
} from '@couture/api-client/contracts/http'
import { Text, View } from '@/components/themed'
import { acceptGuardianInvitationFromMobile } from '@/src/lib/guardian'

type GuardianAcceptScreenProps = {
  token?: string | null
  acceptInvitation?: (
    input: GuardianInvitationAcceptInput
  ) => Promise<GuardianInvitationAcceptResponse>
}

export function GuardianAcceptScreen({
  token,
  acceptInvitation = acceptGuardianInvitationFromMobile,
}: GuardianAcceptScreenProps) {
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function handleAccept() {
    if (!token) {
      setErrorMessage('Invitation token is missing from this link.')
      return
    }

    setErrorMessage(null)
    setSuccessMessage(null)
    setIsSubmitting(true)

    try {
      const response = await acceptInvitation({ token })
      setSuccessMessage(
        `Consent recorded for ${response.teenEmail}. Guardian account ${response.guardianEmail} is now linked.`
      )
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : 'Unable to accept guardian invitation'
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.eyebrow}>Guardian consent</Text>
      <Text style={styles.title}>Accept teen wardrobe access</Text>
      <Text style={styles.description}>
        Confirm this invitation to link the guardian account and unlock the teen wardrobe
        journey.
      </Text>

      {errorMessage ? (
        <Text testID="guardian-accept-error" style={styles.errorMessage}>
          {errorMessage}
        </Text>
      ) : null}

      {successMessage ? (
        <Text testID="guardian-accept-success" style={styles.successMessage}>
          {successMessage}
        </Text>
      ) : null}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={isSubmitting ? 'Accepting invitation' : 'Accept invitation'}
        style={[styles.button, isSubmitting ? styles.buttonDisabled : null]}
        onPress={() => {
          void handleAccept()
        }}
        disabled={isSubmitting}
      >
        <Text style={styles.buttonText}>
          {isSubmitting ? 'Accepting…' : 'Accept invitation'}
        </Text>
      </Pressable>
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
