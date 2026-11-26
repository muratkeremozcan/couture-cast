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

// Story CC-7.9 D2: severity reads through the notice, danger and success roles in both schemes.
const DELIVERY_CLASS = {
  pending: 'bg-notice-surface text-notice-ink ring-notice-line',
  delivered: 'bg-card text-success-ink ring-success-ink',
  console_only: 'bg-card-muted text-ink ring-line-strong',
  superseded: 'bg-card-muted text-ink ring-line-strong',
} as const

const KIND_CLASS = {
  at_risk: 'bg-notice-surface text-notice-ink ring-notice-line',
  breached: 'bg-danger-surface text-danger-ink ring-danger-line',
  // An admin hand-off: the strongest neutral, so it stays apart from the two SLA warnings.
  escalated: 'bg-inverse text-on-inverse ring-inverse',
} as const

const badge =
  'inline-flex min-h-[28px] items-center rounded-md px-2 text-sm font-semibold ring-1 ring-inset'
/** Story CC-7.9 D7: a console card; its container carries `data-surface="card"`. */
const card = 'rounded-xl border border-line bg-card p-4 text-ink'

type ManualRefresh = 'idle' | 'refreshing' | 'refreshed'

function useModerationSla() {
  const [summary, setSummary] = useState<ModerationSlaSummary | null>(null)
  const [failure, setFailure] = useState<ModerationFailureReason | null>(null)
  const [busy, setBusy] = useState(false)
  // Only a refresh someone asked for speaks. A timed refresh changes nothing they did.
  const [manual, setManual] = useState<ManualRefresh>('idle')
  const inFlight = useRef<AbortController | null>(null)
  // A timed refresh can replace a manual one, so the later load settles what was asked for.
  const manualPending = useRef(false)

  const load = useCallback(async (requested = false) => {
    if (requested) manualPending.current = true
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
      if (manualPending.current) setManual('refreshed')
      manualPending.current = false
    } catch (error) {
      if (controller.signal.aborted) return
      const reason = moderationFailureReason(error)
      if (isTerminalFailure(reason)) setSummary(null)
      setFailure(reason)
      if (manualPending.current) setManual('idle')
      manualPending.current = false
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
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
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
            <p role="alert" className="rounded-md border border-line-strong p-4">
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
  return manual === 'refreshed' ? 'moderation.sla.refreshed' : ''
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
    // Story CC-7.9 D6: the top bar holds the title and the way back to the queue.
    <header className="flex flex-wrap items-start justify-between gap-3">
      <p className="text-sm text-ink-soft">{t('moderation.sla.subtitle')}</p>
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
            ? 'rounded-md border border-danger-line bg-danger-surface p-4 font-semibold text-danger-ink ring-1 ring-inset ring-danger-line'
            : 'rounded-md border border-line p-4'
        }
      >
        {healthText}
      </p>
      {channel === 'console' ? (
        <p
          data-channel={channel}
          className="rounded-md border border-notice-line bg-notice-surface p-4 text-notice-ink"
        >
          {t('moderation.sla.channelConsole')}
        </p>
      ) : null}
      {channel === 'webhook' && !stale ? (
        <p data-channel={channel} className="text-sm">
          {t('moderation.sla.channelWebhook')}
        </p>
      ) : null}
      {channel === 'push' && !stale ? (
        <p data-channel={channel} className="text-sm">
          {t('moderation.sla.channelPush')}
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
      <dt className="text-sm text-ink-soft">{label}</dt>
      <dd
        className={`text-2xl font-semibold tabular-nums ${
          emphasis && value > 0 ? 'text-danger-ink' : ''
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
    <section aria-labelledby="sla-queue" data-surface="card" className={card}>
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
    <section aria-labelledby="sla-resolution" data-surface="card" className={card}>
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
    <section aria-labelledby="sla-delivery" data-surface="card" className={card}>
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
    <section aria-labelledby="sla-screening" data-surface="card" className={card}>
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
        <p className="rounded-md border border-dashed border-line-strong p-6">
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
    <article aria-labelledby={labelId} data-surface="card" className={card}>
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
        aria-label={`${t('moderation.sla.openCase')}: ${t('moderation.queue.caseRef', { id: alert.caseId })}`}
        aria-describedby={labelId}
        className={`${moderationControl} mt-3 inline-flex items-center`}
      >
        {t('moderation.sla.openCase')}
      </Link>
    </article>
  )
}
