// Story CC-7.12 owner: the Looks tab with Saved, Ideas and Plan segments (D1). Saved is one
// newest-first grid of saved looks and capsules with All, Today and Capsules filters (D2 to D4),
// Ideas shows the sample looks (D9) and Plan holds the planner with the free preview (D10). The
// open segment and filter live in the address, so View, deep links, back and the redirects need
// no other state.
// Learning path Step 69: Looks tab for saved looks, ideas and plans.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-69-looks-tab-for-saved-looks-ideas-and-plans
'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react'
import { I18nextProvider, useTranslation } from 'react-i18next'
import type {
  OutfitCapsuleContract,
  SavedLookContract,
} from '@couture/api-client/contracts/http'
import {
  EMPTY_LOOKS_FEED_SOURCE,
  LOOKS_FILTERS,
  LOOKS_SEGMENTS,
  looksIdeas,
  mergeLooksFeed,
  parseLooksFilter,
  parseLooksSegment,
  type LooksFeedSource,
  type LooksFilter,
  type LooksSegment,
} from '@couture/utils'
import { getI18n } from '../../i18n'
import {
  listSavedLooksPageFromWeb,
  subscribeSavedLooksChanged,
} from '../../lib/saved-looks'
import { listCapsulesFromWeb, resolveCurrentUserId } from '../../lib/wardrobe'
import {
  currentWebSessionOwner,
  currentWebSessionScope,
  useHydrating,
  useWebSessionOwner,
} from '../../lib/use-web-session'
import { screenSnapshot } from '../../lib/screen-snapshot'
import { useRetryOnVerifiedSession } from '../../lib/session-retry'
import { AppPage, APP_MAIN_NARROW_CLASS } from './app-page'
import { AppTopBar } from './app-top-bar'
import { CapsuleTile, IdeaTile, LooksTileGrid, SavedLookTile } from './looks/looks-tile'
import { looksHref, savedLookHref } from './looks/looks-address'
import { NavRow } from './nav-row'
import { PlannerRail } from './planner-rail'
import { ScreenGate } from './screen-gate'
import { StickyBottomNav } from './sticky-bottom-nav'

const PAGE_SIZE = 50
/** The query the old Home drawer link carried; the redirect passes it through. */
const LEGACY_PLANNER_QUERY = 'planner'

type Sources = {
  looks: LooksFeedSource<SavedLookContract>
  capsules: LooksFeedSource<OutfitCapsuleContract>
}

const UNREAD: LooksFeedSource<never> = { items: [], total: 0, loaded: false }

/** What each filter reads (P2): Today and Capsules read one list, merged pages are never filtered. */
function initialSources(filter: LooksFilter): Sources {
  return {
    looks: filter === 'capsules' ? EMPTY_LOOKS_FEED_SOURCE : UNREAD,
    capsules: filter === 'today' ? EMPTY_LOOKS_FEED_SOURCE : UNREAD,
  }
}

type FeedState = Sources & { error: string | null; settled: boolean }

/** Snapshot part per filter (P9): both sources, under the session scope. */
const snapshotPart = (filter: LooksFilter) => `feed:${filter}`

function appendUnique<T extends { id: string }>(items: readonly T[], page: readonly T[]) {
  const seen = new Set(items.map((item) => item.id))
  return [...items, ...page.filter((item) => !seen.has(item.id))]
}

/**
 * One filter's feed: both lists in `created_desc` order, page by page, merged by
 * `mergeLooksFeed`. A read for a session scope the tab no longer holds is dropped and read again.
 */
/** `enabled` holds the first read until the address is known, so it reads the right filter. */
function useLooksFeed(owner: string | null, filter: LooksFilter, enabled: boolean) {
  const { attempt: sessionAttempt, missed } = useRetryOnVerifiedSession()
  const [attempt, setAttempt] = useState(0)
  const hydrating = useHydrating()
  const startFor = (forFilter: LooksFilter): FeedState => {
    const snapshot =
      hydrating || !owner
        ? undefined
        : screenSnapshot.recall<Sources>(
            currentWebSessionScope(),
            'looks',
            snapshotPart(forFilter)
          )
    return snapshot
      ? { ...snapshot, error: null, settled: true }
      : { ...initialSources(forFilter), error: null, settled: false }
  }
  const [state, setState] = useState<FeedState>(() => startFor(filter))
  const [loadingMore, setLoadingMore] = useState(false)
  // TEA T1: a filter change starts from that filter's snapshot or nothing, in the same render,
  // so the previous filter's tiles never show under the new one.
  const [stateFilter, setStateFilter] = useState(filter)
  if (stateFilter !== filter) {
    setStateFilter(filter)
    setState(startFor(filter))
    setLoadingMore(false)
  }
  const epochRef = useRef(0)
  const userIdRef = useRef<string | null>(null)
  const stateRef = useRef(state)
  stateRef.current = state

  const readSource = useCallback(
    async (
      kind: 'looks' | 'capsules',
      offset: number,
      signal: AbortSignal
    ): Promise<{
      items: (SavedLookContract | OutfitCapsuleContract)[]
      total: number
    }> => {
      if (kind === 'looks') {
        const page = await listSavedLooksPageFromWeb({
          owner,
          sort: 'created_desc',
          source: filter === 'today' ? 'home_sample' : undefined,
          limit: PAGE_SIZE,
          offset,
          signal,
        })
        return { items: page.data, total: page.total }
      }
      userIdRef.current ??= await resolveCurrentUserId()
      const page = await listCapsulesFromWeb(
        userIdRef.current,
        { sort: 'created_desc', limit: PAGE_SIZE, offset },
        signal
      )
      return { items: page.items, total: page.total }
    },
    [owner, filter]
  )

  useEffect(() => {
    if (!enabled) return
    const epoch = ++epochRef.current
    setLoadingMore(false)
    if (!owner) {
      setState({ ...initialSources(filter), error: null, settled: true })
      return
    }
    const controller = new AbortController()
    const scope = currentWebSessionScope()
    const current = () =>
      !controller.signal.aborted &&
      epochRef.current === epoch &&
      currentWebSessionOwner() === owner
    // A refresh reads back at least as many items as each list shows (CC-7.11 review #12).
    const shown = stateRef.current
    const wanted = (kind: 'looks' | 'capsules') =>
      Math.max(PAGE_SIZE, shown[kind].items.length)
    const readAll = async (kind: 'looks' | 'capsules') => {
      const start = initialSources(filter)[kind]
      if (start.loaded) return start
      let items: (SavedLookContract | OutfitCapsuleContract)[] = []
      let total = 0
      do {
        const page = await readSource(kind, items.length, controller.signal)
        total = page.total
        const before = items.length
        items = appendUnique(items, page.items)
        if (items.length === before) break
      } while (items.length < Math.min(wanted(kind), total))
      return { items, total, loaded: true }
    }
    void Promise.all([readAll('looks'), readAll('capsules')])
      .then(([looks, capsules]) => {
        if (!current()) return
        if (scope !== currentWebSessionScope()) {
          setAttempt((count) => count + 1)
          return
        }
        const sources = { looks, capsules } as Sources
        setState({ ...sources, error: null, settled: true })
        screenSnapshot.remember(scope, 'looks', snapshotPart(filter), sources)
      })
      .catch((error: unknown) => {
        if (!current()) return
        setState((previous) => ({
          ...previous,
          error:
            error instanceof Error ? error.message : 'Unable to load your saved looks.',
          settled: true,
        }))
        missed()
      })
    return () => controller.abort()
  }, [owner, filter, enabled, attempt, sessionAttempt, missed, readSource])

  useEffect(() => {
    if (!owner) return
    return subscribeSavedLooksChanged((changedOwner) => {
      if (changedOwner === owner) setAttempt((count) => count + 1)
    })
  }, [owner])

  const view = useMemo(
    () => mergeLooksFeed(state.looks, state.capsules),
    [state.looks, state.capsules]
  )

  const loadMore = useCallback(() => {
    const next = view.next
    if (!owner || !next || loadingMore || !state.settled) return
    const kind = next === 'look' ? 'looks' : 'capsules'
    const epoch = epochRef.current
    const scope = currentWebSessionScope()
    const controller = new AbortController()
    setLoadingMore(true)
    void readSource(kind, stateRef.current[kind].items.length, controller.signal)
      .then((page) => {
        if (
          epochRef.current !== epoch ||
          currentWebSessionOwner() !== owner ||
          scope !== currentWebSessionScope()
        )
          return
        setState((previous) => {
          const updated = {
            ...previous,
            [kind]: {
              items: appendUnique(previous[kind].items as never[], page.items as never[]),
              total: page.total,
              loaded: true,
            },
          } as FeedState
          screenSnapshot.remember(scope, 'looks', snapshotPart(filter), {
            looks: updated.looks,
            capsules: updated.capsules,
          } satisfies Sources)
          return updated
        })
      })
      .catch(() => undefined)
      .finally(() => {
        if (epochRef.current === epoch) setLoadingMore(false)
      })
  }, [owner, view.next, loadingMore, state.settled, readSource, filter])

  return {
    ...state,
    entries: view.entries,
    hasMore: view.next !== null,
    /** The member has a saved look or capsule in this filter's lists (D1). */
    hasAny: state.looks.total + state.capsules.total > 0,
    loadingMore,
    loadMore,
    reload: () => setAttempt((count) => count + 1),
  }
}

/** Reports the address's segment and filter; `useSearchParams` needs its own Suspense. */
function LooksParamSync({
  onChange,
}: {
  onChange: (params: {
    segment: LooksSegment | null
    filter: LooksFilter
    legacy: boolean
  }) => void
}) {
  const params = useSearchParams()
  const segment = parseLooksSegment(params?.get('segment'))
  const filter = parseLooksFilter(params?.get('filter'))
  const filterGiven = params?.has('filter') ?? false
  const legacy = params?.has(LEGACY_PLANNER_QUERY) ?? false
  useEffect(
    // A filter in the address implies Saved (the capsules redirect always names both).
    () =>
      onChange({ segment: segment ?? (filterGiven ? 'saved' : null), filter, legacy }),
    [segment, filter, filterGiven, legacy, onChange]
  )
  return null
}

function SegmentControl({
  segment,
  onSelect,
}: {
  segment: LooksSegment
  onSelect: (segment: LooksSegment) => void
}) {
  const { t } = useTranslation()
  const refs = useRef<Record<LooksSegment, HTMLButtonElement | null>>({
    saved: null,
    ideas: null,
    plan: null,
  })
  // The ARIA tabs pattern: arrows, Home and End move and select.
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const index = LOOKS_SEGMENTS.indexOf(segment)
    const last = LOOKS_SEGMENTS.length - 1
    const target =
      event.key === 'ArrowRight'
        ? index === last
          ? 0
          : index + 1
        : event.key === 'ArrowLeft'
          ? index === 0
            ? last
            : index - 1
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : null
    if (target === null) return
    event.preventDefault()
    const next = LOOKS_SEGMENTS[target]!
    onSelect(next)
    refs.current[next]?.focus()
  }
  return (
    <div
      role="tablist"
      aria-label={t('looks.segments.label')}
      data-testid="looks-segments"
      className="grid grid-cols-3 gap-1 rounded-md bg-card-muted p-1"
    >
      {LOOKS_SEGMENTS.map((id) => {
        const selected = id === segment
        return (
          <button
            key={id}
            ref={(element) => {
              refs.current[id] = element
            }}
            type="button"
            role="tab"
            id={`looks-tab-${id}`}
            aria-selected={selected}
            aria-controls="looks-panel"
            tabIndex={selected ? 0 : -1}
            data-testid={`looks-segment-${id}`}
            onClick={() => onSelect(id)}
            onKeyDown={onKeyDown}
            // Selected: a raised surface, a heavier label and an underline, not color alone.
            className={`min-h-touch rounded-sm px-2 text-sm ${
              selected
                ? 'bg-card font-semibold text-ink underline decoration-2 underline-offset-4 shadow-card'
                : 'font-medium text-ink-soft'
            }`}
          >
            {t(`looks.segments.${id}`)}
          </button>
        )
      })}
    </div>
  )
}

function FilterChips({
  filter,
  onSelect,
}: {
  filter: LooksFilter
  onSelect: (filter: LooksFilter) => void
}) {
  const { t } = useTranslation()
  return (
    <div
      role="group"
      aria-label={t('looks.filters.label')}
      data-testid="looks-filters"
      className="flex gap-2"
    >
      {LOOKS_FILTERS.map((id) => {
        const pressed = id === filter
        return (
          <button
            key={id}
            type="button"
            aria-pressed={pressed}
            data-testid={`looks-filter-${id}`}
            onClick={() => onSelect(id)}
            className={`min-h-touch rounded-full border px-4 text-sm ${
              pressed
                ? 'border-ink bg-ink font-semibold text-page'
                : 'border-line-strong bg-page font-medium text-ink'
            }`}
          >
            {t(`looks.filters.${id}`)}
          </button>
        )
      })}
    </div>
  )
}

function SavedPanel({
  owner,
  filter,
  feed,
}: {
  owner: string | null
  filter: LooksFilter
  feed: ReturnType<typeof useLooksFeed>
}) {
  const { t } = useTranslation()
  // A visitor's Saved asks for an account and reads nothing (native matches).
  if (!owner) {
    return (
      <div data-testid="looks-first-content" className="space-y-3">
        <p className="text-base text-ink">{t('looks.detail.signIn')}</p>
        <Link
          href="/signin"
          data-testid="looks-sign-in"
          className="inline-flex min-h-touch items-center rounded-lg border border-line-strong bg-page px-4 text-sm font-semibold text-ink"
        >
          {t('looks.detail.signInAction')}
        </Link>
      </div>
    )
  }
  if (feed.error) {
    return (
      <div
        data-testid="looks-first-content"
        role="alert"
        className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-danger-line bg-danger-surface p-3 text-sm text-danger-ink"
      >
        <span>{t('savedLooks.loadFailed')}</span>
        <button
          type="button"
          data-testid="saved-looks-retry"
          onClick={feed.reload}
          className="min-h-touch px-2 font-semibold underline"
        >
          {t('savedLooks.retry')}
        </button>
      </div>
    )
  }
  const manage =
    filter === 'capsules' ? (
      <nav aria-label={t('looks.filters.capsules')} className="mt-4">
        <NavRow
          href="/looks/capsules"
          label={t('looks.manageCapsules')}
          testId="looks-manage-capsules"
          last
        />
      </nav>
    ) : null
  if (feed.entries.length === 0 && !feed.hasMore) {
    const line =
      filter === 'today'
        ? t('looks.filterEmpty.today')
        : filter === 'capsules'
          ? t('looks.filterEmpty.capsules')
          : t('looks.empty')
    return (
      <>
        <p data-testid="looks-first-content" className="text-base text-ink-muted">
          <span data-testid="looks-filter-empty">{line}</span>
        </p>
        {manage}
      </>
    )
  }
  return (
    <>
      <div data-testid="looks-first-content">
        <LooksTileGrid testId="looks-saved-grid">
          {feed.entries.map((entry) => (
            <li key={`${entry.kind}:${entry.id}`}>
              {entry.kind === 'look' ? (
                <SavedLookTile look={entry.item} href={savedLookHref(entry.id, filter)} />
              ) : (
                <CapsuleTile
                  capsule={entry.item}
                  href={`/looks/capsules?capsule=${encodeURIComponent(entry.id)}`}
                />
              )}
            </li>
          ))}
        </LooksTileGrid>
      </div>
      {feed.hasMore && (
        <button
          type="button"
          data-testid="saved-looks-load-more"
          disabled={feed.loadingMore}
          onClick={feed.loadMore}
          className="mt-4 min-h-touch w-full rounded-lg border border-line-strong bg-page px-3 text-sm font-semibold text-ink disabled:opacity-60"
        >
          {feed.loadingMore ? '…' : t('looks.loadMore')}
        </button>
      )}
      {manage}
    </>
  )
}

function IdeasPanel({ showEmptyLine }: { showEmptyLine: boolean }) {
  const { t } = useTranslation()
  const ideas = useMemo(() => looksIdeas(), [])
  return (
    <div data-testid="looks-first-content">
      {showEmptyLine && (
        <p data-testid="looks-ideas-empty-line" className="mb-3 text-base text-ink-muted">
          {t('looks.empty')}
        </p>
      )}
      <LooksTileGrid testId="looks-ideas-grid">
        {ideas.map((idea) => (
          <li key={idea.look.id}>
            <IdeaTile idea={idea} />
          </li>
        ))}
      </LooksTileGrid>
    </div>
  )
}

function LooksBody({ owner }: { owner: string | null }) {
  const { t } = useTranslation()
  const router = useRouter()
  const [address, setAddress] = useState<{
    segment: LooksSegment | null
    filter: LooksFilter
  } | null>(null)
  const onParams = useCallback(
    ({
      segment,
      filter,
      legacy,
    }: {
      segment: LooksSegment | null
      filter: LooksFilter
      legacy: boolean
    }) => {
      setAddress({ segment, filter })
      if (legacy) {
        const url = new URL(window.location.href)
        url.searchParams.delete(LEGACY_PLANNER_QUERY)
        router.replace(`${url.pathname}${url.search}${url.hash}`, { scroll: false })
      }
    },
    [router]
  )
  const filter = address?.filter ?? 'all'
  const feed = useLooksFeed(owner, filter, address !== null)
  // P1: the default segment is decided once per entry, after the first reads answer.
  const [defaultSegment, setDefaultSegment] = useState<LooksSegment | null>(null)
  useEffect(() => {
    if (defaultSegment || !address || address.segment) return
    if (!owner) {
      setDefaultSegment('ideas')
      return
    }
    if (!feed.settled) return
    setDefaultSegment(feed.error || feed.hasAny ? 'saved' : 'ideas')
  }, [defaultSegment, address, owner, feed.settled, feed.error, feed.hasAny])

  const segment = address?.segment ?? defaultSegment
  const ready = segment !== null && (segment !== 'saved' || feed.settled)
  const select = (next: { segment: LooksSegment; filter?: LooksFilter }) => {
    router.replace(looksHref(next.segment, next.filter ?? filter), { scroll: false })
  }

  return (
    <>
      <Suspense fallback={null}>
        <LooksParamSync onChange={onParams} />
      </Suspense>
      <ScreenGate screen="looks" ready={ready}>
        {segment && (
          <div className="space-y-4">
            <SegmentControl
              segment={segment}
              onSelect={(next) => select({ segment: next })}
            />
            <div
              id="looks-panel"
              role="tabpanel"
              aria-labelledby={`looks-tab-${segment}`}
              className="space-y-4"
            >
              {segment === 'saved' && (
                <>
                  <FilterChips
                    filter={filter}
                    onSelect={(next) => select({ segment: 'saved', filter: next })}
                  />
                  <SavedPanel owner={owner} filter={filter} feed={feed} />
                </>
              )}
              {segment === 'ideas' && (
                <IdeasPanel
                  // Codex #11: only an empty All says the member has saved nothing yet.
                  showEmptyLine={
                    !owner ||
                    (filter === 'all' && feed.settled && !feed.error && !feed.hasAny)
                  }
                />
              )}
              {segment === 'plan' && (
                <div data-testid="looks-first-content">
                  {/* The rail variant is ordinary page content; the Looks top bar carries the
                      title, so the rail's own heading row and X are hidden. */}
                  <PlannerRail isOpen variant="rail" hideHeader />
                </div>
              )}
            </div>
          </div>
        )}
        {!segment && <span className="sr-only">{t('nav.looks')}</span>}
      </ScreenGate>
    </>
  )
}

export function LooksScreen() {
  const owner = useWebSessionOwner()
  return (
    <I18nextProvider i18n={getI18n()}>
      <AppPage>
        <AppTopBar titleKey="nav.looks" />
        <main id="main-content" tabIndex={-1} className={APP_MAIN_NARROW_CLASS}>
          <LooksBody key={owner} owner={owner} />
        </main>
        <StickyBottomNav />
      </AppPage>
    </I18nextProvider>
  )
}
