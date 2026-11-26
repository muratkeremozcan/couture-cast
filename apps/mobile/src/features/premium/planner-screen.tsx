// Story 5.5 Task 8 owner: the mobile 7-day outfit planner screen.
// Story 5.5 Task 8 step 2 owner: own the screen states, the themed day cards and the per-date reshuffle in `apps/mobile/src/features/premium/planner-screen.tsx`, reached from the thin route `apps/mobile/app/planner.tsx` and the `PlannerLinkRow` in `apps/mobile/app/(tabs)/settings.tsx`
//
// The mobile counterpart of `apps/web/src/app/components/planner-rail.tsx` (Decision 7),
// built on the same state-machine shape `palette-advisor-screen.tsx` and
// `settings.tsx`'s `PremiumThemeSection` already established for a premium surface:
//
// - No English ever reaches the screen from a thrown message. `src/lib/planner`
//   classifies every failure into a `PlannerFailureReason`, and this file maps each
//   member onto a `commerce.premium.planner.*` key or onto a state change.
// - A degraded weather confidence renders its own label rather than borrowing the
//   `hourly` card's shape -- an `unavailable` day never implies a precision it does not
//   have (AC 2/7).
// - A failed date is its own `error` card; it never blanks the six ready dates around it
//   (AC 3).
// - Reshuffle loading, success, "no alternative", and conflict state all belong to the
//   one date they describe, and a busy card refuses a second tap (AC 4/7).
//
// It lives under `src/features` rather than `app/` for the same reason
// `palette-advisor-screen.tsx` does: it stays covered by the component test runner, and
// it deliberately does not render `<Stack.Screen>` itself, since that import chain pulls
// in native-only modules the browser-based runner cannot polyfill. The thin
// `app/planner.tsx` route sets the nav title instead.
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet } from 'react-native'
import { useTranslation } from 'react-i18next'
import { router } from 'expo-router'
import { getGuestPreviewStrings } from '@couture/utils'
import { onLocationsChanged } from '@/src/lib/locations'
import {
  mobileIdentityEpoch,
  subscribeMobileApplicationUser,
} from '@/src/lib/mobile-auth'
import {
  defaultSupportedLocale,
  resolveSupportedLocale,
  type PlannerDayResult,
  type PlannerReadyDay,
  type PlannerResponse,
  type PlannerScenarioOutfit,
} from '@couture/api-client/contracts/http'

import { createSchemeStyles, Text, View } from '@/components/themed'
import { useAppTheme } from '@/src/theme/theme-context'
import { formatTemperature } from '@/src/lib/formatters'
import {
  formatPlannerDayLabel,
  getPlannerFromMobile,
  plannerFailureReason,
  reshufflePlannerDayFromMobile,
} from '@/src/lib/planner'

type ScreenState =
  | 'loading'
  | 'signed_out'
  | 'locked'
  | 'disabled'
  | 'ready'
  | 'load_failed'
  | 'missing_city'

const SCENARIO_ORDER = ['morning', 'midday', 'evening'] as const

interface DayNotice {
  text: string
  isError: boolean
}

/** Replaces one date's entry in the seven-item array, keeping every other date as-is. */
function replaceDay(
  days: readonly PlannerDayResult[],
  next: PlannerReadyDay
): PlannerDayResult[] {
  return days.map((day) => (day.planDate === next.planDate ? next : day))
}

function LockedPanel() {
  const { t } = useTranslation()
  return (
    <View style={styles.panel} testID="planner-locked">
      <Text style={styles.panelTitle}>{t('commerce.premium.plannerLocked.title')}</Text>
      <Pressable
        accessibilityRole="link"
        style={styles.primaryButton}
        testID="planner-locked-cta"
        onPress={() => router.push('/settings')}
      >
        <Text style={styles.primaryButtonText}>
          {t('commerce.premium.plannerLocked.cta')}
        </Text>
      </Pressable>
    </View>
  )
}

/**
 * The weather line for one ready day.
 *
 * `unavailable` renders its own label and nothing else: no condition, no temperature
 * range, no freshness badge. Rendering any of those next to "weather unavailable" would
 * claim a precision this date does not have (AC 2/7).
 */
function DayWeatherLine({ weather }: { weather: PlannerReadyDay['weather'] }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? i18n.language

  if (weather.confidence === 'unavailable') {
    return (
      <Text style={styles.weatherLine} testID="planner-weather-unavailable">
        {t('commerce.premium.planner.weather.confidence.unavailable')}
      </Text>
    )
  }

  const range =
    weather.temperatureLow !== null && weather.temperatureHigh !== null
      ? `${formatTemperature(weather.temperatureLow, locale)}–${formatTemperature(weather.temperatureHigh, locale)}`
      : null

  return (
    <Text style={styles.weatherLine}>
      {[
        weather.condition
          ? t(`commerce.premium.planner.conditions.${weather.condition}`)
          : null,
        range,
        t(`commerce.premium.planner.weather.confidence.${weather.confidence}`),
        weather.freshness
          ? t(`commerce.premium.planner.weather.freshness.${weather.freshness}`)
          : null,
      ]
        .filter((part): part is string => Boolean(part))
        .join(' · ')}
    </Text>
  )
}

function DisplayGarmentRow({
  garments,
}: {
  garments: PlannerScenarioOutfit['displayGarments']
}) {
  const { t } = useTranslation()
  return (
    <View style={styles.garmentRow}>
      {garments.map((garment) => (
        <View key={garment.id} style={styles.garmentTile}>
          {garment.imageAccess ? (
            <Image
              source={{ uri: garment.imageAccess.url }}
              accessibilityLabel={
                garment.category
                  ? t(`wardrobe.tagging.options.category.${garment.category}`)
                  : undefined
              }
              style={styles.garmentImage}
            />
          ) : null}
        </View>
      ))}
    </View>
  )
}

function OutfitBlock({ outfit }: { outfit: PlannerScenarioOutfit }) {
  const { t } = useTranslation()
  return (
    <View style={styles.outfitBlock} testID={`planner-outfit-${outfit.scenario}`}>
      <Text style={styles.scenarioLabel}>
        {t(`commerce.premium.planner.scenario.${outfit.scenario}`)}
      </Text>
      {outfit.capsuleName ? (
        <Text style={styles.capsuleName}>{outfit.capsuleName}</Text>
      ) : null}
      <Text style={styles.comfortNotes}>{outfit.comfortNotes}</Text>
      {outfit.reasoningBadges.length > 0 ? (
        <View style={styles.badgeRow}>
          {outfit.reasoningBadges.map((badge) => (
            <Text key={badge.key} style={styles.badge}>
              {badge.label}
            </Text>
          ))}
        </View>
      ) : null}
      <DisplayGarmentRow garments={outfit.displayGarments} />
    </View>
  )
}

function ErrorDayCard({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation()
  const tone = useTone()
  return (
    <View style={[styles.card, tone.card]} testID="planner-day-error">
      <Text style={styles.body} accessibilityRole="alert">
        {t('commerce.premium.planner.day.error.title')}
      </Text>
      <Pressable
        accessibilityRole="button"
        style={[styles.secondaryButton, tone.button]}
        testID="planner-day-error-retry"
        onPress={onRetry}
      >
        <Text style={styles.secondaryButtonText}>
          {t('commerce.premium.planner.day.error.retry')}
        </Text>
      </Pressable>
    </View>
  )
}

function ReadyDayCard({
  day,
  isBusy,
  notice,
  onReshuffle,
}: {
  day: PlannerReadyDay
  isBusy: boolean
  notice: DayNotice | undefined
  onReshuffle: () => void
}) {
  const { t, i18n } = useTranslation()
  const palette = useAppTheme().palette
  const tone = useTone()
  const outfitsByScenario = new Map(
    day.outfits.map((outfit) => [outfit.scenario, outfit])
  )

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: palette.cardBg, borderColor: palette.cardBorder },
      ]}
      testID={`planner-day-${day.planDate}`}
    >
      <Text style={[styles.dayLabel, { color: palette.cardText }]}>
        {formatPlannerDayLabel(day.planDate, i18n.resolvedLanguage ?? i18n.language)}
      </Text>
      {day.isStarterWardrobe ? (
        <Text style={styles.starterBadge} testID={`planner-starter-${day.planDate}`}>
          {t('commerce.premium.planner.starterWardrobe')}
        </Text>
      ) : null}
      <DayWeatherLine weather={day.weather} />

      {SCENARIO_ORDER.map((scenario) => {
        const outfit = outfitsByScenario.get(scenario)
        return outfit ? <OutfitBlock key={scenario} outfit={outfit} /> : null
      })}

      <Pressable
        accessibilityRole="button"
        aria-disabled={isBusy}
        disabled={isBusy}
        style={[styles.secondaryButton, { borderColor: palette.cardBorder }]}
        testID={`planner-reshuffle-${day.planDate}`}
        onPress={onReshuffle}
      >
        {isBusy ? (
          <ActivityIndicator
            testID={`planner-reshuffle-loading-${day.planDate}`}
            accessibilityLabel={t('commerce.premium.planner.reshuffle.loading')}
          />
        ) : (
          <Text style={[styles.secondaryButtonText, { color: palette.cardText }]}>
            {t('commerce.premium.planner.reshuffle.cta')}
          </Text>
        )}
      </Pressable>

      {notice ? (
        <Text
          accessibilityRole={notice.isError ? 'alert' : undefined}
          accessibilityLiveRegion={notice.isError ? 'assertive' : 'polite'}
          style={notice.isError ? [styles.errorText, tone.errorText] : styles.body}
          testID={`planner-day-notice-${day.planDate}`}
        >
          {notice.text}
        </Text>
      ) : null}
    </View>
  )
}

export function PlannerScreen() {
  const epoch = useSyncExternalStore(subscribeMobileApplicationUser, mobileIdentityEpoch)
  return <MemberPlannerScreen key={epoch} />
}

function MemberPlannerScreen() {
  const { t, i18n } = useTranslation()
  const { palette } = useAppTheme()
  const tone = useTone()
  const activeLocale =
    resolveSupportedLocale(i18n.resolvedLanguage ?? i18n.language) ??
    defaultSupportedLocale

  const [screenState, setScreenState] = useState<ScreenState>('loading')
  const [week, setWeek] = useState<PlannerResponse['data'] | null>(null)
  const [busyDate, setBusyDate] = useState<string | null>(null)
  const [dayNotices, setDayNotices] = useState<Record<string, DayNotice>>({})

  const writeControllerRef = useRef<AbortController | null>(null)
  const readControllerRef = useRef<AbortController | null>(null)
  useEffect(() => () => writeControllerRef.current?.abort(), [])

  const load = useCallback(
    async (signal: AbortSignal): Promise<void> => {
      try {
        const data = await getPlannerFromMobile({ locale: activeLocale, signal })
        if (signal.aborted) return
        setWeek(data)
        setScreenState('ready')
      } catch (loadError: unknown) {
        if (signal.aborted) return
        switch (plannerFailureReason(loadError)) {
          case 'signed_out':
            setScreenState('signed_out')
            return
          case 'not_entitled':
            setScreenState('locked')
            return
          case 'missing_city':
            setScreenState('missing_city')
            return
          case 'disabled':
            setScreenState('disabled')
            return
          default:
            setScreenState('load_failed')
        }
      }
    },
    [activeLocale]
  )

  const refresh = useCallback(() => {
    readControllerRef.current?.abort()
    const controller = new AbortController()
    readControllerRef.current = controller
    void load(controller.signal)
  }, [load])

  useEffect(() => {
    refresh()
    const unsubscribe = onLocationsChanged(() => {
      writeControllerRef.current?.abort()
      setBusyDate(null)
      setDayNotices({})
      setScreenState('loading')
      refresh()
    })
    return () => {
      readControllerRef.current?.abort()
      unsubscribe()
    }
  }, [refresh])

  const handleReshuffle = useCallback(
    async (day: PlannerReadyDay): Promise<void> => {
      if (busyDate !== null || week === null) return

      const controller = new AbortController()
      writeControllerRef.current = controller
      setBusyDate(day.planDate)

      try {
        const result = await reshufflePlannerDayFromMobile({
          planDate: day.planDate,
          expectedVersion: day.version,
          locationId: week.locationId,
          locale: activeLocale,
          signal: controller.signal,
        })
        if (controller.signal.aborted) return
        setWeek((current) =>
          current === null
            ? current
            : { ...current, days: replaceDay(current.days, result.day) }
        )
        setDayNotices((prev) => ({
          ...prev,
          [day.planDate]: {
            text: t(
              result.unchanged
                ? 'commerce.premium.planner.reshuffle.unchanged'
                : 'commerce.premium.planner.reshuffle.success'
            ),
            isError: false,
          },
        }))
      } catch (writeError: unknown) {
        if (controller.signal.aborted) return
        const reason = plannerFailureReason(writeError)
        if (reason === 'version_conflict') {
          setDayNotices((prev) => ({
            ...prev,
            [day.planDate]: {
              text: t('commerce.premium.planner.reshuffle.conflict'),
              isError: false,
            },
          }))
          refresh()
          return
        }
        if (reason === 'signed_out') {
          setScreenState('signed_out')
          return
        }
        if (reason === 'not_entitled') {
          setScreenState('locked')
          return
        }
        if (reason === 'disabled') {
          setScreenState('disabled')
          return
        }
        setDayNotices((prev) => ({
          ...prev,
          [day.planDate]: {
            text: t('commerce.premium.planner.reshuffle.error'),
            isError: true,
          },
        }))
      } finally {
        if (writeControllerRef.current === controller) {
          writeControllerRef.current = null
        }
        if (!controller.signal.aborted) {
          setBusyDate(null)
        }
      }
    },
    [activeLocale, busyDate, refresh, t, week]
  )

  return (
    <ScrollView
      contentContainerStyle={styles.screen}
      testID="planner-screen"
      accessibilityLabel={t('commerce.premium.planner.sectionTitle')}
    >
      {/* Story CC-7.9 D6: the stack's AppTopBar carries the title; the labeled scroll view keeps
        the section name, and the body repeats it in no heading of its own. */}
      <Text style={styles.body}>{t('commerce.premium.planner.intro')}</Text>

      {screenState === 'loading' ? (
        <ActivityIndicator
          accessibilityLabel={t('commerce.premium.planner.loading')}
          testID="planner-loading"
        />
      ) : null}

      {screenState === 'signed_out' || screenState === 'locked' ? <LockedPanel /> : null}

      {screenState === 'disabled' ? (
        <Text style={styles.body} testID="planner-disabled">
          {t('commerce.premium.planner.disabled')}
        </Text>
      ) : null}

      {screenState === 'missing_city' ? (
        <Pressable
          accessibilityRole="button"
          style={[styles.secondaryButton, { borderColor: palette.cardText }]}
          testID="planner-set-city"
          onPress={() => router.push('/locations?guided=1')}
        >
          <Text style={[styles.secondaryButtonText, { color: palette.cardText }]}>
            {getGuestPreviewStrings(activeLocale).firstUse.setCity}
          </Text>
        </Pressable>
      ) : null}

      {screenState === 'load_failed' ? (
        <>
          <Text
            accessibilityRole="alert"
            style={[styles.errorText, tone.errorText]}
            testID="planner-load-error"
          >
            {t('commerce.premium.planner.errorLoad')}
          </Text>
          <Pressable
            accessibilityRole="button"
            style={[styles.secondaryButton, tone.button]}
            testID="planner-retry"
            onPress={() => {
              setScreenState('loading')
              refresh()
            }}
          >
            <Text style={styles.secondaryButtonText}>
              {t('commerce.premium.planner.retry')}
            </Text>
          </Pressable>
        </>
      ) : null}

      {screenState === 'ready' && week
        ? week.days.map((day) =>
            day.status === 'ready' ? (
              <ReadyDayCard
                key={day.planDate}
                day={day}
                isBusy={busyDate === day.planDate}
                notice={dayNotices[day.planDate]}
                onReshuffle={() => {
                  void handleReshuffle(day)
                }}
              />
            ) : (
              <ErrorDayCard
                key={day.planDate}
                onRetry={() => {
                  refresh()
                }}
              />
            )
          )
        : null}
    </ScrollView>
  )
}

/**
 * Story CC-7.9 D2: the OS-scheme colors for the parts outside a palette card. React Native
 * draws an unset border black, which vanished on the dark page.
 */
const useTone = createSchemeStyles((colors) => ({
  card: { borderColor: colors.line },
  button: { borderColor: colors.lineStrong },
  errorText: { color: colors.dangerInk },
}))

const styles = StyleSheet.create({
  screen: { padding: 20, gap: 12 },
  body: { fontSize: 14, lineHeight: 20 },
  panel: { gap: 8, paddingVertical: 8 },
  panelTitle: { fontSize: 18, fontWeight: '600' },
  card: { gap: 8, padding: 12, borderRadius: 8, borderWidth: 1 },
  dayLabel: { fontSize: 16, fontWeight: '700' },
  starterBadge: { fontSize: 12, fontStyle: 'italic' },
  weatherLine: { fontSize: 14 },
  outfitBlock: { gap: 4, paddingVertical: 8 },
  scenarioLabel: { fontSize: 14, fontWeight: '600', textTransform: 'uppercase' },
  capsuleName: { fontSize: 14, fontWeight: '500' },
  comfortNotes: { fontSize: 14, lineHeight: 20 },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  badge: { fontSize: 12, paddingHorizontal: 8, paddingVertical: 2 },
  garmentRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  garmentTile: { width: 48, height: 48 },
  garmentImage: { width: 48, height: 48, borderRadius: 8 },
  primaryButton: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 16 },
  primaryButtonText: { fontSize: 14, fontWeight: '600' },
  secondaryButton: {
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 16,
    borderWidth: 1,
    borderRadius: 8,
  },
  secondaryButtonText: { fontSize: 14 },
  errorText: { fontSize: 14 },
})
