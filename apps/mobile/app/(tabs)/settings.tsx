import { useEffect, useMemo, useRef, useState } from 'react'
import { Pressable, ScrollView, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useTranslation } from 'react-i18next'
import {
  defaultSupportedLocale,
  resolveSupportedLocale,
  type PremiumThemeKey,
  type Subscription,
  type SubscriptionPlan,
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
  trackMobilePremiumSubscribeTapped,
} from '@/src/analytics/track-events'
import { loadMobileApiHealth } from '@/src/lib/api-health'
import {
  getCommercePreferenceFromMobile,
  updateCommercePreferenceFromMobile,
} from '@/src/lib/commerce'
import {
  ensurePurchasesConfigured,
  getSubscriptionFromMobile,
  isEntitledSubscription,
  pollSubscriptionUntilEntitled,
  purchasePremiumPlan,
  refreshSubscriptionFromMobile,
  resolvePremiumSectionState,
  restorePremiumPurchases,
  showManageSubscriptionsInStore,
  type PurchasesAvailability,
} from '@/src/lib/premium'
import {
  premiumThemeFailureReason,
  setThemeFromMobile,
  PREMIUM_THEME_KEYS,
} from '@/src/lib/premium-theme'
import { getSavedSettings, saveSettings } from '@/src/lib/settings-storage'
import { updatePreferredLocaleFromMobile } from '@/src/lib/user'
import { useAccessibilityAnnouncer } from '@/src/hooks/use-accessibility-announcer'
import { useAppTheme } from '@/src/theme/theme-context'
import { resolveThemePalette } from '@/src/theme/theme-palettes'

/** Exported so the screen test advances virtual time by the real bound rather
 *  than by a copy of it that silently stops matching when this changes. */
export const API_HEALTH_TIMEOUT_MS = 5_000

/** Wire status → `commerce.premium.status.*` catalog key. */
const premiumStatusKeys = {
  none: 'none',
  active: 'active',
  grace_period: 'gracePeriod',
  expired: 'expired',
  revoked: 'revoked',
} as const

/**
 * The purchase/restore flow the Premium section is in. Exactly one renders at
 * a time; `pending-approval` (StoreKit Ask to Buy) and `still-processing`
 * (post-purchase poll hit its 2-minute cap) are terminal until the user acts
 * again or the entitlement arrives on a later visit.
 */
type PremiumFlowState =
  | 'idle'
  | 'purchasing'
  | 'restoring'
  | 'activating'
  | 'pending-approval'
  | 'still-processing'
  | 'purchase-error'

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
            //
            // `loadError`, not `error`: this is the initial read, and `error`
            // reads "Unable to update shopping preferences.", which names an
            // action the user did not take and cannot retry from here.
            t('commerce.settings.loadError')
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

          <PremiumSettingsSection />

          <PremiumThemeSection />

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

/** A store round trip is in flight; every premium control disables meanwhile. */
function isPremiumFlowBusy(premiumFlow: PremiumFlowState): boolean {
  return (
    premiumFlow === 'purchasing' ||
    premiumFlow === 'restoring' ||
    premiumFlow === 'activating'
  )
}

/**
 * Premium subscription (Story 5.2), a sibling section after the commerce one.
 * The disclosure names RevenueCat and Stripe per PRD NFR Security 4 and sits
 * above every control, like the commerce section's. Purchases are never
 * optimistic: the store's answer, not the tap, moves the UI. The status
 * endpoint is not gated by the kill switch — a paying user always sees their
 * subscription — while `purchasesEnabled` (the only kill-switch exposure)
 * decides whether any subscribe control exists at all.
 */
function PremiumSettingsSection() {
  const analytics = useMobileAnalytics()
  const { t, i18n } = useTranslation()
  const [subscription, setSubscription] = useState<Subscription | null>(null)
  const [subscriptionLoadFailed, setSubscriptionLoadFailed] = useState(false)
  // `null` = the lazy SDK configure has not answered yet. The subscribe
  // controls stay hidden until it has: rendering them first and swapping to
  // the unavailable fallback after would flash a control that cannot work.
  const [purchasesAvailability, setPurchasesAvailability] =
    useState<PurchasesAvailability | null>(null)
  const [premiumFlow, setPremiumFlow] = useState<PremiumFlowState>('idle')
  const premiumFlowInFlight = useRef(false)
  const premiumPollAbortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    const controller = new AbortController()

    void getSubscriptionFromMobile(controller.signal)
      .then((current) => {
        if (!controller.signal.aborted) {
          setSubscription(current)
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setSubscriptionLoadFailed(true)
        }
      })

    // Entering this section IS the SDK's configuration moment (Decision 11:
    // lazily on first entry, never at app launch — the ritual path must not
    // pay for a billing SDK). The memoized result makes re-entry free.
    void ensurePurchasesConfigured().then((availability) => {
      if (!controller.signal.aborted) {
        setPurchasesAvailability(availability)
      }
    })

    return () => {
      controller.abort()
      premiumPollAbortRef.current?.abort()
    }
  }, [])

  /**
   * Success-outcome follow-up only: refresh beats webhook latency, then the
   * bounded poll (5-second interval, 2-minute hard stop) watches for the
   * entitlement. A `none` mid-poll never renders as failure — the terminal
   * cap state says "still processing", which is the truthful claim.
   */
  const watchEntitlementActivation = async () => {
    setPremiumFlow('activating')
    try {
      const refreshed = await refreshSubscriptionFromMobile()
      if (isEntitledSubscription(refreshed)) {
        setSubscription(refreshed)
        setPremiumFlow('idle')
        return
      }
    } catch {
      // The poll below is the retry mechanism.
    }
    const controller = new AbortController()
    premiumPollAbortRef.current = controller
    const activated = await pollSubscriptionUntilEntitled({ signal: controller.signal })
    if (controller.signal.aborted) {
      return
    }
    if (activated) {
      setSubscription(activated)
      setPremiumFlow('idle')
    } else {
      setPremiumFlow('still-processing')
    }
  }

  const handlePremiumPurchase = async (plan: SubscriptionPlan) => {
    if (premiumFlowInFlight.current) {
      return
    }
    premiumFlowInFlight.current = true
    setPremiumFlow('purchasing')
    trackMobilePremiumSubscribeTapped(
      analytics,
      analytics.getDistinctId() || 'mobile-anonymous-user',
      { plan, surface: 'mobile_settings' }
    )

    try {
      const outcome = await purchasePremiumPlan(plan)
      switch (outcome.kind) {
        case 'success':
          await watchEntitlementActivation()
          break
        case 'user-cancelled':
          // A quiet return to idle: the user changed their mind, and an error
          // banner over their own decision would read as a malfunction.
          setPremiumFlow('idle')
          break
        case 'deferred':
          setPremiumFlow('pending-approval')
          break
        case 'sdk-unavailable':
          setPurchasesAvailability('unavailable')
          setPremiumFlow('idle')
          break
        case 'error':
          setPremiumFlow('purchase-error')
          break
      }
    } finally {
      premiumFlowInFlight.current = false
    }
  }

  const handlePremiumRestore = async () => {
    if (premiumFlowInFlight.current) {
      return
    }
    premiumFlowInFlight.current = true
    setPremiumFlow('restoring')

    try {
      const outcome = await restorePremiumPurchases()
      if (outcome.kind === 'success') {
        // Restore only syncs the store; the server subscription is the truth
        // about what, if anything, came back.
        try {
          const refreshed = await refreshSubscriptionFromMobile()
          setSubscription(refreshed)
          setPremiumFlow('idle')
        } catch {
          setPremiumFlow('purchase-error')
        }
      } else if (outcome.kind === 'sdk-unavailable') {
        setPurchasesAvailability('unavailable')
        setPremiumFlow('idle')
      } else {
        setPremiumFlow('purchase-error')
      }
    } finally {
      premiumFlowInFlight.current = false
    }
  }

  const renderState = resolvePremiumSectionState(subscription, subscriptionLoadFailed)
  const busy = isPremiumFlowBusy(premiumFlow)
  const statusLine = (() => {
    if (renderState.kind === 'entitled') {
      const locale =
        resolveSupportedLocale(i18n.resolvedLanguage ?? i18n.language) ??
        defaultSupportedLocale
      const planLabel = renderState.plan
        ? t(
            renderState.plan === 'premium_monthly'
              ? 'commerce.premium.planMonthly'
              : 'commerce.premium.planAnnual'
          )
        : renderState.productId
      return t(
        `commerce.premium.status.${renderState.showGraceBanner ? 'gracePeriod' : 'active'}`,
        {
          plan: planLabel,
          date: new Date(renderState.currentPeriodEnd).toLocaleDateString(locale, {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          }),
        }
      )
    }
    if (renderState.kind === 'subscribe' && subscription) {
      return t(`commerce.premium.status.${premiumStatusKeys[subscription.status]}`)
    }
    return null
  })()

  return (
    <View style={styles.settingsSection} testID="premium-settings-section">
      <Text style={styles.sectionTitle}>{t('commerce.premium.sectionTitle')}</Text>
      <Text style={styles.disclosureText} testID="premium-settings-disclosure">
        {t('commerce.premium.disclosure')}
      </Text>
      {renderState.kind === 'load-error' ? (
        <Text
          style={styles.errorText}
          testID="premium-load-error"
          accessibilityRole="alert"
          accessibilityLiveRegion="assertive"
        >
          {t('commerce.premium.errorLoad')}
        </Text>
      ) : null}
      {statusLine ? (
        <Text style={styles.premiumStatusLine} testID="premium-status-line">
          {statusLine}
        </Text>
      ) : null}
      {renderState.kind === 'entitled' ? (
        <>
          {renderState.showGraceBanner ? (
            <Text
              style={styles.premiumGraceBanner}
              testID="premium-grace-banner"
              accessibilityLiveRegion="polite"
            >
              {t('commerce.premium.graceBanner')}
            </Text>
          ) : null}
          {renderState.manageEntry === 'store' ? (
            <Pressable
              style={styles.actionButton}
              onPress={() => {
                void showManageSubscriptionsInStore()
              }}
              testID="premium-manage"
              accessibilityRole="button"
            >
              <Text style={styles.actionText}>{t('commerce.premium.manage')}</Text>
            </Pressable>
          ) : null}
          {renderState.manageEntry === 'web' ? (
            <Text style={styles.helpText} testID="premium-manage-web-hint">
              {t('commerce.premium.manageInStore')}
            </Text>
          ) : null}
        </>
      ) : null}
      {renderState.kind === 'subscribe' ? (
        <>
          {renderState.ended ? (
            <Text style={styles.helpText} testID="premium-ended-note">
              {t('commerce.premium.endedNote')}
            </Text>
          ) : null}
          {renderState.purchasesEnabled && purchasesAvailability === 'unavailable' ? (
            <Text style={styles.helpText} testID="premium-unavailable">
              {t('commerce.premium.unavailableInBuild')}
            </Text>
          ) : null}
          {purchasesAvailability !== null && purchasesAvailability !== 'unavailable' ? (
            <PremiumSubscribeControls
              purchasesEnabled={renderState.purchasesEnabled}
              busy={busy}
              premiumFlow={premiumFlow}
              onPurchase={(plan) => {
                void handlePremiumPurchase(plan)
              }}
              onRestore={() => {
                void handlePremiumRestore()
              }}
            />
          ) : null}
        </>
      ) : null}
      <PremiumFlowMessages premiumFlow={premiumFlow} />
    </View>
  )
}

/**
 * The three store CTAs. Purchases show a busy state instead of optimistic UI:
 * `accessibilityState={{ busy }}` plus the aria mirror, since react-native-web
 * does not project `accessibilityState` onto the DOM (the commerce toggle's
 * aria-checked precedent).
 */
function PremiumSubscribeControls({
  purchasesEnabled,
  busy,
  premiumFlow,
  onPurchase,
  onRestore,
}: {
  purchasesEnabled: boolean
  busy: boolean
  premiumFlow: PremiumFlowState
  onPurchase: (plan: SubscriptionPlan) => void
  onRestore: () => void
}) {
  const { t } = useTranslation()
  const plans = [
    { plan: 'premium_monthly' as const, labelKey: 'commerce.premium.planMonthly' },
    { plan: 'premium_annual' as const, labelKey: 'commerce.premium.planAnnual' },
  ]

  return (
    <>
      {/*
        Only the BUY controls are behind the kill switch. Restore is not: it
        mints no purchase, it re-reads what the store already sold this user.
        Gating it too would mean a subscriber whose entitlement is missing from
        our mirror cannot recover access while the switch is off, which is the
        one thing AC 5 says must never happen. Decision 11 gates "the subscribe
        CTA"; AC 1 lists restore as its own entry point.
      */}
      {purchasesEnabled ? (
        <Text style={styles.helpText}>{t('commerce.premium.subscribe')}</Text>
      ) : null}
      {(purchasesEnabled ? plans : []).map(({ plan, labelKey }) => (
        <Pressable
          key={plan}
          style={styles.actionButton}
          disabled={busy}
          onPress={() => {
            onPurchase(plan)
          }}
          testID={`premium-subscribe-${plan === 'premium_monthly' ? 'monthly' : 'annual'}`}
          accessibilityRole="button"
          accessibilityState={{ disabled: busy, busy: premiumFlow === 'purchasing' }}
          aria-disabled={busy}
          aria-busy={premiumFlow === 'purchasing'}
        >
          <Text style={styles.actionText}>{t(labelKey)}</Text>
        </Pressable>
      ))}
      <Pressable
        style={styles.actionButton}
        disabled={busy}
        onPress={onRestore}
        testID="premium-restore"
        accessibilityRole="button"
        accessibilityState={{ disabled: busy, busy: premiumFlow === 'restoring' }}
        aria-disabled={busy}
        aria-busy={premiumFlow === 'restoring'}
      >
        <Text style={styles.actionText}>{t('commerce.premium.restore')}</Text>
      </Pressable>
    </>
  )
}

/**
 * Exactly one flow message renders at a time; the error is an assertive alert
 * (Decision 11) while the informational states announce politely.
 */
function PremiumFlowMessages({ premiumFlow }: { premiumFlow: PremiumFlowState }) {
  const { t } = useTranslation()

  return (
    <>
      {premiumFlow === 'activating' ? (
        <Text
          style={styles.statusText}
          testID="premium-activating"
          accessibilityLiveRegion="polite"
        >
          {t('commerce.premium.activating')}
        </Text>
      ) : null}
      {premiumFlow === 'still-processing' ? (
        <Text
          style={styles.statusText}
          testID="premium-still-processing"
          accessibilityLiveRegion="polite"
        >
          {t('commerce.premium.stillProcessing')}
        </Text>
      ) : null}
      {premiumFlow === 'pending-approval' ? (
        <Text
          style={styles.statusText}
          testID="premium-pending-approval"
          accessibilityLiveRegion="polite"
        >
          {t('commerce.premium.pendingApproval')}
        </Text>
      ) : null}
      {premiumFlow === 'purchase-error' ? (
        <Text
          style={styles.errorText}
          testID="premium-purchase-error"
          accessibilityRole="alert"
          accessibilityLiveRegion="assertive"
        >
          {t('commerce.premium.errorPurchase')}
        </Text>
      ) : null}
    </>
  )
}

/**
 * Exhaustive over the contract enum on purpose: a palette added to
 * `premiumThemeKeySchema` fails to typecheck here until it has a name to
 * render, so the mobile gallery cannot silently fall behind the contract.
 */
const PALETTE_LABEL_KEYS: Record<PremiumThemeKey, string> = {
  jewel_radiance: 'commerce.premium.theme.names.jewelRadiance',
  autumn_umber: 'commerce.premium.theme.names.autumnUmber',
  winter_metallic: 'commerce.premium.theme.names.winterMetallic',
}

interface ThemeOption {
  /** `null` is the implicit Default palette, which is also the reset control. */
  key: PremiumThemeKey | null
  /** The `testID` suffix and React key for this card. */
  id: string
  labelKey: string
}

/**
 * The gallery, in render order: the three named palettes then Default.
 *
 * Default is a real fourth card rather than a separate "reset" button, so a
 * subscriber who likes none of the three is not stuck with the last one they
 * tried. It is never gated — it is the state a non-entitled user already has.
 */
const THEME_OPTIONS: readonly ThemeOption[] = [
  ...PREMIUM_THEME_KEYS.map((key) => ({
    key,
    id: key,
    labelKey: PALETTE_LABEL_KEYS[key],
  })),
  { key: null, id: 'default', labelKey: 'commerce.premium.theme.reset' },
]

/** The `nativeID` the disabled cards point `aria-describedby` at. */
const THEME_UNAVAILABLE_HINT_ID = 'premium-theme-unavailable-hint'

/**
 * The palette names, joined the way the reader's language joins a list.
 *
 * The names arrive in the locked copy as one `{{palettes}}` interpolation built
 * from `PREMIUM_THEME_KEYS`, so the gallery and the upsell copy share a source
 * of truth and adding a palette does not mean hand-editing twenty localized
 * sentences.
 *
 * `Intl.ListFormat` rather than `join(', ')` because the join is not the same in
 * every language this ships in: German wants "und", French "et", Turkish "ve",
 * Spanish "y", and English and Canadian English disagree about the serial comma.
 * Hermes ships full ICU for `Intl.ListFormat` on both platforms in the Expo SDK
 * this app pins, and the same helper is already load-bearing on the web surface.
 */
function usePaletteNameList(): string {
  const { t, i18n } = useTranslation()
  const language = i18n.language

  return useMemo(() => {
    const names = PREMIUM_THEME_KEYS.map((key) => t(PALETTE_LABEL_KEYS[key]))
    return new Intl.ListFormat(language, {
      style: 'long',
      type: 'conjunction',
    }).format(names)
  }, [t, language])
}

/**
 * Interface palettes (Story 5.3 Task 6), a sibling section immediately after the
 * Premium one, which is where its locked copy points: "subscribe with the
 * controls above" names `PremiumSubscribeControls`, rendered directly above on
 * this same screen (Decision 12).
 *
 * Three things here are load-bearing rather than stylistic, and all three mirror
 * the web section deliberately so the two surfaces cannot drift:
 *
 * - **Each card pins its own palette; the preview pins none.** A card advertises
 *   the palette it offers, so it looks identical whether or not that palette is
 *   the applied one. The preview reads `useAppTheme().palette`, which is the
 *   applied one, so it is the single element on screen that actually changes when
 *   a save lands — without it, AC 4's instant apply would be provable only in a
 *   debugger.
 * - **`primary` and `secondary` never carry text.** Two of the three `primary`
 *   fills miss the 4.5:1 small-text floor against white (Decision 2), so they
 *   render as swatch dots ringed in the card's own `cardText`: Autumn Umber's
 *   Wheat and Winter Metallic's Platinum measure 1.68:1 and 1.36:1 against their
 *   own card backgrounds, and the fill alone would leave no discernible boundary.
 *   Every string in a card renders in `cardText` on `cardBg`, the pairing
 *   measured at 8.01-11.58:1.
 * - **Selection is never signalled by color alone.** The active card states
 *   "Selected" in text and carries `accessibilityState.selected`, so the palette
 *   is decoration on top of a state that is already readable and announced.
 *
 * The section owns no fetch of its own: `AppThemeProvider` holds the one read and
 * this calls `refresh()` on entry, so opening settings costs one round trip and
 * the applied palette is the same fact here as everywhere else in the app.
 */
function PremiumThemeSection() {
  const { t } = useTranslation()
  const {
    themeKey,
    palette,
    isEntitled,
    themesEnabled,
    status,
    refresh,
    applyResolvedTheme,
    applyFailure,
  } = useAppTheme()
  const palettes = usePaletteNameList()

  /** The `id` of the card whose save is in flight, or null when idle. */
  const [savingId, setSavingId] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  /**
   * The in-flight save, so leaving the screen cancels it. Without this a save
   * started here would run to completion and re-color the app from a section
   * that no longer exists.
   */
  const saveControllerRef = useRef<AbortController | null>(null)

  useEffect(() => {
    // Entering settings re-reads the preference. The provider's own read happens
    // once at app launch, and entitlement or the kill switch can have changed in
    // the hours since. `refresh` is a stable callback, so this runs on entry
    // rather than on every render.
    void refresh()
    return () => saveControllerRef.current?.abort()
  }, [refresh])

  const showGallery = status === 'ready' && isEntitled
  const showLocked = status === 'signed-out' || (status === 'ready' && !isEntitled)
  const isSelectable = showGallery && themesEnabled
  const showUnavailableNote = showGallery && !themesEnabled
  const errorMessage =
    saveError ?? (status === 'failed' ? t('commerce.premium.theme.loadError') : null)

  const handleSelect = async (option: ThemeOption) => {
    // Re-pressing the active card would issue a full PUT and emit a second
    // `premium_theme_selected` for one real choice, inflating exactly the
    // adoption count Decision 14 exists to measure. The server answers 200 for
    // an unchanged value by design, so the client is the only place this can be
    // suppressed.
    if (savingId !== null || option.key === themeKey) {
      return
    }

    const controller = new AbortController()
    saveControllerRef.current = controller
    setSavingId(option.id)
    setSaveError(null)

    try {
      const saved = await setThemeFromMobile(option.key, controller.signal)
      if (!controller.signal.aborted) {
        applyResolvedTheme(saved)
      }
    } catch (error: unknown) {
      if (!controller.signal.aborted) {
        // The rejection re-resolves the section rather than only printing a line:
        // a 403 means entitlement lapsed and a 503 means the kill switch flipped,
        // and both are states this section already renders. Only an unclassified
        // failure has a message, and it is the catalog's rather than the server's
        // untranslated English (AC 7).
        if (premiumThemeFailureReason(error) === 'unknown') {
          setSaveError(t('commerce.premium.theme.saveError'))
        }
        applyFailure(error)
      }
    } finally {
      if (saveControllerRef.current === controller) {
        saveControllerRef.current = null
      }
      if (!controller.signal.aborted) {
        setSavingId(null)
      }
    }
  }

  return (
    <View style={styles.settingsSection} testID="premium-theme-section">
      <Text style={styles.sectionTitle} testID="premium-theme-title">
        {t('commerce.premium.theme.sectionTitle')}
      </Text>
      {/*
        AC 7: what a palette is, where the choice is stored, and what it does not
        change. A sibling text node in reading order before the gallery, never a
        tooltip and never only an accessible name.
      */}
      <Text style={styles.disclosureText} testID="premium-theme-disclosure">
        {t('commerce.premium.theme.disclosure')}
      </Text>

      {/*
        The kill-switch note precedes the cards it explains and is what their
        `aria-describedby`/`accessibilityHint` point at, so a disabled card is
        never disabled without a stated reason.
      */}
      {showUnavailableNote ? (
        <Text
          style={styles.helpText}
          nativeID={THEME_UNAVAILABLE_HINT_ID}
          testID="premium-theme-unavailable"
        >
          {t('commerce.premium.theme.unavailable')}
        </Text>
      ) : null}

      {showGallery ? (
        <>
          <View style={styles.themeGallery} testID="premium-theme-gallery">
            {THEME_OPTIONS.map((option) => (
              <PaletteCard
                key={option.id}
                option={option}
                isSelected={themeKey === option.key}
                isSaving={savingId === option.id}
                isSelectable={isSelectable}
                onSelect={() => {
                  void handleSelect(option)
                }}
              />
            ))}
          </View>
          {/*
            After the cards, not before them: the reader picks a palette and then
            sees what it does. It reads the APPLIED palette from the context, which
            is what makes the choice visible at all — every card pins its own.
          */}
          <View
            style={[
              styles.themePreview,
              { backgroundColor: palette.cardBg, borderColor: palette.cardBorder },
            ]}
            testID="premium-theme-preview"
          >
            <View
              style={[styles.themePreviewAccent, { backgroundColor: palette.primary }]}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              testID="premium-theme-preview-accent"
            />
            <Text style={[styles.themePreviewTitle, { color: palette.cardText }]}>
              {t('commerce.premium.theme.preview.title')}
            </Text>
            <Text style={[styles.themePreviewBody, { color: palette.cardText }]}>
              {t('commerce.premium.theme.preview.body')}
            </Text>
          </View>
        </>
      ) : null}

      {/*
        The locked upsell for a signed-out or non-entitled reader: the same panel
        shape and copy the web section renders, pointing at the subscribe controls
        directly above rather than carrying a CTA of its own. The body splits by
        audience because "subscribe with the controls above" is true for a
        signed-in reader and false for a signed-out one, who has to sign in first.
      */}
      {showLocked ? (
        <View style={styles.themeLockedPanel} testID="premium-theme-locked">
          <Text style={styles.themeLockedTitle}>
            {t('commerce.premium.theme.locked.title')}
          </Text>
          <Text style={styles.helpText}>
            {t(
              status === 'signed-out'
                ? 'commerce.premium.theme.locked.signedOutBody'
                : 'commerce.premium.theme.locked.body',
              { palettes }
            )}
          </Text>
        </View>
      ) : null}

      {errorMessage ? (
        <Text
          style={styles.errorText}
          testID="premium-theme-error"
          accessibilityRole="alert"
          accessibilityLiveRegion="assertive"
        >
          {errorMessage}
        </Text>
      ) : null}
    </View>
  )
}

/**
 * One gallery card, painted in the palette it offers rather than the applied one.
 *
 * `accessibilityState` carries the real state and the `aria-*` pair rides
 * alongside it, because react-native-web does not project `accessibilityState`
 * onto the DOM — the same precedent the commerce toggle and the subscribe
 * controls above already follow.
 */
function PaletteCard({
  option,
  isSelected,
  isSaving,
  isSelectable,
  onSelect,
}: {
  option: ThemeOption
  isSelected: boolean
  isSaving: boolean
  isSelectable: boolean
  onSelect: () => void
}) {
  const { t } = useTranslation()
  const palette = resolveThemePalette(option.key)
  const name = t(option.labelKey)

  return (
    <Pressable
      style={[
        styles.themeCard,
        { backgroundColor: palette.cardBg, borderColor: palette.cardBorder },
        isSelected ? styles.themeCardSelected : null,
        isSelectable ? null : styles.themeCardDisabled,
      ]}
      disabled={!isSelectable}
      onPress={onSelect}
      testID={`premium-theme-option-${option.id}`}
      accessibilityRole="button"
      accessibilityLabel={name}
      accessibilityState={{
        selected: isSelected,
        disabled: !isSelectable,
        busy: isSaving,
      }}
      accessibilityHint={
        isSelectable ? undefined : t('commerce.premium.theme.unavailable')
      }
      aria-pressed={isSelected}
      aria-disabled={!isSelectable}
      aria-busy={isSaving}
      aria-describedby={isSelectable ? undefined : THEME_UNAVAILABLE_HINT_ID}
    >
      <View style={styles.themeCardHeader}>
        {/*
          The two swatches are the only place `primary` and `secondary` appear.
          Both are ringed in `cardText` because Autumn Umber's Wheat and Winter
          Metallic's Platinum measure 1.68:1 and 1.36:1 against their own card
          backgrounds: the fill alone would leave no discernible boundary. The ring
          sits at the same 8.01-11.58:1 as the card's text, clearing SC 1.4.11's
          3:1 non-text floor with room to spare.
        */}
        <View
          style={[
            styles.themeSwatch,
            { backgroundColor: palette.primary, borderColor: palette.cardText },
          ]}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          testID={`premium-theme-swatch-primary-${option.id}`}
        />
        <View
          style={[
            styles.themeSwatch,
            { backgroundColor: palette.secondary, borderColor: palette.cardText },
          ]}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          testID={`premium-theme-swatch-secondary-${option.id}`}
        />
        <Text style={[styles.themeCardName, { color: palette.cardText }]}>{name}</Text>
      </View>
      <Text
        style={[styles.themeCardState, { color: palette.cardText }]}
        testID={`premium-theme-state-${option.id}`}
      >
        {isSelected
          ? t('commerce.premium.theme.selected')
          : t('commerce.premium.theme.select')}
      </Text>
    </Pressable>
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
  premiumStatusLine: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 4,
  },
  premiumGraceBanner: {
    marginTop: 8,
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#B54708',
    backgroundColor: 'rgba(181, 71, 8, 0.08)',
    color: '#B54708',
    fontSize: 13,
    fontWeight: '600',
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
  themeGallery: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 4,
    backgroundColor: 'transparent',
  },
  themeCard: {
    // Decision 17's 44-by-44 floor, same as every other control on this screen.
    minHeight: 44,
    flexGrow: 1,
    flexBasis: '46%',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderRadius: 8,
  },
  themeCardSelected: {
    // Selection is stated in words inside the card too; this is the redundant
    // visual cue, never the only one.
    borderWidth: 2,
  },
  themeCardDisabled: {
    opacity: 0.7,
  },
  themeCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'transparent',
  },
  themeSwatch: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 1,
  },
  themeCardName: {
    fontSize: 14,
    fontWeight: '600',
  },
  themeCardState: {
    fontSize: 13,
    fontWeight: '500',
  },
  themePreview: {
    marginTop: 12,
    gap: 8,
    padding: 12,
    borderWidth: 1,
    borderRadius: 8,
  },
  themePreviewAccent: {
    width: 64,
    height: 6,
    borderRadius: 3,
  },
  themePreviewTitle: {
    fontSize: 14,
    fontWeight: '600',
  },
  themePreviewBody: {
    fontSize: 13,
    lineHeight: 18,
  },
  themeLockedPanel: {
    marginTop: 12,
    gap: 4,
    padding: 12,
    borderWidth: 1,
    borderColor: '#e6e6ed',
    borderRadius: 8,
    backgroundColor: 'transparent',
  },
  themeLockedTitle: {
    fontSize: 14,
    fontWeight: '600',
  },
})
