import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import type { UserProfileResponse } from '@couture/api-client/contracts/http'
import { createSchemeStyles, Text, View } from '@/components/themed'
import { getUserProfileFromMobile } from '@/src/lib/user'
import { useAccessibilityAnnouncer } from '@/src/hooks/use-accessibility-announcer'

type TeenDashboardScreenProps = {
  loadProfile?: () => Promise<UserProfileResponse>
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

function getConsentStatus(profile: UserProfileResponse, t: TFunction) {
  const hasGrantedGuardian = profile.linkedGuardians.some(
    (guardian) => guardian.status === 'granted'
  )
  const hasRevokedGuardian = profile.linkedGuardians.some(
    (guardian) => guardian.status === 'revoked'
  )

  if (hasGrantedGuardian) {
    return t('teen.dashboard.granted')
  }

  if (hasRevokedGuardian) {
    return t('teen.dashboard.revoked')
  }

  return t('teen.dashboard.pending')
}

export function TeenDashboardScreen({
  loadProfile = getUserProfileFromMobile,
}: TeenDashboardScreenProps) {
  const { t, i18n } = useTranslation()
  const styles = useStyles()
  const { announce } = useAccessibilityAnnouncer()
  const [profile, setProfile] = useState<UserProfileResponse | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useEffect(() => {
    if (errorMessage) {
      announce('error', errorMessage)
    }
  }, [announce, errorMessage])

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
            error instanceof Error ? error.message : t('teen.dashboard.loadFailed')
          )
        }
      })

    return () => {
      isMounted = false
    }
  }, [loadProfile, t])

  if (errorMessage) {
    return (
      <View style={styles.container}>
        {/* Story CC-7.11 D10: the top bar names the screen, so the body has no second title. */}
        <Text
          testID="teen-dashboard-error"
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
        <Text style={styles.description}>{t('teen.dashboard.loading')}</Text>
      </View>
    )
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title} accessibilityRole="header">
        {profile.user.displayName ?? profile.user.email}
      </Text>
      <Text testID="teen-consent-status" style={styles.status}>
        {getConsentStatus(profile, t)}
      </Text>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t('teen.dashboard.linkedGuardians')}</Text>
        {profile.linkedGuardians.length > 0 ? (
          profile.linkedGuardians.map((guardian) => (
            <View key={guardian.guardianId} style={styles.row}>
              <Text style={styles.rowTitle}>{guardian.guardianId}</Text>
              <Text style={styles.rowMeta}>
                {t(`guardian.consent.status.${guardian.status}`)}
              </Text>
              <Text style={styles.rowMeta}>
                {formatConsentDate(guardian.consentGrantedAt, t, i18n.language)}
              </Text>
            </View>
          ))
        ) : (
          <Text style={styles.description}>{t('teen.dashboard.empty')}</Text>
        )}
      </View>
    </View>
  )
}

// Story CC-7.9 D2, D7: colors follow the OS scheme; each linked guardian is one card on the page.
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
  status: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.successInk,
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
    gap: 4,
  },
  rowTitle: {
    fontSize: 14,
    fontWeight: '700',
  },
  rowMeta: {
    fontSize: 14,
    color: colors.inkMuted,
  },
}))
