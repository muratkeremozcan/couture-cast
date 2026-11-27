import { useRouter } from 'expo-router'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import type {
  GarmentWithColor,
  RitualResponse,
  SavedLookContract,
  ScenarioOutfit,
} from '@couture/api-client/contracts/http'
import {
  applyTodaySlotEdits,
  buildTodaySaveAttempt,
  buildTodaySlots,
  formatPreviewString,
  getGuestPreviewStrings,
  getTodayOutfitStrings,
  sampleGarmentText,
  todayLocalDate,
  todayLookNameKey,
  todayRitualAnchorDate,
  todayScenarioWeather,
  todaySlotSignature,
  todaySlotCatalogItem,
  todaySwapOptions,
  type TodaySlotEdits,
} from '@couture/utils'
import { trackMobileAffiliateCtaShown } from '@/src/analytics/track-events'
import { useMobileAnalytics } from '@/src/analytics/mobile-analytics'
import { OutfitRecommendationCard } from '@/components/hero/outfit-recommendation-card'
import { useHeroPalette } from '@/components/hero/hero-theme'
import { SaveActionButton } from '@/components/save-feedback'
import { savedLookRoute } from '@/src/features/looks/looks-routes'
import { PreviewButton } from '@/src/features/preview/guest-preview-parts'
import { useAccessibilityAnnouncer } from '@/src/hooks/use-accessibility-announcer'
import {
  resolveAffiliateLocaleRegion,
  resolveRenderableShopThisLook,
} from '@/src/lib/commerce'
import { formatTemperature } from '@/src/lib/formatters'
import {
  mobileApplicationUserId,
  mobileIdentityEpoch,
  resolveMobileAccessToken,
} from '@/src/lib/mobile-auth'
import {
  createSavedLookFromMobile,
  deleteSavedLookFromMobile,
  formatSavedLookIfMatch,
  MobileSavedLookRequestError,
  notifyMobileSavedLooksChanged,
} from '@/src/lib/saved-looks'
import { TAB_BODY_INSET } from '@/src/theme/tokens'
import { TodayOutfitPicture } from './today-outfit-picture'

type SaveReceipt = Pick<SavedLookContract, 'id' | 'revision'>

export function TodayLiveOutfit({
  outfit,
  snapshot,
  readAt,
  owner,
  epoch,
  locale,
  wardrobe,
  isCacheServed,
  stale,
  periodPicker,
  onExport,
}: {
  outfit: ScenarioOutfit
  snapshot: RitualResponse['data']['weather']
  readAt: number
  owner: string | null
  epoch: number
  locale: string
  wardrobe: readonly GarmentWithColor[]
  isCacheServed: boolean
  stale: boolean
  periodPicker: ReactNode
  onExport: (recommendationId: string, opener: () => number | null) => void
}) {
  const { t } = useTranslation()
  const router = useRouter()
  const palette = useHeroPalette()
  const analytics = useMobileAnalytics()
  const { announce } = useAccessibilityAnnouncer()
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [edits, setEdits] = useState<Record<string, TodaySlotEdits>>({})
  const started = useRef(new Map<string, ReturnType<typeof buildTodaySaveAttempt>>())
  const saved = useRef(new Map<string, SaveReceipt>())
  const shownOffers = useRef(new Set<string>())
  const visit = useRef<AbortController | null>(null)
  const weather = useMemo(
    () => todayScenarioWeather(snapshot, outfit.scenario, readAt),
    [snapshot, outfit.scenario, readAt]
  )
  const recommendationKey = JSON.stringify([
    snapshot.locationKey,
    todayRitualAnchorDate(snapshot.timezone, readAt),
    outfit.id,
    outfit.garmentIds,
    outfit.recommendationActionsAvailable,
  ])
  const closet = outfit.recommendationActionsAvailable === false ? [] : wardrobe
  const baseSlots = buildTodaySlots(outfit, weather, closet)
  const slots = applyTodaySlotEdits(baseSlots, edits[recommendationKey], closet, weather)
  const signature = todaySlotSignature(slots)
  const wornOn = todayLocalDate(snapshot.timezone)
  const key = `${recommendationKey}:${wornOn}:${signature}`
  const copy = getTodayOutfitStrings(locale)
  const title = copy.lookName[todayLookNameKey(weather)]
  const canUseRecommendation =
    !stale &&
    outfit.recommendationActionsAvailable !== false &&
    signature === todaySlotSignature(baseSlots)
  const suppressOffer = isCacheServed || !canUseRecommendation
  const offer = resolveRenderableShopThisLook(outfit, suppressOffer)
  const strings = getGuestPreviewStrings(locale)
  const live = () =>
    visit.current !== null &&
    !visit.current.signal.aborted &&
    owner !== null &&
    mobileApplicationUserId() === owner &&
    mobileIdentityEpoch() === epoch

  useEffect(() => {
    const controller = new AbortController()
    visit.current = controller
    return () => controller.abort()
  }, [epoch, owner])

  useEffect(() => {
    if (!detailsOpen || !offer || shownOffers.current.has(outfit.id)) return
    shownOffers.current.add(outfit.id)
    trackMobileAffiliateCtaShown(
      analytics,
      analytics.getDistinctId() || 'mobile-anonymous-user',
      {
        partnerId: offer.partnerId,
        scenario: outfit.scenario,
        surface: 'mobile_hero',
        localeRegion: resolveAffiliateLocaleRegion(locale),
        recommendationId: outfit.id,
      }
    )
  }, [analytics, detailsOpen, locale, offer, outfit.id, outfit.scenario])

  return (
    <View
      testID="outfit-recommendation-card"
      style={[styles.card, { backgroundColor: palette.card, borderColor: palette.line }]}
    >
      <Text accessibilityRole="header" style={[styles.title, { color: palette.ink }]}>
        {title}
      </Text>
      <Text testID="today-outfit-weather-reason" style={{ color: palette.inkMuted }}>
        {formatPreviewString(copy.weatherReason, {
          temperature: formatTemperature(weather.temperature, locale),
        })}
      </Text>
      <TodayOutfitPicture
        key={recommendationKey}
        slots={slots}
        strings={strings}
        getOptions={(index) => todaySwapOptions(slots, index, closet, weather)}
        onChoose={(index, slot) => {
          if (!live()) return
          setEdits((previous) => ({
            ...previous,
            [recommendationKey]: {
              ...previous[recommendationKey],
              [index]: { ...slot, imageAccess: undefined },
            },
          }))
          analytics.capture('hero_interaction', {
            interactionType: 'garment_swap',
            scenario: outfit.scenario,
            itemId: slot.itemId,
          })
          const catalog = todaySlotCatalogItem(slot)
          announce(
            'swap',
            catalog
              ? sampleGarmentText(catalog, strings).name
              : strings.values.category[slot.category]
          )
        }}
      />
      <View style={styles.actions}>
        <SaveActionButton
          testID="today-primary-action"
          ownerKey={`${owner ?? ''}:${epoch}`}
          resetKey={key}
          idleLabel={copy.wearThis}
          primary
          requiresNetwork
          disabled={!owner}
          onSave={async () => {
            const signal = visit.current?.signal
            if (!live()) return false
            const token = await resolveMobileAccessToken()
            if (!live() || signal?.aborted || !token) return false
            const attempt =
              started.current.get(key) ??
              buildTodaySaveAttempt(outfit.id, weather.condition, slots, wornOn, title)
            started.current.set(key, attempt)
            try {
              const record = await createSavedLookFromMobile(attempt.payload, {
                accessToken: token,
                idempotencyKey: attempt.idempotencyKey,
                signal,
              })
              if (!live() || signal?.aborted) return false
              started.current.delete(key)
              saved.current.set(key, { id: record.id, revision: record.revision })
              notifyMobileSavedLooksChanged(owner)
              return true
            } catch (error) {
              if (error instanceof MobileSavedLookRequestError && error.status === 409) {
                started.current.delete(key)
              }
              throw error
            }
          }}
          onUndo={async () => {
            const receipt = saved.current.get(key)
            const signal = visit.current?.signal
            if (!live() || !receipt) return false
            const token = await resolveMobileAccessToken()
            if (!live() || signal?.aborted || !token) return false
            try {
              await deleteSavedLookFromMobile(
                receipt.id,
                formatSavedLookIfMatch(receipt.id, receipt.revision),
                { accessToken: token, signal }
              )
            } catch (error) {
              if (!(error instanceof MobileSavedLookRequestError && error.status === 404))
                throw error
            }
            if (!live() || signal?.aborted) return false
            saved.current.delete(key)
            notifyMobileSavedLooksChanged(owner)
            return true
          }}
          onView={() => {
            const receipt = saved.current.get(key)
            if (live() && receipt) router.push(savedLookRoute(receipt.id))
          }}
        />
        <PreviewButton
          label={t('home.today.outfitDetails')}
          palette={palette}
          testID="today-outfit-details"
          expanded={detailsOpen}
          onPress={() => setDetailsOpen((open) => !open)}
        />
      </View>
      {detailsOpen && (
        <>
          {periodPicker}
          <OutfitRecommendationCard
            outfit={outfit}
            onExport={canUseRecommendation ? onExport : undefined}
            isCacheServed={suppressOffer}
            isCurrent={live}
            nested
          />
        </>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: TAB_BODY_INSET,
    borderRadius: 12,
    borderWidth: 1,
    padding: 16,
    gap: 8,
  },
  title: { fontSize: 20, fontWeight: '700' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
})
