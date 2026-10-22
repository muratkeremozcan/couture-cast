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
import type {
  CommunityReactionFeedItem as CommunityFeedItem,
  CommunityReactionSpotlightItem as CommunitySpotlightItem,
  CommunitySpotlightLevel,
} from '@couture/api-client/contracts/http'
import {
  communityFailureReason,
  getCommunityPostFromWeb,
  getCommunitySpotlightFromWeb,
} from '../../lib/community'

const MERLOT = '#7A1F2D'

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

export interface UseCommunitySpotlightOptions {
  /** The session identity. Null keeps the module idle; a change reloads page one. */
  scope: string | null
  /** Runs every arriving page through the grid's reaction state. */
  reconcile: (items: readonly CommunitySpotlightItem[]) => CommunitySpotlightItem[]
  announce: (message: SpotlightAnnouncement) => void
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
  return reason === 'disabled' || reason === 'age_gate'
}

export function useCommunitySpotlight({
  scope,
  reconcile,
  announce,
}: UseCommunitySpotlightOptions) {
  const [state, setState] = useState<CommunitySpotlightState>(IDLE)
  const stateRef = useRef(state)
  stateRef.current = state
  const reconcileRef = useRef(reconcile)
  reconcileRef.current = reconcile
  const announceRef = useRef(announce)
  announceRef.current = announce
  // A response for an abandoned request (a reset, a reload or a newer page)
  // is dropped rather than painted over newer state.
  const generationRef = useRef(0)
  const controllerRef = useRef<AbortController | null>(null)
  // Single-post image refreshes run beside paging, so a View more never cancels
  // one. A reset or unmount aborts them all.
  const itemControllersRef = useRef(new Set<AbortController>())

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
      setState((previous) => ({
        ...previous,
        status: 'loading',
        loadingMore: false,
        moreFailed: false,
        focusTargetId: null,
      }))
      try {
        const page = await getCommunitySpotlightFromWeb({ signal: request.signal })
        if (!request.current()) return
        const items = reconcileRef.current(page.items)
        setState({
          status: 'ready',
          level: page.level,
          label: page.label,
          items,
          nextCursor: page.nextCursor,
          loadingMore: false,
          moreFailed: false,
          focusTargetId: restarted ? (items[0]?.id ?? null) : null,
        })
        if (restarted)
          announceRef.current({ key: 'community.spotlight.announceRefreshed' })
      } catch (error: unknown) {
        if (!request.current()) return
        setState({ ...IDLE, status: isDisabledRefusal(error) ? 'disabled' : 'error' })
      }
    },
    [begin]
  )

  const loadMore = useCallback(async () => {
    const { nextCursor, loadingMore } = stateRef.current
    if (!nextCursor || loadingMore) return
    const request = begin()
    setState((previous) => ({ ...previous, loadingMore: true, moreFailed: false }))
    try {
      const page = await getCommunitySpotlightFromWeb({
        cursor: nextCursor,
        signal: request.signal,
      })
      if (!request.current()) return
      const added = newEntries(stateRef.current.items, reconcileRef.current(page.items))
      setState((current) => ({
        ...current,
        status: 'ready',
        level: page.level,
        label: page.label,
        items: [...current.items, ...newEntries(current.items, added)],
        nextCursor: page.nextCursor,
        loadingMore: false,
        focusTargetId: added[0]?.id ?? null,
      }))
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
      setState((current) => ({ ...current, loadingMore: false, moreFailed: true }))
      announceRef.current({ key: 'community.spotlight.error' })
    }
  }, [begin, loadFirstPage])

  const abortItemRefreshes = useCallback(() => {
    for (const controller of itemControllersRef.current) controller.abort()
    itemControllersRef.current.clear()
  }, [])

  const reset = useCallback(() => {
    controllerRef.current?.abort()
    abortItemRefreshes()
    generationRef.current++
    setState(IDLE)
  }, [abortItemRefreshes])

  /** Applies a reaction, realtime or eviction update from the grid to every spotlight copy. */
  const apply = useCallback((update: PostUpdate) => {
    setState((previous) => {
      if (previous.items.length === 0) return previous
      let changed = false
      const items = previous.items.flatMap((item) => {
        const next = update(item)
        if (next !== item) changed = true
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
      try {
        const post = await getCommunityPostFromWeb(postId, controller.signal)
        if (controller.signal.aborted) return
        // The single-post read returns an author their own post in any status.
        // The spotlight ranks published posts only, so any other status evicts
        // the copy. `apply` keeps the rank the copy was served at.
        const fresh =
          post.status === 'published'
            ? (reconcileRef.current([{ ...post, rank: shown.rank }])[0] ?? null)
            : null
        apply((item) => (item?.id === postId ? fresh : item))
      } catch (error: unknown) {
        if (controller.signal.aborted) return
        if (communityFailureReason(error) === 'not_found')
          apply((item) => (item?.id === postId ? null : item))
      } finally {
        itemControllersRef.current.delete(controller)
      }
    },
    [apply]
  )

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
  }
}

export interface CommunitySpotlightSectionProps {
  state: CommunitySpotlightState
  /** False while community access is unverified; the module hides with the feed, like mobile. */
  available: boolean
  gridColumns: string
  t: Translate
  onLoadMore: () => void
  onRetry: () => void
  onFocused: () => void
  renderCard: (item: CommunitySpotlightItem) => React.ReactNode
}

function SpotlightStates({
  state,
  gridColumns,
  t,
  onRetry,
}: Pick<CommunitySpotlightSectionProps, 'state' | 'gridColumns' | 't' | 'onRetry'>) {
  if (state.status === 'loading') {
    // Decorative. The section carries `aria-busy`, and the grid's single live
    // region stays free for the feed's own loading announcement.
    return (
      <div
        data-testid="community-spotlight-loading"
        aria-hidden="true"
        className={`grid gap-6 ${gridColumns}`}
      >
        {[1, 2].map((n) => (
          <div
            key={n}
            className="h-72 animate-pulse rounded-[8px] border border-[color:var(--theme-card-border)] bg-[var(--theme-card-bg)]"
          />
        ))}
      </div>
    )
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
        style={{ color: MERLOT, borderColor: MERLOT }}
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
      <p className="mt-1 text-xs text-neutral-600">
        {t('community.spotlight.emptyBody')}
      </p>
    </div>
  )
}

/** A failed page's notice and View more, which stays while any cursor remains. */
function SpotlightPaging({
  state,
  t,
  onLoadMore,
}: Pick<CommunitySpotlightSectionProps, 'state' | 't' | 'onLoadMore'>) {
  return (
    <>
      {state.moreFailed && (
        <p
          data-testid="community-spotlight-more-error"
          style={{ color: MERLOT }}
          className="text-center text-xs"
        >
          {t('community.spotlight.error')}
        </p>
      )}

      {state.nextCursor !== null && (
        <div className="flex justify-center">
          <button
            type="button"
            data-testid="community-spotlight-view-more"
            disabled={state.loadingMore}
            onClick={onLoadMore}
            className="min-h-[44px] rounded-full border border-[color:var(--theme-secondary)] px-6 py-2 text-xs font-semibold uppercase tracking-wider text-[color:var(--theme-card-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[color:var(--focus-essential)] disabled:opacity-50"
          >
            {state.loadingMore
              ? t('community.spotlight.loadingMore')
              : t('community.spotlight.viewMore')}
          </button>
        </div>
      )}
    </>
  )
}

export function CommunitySpotlightSection({
  state,
  available,
  gridColumns,
  t,
  onLoadMore,
  onRetry,
  onFocused,
  renderCard,
}: CommunitySpotlightSectionProps) {
  useEffect(() => {
    if (!state.focusTargetId) return
    document.getElementById(spotlightCardElementId(state.focusTargetId))?.focus()
    onFocused()
  }, [state.focusTargetId, onFocused])

  if (state.status === 'idle' || !available) return null

  const ready = state.status === 'ready'
  const hasArea = ready && state.level !== 'none' && state.label
  const showList = ready && state.items.length > 0
  // A page can arrive with every post filtered while ranks remain behind its
  // cursor. The empty state is for a spotlight with nothing left to show.
  const showEmpty = ready && state.items.length === 0 && state.nextCursor === null

  return (
    <section
      aria-labelledby="community-spotlight-heading"
      aria-busy={state.status === 'loading' || state.loadingMore}
      data-testid="community-spotlight"
      data-level={ready ? state.level : undefined}
      className="flex flex-col gap-4 border-b border-[color:var(--theme-card-border)] pb-6"
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

      {showList && (
        <ol
          data-testid="community-spotlight-list"
          aria-labelledby="community-spotlight-heading"
          className={`grid gap-6 ${gridColumns}`}
        >
          {state.items.map((item) => (
            <li
              key={item.id}
              data-testid={`community-spotlight-item-${item.id}`}
              data-rank={item.rank}
              className="relative"
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

      {(!ready || showEmpty) && (
        <SpotlightStates
          state={state}
          gridColumns={gridColumns}
          t={t}
          onRetry={onRetry}
        />
      )}

      {ready && <SpotlightPaging state={state} t={t} onLoadMore={onLoadMore} />}
    </section>
  )
}
