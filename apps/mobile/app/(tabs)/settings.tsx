import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Pressable, ScrollView, StyleSheet } from 'react-native'
import { router, useFocusEffect } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useTranslation } from 'react-i18next'
import {
  defaultSupportedLocale,
  resolveSupportedLocale,
} from '@couture/api-client/contracts/http'
import { getGuestPreviewStrings } from '@couture/utils'
import { Text, View, useSchemeColors } from '@/components/themed'
import { useMobileAnalytics } from '@/src/analytics/mobile-analytics'
import { NavRow } from '@/src/components/nav-row'
import { ScreenGate } from '@/src/components/screen-gate'
import { communitySyncFromMobile } from '@/src/lib/community'
import { listLocationsFromMobile } from '@/src/lib/locations'
import { useMemberSessionState } from '@/src/lib/member-session'
import {
  mobileIdentityEpoch,
  resolveMobileAccessToken,
  subscribeMobileApplicationUser,
} from '@/src/lib/mobile-auth'
import { getPremiumAccessFromMobile } from '@/src/lib/premium'
import { getUserProfileFromMobile } from '@/src/lib/user'
import { getWardrobeOnboardingStateFromMobile } from '@/src/lib/wardrobe'
import { TAB_BODY_INSET } from '@/src/theme/tokens'

type Summary = {
  name?: string | null
  place?: string | null
  setup?: 'not_started' | 'in_progress' | 'completed'
  premium?: boolean
  notifications?: boolean
}

export default function SettingsScreen() {
  const epoch = useSyncExternalStore(
    subscribeMobileApplicationUser,
    mobileIdentityEpoch,
    mobileIdentityEpoch
  )
  const analytics = useMobileAnalytics()
  useEffect(() => {
    analytics.capture('tab_two_viewed')
  }, [analytics])

  return (
    <SafeAreaView style={styles.fill} edges={['left', 'right']}>
      <MemberProfile key={epoch} epoch={epoch} />
    </SafeAreaView>
  )
}

function MemberProfile({ epoch }: { epoch: number }) {
  const { t, i18n } = useTranslation()
  const [session] = useMemberSessionState()
  const [summary, setSummary] = useState<Summary>()
  useFocusEffect(
    useCallback(() => {
      if (session !== 'member') return
      const controller = new AbortController()
      const { signal } = controller
      const stillCurrent = () => !signal.aborted && epoch === mobileIdentityEpoch()
      const read = async () => {
        const token = await resolveMobileAccessToken()
        if (!stillCurrent()) return
        if (!token) {
          setSummary((previous) => previous ?? {})
          return
        }
        const scopedFetch: typeof fetch = (input, init) => {
          if (!stillCurrent()) return Promise.reject(new Error('Profile owner changed.'))
          return fetch(input, {
            ...init,
            signal,
            headers: { Authorization: `Bearer ${token}` },
          })
        }
        const [account, places, setup, premium, notifications] = await Promise.allSettled(
          [
            getUserProfileFromMobile(scopedFetch),
            listLocationsFromMobile(signal, stillCurrent),
            getWardrobeOnboardingStateFromMobile(token, signal),
            getPremiumAccessFromMobile(signal, token),
            communitySyncFromMobile(token).preferences(signal),
          ]
        )
        if (!stillCurrent()) return
        setSummary((previous) => {
          const next: Summary = { ...previous }
          if (account.status === 'fulfilled')
            next.name = account.value.user.displayName?.trim() || null
          if (places.status === 'fulfilled') {
            const primary =
              places.value.find((place) => place.isPrimary) ?? places.value[0]
            next.place = primary?.city || primary?.label || null
          }
          if (setup.status === 'fulfilled') next.setup = setup.value.status
          if (premium.status === 'fulfilled') next.premium = premium.value.premium
          if (notifications.status === 'fulfilled')
            next.notifications = notifications.value.enabled
          return next
        })
      }
      void read().catch(() => {
        if (stillCurrent()) setSummary((previous) => previous ?? {})
      })
      return () => controller.abort()
    }, [epoch, session])
  )

  const locale =
    resolveSupportedLocale(i18n.resolvedLanguage ?? i18n.language) ??
    defaultSupportedLocale
  const neutral = t('settings.profile.unavailable')
  const notSet = t('settings.profile.notSet')
  const rows = [
    [
      'account',
      '/settings-account',
      summary?.name === null ? notSet : (summary?.name ?? neutral),
    ],
    [
      'places',
      '/locations',
      summary?.place === null ? notSet : (summary?.place ?? neutral),
    ],
    [
      'style',
      '/settings-style',
      summary?.setup ? t(`settings.profile.setup.${summary.setup}`) : neutral,
    ],
    [
      'premium',
      '/settings-premium',
      summary?.premium === undefined
        ? neutral
        : t(
            summary.premium
              ? 'settings.profile.premiumActive'
              : 'settings.profile.premiumFree'
          ),
    ],
    [
      'notifications',
      '/notification-settings',
      summary?.notifications === undefined
        ? neutral
        : t(summary.notifications ? 'settings.profile.on' : 'settings.profile.off'),
    ],
    ['language', '/settings-language', t(`settings.languages.${locale}`)],
    ['about', '/settings-about', 'CoutureCast'],
  ] as const

  return (
    <ScreenGate
      screen="profile"
      session={session}
      ready={summary !== undefined}
      style={styles.fill}
    >
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <View testID="settings-screen">
          {rows.map(([id, href, value]) => (
            <NavRow
              key={id}
              testID={`profile-${id}-row`}
              label={t(`settings.profile.${id}`)}
              value={value}
              onPress={() => router.push(href)}
            />
          ))}
          {session === 'member' && <ProfileSignOut />}
        </View>
      </ScrollView>
    </ScreenGate>
  )
}

function ProfileSignOut() {
  const colors = useSchemeColors()
  const { t, i18n } = useTranslation()
  const [state, setState] = useState<'idle' | 'pending' | 'failed'>('idle')
  const inFlight = useRef(false)

  async function signOut() {
    if (inFlight.current) return
    inFlight.current = true
    setState('pending')
    try {
      const { signOutNativeSession } = await import('../../src/lib/native-session.js')
      await signOutNativeSession()
      setState('idle')
      router.navigate('/')
    } catch {
      setState('failed')
    } finally {
      inFlight.current = false
    }
  }

  const pending = state === 'pending'
  return (
    <>
      <Pressable
        testID="profile-sign-out"
        accessibilityRole="button"
        accessibilityState={{ busy: pending, disabled: pending }}
        aria-busy={pending}
        disabled={pending}
        style={[styles.signOut, { borderColor: colors.lineStrong }]}
        onPress={() => void signOut()}
      >
        <Text style={styles.signOutLabel}>
          {getGuestPreviewStrings(i18n.language).chrome.signOut}
        </Text>
      </Pressable>
      {state === 'failed' && (
        <Text accessibilityRole="alert" style={{ color: colors.dangerInk }}>
          {t('feedback.failed')}
        </Text>
      )}
    </>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { paddingHorizontal: TAB_BODY_INSET, paddingTop: 16, paddingBottom: 32 },
  signOut: {
    minHeight: 44,
    marginTop: 16,
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 12,
    alignItems: 'center',
  },
  signOutLabel: { fontSize: 14, fontWeight: '600' },
})
