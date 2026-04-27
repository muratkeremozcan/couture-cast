import { useEffect, useState } from 'react'
import { Pressable, StyleSheet } from 'react-native'
import type {
  GuardianConsentRevokeInput,
  GuardianConsentRevokeResponse,
  UserProfileResponse,
} from '@couture/api-client/contracts/http'
import { Text, View } from '@/components/themed'
import { revokeGuardianConsentFromMobile } from '@/src/lib/guardian'
import { getUserProfileFromMobile } from '@/src/lib/user'

type GuardianDashboardScreenProps = {
  loadProfile?: () => Promise<UserProfileResponse>
  revokeConsent?: (
    input: GuardianConsentRevokeInput
  ) => Promise<GuardianConsentRevokeResponse>
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

export function GuardianDashboardScreen({
  loadProfile = getUserProfileFromMobile,
  revokeConsent = revokeGuardianConsentFromMobile,
}: GuardianDashboardScreenProps) {
  const [profile, setProfile] = useState<UserProfileResponse | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [pendingTeenId, setPendingTeenId] = useState<string | null>(null)

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
        `Consent revoked for ${response.teenId}. Teen session invalidated: ${response.sessionInvalidated ? 'yes' : 'no'}.`
      )
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Unable to revoke consent')
    } finally {
      setPendingTeenId(null)
    }
  }

  if (errorMessage && !profile) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Guardian dashboard</Text>
        <Text testID="guardian-dashboard-error" style={styles.errorMessage}>
          {errorMessage}
        </Text>
      </View>
    )
  }

  if (!profile) {
    return (
      <View style={styles.container}>
        <Text style={styles.description}>Loading linked teens...</Text>
      </View>
    )
  }

  return (
    <View style={styles.container}>
      <Text style={styles.eyebrow}>Guardian dashboard</Text>
      <Text style={styles.title}>{profile.user.displayName ?? profile.user.email}</Text>
      <Text style={styles.description}>
        Review linked teen accounts and revoke consent when access should stop.
      </Text>

      {message ? (
        <Text testID="guardian-dashboard-message" style={styles.successMessage}>
          {message}
        </Text>
      ) : null}

      {errorMessage ? (
        <Text testID="guardian-dashboard-error" style={styles.errorMessage}>
          {errorMessage}
        </Text>
      ) : null}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Linked teens</Text>
        {profile.linkedTeens.length > 0 ? (
          profile.linkedTeens.map((teen) => (
            <View
              key={teen.teenId}
              testID={`linked-teen-${teen.teenId}`}
              style={styles.row}
            >
              <Text style={styles.rowTitle}>{teen.teenId}</Text>
              <Text style={styles.rowMeta}>{teen.status}</Text>
              <Text style={styles.rowMeta}>
                {formatConsentDate(teen.consentGrantedAt)}
              </Text>
              {teen.status === 'granted' ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Revoke consent for ${teen.teenId}`}
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
                    {pendingTeenId === teen.teenId ? 'Revoking...' : 'Revoke'}
                  </Text>
                </Pressable>
              ) : null}
            </View>
          ))
        ) : (
          <Text style={styles.description}>No linked teen accounts yet.</Text>
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
  description: {
    fontSize: 15,
    lineHeight: 22,
    color: '#a3a3a3',
  },
  successMessage: {
    fontSize: 13,
    color: '#bbf7d0',
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
    gap: 6,
  },
  rowTitle: {
    fontSize: 14,
    fontWeight: '700',
  },
  rowMeta: {
    fontSize: 13,
    color: '#a3a3a3',
  },
  revokeButton: {
    marginTop: 6,
    borderWidth: 1,
    borderColor: '#fca5a5',
    borderRadius: 999,
    paddingVertical: 10,
    alignItems: 'center',
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  revokeButtonText: {
    color: '#fecaca',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.4,
    textTransform: 'uppercase',
  },
})
