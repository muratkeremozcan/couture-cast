// Ranked Community reads, paging, and focus.
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
  /** Visible candidates for paging feedback. The ranked read and cursor remain intact. */
  visiblePage?: (
    items: CommunitySpotlightItem[],
    append: boolean
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
  visiblePage,
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
  const visiblePageRef = useRef(visiblePage)
  visiblePageRef.current = visiblePage
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
              // The cursor of the pages the row showed stays; a row restored without one takes
              // the fresh page's (CodeRabbit on PR 292).
              nextCursor: previous.nextCursor ?? page.nextCursor,
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
            focusTargetId: restarted
              ? ((visiblePageRef.current?.(merged, false) ?? merged)[0]?.id ?? null)
              : null,
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
      const visible = visiblePageRef.current?.(added, true) ?? added
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
          focusTargetId: visible[0]?.id ?? null,
        }
      })
      // A page whose posts were all filtered or already shown changes nothing
      // the reader can hear, so it stays silent and View more stays for the
      // cursor it returned.
      if (visible.length > 0)
        announceRef.current({
          key: 'community.spotlight.announceLoadedMore',
          params: { count: visible.length },
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

interface CommunitySpotlightPagingProps {
  state: CommunitySpotlightState
  t: Translate
  onLoadMore: () => void
  onRetry: () => void
  onFocused: () => void
}

function focusSpotlightCard(postId: string) {
  const card = document.getElementById(spotlightCardElementId(postId))
  if (!card) return
  card.focus({ preventScroll: true })
  if (typeof card.scrollIntoView === 'function')
    card.scrollIntoView({ inline: 'start', block: 'nearest' })
}

export function CommunitySpotlightPaging({
  state,
  t,
  onLoadMore,
  onRetry,
  onFocused,
}: CommunitySpotlightPagingProps) {
  useEffect(() => {
    if (!state.focusTargetId) return
    focusSpotlightCard(state.focusTargetId)
    onFocused()
  }, [state.focusTargetId, onFocused])

  if (state.status === 'error') {
    return (
      <div
        role="alert"
        data-testid="community-spotlight-error"
        className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-merlot-ink bg-card p-4 text-sm text-merlot-ink"
      >
        <span>{t('community.spotlight.error')}</span>
        <button
          type="button"
          data-testid="community-spotlight-retry-button"
          onClick={onRetry}
          className="min-h-11 rounded-md border border-line-strong bg-page px-3 py-1 font-semibold text-ink"
        >
          {t('community.spotlight.retry')}
        </button>
      </div>
    )
  }
  if (state.nextCursor === null) return null

  return (
    <div className="flex flex-wrap items-center justify-center gap-2">
      {state.moreFailed && (
        <p
          role="alert"
          data-testid="community-spotlight-more-error"
          className="text-xs text-merlot-ink"
        >
          {t('community.spotlight.error')}
        </p>
      )}
      <button
        type="button"
        data-testid="community-spotlight-view-more"
        disabled={state.loadingMore || state.status === 'loading'}
        onClick={onLoadMore}
        className="min-h-11 rounded-full border border-line-strong bg-page px-4 py-2 text-sm font-semibold text-ink disabled:opacity-50"
      >
        {t(
          state.loadingMore
            ? 'community.spotlight.loadingMore'
            : state.moreFailed
              ? 'community.spotlight.retry'
              : 'community.spotlight.viewMore'
        )}
      </button>
    </div>
  )
}
