import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AccessibilityInfo,
  findNodeHandle,
  Platform,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { useLocalSearchParams } from 'expo-router'
import type { CommunityCardDeepLinkTarget } from '@couture/api-client'
import { hasDeepLinkIntent, parseDeepLink } from '@couture/utils'
import { InfoBanner } from '@/components/info-banner'
import { useMobileAnalytics } from '@/src/analytics/mobile-analytics'
import { loadMobileCommunityCardTarget } from '@/src/lib/mobile-deep-link-handler'

export default function CommunityScreen() {
  const { t } = useTranslation()
  const analytics = useMobileAnalytics()
  const { source, type, cardId, expiresAt } = useLocalSearchParams()
  const targetRef = useRef<View>(null)
  const [target, setTarget] = useState<CommunityCardDeepLinkTarget | null>(null)
  const [isInvalidDeepLink, setIsInvalidDeepLink] = useState(false)

  useEffect(() => {
    const rawParams = { source, type, cardId, expiresAt }
    const fail = (reason: string) => {
      setIsInvalidDeepLink(true)
      analytics.capture('deep_link_invalid', {
        rawUrl: JSON.stringify(rawParams),
        reason,
        surface: 'mobile',
      })
    }
    if (!hasDeepLinkIntent(rawParams)) {
      return
    }

    const parsed = parseDeepLink(rawParams)
    if (
      !parsed.valid ||
      parsed.payload?.source !== 'notification' ||
      parsed.payload.type !== 'community' ||
      !parsed.payload.cardId
    ) {
      fail(parsed.errorReason ?? 'Invalid community deep link parameters')
      return
    }

    let active = true
    void loadMobileCommunityCardTarget(parsed.payload.cardId)
      .then((resolvedTarget) => {
        if (!active) {
          return
        }
        if (!resolvedTarget) {
          fail('Community card target was not found')
          return
        }
        setTarget(resolvedTarget)
        setIsInvalidDeepLink(false)
        analytics.capture('deep_link_handled', {
          source: 'notification',
          type: 'community',
          cardId: resolvedTarget.id,
          surface: 'mobile',
        })
      })
      .catch(() => active && fail('Community card target could not be loaded'))

    return () => {
      active = false
    }
  }, [source, type, cardId, expiresAt, analytics])

  useEffect(() => {
    if (!target) {
      return
    }
    requestAnimationFrame(() => {
      if (Platform.OS === 'web') {
        return
      }
      const node = findNodeHandle(targetRef.current)
      if (node) {
        AccessibilityInfo.setAccessibilityFocus(node)
      }
    })
  }, [target])

  return (
    <View style={styles.container} testID="community-screen">
      <Text style={styles.title}>
        {t('tabs.community', { defaultValue: 'Community' })}
      </Text>
      {isInvalidDeepLink && (
        <InfoBanner
          message="We refreshed your data after reconnecting"
          onDismiss={() => setIsInvalidDeepLink(false)}
        />
      )}
      {target && (
        <View
          ref={targetRef}
          testID={`highlighted-community-card-${target.id}`}
          accessibilityLiveRegion="polite"
          accessibilityRole="text"
          focusable
          style={styles.highlightCard}
        >
          <Text style={styles.highlightBadge}>Community post #{target.id}</Text>
          <Text style={styles.highlightText}>
            {target.event.data.climateBand ?? 'All-weather'} look from{' '}
            {target.event.data.locale ?? 'the community'}
          </Text>
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    backgroundColor: '#000000',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#FFFFFF',
    marginBottom: 16,
  },
  highlightCard: {
    marginVertical: 12,
    padding: 16,
    borderRadius: 12,
    backgroundColor: '#111111',
    borderWidth: 2,
    borderColor: '#C9A14A',
    width: '100%',
    maxWidth: 340,
  },
  highlightBadge: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#C9A14A',
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  highlightText: {
    fontSize: 14,
    color: '#F5F5F7',
  },
})
