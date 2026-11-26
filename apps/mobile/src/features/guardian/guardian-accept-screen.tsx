import { useEffect, useState } from 'react'
import { Pressable } from 'react-native'
import { useTranslation } from 'react-i18next'
import type {
  GuardianInvitationAcceptInput,
  GuardianInvitationAcceptResponse,
} from '@couture/api-client/contracts/http'
import { createSchemeStyles, Text, View } from '@/components/themed'
import { acceptGuardianInvitationFromMobile } from '@/src/lib/guardian'
import { useAccessibilityAnnouncer } from '@/src/hooks/use-accessibility-announcer'

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
  const { t } = useTranslation()
  const styles = useStyles()
  const { announce } = useAccessibilityAnnouncer()
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    if (errorMessage) {
      announce('error', errorMessage)
    } else if (successMessage) {
      announce('feedback', successMessage)
    }
  }, [announce, errorMessage, successMessage])

  async function handleAccept() {
    if (!token) {
      setErrorMessage(t('guardian.accept.tokenMissing'))
      return
    }

    setErrorMessage(null)
    setSuccessMessage(null)
    setIsSubmitting(true)

    try {
      const response = await acceptInvitation({ token })
      setSuccessMessage(
        t('guardian.accept.success', {
          teenEmail: response.teenEmail,
          guardianEmail: response.guardianEmail,
        })
      )
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : t('guardian.accept.failed')
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.eyebrow}>{t('guardian.accept.title')}</Text>
      <Text style={styles.title} accessibilityRole="header">
        {t('guardian.accept.heading')}
      </Text>
      <Text style={styles.description}>{t('guardian.accept.intro')}</Text>

      {errorMessage ? (
        <Text
          testID="guardian-accept-error"
          style={styles.errorMessage}
          accessibilityRole="alert"
          accessibilityLiveRegion="assertive"
        >
          {errorMessage}
        </Text>
      ) : null}

      {successMessage ? (
        <Text
          testID="guardian-accept-success"
          style={styles.successMessage}
          accessibilityLiveRegion="polite"
        >
          {successMessage}
        </Text>
      ) : null}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          isSubmitting ? t('guardian.accept.acceptingLabel') : t('guardian.accept.accept')
        }
        style={[styles.button, isSubmitting ? styles.buttonDisabled : null]}
        onPress={() => {
          void handleAccept()
        }}
        disabled={isSubmitting}
      >
        <Text style={styles.buttonText}>
          {isSubmitting ? t('guardian.accept.accepting') : t('guardian.accept.accept')}
        </Text>
      </Pressable>
    </View>
  )
}

// Story CC-7.9 D2, D3: colors follow the OS scheme; Accept is the screen's main action.
const useStyles = createSchemeStyles((colors) => ({
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
    color: colors.inkMuted,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    lineHeight: 32,
  },
  description: {
    fontSize: 16,
    lineHeight: 24,
    color: colors.inkMuted,
  },
  errorMessage: {
    fontSize: 14,
    color: colors.dangerInk,
  },
  successMessage: {
    fontSize: 14,
    color: colors.successInk,
  },
  button: {
    minHeight: 44,
    marginTop: 8,
    borderRadius: 9999,
    backgroundColor: colors.primary,
    paddingVertical: 16,
    alignItems: 'center',
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  buttonText: {
    color: colors.onPrimary,
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
}))
