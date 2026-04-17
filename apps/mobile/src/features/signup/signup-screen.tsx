import { useState } from 'react'
import { Pressable, StyleSheet, TextInput } from 'react-native'
import type {
  GuardianInvitationInput,
  GuardianInvitationResponse,
  SignupInput,
  SignupResponse,
} from '@couture/api-client/contracts/http'
import { guardianInvitationInputSchema } from '@couture/api-client/contracts/http'
import {
  AGE_GATE_MESSAGES,
  evaluateBirthdateInput,
  INVALID_BIRTHDATE_MESSAGE,
} from '@couture/utils'
import { Text, View } from '@/components/themed'
import { inviteGuardianFromMobile } from '@/src/lib/guardian'
import { submitMobileSignup } from '@/src/lib/signup'

type SignupScreenProps = {
  submitSignup?: (input: SignupInput) => Promise<SignupResponse>
  inviteGuardian?: (input: GuardianInvitationInput) => Promise<GuardianInvitationResponse>
}

export function SignupScreen({
  submitSignup = submitMobileSignup,
  inviteGuardian = inviteGuardianFromMobile,
}: SignupScreenProps) {
  const [email, setEmail] = useState('')
  const [birthdate, setBirthdate] = useState('')
  const [guardianEmail, setGuardianEmail] = useState('')
  const [consentLevel, setConsentLevel] =
    useState<GuardianInvitationInput['consentLevel']>('read_only')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [inviteLink, setInviteLink] = useState<string | null>(null)
  const [pendingTeenId, setPendingTeenId] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isInviting, setIsInviting] = useState(false)

  const birthdateEvaluation = evaluateBirthdateInput(birthdate)
  const inlineMessage = birthdateEvaluation.message

  async function handleSubmit() {
    setErrorMessage(null)
    setSuccessMessage(null)
    setInviteLink(null)

    if (birthdateEvaluation.kind !== 'valid') {
      setErrorMessage(INVALID_BIRTHDATE_MESSAGE)
      return
    }

    const { gate } = birthdateEvaluation

    if (!gate.allowed) {
      setErrorMessage(AGE_GATE_MESSAGES.underage)
      return
    }

    setIsSubmitting(true)

    try {
      const response = await submitSignup({ email, birthdate })
      if (response.guardianConsentRequired) {
        setPendingTeenId(response.userId)
        setSuccessMessage(
          'Account created. Guardian consent is required before wardrobe access is enabled.'
        )
        return
      }

      setPendingTeenId(null)
      setSuccessMessage('Account created. You can continue to onboarding.')
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Signup failed')
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleGuardianInvite() {
    if (!pendingTeenId) {
      setErrorMessage('Create the teen account first before inviting a guardian.')
      return
    }

    const guardianEmailValidation =
      guardianInvitationInputSchema.shape.guardianEmail.safeParse(guardianEmail)
    if (!guardianEmailValidation.success) {
      setErrorMessage('Enter a valid guardian email address.')
      setSuccessMessage(null)
      setInviteLink(null)
      return
    }

    setErrorMessage(null)
    setSuccessMessage(null)
    setInviteLink(null)
    setIsInviting(true)

    try {
      const response = await inviteGuardian({
        teenId: pendingTeenId,
        guardianEmail,
        consentLevel,
      })
      setInviteLink(response.invitationLink)
      setSuccessMessage(
        `Guardian invitation sent to ${response.guardianEmail}. Share the link below if they do not see the email.`
      )
    } catch (error) {
      setInviteLink(null)
      setErrorMessage(
        error instanceof Error ? error.message : 'Guardian invitation failed'
      )
    } finally {
      setIsInviting(false)
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

        {pendingTeenId ? (
          <View style={styles.invitationCard}>
            <Text style={styles.invitationEyebrow}>Guardian invitation</Text>
            <Text style={styles.description}>
              Invite a guardian to approve access for this teen account.
            </Text>

            <Text style={styles.label}>Guardian email</Text>
            <TextInput
              accessibilityLabel="Guardian email"
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              value={guardianEmail}
              onChangeText={setGuardianEmail}
              style={styles.input}
            />

            <Text style={styles.label}>Consent level</Text>
            <View style={styles.segmentRow}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Read only consent"
                onPress={() => setConsentLevel('read_only')}
                style={[
                  styles.segmentButton,
                  consentLevel === 'read_only' ? styles.segmentButtonActive : null,
                ]}
              >
                <Text style={styles.segmentButtonText}>Read only</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Full access consent"
                onPress={() => setConsentLevel('full_access')}
                style={[
                  styles.segmentButton,
                  consentLevel === 'full_access' ? styles.segmentButtonActive : null,
                ]}
              >
                <Text style={styles.segmentButtonText}>Full access</Text>
              </Pressable>
            </View>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                isInviting ? 'Sending guardian invite' : 'Send guardian invite'
              }
              style={[styles.secondaryButton, isInviting ? styles.buttonDisabled : null]}
              onPress={() => {
                void handleGuardianInvite()
              }}
              disabled={isInviting}
            >
              <Text style={styles.secondaryButtonText}>
                {isInviting ? 'Sending invite…' : 'Send guardian invite'}
              </Text>
            </Pressable>

            {inviteLink ? (
              <Text testID="guardian-invite-link" style={styles.inviteLink}>
                {inviteLink}
              </Text>
            ) : null}
          </View>
        ) : null}
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
  invitationCard: {
    marginTop: 12,
    gap: 10,
    borderWidth: 1,
    borderColor: 'rgba(252, 211, 77, 0.22)',
    borderRadius: 20,
    padding: 16,
    backgroundColor: 'rgba(252, 211, 77, 0.08)',
  },
  invitationEyebrow: {
    fontSize: 12,
    letterSpacing: 2,
    textTransform: 'uppercase',
    color: '#fde68a',
    fontWeight: '700',
  },
  segmentRow: {
    flexDirection: 'row',
    gap: 10,
  },
  segmentButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center',
  },
  segmentButtonActive: {
    borderColor: '#fcd34d',
    backgroundColor: 'rgba(252, 211, 77, 0.14)',
  },
  segmentButtonText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '600',
  },
  secondaryButton: {
    marginTop: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(252, 211, 77, 0.6)',
    paddingVertical: 14,
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: '#fde68a',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  inviteLink: {
    fontSize: 13,
    lineHeight: 19,
    color: '#e5e5e5',
  },
})
