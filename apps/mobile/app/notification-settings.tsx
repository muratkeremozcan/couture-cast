import {
  communityPreferenceChanges,
  communityDeviceTimezoneDraft,
  isCommunityPreferenceConflict,
  communityPreferenceFailureKey,
  rebaseCommunityPreferenceDraft,
} from '@couture/api-client'
import { useEffect, useState, useRef } from 'react'
import {
  View,
  Text as ButtonLabel,
  TextInput,
  Switch,
  Pressable,
  ScrollView,
  StyleSheet,
  Linking,
  AccessibilityInfo,
  Platform,
} from 'react-native'
import { useTranslation } from 'react-i18next'
import { router } from 'expo-router'
import { Text, useThemeColor } from '@/components/themed'
import {
  LOAD_RETRY_DELAYS_MS,
  nextRetryDelayMs,
  retryAfterMs,
} from '@/src/lib/notification-load-retry'
import { shareCardFixtureMode } from '@/src/lib/share-card-native-fixture'
import { traceShareCardOpener } from '@/src/lib/share-card-presentation-trace'
import type { CommunityNotificationSettings } from '@couture/api-client/contracts/http'
import { communitySyncFromMobile } from '@/src/lib/community'
import { enableNativeCommunityNotifications } from '@/src/lib/native-notifications'
import { nativeNotificationFailureKey } from '@/src/lib/native-notification-errors'
import { resolveMobileAccessToken } from '@/src/lib/mobile-auth'
import { getCalendars } from 'expo-localization'
import {
  nativeSessionIdentity,
  subscribeNativeSession,
  signOutNativeSession,
} from '@/src/lib/native-session'
// Shown while automatic retries run, then replaced by LOAD_FAILED once the Try again button is offered.
const LOAD_RETRYING = 'community.notifications.loadRetrying'
const LOAD_FAILED = 'community.notifications.loadFailed'
export default function NotificationSettingsScreen() {
  const { t } = useTranslation()
  const [settings, setSettings] = useState<CommunityNotificationSettings | null>(null)
  const [draft, setDraft] = useState<CommunityNotificationSettings | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // True once the bounded automatic retries have stopped without settings.
  const [loadStalled, setLoadStalled] = useState(false)
  const reload = useRef<(() => void) | null>(null)
  const inputColor = useThemeColor({}, 'text')
  const suggestedTimezone = useRef<string | undefined>(undefined)
  const generation = useRef(0)
  const clientRef = useRef<ReturnType<typeof communitySyncFromMobile> | null>(null)
  useEffect(() => {
    let active = true
    let owner: string | null | undefined
    let attempts = 0
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    // A load that ends without settings is never silent: the failure message shows and a bounded
    // retry follows, so a token that settles after sign-in still produces the controls.
    const failed = (request: number, next: string, requested?: number) => {
      if (!active || request !== generation.current || nativeSessionIdentity() !== next)
        return
      const delay = LOAD_RETRY_DELAYS_MS[attempts++]
      if (delay === undefined) {
        setMessage(LOAD_FAILED)
        setLoadStalled(true)
        return
      }
      setMessage(LOAD_RETRYING)
      traceShareCardOpener('prefs-retry')
      retryTimer = setTimeout(
        () => {
          if (
            active &&
            request === generation.current &&
            nativeSessionIdentity() === next
          )
            load(next)
        },
        nextRetryDelayMs(delay, requested)
      )
    }
    const load = (next: string) => {
      const request = ++generation.current
      clientRef.current = null
      void (async () => {
        const token = await resolveMobileAccessToken()
        if (
          !active ||
          request !== generation.current ||
          nativeSessionIdentity() !== next ||
          !token
        ) {
          traceShareCardOpener(token ? 'prefs-stale' : 'prefs-token-null')
          if (!token) failed(request, next)
          return
        }
        // Only the isolated native test build can select this mode; elsewhere it is always 'real'.
        if (shareCardFixtureMode() === 'prefs_unavailable')
          throw new Error('Fixture: notification settings unavailable.')
        const client = communitySyncFromMobile(async () => {
          const fresh = await resolveMobileAccessToken()
          if (!fresh || nativeSessionIdentity() !== next)
            throw new Error('Notification account changed.')
          return fresh
        })
        clientRef.current = client
        const value = await client.preferences()
        if (
          !active ||
          request !== generation.current ||
          nativeSessionIdentity() !== next
        ) {
          traceShareCardOpener('prefs-stale')
          return
        }
        traceShareCardOpener('prefs-loaded')
        attempts = 0
        setLoadStalled(false)
        setMessage(null)
        setSettings(value)
        const draft = communityDeviceTimezoneDraft(
          value,
          getCalendars()[0]?.timeZone ?? undefined
        )
        suggestedTimezone.current = value.timezoneConfigured ? undefined : draft.timezone
        setDraft(draft)
      })().catch((error: unknown) => {
        traceShareCardOpener('prefs-failed')
        // A retryable 503 says how long to wait; the schedule is the floor, the bound the ceiling.
        void retryAfterMs(error).then((requested) => failed(request, next, requested))
      })
    }
    const update = () => {
      const next = nativeSessionIdentity()
      if (next === owner) return
      owner = next
      attempts = 0
      clearTimeout(retryTimer)
      generation.current++
      clientRef.current = null
      setLoadStalled(false)
      setSettings(null)
      setDraft(null)
      setMessage(null)
      setBusy(false)
      if (next) load(next)
    }
    reload.current = () => {
      if (!owner) return
      attempts = 0
      clearTimeout(retryTimer)
      setLoadStalled(false)
      setMessage(null)
      load(owner)
    }
    update()
    const unsubscribe = subscribeNativeSession(update)
    const retire = () => {
      generation.current++
      clientRef.current = null
    }
    return () => {
      active = false
      reload.current = null
      clearTimeout(retryTimer)
      retire()
      unsubscribe()
    }
  }, [])
  const recoverSave = async (
    error: unknown,
    client: ReturnType<typeof communitySyncFromMobile>,
    settings: CommunityNotificationSettings,
    current: () => boolean
  ) => {
    const nativeFailure = nativeNotificationFailureKey(error)
    if (nativeFailure) setMessage(nativeFailure)
    else if (isCommunityPreferenceConflict(error)) {
      setMessage('community.notifications.conflict')
      try {
        const value = await client.preferences()
        if (current()) {
          setSettings(value)
          setDraft((previous) =>
            previous
              ? rebaseCommunityPreferenceDraft(
                  settings,
                  value,
                  previous,
                  suggestedTimezone.current
                )
              : value
          )
        }
      } catch {
        if (current()) setMessage('community.notifications.failed')
      }
    } else setMessage(communityPreferenceFailureKey(error))
  }
  const save = async () => {
    const client = clientRef.current
    const owner = nativeSessionIdentity()
    if (!draft || !settings || !client || !owner || busy) return
    const request = generation.current
    const current = () =>
      request === generation.current && nativeSessionIdentity() === owner
    setBusy(true)
    try {
      let base = settings
      if (draft.enabled && !settings.enabled)
        base = await enableNativeCommunityNotifications()
      if (!current()) return
      const rebased = rebaseCommunityPreferenceDraft(
        settings,
        base,
        draft,
        suggestedTimezone.current
      )
      const changes = communityPreferenceChanges(base, rebased)
      if (base.enabled === draft.enabled) delete changes.enabled
      const updated = Object.keys(changes).length
        ? await client.patchPreferences({ baseRevision: base.revision, ...changes })
        : base
      if (!current()) return
      setSettings(updated)
      setDraft(updated)
      setMessage('community.notifications.saved')
    } catch (error) {
      if (!current()) return
      await recoverSave(error, client, settings, current)
    } finally {
      if (current()) setBusy(false)
    }
  }
  // accessibilityLiveRegion is honoured on Android only; iOS needs an explicit announcement.
  useEffect(() => {
    if ((message === LOAD_FAILED || message === LOAD_RETRYING) && Platform.OS === 'ios')
      AccessibilityInfo.announceForAccessibility(t(message))
  }, [message, t])
  return (
    <ScrollView contentContainerStyle={styles.container}>
      {draft && (
        <>
          <View style={styles.row}>
            <Text style={styles.label}>{t('community.notifications.enabled')}</Text>
            <Switch
              accessibilityLabel={t('community.notifications.enabled')}
              value={draft.enabled}
              onValueChange={(enabled) => setDraft({ ...draft, enabled })}
              disabled={busy}
            />
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>{t('community.notifications.quiet')}</Text>
            <Switch
              accessibilityLabel={t('community.notifications.quiet')}
              value={draft.quietHoursEnabled}
              onValueChange={(quietHoursEnabled) =>
                setDraft({ ...draft, quietHoursEnabled })
              }
              disabled={busy}
            />
          </View>
          <Text>{t('community.notifications.start')}</Text>
          <TextInput
            accessibilityLabel={t('community.notifications.start')}
            value={draft.quietHoursStart}
            onChangeText={(quietHoursStart) => setDraft({ ...draft, quietHoursStart })}
            style={[styles.input, { color: inputColor }]}
          />
          <Text>{t('community.notifications.end')}</Text>
          <TextInput
            accessibilityLabel={t('community.notifications.end')}
            value={draft.quietHoursEnd}
            onChangeText={(quietHoursEnd) => setDraft({ ...draft, quietHoursEnd })}
            style={[styles.input, { color: inputColor }]}
          />
          <Text>{t('community.notifications.timezone')}</Text>
          <TextInput
            accessibilityLabel={t('community.notifications.timezone')}
            value={draft.timezone}
            onChangeText={(timezone) => {
              suggestedTimezone.current = undefined
              setDraft({ ...draft, timezone })
            }}
            autoCapitalize="none"
            style={[styles.input, { color: inputColor }]}
          />
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={() => {
              void save()
            }}
            style={styles.button}
          >
            <ButtonLabel style={styles.buttonLabel}>
              {t('community.notifications.save')}
            </ButtonLabel>
          </Pressable>
        </>
      )}
      <Text accessibilityLiveRegion="polite">{message ? t(message) : ''}</Text>
      {loadStalled && !draft && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('community.notifications.retry')}
          testID="notification-settings-retry"
          onPress={() => reload.current?.()}
          style={styles.button}
        >
          <ButtonLabel style={styles.buttonLabel}>
            {t('community.notifications.retry')}
          </ButtonLabel>
        </Pressable>
      )}
      {message === 'community.notifications.permission' && (
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            void Linking.openSettings()
          }}
          style={styles.button}
        >
          <ButtonLabel style={styles.buttonLabel}>
            {t('community.notifications.deviceSettings')}
          </ButtonLabel>
        </Pressable>
      )}
      <Pressable
        accessibilityRole="link"
        onPress={() => router.push('/signin')}
        style={styles.button}
      >
        <ButtonLabel style={styles.buttonLabel}>
          {t('community.notifications.signin')}
        </ButtonLabel>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        onPress={() => {
          void signOutNativeSession().then(() => router.back())
        }}
        style={styles.button}
      >
        <ButtonLabel style={styles.buttonLabel}>
          {t('community.notifications.signout')}
        </ButtonLabel>
      </Pressable>
    </ScrollView>
  )
}
const styles = StyleSheet.create({
  container: { padding: 24, gap: 16 },
  title: { fontSize: 26, fontWeight: '600' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48 },
  label: { flex: 1 },
  input: {
    minHeight: 48,
    padding: 12,
    borderWidth: 1,
    borderColor: '#777',
    borderRadius: 8,
  },
  buttonLabel: { color: '#000' },
  button: {
    minHeight: 48,
    padding: 14,
    backgroundColor: '#C9A14A',
    borderRadius: 8,
    alignItems: 'center',
  },
})
