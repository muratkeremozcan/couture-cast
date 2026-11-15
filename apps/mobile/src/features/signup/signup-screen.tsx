import { useEffect, useState } from 'react'
import { Pressable, TextInput } from 'react-native'
import { useTranslation } from 'react-i18next'
import {
  type GuardianInvitationInput,
  type GuardianInvitationResponse,
  type SignupInput,
  type SignupResponse,
  guardianInvitationInputSchema,
} from '@couture/api-client/contracts/http'
import {
  AGE_GATE_MESSAGES,
  evaluateBirthdateInput,
  getFederatedSignInStrings,
  getGuestPreviewStrings,
  INVALID_BIRTHDATE_MESSAGE,
} from '@couture/utils'
import { Text, View, createSchemeStyles } from '@/components/themed'
import { inviteGuardianFromMobile } from '@/src/lib/guardian'
import { mobileGuestPreviewStore } from '@/src/lib/guest-preview-store'
import { SignupRefusedError, submitMobileSignup } from '@/src/lib/signup'
import { useAccessibilityAnnouncer } from '@/src/hooks/use-accessibility-announcer'
import { SignupGoogleEntry } from './google-sign-in-button'

type SignupScreenProps = {
  submitSignup?: (input: SignupInput) => Promise<SignupResponse>
  inviteGuardian?: (input: GuardianInvitationInput) => Promise<GuardianInvitationResponse>
  /** Story 6.16 D8: the visitor came from the guest preview (`?from=preview`). */
  fromPreview?: boolean
  /** Story 6.16 D8: the route performs navigation, so this screen stays router-free. */
  onPreviewNavigate?: (href: SignupPreviewHref) => void
  /** Story 6.17 D2: a Google round trip that signed someone in or needs the finish step. */
  onGoogleSignedIn?: (outcome: 'member' | 'no_account') => void
  /** Story 6.17 D5: a round trip that ended back on this door, named by the cold callback. */
  googleOutcome?: 'cancelled' | 'unavailable' | 'refused' | null
}

type SignupPreviewHref = '/preview' | '/signin?from=preview'

export function SignupScreen({
  submitSignup = submitMobileSignup,
  inviteGuardian = inviteGuardianFromMobile,
  fromPreview = false,
  onPreviewNavigate = () => undefined,
  onGoogleSignedIn = () => undefined,
  googleOutcome = null,
}: SignupScreenProps) {
  const styles = useStyles()
  const { announce } = useAccessibilityAnnouncer()
  const { i18n } = useTranslation()
  const previewStrings = getGuestPreviewStrings(i18n.language).conversionDetail
  const [accountCreated, setAccountCreated] = useState(false)
  const [email, setEmail] = useState('')
  const [birthdate, setBirthdate] = useState('')
  const [guardianEmail, setGuardianEmail] = useState('')
  const [consentLevel, setConsentLevel] =
    useState<GuardianInvitationInput['consentLevel']>('read_only')
  const [errorMessage, setErrorMessage] = useState<string | null>(() =>
    googleOutcome ? getFederatedSignInStrings(i18n.language)[googleOutcome] : null
  )
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [inviteLink, setInviteLink] = useState<string | null>(null)
  const [pendingTeenId, setPendingTeenId] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isInviting, setIsInviting] = useState(false)

  const birthdateEvaluation = evaluateBirthdateInput(birthdate)
  const inlineMessage = birthdateEvaluation.message

  useEffect(() => {
    if (errorMessage) {
      announce('error', errorMessage)
    } else if (successMessage) {
      announce('feedback', successMessage)
    } else if (inlineMessage) {
      announce('feedback', inlineMessage)
    }
  }, [announce, errorMessage, successMessage, inlineMessage])

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
      // Story 6.16 D2: an age refusal outranks the preview's self-reported gate.
      if (fromPreview) mobileGuestPreviewStore().clear()
      return
    }

    setIsSubmitting(true)

    try {
      const response = await submitSignup({ email, birthdate })
      if (response.guardianConsentRequired) {
        setAccountCreated(true)
        setPendingTeenId(response.userId)
        setSuccessMessage(
          'Account created. Guardian consent is required before wardrobe access is enabled.'
        )
        return
      }

      setPendingTeenId(null)
      setSuccessMessage('Account created. You can continue to onboarding.')
      setAccountCreated(true)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Signup failed')
      // D2: the server's refusal outranks the preview gate, as the client's does.
      if (fromPreview && error instanceof SignupRefusedError)
        mobileGuestPreviewStore().clear()
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
      <Text style={styles.title} accessibilityRole="header">
        Create your account with age verification first.
      </Text>
      <Text style={styles.description}>
        Ages 13 to 15 require guardian consent before wardrobe access is enabled.
      </Text>

      <View style={styles.form}>
        <SignupGoogleEntry
          fromPreview={fromPreview}
          onSignedIn={onGoogleSignedIn}
          onFailure={setErrorMessage}
        />
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
          placeholderTextColor={styles.placeholder.color}
          value={birthdate}
          onChangeText={setBirthdate}
          style={styles.input}
        />

        {inlineMessage ? (
          <Text
            testID="signup-inline-message"
            style={styles.inlineMessage}
            accessibilityLiveRegion="polite"
          >
            {inlineMessage}
          </Text>
        ) : null}

        {errorMessage ? (
          <Text
            testID="signup-error-message"
            style={styles.errorMessage}
            accessibilityRole="alert"
            accessibilityLiveRegion="assertive"
          >
            {errorMessage}
          </Text>
        ) : null}

        {successMessage ? (
          <Text
            testID="signup-success-message"
            style={styles.successMessage}
            accessibilityLiveRegion="polite"
          >
            {successMessage}
          </Text>
        ) : null}

        <SignupPreviewLink
          kind="continue"
          visible={fromPreview && accountCreated}
          label={previewStrings.signInToContinue}
          onNavigate={onPreviewNavigate}
        />

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
            <View style={styles.segmentRow} accessibilityRole="radiogroup">
              <Pressable
                accessibilityRole="radio"
                accessibilityLabel="Read only consent"
                accessibilityState={{ selected: consentLevel === 'read_only' }}
                onPress={() => setConsentLevel('read_only')}
                style={[
                  styles.segmentButton,
                  consentLevel === 'read_only' ? styles.segmentButtonActive : null,
                ]}
              >
                <Text style={styles.segmentButtonText}>Read only</Text>
              </Pressable>
              <Pressable
                accessibilityRole="radio"
                accessibilityLabel="Full access consent"
                accessibilityState={{ selected: consentLevel === 'full_access' }}
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
        <SignupPreviewLink
          kind="back"
          visible={fromPreview}
          label={previewStrings.backToPreview}
          onNavigate={onPreviewNavigate}
        />
      </View>
    </View>
  )
}

/** Story 6.16 D8: the way back to the preview, and on to a verified sign-in. */
function SignupPreviewLink({
  kind,
  visible,
  label,
  onNavigate,
}: {
  kind: 'continue' | 'back'
  visible: boolean
  label: string
  onNavigate: (href: SignupPreviewHref) => void
}) {
  const styles = useStyles()
  if (!visible) return null
  return kind === 'continue' ? (
    <Pressable
      testID="signup-sign-in-to-continue"
      accessibilityRole="button"
      style={styles.button}
      onPress={() => onNavigate('/signin?from=preview')}
    >
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  ) : (
    <Pressable
      testID="signup-back-to-preview"
      accessibilityRole="link"
      style={styles.previewLink}
      onPress={() => onNavigate('/preview')}
    >
      <Text style={styles.previewLinkText}>{label}</Text>
    </Pressable>
  )
}

/**
 * Layout plus the OS light/dark chrome tokens (`constants/colors.ts`). The earlier fixed
 * colors were drawn for a dark page and left white field text and pale messages on the
 * light one.
 */
const useStyles = createSchemeStyles((colors) => ({
  previewLink: { minHeight: 44, justifyContent: 'center' },
  previewLinkText: { textDecorationLine: 'underline', color: colors.text },
  placeholder: { color: colors.mutedText },
  container: {
    flex: 1,
    paddingHorizontal: 24,
    paddingVertical: 32,
    gap: 12,
    backgroundColor: colors.background,
  },
  eyebrow: {
    fontSize: 12,
    letterSpacing: 3,
    textTransform: 'uppercase',
    color: colors.accentText,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    lineHeight: 34,
    color: colors.text,
  },
  description: {
    fontSize: 15,
    lineHeight: 22,
    color: colors.mutedText,
  },
  form: {
    marginTop: 12,
    gap: 10,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 24,
    padding: 20,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
  },
  input: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: colors.strongBorder,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: colors.text,
  },
  inlineMessage: {
    fontSize: 13,
    color: colors.noticeText,
  },
  errorMessage: {
    fontSize: 13,
    color: colors.dangerText,
  },
  successMessage: {
    fontSize: 13,
    color: colors.successText,
  },
  button: {
    minHeight: 44,
    marginTop: 8,
    borderRadius: 999,
    backgroundColor: colors.accent,
    paddingVertical: 14,
    alignItems: 'center',
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  buttonText: {
    color: colors.onAccent,
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  invitationCard: {
    marginTop: 12,
    gap: 10,
    borderWidth: 1,
    borderColor: colors.noticeBorder,
    borderRadius: 20,
    padding: 16,
    backgroundColor: colors.noticeSurface,
  },
  invitationEyebrow: {
    fontSize: 12,
    letterSpacing: 2,
    textTransform: 'uppercase',
    color: colors.noticeText,
    fontWeight: '700',
  },
  segmentRow: {
    flexDirection: 'row',
    gap: 10,
    backgroundColor: 'transparent',
  },
  segmentButton: {
    minHeight: 44,
    flex: 1,
    borderWidth: 1,
    borderColor: colors.strongBorder,
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center',
  },
  segmentButtonActive: {
    borderColor: colors.accent,
    backgroundColor: colors.surface,
    borderWidth: 2,
  },
  segmentButtonText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '600',
  },
  secondaryButton: {
    marginTop: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.noticeBorder,
    paddingVertical: 14,
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: colors.noticeText,
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  inviteLink: {
    fontSize: 13,
    lineHeight: 19,
    color: colors.text,
  },
}))
