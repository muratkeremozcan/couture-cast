import { useEffect, useState } from 'react'
import { Pressable } from 'react-native'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import type {
  GuardianConsentRevokeInput,
  GuardianConsentRevokeResponse,
  UserProfileResponse,
} from '@couture/api-client/contracts/http'
import { createSchemeStyles, Text, View } from '@/components/themed'
import { revokeGuardianConsentFromMobile } from '@/src/lib/guardian'
import { getUserProfileFromMobile } from '@/src/lib/user'
import { useAccessibilityAnnouncer } from '@/src/hooks/use-accessibility-announcer'

type GuardianDashboardScreenProps = {
  loadProfile?: () => Promise<UserProfileResponse>
  revokeConsent?: (
    input: GuardianConsentRevokeInput
  ) => Promise<GuardianConsentRevokeResponse>
}

function formatConsentDate(value: string | null, t: TFunction, locale: string) {
  if (!value) {
    return t('guardian.consent.awaiting')
  }

  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeZone: 'UTC',
  }).format(new Date(value))
}

export function GuardianDashboardScreen({
  loadProfile = getUserProfileFromMobile,
  revokeConsent = revokeGuardianConsentFromMobile,
}: GuardianDashboardScreenProps) {
  const { t, i18n } = useTranslation()
  const styles = useStyles()
  const { announce } = useAccessibilityAnnouncer()
  const [profile, setProfile] = useState<UserProfileResponse | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [pendingTeenId, setPendingTeenId] = useState<string | null>(null)

  useEffect(() => {
    if (errorMessage) {
      announce('error', errorMessage)
    } else if (message) {
      announce('feedback', message)
    }
  }, [announce, errorMessage, message])

  useEffect(() => {
    let isMounted = true

    loadProfile()
      .then((nextProfile) => {
        if (isMounted) {
          setProfile(nextProfile)
          setErrorMessage(null)
        }
      })
      .catch((error) => {
        if (isMounted) {
          setErrorMessage(
            error instanceof Error ? error.message : t('guardian.dashboard.loadFailed')
          )
        }
      })

    return () => {
      isMounted = false
    }
  }, [loadProfile, t])

  async function handleRevoke(teenId: string) {
    if (!profile) {
      return
    }

    setPendingTeenId(teenId)
    setMessage(null)
    setErrorMessage(null)

    try {
      const response = await revokeConsent({
        guardianId: profile.user.id,
        teenId,
      })
      setProfile({
        ...profile,
        linkedTeens: profile.linkedTeens.map((teen) =>
          teen.teenId === teenId
            ? {
                ...teen,
                status: 'revoked',
                consentGrantedAt: teen.consentGrantedAt,
              }
            : teen
        ),
      })
      setMessage(
        t('guardian.dashboard.revoked', {
          teenId: response.teenId,
          invalidated: response.sessionInvalidated
            ? t('guardian.dashboard.yes')
            : t('guardian.dashboard.no'),
        })
      )
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : t('guardian.dashboard.revokeFailed')
      )
    } finally {
      setPendingTeenId(null)
    }
  }

  if (errorMessage && !profile) {
    return (
      <View style={styles.container}>
        {/* Story CC-7.11 D10: the top bar names the screen, so the body has no second title. */}
        <Text
          testID="guardian-dashboard-error"
          style={styles.errorMessage}
          accessibilityRole="alert"
          accessibilityLiveRegion="assertive"
        >
          {errorMessage}
        </Text>
      </View>
    )
  }

  if (!profile) {
    return (
      <View style={styles.container}>
        <Text style={styles.description}>{t('guardian.dashboard.loading')}</Text>
      </View>
    )
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title} accessibilityRole="header">
        {profile.user.displayName ?? profile.user.email}
      </Text>
      <Text style={styles.description}>{t('guardian.dashboard.intro')}</Text>

      {message ? (
        <Text
          testID="guardian-dashboard-message"
          style={styles.successMessage}
          accessibilityLiveRegion="polite"
        >
          {message}
        </Text>
      ) : null}

      {errorMessage ? (
        <Text
          testID="guardian-dashboard-error"
          style={styles.errorMessage}
          accessibilityRole="alert"
          accessibilityLiveRegion="assertive"
        >
          {errorMessage}
        </Text>
      ) : null}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t('guardian.dashboard.linkedTeens')}</Text>
        {profile.linkedTeens.length > 0 ? (
          profile.linkedTeens.map((teen) => (
            <View
              key={teen.teenId}
              testID={`linked-teen-${teen.teenId}`}
              style={styles.row}
            >
              <Text style={styles.rowTitle}>{teen.teenId}</Text>
              <Text style={styles.rowMeta}>
                {t(`guardian.consent.status.${teen.status}`)}
              </Text>
              <Text style={styles.rowMeta}>
                {formatConsentDate(teen.consentGrantedAt, t, i18n.language)}
              </Text>
              {teen.status === 'granted' ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('guardian.dashboard.revokeLabel', {
                    teenId: teen.teenId,
                  })}
                  style={[
                    styles.revokeButton,
                    pendingTeenId === teen.teenId ? styles.buttonDisabled : null,
                  ]}
                  onPress={() => {
                    void handleRevoke(teen.teenId)
                  }}
                  disabled={pendingTeenId === teen.teenId}
                >
                  <Text style={styles.revokeButtonText}>
                    {pendingTeenId === teen.teenId
                      ? t('guardian.dashboard.revoking')
                      : t('guardian.dashboard.revoke')}
                  </Text>
                </Pressable>
              ) : null}
            </View>
          ))
        ) : (
          <Text style={styles.description}>{t('guardian.dashboard.empty')}</Text>
        )}
      </View>
    </View>
  )
}

// Story CC-7.9 D2, D7: colors follow the OS scheme; each linked teen is one card on the page.
const useStyles = createSchemeStyles((colors) => ({
  container: {
    flex: 1,
    paddingHorizontal: 24,
    paddingVertical: 32,
    gap: 12,
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
  successMessage: {
    fontSize: 14,
    color: colors.successInk,
  },
  errorMessage: {
    fontSize: 14,
    color: colors.dangerInk,
  },
  section: {
    marginTop: 12,
    gap: 12,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 2,
    textTransform: 'uppercase',
    color: colors.inkSoft,
  },
  row: {
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.card,
    borderRadius: 16,
    padding: 16,
    gap: 8,
  },
  rowTitle: {
    fontSize: 14,
    fontWeight: '700',
  },
  rowMeta: {
    fontSize: 14,
    color: colors.inkMuted,
  },
  revokeButton: {
    minHeight: 44,
    marginTop: 8,
    borderWidth: 1,
    borderColor: colors.dangerInk,
    borderRadius: 9999,
    paddingVertical: 12,
    alignItems: 'center',
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  revokeButtonText: {
    color: colors.dangerInk,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.4,
    textTransform: 'uppercase',
  },
}))
