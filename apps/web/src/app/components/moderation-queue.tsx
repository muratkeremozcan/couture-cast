'use client'

// Story 6.10 web owner: the moderator queue at `/moderation`.
// Read-only. The API orders the cases; this view pages them, dedupes by caseId and never reorders.
import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ModerationCaseSummary } from '@couture/api-client/contracts/http'
import {
  useModerationTranslation,
  listModerationCasesFromWeb,
  moderationFailureReason,
  type ModerationFailureReason,
  type ModerationQueueFilters,
} from '../../lib/moderation'
import { ModerationFilters } from './moderation-filters'
import { PlainText } from './moderation-plain-text'
import { SlaCountdown } from './moderation-sla-countdown'

const RISK_CLASS = {
  high: 'bg-red-100 text-red-950 ring-red-800 dark:bg-red-950 dark:text-red-100 dark:ring-red-400',
  medium:
    'bg-amber-100 text-amber-950 ring-amber-700 dark:bg-amber-950 dark:text-amber-100 dark:ring-amber-500',
  low: 'bg-neutral-100 text-neutral-900 ring-neutral-400 dark:bg-neutral-800 dark:text-neutral-100 dark:ring-neutral-500',
} as const

const control =
  'min-h-[44px] min-w-[44px] rounded border border-neutral-500 px-4 py-2 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus-essential)]'

type Phase = 'loading' | 'ready' | 'failed'

function useModerationQueue(filters: ModerationQueueFilters) {
  const [items, setItems] = useState<ModerationCaseSummary[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [offset, setOffset] = useState(0)
  const [phase, setPhase] = useState<Phase>('loading')
  const [failure, setFailure] = useState<ModerationFailureReason | null>(null)
  const [stale, setStale] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const countRef = useRef(0)
  countRef.current = items.length

  const load = useCallback(async (next: ModerationQueueFilters, after: string | null) => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    const more = after !== null
    if (more) setLoadingMore(true)
    try {
      const page = await listModerationCasesFromWeb({
        filters: next,
        cursor: after,
        signal: controller.signal,
      })
      if (controller.signal.aborted) return
      setItems((current) => {
        const base = more ? current : []
        const seen = new Set(base.map((item) => item.caseId))
        return [...base, ...page.items.filter((item) => !seen.has(item.caseId))]
      })
      setCursor(page.nextCursor)
      setOffset(page.clockOffsetMs)
      setPhase('ready')
      setFailure(null)
      setStale(false)
    } catch (error) {
      if (controller.signal.aborted) return
      setFailure(moderationFailureReason(error))
      // A failure after a good load keeps the list and marks it stale.
      if (more || countRef.current > 0) setStale(true)
      else setPhase('failed')
    } finally {
      if (!controller.signal.aborted) setLoadingMore(false)
    }
  }, [])

  useEffect(() => {
    setItems([])
    setCursor(null)
    setPhase('loading')
    void load(filters, null)
    return () => abortRef.current?.abort()
  }, [filters, load])

  return { items, cursor, offset, phase, failure, stale, loadingMore, load }
}

export function ModerationQueueView() {
  const { t } = useModerationTranslation()
  const [filters, setFilters] = useState<ModerationQueueFilters>({ status: 'open' })
  const { items, cursor, offset, phase, failure, stale, loadingMore, load } =
    useModerationQueue(filters)
  const retry = () => void load(filters, null)

  const terminal = phase === 'failed' && failure !== null && failure !== 'unavailable'
  const filtersActive = Boolean(
    filters.source || filters.locale || filters.risk || filters.sla
  )

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-3xl font-semibold">{t('moderation.title')}</h1>
        <p className="text-sm text-neutral-700 dark:text-neutral-300">
          {t('moderation.subtitle')}
        </p>
      </header>

      {terminal ? (
        <p role="alert" className="rounded border border-neutral-500 p-4">
          {t(`moderation.state.${failure}`)}
        </p>
      ) : (
        <>
          <ModerationFilters value={filters} onChange={setFilters} />
          <p role="status" aria-live="polite" className="text-sm">
            {phase === 'ready'
              ? t('moderation.queue.count', { count: items.length })
              : ''}
          </p>
          <QueueNotices phase={phase} stale={stale} onRetry={retry} />
          {phase === 'ready' && items.length === 0 ? (
            <p className="rounded border border-dashed border-neutral-500 p-6">
              {t(
                filtersActive
                  ? 'moderation.queue.filteredEmpty'
                  : 'moderation.queue.empty'
              )}
            </p>
          ) : null}
          <QueueList
            items={items}
            offset={offset}
            ready={phase === 'ready'}
            cursor={cursor}
            loadingMore={loadingMore}
            onRefresh={retry}
            onMore={() => void load(filters, cursor)}
          />
        </>
      )}
    </div>
  )
}

function QueueList({
  items,
  offset,
  ready,
  cursor,
  loadingMore,
  onRefresh,
  onMore,
}: {
  items: ModerationCaseSummary[]
  offset: number
  ready: boolean
  cursor: string | null
  loadingMore: boolean
  onRefresh: () => void
  onMore: () => void
}) {
  const { t } = useModerationTranslation()
  if (items.length === 0) return null
  return (
    <>
      <ol aria-label={t('moderation.queue.listLabel')} className="flex flex-col gap-3">
        {items.map((item) => (
          <li key={item.caseId}>
            <CaseRow item={item} clockOffsetMs={offset} />
          </li>
        ))}
      </ol>
      {ready ? (
        <div className="flex flex-wrap gap-3">
          <button type="button" className={control} onClick={onRefresh}>
            {t('moderation.queue.refresh')}
          </button>
          {cursor ? (
            <button
              type="button"
              className={control}
              disabled={loadingMore}
              onClick={onMore}
            >
              {t(
                loadingMore ? 'moderation.queue.loadingMore' : 'moderation.queue.loadMore'
              )}
            </button>
          ) : null}
        </div>
      ) : null}
    </>
  )
}

function QueueNotices({
  phase,
  stale,
  onRetry,
}: {
  phase: Phase
  stale: boolean
  onRetry: () => void
}) {
  const { t } = useModerationTranslation()
  return (
    <>
      {phase === 'loading' ? (
        <p aria-busy="true">{t('moderation.state.loading')}</p>
      ) : null}
      {phase === 'failed' ? (
        <div
          role="alert"
          className="flex flex-col items-start gap-3 rounded border border-red-800 p-4"
        >
          <p>{t('moderation.state.unavailable')}</p>
          <button type="button" className={control} onClick={onRetry}>
            {t('moderation.state.retry')}
          </button>
        </div>
      ) : null}
      {stale ? (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-3 rounded border border-amber-700 p-3 text-sm"
        >
          <p>{t('moderation.state.stale')}</p>
          <button type="button" className={control} onClick={onRetry}>
            {t('moderation.state.retry')}
          </button>
        </div>
      ) : null}
    </>
  )
}

function CaseRow({
  item,
  clockOffsetMs,
}: {
  item: ModerationCaseSummary
  clockOffsetMs: number
}) {
  const { t } = useModerationTranslation()
  return (
    <article
      aria-labelledby={`case-${item.caseId}`}
      className="relative rounded-lg border border-neutral-400 bg-white p-4 text-neutral-900 focus-within:outline focus-within:outline-2 focus-within:outline-[color:var(--focus-essential)] dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`inline-flex min-h-[28px] items-center rounded px-2 text-sm font-semibold ring-1 ring-inset ${RISK_CLASS[item.risk]}`}
        >
          {t('moderation.riskLabel', { risk: t(`moderation.risk.${item.risk}`) })}
        </span>
        <SlaCountdown
          dueAt={item.slaDueAt}
          clockOffsetMs={clockOffsetMs}
          resolved={item.status === 'resolved'}
        />
      </div>
      <h2 id={`case-${item.caseId}`} className="mt-3 text-lg font-semibold">
        <Link
          href={`/moderation/cases/${encodeURIComponent(item.caseId)}`}
          className="rounded after:absolute after:inset-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus-essential)]"
        >
          {t('moderation.queue.caseTitle', {
            source: t(`moderation.source.${item.source}`),
          })}
        </Link>
      </h2>
      {item.excerpt ? (
        <p className="mt-1 line-clamp-2 text-sm">
          <PlainText value={item.excerpt} />
        </p>
      ) : null}
      <p className="mt-2 text-sm text-neutral-700 dark:text-neutral-300">
        {t('moderation.queue.reports', { count: item.reportCount })}
        {' · '}
        {item.reasons.map((reason) => t(`moderation.reason.${reason}`)).join(', ')}
        {item.locale ? ` · ${item.locale}` : ''}
        {item.hasFinding ? ` · ${t('moderation.queue.finding')}` : ''}
      </p>
    </article>
  )
}
