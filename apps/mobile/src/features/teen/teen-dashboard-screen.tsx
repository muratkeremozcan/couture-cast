import { useEffect, useState } from 'react'
import { StyleSheet } from 'react-native'
import type { UserProfileResponse } from '@couture/api-client/contracts/http'
import { Text, View } from '@/components/themed'
import { getUserProfileFromMobile } from '@/src/lib/user'

type TeenDashboardScreenProps = {
  loadProfile?: () => Promise<UserProfileResponse>
}

function formatConsentDate(value: string | null) {
  if (!value) {
    return 'Awaiting consent'
  }

  return new Intl.DateTimeFormat('en', {
    dateStyle: 'medium',
    timeZone: 'UTC',
  }).format(new Date(value))
}

function getConsentStatus(profile: UserProfileResponse) {
  const hasGrantedGuardian = profile.linkedGuardians.some(
    (guardian) => guardian.status === 'granted'
  )
  const hasRevokedGuardian = profile.linkedGuardians.some(
    (guardian) => guardian.status === 'revoked'
  )

  if (hasGrantedGuardian) {
    return 'Guardian consent granted'
  }

  if (hasRevokedGuardian) {
    return 'Guardian consent revoked'
  }

  return 'Guardian consent pending'
}

export function TeenDashboardScreen({
  loadProfile = getUserProfileFromMobile,
}: TeenDashboardScreenProps) {
  const [profile, setProfile] = useState<UserProfileResponse | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

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
            error instanceof Error ? error.message : 'Unable to load dashboard'
          )
        }
      })

    return () => {
      isMounted = false
    }
  }, [loadProfile])

  if (errorMessage) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Teen dashboard</Text>
        <Text testID="teen-dashboard-error" style={styles.errorMessage}>
          {errorMessage}
        </Text>
      </View>
    )
  }

  if (!profile) {
    return (
      <View style={styles.container}>
        <Text style={styles.description}>Loading guardian consent status...</Text>
      </View>
    )
  }

  return (
    <View style={styles.container}>
      <Text style={styles.eyebrow}>Teen dashboard</Text>
      <Text style={styles.title}>{profile.user.displayName ?? profile.user.email}</Text>
      <Text testID="teen-consent-status" style={styles.status}>
        {getConsentStatus(profile)}
      </Text>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Linked guardians</Text>
        {profile.linkedGuardians.length > 0 ? (
          profile.linkedGuardians.map((guardian) => (
            <View key={guardian.guardianId} style={styles.row}>
              <Text style={styles.rowTitle}>{guardian.guardianId}</Text>
              <Text style={styles.rowMeta}>{guardian.status}</Text>
              <Text style={styles.rowMeta}>
                {formatConsentDate(guardian.consentGrantedAt)}
              </Text>
            </View>
          ))
        ) : (
          <Text style={styles.description}>No guardian has accepted consent yet.</Text>
        )}
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
  status: {
    fontSize: 15,
    fontWeight: '700',
    color: '#bbf7d0',
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
  section: {
    marginTop: 12,
    gap: 10,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 2,
    textTransform: 'uppercase',
    color: '#d4d4d4',
  },
  row: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    borderRadius: 14,
    padding: 14,
    gap: 4,
  },
  rowTitle: {
    fontSize: 14,
    fontWeight: '700',
  },
  rowMeta: {
    fontSize: 13,
    color: '#a3a3a3',
  },
})
