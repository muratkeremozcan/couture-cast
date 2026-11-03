'use client'

// Story 6.10 web owner: the time-remaining readout of a case.
// The DOM updates once a minute. Assistive technology hears only a change of SLA state.
import { useEffect, useState } from 'react'
import {
  deriveSlaState,
  type ModerationCaseSlaState,
} from '@couture/api-client/contracts/http'
import { remainingMs, useModerationTranslation } from '../../lib/moderation'

const MINUTE_MS = 60_000

export function formatDuration(
  ms: number,
  t: (key: string, options?: Record<string, unknown>) => string
): string {
  const totalMinutes = Math.max(0, Math.floor(ms / MINUTE_MS))
  const days = Math.floor(totalMinutes / 1440)
  const hours = Math.floor((totalMinutes % 1440) / 60)
  const minutes = totalMinutes % 60
  if (days > 0) return t('moderation.duration.dh', { days, hours })
  if (hours > 0) return t('moderation.duration.hm', { hours, minutes })
  return t('moderation.duration.m', { minutes })
}

export const SLA_BADGE_CLASS: Record<ModerationCaseSlaState, string> = {
  on_track:
    'bg-neutral-100 text-neutral-900 ring-neutral-400 dark:bg-neutral-800 dark:text-neutral-100 dark:ring-neutral-500',
  at_risk:
    'bg-amber-100 text-amber-950 ring-amber-700 dark:bg-amber-950 dark:text-amber-100 dark:ring-amber-500',
  breached:
    'bg-red-100 text-red-950 ring-red-800 dark:bg-red-950 dark:text-red-100 dark:ring-red-400',
  resolved:
    'bg-emerald-100 text-emerald-950 ring-emerald-800 dark:bg-emerald-950 dark:text-emerald-100 dark:ring-emerald-400',
}

export function useServerClock(dueAt: string, clockOffsetMs: number, resolved: boolean) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (resolved) return
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), MINUTE_MS)
    return () => window.clearInterval(timer)
  }, [dueAt, clockOffsetMs, resolved])
  const remaining = remainingMs(dueAt, clockOffsetMs, now)
  const state: ModerationCaseSlaState = resolved
    ? 'resolved'
    : deriveSlaState({
        status: 'open',
        dueAt: new Date(Date.parse(dueAt)),
        now: new Date(now + clockOffsetMs),
      })
  return { remaining, state }
}

export function SlaCountdown({
  dueAt,
  clockOffsetMs,
  resolved,
  announce = false,
}: {
  dueAt: string
  clockOffsetMs: number
  resolved: boolean
  /** The case view announces a state change. The queue stays silent. */
  announce?: boolean
}) {
  const { t } = useModerationTranslation()
  const { remaining, state } = useServerClock(dueAt, clockOffsetMs, resolved)
  const text =
    state === 'resolved'
      ? t('moderation.sla.resolved')
      : remaining <= 0
        ? t('moderation.sla.over', { time: formatDuration(-remaining, t) })
        : t('moderation.sla.left', { time: formatDuration(remaining, t) })
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span
        data-sla-state={state}
        className={`inline-flex min-h-[28px] items-center rounded px-2 text-sm font-semibold ring-1 ring-inset ${SLA_BADGE_CLASS[state]}`}
      >
        {t(`moderation.slaState.${state}`)}
      </span>
      <span className="text-sm tabular-nums">{text}</span>
      {announce ? (
        <span role="status" aria-live="polite" className="sr-only">
          {t(`moderation.slaState.${state}`)}
        </span>
      ) : null}
    </span>
  )
}
