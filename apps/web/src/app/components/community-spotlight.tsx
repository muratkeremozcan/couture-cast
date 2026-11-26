// Story 6.6 web owner: the module, View more, focus and announcements in `apps/web/src/app/components/community-spotlight.tsx`
// Story 6.6 owner: the web City Spotlight module that heads the community
// section on `/`.
//
// The grid owns the cards, the detail dialog, the reaction state and the one
// polite live region; this file owns the spotlight's own paging and states. Two
// things about that split are load-bearing:
//
// - **Cards come from the grid.** `renderCard` hands every ranked post back to
//   the grid's own `LookbookCard`, so a spotlight card and a feed card share
//   one reaction coordinator, one detail dialog and one set of affordances.
// - **Announcements go through the grid's live region.** A second live region
//   here would make a screen reader hear competing updates, so View more hands
//   its one announcement to `announce`.
'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  reconcileCommunityPostText,
  type CommunityBannedError,
  type CommunitySponsoredFeedItem as CommunityFeedItem,
  type CommunitySponsoredSpotlightItem as CommunitySpotlightItem,
  type CommunitySpotlightLevel,
} from '@couture/api-client/contracts/http'
import {
  communityFailureReason,
  communitySanctionOf,
  getCommunityPostFromWeb,
  getCommunitySpotlightFromWeb,
} from '../../lib/community'

const MERLOT = '#7A1F2D'
/** Merlot as text or a border: globals.css gives it a dark-mode value that reads on the dark surface. */
const MERLOT_INK = 'var(--lookbook-merlot-ink)'

type Translate = (key: string, options?: Record<string, unknown>) => string

export type CommunitySpotlightStatus = 'idle' | 'loading' | 'ready' | 'disabled' | 'error'

export interface CommunitySpotlightState {
  status: CommunitySpotlightStatus
  level: CommunitySpotlightLevel
  label: string | null
  items: CommunitySpotlightItem[]
  nextCursor: string | null
  loadingMore: boolean
  moreFailed: boolean
  /** The first card a View more appended; focus moves there once, then clears. */
  focusTargetId: string | null
}

export interface SpotlightAnnouncement {
  key: string
  params?: Record<string, unknown>
}

/** The DOM id of a spotlight card, matching `LookbookCard` under the spotlight scope. */
export const SPOTLIGHT_CARD_SCOPE = 'spotlight-'
export function spotlightCardElementId(postId: string): string {
  return `${SPOTLIGHT_CARD_SCOPE}lookbook-card-${postId}`
}

const IDLE: CommunitySpotlightState = {
  status: 'idle',
  level: 'none',
  label: null,
  items: [],
  nextCursor: null,
  loadingMore: false,
  moreFailed: false,
  focusTargetId: null,
}

type PostUpdate = (post: CommunityFeedItem | null) => CommunityFeedItem | null

export interface UseCommunitySpotlightOptions<Token = number> {
  /** Story 6.11: a read refused for a ban closes the whole community surface, on any page. */
  onBanned?: (sanction: CommunityBannedError['sanction']) => void
  /** The session identity. Null keeps the module idle; a change reloads page one. */
  scope: string | null
  /**
   * Starts one read and returns its token. The hook takes it before each
   * request, so state that changes while the request is in flight (a reaction
   * eviction, a newer sponsorship answer) outranks its response. The token
   * lives only as long as that request: the hook hands it back to `reconcile`
   * with the page, and on a failed, aborted or superseded read it is simply
   * dropped, so the caller never keeps per-read bookkeeping.
   */
  beginRead: () => Token
  /** Runs an arrived page through the grid's state under its read's token. */
  reconcile: (
    items: readonly CommunitySpotlightItem[],
    token: Token
  ) => CommunitySpotlightItem[]
  announce: (message: SpotlightAnnouncement) => void
  /**
   * Story CC-7.7 D5: the state a return to the tab starts from (its last settled spotlight for
   * this member). The first read then refreshes it in place.
   */
  initial?: CommunitySpotlightState
}

/**
 * The posts of a page that are not shown yet. A later page can repeat a post an
 * earlier page carried, so counts, focus and the appended list all come from
 * this result alone.
 */
function newEntries(
  shown: readonly CommunitySpotlightItem[],
  page: readonly CommunitySpotlightItem[]
): CommunitySpotlightItem[] {
  const seen = new Set(shown.map((item) => item.id))
  return page.filter((item) => {
    if (seen.has(item.id)) return false
    seen.add(item.id)
    return true
  })
}

/** Same read refusals as the feed render the localized disabled state, like mobile. */
function isDisabledRefusal(error: unknown): boolean {
  const reason = communityFailureReason(error)
  return reason === 'disabled' || reason === 'age_gate' || reason === 'banned'
}

const bannedSanctionOf = (error: unknown) =>
  communityFailureReason(error) === 'banned' ? communitySanctionOf(error) : null

export function useCommunitySpotlight<Token = number>({
  scope,
  onBanned,
  beginRead,
  reconcile,
  announce,
  initial,
}: UseCommunitySpotlightOptions<Token>) {
  const [state, setState] = useState<CommunitySpotlightState>(initial ?? IDLE)
  const stateRef = useRef(state)
  stateRef.current = state
  const beginReadRef = useRef(beginRead)
  beginReadRef.current = beginRead
  const reconcileRef = useRef(reconcile)
  reconcileRef.current = reconcile
  const announceRef = useRef(announce)
  announceRef.current = announce
  const onBannedRef = useRef(onBanned)
  onBannedRef.current = onBanned
  // A response for an abandoned request (a reset, a reload or a newer page)
  // is dropped rather than painted over newer state.
  const generationRef = useRef(0)
  const controllerRef = useRef<AbortController | null>(null)
  // Single-post image refreshes run beside paging, so a View more never cancels
  // one. A reset or unmount aborts them all.
  const itemControllersRef = useRef(new Set<AbortController>())
  const textClockRef = useRef(0)
  const textFenceRef = useRef(new Map<string, number>())
  /**
   * CC-7.7 D5: a return started from a remembered row, which may hold several pages. Its first
   * page-one read refreshes that row in place and keeps its cursor; a reset, a failed read or a
   * cursor restart ends it.
   */
  const restoringRef = useRef((initial?.items.length ?? 0) > 0)

  const preserveNewerText = useCallback(
    (
      incoming: CommunitySpotlightItem,
      existing: CommunitySpotlightItem | undefined,
      startClock: number
    ): CommunitySpotlightItem => {
      if (!existing) return incoming
      const reconciled = reconcileCommunityPostText(incoming, existing)
      if (
        reconciled.status === 'published' &&
        reconciled.textRevision === undefined &&
        (textFenceRef.current.get(incoming.id) ?? 0) > startClock
      ) {
        return {
          ...reconciled,
          title: existing.title,
          caption: existing.caption,
          textRevision: existing.textRevision,
        }
      }
      return reconciled
    },
    []
  )

  const begin = useCallback(() => {
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    const generation = ++generationRef.current
    return {
      signal: controller.signal,
      current: () => generation === generationRef.current && !controller.signal.aborted,
    }
  }, [])

  const loadFirstPage = useCallback(
    async (restarted = false) => {
      const request = begin()
      const startClock = textClockRef.current
      const inPlace =
        !restarted && restoringRef.current && stateRef.current.items.length > 0
      setState((previous) => ({
        ...previous,
        status: 'loading',
        loadingMore: false,
        moreFailed: false,
        focusTargetId: null,
      }))
      try {
        const ticket = beginReadRef.current()
        const page = await getCommunitySpotlightFromWeb({ signal: request.signal })
        if (!request.current()) return
        const items = reconcileRef.current(page.items, ticket)
        restoringRef.current = false
        setState((previous) => {
          const previousById = new Map(previous.items.map((item) => [item.id, item]))
          // CodeRabbit r2 #5: only a row for the same area is kept. A refresh that answers for
          // another level or label (the member moved) replaces it, cards and cursor alike.
          if (inPlace && previous.level === page.level && previous.label === page.label) {
            // The remembered row keeps every page it showed and its cursor: the looks on this
            // page take its answer where they are, and any new one joins at the end of the row.
            const pageById = new Map(items.map((item) => [item.id, item]))
            const kept = previous.items.map((item) => {
              const fresh = pageById.get(item.id)
              return fresh ? preserveNewerText(fresh, item, startClock) : item
            })
            return {
              ...previous,
              status: 'ready',
              level: page.level,
              label: page.label,
              items: [...kept, ...newEntries(previous.items, items)],
              loadingMore: false,
              moreFailed: false,
              focusTargetId: null,
            }
          }
          const merged = items.map((item) =>
            preserveNewerText(item, previousById.get(item.id), startClock)
          )
          return {
            status: 'ready',
            level: page.level,
            label: page.label,
            items: merged,
            nextCursor: page.nextCursor,
            loadingMore: false,
            moreFailed: false,
            focusTargetId: restarted ? (merged[0]?.id ?? null) : null,
          }
        })
        if (restarted)
          announceRef.current({ key: 'community.spotlight.announceRefreshed' })
      } catch (error: unknown) {
        if (!request.current()) return
        restoringRef.current = false
        const sanction = bannedSanctionOf(error)
        if (sanction) onBannedRef.current?.(sanction)
        setState({ ...IDLE, status: isDisabledRefusal(error) ? 'disabled' : 'error' })
      }
    },
    [begin, preserveNewerText]
  )

  const loadMore = useCallback(async () => {
    const { nextCursor, loadingMore, status } = stateRef.current
    // A page-one read still out (a return's in-place refresh) would be cancelled by this one.
    if (!nextCursor || loadingMore || status === 'loading') return
    const request = begin()
    const startClock = textClockRef.current
    setState((previous) => ({ ...previous, loadingMore: true, moreFailed: false }))
    try {
      const ticket = beginReadRef.current()
      const page = await getCommunitySpotlightFromWeb({
        cursor: nextCursor,
        signal: request.signal,
      })
      if (!request.current()) return
      const added = newEntries(
        stateRef.current.items,
        reconcileRef.current(page.items, ticket)
      )
      setState((current) => {
        const currentById = new Map(current.items.map((item) => [item.id, item]))
        const incoming = newEntries(current.items, added).map((item) =>
          preserveNewerText(item, currentById.get(item.id), startClock)
        )
        return {
          ...current,
          status: 'ready',
          level: page.level,
          label: page.label,
          items: [...current.items, ...incoming],
          nextCursor: page.nextCursor,
          loadingMore: false,
          focusTargetId: incoming[0]?.id ?? null,
        }
      })
      // A page whose posts were all filtered or already shown changes nothing
      // the reader can hear, so it stays silent and View more stays for the
      // cursor it returned.
      if (added.length > 0)
        announceRef.current({
          key: 'community.spotlight.announceLoadedMore',
          params: { count: added.length },
        })
    } catch (error: unknown) {
      if (!request.current()) return
      // The cursor is bound to the ranked snapshot and the viewer's area. When
      // either moved, the server refuses it and paging restarts from page one.
      if (communityFailureReason(error) === 'cursor_invalid') {
        await loadFirstPage(true)
        return
      }
      const sanction = bannedSanctionOf(error)
      if (sanction) {
        onBannedRef.current?.(sanction)
        setState({ ...IDLE, status: 'disabled' })
        return
      }
      setState((current) => ({ ...current, loadingMore: false, moreFailed: true }))
      announceRef.current({ key: 'community.spotlight.error' })
    }
  }, [begin, loadFirstPage, preserveNewerText])

  const abortItemRefreshes = useCallback(() => {
    for (const controller of itemControllersRef.current) controller.abort()
    itemControllersRef.current.clear()
  }, [])

  const reset = useCallback(() => {
    controllerRef.current?.abort()
    abortItemRefreshes()
    generationRef.current++
    restoringRef.current = false
    textClockRef.current++
    textFenceRef.current.clear()
    setState(IDLE)
  }, [abortItemRefreshes])

  /** Applies a reaction, realtime or eviction update from the grid to every spotlight copy. */
  const apply = useCallback((update: PostUpdate) => {
    setState((previous) => {
      if (previous.items.length === 0) return previous
      let changed = false
      const items = previous.items.flatMap((item) => {
        const next = update(item)
        if (next !== item) {
          changed = true
          if (
            next &&
            (next.title !== item.title ||
              next.caption !== item.caption ||
              next.textRevision !== item.textRevision)
          ) {
            textFenceRef.current.set(item.id, ++textClockRef.current)
          }
        }
        return next ? [{ ...next, rank: item.rank }] : []
      })
      return changed ? { ...previous, items } : previous
    })
  }, [])

  /**
   * Re-reads one post for a fresh signed image URL and updates only its
   * spotlight copy, keeping every loaded page, the rank and the reader's place.
   * A post the reader can no longer see, or one that is no longer published,
   * leaves the spotlight.
   */
  const refreshItem = useCallback(
    async (postId: string) => {
      const shown = stateRef.current.items.find((item) => item.id === postId)
      if (!shown) return
      const controller = new AbortController()
      itemControllersRef.current.add(controller)
      const startClock = textClockRef.current
      try {
        const ticket = beginReadRef.current()
        const post = await getCommunityPostFromWeb(postId, controller.signal)
        if (controller.signal.aborted) return
        // The single-post read returns an author their own post in any status.
        // The spotlight ranks published posts only, so any other status evicts
        // the copy. `apply` keeps the rank the copy was served at.
        const fresh =
          post.status === 'published'
            ? (reconcileRef.current([{ ...post, rank: shown.rank }], ticket)[0] ?? null)
            : null
        apply((item) =>
          item?.id === postId
            ? fresh
              ? preserveNewerText(fresh, item as CommunitySpotlightItem, startClock)
              : null
            : item
        )
      } catch (error: unknown) {
        if (controller.signal.aborted) return
        if (communityFailureReason(error) === 'not_found')
          apply((item) => (item?.id === postId ? null : item))
      } finally {
        itemControllersRef.current.delete(controller)
      }
    },
    [apply, preserveNewerText]
  )

  /**
   * Story 6.7: focuses one shown entry through the same one-shot focus target
   * View more uses. Returns false when the entry is not shown.
   */
  const focusEntry = useCallback((postId: string) => {
    if (!stateRef.current.items.some((item) => item.id === postId)) return false
    setState((previous) => ({ ...previous, focusTargetId: postId }))
    return true
  }, [])

  const clearFocusTarget = useCallback(() => {
    setState((previous) =>
      previous.focusTargetId === null ? previous : { ...previous, focusTargetId: null }
    )
  }, [])

  useEffect(() => {
    if (!scope) {
      reset()
      return
    }
    void loadFirstPage()
  }, [scope, loadFirstPage, reset])

  useEffect(
    () => () => {
      controllerRef.current?.abort()
      abortItemRefreshes()
    },
    [abortItemRefreshes]
  )

  return {
    state,
    loadMore,
    retry: loadFirstPage,
    reset,
    apply,
    refreshItem,
    clearFocusTarget,
    focusEntry,
  }
}

export interface CommunitySpotlightSectionProps {
  state: CommunitySpotlightState
  /** False while community access is unverified; the module hides with the feed, like mobile. */
  available: boolean
  /** The phone frame preview keeps the narrow card width at every viewport width. */
  isMobilePreview: boolean
  t: Translate
  onLoadMore: () => void
  onRetry: () => void
  onFocused: () => void
  renderCard: (item: CommunitySpotlightItem) => React.ReactNode
}

/**
 * Story 6.6 R42: the spotlight is one horizontal row, so the ranked cards add a
 * single card height above the feed. On a narrow column a card takes 85% of the
 * row and the next one peeks. From 768px it takes a fixed 240px, the width of
 * one feed column at 1440px, which shows two cards and part of a third in the
 * 600px community column at 1280px. The 1440px layout narrows that column to
 * about 500px beside the planner rail, so cards drop to 220px there and the
 * third still peeks. `cqw` resolves against the row (its `container-type`),
 * which keeps the width independent of the list element between the row and
 * its cards.
 */
function cardWidth(isMobilePreview: boolean): string {
  return isMobilePreview
    ? 'w-[85cqw]'
    : 'w-[85cqw] min-[768px]:w-[240px] min-[1440px]:w-[220px]'
}

/**
 * The row scrolls on its own axis, so the page never scrolls sideways. The
 * padding keeps a focused card's outline inside the clipped scroll box, and the
 * matching scroll padding keeps a snapped card clear of the edge.
 */
const ROW_CLASSES =
  'flex gap-4 p-1 [container-type:inline-size] snap-x snap-mandatory scroll-px-1 overflow-x-auto overscroll-x-contain'

/**
 * Moves focus to a card View more appended and scrolls it to the start of the
 * row: a card appended past the right edge would otherwise take focus out of
 * sight. jsdom implements no `scrollIntoView`.
 */
function focusSpotlightCard(postId: string) {
  const card = document.getElementById(spotlightCardElementId(postId))
  if (!card) return
  card.focus({ preventScroll: true })
  if (typeof card.scrollIntoView === 'function')
    card.scrollIntoView({ inline: 'start', block: 'nearest' })
}

function SpotlightStates({
  state,
  t,
  onRetry,
}: Pick<CommunitySpotlightSectionProps, 'state' | 't' | 'onRetry'>) {
  if (state.status === 'loading') {
    // Story CC-7.7: no skeleton. A skeleton that collapsed into the real row moved the feed below
    // it; the tab's screen gate now holds the whole body until this read settles, so the first
    // load never shows here, and a retry keeps the section's heading while it reads. The empty
    // marker stays for the tests and the section's `aria-busy`.
    return <div data-testid="community-spotlight-loading" aria-hidden="true" />
  }
  if (state.status === 'disabled') {
    return (
      <p
        data-testid="community-spotlight-disabled"
        className="rounded-[8px] border border-[color:var(--theme-card-border)] bg-[var(--theme-card-bg)] p-4 text-xs text-[color:var(--theme-card-text)]"
      >
        {t('community.spotlight.disabled')}
      </p>
    )
  }
  if (state.status === 'error') {
    return (
      <div
        data-testid="community-spotlight-error"
        style={{ color: MERLOT_INK, borderColor: MERLOT_INK }}
        className="flex items-center justify-between gap-3 rounded-[8px] border bg-[var(--theme-card-bg)] p-4 text-xs"
      >
        <span>{t('community.spotlight.error')}</span>
        <button
          type="button"
          data-testid="community-spotlight-retry-button"
          onClick={onRetry}
          style={{ backgroundColor: MERLOT }}
          className="min-h-[44px] rounded-md px-3 py-1 text-xs font-semibold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[color:var(--focus-essential)]"
        >
          {t('community.spotlight.retry')}
        </button>
      </div>
    )
  }
  return (
    <div
      data-testid="community-spotlight-empty"
      className="flex flex-col items-center justify-center rounded-[8px] border border-dashed border-[color:var(--theme-card-border)] bg-[var(--theme-card-bg)] p-8 text-center"
    >
      <p className="text-sm font-semibold text-[color:var(--theme-card-text)]">
        {t('community.spotlight.emptyTitle')}
      </p>
      <p className="mt-1 text-xs text-[color:var(--lookbook-ink-muted)]">
        {t('community.spotlight.emptyBody')}
      </p>
    </div>
  )
}

/**
 * View more, the trailing item of the row while any cursor remains. It sits
 * after the list element, so the list's item count and each card's position
 * cover the ranked looks alone.
 */
function SpotlightViewMore({
  state,
  t,
  onLoadMore,
}: Pick<CommunitySpotlightSectionProps, 'state' | 't' | 'onLoadMore'>) {
  if (state.nextCursor === null) return null
  return (
    <div className="flex shrink-0 snap-start items-center px-2">
      {/* CC-7.7 D5: a return's in-place refresh keeps the control in its slot, disabled until
          page one answered, so the row never changes shape while it refreshes. */}
      <button
        type="button"
        data-testid="community-spotlight-view-more"
        disabled={state.loadingMore || state.status === 'loading'}
        onClick={onLoadMore}
        className="min-h-[44px] whitespace-nowrap rounded-full border border-[color:var(--theme-secondary)] px-6 py-2 text-xs font-semibold uppercase tracking-wider text-[color:var(--theme-card-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[color:var(--focus-essential)] disabled:opacity-50"
      >
        {state.loadingMore
          ? t('community.spotlight.loadingMore')
          : t('community.spotlight.viewMore')}
      </button>
    </div>
  )
}

/**
 * The ranked looks and View more as one horizontal row, then the notice for a
 * page that failed to load.
 */
function SpotlightRow({
  state,
  isMobilePreview,
  t,
  onLoadMore,
  renderCard,
}: Pick<
  CommunitySpotlightSectionProps,
  'state' | 'isMobilePreview' | 't' | 'onLoadMore' | 'renderCard'
>) {
  const width = cardWidth(isMobilePreview)
  return (
    <>
      <div data-testid="community-spotlight-row" className={ROW_CLASSES}>
        {state.items.length > 0 && (
          <ol
            data-testid="community-spotlight-list"
            aria-labelledby="community-spotlight-heading"
            className="flex shrink-0 gap-4"
          >
            {state.items.map((item, index) => (
              <li
                key={item.id}
                data-testid={`community-spotlight-item-${item.id}`}
                data-rank={item.rank}
                // Position and count among the loaded looks. The rank can skip a
                // number the server filtered, so it stays in its own text.
                aria-posinset={index + 1}
                aria-setsize={state.items.length}
                className={`relative shrink-0 snap-start ${width}`}
              >
                <span className="sr-only">
                  {t('community.spotlight.rank', { rank: item.rank })}
                </span>
                <span
                  aria-hidden="true"
                  className="lookbook-metrics pointer-events-none absolute right-3 top-3 z-10 rounded-md bg-[#111111] px-2.5 py-1 text-[10px] font-semibold text-white shadow-sm"
                >
                  #{item.rank}
                </span>
                {renderCard(item)}
              </li>
            ))}
          </ol>
        )}
        <SpotlightViewMore state={state} t={t} onLoadMore={onLoadMore} />
      </div>

      {state.moreFailed && (
        <p
          data-testid="community-spotlight-more-error"
          style={{ color: MERLOT_INK }}
          className="text-center text-xs"
        >
          {t('community.spotlight.error')}
        </p>
      )}
    </>
  )
}

export function CommunitySpotlightSection({
  state,
  available,
  isMobilePreview,
  t,
  onLoadMore,
  onRetry,
  onFocused,
  renderCard,
}: CommunitySpotlightSectionProps) {
  useEffect(() => {
    if (!state.focusTargetId) return
    focusSpotlightCard(state.focusTargetId)
    onFocused()
  }, [state.focusTargetId, onFocused])

  if (state.status === 'idle' || !available) return null

  // A refresh of a shown row (a return to the tab, or a session recheck) keeps the row in place
  // while it reads, instead of collapsing it (CC-7.7 D5).
  const refreshing = state.status === 'loading' && state.items.length > 0
  const ready = state.status === 'ready' || refreshing
  const hasArea = ready && state.level !== 'none' && state.label
  // A page can arrive with every post filtered while ranks remain behind its
  // cursor. The empty state is for a spotlight with nothing left to show.
  const showEmpty = ready && state.items.length === 0 && state.nextCursor === null

  return (
    <section
      aria-labelledby="community-spotlight-heading"
      aria-busy={state.status === 'loading' || state.loadingMore}
      data-testid="community-spotlight"
      data-level={ready ? state.level : undefined}
      className="flex min-w-0 flex-col gap-4 border-b border-[color:var(--theme-card-border)] pb-6"
    >
      <div className="flex flex-col gap-1">
        <span className="lookbook-metrics text-xs uppercase tracking-widest text-[color:var(--theme-card-text)]">
          {t('community.spotlight.eyebrow')}
        </span>
        <h2
          id="community-spotlight-heading"
          data-testid="community-spotlight-heading"
          className="lookbook-display text-xl font-semibold text-[color:var(--theme-primary)]"
        >
          {hasArea
            ? t('community.spotlight.heading', { area: state.label })
            : t('community.spotlight.headingFallback')}
        </h2>
        <p className="text-xs text-[color:var(--theme-card-text)]">
          {t('community.spotlight.intro')}
        </p>
      </div>

      {ready && !showEmpty ? (
        <SpotlightRow
          state={state}
          isMobilePreview={isMobilePreview}
          t={t}
          onLoadMore={onLoadMore}
          renderCard={renderCard}
        />
      ) : (
        <SpotlightStates state={state} t={t} onRetry={onRetry} />
      )}
    </section>
  )
}
