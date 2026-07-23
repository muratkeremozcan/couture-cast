import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Pressable,
  StyleSheet,
  ScrollView,
  SafeAreaView,
  Modal,
  Platform,
} from 'react-native'
import { Text, View } from '@/components/themed'
import { useMobileAnalytics } from '@/src/analytics/mobile-analytics'
import { createMobileApiClient } from '@/src/lib/api-client'
import { resolveMobileAccessToken } from '@/src/lib/mobile-auth'
import { readLatestRitualCache, saveRitualCache } from '@/src/lib/ritual-cache'
import {
  defaultSupportedLocale,
  resolveSupportedLocale,
  ritualResponseSchema,
  type RitualResponse,
} from '@couture/api-client/contracts/http'
import { trackMobileRitualCreated } from '@/src/analytics/track-events'

// Import components
import { WeatherHeader } from '@/components/hero/weather-header'
import { HourlyForecastRibbon } from '@/components/hero/hourly-forecast-ribbon'
import { ScenarioToggles } from '@/components/hero/scenario-toggles'
import { OutfitRecommendationCard } from '@/components/hero/outfit-recommendation-card'
import { WeatherAlertBanner } from '@/components/hero/weather-alert-banner'
import { parseGarmentId } from '@/components/hero/garment-item-tile'
import { useHeroPalette } from '@/components/hero/hero-theme'

type ScenarioType = 'morning' | 'midday' | 'evening'

const ritualRequestTimeoutMs = 15_000

const alternateGarments: Record<string, string[]> = {
  Outerwear: [
    'classic-trench-coat',
    'leather-jacket',
    'denim-jacket',
    'wool-coat',
    'blazer',
  ],
  Bottoms: ['navy-chinos', 'denim-jeans', 'corduroy-pants', 'shorts', 'linen-trousers'],
  Tops: ['crewneck-sweater', 'hoodie', 'casual-tee', 'button-down-shirt', 'knit-polo'],
  Footwear: ['leather-boots', 'canvas-sneakers', 'loafers', 'derby-shoes'],
  Accessories: ['umbrella', 'wool-scarf', 'leather-gloves', 'sunglasses', 'beanie'],
  Garment: ['basic-socks', 'leather-belt'],
}

export default function TabOneScreen() {
  const analytics = useMobileAnalytics()
  const { i18n, t } = useTranslation()
  const analyticsUserId = analytics.getDistinctId() || 'mobile-anonymous-user'
  const activeLocale =
    resolveSupportedLocale(i18n.resolvedLanguage ?? i18n.language) ??
    defaultSupportedLocale
  const palette = useHeroPalette()
  const latestLoadId = useRef(0)
  const hasTrackedTabView = useRef(false)

  const [ritual, setRitual] = useState<RitualResponse | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeScenario, setActiveScenario] = useState<ScenarioType>('morning')
  const [isStale, setIsStale] = useState(false)

  // Garment swap modal states
  const [isSwapModalVisible, setIsSwapModalVisible] = useState(false)
  const [swappingGarmentId, setSwappingGarmentId] = useState<string | null>(null)

  const fetchRitual = async () => {
    const client = createMobileApiClient({
      accessToken: async () => (await resolveMobileAccessToken()) || '',
    })
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), ritualRequestTimeoutMs)

    try {
      // Omitting locationId deliberately selects the user's primary saved location.
      const response = await client.apiV1RitualGet(
        { locale: activeLocale },
        { signal: controller.signal }
      )
      return ritualResponseSchema.parse(response)
    } finally {
      clearTimeout(timeout)
    }
  }

  const loadData = async (forceRefresh = false) => {
    const loadId = ++latestLoadId.current
    setIsLoading(true)
    setError(null)
    setIsStale(false)

    const cached = await readLatestRitualCache(analyticsUserId, activeLocale)
    const now = Date.now()

    if (!forceRefresh && cached && now - cached.timestamp < 15 * 60 * 1000) {
      if (loadId === latestLoadId.current) {
        setRitual(cached.data)
        setIsLoading(false)
      }
      return
    }

    try {
      const data = await fetchRitual()
      if (loadId !== latestLoadId.current) {
        return
      }

      setRitual(data)
      void saveRitualCache(analyticsUserId, activeLocale, {
        data,
        timestamp: now,
      }).catch(() => undefined)

      trackMobileRitualCreated(analytics, {
        userId: analyticsUserId,
        locationId: data.data.weather.locationKey,
        ritualType: 'daily_outfit',
        weatherContext: data.data.weather.current.condition,
      })
    } catch {
      if (loadId !== latestLoadId.current) {
        return
      }

      // Offline fallback: try using cached data if available, even if stale
      if (cached) {
        setRitual(cached.data)
        setIsStale(true)
      } else {
        setError(
          t('hero.load_error', {
            defaultValue: 'Unable to load daily recommendations',
          })
        )
      }
    } finally {
      if (loadId === latestLoadId.current) {
        setIsLoading(false)
      }
    }
  }

  useEffect(() => {
    // Track when user views Tab One — top of the engagement funnel
    if (!hasTrackedTabView.current) {
      hasTrackedTabView.current = true
      analytics.capture('tab_one_viewed')
    }
    void loadData()
  }, [activeLocale, analyticsUserId])

  const handleScenarioChange = (scenario: ScenarioType) => {
    setActiveScenario(scenario)
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

  const handleSwapGarment = (garmentId: string) => {
    setSwappingGarmentId(garmentId)
    setIsSwapModalVisible(true)
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

    void saveRitualCache(analyticsUserId, activeLocale, {
      data: updatedRitual,
      timestamp: Date.now(),
    }).catch(() => undefined)

    analytics.capture('hero_interaction', {
      interactionType: 'garment_swap',
      scenario: activeScenario,
      itemId: newGarmentId,
    })

    setIsSwapModalVisible(false)
    setSwappingGarmentId(null)
  }

  const activeOutfit = ritual?.data.outfits.find((o) => o.scenario === activeScenario)

  const handleRetry = () => {
    void loadData(true)
  }

  // Determine swap category list
  const swapCategory = swappingGarmentId
    ? parseGarmentId(swappingGarmentId).category
    : 'Garment'
  const swapOptions = alternateGarments[swapCategory] || alternateGarments.Garment || []

  return (
    <SafeAreaView style={[styles.safeContainer, { backgroundColor: palette.background }]}>
      <ScrollView
        style={[styles.container, { backgroundColor: palette.background }]}
        contentContainerStyle={styles.contentContainer}
        testID="hero-experience-scrollview"
      >
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

        {/* Error State Banner */}
        {error && (
          <View style={styles.errorBanner} testID="error-banner">
            <Text style={styles.errorText}>{error}</Text>
            <Pressable style={styles.retryButton} onPress={handleRetry}>
              <Text style={styles.retryText}>
                {t('hero.retry', { defaultValue: 'Retry' })}
              </Text>
            </Pressable>
          </View>
        )}

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
          onSwapGarment={handleSwapGarment}
          isLoading={isLoading}
        />
      </ScrollView>

      {/* Garment Swap Modal */}
      <Modal
        visible={isSwapModalVisible}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setIsSwapModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent} testID="garment-swap-modal">
            <Text style={styles.modalTitle}>
              {t('hero.garment_swap_title', {
                defaultValue: 'Choose alternate garment',
              })}
            </Text>
            <ScrollView style={styles.modalScroll}>
              {swapOptions.map((option) => {
                const isCurrent = option === swappingGarmentId
                const details = parseGarmentId(option)
                return (
                  <Pressable
                    key={option}
                    style={[styles.modalItem, isCurrent && styles.modalItemCurrent]}
                    onPress={() => performSwap(option)}
                    testID={`swap-option-${option}`}
                  >
                    <Text
                      style={[
                        styles.modalItemText,
                        isCurrent && styles.modalItemTextCurrent,
                      ]}
                    >
                      {details.name}
                    </Text>
                    {isCurrent && <Text style={styles.modalItemCheck}>✓</Text>}
                  </Pressable>
                )
              })}
            </ScrollView>
            <Pressable
              style={styles.closeButton}
              onPress={() => setIsSwapModalVisible(false)}
            >
              <Text style={styles.closeButtonText}>
                {t('common.cancel', { defaultValue: 'Cancel' })}
              </Text>
            </Pressable>
          </View>
        </View>
      </Modal>
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
    color: '#D97706',
    fontSize: 12,
    fontWeight: '600',
    fontFamily: Platform.select({
      ios: 'SF Pro Text',
      android: 'Roboto',
      web: 'Inter, -apple-system, sans-serif',
    }),
  },
  errorBanner: {
    backgroundColor: '#FEF2F2',
    borderBottomWidth: 1,
    borderBottomColor: '#FCA5A5',
    paddingVertical: 10,
    paddingHorizontal: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  errorText: {
    color: '#DC2626',
    fontSize: 12,
    fontWeight: '600',
    flex: 1,
  },
  retryButton: {
    backgroundColor: '#DC2626',
    borderRadius: 4,
    paddingVertical: 4,
    paddingHorizontal: 8,
    marginLeft: 12,
  },
  retryText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingTop: 20,
    paddingBottom: Platform.OS === 'ios' ? 34 : 20,
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
    color: '#C9A14A',
  },
  modalItemCheck: {
    color: '#C9A14A',
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
  },
})
