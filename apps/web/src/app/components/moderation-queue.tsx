'use client'

// Story 6.10 web owner: the moderator queue at `/moderation`.
// Read-only. The API orders the cases; this view pages them, dedupes by caseId and never reorders.
import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ModerationCaseSummary } from '@couture/api-client/contracts/http'
import {
  isTerminalFailure,
  listModerationCasesFromWeb,
  moderationFailureReason,
  useModerationTranslation,
  type ModerationFailureReason,
  type ModerationQueueFilters,
} from '../../lib/moderation'
import { FailureNotice, moderationControl } from './moderation-failure-notice'
import { ModerationFilters } from './moderation-filters'
import { PlainText } from './moderation-plain-text'
import { SlaCountdown } from './moderation-sla-countdown'

const RISK_CLASS = {
  high: 'bg-red-100 text-red-950 ring-red-800 dark:bg-red-950 dark:text-red-100 dark:ring-red-400',
  medium:
    'bg-amber-100 text-amber-950 ring-amber-700 dark:bg-amber-950 dark:text-amber-100 dark:ring-amber-500',
  low: 'bg-neutral-100 text-neutral-900 ring-neutral-400 dark:bg-neutral-800 dark:text-neutral-100 dark:ring-neutral-500',
} as const

type Phase = 'loading' | 'ready' | 'failed'
const REFRESH_ID = 'moderation-refresh'

/** Where focus goes after Load more: the first new case, else Refresh once the list has ended. */
function focusTarget(
  added: ModerationCaseSummary[],
  nextCursor: string | null
): string | null {
  if (added[0]) return `case-link-${added[0].caseId}`
  return nextCursor === null ? REFRESH_ID : null
}

function useModerationQueue(filters: ModerationQueueFilters) {
  const [items, setItems] = useState<ModerationCaseSummary[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [offset, setOffset] = useState(0)
  const [phase, setPhase] = useState<Phase>('loading')
  const [failure, setFailure] = useState<ModerationFailureReason | null>(null)
  const [stale, setStale] = useState(false)
  // A failed Load more retries its own cursor. Any other stale state retries from the first page.
  const [retryMore, setRetryMore] = useState(false)
  const [busy, setBusy] = useState<'refresh' | 'more' | null>(null)
  const [refreshed, setRefreshed] = useState(false)
  const [focus, setFocus] = useState<{ id: string; at: number } | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const itemsRef = useRef<ModerationCaseSummary[]>([])
  const countRef = useRef(0)
  countRef.current = items.length

  const load = useCallback(
    async (next: ModerationQueueFilters, after: string | null, manual = false) => {
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller
      const more = after !== null
      if (more) setBusy('more')
      else if (manual) setBusy('refresh')
      try {
        const page = await listModerationCasesFromWeb({
          filters: next,
          cursor: after,
          signal: controller.signal,
        })
        if (controller.signal.aborted) return
        const base = more ? itemsRef.current : []
        const seen = new Set(base.map((item) => item.caseId))
        const added = page.items.filter((item) => !seen.has(item.caseId))
        itemsRef.current = [...base, ...added]
        setItems(itemsRef.current)
        // The first new row takes focus, so a Load more that vanished or disabled never strands it.
        // A page of only known cases that ends the list sends focus to Refresh, the next stable control.
        const target = more ? focusTarget(added, page.nextCursor) : null
        setFocus(target ? { id: target, at: Date.now() } : null)
        setRefreshed(manual && !more)
        setCursor(page.nextCursor)
        setOffset(page.clockOffsetMs)
        setPhase('ready')
        setFailure(null)
        setStale(false)
        setRetryMore(false)
      } catch (error) {
        if (controller.signal.aborted) return
        const reason = queueReason(moderationFailureReason(error))
        setFailure(reason)
        if (isTerminalFailure(reason)) {
          // Access is gone: no case data may stay on screen.
          itemsRef.current = []
          setItems([])
          setCursor(null)
          setStale(false)
          setRetryMore(false)
          setPhase('failed')
        } else if (more || countRef.current > 0) {
          setStale(true)
          // The cursor is stateless and does not expire, so only an invalid cursor sends the moderator back.
          setRetryMore(more && reason !== 'invalid_cursor')
        } else {
          setPhase('failed')
        }
      } finally {
        if (!controller.signal.aborted) setBusy(null)
      }
    },
    []
  )
  useEffect(() => {
    itemsRef.current = []
    setItems([])
    setCursor(null)
    setRetryMore(false)
    setStale(false)
    setFailure(null)
    setRefreshed(false)
    setFocus(null)
    setPhase('loading')
    void load(filters, null)
    return () => abortRef.current?.abort()
  }, [filters, load])

  return {
    items,
    cursor,
    offset,
    phase,
    failure,
    stale,
    retryMore,
    busy,
    refreshed,
    focus,
    load,
  }
}

/** Any choice beyond the default open queue counts, so an empty page says no cases match. */
function hasActiveFilter(filters: ModerationQueueFilters): boolean {
  return Boolean(
    filters.status !== 'open' ||
      filters.source ||
      filters.locale ||
      filters.risk ||
      filters.sla
  )
}

function queueStatus(
  t: (key: string, options?: Record<string, unknown>) => string,
  phase: Phase,
  refreshed: boolean,
  count: number
): string {
  if (phase !== 'ready') return ''
  return t(refreshed ? 'moderation.queue.refreshed' : 'moderation.queue.count', { count })
}

export function ModerationQueueView() {
  const { t } = useModerationTranslation()
  const [filters, setFilters] = useState<ModerationQueueFilters>({ status: 'open' })
  const queue = useModerationQueue(filters)
  const {
    items,
    cursor,
    offset,
    phase,
    failure,
    stale,
    retryMore,
    busy,
    refreshed,
    load,
  } = queue
  const refresh = () => {
    if (busy === null) void load(filters, null, true)
  }
  const more = () => {
    if (busy === null && cursor) void load(filters, cursor)
  }

  useEffect(() => {
    if (queue.focus) document.getElementById(queue.focus.id)?.focus()
  }, [queue.focus])

  // Access reasons replace the whole console. An invalid filter keeps the filters visible so it can be fixed.
  const terminal = failure !== null && isTerminalFailure(failure)
  const filtersActive = hasActiveFilter(filters)
  const status = queueStatus(t, phase, refreshed, items.length)

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-3xl font-semibold">{t('moderation.title')}</h1>
        <p className="text-sm text-neutral-700 dark:text-neutral-300">
          {t('moderation.subtitle')}
        </p>
      </header>

      {terminal && failure ? (
        <FailureNotice reason={failure} />
      ) : (
        <>
          <ModerationFilters value={filters} onChange={setFilters} />
          <p role="status" aria-live="polite" className="text-sm">
            {status}
          </p>
          {phase === 'loading' ? (
            <p aria-busy="true">{t('moderation.state.loading')}</p>
          ) : null}
          {phase === 'failed' && failure ? (
            <FailureNotice
              reason={failure}
              busy={busy !== null}
              onRetry={() => void load(filters, null, true)}
            />
          ) : null}
          {stale && failure ? (
            <StaleNotice
              failure={failure}
              busy={busy !== null}
              onRetry={retryMore && cursor ? more : refresh}
            />
          ) : null}
          <QueueEmpty
            show={phase === 'ready' && items.length === 0}
            filtered={filtersActive}
          />
          <QueueList
            items={items}
            offset={offset}
            ready={phase === 'ready'}
            cursor={cursor}
            busy={busy}
            onRefresh={refresh}
            onMore={more}
          />
        </>
      )}
    </div>
  )
}

function QueueEmpty({ show, filtered }: { show: boolean; filtered: boolean }) {
  const { t } = useModerationTranslation()
  if (!show) return null
  return (
    <p className="rounded border border-dashed border-neutral-500 p-6">
      {t(filtered ? 'moderation.queue.filteredEmpty' : 'moderation.queue.empty')}
    </p>
  )
}

function StaleNotice({
  failure,
  busy,
  onRetry,
}: {
  failure: ModerationFailureReason
  busy: boolean
  onRetry: () => void
}) {
  const { t } = useModerationTranslation()
  const specific = failure === 'invalid_cursor' || failure === 'rate_limited'
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center gap-3 rounded border border-amber-700 p-3 text-sm"
    >
      <p>{t(specific ? `moderation.state.${failure}` : 'moderation.state.stale')}</p>
      <button
        type="button"
        className={moderationControl}
        aria-disabled={busy}
        onClick={() => {
          if (!busy) onRetry()
        }}
      >
        {t(busy ? 'moderation.state.retrying' : 'moderation.state.retry')}
      </button>
    </div>
  )
}

/** A queue read has no case to be missing, so a 404 here is a server fault. */
function queueReason(reason: ModerationFailureReason): ModerationFailureReason {
  return reason === 'not_found' ? 'unavailable' : reason
}

function QueueList({
  items,
  offset,
  ready,
  cursor,
  busy,
  onRefresh,
  onMore,
}: {
  items: ModerationCaseSummary[]
  offset: number
  ready: boolean
  cursor: string | null
  busy: 'refresh' | 'more' | null
  onRefresh: () => void
  onMore: () => void
}) {
  const { t } = useModerationTranslation()
  if (items.length === 0 && !ready) return null
  return (
    <>
      {items.length > 0 ? (
        <ol aria-label={t('moderation.queue.listLabel')} className="flex flex-col gap-3">
          {items.map((item) => (
            <li key={item.caseId}>
              <CaseRow item={item} clockOffsetMs={offset} />
            </li>
          ))}
        </ol>
      ) : null}
      {ready ? (
        <div className="flex flex-wrap gap-3">
          <button
            id={REFRESH_ID}
            type="button"
            className={moderationControl}
            aria-disabled={busy !== null}
            aria-busy={busy === 'refresh'}
            onClick={onRefresh}
          >
            {t(
              busy === 'refresh'
                ? 'moderation.queue.refreshing'
                : 'moderation.queue.refresh'
            )}
          </button>
          {cursor ? (
            <button
              type="button"
              className={moderationControl}
              aria-disabled={busy !== null}
              aria-busy={busy === 'more'}
              onClick={onMore}
            >
              {t(
                busy === 'more'
                  ? 'moderation.queue.loadingMore'
                  : 'moderation.queue.loadMore'
              )}
            </button>
          ) : null}
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
          id={`case-link-${item.caseId}`}
          aria-labelledby={`case-link-${item.caseId} case-hint-${item.caseId} case-ref-${item.caseId}`}
          href={`/moderation/cases/${encodeURIComponent(item.caseId)}`}
          className="rounded after:absolute after:inset-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus-essential)]"
        >
          {t('moderation.queue.caseTitle', {
            source: t(`moderation.source.${item.source}`),
          })}
        </Link>
      </h2>
      {/* The excerpt and the case id complete the link name, so two cases never share one, even with the same caption. */}
      {item.excerpt ? (
        <p id={`case-hint-${item.caseId}`} className="mt-1 line-clamp-2 text-sm">
          <PlainText value={item.excerpt} />
        </p>
      ) : null}
      <span id={`case-ref-${item.caseId}`} className="sr-only">
        {t('moderation.queue.caseRef', { id: item.caseId })}
      </span>
      <p className="mt-2 text-sm text-neutral-700 dark:text-neutral-300">
        {t('moderation.queue.reports', { count: item.reportCount })}
        {' · '}
        {item.reasons.map((reason) => t(`moderation.reason.${reason}`)).join(', ')}
        {item.locale ? ` · ${item.locale}` : ''}
        {item.hasFinding ? ` · ${t('moderation.queue.finding')}` : ''}
        {item.escalated ? ` · ${t('moderation.queue.escalated')}` : ''}
      </p>
    </article>
  )
}
