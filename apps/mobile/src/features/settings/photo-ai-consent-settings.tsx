import { useCallback, useEffect, useRef, useState } from 'react'
import { Pressable, StyleSheet } from 'react-native'
import { useTranslation } from 'react-i18next'
import { requestPhotoAiConsent } from '@couture/api-client'
import type { PhotoAiConsentResponse } from '@couture/api-client/contracts/http'
import { Text, View } from '@/components/themed'
import { createMobileApiClient } from '@/src/lib/api-client'
import { mobileIdentityEpoch, resolveMobileAccessToken } from '@/src/lib/mobile-auth'

export function PhotoAiConsentSettings({ signedIn }: { signedIn: boolean | null }) {
  if (!signedIn) return null
  return <MemberPhotoAiConsentSettings epoch={mobileIdentityEpoch()} />
}

function MemberPhotoAiConsentSettings({ epoch }: { epoch: number }) {
  const { t } = useTranslation()
  const requestRef = useRef<AbortController | null>(null)
  const [data, setData] = useState<PhotoAiConsentResponse['data'] | null>(null)
  const [pending, setPending] = useState(true)
  const [feedback, setFeedback] = useState<'error' | 'revoked' | null>(null)

  const load = useCallback(
    async (grantId?: string) => {
      if (epoch !== mobileIdentityEpoch() || requestRef.current) return

      const controller = new AbortController()
      requestRef.current = controller
      const { signal } = controller
      const stillCurrent = () => !signal.aborted && epoch === mobileIdentityEpoch()
      setPending(true)
      setFeedback(null)
      try {
        const accessToken = await resolveMobileAccessToken()
        if (!stillCurrent()) return
        if (!accessToken) throw new Error('Photo AI session is unavailable.')
        const api = createMobileApiClient({
          accessToken,
          fetchApi: (input, init) => {
            if (!stillCurrent()) throw new Error('Photo AI session changed.')
            return fetch(input, init)
          },
        })
        const response = await requestPhotoAiConsent(api, signal, grantId)
        if (stillCurrent()) {
          setData(response)
          if (grantId) setFeedback('revoked')
        }
      } catch {
        if (stillCurrent()) setFeedback('error')
      } finally {
        if (requestRef.current === controller) requestRef.current = null
        if (stillCurrent()) setPending(false)
      }
    },
    [epoch]
  )

  useEffect(() => {
    void load()
    return () => {
      requestRef.current?.abort()
      requestRef.current = null
    }
  }, [load])

  return (
    <View
      style={styles.section}
      accessibilityState={{ busy: pending }}
      testID="photo-ai-consent"
    >
      <Text accessibilityRole="header" style={styles.heading}>
        {t('settings.photoAi.heading')}
      </Text>
      <Text testID="photo-ai-consent-status">{t('settings.photoAi.off')}</Text>
      <Text style={styles.detail}>{t('settings.photoAi.manual')}</Text>
      {data?.grants.map(({ id, feature, provider }) => {
        const featureName = t(`settings.photoAi.features.${feature}`)
        return (
          <View key={id} style={styles.row}>
            <View style={styles.scope}>
              <Text style={styles.name}>{featureName}</Text>
              <Text style={styles.detail}>{provider}</Text>
            </View>
            <Pressable
              accessibilityLabel={t('settings.photoAi.revokeLabel', {
                feature: featureName,
                provider,
              })}
              accessibilityRole="button"
              accessibilityState={{ disabled: pending }}
              disabled={pending}
              onPress={() => void load(id)}
              style={[styles.action, pending && styles.disabled]}
              testID={`photo-ai-revoke-${id}`}
            >
              <Text style={styles.actionLabel}>{t('settings.photoAi.revoke')}</Text>
            </Pressable>
          </View>
        )
      })}
      {feedback && (
        <Text accessibilityLiveRegion="polite">
          {t(
            feedback === 'revoked'
              ? 'settings.photoAi.revoked'
              : data
                ? 'settings.photoAi.revokeError'
                : 'settings.photoAi.loadError'
          )}
        </Text>
      )}
      {feedback === 'error' && !data && (
        <Pressable
          accessibilityRole="button"
          onPress={() => void load()}
          style={styles.action}
        >
          <Text style={styles.actionLabel}>{t('settings.photoAi.retry')}</Text>
        </Pressable>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  section: { gap: 4, marginBottom: 16, backgroundColor: 'transparent' },
  heading: { fontSize: 16, fontWeight: '600' },
  detail: { fontSize: 14 },
  row: {
    alignItems: 'center',
    backgroundColor: 'transparent',
    flexDirection: 'row',
    gap: 8,
  },
  scope: { backgroundColor: 'transparent', flex: 1 },
  name: { fontWeight: '500' },
  action: {
    minHeight: 44,
    justifyContent: 'center',
    alignSelf: 'flex-start',
    padding: 6,
  },
  actionLabel: { textDecorationLine: 'underline' },
  disabled: { opacity: 0.5 },
})
