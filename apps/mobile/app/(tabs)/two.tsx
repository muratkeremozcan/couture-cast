import { useEffect, useRef, useState } from 'react'
import { Pressable, SafeAreaView, ScrollView, StyleSheet } from 'react-native'
import { useTranslation } from 'react-i18next'
import {
  defaultSupportedLocale,
  resolveSupportedLocale,
  type SupportedLocale,
} from '@couture/api-client/contracts/http'

import EditScreenInfo from '@/components/edit-screen-info'
import { Text, View } from '@/components/themed'
import { useMobileAnalytics } from '@/src/analytics/mobile-analytics'
import {
  MobileAnalyticsDiagnosticsPanel,
  isMobileAnalyticsDiagnosticsEnabled,
} from '@/src/analytics/mobile-analytics-diagnostics'
import {
  trackMobileAlertReceived,
  trackMobileLocaleSwitched,
} from '@/src/analytics/track-events'
import { loadMobileApiHealth } from '@/src/lib/api-health'
import { getSavedSettings, saveSettings } from '@/src/lib/settings-storage'
import { updatePreferredLocaleFromMobile } from '@/src/lib/user'

const API_HEALTH_TIMEOUT_MS = 5_000

const availableLocales = [
  { code: 'en-US', label: 'English (US)' },
  { code: 'en-CA', label: 'English (Canada)' },
  { code: 'es-419', label: 'Español (LatAm)' },
  { code: 'fr-CA', label: 'Français (Canada)' },
  { code: 'fr-FR', label: 'Français (Europe)' },
  { code: 'tr-TR', label: 'Türkçe' },
  { code: 'de-DE', label: 'Deutsch' },
  { code: 'it-IT', label: 'Italiano' },
  { code: 'pt-BR', label: 'Português (Brasil)' },
  { code: 'pt-PT', label: 'Português (Portugal)' },
] satisfies readonly { code: SupportedLocale; label: string }[]

export default function TabTwoScreen() {
  const analytics = useMobileAnalytics()
  const { t, i18n } = useTranslation()
  const [apiHealthMessage, setApiHealthMessage] = useState('Checking API health...')
  const [currentLocale, setCurrentLocale] = useState<SupportedLocale>(
    resolveSupportedLocale(i18n.resolvedLanguage ?? i18n.language) ??
      defaultSupportedLocale
  )
  const [isChangingLocale, setIsChangingLocale] = useState(false)
  const [localeError, setLocaleError] = useState<string | null>(null)
  const localeChangeInFlight = useRef(false)

  useEffect(() => {
    analytics.capture('tab_two_viewed')
  }, [analytics])

  useEffect(() => {
    let isActive = true

    void getSavedSettings().then(async (settings) => {
      if (!isActive || !settings.locale) {
        return
      }

      setCurrentLocale(settings.locale)
      if (settings.localeSyncPending && !localeChangeInFlight.current) {
        try {
          await updatePreferredLocaleFromMobile(settings.locale)
          const didPersistSync = await saveSettings({ localeSyncPending: false })
          if (!didPersistSync) {
            throw new Error('Unable to persist locale synchronization state')
          }
        } catch {
          if (isActive) {
            setLocaleError(
              t('settings.locale_sync_error', {
                defaultValue:
                  'Language changed on this device. Profile sync will retry later.',
              })
            )
          }
        }
      }
    })

    return () => {
      isActive = false
    }
  }, [t])

  const recordDiagnosticAlert = () => {
    trackMobileAlertReceived(analytics, {
      userId: analytics.getDistinctId() || 'mobile-anonymous-user',
      alertType: 'weather_alert',
      severity: 'warning',
      weatherSeverity: 'storm_warning',
    })
  }

  const handleLanguageChange = async (localeCode: SupportedLocale) => {
    if (localeChangeInFlight.current || localeCode === currentLocale) {
      return
    }

    localeChangeInFlight.current = true
    setIsChangingLocale(true)
    setLocaleError(null)
    const oldLocale =
      resolveSupportedLocale(i18n.resolvedLanguage ?? i18n.language) ??
      defaultSupportedLocale

    try {
      await i18n.changeLanguage(localeCode)
      const didPersistLocale = await saveSettings({
        locale: localeCode,
        localeSyncPending: true,
      })
      if (!didPersistLocale) {
        throw new Error('Unable to persist locale settings')
      }
      setCurrentLocale(localeCode)

      trackMobileLocaleSwitched(analytics, {
        userId: analytics.getDistinctId() || 'mobile-anonymous-user',
        fromLocale: oldLocale,
        toLocale: localeCode,
      })

      try {
        await updatePreferredLocaleFromMobile(localeCode)
        const didPersistSync = await saveSettings({ localeSyncPending: false })
        if (!didPersistSync) {
          throw new Error('Unable to persist locale synchronization state')
        }
      } catch {
        setLocaleError(
          t('settings.locale_sync_error', {
            defaultValue:
              'Language changed on this device. Profile sync will retry later.',
          })
        )
      }
    } catch {
      await i18n.changeLanguage(oldLocale).catch(() => undefined)
      setLocaleError(
        t('settings.locale_change_error', {
          defaultValue: 'Unable to change language. Please try again.',
        })
      )
    } finally {
      localeChangeInFlight.current = false
      setIsChangingLocale(false)
    }
  }

  useEffect(() => {
    let isActive = true
    const unavailableTimer = setTimeout(() => {
      if (!isActive) {
        return
      }
      setApiHealthMessage(
        t('settings.api_health_unavailable', {
          defaultValue: 'API health unavailable',
        })
      )
    }, API_HEALTH_TIMEOUT_MS)

    void loadMobileApiHealth()
      .then((health) => {
        clearTimeout(unavailableTimer)
        if (!isActive) {
          return
        }
        setApiHealthMessage(
          t('settings.api_health_status', {
            status: health.status,
            defaultValue: `API health: ${health.status}`,
          })
        )
      })
      .catch(() => {
        clearTimeout(unavailableTimer)
        if (!isActive) {
          return
        }
        setApiHealthMessage(
          t('settings.api_health_unavailable', {
            defaultValue: 'API health unavailable',
          })
        )
      })

    return () => {
      isActive = false
      clearTimeout(unavailableTimer)
    }
  }, [t])

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.container}>
          <Text style={styles.title}>
            {t('tabs.tab_two', { defaultValue: 'Tab Two' })}
          </Text>
          <View
            style={styles.separator}
            lightColor="#eee"
            darkColor="rgba(255,255,255,0.1)"
          />

          <View style={styles.settingsSection}>
            <Text style={styles.sectionTitle}>
              {t('settings.language', { defaultValue: 'Language' })}
            </Text>
            <View style={styles.localeGrid}>
              {availableLocales.map((locale) => {
                const isSelected = currentLocale === locale.code
                return (
                  <Pressable
                    key={locale.code}
                    style={[
                      styles.localeButton,
                      isSelected && styles.selectedLocaleButton,
                    ]}
                    disabled={isChangingLocale || isSelected}
                    onPress={() => {
                      void handleLanguageChange(locale.code)
                    }}
                    testID={`locale-btn-${locale.code}`}
                    accessibilityRole="button"
                    accessibilityState={{
                      disabled: isChangingLocale,
                      selected: isSelected,
                    }}
                  >
                    <Text
                      style={[styles.localeText, isSelected && styles.selectedLocaleText]}
                    >
                      {t(`settings.languages.${locale.code}`, {
                        defaultValue: locale.label,
                      })}
                    </Text>
                  </Pressable>
                )
              })}
            </View>
          </View>

          {localeError ? (
            <Text style={styles.errorText} accessibilityRole="alert">
              {localeError}
            </Text>
          ) : null}
          <EditScreenInfo path="app/(tabs)/two.tsx" />
          <Text style={styles.infoText}>{apiHealthMessage}</Text>
          <Text style={styles.infoText}>
            {t('settings.diagnostic_info', {
              defaultValue:
                'alert_received tracking is wired to real push notification receipt listeners.',
            })}
          </Text>
          {isMobileAnalyticsDiagnosticsEnabled ? (
            <Pressable style={styles.actionButton} onPress={recordDiagnosticAlert}>
              <Text style={styles.actionText}>
                {t('settings.diagnostic_alert_btn', {
                  defaultValue: 'Record weather alert analytics',
                })}
              </Text>
            </Pressable>
          ) : null}
          <MobileAnalyticsDiagnosticsPanel />
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
  },
  container: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'flex-start',
    padding: 16,
    paddingBottom: 32,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
  },
  separator: {
    marginVertical: 15,
    height: 1,
    width: '80%',
  },
  settingsSection: {
    width: '90%',
    marginVertical: 15,
    alignItems: 'stretch',
    backgroundColor: 'transparent',
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 10,
    textAlign: 'left',
  },
  localeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    backgroundColor: 'transparent',
  },
  localeButton: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#e6e6ed',
    borderRadius: 8,
    backgroundColor: 'transparent',
  },
  selectedLocaleButton: {
    borderColor: '#C9A14A',
    backgroundColor: 'rgba(201, 161, 74, 0.1)',
  },
  localeText: {
    fontSize: 13,
    color: '#888888',
  },
  selectedLocaleText: {
    color: '#C9A14A',
    fontWeight: 'bold',
  },
  errorText: {
    marginTop: 12,
    color: '#B42318',
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
    maxWidth: '90%',
  },
  infoText: {
    marginTop: 16,
    fontSize: 14,
    fontWeight: '500',
    textAlign: 'center',
    maxWidth: '80%',
  },
  actionButton: {
    marginTop: 16,
    borderWidth: 1,
    borderColor: '#a3a3a3',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    alignItems: 'center',
  },
  actionText: {
    fontSize: 14,
    fontWeight: '600',
  },
})
