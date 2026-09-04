// Story 3.5 Task 1 step 2 owner: implement ultrawide 7-day planning drawer in apps/web/src/app/components/planner-rail.tsx
// Story 5.2 Task 7 owner: entitlement-aware locked state (Decision 2).
// Story 5.5 Task 7 owner: replace the static shell with the live seven-day
// planner (Decision 7).
//
// Self-contained, following `palette-advisor-panel.tsx`'s architecture rather
// than the old boolean-prop shape: the rail owns its own fetch, its own
// `checking | entitled | locked | error` state, and fetches nothing until
// `isOpen` turns true (AC 6 -- no request for a rail nobody opened, no
// polling once one is). One request settles both entitlement and data: the
// planner `GET` itself carries the 401/403/503 classification, so there is no
// separate subscription pre-check to keep in sync with it.
//
// `variant` is decided by the caller from actual viewport width, matching
// Decision 7: `rail` is the inline third-column landmark at 1440px and wider
// (no focus trap, no backdrop -- it is ordinary page content), `overlay` is
// the drawer/sheet below that (focus trapped, backdrop, restores focus to the
// opener on close). Both variants render the same `role="complementary"`
// content; only the chrome around it differs.
'use client'

import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import type {
  PlannerDayResult,
  PlannerReadyDay,
  PlannerResponse,
  PlannerScenarioOutfit,
} from '@couture/api-client/contracts/http'
import {
  formatPlannerDateLabel,
  formatPlannerTemperature,
  getPlannerFromWeb,
  hasWebSession,
  plannerFailureReason,
  reshufflePlannerDayFromWeb,
} from '../../lib/planner'

export interface PlannerRailProps {
  isOpen: boolean
  onClose: () => void
  variant: 'rail' | 'overlay'
  /** The control that opened the rail, so `overlay` can restore focus to it on close. */
  invokingElementRef?: React.RefObject<HTMLElement | null>
}

type EntitlementState = 'checking' | 'entitled' | 'locked' | 'error'

/**
 * Why the rail is locked, so the copy can distinguish "subscribe" from
 * "temporarily unavailable" without widening {@link EntitlementState} past
 * Decision 7's exact four values. `null` covers signed-out, where the plain
 * upsell already ships from Story 5.2 and needs no second explanation.
 */
type LockedReason = 'not_entitled' | 'disabled' | null

const SCENARIO_ORDER = ['morning', 'midday', 'evening'] as const

/** `plannerData['days']` element narrowed to the ready branch, keyed for `Array.prototype.find`. */
function readyOutfitFor(
  day: PlannerReadyDay,
  scenario: (typeof SCENARIO_ORDER)[number]
): PlannerScenarioOutfit | undefined {
  return day.outfits.find((outfit) => outfit.scenario === scenario)
}

function GarmentThumb({
  garment,
  t,
}: {
  garment: PlannerReadyDay['outfits'][number]['displayGarments'][number]
  t: (key: string) => string
}) {
  return (
    <li
      className="flex flex-col items-center gap-1"
      data-testid={`planner-garment-${garment.id}`}
    >
      {garment.imageAccess ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={garment.imageAccess.url}
          alt=""
          aria-hidden="true"
          className="h-14 w-14 rounded-md object-cover"
        />
      ) : (
        <div
          aria-hidden="true"
          className="flex h-14 w-14 items-center justify-center rounded-md bg-[var(--theme-card-bg)] text-xl"
        >
          👗
        </div>
      )}
      {garment.category && (
        <span className="text-[10px] text-neutral-500">
          {t(`commerce.premium.planner.garmentCategory.${garment.category}`)}
        </span>
      )}
    </li>
  )
}

function OutfitCard({
  outfit,
  t,
}: {
  outfit: PlannerScenarioOutfit
  t: (key: string, options?: Record<string, unknown>) => string
}) {
  return (
    <li
      className="space-y-2 rounded-lg border border-[color:var(--theme-card-border)] bg-white p-3"
      data-testid={`planner-outfit-${outfit.scenario}`}
    >
      {/*
       * `--theme-secondary` is a decorative accent (a button background at
       * line ~363, a focus-outline color at ~656), not a text color: in every
       * one of the four premium themes it is too light against this card's
       * white background to clear WCAG's 4.5:1 small-text minimum (the
       * default theme's `#c9a14a` measures 2.41:1). `--theme-card-text` is
       * the token this codebase already defines for legible text on a card
       * (Decision 8), and the capsule name directly below already uses it.
       */}
      <p className="lookbook-metrics text-[11px] uppercase tracking-wide text-[color:var(--theme-card-text)]">
        {t(`commerce.premium.planner.scenario.${outfit.scenario}`)}
      </p>
      {outfit.capsuleName && (
        <p className="text-sm font-medium text-[color:var(--theme-card-text)]">
          {outfit.capsuleName}
        </p>
      )}
      <ul className="flex flex-wrap gap-2">
        {outfit.displayGarments.map((garment) => (
          <GarmentThumb key={garment.id} garment={garment} t={t} />
        ))}
      </ul>
      <p className="text-xs text-neutral-600">{outfit.comfortNotes}</p>
      {outfit.reasoningBadges.length > 0 && (
        <ul className="flex flex-wrap gap-1">
          {outfit.reasoningBadges.map((badge) => (
            <li
              key={badge.key}
              className="rounded-full border border-[color:var(--theme-card-border)] px-2 py-0.5 text-[10px] text-neutral-600"
            >
              {badge.label}
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}

function WeatherSummary({
  weather,
  locale,
  t,
}: {
  weather: PlannerReadyDay['weather']
  locale: string
  t: (key: string) => string
}) {
  if (weather.confidence === 'unavailable') {
    return (
      <p className="text-xs text-neutral-500" data-testid="planner-weather-unavailable">
        {t('commerce.premium.planner.weatherUnavailable')}
      </p>
    )
  }

  const conditionLabel = weather.condition
    ? t(`commerce.premium.planner.condition.${weather.condition}`)
    : null
  const low =
    weather.temperatureLow !== null
      ? formatPlannerTemperature(weather.temperatureLow, locale)
      : null
  const high =
    weather.temperatureHigh !== null
      ? formatPlannerTemperature(weather.temperatureHigh, locale)
      : null

  return (
    <p
      className="lookbook-metrics text-xs text-neutral-600"
      data-testid="planner-weather"
    >
      {[high, low].filter(Boolean).join(' / ')}
      {conditionLabel ? ` · ${conditionLabel}` : ''}
      {' · '}
      {t(`commerce.premium.planner.confidence.${weather.confidence}`)}
      {weather.freshness &&
        ` · ${t(`commerce.premium.planner.freshness.${weather.freshness}`)}`}
    </p>
  )
}

function ReadyDayCard({
  day,
  index,
  locale,
  isBusy,
  dayError,
  onReshuffle,
  t,
}: {
  day: PlannerReadyDay
  index: number
  locale: string
  isBusy: boolean
  dayError: string | null
  onReshuffle: () => void
  t: (key: string, options?: Record<string, unknown>) => string
}) {
  const dayLabel =
    index === 0
      ? t('commerce.premium.planner.today')
      : index === 1
        ? t('commerce.premium.planner.tomorrow')
        : formatPlannerDateLabel(day.planDate, locale)

  return (
    <li
      className="space-y-3 rounded-[8px] border border-[color:var(--theme-card-border)] bg-[var(--theme-card-bg)] p-4"
      data-testid={`planner-day-${day.planDate}`}
    >
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-[color:var(--theme-card-text)]">
            {dayLabel}
          </p>
          <WeatherSummary weather={day.weather} locale={locale} t={t} />
        </div>
        {day.isStarterWardrobe && (
          <span
            className="rounded-full border border-[color:var(--theme-card-border)] px-2 py-0.5 text-[10px] text-neutral-600"
            data-testid={`planner-starter-${day.planDate}`}
          >
            {t('commerce.premium.planner.starterWardrobe')}
          </span>
        )}
      </div>

      <ul className="space-y-2">
        {SCENARIO_ORDER.map((scenario) => {
          const outfit = readyOutfitFor(day, scenario)
          return outfit ? <OutfitCard key={scenario} outfit={outfit} t={t} /> : null
        })}
      </ul>

      <button
        type="button"
        className="min-h-[44px] w-full rounded-md border border-[color:var(--theme-card-border)] text-sm font-semibold text-[color:var(--theme-card-text)] disabled:opacity-70"
        data-testid={`planner-reshuffle-${day.planDate}`}
        aria-busy={isBusy}
        disabled={isBusy}
        onClick={onReshuffle}
      >
        {isBusy
          ? t('commerce.premium.planner.reshuffle.loading')
          : t('commerce.premium.planner.reshuffle.action')}
      </button>

      {dayError && (
        <p
          role="alert"
          aria-live="assertive"
          className="text-xs font-medium text-red-700"
          data-testid={`planner-day-alert-${day.planDate}`}
        >
          {dayError}
        </p>
      )}
    </li>
  )
}

function ErrorDayCard({
  day,
  index,
  locale,
  onRetry,
  t,
}: {
  day: Extract<PlannerDayResult, { status: 'error' }>
  index: number
  locale: string
  onRetry: () => void
  t: (key: string) => string
}) {
  const dayLabel =
    index === 0
      ? t('commerce.premium.planner.today')
      : index === 1
        ? t('commerce.premium.planner.tomorrow')
        : formatPlannerDateLabel(day.planDate, locale)

  return (
    <li
      className="space-y-2 rounded-[8px] border border-[color:var(--theme-card-border)] bg-[var(--theme-card-bg)] p-4"
      data-testid={`planner-day-${day.planDate}`}
    >
      <p className="text-sm font-semibold text-[color:var(--theme-card-text)]">
        {dayLabel}
      </p>
      <p role="alert" aria-live="assertive" className="text-xs font-medium text-red-700">
        {t('commerce.premium.planner.dayError')}
      </p>
      <button
        type="button"
        className="min-h-[44px] rounded-md border border-[color:var(--theme-card-border)] px-4 text-sm font-semibold text-[color:var(--theme-card-text)]"
        data-testid={`planner-retry-${day.planDate}`}
        onClick={onRetry}
      >
        {t('commerce.premium.planner.retry')}
      </button>
    </li>
  )
}

function PlannerSkeleton() {
  return (
    <ul className="space-y-3" data-testid="planner-skeleton" aria-hidden="true">
      {Array.from({ length: 7 }, (_unused, index) => (
        <li
          key={index}
          className="h-20 motion-safe:animate-pulse rounded-[8px] bg-[var(--theme-card-bg)]"
        />
      ))}
    </ul>
  )
}

function LockedPanel({
  reason,
  t,
}: {
  reason: LockedReason
  t: (key: string) => string
}) {
  if (reason === 'disabled') {
    return (
      <div
        className="space-y-2 rounded-lg border border-[color:var(--theme-card-border)] bg-white p-4"
        data-testid="planner-rail-disabled"
      >
        <p className="text-sm font-medium text-[color:var(--theme-card-text)]">
          {t('commerce.premium.planner.disabled')}
        </p>
      </div>
    )
  }

  return (
    <div
      className="space-y-3 rounded-lg border border-[color:var(--theme-card-border)] bg-white p-4"
      data-testid="planner-rail-locked"
    >
      <p className="text-sm font-medium text-[color:var(--theme-card-text)]">
        {t('commerce.premium.plannerLocked.title')}
      </p>
      <a
        href="/settings"
        className="inline-block min-h-[44px] rounded-lg bg-[var(--theme-secondary)] px-4 py-2 text-xs font-semibold text-[color:var(--theme-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[color:var(--theme-primary)]"
        data-testid="planner-rail-get-premium"
      >
        {t('commerce.premium.plannerLocked.cta')}
      </a>
    </div>
  )
}

function ErrorPanel({ onRetry, t }: { onRetry: () => void; t: (key: string) => string }) {
  return (
    <div
      className="space-y-3 rounded-lg border border-[color:var(--theme-card-border)] bg-white p-4"
      data-testid="planner-rail-error"
    >
      <p role="alert" aria-live="assertive" className="text-sm font-medium text-red-700">
        {t('commerce.premium.planner.errorTitle')}
      </p>
      <button
        type="button"
        className="min-h-[44px] rounded-md border border-[color:var(--theme-card-border)] px-4 text-sm font-semibold text-[color:var(--theme-card-text)]"
        data-testid="planner-rail-retry"
        onClick={onRetry}
      >
        {t('commerce.premium.planner.retry')}
      </button>
    </div>
  )
}

export function PlannerRail({
  isOpen,
  onClose,
  variant,
  invokingElementRef,
}: PlannerRailProps) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language

  const [entitlementState, setEntitlementState] = useState<EntitlementState>('checking')
  const [lockedReason, setLockedReason] = useState<LockedReason>(null)
  const [plannerData, setPlannerData] = useState<PlannerResponse['data'] | null>(null)
  const [busyPlanDate, setBusyPlanDate] = useState<string | null>(null)
  const [dayErrors, setDayErrors] = useState<Record<string, string>>({})
  const [announcement, setAnnouncement] = useState<string | null>(null)

  const fetchControllerRef = useRef<AbortController | null>(null)
  const reshuffleControllersRef = useRef<Map<string, AbortController>>(new Map())
  const dialogRef = useRef<HTMLElement | null>(null)
  const closeButtonRef = useRef<HTMLButtonElement | null>(null)
  const previousActiveElementRef = useRef<HTMLElement | null>(null)

  const load = useCallback(
    async (signal: AbortSignal, options: { silent?: boolean } = {}) => {
      if (!options.silent) {
        setEntitlementState('checking')
      }
      if (!hasWebSession()) {
        setEntitlementState('locked')
        setLockedReason(null)
        setPlannerData(null)
        return
      }
      try {
        const data = await getPlannerFromWeb(signal)
        if (signal.aborted) return
        setPlannerData(data)
        setEntitlementState('entitled')
        setAnnouncement(t('commerce.premium.planner.announce.ready'))
      } catch (loadError: unknown) {
        if (signal.aborted) return
        const reason = plannerFailureReason(loadError)
        if (reason === 'signed_out' || reason === 'not_entitled') {
          setEntitlementState('locked')
          setLockedReason('not_entitled')
          setPlannerData(null)
        } else if (reason === 'disabled') {
          setEntitlementState('locked')
          setLockedReason('disabled')
          setPlannerData(null)
        } else if (!options.silent) {
          // A silent (background) refresh that fails leaves the last known
          // week on screen rather than blanking a rail the reader is
          // mid-interaction with, mirroring `palette-advisor-panel.tsx`'s
          // `refresh()`.
          setEntitlementState('error')
          setPlannerData(null)
        }
      }
    },
    [t]
  )

  // Fetch only while open, abort on close. AC 6: one fetch per explicit open,
  // no polling.
  useEffect(() => {
    if (!isOpen) {
      fetchControllerRef.current?.abort()
      for (const controller of reshuffleControllersRef.current.values()) {
        controller.abort()
      }
      reshuffleControllersRef.current.clear()
      return
    }
    const controller = new AbortController()
    fetchControllerRef.current = controller
    void load(controller.signal)
    return () => controller.abort()
  }, [isOpen, load])

  // AC 6: also refresh on screen focus while open, still no interval polling.
  useEffect(() => {
    if (!isOpen) return
    function handleFocus() {
      if (entitlementState !== 'entitled') return
      const controller = new AbortController()
      fetchControllerRef.current = controller
      void load(controller.signal, { silent: true })
    }
    window.addEventListener('focus', handleFocus)
    return () => window.removeEventListener('focus', handleFocus)
  }, [isOpen, entitlementState, load])

  // Focus trap and restore, overlay only -- the rail variant is ordinary
  // in-page content and must stay in the normal tab order.
  useLayoutEffect(() => {
    if (!isOpen || variant !== 'overlay') return
    previousActiveElementRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    const originalOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeButtonRef.current?.focus()
    const invoker = invokingElementRef?.current

    return () => {
      document.body.style.overflow = originalOverflow
      const target =
        invoker?.isConnected === true
          ? invoker
          : previousActiveElementRef.current?.isConnected === true
            ? previousActiveElementRef.current
            : null
      target?.focus()
    }
  }, [isOpen, variant, invokingElementRef])

  const handleReshuffle = useCallback(
    async (day: PlannerReadyDay, index: number) => {
      if (busyPlanDate !== null) return
      setBusyPlanDate(day.planDate)
      setDayErrors((current) => {
        const next = { ...current }
        delete next[day.planDate]
        return next
      })
      const controller = new AbortController()
      reshuffleControllersRef.current.set(day.planDate, controller)
      const dayLabel =
        index === 0
          ? t('commerce.premium.planner.today')
          : index === 1
            ? t('commerce.premium.planner.tomorrow')
            : formatPlannerDateLabel(day.planDate, locale)

      try {
        const { day: updated, unchanged } = await reshufflePlannerDayFromWeb(
          day.planDate,
          day.version,
          controller.signal
        )
        if (controller.signal.aborted) return
        setPlannerData((current) =>
          current
            ? {
                ...current,
                days: current.days.map((existing) =>
                  existing.planDate === day.planDate ? updated : existing
                ),
              }
            : current
        )
        setAnnouncement(
          unchanged
            ? t('commerce.premium.planner.reshuffle.unchanged')
            : t('commerce.premium.planner.reshuffle.updated', { day: dayLabel })
        )
      } catch (reshuffleError: unknown) {
        if (controller.signal.aborted) return
        const reason = plannerFailureReason(reshuffleError)
        if (reason === 'conflict') {
          setDayErrors((current) => ({
            ...current,
            [day.planDate]: t('commerce.premium.planner.reshuffle.conflict'),
          }))
          const refreshController = new AbortController()
          fetchControllerRef.current = refreshController
          void load(refreshController.signal, { silent: true })
        } else if (
          reason === 'signed_out' ||
          reason === 'not_entitled' ||
          reason === 'disabled'
        ) {
          setEntitlementState('locked')
          setLockedReason(reason === 'disabled' ? 'disabled' : 'not_entitled')
          setPlannerData(null)
        } else {
          setDayErrors((current) => ({
            ...current,
            [day.planDate]: t('commerce.premium.planner.reshuffle.error'),
          }))
        }
      } finally {
        if (!controller.signal.aborted) {
          setBusyPlanDate(null)
        }
        reshuffleControllersRef.current.delete(day.planDate)
      }
    },
    [busyPlanDate, load, locale, t]
  )

  const handleRetry = useCallback(() => {
    const controller = new AbortController()
    fetchControllerRef.current = controller
    void load(controller.signal)
  }, [load])

  const days = useMemo(() => plannerData?.days ?? [], [plannerData])

  // Traps focus and closes on Escape, overlay only -- the rail variant is
  // ordinary in-page content and must never intercept Tab or Escape.
  // Mirrors `accessible-modal.tsx`'s `handleKeyDown` exactly.
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLElement>) => {
      if (variant !== 'overlay') return
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key !== 'Tab') return

      const focusable = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
        ) ?? []
      )
      const first = focusable[0]
      const last = focusable.at(-1)
      if (!first || !last) {
        event.preventDefault()
        dialogRef.current?.focus()
        return
      }
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    },
    [variant, onClose]
  )

  if (!isOpen) return null

  const isOverlay = variant === 'overlay'

  return (
    <aside
      ref={dialogRef as React.RefObject<HTMLElement>}
      aria-label="Planner Rail"
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      className={
        isOverlay
          ? 'planner-rail-enter fixed inset-0 z-[60] flex flex-col gap-6 overflow-y-auto bg-[var(--theme-card-bg)] p-6 shadow-2xl'
          : 'planner-rail-enter flex flex-col gap-6 rounded-[8px] border border-[color:var(--theme-card-border)] bg-[var(--theme-card-bg)] p-6 shadow-sm'
      }
      aria-busy={entitlementState === 'checking'}
    >
      <div className="flex items-center justify-between border-b border-[color:var(--theme-card-border)] pb-4">
        <div>
          <h3 className="lookbook-display text-lg font-semibold text-[color:var(--theme-card-text)]">
            {t('commerce.premium.planner.sectionTitle')}
          </h3>
        </div>
        <button
          ref={closeButtonRef}
          type="button"
          onClick={onClose}
          aria-label={t('commerce.premium.planner.close')}
          className="min-h-[44px] min-w-[44px] rounded-md p-1 text-[color:var(--theme-card-text)] hover:opacity-70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--theme-secondary)]"
        >
          ✕
        </button>
      </div>

      {entitlementState === 'checking' && <PlannerSkeleton />}
      {entitlementState === 'locked' && <LockedPanel reason={lockedReason} t={t} />}
      {entitlementState === 'error' && <ErrorPanel onRetry={handleRetry} t={t} />}
      {entitlementState === 'entitled' && (
        <ol className="space-y-3" data-testid="planner-days">
          {days.map((day, index) =>
            day.status === 'ready' ? (
              <ReadyDayCard
                key={day.planDate}
                day={day}
                index={index}
                locale={locale}
                isBusy={busyPlanDate === day.planDate}
                dayError={dayErrors[day.planDate] ?? null}
                onReshuffle={() => void handleReshuffle(day, index)}
                t={t}
              />
            ) : (
              <ErrorDayCard
                key={day.planDate}
                day={day}
                index={index}
                locale={locale}
                onRetry={handleRetry}
                t={t}
              />
            )
          )}
        </ol>
      )}

      {announcement && (
        <div role="status" aria-live="polite" className="sr-only">
          {announcement}
        </div>
      )}
    </aside>
  )
}
