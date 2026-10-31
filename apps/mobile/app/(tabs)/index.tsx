// Story 3.3 Task 4 step 1 owner: read deep link query parameters to hydrate active scenario in `apps/mobile/app/(tabs)/index.tsx`
// Story 5.1 Task 6 step 2 owner: strip commerce before device caching in `apps/mobile/app/(tabs)/index.tsx`
import {
  ScreenShareCardComposer,
  useShareCardPresentationOpener,
} from '@/components/android-share-card-presentation'
import { focusShareCardElement, shareCardHeadingNode } from '@/src/lib/share-card-focus'
import { traceShareCardOpener } from '@/src/lib/share-card-presentation-trace'
import {
  type ShareCardSource,
  ResponseError,
  type WeatherAlertDeepLinkTarget,
} from '@couture/api-client'
import {
  type ComponentRef,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { useTranslation } from 'react-i18next'
import {
  AccessibilityInfo,
  Pressable,
  StyleSheet,
  ScrollView,
  Platform,
  View as NativeView,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Text, View } from '@/components/themed'
import { useMobileAnalytics } from '@/src/analytics/mobile-analytics'
import { createMobileApiClient } from '@/src/lib/api-client'
import { onLocationsChanged } from '@/src/lib/locations'
import {
  mobileApplicationUserId,
  resolveMobileAccessToken,
  subscribeMobileApplicationUser,
} from '@/src/lib/mobile-auth'
import {
  forgetLatestRitual,
  readLatestRitualCache,
  ritualCacheOwner,
  saveRitualCache,
  withoutShopThisLook,
} from '@/src/lib/ritual-cache'
import {
  resolveAffiliateLocaleRegion,
  resolveRenderableShopThisLook,
} from '@/src/lib/commerce'
import { loadWidgetAlertPreferences } from '@/src/lib/widget-alert-preferences'
import { resolveWidgetScenario, type WidgetSlot } from '@/src/lib/widget-share'
import {
  defaultSupportedLocale,
  resolveSupportedLocale,
  ritualResponseSchema,
  type GarmentCategory,
  type RitualResponse,
  type AlertPreferences,
} from '@couture/api-client/contracts/http'
import {
  trackMobileAffiliateCtaShown,
  trackMobileRitualCreated,
} from '@/src/analytics/track-events'
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'

import { processMobileDeepLink } from '@/src/lib/mobile-deep-link-handler'
import { InfoBanner } from '@/components/info-banner'
import { WeatherHeader } from '@/components/hero/weather-header'
import { HourlyForecastRibbon } from '@/components/hero/hourly-forecast-ribbon'
import { ScenarioToggles } from '@/components/hero/scenario-toggles'
import { OutfitRecommendationCard } from '@/components/hero/outfit-recommendation-card'
import { WeatherAlertBanner } from '@/components/hero/weather-alert-banner'
import {
  SWAP_CATALOGUE,
  garmentTitle,
  parseGarmentId,
} from '@/components/hero/garment-item-tile'
import { EdgeToEdgeModal, useModalInsets } from '@/components/edge-to-edge-modal'
import { useHeroPalette } from '@/components/hero/hero-theme'
import { MobileChipNavigation, type ChipCategory } from '@/components/chip-navigation'
import { useAccessibilityAnnouncer } from '@/src/hooks/use-accessibility-announcer'
import { useReducedMotion } from '@/src/hooks/use-reduced-motion'
import { safeFindNodeHandle } from '@/src/lib/accessibility-focus'
import { HomeSpotlightTeaserSlot } from '@/components/home/home-spotlight-teaser'

type ScenarioType = 'morning' | 'midday' | 'evening'
type SwapFocusTarget = number | { focus?: () => void }

const CHIP_SCENARIOS: Record<ChipCategory, ScenarioType> = {
  Personal: 'morning',
  Community: 'midday',
  Sponsored: 'evening',
}

const SCENARIO_CHIPS: Record<ScenarioType, ChipCategory> = {
  morning: 'Personal',
  midday: 'Community',
  evening: 'Sponsored',
}

const ritualRequestTimeoutMs = 15_000
// The API's 400 message for a user with no saved location (RitualService).
const noLocationMessage = 'No location preferences found for user'

// `no-location` is a setup gap, so retrying cannot succeed; any other failure can.
type HeroLoadError = 'no-location' | 'generic'

async function classifyRitualError(error: unknown): Promise<HeroLoadError> {
  if (!(error instanceof ResponseError) || error.response.status !== 400) {
    return 'generic'
  }
  try {
    const body = (await error.response.json()) as { message?: unknown }
    return body.message === noLocationMessage ? 'no-location' : 'generic'
  } catch {
    return 'generic'
  }
}
const modalFocusRestorationDelayMs = 400

function focusAccessibilityTarget(
  target: ComponentRef<typeof Pressable> | null,
  testId: string
) {
  const browserTarget =
    typeof document === 'undefined'
      ? null
      : document.querySelector<HTMLElement>(`[data-testid="${testId}"]`)
  if (browserTarget) {
    browserTarget.focus()
    return
  }

  const focusableTarget = target as unknown as { focus?: () => void } | null
  if (focusableTarget?.focus) {
    focusableTarget.focus()
    return
  }

  const node = safeFindNodeHandle(target)
  if (node) {
    AccessibilityInfo.setAccessibilityFocus(node)
  }
}

function restoreAccessibilityFocus(target: SwapFocusTarget | null) {
  if (typeof target === 'object') {
    requestAnimationFrame(() => target?.focus?.())
  } else if (typeof target === 'number') {
    requestAnimationFrame(() => AccessibilityInfo.setAccessibilityFocus(target))
  }
}

function InvalidDeepLinkBanner({
  visible,
  message,
  onDismiss,
}: {
  visible: boolean
  message: string
  onDismiss: () => void
}) {
  if (!visible) {
    return null
  }

  return <InfoBanner message={message} onDismiss={onDismiss} />
}

/**
 * The options offered in the garment swap modal, worn garment first.
 *
 * `SWAP_CATALOGUE` is a fixed catalogue, so a worn garment outside it --
 * every `default-*` placeholder a user with an empty wardrobe sees, which is
 * every new account -- was absent from its own swap modal. The modal declares
 * `accessibilityRole="radiogroup"` and marks the worn option
 * `accessibilityState.selected`, so in that state it rendered a radiogroup with
 * no selected radio at all: a screen-reader user was offered five alternatives
 * with nothing indicating which one they are wearing now, and no way to return
 * to it once they moved off.
 *
 * Leading with it also puts `firstSwapOptionRef` -- the element focused when the
 * modal opens -- on the current selection, which is where focus belongs in a
 * radiogroup.
 *
 * Extracted from the screen component rather than inlined: these branches are a
 * pure function of the garment id, and carrying them inside `TabOneScreen` put
 * that component over the repository's cyclomatic complexity limit.
 */
function resolveGarmentSwap(
  swappingGarmentId: string | null,
  knownCategory?: GarmentCategory | null
): {
  category: string
  options: string[]
} {
  const category = swappingGarmentId
    ? parseGarmentId(swappingGarmentId, knownCategory).category
    : 'Garment'
  const baseSwapOptions = SWAP_CATALOGUE[category] || SWAP_CATALOGUE.Garment || []

  return {
    category,
    options:
      swappingGarmentId && !baseSwapOptions.includes(swappingGarmentId)
        ? [swappingGarmentId, ...baseSwapOptions]
        : baseSwapOptions,
  }
}

function shareComposerIsOpen(open: boolean, owner: string | null, member: string | null) {
  return open && owner === member
}

export default function TabOneScreen() {
  const openAndroidShareCard = useShareCardPresentationOpener()
  const shareCardInvoker = useRef<{
    node: (() => number | null) | null
    member: string | null
  }>({
    node: null,
    member: null,
  })
  const shareVisitFocused = useRef(false)
  const [shareCardSource, setShareCardSource] = useState<ShareCardSource | null>(null)
  const [shareCardOpen, setShareCardOpen] = useState(false)
  useFocusEffect(
    useCallback(() => {
      shareVisitFocused.current = true
      return () => {
        shareVisitFocused.current = false
        traceShareCardOpener('reset-blur')
        setShareCardSource(null)
        setShareCardOpen(false)
      }
    }, [])
  )
  const analytics = useMobileAnalytics()
  const router = useRouter()
  const { i18n, t } = useTranslation()
  const params = useLocalSearchParams()
  const { source, size, slot, type, alertId, cardId, expiresAt } = params
  const analyticsUserId = analytics.getDistinctId() || 'mobile-anonymous-user'
  // After a cold start the first load can run before the stored session is restored and
  // fail without a bearer. The restored identity re-runs it.
  const applicationUserId = useSyncExternalStore(
    subscribeMobileApplicationUser,
    mobileApplicationUserId,
    mobileApplicationUserId
  )
  useEffect(() => {
    traceShareCardOpener('reset-identity')
    setShareCardSource(null)
    setShareCardOpen(false)
  }, [applicationUserId])
  const cacheOwner = ritualCacheOwner(applicationUserId)
  const activeLocale =
    resolveSupportedLocale(i18n.resolvedLanguage ?? i18n.language) ??
    defaultSupportedLocale
  const palette = useHeroPalette()
  const modalInsets = useModalInsets()
  const { announce } = useAccessibilityAnnouncer()
  const reduceMotion = useReducedMotion()
  const latestLoadId = useRef(0)
  const hasTrackedTabView = useRef(false)
  // Keyed on recommendation id, not on mount: the impression effect re-runs
  // whenever the locale or the analytics identity changes, and a scenario
  // toggle away and back re-renders the same card. One card is one impression.
  const trackedCtaImpressions = useRef(new Set<string>())
  const scrollViewRef = useRef<ScrollView>(null)
  const focusedAlertRef = useRef<NativeView>(null)
  const focusedAlertY = useRef(0)
  const firstSwapOptionRef = useRef<ComponentRef<typeof Pressable>>(null)
  const swapTriggerRef = useRef<SwapFocusTarget | null>(null)
  const garmentRefs = useRef(new Map<string, ComponentRef<typeof Pressable> | null>())

  const [ritual, setRitual] = useState<RitualResponse | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<HeroLoadError | null>(null)
  const [activeScenario, setActiveScenario] = useState<ScenarioType>('morning')
  const [activeChipCategory, setActiveChipCategory] = useState<ChipCategory>('Personal')
  const [pendingWidgetSlot, setPendingWidgetSlot] = useState<WidgetSlot | null>(null)
  const [isStale, setIsStale] = useState(false)
  // Distinct from `isStale`, which only covers the offline fallback. This also
  // covers the under-15-minute cache hit, which is a perfectly fresh read for
  // weather and still an unacceptable source for an affiliate CTA.
  const [isCacheServed, setIsCacheServed] = useState(false)
  const [alertPreferences, setAlertPreferences] = useState<AlertPreferences | undefined>(
    undefined
  )
  const [isInvalidDeepLink, setIsInvalidDeepLink] = useState(false)
  const invalidDeepLinkMessage = t('common.invalid_link')
  const [focusedWeatherAlert, setFocusedWeatherAlert] =
    useState<WeatherAlertDeepLinkTarget | null>(null)

  // Garment swap modal states
  const [isSwapModalVisible, setIsSwapModalVisible] = useState(false)
  const [swappingGarmentId, setSwappingGarmentId] = useState<string | null>(null)
  const [garmentFocusTarget, setGarmentFocusTarget] = useState<string | null>(null)

  const fetchRitual = async () => {
    const client = createMobileApiClient({
      accessToken: async () => (await resolveMobileAccessToken()) || '',
    })
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), ritualRequestTimeoutMs)

    try {
      // Omitting locationId deliberately selects the user's primary saved location.
      const [response, alertPreferences] = await Promise.all([
        client.apiV1RitualGet({ locale: activeLocale }, { signal: controller.signal }),
        loadWidgetAlertPreferences(client, controller.signal),
      ])
      return {
        data: ritualResponseSchema.parse(response),
        alertPreferences,
      }
    } finally {
      clearTimeout(timeout)
    }
  }

  const loadData = async (forceRefresh = false, allowCacheFallback = true) => {
    const loadId = ++latestLoadId.current
    setIsLoading(true)
    setError(null)
    setIsStale(false)

    const cached = allowCacheFallback
      ? await readLatestRitualCache(cacheOwner, activeLocale)
      : null
    const now = Date.now()

    if (!forceRefresh && cached && now - cached.timestamp < 15 * 60 * 1000) {
      if (loadId === latestLoadId.current) {
        setRitual(cached.data)
        setAlertPreferences(cached.alertPreferences)
        setIsCacheServed(true)
        setIsLoading(false)
      }
      return
    }

    try {
      const { data, alertPreferences: fetchedPreferences } = await fetchRitual()
      if (loadId !== latestLoadId.current) {
        return
      }

      setRitual(data)
      setAlertPreferences(fetchedPreferences)
      setIsCacheServed(false)
      void saveRitualCache(cacheOwner, activeLocale, {
        // Decision 6: the commerce block never enters the device cache, or the
        // CTA outlives an opt-out by fifteen minutes online and indefinitely
        // offline.
        data: withoutShopThisLook(data),
        timestamp: now,
        alertPreferences: fetchedPreferences,
      }).catch(() => undefined)

      trackMobileRitualCreated(analytics, {
        userId: analyticsUserId,
        locationId: data.data.weather.locationKey,
        ritualType: 'daily_outfit',
        weatherContext: data.data.weather.current.condition,
      })
      if (forceRefresh) {
        announce(
          'refresh',
          t(`hero.conditions.${data.data.weather.current.condition}`, {
            defaultValue: data.data.weather.current.condition,
          })
        )
      }
    } catch (loadError) {
      const errorKind = await classifyRitualError(loadError)
      if (loadId !== latestLoadId.current) {
        return
      }

      // Offline fallback: try using cached data if available, even if stale
      if (cached) {
        setRitual(cached.data)
        setAlertPreferences(cached.alertPreferences)
        setIsStale(true)
        setIsCacheServed(true)
      } else {
        setError(errorKind)
      }
    } finally {
      if (loadId === latestLoadId.current) {
        setIsLoading(false)
      }
    }
  }

  // Story 1.2b: a saved, switched or deleted location changes the ritual. The
  // previous primary's ritual leaves the screen and the device cache at once, and
  // the refetch never falls back to it: a no-location or weather-unavailable
  // answer shows as itself.
  const reloadForLocationChange = async () => {
    latestLoadId.current += 1
    setIsLoading(true)
    setRitual(null)
    setIsCacheServed(false)
    setIsStale(false)
    await forgetLatestRitual(cacheOwner)
    await loadData(true, false)
  }
  const reloadForLocationChangeRef = useRef(reloadForLocationChange)
  reloadForLocationChangeRef.current = reloadForLocationChange
  useEffect(
    () =>
      onLocationsChanged(() => {
        void reloadForLocationChangeRef.current()
      }),
    []
  )

  useEffect(() => {
    // Track when user views Tab One - top of the engagement funnel
    if (!hasTrackedTabView.current) {
      hasTrackedTabView.current = true
      analytics.capture('tab_one_viewed')
    }
    void loadData()
  }, [activeLocale, analyticsUserId, applicationUserId])

  useEffect(() => {
    const rawParams = { source, size, slot, type, alertId, cardId, expiresAt }
    if (
      ![source, size, slot, type, alertId, cardId, expiresAt].some(
        (value) => value !== undefined
      )
    ) {
      return
    }

    let active = true
    let routed = false
    void processMobileDeepLink({
      params: rawParams,
      locale: activeLocale,
      analytics: {
        capture: (event, properties) => {
          if (active) {
            analytics.capture(event, properties)
          }
        },
        screen: (...args) => analytics.screen(...args),
        getDistinctId: () => analytics.getDistinctId(),
      },
      setWidgetScenario: (scenario) => {
        if (!active) {
          return
        }
        setPendingWidgetSlot(null)
        setActiveScenario(scenario)
        setActiveChipCategory(SCENARIO_CHIPS[scenario])
      },
      setForecastSlot: (forecastSlot) => {
        if (active) {
          setPendingWidgetSlot(forecastSlot)
        }
      },
      setFocusedWeatherAlert: (alert) => {
        if (active) {
          setFocusedWeatherAlert(alert)
        }
      },
      setIsInvalidDeepLink: (invalid) => {
        if (active) {
          setIsInvalidDeepLink(invalid)
        }
      },
      pushToCommunity: (communityParams) => {
        if (!active) {
          return
        }
        routed = true
        router.push({ pathname: '/community', params: communityParams })
      },
    }).finally(() => {
      if (active && !routed) {
        router.setParams({
          source: undefined,
          size: undefined,
          slot: undefined,
          type: undefined,
          alertId: undefined,
          cardId: undefined,
          expiresAt: undefined,
        })
      }
    })

    return () => {
      active = false
    }
  }, [
    source,
    size,
    slot,
    type,
    alertId,
    cardId,
    expiresAt,
    activeLocale,
    analytics,
    router,
  ])

  useEffect(() => {
    if (!focusedWeatherAlert) {
      return
    }
    requestAnimationFrame(() => {
      const focusAlert = () => {
        if (Platform.OS === 'web') {
          const webNode = focusedAlertRef.current as unknown as { focus?: () => void }
          webNode?.focus?.()
          return
        }
        const node = safeFindNodeHandle(focusedAlertRef.current)
        if (node) {
          AccessibilityInfo.setAccessibilityFocus(node)
        }
      }
      const scrollToAlert = (y: number) => {
        scrollViewRef.current?.scrollTo({
          y: Math.max(0, y - 16),
          animated: !reduceMotion,
        })
        focusAlert()
      }

      if (Platform.OS === 'web') {
        scrollToAlert(focusedAlertY.current)
        return
      }

      const focusedAlert = focusedAlertRef.current
      const contentNode = scrollViewRef.current?.getInnerViewNode() as
        | number
        | NativeView
        | null
        | undefined
      if (!focusedAlert || contentNode === undefined || contentNode === null) {
        scrollToAlert(focusedAlertY.current)
        return
      }

      focusedAlert.measureLayout(
        contentNode,
        (_x, y) => {
          focusedAlertY.current = y
          scrollToAlert(y)
        },
        () => scrollToAlert(focusedAlertY.current)
      )
    })
  }, [focusedWeatherAlert, reduceMotion])

  useEffect(() => {
    if (!ritual || !pendingWidgetSlot) {
      return
    }

    const scenario = resolveWidgetScenario(ritual, pendingWidgetSlot)
    setActiveScenario(scenario)
    setActiveChipCategory(SCENARIO_CHIPS[scenario])
    setPendingWidgetSlot(null)
  }, [ritual, pendingWidgetSlot])

  const handleScenarioChange = (scenario: ScenarioType) => {
    setActiveScenario(scenario)
    setActiveChipCategory(SCENARIO_CHIPS[scenario])
    analytics.capture('hero_interaction', {
      interactionType: 'scenario_toggle',
      scenario,
    })
  }

  const handleRibbonToggle = (isExpanded: boolean) => {
    analytics.capture('hero_interaction', {
      interactionType: 'ribbon_toggle',
      isExpanded,
    })
  }

  const handleSwapGarment = (garmentId: string, trigger?: SwapFocusTarget) => {
    swapTriggerRef.current = trigger ?? null
    setSwappingGarmentId(garmentId)
    setIsSwapModalVisible(true)
  }

  const restoreSwapTriggerFocus = () => {
    const trigger = swapTriggerRef.current
    swapTriggerRef.current = null
    restoreAccessibilityFocus(trigger)
  }

  const closeSwapModal = () => {
    setIsSwapModalVisible(false)
    setSwappingGarmentId(null)
    restoreSwapTriggerFocus()
  }

  useEffect(() => {
    if (!garmentFocusTarget || isSwapModalVisible) {
      return
    }

    const focusTimer = setTimeout(
      () => {
        focusAccessibilityTarget(
          garmentRefs.current.get(garmentFocusTarget) ?? null,
          `garment-tile-${garmentFocusTarget}`
        )
        setGarmentFocusTarget(null)
      },
      reduceMotion ? 0 : modalFocusRestorationDelayMs
    )

    return () => clearTimeout(focusTimer)
  }, [garmentFocusTarget, isSwapModalVisible, reduceMotion, ritual])

  const focusFirstSwapOption = () => {
    requestAnimationFrame(() => {
      if (Platform.OS === 'web') {
        const webNode = firstSwapOptionRef.current as unknown as { focus?: () => void }
        webNode?.focus?.()
        return
      }
      const node = safeFindNodeHandle(firstSwapOptionRef.current)
      if (node) {
        AccessibilityInfo.setAccessibilityFocus(node)
      }
    })
  }

  const performSwap = (newGarmentId: string) => {
    if (!ritual || !swappingGarmentId) return

    // Update state local model copy
    const nextOutfits = ritual.data.outfits.map((outfit) => {
      if (outfit.scenario === activeScenario) {
        return {
          ...outfit,
          garmentIds: outfit.garmentIds.map((id) =>
            id === swappingGarmentId ? newGarmentId : id
          ),
        }
      }
      return outfit
    })

    const updatedRitual = {
      ...ritual,
      data: {
        ...ritual.data,
        outfits: nextOutfits,
      },
    }

    setRitual(updatedRitual)

    void saveRitualCache(cacheOwner, activeLocale, {
      // A swap rewrites a network payload, so this write can carry a commerce
      // block too. Decision 6 applies to every cache write, not just the fetch.
      data: withoutShopThisLook(updatedRitual),
      timestamp: Date.now(),
      alertPreferences,
    }).catch(() => undefined)

    analytics.capture('hero_interaction', {
      interactionType: 'garment_swap',
      scenario: activeScenario,
      itemId: newGarmentId,
    })
    const swappedInCategory = ritual.data.outfits
      .find((outfit) => outfit.scenario === activeScenario)
      ?.displayGarments?.find((garment) => garment.id === newGarmentId)?.category
    announce(
      'swap',
      garmentTitle(parseGarmentId(newGarmentId, swappedInCategory), t, activeLocale)
    )
    setIsSwapModalVisible(false)
    setSwappingGarmentId(null)
    swapTriggerRef.current = null
    setGarmentFocusTarget(newGarmentId)
  }

  const activeOutfit = ritual?.data.outfits.find((o) => o.scenario === activeScenario)
  const activeShopThisLook = resolveRenderableShopThisLook(activeOutfit, isCacheServed)

  useEffect(() => {
    if (!activeOutfit || !activeShopThisLook) {
      return
    }
    if (trackedCtaImpressions.current.has(activeOutfit.id)) {
      return
    }

    trackedCtaImpressions.current.add(activeOutfit.id)
    trackMobileAffiliateCtaShown(analytics, analyticsUserId, {
      partnerId: activeShopThisLook.partnerId,
      scenario: activeOutfit.scenario,
      surface: 'mobile_hero',
      localeRegion: resolveAffiliateLocaleRegion(activeLocale),
      recommendationId: activeOutfit.id,
    })
  }, [activeOutfit, activeShopThisLook, activeLocale, analyticsUserId, analytics])

  const handleRetry = () => {
    void loadData(true)
  }

  const handleChipCategoryChange = (category: ChipCategory) => {
    setActiveChipCategory(category)
    setActiveScenario(CHIP_SCENARIOS[category])
  }

  const { category: swapCategory, options: swapOptions } = resolveGarmentSwap(
    swappingGarmentId,
    activeOutfit?.displayGarments?.find((garment) => garment.id === swappingGarmentId)
      ?.category
  )

  return (
    // Side insets only: the native header and the tab bar already cover top and bottom,
    // and a second top inset left an empty band above the chips.
    <SafeAreaView
      style={[styles.safeContainer, { backgroundColor: palette.background }]}
      edges={['left', 'right']}
    >
      <ScrollView
        ref={scrollViewRef}
        style={[styles.container, { backgroundColor: palette.background }]}
        contentContainerStyle={styles.contentContainer}
        stickyHeaderIndices={[0]}
        testID="hero-experience-scrollview"
        // Focusable from code on web without becoming a tab stop, so focus can
        // land here when the teaser leaves.
        {...(Platform.OS === 'web' ? { tabIndex: -1 as const } : {})}
      >
        <MobileChipNavigation
          activeCategory={activeChipCategory}
          onCategoryChange={handleChipCategoryChange}
        />

        <InvalidDeepLinkBanner
          visible={isInvalidDeepLink}
          message={invalidDeepLinkMessage}
          onDismiss={() => setIsInvalidDeepLink(false)}
        />

        {focusedWeatherAlert && (
          <NativeView
            ref={focusedAlertRef}
            onLayout={(event) => {
              focusedAlertY.current = event.nativeEvent.layout.y
            }}
            testID="severe-weather-alert-focused"
            accessibilityLiveRegion="assertive"
            accessibilityRole="alert"
            focusable
            style={styles.focusedAlertCard}
          >
            <Text style={styles.focusedAlertBadge}>
              ⚠️ {focusedWeatherAlert.event.data.severity} weather alert
              {` (#${focusedWeatherAlert.id})`}
            </Text>
            <Text style={styles.focusedAlertTitle}>
              {focusedWeatherAlert.event.data.location}
            </Text>
            <Text style={styles.focusedAlertText}>
              {focusedWeatherAlert.event.data.message}
            </Text>
          </NativeView>
        )}

        {/* Stale Cache Banner */}
        {isStale && (
          <View style={styles.staleBanner} testID="stale-cache-banner">
            <Text style={styles.staleText}>
              {t('hero.offline_toast', {
                defaultValue: 'Using recently cached weather data',
              })}
            </Text>
          </View>
        )}

        {error === 'no-location' && !ritual ? (
          <View
            style={[
              styles.errorState,
              { backgroundColor: palette.surface, borderColor: palette.divider },
            ]}
            testID="hero-no-location-state"
          >
            <Text style={[styles.errorText, { color: palette.text }]}>
              {t('hero.no_location')}
            </Text>
            <Pressable
              style={[styles.retryButton, { backgroundColor: palette.text }]}
              onPress={() => router.push('/locations?guided=1')}
              accessibilityRole="button"
              testID="hero-add-location"
            >
              <Text style={[styles.retryText, { color: palette.background }]}>
                {t('locations.guided.add')}
              </Text>
            </Pressable>
          </View>
        ) : error && !ritual ? (
          <View
            style={[
              styles.errorState,
              { backgroundColor: palette.surface, borderColor: palette.divider },
            ]}
            testID="hero-error-state"
          >
            <View style={[styles.errorMark, { borderColor: palette.divider }]}>
              <Text style={[styles.errorMarkText, { color: palette.text }]}>!</Text>
            </View>
            <Text style={[styles.errorText, { color: palette.text }]}>
              {t('hero.load_error', {
                defaultValue: 'Unable to load daily recommendations',
              })}
            </Text>
            <Pressable
              style={[styles.retryButton, { backgroundColor: palette.text }]}
              onPress={handleRetry}
              accessibilityRole="button"
            >
              <Text style={[styles.retryText, { color: palette.background }]}>
                {t('hero.retry', { defaultValue: 'Retry' })}
              </Text>
            </Pressable>
          </View>
        ) : (
          <>
            {/* Weather Alert Banner */}
            {ritual?.data.weather.alerts && (
              <WeatherAlertBanner alerts={ritual.data.weather.alerts} />
            )}

            {/* Weather Header */}
            <WeatherHeader current={ritual?.data.weather.current} isLoading={isLoading} />

            {/* Hourly Forecast Ribbon */}
            <HourlyForecastRibbon
              hourly={ritual?.data.weather.hourly}
              isLoading={isLoading}
              onToggleExpand={handleRibbonToggle}
            />

            {/* Scenario Quick Toggles */}
            {!isLoading && ritual && (
              <ScenarioToggles
                activeScenario={activeScenario}
                onScenarioChange={handleScenarioChange}
              />
            )}

            {/* Primary Outfit Card */}
            <OutfitRecommendationCard
              outfit={activeOutfit}
              onExport={(recommendationId, opener) => {
                if (
                  openAndroidShareCard(
                    { kind: 'outfit', recommendationId },
                    'outfit',
                    opener
                  )
                )
                  return
                shareCardInvoker.current = {
                  node: opener,
                  member: mobileApplicationUserId(),
                }
                setShareCardSource({ kind: 'outfit', recommendationId })
                setShareCardOpen(true)
                traceShareCardOpener('state-open')
              }}
              onSwapGarment={handleSwapGarment}
              onGarmentRef={(garmentId, element) => {
                garmentRefs.current.set(garmentId, element)
              }}
              isLoading={isLoading}
              isCacheServed={isCacheServed}
            />
          </>
        )}

        {/*
          Story 6.7: after the whole hero conditional, so it follows in focus
          order. It reads on its own and never waits on, hides or re-renders the hero.
        */}
        <HomeSpotlightTeaserSlot
          applicationUserId={applicationUserId}
          scrollViewRef={scrollViewRef}
        />
      </ScrollView>

      {/* Garment Swap Modal */}
      <EdgeToEdgeModal
        visible={isSwapModalVisible}
        animationType={reduceMotion ? 'none' : 'slide'}
        onShow={focusFirstSwapOption}
        onRequestClose={closeSwapModal}
        scrim="rgba(0,0,0,0.5)"
      >
        <View style={styles.modalOverlay}>
          {(() => {
            const categoryKey = `accessibility.garment_category_${swapCategory.toLowerCase().replace(/[^a-z0-9]/g, '_')}`
            const localizedCategory = t(categoryKey, { defaultValue: swapCategory })
            return (
              <View
                style={[styles.modalContent, { paddingBottom: 20 + modalInsets.bottom }]}
                testID="garment-swap-modal"
                accessibilityViewIsModal
                role="dialog"
                accessibilityLabel={t('hero.garment_swap_title', {
                  category: localizedCategory,
                })}
                aria-modal
                aria-labelledby="garment-swap-title"
              >
                <Text
                  nativeID="garment-swap-title"
                  style={styles.modalTitle}
                  accessibilityRole="header"
                >
                  {t('hero.garment_swap_title', {
                    category: localizedCategory,
                    defaultValue: `Choose alternate ${swapCategory}`,
                  })}
                </Text>
                <ScrollView style={styles.modalScroll} accessibilityRole="radiogroup">
                  {swapOptions.map((option, index) => {
                    const isCurrent = option === swappingGarmentId
                    const optionTitle = garmentTitle(
                      parseGarmentId(
                        option,
                        activeOutfit?.displayGarments?.find(
                          (garment) => garment.id === option
                        )?.category
                      ),
                      t,
                      activeLocale
                    )
                    return (
                      <Pressable
                        ref={index === 0 ? firstSwapOptionRef : undefined}
                        key={option}
                        style={[styles.modalItem, isCurrent && styles.modalItemCurrent]}
                        onPress={() => performSwap(option)}
                        testID={`swap-option-${option}`}
                        accessibilityRole="radio"
                        accessibilityLabel={optionTitle}
                        accessibilityState={{ selected: isCurrent }}
                      >
                        <Text
                          style={[
                            styles.modalItemText,
                            isCurrent && styles.modalItemTextCurrent,
                          ]}
                        >
                          {optionTitle}
                        </Text>
                        {isCurrent && <Text style={styles.modalItemCheck}>✓</Text>}
                      </Pressable>
                    )
                  })}
                </ScrollView>
                <Pressable
                  style={styles.closeButton}
                  onPress={closeSwapModal}
                  accessibilityRole="button"
                  accessibilityLabel={t('common.cancel')}
                >
                  <Text style={styles.closeButtonText}>
                    {t('common.cancel', { defaultValue: 'Cancel' })}
                  </Text>
                </Pressable>
              </View>
            )
          })()}
        </View>
      </EdgeToEdgeModal>
      <ScreenShareCardComposer
        source={shareCardSource}
        open={shareComposerIsOpen(
          shareCardOpen,
          shareCardInvoker.current.member,
          applicationUserId
        )}
        onClose={() => setShareCardOpen(false)}
        onRestoreFocus={() => {
          if (
            !shareVisitFocused.current ||
            shareCardInvoker.current.member !== mobileApplicationUserId()
          )
            return
          const node = shareCardInvoker.current.node?.() ?? shareCardHeadingNode('outfit')
          focusShareCardElement(node)
        }}
      />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safeContainer: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  contentContainer: {
    paddingBottom: 24,
  },
  staleBanner: {
    backgroundColor: '#FFFBEB',
    borderBottomWidth: 1,
    borderBottomColor: '#FDE68A',
    paddingVertical: 8,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  staleText: {
    color: '#92400E',
    fontSize: 12,
    fontWeight: '600',
    fontFamily: Platform.select({
      ios: 'SF Pro Text',
      android: 'Roboto',
      web: 'Inter, -apple-system, sans-serif',
    }),
  },
  errorState: {
    minHeight: 320,
    marginHorizontal: 20,
    marginTop: 28,
    paddingHorizontal: 28,
    paddingVertical: 36,
    borderWidth: 1,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorMark: {
    width: 52,
    height: 52,
    borderWidth: 1,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  errorMarkText: {
    fontSize: 24,
    fontWeight: '700',
  },
  errorText: {
    fontSize: 17,
    fontWeight: '700',
    lineHeight: 24,
    textAlign: 'center',
  },
  retryButton: {
    minWidth: 120,
    minHeight: 44,
    justifyContent: 'center',
    borderRadius: 999,
    paddingVertical: 12,
    paddingHorizontal: 24,
    marginTop: 24,
    alignItems: 'center',
  },
  retryText: {
    fontSize: 14,
    fontWeight: '700',
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingTop: 20,
    paddingHorizontal: 16,
    maxHeight: '60%',
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111111',
    marginBottom: 16,
    textAlign: 'center',
    fontFamily: Platform.select({
      ios: 'Playfair Display Bold',
      android: 'Playfair Display Bold',
      web: 'Playfair Display, serif',
    }),
  },
  modalScroll: {
    marginBottom: 16,
  },
  modalItem: {
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#E6E6ED',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  modalItemCurrent: {
    backgroundColor: 'rgba(201, 161, 74, 0.05)',
  },
  modalItemText: {
    fontSize: 15,
    color: '#111111',
  },
  modalItemTextCurrent: {
    fontWeight: '700',
    color: '#8A691F',
  },
  modalItemCheck: {
    color: '#8A691F',
    fontWeight: '700',
  },
  closeButton: {
    backgroundColor: '#111111',
    borderRadius: 999, // Pill corner radius
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  focusedAlertCard: {
    marginHorizontal: 16,
    marginVertical: 8,
    padding: 16,
    borderRadius: 12,
    backgroundColor: '#361F1F',
    borderWidth: 2,
    borderColor: '#C9A14A',
  },
  focusedAlertBadge: {
    fontSize: 11,
    fontWeight: 'bold',
    color: '#FFFFFF',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 4,
  },
  focusedAlertTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#FFFFFF',
    marginBottom: 4,
  },
  focusedAlertText: {
    fontSize: 13,
    color: '#E6E6ED',
  },
})
