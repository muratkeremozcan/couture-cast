// Story 3.5 Task 1 step 2 owner: implement ultrawide 7-day planning drawer in apps/web/src/app/components/planner-rail.tsx
// Story 5.2 Task 7 owner: entitlement-aware locked state (Decision 2).
// Story 5.5 Task 7 step 2 owner: own the entitlement state machine, the week render, per-date reshuffle state and both variants' focus behaviour in `apps/web/src/app/components/planner-rail.tsx`
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
//
// The week follows the session (`MemberScope`): while a stored session is still being verified
// the rail stays `checking`, and it reads once per open per member. A one-shot check inside the
// fetch once showed an entitled member the signed-out lock on a direct load (2026-11-19).
'use client'

import Link from 'next/link'
import { getGuestPreviewStrings } from '@couture/utils'
import { SET_CITY_FROM_PLANNER } from '../../lib/ritual'
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
  plannerFailureReason,
  reshufflePlannerDayFromWeb,
} from '../../lib/planner'
import {
  isLiveOwner,
  isSessionRecheckError,
  MemberScope,
  readAsMember,
  useReloadOnSessionRecheck,
  useWebSessionOwner,
  type MemberSession,
} from '../../lib/use-web-session'
import { acquireScrollLock } from './modal-stack'

export interface PlannerRailProps {
  isOpen: boolean
  onClose: () => void
  variant: 'rail' | 'overlay'
  /** The control that opened the rail, so `overlay` can restore focus to it on close. */
  invokingElementRef?: React.RefObject<HTMLElement | null>
}

type EntitlementState = 'checking' | 'entitled' | 'locked' | 'error' | 'missing_city'

interface RailState {
  entitlementState: EntitlementState
  plannerData: PlannerResponse['data'] | null
  /** The last read was denied and the bridge could not verify the member again. */
  recheckFailedAt: number | null
}

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
        <span className="text-[10px] text-[color:var(--lookbook-ink-muted)]">
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
      className="space-y-2 rounded-lg border border-[color:var(--theme-card-border)] bg-[var(--lookbook-surface)] p-3"
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
      <p className="text-xs text-[color:var(--lookbook-ink-muted)]">
        {outfit.comfortNotes}
      </p>
      {outfit.reasoningBadges.length > 0 && (
        <ul className="flex flex-wrap gap-1">
          {outfit.reasoningBadges.map((badge) => (
            <li
              key={badge.key}
              className="rounded-full border border-[color:var(--theme-card-border)] px-2 py-0.5 text-[10px] text-[color:var(--lookbook-ink-muted)]"
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
    // `text-[color:var(--lookbook-ink-muted)]` measured 4.35:1 against this card's
    // `--theme-card-bg` (a `ReadyDayCard` root, not the white `OutfitCard`
    // background `--theme-card-text`'s sibling fix at `OutfitCard` above
    // addresses), just under WCAG's 4.5:1 small-text minimum.
    // `--theme-card-text` is the token this codebase pairs with
    // `--theme-card-bg` by design (Decision 8) for exactly this reason.
    return (
      <p
        className="text-xs text-[color:var(--theme-card-text)]"
        data-testid="planner-weather-unavailable"
      >
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
      className="lookbook-metrics text-xs text-[color:var(--lookbook-ink-muted)]"
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
            className="rounded-full border border-[color:var(--theme-card-border)] px-2 py-0.5 text-[10px] text-[color:var(--lookbook-ink-muted)]"
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
          className="text-xs font-medium text-[color:var(--lookbook-danger)]"
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
      <p
        role="alert"
        aria-live="assertive"
        className="text-xs font-medium text-[color:var(--lookbook-danger)]"
      >
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
        className="space-y-2 rounded-lg border border-[color:var(--theme-card-border)] bg-[var(--lookbook-surface)] p-4"
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
      className="space-y-3 rounded-lg border border-[color:var(--theme-card-border)] bg-[var(--lookbook-surface)] p-4"
      data-testid="planner-rail-locked"
    >
      <p className="text-sm font-medium text-[color:var(--theme-card-text)]">
        {t('commerce.premium.plannerLocked.title')}
      </p>
      <a
        href="/settings"
        className="inline-block min-h-[44px] rounded-lg bg-[#C9A14A] px-4 py-2 text-xs font-semibold text-[#111111] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[color:var(--theme-primary)]"
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
      className="space-y-3 rounded-lg border border-[color:var(--theme-card-border)] bg-[var(--lookbook-surface)] p-4"
      data-testid="planner-rail-error"
    >
      <p
        role="alert"
        aria-live="assertive"
        className="text-sm font-medium text-[color:var(--lookbook-danger)]"
      >
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
  const { t } = useTranslation()
  /** True while the member's week is still being checked, for the landmark's `aria-busy`. */
  const [isChecking, setIsChecking] = useState(true)

  const dialogRef = useRef<HTMLElement | null>(null)
  const closeButtonRef = useRef<HTMLButtonElement | null>(null)
  const previousActiveElementRef = useRef<HTMLElement | null>(null)

  // Focus trap and restore, overlay only -- the rail variant is ordinary
  // in-page content and must stay in the normal tab order.
  useLayoutEffect(() => {
    if (!isOpen || variant !== 'overlay') return
    previousActiveElementRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    const releaseScrollLock = acquireScrollLock()
    closeButtonRef.current?.focus()
    const invoker = invokingElementRef?.current

    return () => {
      releaseScrollLock()
      const target =
        invoker?.isConnected === true
          ? invoker
          : previousActiveElementRef.current?.isConnected === true
            ? previousActiveElementRef.current
            : null
      target?.focus()
    }
  }, [isOpen, variant, invokingElementRef])

  // A member change remounts the week (MemberScope). In the overlay, focus inside the week
  // would fall to the page, out of the trap and out of Escape's reach: it goes to the stable
  // Close button instead. The inline rail is ordinary page content and is left alone.
  const liveOwner = useWebSessionOwner()
  const shownOwnerRef = useRef(liveOwner)
  useLayoutEffect(() => {
    if (shownOwnerRef.current === liveOwner) return
    shownOwnerRef.current = liveOwner
    if (!isOpen || variant !== 'overlay') return
    const active = document.activeElement
    if (!active || active === document.body || !dialogRef.current?.contains(active))
      closeButtonRef.current?.focus()
  }, [liveOwner, isOpen, variant])

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
      aria-busy={isChecking}
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

      {/*
        The week belongs to the member the session bridge names right now: it is keyed by that
        owner, so a change of member (or sign-out) discards the last member's week, reshuffles
        and messages in the same render. The chrome above (focus trap, scroll lock) stays put.
      */}
      <MemberScope>
        {(session) => <PlannerWeek session={session} onCheckingChange={setIsChecking} />}
      </MemberScope>
    </aside>
  )
}

/**
 * The open rail's member-owned body. Mounted only while the rail is open, so closing it
 * aborts every request it started (AC 6: one fetch per explicit open, no polling).
 */
function PlannerWeek({
  session,
  onCheckingChange,
}: {
  session: MemberSession
  onCheckingChange: (checking: boolean) => void
}) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language
  const { status, owner, retry } = session

  /*
   * The entitlement, the week and the failed-recheck marker change together in one state, so
   * every transition is applied in order to the latest value. A read that settles before React
   * commits an earlier update (a newer lock, a reshuffle) therefore sees that update, and
   * `entitled` can never be queued next to a missing week.
   */
  const [rail, setRail] = useState<RailState>({
    entitlementState: 'checking',
    plannerData: null,
    recheckFailedAt: null,
  })
  const { entitlementState, plannerData, recheckFailedAt } = rail
  const setEntitlementState = useCallback((next: EntitlementState) => {
    setRail((rail) => ({ ...rail, entitlementState: next }))
  }, [])
  const setPlannerData = useCallback(
    (
      next:
        | PlannerResponse['data']
        | null
        | ((current: PlannerResponse['data'] | null) => PlannerResponse['data'] | null)
    ) => {
      setRail((rail) => ({
        ...rail,
        plannerData: typeof next === 'function' ? next(rail.plannerData) : next,
      }))
    },
    []
  )
  const setRecheckFailedAt = useCallback((revision: number | null) => {
    setRail((rail) => ({ ...rail, recheckFailedAt: revision }))
  }, [])
  const [lockedReason, setLockedReason] = useState<LockedReason>(null)
  const [busyPlanDate, setBusyPlanDate] = useState<string | null>(null)
  const [dayErrors, setDayErrors] = useState<Record<string, string>>({})
  const [announcement, setAnnouncement] = useState<string | null>(null)

  /** Every week read in flight, so closing the rail aborts all of them, overlapping ones too. */
  const readControllersRef = useRef<Set<AbortController>>(new Set())
  const reshuffleControllersRef = useRef<Map<string, AbortController>>(new Map())
  /**
   * Advances each time a reshuffle result lands. A week read that started before it carries
   * older versions of the day, so its answer is dropped rather than undoing the reshuffle.
   */
  const weekGenerationRef = useRef(0)

  useLayoutEffect(() => {
    onCheckingChange(entitlementState === 'checking')
  }, [entitlementState, onCheckingChange])

  // Closed or handed to another member: nothing this body started may still land.
  useEffect(() => {
    const reads = readControllersRef.current
    const reshuffles = reshuffleControllersRef.current
    return () => {
      for (const controller of reads) controller.abort()
      reads.clear()
      for (const controller of reshuffles.values()) {
        controller.abort()
      }
      reshuffles.clear()
    }
  }, [])

  /**
   * A foreground read superseded by a reshuffle settles against the latest state. Only a rail
   * that still owns `checking` changes: with a week it is `entitled` again, with none it shows
   * the error (and, for a failed recheck, waits on the bridge). A newer lock, error or week
   * set meanwhile takes precedence and stays as it is.
   */
  const settleSupersededRead = useCallback((recheckRevision?: number) => {
    setRail((rail) =>
      rail.entitlementState !== 'checking'
        ? rail
        : rail.plannerData !== null
          ? { ...rail, entitlementState: 'entitled' }
          : {
              ...rail,
              entitlementState: 'error',
              recheckFailedAt: recheckRevision ?? rail.recheckFailedAt,
            }
    )
  }, [])

  /**
   * A foreground read that failed for a transient reason after a reshuffle advanced the week
   * generation is settled by `settleSupersededRead`. A lock answer, a silent read, or a read
   * no reshuffle superseded is not handled here.
   */
  const settleLateFailure = useCallback(
    (failure: unknown, generation: number, silent: boolean | undefined): boolean => {
      if (silent || generation === weekGenerationRef.current) return false
      const reason = plannerFailureReason(failure)
      const transient =
        isSessionRecheckError(failure) ||
        (reason !== 'signed_out' && reason !== 'not_entitled' && reason !== 'disabled')
      if (transient) {
        settleSupersededRead(
          isSessionRecheckError(failure) ? failure.revision : undefined
        )
      }
      return transient
    },
    [settleSupersededRead]
  )

  /** The member's week, read with their bearer; a late answer for anyone else is dropped. */
  const load = useCallback(
    async (signal: AbortSignal, options: { silent?: boolean } = {}) => {
      // The bridge publishes again once it names this member; until then nothing is asked.
      if (!isLiveOwner(owner)) return
      if (!options.silent) {
        setEntitlementState('checking')
        setRecheckFailedAt(null)
      }
      const generation = weekGenerationRef.current
      const current = () => !signal.aborted && isLiveOwner(owner)
      try {
        // A denial of a token the bridge has since rotated for this member is read again once.
        const data = await readAsMember(
          owner,
          () => getPlannerFromWeb(signal),
          (error) => plannerFailureReason(error) === 'signed_out',
          signal
        )
        if (!current()) return
        // A reshuffle landed while this read was out: its week is older than the one shown.
        // A foreground read had put the rail in `checking`; the newer week shows again.
        // `entitled` returns only with a usable week on screen; a newer lock or error state
        // (a refresh that found the planner disabled, a failed read) stays as it is.
        if (generation !== weekGenerationRef.current) {
          if (!options.silent) settleSupersededRead()
          return
        }
        setPlannerData(data)
        setEntitlementState('entitled')
        setAnnouncement(t('commerce.premium.planner.announce.ready'))
      } catch (loadError: unknown) {
        if (!current()) return
        // A foreground read that failed after a reshuffle produced a newer week must not
        // blank it; with no newer week the failure shows its error as before.
        if (settleLateFailure(loadError, generation, options.silent)) return
        if (isSessionRecheckError(loadError)) {
          // The member is not known to be signed out: the error panel with its retry, and a
          // new read once the bridge verifies them again. A silent refresh keeps the week.
          if (options.silent) return
          setEntitlementState('error')
          setPlannerData(null)
          setRecheckFailedAt(loadError.revision)
          return
        }
        const reason = plannerFailureReason(loadError)
        if (['signed_out', 'not_entitled', 'disabled'].includes(reason)) {
          setEntitlementState('locked')
          setLockedReason(reason === 'disabled' ? 'disabled' : 'not_entitled')
          setPlannerData(null)
        } else if (reason === 'missing_city') {
          setEntitlementState('missing_city')
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
    [
      owner,
      t,
      settleSupersededRead,
      settleLateFailure,
      setEntitlementState,
      setPlannerData,
      setRecheckFailedAt,
    ]
  )

  /** Starts one week read, tracked until it settles so closing the rail can abort it. */
  const startRead = useCallback(
    (options: { silent?: boolean } = {}) => {
      const controller = new AbortController()
      const reads = readControllersRef.current
      reads.add(controller)
      void load(controller.signal, options).finally(() => reads.delete(controller))
      return controller
    },
    [load]
  )
  const readAgain = useCallback(() => {
    startRead()
  }, [startRead])
  useReloadOnSessionRecheck(owner, recheckFailedAt, readAgain)

  // One fetch per open per member: a session event that names the same member again (a token
  // refresh, the end of a verification already answered) asks nothing, and a stored session
  // still under verification is `checking`, never the signed-out lock.
  useEffect(() => {
    if (status === 'checking') {
      setEntitlementState('checking')
      return
    }
    if (status === 'unavailable') {
      // Verification failed: an outage the member can retry, never the signed-out lock.
      setEntitlementState('error')
      setPlannerData(null)
      return
    }
    if (owner === null) {
      setEntitlementState('locked')
      setLockedReason(null)
      setPlannerData(null)
      return
    }
    const controller = startRead()
    return () => controller.abort()
  }, [status, owner, startRead, setEntitlementState, setPlannerData])

  // The focus listener reads the state of the latest commit. A layout effect updates it
  // inside the commit that renders the week; re-registering the listener in a passive
  // effect left a window after the week rendered in which a focus met the previous
  // listener, still holding 'checking', and refreshed nothing (PR checks run
  // 44131052026).
  const entitlementStateRef = useRef(entitlementState)
  useLayoutEffect(() => {
    entitlementStateRef.current = entitlementState
  }, [entitlementState])

  // AC 6: also refresh on screen focus while open, still no interval polling.
  useEffect(() => {
    function handleFocus() {
      if (entitlementStateRef.current !== 'entitled') return
      startRead({ silent: true })
    }
    window.addEventListener('focus', handleFocus)
    return () => window.removeEventListener('focus', handleFocus)
  }, [startRead])

  const handleReshuffle = useCallback(
    async (day: PlannerReadyDay, index: number) => {
      if (busyPlanDate !== null || !isLiveOwner(owner)) return
      setBusyPlanDate(day.planDate)
      setDayErrors((current) => {
        const next = { ...current }
        delete next[day.planDate]
        return next
      })
      const controller = new AbortController()
      reshuffleControllersRef.current.set(day.planDate, controller)
      const current = () => !controller.signal.aborted && isLiveOwner(owner)
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
        if (!current()) return
        weekGenerationRef.current += 1
        setPlannerData((existingData) =>
          existingData
            ? {
                ...existingData,
                days: existingData.days.map((existing) =>
                  existing.planDate === day.planDate ? updated : existing
                ),
              }
            : existingData
        )
        setAnnouncement(
          unchanged
            ? t('commerce.premium.planner.reshuffle.unchanged')
            : t('commerce.premium.planner.reshuffle.updated', { day: dayLabel })
        )
      } catch (reshuffleError: unknown) {
        if (!current()) return
        const reason = plannerFailureReason(reshuffleError)
        if (reason === 'conflict') {
          setDayErrors((errors) => ({
            ...errors,
            [day.planDate]: t('commerce.premium.planner.reshuffle.conflict'),
          }))
          startRead({ silent: true })
        } else if (
          reason === 'signed_out' ||
          reason === 'not_entitled' ||
          reason === 'disabled'
        ) {
          setEntitlementState('locked')
          setLockedReason(reason === 'disabled' ? 'disabled' : 'not_entitled')
          setPlannerData(null)
        } else {
          setDayErrors((errors) => ({
            ...errors,
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
    [busyPlanDate, startRead, locale, owner, t, setEntitlementState, setPlannerData]
  )

  const handleRetry = useCallback(() => {
    // A failed session check verifies again; the week is read once the member is named.
    if (status === 'unavailable') {
      retry()
      return
    }
    startRead()
  }, [startRead, retry, status])

  const days = useMemo(() => plannerData?.days ?? [], [plannerData])

  return (
    <>
      {entitlementState === 'checking' && <PlannerSkeleton />}
      {entitlementState === 'locked' && <LockedPanel reason={lockedReason} t={t} />}
      {entitlementState === 'error' && <ErrorPanel onRetry={handleRetry} t={t} />}
      {entitlementState === 'missing_city' && (
        <Link
          className="inline-flex min-h-11 items-center font-semibold underline"
          href={SET_CITY_FROM_PLANNER}
          data-testid="planner-set-city"
        >
          {getGuestPreviewStrings(locale).firstUse.setCity}
        </Link>
      )}
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
    </>
  )
}
