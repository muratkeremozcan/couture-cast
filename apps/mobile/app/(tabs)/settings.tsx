import { useEffect, useRef, useState } from 'react'
import { Pressable, ScrollView, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useTranslation } from 'react-i18next'
import {
  defaultSupportedLocale,
  resolveSupportedLocale,
  type SupportedLocale,
} from '@couture/api-client/contracts/http'

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
import {
  getCommercePreferenceFromMobile,
  updateCommercePreferenceFromMobile,
} from '@/src/lib/commerce'
import { getSavedSettings, saveSettings } from '@/src/lib/settings-storage'
import { updatePreferredLocaleFromMobile } from '@/src/lib/user'
import { useAccessibilityAnnouncer } from '@/src/hooks/use-accessibility-announcer'

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

export default function SettingsScreen() {
  const analytics = useMobileAnalytics()
  const { announce } = useAccessibilityAnnouncer()
  const { t, i18n } = useTranslation()
  const [apiHealthMessage, setApiHealthMessage] = useState('Checking API health...')
  const [currentLocale, setCurrentLocale] = useState<SupportedLocale>(
    resolveSupportedLocale(i18n.resolvedLanguage ?? i18n.language) ??
      defaultSupportedLocale
  )
  const [isChangingLocale, setIsChangingLocale] = useState(false)
  const [localeError, setLocaleError] = useState<string | null>(null)
  const localeChangeInFlight = useRef(false)
  // `null` means "not known yet", which is not the same as "off". The toggle
  // stays inert until the server has told us what the stored value is, so a
  // failed read can never be mistaken for an opt-out the user did not make.
  const [affiliateCtasEnabled, setAffiliateCtasEnabled] = useState<boolean | null>(null)
  const [commerceStatus, setCommerceStatus] = useState<string | null>(null)
  const [commerceError, setCommerceError] = useState<string | null>(null)
  const commerceChangeInFlight = useRef(false)

  useEffect(() => {
    if (localeError) {
      announce('error', localeError)
    }
  }, [announce, localeError])

  useEffect(() => {
    const controller = new AbortController()

    void getCommercePreferenceFromMobile(controller.signal)
      .then((preference) => {
        if (!controller.signal.aborted) {
          setAffiliateCtasEnabled(preference.affiliateCtasEnabled)
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setCommerceError(
            // The catalog always carries this key: `commerce-locales.spec.ts`
            // asserts an exact key tree across all ten locales, which is a
            // stronger guarantee than an inline fallback that can drift.
            t('commerce.settings.error')
          )
        }
      })

    return () => controller.abort()
  }, [t])

  const handleAffiliateCtasToggle = async () => {
    if (commerceChangeInFlight.current || affiliateCtasEnabled === null) {
      return
    }

    const previous = affiliateCtasEnabled
    const next = !previous
    commerceChangeInFlight.current = true
    // Optimistic, then reverted on failure. The alternative leaves the switch
    // visually stuck under the user's finger for a whole round trip.
    setAffiliateCtasEnabled(next)
    setCommerceStatus(null)
    setCommerceError(null)

    try {
      const preference = await updateCommercePreferenceFromMobile(next)
      setAffiliateCtasEnabled(preference.affiliateCtasEnabled)
      setCommerceStatus(t('commerce.settings.saved'))
    } catch {
      setAffiliateCtasEnabled(previous)
      setCommerceError(t('commerce.settings.error'))
    } finally {
      commerceChangeInFlight.current = false
    }
  }

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
        <View style={styles.container} testID="settings-screen">
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
                      disabled: isChangingLocale || isSelected,
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
            <Text
              style={styles.errorText}
              accessibilityRole="alert"
              accessibilityLiveRegion="assertive"
            >
              {localeError}
            </Text>
          ) : null}
          {/* Shopping and partners. PRD NFR Security 4 requires an explicit
              third-party disclosure alongside the toggle, so the paragraph sits
              above the control and is never collapsed behind it. These
              endpoints are not gated by commerce_affiliate_enabled: a user must
              always be able to read and set their own preference. */}
          <View style={styles.settingsSection} testID="commerce-settings-section">
            <Text style={styles.sectionTitle}>{t('commerce.settings.sectionTitle')}</Text>
            <Text style={styles.disclosureText} testID="commerce-settings-disclosure">
              {t('commerce.settings.disclosure')}
            </Text>
            <Pressable
              style={[
                styles.commerceToggle,
                affiliateCtasEnabled ? styles.commerceToggleOn : null,
              ]}
              disabled={affiliateCtasEnabled === null}
              onPress={() => {
                void handleAffiliateCtasToggle()
              }}
              testID="commerce-opt-out-toggle"
              accessibilityRole="switch"
              accessibilityState={{
                checked: affiliateCtasEnabled ?? false,
                disabled: affiliateCtasEnabled === null,
              }}
              // react-native-web does not project `accessibilityState` onto the
              // DOM, so the aria pair rides alongside it exactly as
              // `components/chip-navigation.tsx` does.
              aria-checked={affiliateCtasEnabled ?? false}
              aria-disabled={affiliateCtasEnabled === null}
              accessibilityLabel={t('commerce.settings.optOutLabel')}
              accessibilityHint={t('commerce.settings.optOutHelp')}
            >
              <Text style={styles.commerceToggleLabel}>
                {t('commerce.settings.optOutLabel')}
              </Text>
            </Pressable>
            <Text style={styles.helpText}>{t('commerce.settings.optOutHelp')}</Text>
            {commerceStatus ? (
              <Text
                style={styles.statusText}
                testID="commerce-settings-status"
                accessibilityLiveRegion="polite"
              >
                {commerceStatus}
              </Text>
            ) : null}
            {commerceError ? (
              <Text
                style={styles.errorText}
                testID="commerce-settings-error"
                accessibilityRole="alert"
                accessibilityLiveRegion="assertive"
              >
                {commerceError}
              </Text>
            ) : null}
          </View>

          <Text style={styles.infoText}>{apiHealthMessage}</Text>
          <Text style={styles.infoText}>
            {t('settings.diagnostic_info', {
              defaultValue:
                'alert_received tracking is wired to real push notification receipt listeners.',
            })}
          </Text>
          {isMobileAnalyticsDiagnosticsEnabled ? (
            <Pressable
              style={styles.actionButton}
              onPress={recordDiagnosticAlert}
              accessibilityRole="button"
              accessibilityLabel={t('settings.diagnostic_alert_btn', {
                defaultValue: 'Record weather alert analytics',
              })}
            >
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
  settingsSection: {
    width: '90%',
    marginTop: 8,
    marginBottom: 15,
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
    minHeight: 44,
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
    color: '#5C5C66',
  },
  selectedLocaleText: {
    color: '#8A691F',
    fontWeight: 'bold',
  },
  disclosureText: {
    fontSize: 13,
    lineHeight: 18,
    color: '#5C5C66',
    marginBottom: 12,
  },
  commerceToggle: {
    // Decision 17: at least 44 by 44 device-independent pixels.
    minHeight: 44,
    minWidth: 44,
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#e6e6ed',
    borderRadius: 8,
    backgroundColor: 'transparent',
  },
  commerceToggleOn: {
    borderColor: '#C9A14A',
    backgroundColor: 'rgba(201, 161, 74, 0.1)',
  },
  commerceToggleLabel: {
    fontSize: 14,
    fontWeight: '600',
  },
  helpText: {
    marginTop: 8,
    fontSize: 12,
    lineHeight: 16,
    color: '#5C5C66',
  },
  statusText: {
    marginTop: 8,
    fontSize: 13,
    fontWeight: '600',
    color: '#276749',
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
    minHeight: 44,
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
