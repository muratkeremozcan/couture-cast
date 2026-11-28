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
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
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
  useWindowDimensions,
  View as NativeView,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Text, View } from '@/components/themed'
import { useMobileAnalytics } from '@/src/analytics/mobile-analytics'
import { createMobileApiClient } from '@/src/lib/api-client'
import { onLocationsChanged } from '@/src/lib/locations'
import { onWardrobeChanged } from '@/src/lib/wardrobe-changes'
import {
  mobileApplicationUserId,
  mobileIdentityEpoch,
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
import { loadWidgetAlertPreferences } from '@/src/lib/widget-alert-preferences'
import { resolveWidgetScenario, type WidgetSlot } from '@/src/lib/widget-share'
import {
  defaultSupportedLocale,
  resolveSupportedLocale,
  ritualResponseSchema,
  type RitualResponse,
} from '@couture/api-client/contracts/http'
import { trackMobileRitualCreated } from '@/src/analytics/track-events'
import { type Href, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'

import { processMobileDeepLink } from '@/src/lib/mobile-deep-link-handler'
import { InfoBanner } from '@/components/info-banner'
import { WeatherHeader } from '@/components/hero/weather-header'
import { HourlyForecastRibbon } from '@/components/hero/hourly-forecast-ribbon'
import { ScenarioToggles } from '@/components/hero/scenario-toggles'
import { TodayLiveOutfit } from '@/components/home/today-live-outfit'
import { WeatherAlertBanner } from '@/components/hero/weather-alert-banner'
import { useHeroPalette } from '@/components/hero/hero-theme'
import { TAB_BODY_INSET } from '@/src/theme/tokens'
import { useAccessibilityAnnouncer } from '@/src/hooks/use-accessibility-announcer'
import { useReducedMotion } from '@/src/hooks/use-reduced-motion'
import { ScreenGate } from '@/src/components/screen-gate'
import { safeFindNodeHandle } from '@/src/lib/accessibility-focus'
import { HomeCloset, useHomeWardrobe } from '@/components/home/home-closet'
import { HomeSpotlightTeaserSlot } from '@/components/home/home-spotlight-teaser'
import { LiveFontMountMarker } from '@/components/live-font-mount-marker'
import { useMemberSessionState } from '@/src/lib/member-session'
import { useMobileStyleProfile } from '@/src/lib/style-profile'
import {
  StyleDayControls,
  StyleMemberControls,
} from '@/src/features/preview/style-profile-controls'
import { useStatusBar } from '@/components/save-feedback'
import { SignedOutWelcome } from '@/src/features/preview/signed-out-welcome'
import {
  HomePlannerLink,
  MemberSampleOutfit,
} from '@/src/features/preview/member-sample-outfit'
import {
  getGuestPreviewStrings,
  shouldShowStyleSample,
  isSmallLookbookCloset,
  styleForecastSampleWeather,
  todayForecastPeriods,
  todayRitualAnchorDate,
} from '@couture/utils'
import { formatTemperature } from '@/src/lib/formatters'

type ScenarioType = 'morning' | 'midday' | 'evening'

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

/**
 * Story CC-7.7 D5: whether a ritual read brought back the answer already on screen. Both sides
 * are parsed JSON from the same endpoint, so their serialized forms compare field by field.
 */
function sameRitualAnswer(shown: unknown, fetched: unknown): boolean {
  return JSON.stringify(shown) === JSON.stringify(fetched)
}

function CachedWeatherNotice({ visible }: { visible: boolean }) {
  const { t } = useTranslation()
  const palette = useHeroPalette()
  if (!visible) return null
  return (
    <View
      style={[
        styles.staleBanner,
        { backgroundColor: palette.noticeSurface, borderBottomColor: palette.noticeLine },
      ]}
      testID="stale-cache-banner"
    >
      <Text style={[styles.staleText, { color: palette.noticeInk }]}>
        {t('hero.offline_toast', { defaultValue: 'Using recently cached weather data' })}
      </Text>
    </View>
  )
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

function shareComposerIsOpen(open: boolean, owner: string | null, member: string | null) {
  return open && owner === member
}

/** The supported locale Home renders and caches under. */
function activeHomeLocale(i18n: { resolvedLanguage?: string; language: string }) {
  return (
    resolveSupportedLocale(i18n.resolvedLanguage ?? i18n.language) ??
    defaultSupportedLocale
  )
}

/**
 * Story CC-7.7 D3: Home's gate reads are the ritual and its weather (one request). A signed-out
 * or unverifiable session has nothing to wait for.
 */
function homeGateReady(
  session: ReturnType<typeof useMemberSessionState>[0],
  settled: boolean
) {
  return session === 'signed-out' || session === 'unavailable' || settled
}

/** `readAt`: when the read that produced `data` began, which fixes the ritual's day. */
type OwnedRitual = { epoch: number; data: RitualResponse; readAt: number }

function hasDistinctForecastPeriods(
  weather: RitualResponse['data']['weather'],
  locale: ReturnType<typeof activeHomeLocale>,
  readAt: number,
  availableScenarios: readonly ScenarioType[]
): boolean {
  const periods = todayForecastPeriods(weather, readAt)
  if (!periods) return false
  return (
    new Set(
      availableScenarios.map((scenario) => {
        const entry = periods[scenario]
        return JSON.stringify([
          entry.condition,
          formatTemperature(entry.temperature, locale),
          Math.round(entry.precipitationProbability * 100),
        ])
      })
    ).size > 1
  )
}

/**
 * Story CC-7.7: which ritual a read answered. The server keys a ritual by the saved location and
 * its anchor day in that location's zone (before 08:00 local today's, from 08:00 the next
 * day's), taken when the read began. A member's garment swap belongs to one such ritual.
 */
function ritualIdentity(ritual: RitualResponse, readAt: number): string {
  const { locationKey, timezone } = ritual.data.weather
  return locationKey + '|' + todayRitualAnchorDate(timezone, readAt)
}

function FirstLookRegion({
  firstLook,
  minHeight,
  children,
}: {
  firstLook: boolean
  minHeight: number
  children: ReactNode
}) {
  return firstLook ? <NativeView style={{ minHeight }}>{children}</NativeView> : children
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
  const identityEpoch = useSyncExternalStore(
    subscribeMobileApplicationUser,
    mobileIdentityEpoch,
    mobileIdentityEpoch
  )
  const applicationUserId = mobileApplicationUserId()
  // Story 6.16 D1: the ritual is a member request. A signed-out launch shows the
  // welcome card and sends nothing; an unverifiable session keeps its retry state.
  const { height } = useWindowDimensions()
  const [viewportHeight, setViewportHeight] = useState(height)
  const [sessionState, retrySession] = useMemberSessionState()
  const styleProfile = useMobileStyleProfile()
  const homeWardrobe = useHomeWardrobe(applicationUserId, sessionState === 'member')
  // Story 6.17 D3: a Google identity that left the finish step returns to it. On focus only,
  // so a screen pushed above Home is never hijacked (6.16 stacked-screen rule).
  useFocusEffect(
    useCallback(() => {
      if (sessionState !== 'signed-out') return undefined
      let active = true
      // Imported lazily, as mobile-auth does, so Home's module graph keeps the SDK out.
      void import('../../src/lib/native-session.js')
        .then((session) => session.federatedFinishResumeHref())
        .then((href) => {
          if (active && href) router.push(href as Href)
        })
        .catch(() => undefined)
      return () => {
        active = false
      }
    }, [sessionState, router])
  )
  const cacheOwner = ritualCacheOwner(applicationUserId)
  const activeLocale = activeHomeLocale(i18n)
  const palette = useHeroPalette()
  const { announce } = useAccessibilityAnnouncer()
  const statusBar = useStatusBar()
  const reduceMotion = useReducedMotion()
  const latestLoadId = useRef(0)
  const deepLinkIdentity = useRef<{ key: string; epoch: number } | null>(null)
  const hasTrackedTabView = useRef(false)
  const scrollViewRef = useRef<ScrollView>(null)
  // The scroll content's host view. measureLayout takes a host component ref under the new
  // architecture; a node handle from getInnerViewNode() is rejected with a warning, and
  // neither callback runs.
  const scrollContentRef = useRef<NativeView>(null)
  const focusedAlertRef = useRef<NativeView>(null)
  const focusedAlertY = useRef(0)
  const [ownedRitual, setOwnedRitual] = useState<OwnedRitual | null>(null)
  const ritual = ownedRitual?.epoch === identityEpoch ? ownedRitual.data : null
  const ritualRef = useRef(ritual)
  ritualRef.current = ritual
  // Story CC-7.7: the member whose first ritual read settled (success, empty or error). Keyed
  // by member, so the next member's first render is unsettled before any effect runs.
  const [settledEpoch, setSettledEpoch] = useState<number>()
  const ritualSettled = settledEpoch === identityEpoch
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<HeroLoadError | null>(null)
  const [selectedScenario, setActiveScenario] = useState<ScenarioType>('morning')
  const [hourlyOpen, setHourlyOpen] = useState(false)
  const activeOutfit =
    ritual?.data.outfits.find(
      (outfit) => outfit.scenario === selectedScenario && outfit.garmentIds.length > 0
    ) ?? ritual?.data.outfits.find((outfit) => outfit.garmentIds.length > 0)
  const activeScenario = activeOutfit?.scenario ?? selectedScenario
  const [pendingWidgetSlot, setPendingWidgetSlot] = useState<WidgetSlot | null>(null)
  const [isStale, setIsStale] = useState(false)
  // Distinct from `isStale`, which only covers the offline fallback. This also
  // covers the under-15-minute cache hit, which is a perfectly fresh read for
  // weather and still an unacceptable source for an affiliate CTA.
  const [isCacheServed, setIsCacheServed] = useState(false)
  const [isInvalidDeepLink, setIsInvalidDeepLink] = useState(false)
  const invalidDeepLinkMessage = t('common.invalid_link')
  const [focusedWeatherAlert, setFocusedWeatherAlert] =
    useState<WeatherAlertDeepLinkTarget | null>(null)

  useEffect(() => {
    traceShareCardOpener('reset-identity')
    setShareCardSource(null)
    setShareCardOpen(false)
    setOwnedRitual(null)
    // Cleared when the member leaves, so the same member returning (A, signed out, A) is
    // unsettled until their new ritual read settles: no sample outfit before it.
    setSettledEpoch(undefined)
    setError(null)
    setIsCacheServed(false)
    setIsStale(false)
    setHourlyOpen(false)
    setActiveScenario('morning')
    setPendingWidgetSlot(null)
    setFocusedWeatherAlert(null)
    setIsInvalidDeepLink(false)
    // The next member's own first load starts from the initial loading state.
    setIsLoading(true)
  }, [identityEpoch])

  const fetchRitual = async () => {
    const token = await resolveMobileAccessToken()
    if (!token || identityEpoch !== mobileIdentityEpoch()) {
      throw new Error('Ritual session changed.')
    }
    const client = createMobileApiClient({
      accessToken: token,
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

  /** A ritual read the member asked for, or the first: counted, and announced on a Retry. */
  const reportFreshRitual = (data: RitualResponse, forceRefresh: boolean) => {
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
  }

  /** A refresh that failed over a shown outfit: reported with Retry in the root status bar. */
  const reportRefreshFailure = () => {
    statusBar.showNotice({
      id: 'home-ritual-refresh-failed',
      message: t('hero.load_error'),
      tone: 'error',
      actions: [
        {
          id: 'home-ritual-refresh-retry',
          kind: 'retry',
          label: t('hero.retry'),
          onPress: () => void latestLoadDataRef.current(true),
        },
      ],
    })
  }

  const loadData = async (
    forceRefresh = false,
    allowCacheFallback = true,
    // A tab-return refresh: no announcement, and no new ritual counted in analytics.
    background = false
  ) => {
    const loadId = ++latestLoadId.current
    const isCurrent = () =>
      loadId === latestLoadId.current && identityEpoch === mobileIdentityEpoch()
    // Story CC-7.7 D5: a refresh with the member's outfit on screen (a locale or analytics
    // identity change, a retry) refreshes in place. It never returns to the initial loading
    // state, and the banners stay as they are until the answer lands.
    const inPlace = ritualRef.current !== null
    if (!inPlace) {
      setIsLoading(true)
      setError(null)
      setIsStale(false)
    }
    const settle = () => setSettledEpoch(identityEpoch)

    const cached = allowCacheFallback
      ? await readLatestRitualCache(cacheOwner, activeLocale)
      : null
    if (!isCurrent()) return
    const now = Date.now()

    if (!forceRefresh && cached && now - cached.timestamp < 15 * 60 * 1000) {
      setOwnedRitual({
        epoch: identityEpoch,
        data: cached.data,
        readAt: cached.timestamp,
      })
      setIsCacheServed(true)
      setError(null)
      setIsStale(false)
      setIsLoading(false)
      settle()
      return
    }

    try {
      const { data, alertPreferences: fetchedPreferences } = await fetchRitual()
      if (!isCurrent()) return
      // A tab return re-reads in place; an unchanged answer for the same ritual keeps the state
      // it already has, so the outfit card and the rest of Home do not render again for the same
      // outfit. An identical payload across the 08:00 rollover is the next day's ritual: it takes
      // this read's time, or a swap made on it would be keyed to the previous day.
      setOwnedRitual((shown) =>
        shown?.epoch === identityEpoch &&
        sameRitualAnswer(shown.data, data) &&
        ritualIdentity(shown.data, shown.readAt) === ritualIdentity(data, now)
          ? shown
          : { epoch: identityEpoch, data, readAt: now }
      )
      setIsCacheServed(false)
      setError(null)
      setIsStale(false)
      void saveRitualCache(cacheOwner, activeLocale, {
        // Decision 6: the commerce block never enters the device cache, or the
        // CTA outlives an opt-out by fifteen minutes online and indefinitely
        // offline.
        data: withoutShopThisLook(data),
        timestamp: now,
        alertPreferences: fetchedPreferences,
      }).catch(() => undefined)

      if (!background) reportFreshRitual(data, forceRefresh)
    } catch (loadError) {
      const errorKind = await classifyRitualError(loadError)
      if (!isCurrent()) return

      // Story CC-7.7: a refresh that fails keeps the outfit already on screen, and inserts no
      // banner above it after the member started using the screen. The failure and its Retry
      // show in the root status bar, a floating slot that moves no content.
      if (inPlace && ritualRef.current !== null) {
        setIsCacheServed(true)
        reportRefreshFailure()
        return
      }
      // Offline fallback: try using cached data if available, even if stale
      if (cached) {
        setOwnedRitual({
          epoch: identityEpoch,
          data: cached.data,
          readAt: cached.timestamp,
        })
        setIsStale(true)
        setIsCacheServed(true)
      } else {
        setOwnedRitual(null)
        setIsCacheServed(false)
        setError(errorKind)
      }
    } finally {
      if (isCurrent()) {
        setIsLoading(false)
        settle()
      }
    }
  }

  // The status bar's Retry runs after later renders; it reads with the screen's current
  // member and locale.
  const latestLoadDataRef = useRef(loadData)
  latestLoadDataRef.current = loadData

  // Story 1.2b: a saved, switched or deleted location changes the ritual. The
  // previous primary's ritual leaves the screen and the device cache at once, and
  // the refetch never falls back to it: a no-location or weather-unavailable
  // answer shows as itself.
  const reloadForRitualChange = async () => {
    latestLoadId.current += 1
    setIsLoading(true)
    setOwnedRitual(null)
    // The previous ritual is gone, so the reload below is not a refresh in place.
    ritualRef.current = null
    setIsCacheServed(false)
    setIsStale(false)
    await forgetLatestRitual(cacheOwner)
    if (identityEpoch === mobileIdentityEpoch()) await loadData(true, false)
  }
  const reloadForRitualChangeRef = useRef(reloadForRitualChange)
  reloadForRitualChangeRef.current = reloadForRitualChange
  useEffect(() => {
    const reload = () => {
      void reloadForRitualChangeRef.current()
    }
    const unsubscribeLocations = onLocationsChanged(reload)
    const unsubscribeWardrobe = onWardrobeChanged(() => {
      void latestLoadDataRef.current(true, false, true)
    })
    return () => {
      unsubscribeLocations()
      unsubscribeWardrobe()
    }
  }, [])

  // Story CC-7.7 D5: tabs stay mounted, so returning to Home is a focus, never a mount. With
  // the member's outfit on screen the return refreshes it in place: the outfit and the scroll
  // stay, and the initial loading state never returns. The first focus is the mount, whose
  // read the effect below already started.
  const leftHomeRef = useRef(false)
  const refreshOnReturnRef = useRef<() => void>(() => undefined)
  refreshOnReturnRef.current = () => {
    // Past the 15-minute device cache: a cached answer would mark the outfit cache-served and
    // take its Shop this look away. In the background: unlike Retry, it announces nothing.
    if (sessionState === 'member' && ritualRef.current !== null)
      void loadData(true, true, true)
  }
  useFocusEffect(
    useCallback(() => {
      if (leftHomeRef.current) refreshOnReturnRef.current()
      leftHomeRef.current = false
      return () => {
        leftHomeRef.current = true
      }
    }, [])
  )

  useEffect(() => {
    // Track when user views Tab One - top of the engagement funnel
    if (!hasTrackedTabView.current) {
      hasTrackedTabView.current = true
      analytics.capture('tab_one_viewed')
    }
    if (sessionState !== 'member') return
    void loadData()
    return () => {
      latestLoadId.current += 1
    }
  }, [activeLocale, analyticsUserId, identityEpoch, sessionState])

  useEffect(() => {
    if (sessionState === 'restoring') return
    const rawParams = { source, size, slot, type, alertId, cardId, expiresAt }
    if (
      ![source, size, slot, type, alertId, cardId, expiresAt].some(
        (value) => value !== undefined
      )
    ) {
      deepLinkIdentity.current = null
      return
    }

    const key = JSON.stringify(rawParams)
    const epoch = mobileIdentityEpoch()
    if (deepLinkIdentity.current?.key === key && deepLinkIdentity.current.epoch !== epoch)
      return
    deepLinkIdentity.current = { key, epoch }

    let active = true
    const isCurrent = () => active && mobileIdentityEpoch() === epoch
    let routed = false
    void processMobileDeepLink({
      params: rawParams,
      locale: activeLocale,
      analytics: {
        capture: (event, properties) => {
          if (isCurrent()) {
            analytics.capture(event, properties)
          }
        },
        screen: (...args) => analytics.screen(...args),
        getDistinctId: () => analytics.getDistinctId(),
      },
      setWidgetScenario: (scenario) => {
        if (!isCurrent()) {
          return
        }
        setPendingWidgetSlot(null)
        setActiveScenario(scenario)
      },
      setForecastSlot: (forecastSlot) => {
        if (isCurrent()) {
          setPendingWidgetSlot(forecastSlot)
        }
      },
      setFocusedWeatherAlert: (alert) => {
        if (isCurrent()) {
          setFocusedWeatherAlert(alert)
        }
      },
      setIsInvalidDeepLink: (invalid) => {
        if (isCurrent()) {
          setIsInvalidDeepLink(invalid)
        }
      },
      pushToCommunity: (communityParams) => {
        if (!isCurrent()) {
          return
        }
        routed = true
        router.push({ pathname: '/community', params: communityParams })
      },
    }).finally(() => {
      if (isCurrent() && !routed) {
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
    applicationUserId,
    sessionState,
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
      const content = scrollContentRef.current
      if (!focusedAlert || !content) {
        scrollToAlert(focusedAlertY.current)
        return
      }

      focusedAlert.measureLayout(
        content,
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
    setPendingWidgetSlot(null)
  }, [ritual, pendingWidgetSlot])

  const handleScenarioChange = (scenario: ScenarioType) => {
    setActiveScenario(scenario)
    analytics.capture('hero_interaction', {
      interactionType: 'scenario_toggle',
      scenario,
    })
  }

  const handleRibbonToggle = () => {
    const isExpanded = !hourlyOpen
    setHourlyOpen(isExpanded)
    analytics.capture('hero_interaction', {
      interactionType: 'ribbon_toggle',
      isExpanded,
    })
  }

  const handleRetry = () => {
    void loadData(true)
  }

  const weather = ritual?.data.weather
  const hasHourly = Boolean(weather?.hourly.length)
  const readAt = ownedRitual?.readAt
  const liveLook =
    activeOutfit && weather && readAt !== undefined
      ? { outfit: activeOutfit, snapshot: weather, readAt }
      : null
  const availableScenarios = useMemo(
    () =>
      ritual?.data.outfits
        .filter(({ garmentIds }) => garmentIds.length > 0)
        .map(({ scenario }) => scenario) ?? [],
    [ritual]
  )
  const showPeriods = useMemo(
    () =>
      weather &&
      readAt !== undefined &&
      availableScenarios.length > 1 &&
      hasDistinctForecastPeriods(weather, activeLocale, readAt, availableScenarios),
    [activeLocale, availableScenarios, readAt, weather]
  )

  // The hero for the session on screen, in its own function to keep the screen's branching
  // readable. Story CC-7.7 D2: a member's slot stays empty until the ritual read settles.
  const styleDayPreview = Boolean(liveLook && styleProfile.day)
  const outfitReady = ritualSettled && homeWardrobe !== undefined
  const smallCloset = isSmallLookbookCloset(homeWardrobe?.pieces)
  const liveWardrobeLook = smallCloset ? null : liveLook
  const showSample =
    smallCloset || shouldShowStyleSample(ritual?.data.outfits, styleProfile)
  const sampleWeather = styleForecastSampleWeather(weather?.current)
  const firstLook = !ritual?.data.outfits.some(({ garmentIds }) =>
    garmentIds.some((id) => !id.startsWith('default-'))
  )
  const renderFirstLookStyle = () =>
    firstLook && (
      <NativeView key={styleProfile.scope} style={styles.styleControls}>
        <StyleMemberControls style={styleProfile} />
      </NativeView>
    )
  const renderStyleControls = () =>
    sessionState === 'member' &&
    outfitReady &&
    styleProfile.scope && (
      <NativeView key={styleProfile.scope} style={styles.styleControls}>
        <StyleDayControls style={styleProfile} showTune={!firstLook} />
      </NativeView>
    )
  const renderHero = () =>
    sessionState === 'signed-out' ? (
      <NativeView testID="today-first-content">
        <SignedOutWelcome />
      </NativeView>
    ) : sessionState === 'unavailable' ? (
      <View
        style={[
          styles.errorState,
          { backgroundColor: palette.card, borderColor: palette.line },
        ]}
        testID="home-session-unavailable"
      >
        <Text style={[styles.errorText, { color: palette.ink }]}>
          {getGuestPreviewStrings(i18n.language).chrome.sessionUnavailable}
        </Text>
        <Pressable
          style={[styles.retryButton, { backgroundColor: palette.inverse }]}
          onPress={retrySession}
          accessibilityRole="button"
          testID="home-session-retry"
        >
          <Text style={[styles.retryText, { color: palette.onInverse }]}>
            {getGuestPreviewStrings(i18n.language).chrome.retry}
          </Text>
        </Pressable>
      </View>
    ) : sessionState === 'member' ? (
      <>
        {outfitReady && (ritual || !isLoading) && (
          <FirstLookRegion firstLook={firstLook} minHeight={viewportHeight}>
            <WeatherHeader
              current={weather?.current}
              unavailable={!weather}
              hourlyOpen={hourlyOpen}
              onHourlyToggle={hasHourly ? handleRibbonToggle : undefined}
            />
            {hourlyOpen && (
              <HourlyForecastRibbon
                hourly={weather?.hourly}
                timeZone={weather?.timezone}
                showAll
              />
            )}
            <NativeView testID="today-first-content">
              {liveWardrobeLook && (
                <NativeView style={showSample ? styles.hidden : undefined}>
                  <TodayLiveOutfit
                    key={identityEpoch}
                    {...liveWardrobeLook}
                    owner={applicationUserId}
                    epoch={identityEpoch}
                    locale={activeLocale}
                    wardrobe={homeWardrobe?.wardrobe ?? []}
                    isCacheServed={isCacheServed}
                    stale={isStale}
                    periodPicker={
                      showPeriods ? (
                        <ScenarioToggles
                          activeScenario={activeScenario}
                          availableScenarios={availableScenarios}
                          onScenarioChange={handleScenarioChange}
                        />
                      ) : null
                    }
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
                  />
                </NativeView>
              )}
              {showSample && (
                <MemberSampleOutfit
                  key={identityEpoch}
                  owner={applicationUserId}
                  error={error}
                  busy={isLoading}
                  onRetry={handleRetry}
                  weatherAvailable={Boolean(weather)}
                  sampleWeather={sampleWeather}
                  preview={styleDayPreview}
                  useLookbookTop={smallCloset}
                  showStyleControls={false}
                />
              )}
            </NativeView>
            {renderFirstLookStyle()}
            <CachedWeatherNotice visible={isStale} />
            {weather && <WeatherAlertBanner alerts={weather.alerts} />}
          </FirstLookRegion>
        )}
        <HomeCloset pieces={homeWardrobe?.pieces} />
        <HomePlannerLink />
      </>
    ) : null

  return (
    // Side insets only: the native header and the tab bar already cover top and bottom,
    // and a second top inset left an empty band above the chips.
    <SafeAreaView
      style={[styles.safeContainer, { backgroundColor: palette.page }]}
      edges={['left', 'right']}
    >
      <LiveFontMountMarker scope="home" />
      <ScrollView
        ref={scrollViewRef}
        // React Native's typings predate React 19's nullable RefObject.
        innerViewRef={scrollContentRef as RefObject<NativeView>}
        style={[styles.container, { backgroundColor: palette.page }]}
        contentContainerStyle={styles.contentContainer}
        onLayout={({ nativeEvent }) => setViewportHeight(nativeEvent.layout.height)}
        testID="hero-experience-scrollview"
        // Focusable from code on web without becoming a tab stop, so focus can
        // land here when the teaser leaves.
        {...(Platform.OS === 'web' ? { tabIndex: -1 as const } : {})}
      >
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
            style={[
              styles.focusedAlertCard,
              { backgroundColor: palette.dangerSurface, borderColor: palette.dangerLine },
            ]}
          >
            <Text style={[styles.focusedAlertBadge, { color: palette.dangerInk }]}>
              ⚠️{' '}
              {t('hero.alert.focused_badge', {
                severity: t(
                  `hero.alert.severity.${focusedWeatherAlert.event.data.severity}`
                ),
              })}
              {` (#${focusedWeatherAlert.id})`}
            </Text>
            <Text style={[styles.focusedAlertTitle, { color: palette.dangerInk }]}>
              {focusedWeatherAlert.event.data.location}
            </Text>
            <Text style={[styles.focusedAlertText, { color: palette.dangerInk }]}>
              {focusedWeatherAlert.event.data.message}
            </Text>
          </NativeView>
        )}

        {/* Story CC-7.7 D3, D4: the body, stale and weather alert banners included, appears
            once the ritual read settles, so nothing is inserted above the outfit later. */}
        <ScreenGate
          screen="home"
          session={sessionState}
          ready={homeGateReady(sessionState, outfitReady)}
        >
          {renderHero()}

          {/*
          Story 6.7: after the whole hero conditional, so it follows in focus
          order. It reads on its own and never waits on, hides or re-renders the hero.
        */}
          <HomeSpotlightTeaserSlot
            applicationUserId={applicationUserId}
            scrollViewRef={scrollViewRef}
          />
          {renderStyleControls()}
        </ScreenGate>
      </ScrollView>

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
  hidden: { display: 'none' },
  styleControls: { marginHorizontal: TAB_BODY_INSET, gap: 12 },
  // Colors follow the OS scheme at render time; this sheet keeps layout only.
  safeContainer: {
    flex: 1,
  },
  container: {
    flex: 1,
  },
  contentContainer: {
    paddingBottom: 24,
  },
  staleBanner: {
    borderBottomWidth: 1,
    paddingVertical: 8,
    paddingHorizontal: TAB_BODY_INSET,
    alignItems: 'center',
  },
  staleText: {
    fontSize: 12,
    fontWeight: '600',
  },
  errorState: {
    minHeight: 320,
    marginHorizontal: TAB_BODY_INSET,
    marginTop: 24,
    paddingHorizontal: 24,
    paddingVertical: 32,
    borderWidth: 1,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorText: {
    fontSize: 18,
    fontWeight: '700',
    lineHeight: 28,
    textAlign: 'center',
  },
  retryButton: {
    minWidth: 120,
    minHeight: 44,
    justifyContent: 'center',
    borderRadius: 9999,
    paddingVertical: 12,
    paddingHorizontal: 24,
    marginTop: 24,
    alignItems: 'center',
  },
  retryText: {
    fontSize: 14,
    fontWeight: '700',
  },
  focusedAlertCard: {
    marginHorizontal: TAB_BODY_INSET,
    marginVertical: 8,
    padding: 16,
    borderRadius: 12,
    borderWidth: 2,
  },
  focusedAlertBadge: {
    fontSize: 12,
    fontWeight: 'bold',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 4,
  },
  focusedAlertTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  focusedAlertText: {
    fontSize: 14,
  },
})
