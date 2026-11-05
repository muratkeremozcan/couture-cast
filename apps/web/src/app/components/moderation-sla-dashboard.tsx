'use client'

// Story 6.12 web owner: the SLA dashboard at `/moderation/sla`.
// Read-only. The API computes every count and the monitor's health, so a dead worker shows here
// with no worker running. It holds no case content and no write control.
import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  ModerationSlaRecentAlert,
  ModerationSlaSummary,
} from '@couture/api-client/contracts/http'
import {
  getModerationSlaFromWeb,
  isTerminalFailure,
  moderationFailureReason,
  useModerationTranslation,
  type ModerationFailureReason,
} from '../../lib/moderation'
import { FailureNotice, moderationControl } from './moderation-failure-notice'

/** The monitor's stale flag is computed on read, so an open page must read again to see it. */
const REFRESH_INTERVAL_MS = 60_000

const DELIVERY_CLASS = {
  pending:
    'bg-amber-100 text-amber-950 ring-amber-700 dark:bg-amber-950 dark:text-amber-100 dark:ring-amber-400',
  delivered:
    'bg-emerald-100 text-emerald-950 ring-emerald-700 dark:bg-emerald-950 dark:text-emerald-100 dark:ring-emerald-400',
  console_only:
    'bg-neutral-100 text-neutral-900 ring-neutral-400 dark:bg-neutral-800 dark:text-neutral-100 dark:ring-neutral-500',
  superseded:
    'bg-neutral-100 text-neutral-900 ring-neutral-400 dark:bg-neutral-800 dark:text-neutral-100 dark:ring-neutral-500',
} as const

const KIND_CLASS = {
  at_risk:
    'bg-amber-100 text-amber-950 ring-amber-700 dark:bg-amber-950 dark:text-amber-100 dark:ring-amber-400',
  breached:
    'bg-red-100 text-red-950 ring-red-800 dark:bg-red-950 dark:text-red-100 dark:ring-red-400',
  escalated:
    'bg-violet-100 text-violet-950 ring-violet-800 dark:bg-violet-950 dark:text-violet-100 dark:ring-violet-400',
} as const

const badge =
  'inline-flex min-h-[28px] items-center rounded px-2 text-sm font-semibold ring-1 ring-inset'
const card = 'rounded-lg border border-neutral-400 p-4 dark:border-neutral-600'

type ManualRefresh = 'idle' | 'refreshing' | 'refreshed'

function useModerationSla() {
  const [summary, setSummary] = useState<ModerationSlaSummary | null>(null)
  const [failure, setFailure] = useState<ModerationFailureReason | null>(null)
  const [busy, setBusy] = useState(false)
  // Only a refresh someone asked for speaks. A timed refresh changes nothing they did.
  const [manual, setManual] = useState<ManualRefresh>('idle')
  const inFlight = useRef<AbortController | null>(null)

  const load = useCallback(async (requested = false) => {
    inFlight.current?.abort()
    const controller = new AbortController()
    inFlight.current = controller
    setBusy(true)
    if (requested) setManual('refreshing')
    try {
      const next = await getModerationSlaFromWeb(controller.signal)
      if (controller.signal.aborted) return
      setSummary(next)
      setFailure(null)
      if (requested) setManual('refreshed')
    } catch (error) {
      if (controller.signal.aborted) return
      const reason = moderationFailureReason(error)
      if (isTerminalFailure(reason)) setSummary(null)
      setFailure(reason)
      if (requested) setManual('idle')
    } finally {
      if (!controller.signal.aborted) setBusy(false)
    }
  }, [])

  useEffect(() => {
    void load()
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void load()
    }, REFRESH_INTERVAL_MS)
    return () => {
      clearInterval(timer)
      inFlight.current?.abort()
    }
  }, [load])

  return { summary, failure, busy, manual, load }
}

function useFormatTime() {
  const { i18n } = useModerationTranslation()
  return useCallback(
    (iso: string) =>
      new Intl.DateTimeFormat(i18n.language || 'en-US', {
        // The zone tells apart the two hours a DST change repeats. `dateStyle` cannot combine with
        // `timeZoneName`, so the parts are spelled out.
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        timeZoneName: 'short',
      }).format(new Date(iso)),
    [i18n.language]
  )
}

export function ModerationSlaDashboard() {
  const { t } = useModerationTranslation()
  const { summary, failure, busy, manual, load } = useModerationSla()
  const terminal = failure !== null && isTerminalFailure(failure)
  const key = statusKey(summary, manual)
  const status = key ? t(key) : ''

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <SlaHeader
        canRefresh={summary !== null}
        busy={busy}
        onRefresh={() => void load(true)}
      />

      <p role="status" aria-live="polite" className="sr-only">
        {status}
      </p>

      {terminal && failure ? (
        <FailureNotice reason={failure} scope="sla" />
      ) : (
        <>
          {!summary && !failure ? (
            <p aria-busy="true">{t('moderation.state.loading')}</p>
          ) : null}
          {!summary && failure ? (
            <FailureNotice
              reason={failure}
              scope="sla"
              busy={busy}
              onRetry={() => void load(true)}
            />
          ) : null}
          {summary && failure ? (
            <p role="alert" className="rounded border border-neutral-500 p-4">
              {t('moderation.state.stale')}
            </p>
          ) : null}
          {summary ? <SlaBody summary={summary} /> : null}
        </>
      )}
    </div>
  )
}

/**
 * What a screen reader hears: a refresh someone asked for, and a monitor that stopped. A timed
 * refresh of a healthy page says nothing, so an open page stays quiet between real changes.
 */
function statusKey(summary: ModerationSlaSummary | null, manual: ManualRefresh): string {
  if (manual === 'refreshing') return 'moderation.queue.refreshing'
  if (summary && !summary.monitor.lastSweepAt) return 'moderation.sla.monitorNever'
  if (summary?.monitor.stale) return 'moderation.sla.monitorStaleShort'
  return manual === 'refreshed' ? 'moderation.queue.refreshed' : ''
}

function SlaHeader({
  canRefresh,
  busy,
  onRefresh,
}: {
  canRefresh: boolean
  busy: boolean
  onRefresh: () => void
}) {
  const { t } = useModerationTranslation()
  return (
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex flex-col gap-1">
        <h1 className="text-3xl font-semibold">{t('moderation.sla.title')}</h1>
        <p className="text-sm text-neutral-700 dark:text-neutral-300">
          {t('moderation.sla.subtitle')}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {canRefresh ? (
          <button
            type="button"
            className={moderationControl}
            aria-disabled={busy}
            aria-busy={busy}
            onClick={() => {
              if (!busy) onRefresh()
            }}
          >
            {t(busy ? 'moderation.queue.refreshing' : 'moderation.queue.refresh')}
          </button>
        ) : null}
        <Link
          href="/moderation"
          className={`${moderationControl} inline-flex items-center`}
        >
          {t('moderation.backToQueue')}
        </Link>
      </div>
    </header>
  )
}

function SlaBody({ summary }: { summary: ModerationSlaSummary }) {
  return (
    <>
      <MonitorPanel summary={summary} />
      <div className="grid gap-4 md:grid-cols-2">
        <QueuePanel summary={summary} />
        <ResolutionPanel summary={summary} />
        <DeliveryPanel summary={summary} />
        <ScreeningPanel summary={summary} />
      </div>
      <RecentAlerts alerts={summary.recentAlerts} />
    </>
  )
}

function MonitorPanel({ summary }: { summary: ModerationSlaSummary }) {
  const { t } = useModerationTranslation()
  const formatTime = useFormatTime()
  const { lastSweepAt, stale, channel } = summary.monitor
  const healthText = !lastSweepAt
    ? t('moderation.sla.monitorNever')
    : stale
      ? t('moderation.sla.monitorStale', { time: formatTime(lastSweepAt) })
      : t('moderation.sla.monitorOk', { time: formatTime(lastSweepAt) })
  return (
    <section aria-labelledby="sla-monitor" className="flex flex-col gap-3">
      <h2 id="sla-monitor" className="sr-only">
        {t('moderation.sla.monitorTitle')}
      </h2>
      <p
        data-monitor-stale={stale}
        className={
          stale
            ? 'rounded border border-red-800 bg-red-100 p-4 font-semibold text-red-950 ring-1 ring-inset ring-red-800 dark:border-red-400 dark:bg-red-950 dark:text-red-100 dark:ring-red-400'
            : 'rounded border border-neutral-400 p-4 dark:border-neutral-600'
        }
      >
        {healthText}
      </p>
      {channel === 'console' ? (
        <p
          data-channel={channel}
          className="rounded border border-amber-700 bg-amber-100 p-4 text-amber-950 dark:border-amber-400 dark:bg-amber-950 dark:text-amber-100"
        >
          {t('moderation.sla.channelConsole')}
        </p>
      ) : null}
      {channel === 'webhook' && !stale ? (
        <p data-channel={channel} className="text-sm">
          {t('moderation.sla.channelWebhook')}
        </p>
      ) : null}
    </section>
  )
}

function Metric({
  label,
  value,
  emphasis,
}: {
  label: string
  value: number
  emphasis?: boolean
}) {
  return (
    <div className="flex flex-col">
      <dt className="text-sm text-neutral-700 dark:text-neutral-300">{label}</dt>
      <dd
        className={`text-2xl font-semibold tabular-nums ${
          emphasis && value > 0 ? 'text-red-800 dark:text-red-300' : ''
        }`}
      >
        {value}
      </dd>
    </div>
  )
}

const metricGrid = 'mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4'

function QueuePanel({ summary }: { summary: ModerationSlaSummary }) {
  const { t } = useModerationTranslation()
  const formatTime = useFormatTime()
  const { queue } = summary
  return (
    <section aria-labelledby="sla-queue" className={card}>
      <h2 id="sla-queue" className="text-lg font-semibold">
        {t('moderation.sla.queueTitle')}
      </h2>
      <dl className={metricGrid}>
        <Metric label={t('moderation.slaState.on_track')} value={queue.onTrack} />
        <Metric label={t('moderation.slaState.at_risk')} value={queue.atRisk} />
        <Metric
          label={t('moderation.slaState.breached')}
          value={queue.breached}
          emphasis
        />
        <Metric label={t('moderation.sla.escalated')} value={queue.escalated} />
      </dl>
      <p className="mt-3 text-sm">
        {queue.oldestDueAt
          ? t('moderation.sla.oldestDue', { time: formatTime(queue.oldestDueAt) })
          : t('moderation.sla.noOpen')}
      </p>
    </section>
  )
}

function ResolutionPanel({ summary }: { summary: ModerationSlaSummary }) {
  const { t } = useModerationTranslation()
  const { resolution } = summary
  return (
    <section aria-labelledby="sla-resolution" className={card}>
      <h2 id="sla-resolution" className="text-lg font-semibold">
        {t('moderation.sla.resolutionTitle', { days: resolution.windowDays })}
      </h2>
      <dl className={metricGrid}>
        <Metric label={t('moderation.sla.resolved_count')} value={resolution.resolved} />
        <Metric label={t('moderation.sla.withinSla')} value={resolution.withinSla} />
        <Metric label={t('moderation.sla.late')} value={resolution.late} emphasis />
      </dl>
    </section>
  )
}

function DeliveryPanel({ summary }: { summary: ModerationSlaSummary }) {
  const { t } = useModerationTranslation()
  const { alerts } = summary
  return (
    <section aria-labelledby="sla-delivery" className={card}>
      <h2 id="sla-delivery" className="text-lg font-semibold">
        {t('moderation.sla.deliveryTitle')}
      </h2>
      <dl className={metricGrid}>
        <Metric label={t('moderation.sla.delivery.pending')} value={alerts.pending} />
        <Metric label={t('moderation.sla.failing')} value={alerts.failing} emphasis />
        <Metric
          label={t('moderation.sla.delivery.console_only')}
          value={alerts.consoleOnly}
        />
      </dl>
    </section>
  )
}

function ScreeningPanel({ summary }: { summary: ModerationSlaSummary }) {
  const { t } = useModerationTranslation()
  const formatTime = useFormatTime()
  const { oldestPendingReviewAt } = summary.screening
  return (
    <section aria-labelledby="sla-screening" className={card}>
      <h2 id="sla-screening" className="text-lg font-semibold">
        {t('moderation.sla.screeningTitle')}
      </h2>
      <p className="mt-3">
        {oldestPendingReviewAt
          ? t('moderation.sla.screeningOldest', {
              time: formatTime(oldestPendingReviewAt),
            })
          : t('moderation.sla.screeningClear')}
      </p>
    </section>
  )
}

function RecentAlerts({ alerts }: { alerts: ModerationSlaRecentAlert[] }) {
  const { t } = useModerationTranslation()
  return (
    <section aria-labelledby="sla-recent" className="flex flex-col gap-3">
      <h2 id="sla-recent" className="text-lg font-semibold">
        {t('moderation.sla.recentTitle')}
      </h2>
      {alerts.length === 0 ? (
        <p className="rounded border border-dashed border-neutral-500 p-6">
          {t('moderation.sla.recentEmpty')}
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {alerts.map((alert) => (
            <li key={alert.id}>
              <AlertRow alert={alert} />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function AlertRow({ alert }: { alert: ModerationSlaRecentAlert }) {
  const { t } = useModerationTranslation()
  const formatTime = useFormatTime()
  const labelId = `sla-alert-${alert.id}`
  return (
    <article aria-labelledby={labelId} className={card}>
      <div className="flex flex-wrap items-center gap-2">
        <span id={labelId} className={`${badge} ${KIND_CLASS[alert.kind]}`}>
          {t(`moderation.sla.alertKind.${alert.kind}`)}
        </span>
        <span className={`${badge} ${DELIVERY_CLASS[alert.delivery]}`}>
          {t(`moderation.sla.delivery.${alert.delivery}`)}
        </span>
        <span className="text-sm">
          {t('moderation.riskLabel', { risk: t(`moderation.risk.${alert.risk}`) })}
          {' / '}
          {t(`moderation.source.${alert.source}`)}
        </span>
      </div>
      <dl className="mt-3 grid gap-1 text-sm sm:grid-cols-2">
        <div>
          <dt className="inline">{t('moderation.sla.detected')} </dt>
          <dd className="inline tabular-nums">{formatTime(alert.detectedAt)}</dd>
        </div>
        <div>
          <dt className="inline">{t('moderation.sla.due')} </dt>
          <dd className="inline tabular-nums">{formatTime(alert.slaDueAt)}</dd>
        </div>
        {alert.deliveredAt ? (
          <div>
            <dt className="inline">{t('moderation.sla.deliveredAt')} </dt>
            <dd className="inline tabular-nums">{formatTime(alert.deliveredAt)}</dd>
          </div>
        ) : null}
        {alert.lastErrorCode ? (
          <div>
            <dt className="inline">{t('moderation.sla.lastError')} </dt>
            <dd className="inline">
              {t(`moderation.sla.failure.${alert.lastErrorCode}`)}
              {' ('}
              {t('moderation.sla.attempts', { count: alert.attempts })}
              {')'}
            </dd>
          </div>
        ) : null}
      </dl>
      <Link
        href={`/moderation/cases/${encodeURIComponent(alert.caseId)}`}
        aria-describedby={labelId}
        className={`${moderationControl} mt-3 inline-flex items-center`}
      >
        {t('moderation.sla.openCase')}
      </Link>
    </article>
  )
}
