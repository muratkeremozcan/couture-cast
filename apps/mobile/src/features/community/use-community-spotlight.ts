// Story 6.6 owner: the mobile City Spotlight's paging and reaction state.
// Story 6.6 mobile state owner: paging, identity changes and eviction in `apps/mobile/src/features/community/use-community-spotlight.ts`
import type { CommunityReactionState } from '@couture/api-client'
import {
  CommunityPostTextLedger,
  reconcileCommunityPostText,
  type EditCommunityPostTextResponse,
  type CommunityBannedError,
  type CommunityReactionFeedItem,
  type CommunityReactionSpotlightItem,
  type CommunityReactionSummary,
  type CommunitySpotlightLevel,
} from '@couture/api-client/contracts/http'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  communityFailureReason,
  communitySanctionOf,
  getCommunityPostFromMobile,
  getCommunitySpotlightFromMobile,
} from '@/src/lib/community'
import type { LiveCommunitySponsorships } from './live-sponsorships'

/** `idle` while no member is signed in: the module hides and reads nothing. */
export type SpotlightStatus = 'idle' | 'loading' | 'ready' | 'disabled' | 'error'

/**
 * A one-shot request to move focus and announce once. View more names the first
 * card it appended and how many it added; a stale-cursor restart names the first
 * card of the fresh page one, or none when that page came back empty.
 */
export type SpotlightFocusRequest =
  | { kind: 'appended'; firstId: string; count: number; serial: number }
  | { kind: 'refreshed'; firstId: string | null; serial: number }
  /** Story 6.7: a Home teaser activation asked for this entry. */
  | { kind: 'targeted'; firstId: string; serial: number }

type SavedCommunityText = EditCommunityPostTextResponse['data']

export interface CommunitySpotlightView {
  status: SpotlightStatus
  level: CommunitySpotlightLevel
  label: string | null
  items: CommunityReactionSpotlightItem[]
  hasMore: boolean
  isLoadingMore: boolean
  /**
   * Story CC-7.7 D5: a page-one read is replacing the shown row in place. View more stays in
   * place but disabled until it lands, so it never pages from the cursor being replaced.
   */
  isReplacing: boolean
  loadMoreFailed: boolean
  focusRequest: SpotlightFocusRequest | null
  reload: () => void
  loadMore: () => void
  /** Mirrors the screen's reaction reconciliation for spotlight copies. */
  applyReactionChange: (
    postId: string,
    summary: CommunityReactionSummary | null | undefined
  ) => void
  /**
   * Replaces a spotlight copy with a newer read of the post, keeping its rank. A
   * read that is no longer `published` removes the copy: the single-post read
   * returns an author their own withdrawn or flagged post, and the spotlight
   * ranks public posts only. Story 6.7b: the copy takes the latest live
   * sponsorship answer for its post (see `live-sponsorships.ts`).
   */
  applyPost: (post: CommunityReactionFeedItem) => void
  applyText: (postId: string, text: SavedCommunityText) => void
  /** Removes a post the viewer can no longer see, such as a withdrawn or hidden one. */
  evict: (postId: string) => void
  /**
   * Re-reads one post for a fresh signed image URL and updates only its
   * spotlight copy, so every loaded page and the reader's place survive.
   */
  refreshItem: (postId: string) => void
  /**
   * Story 6.7: focuses one shown entry and announces it once. Returns false
   * when the entry is not shown, so the caller can report that instead.
   */
  focusEntry: (postId: string) => boolean
  /**
   * Retires a handled focus request, so a module that unmounts and mounts again
   * (an availability lapse and recovery) never replays it.
   */
  acknowledgeFocusRequest: (serial: number) => void
}

/** Same read refusals as the feed render the localized disabled state. */
function isDisabledRefusal(error: unknown): boolean {
  const reason = communityFailureReason(error)
  return reason === 'disabled' || reason === 'age_gate' || reason === 'banned'
}

/**
 * The posts of a page that are not shown yet. A later page can repeat a post an
 * earlier page carried, so counts, focus and the appended list all come from
 * this result alone.
 */
function newEntries(
  shown: readonly CommunityReactionSpotlightItem[],
  page: readonly CommunityReactionSpotlightItem[]
): CommunityReactionSpotlightItem[] {
  const seen = new Set(shown.map((item) => item.id))
  return page.filter((item) => {
    if (seen.has(item.id)) return false
    seen.add(item.id)
    return true
  })
}

export function useCommunitySpotlight({
  sessionScope,
  reactionState,
  sponsorships,
  postTextLedger,
  onBanned,
  onRefreshFailed,
  visiblePage,
}: {
  /** Story 6.11: a read refused for a ban closes the whole community screen, on any page. */
  onBanned?: (sanction: CommunityBannedError['sanction']) => void
  /**
   * Story CC-7.7: a refresh in place failed and the row kept its cards. The screen reports it
   * in a slot that moves no content; the row itself never inserts an error above the feed.
   */
  onRefreshFailed?: (retry: () => void) => void
  /** Selects visible paging feedback without dropping ranked reads or their cursor. */
  visiblePage?: (
    items: CommunityReactionSpotlightItem[],
    append: boolean
  ) => CommunityReactionSpotlightItem[]
  /** Undefined until the screen first resolves the member; null when signed out. */
  sessionScope: string | null | undefined
  reactionState: CommunityReactionState
  /** Story 6.7b: the screen's live sponsorship answers, shared with the feed. */
  sponsorships: LiveCommunitySponsorships
  /** Shared per-viewer post text reconciliation ledger across feed and Spotlight. */
  postTextLedger?: CommunityPostTextLedger
}): CommunitySpotlightView {
  const [fallbackTextLedger] = useState(() => new CommunityPostTextLedger())
  const textLedger = postTextLedger ?? fallbackTextLedger
  const [status, setStatus] = useState<SpotlightStatus>('loading')
  const statusRef = useRef(status)
  statusRef.current = status
  const [level, setLevel] = useState<CommunitySpotlightLevel>('none')
  const [label, setLabel] = useState<string | null>(null)
  const [items, setItems] = useState<CommunityReactionSpotlightItem[]>([])
  const [nextCursor, setNextCursorState] = useState<string | null>(null)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [loadMoreFailed, setLoadMoreFailed] = useState(false)
  const onBannedRef = useRef(onBanned)
  onBannedRef.current = onBanned
  const onRefreshFailedRef = useRef(onRefreshFailed)
  onRefreshFailedRef.current = onRefreshFailed
  const visiblePageRef = useRef(visiblePage)
  visiblePageRef.current = visiblePage
  const [focusRequest, setFocusRequest] = useState<SpotlightFocusRequest | null>(null)
  // A page settles after later renders, so it compares against the cards shown now.
  const itemsRef = useRef(items)
  itemsRef.current = items
  // The rendered View more can act on a render whose cursor an arriving page has
  // already consumed, so the latest cursor is read through a ref.
  const nextCursorRef = useRef<string | null>(null)
  const generationRef = useRef(0)
  const controllerRef = useRef<AbortController | null>(null)
  const loadingMoreRef = useRef(false)
  // Story CC-7.7 D5: true while a page-one read replaces the shown row in place. View more
  // would page from the cursor that read is about to replace, so it waits until the row lands.
  const replacingRef = useRef(false)
  const [isReplacing, setIsReplacingState] = useState(false)
  const setReplacing = useCallback((value: boolean) => {
    replacingRef.current = value
    setIsReplacingState(value)
  }, [])
  const focusSerialRef = useRef(0)
  // The refresh-failure Retry runs after later renders; it reads with the latest reload.
  const reloadRef = useRef<() => void>(() => undefined)
  // Single-post image refreshes run beside paging, so a View more never cancels
  // one. A session change or unmount aborts them all.
  const itemRefreshesRef = useRef(new Map<string, AbortController>())

  const setNextCursor = useCallback((value: string | null) => {
    nextCursorRef.current = value
    setNextCursorState(value)
  }, [])

  const readItems = useCallback(
    (incoming: CommunityReactionSpotlightItem[], ticket: number) =>
      incoming.flatMap((item) => {
        const current = reactionState.read(item, ticket)
        return current ? [{ ...current, rank: item.rank }] : []
      }),
    [reactionState]
  )

  const begin = useCallback(() => {
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    const generation = generationRef.current + 1
    generationRef.current = generation
    return {
      controller,
      isCurrent: () => !controller.signal.aborted && generation === generationRef.current,
    }
  }, [])

  const load = useCallback(
    async (restarted = false, inPlace = false) => {
      const ticket = reactionState.beginRead()
      const textStamp = textLedger.begin()
      const { controller, isCurrent } = begin()
      loadingMoreRef.current = false
      setReplacing(inPlace)
      setIsLoadingMore(false)
      setLoadMoreFailed(false)
      // Story CC-7.7 D5: a pull to refresh or a location change over a shown row refreshes in
      // place. The row never collapses into the loading line, so the feed below stays put.
      if (!inPlace) setStatus('loading')
      try {
        const stamp = sponsorships.begin()
        const page = await getCommunitySpotlightFromMobile({ signal: controller.signal })
        if (!isCurrent()) return
        sponsorships.record(page.items, stamp)
        const shown = newEntries([], readItems(page.items, ticket))
        setLevel(page.level)
        setLabel(page.label)
        // Normalized as the state commits: a page whose read started before the
        // latest recorded answer (say a newer feed read) never shows its own
        // block, and takes a newer block it lacked.
        setItems((previous) => {
          const previousById = new Map(previous.map((item) => [item.id, item]))
          return shown.map((item) =>
            textLedger.reconcile(
              sponsorships.apply(item),
              textStamp,
              previousById.get(item.id)
            )
          )
        })
        setNextCursor(page.nextCursor)
        if (restarted) {
          const visible = visiblePageRef.current?.(shown, false) ?? shown
          focusSerialRef.current += 1
          setFocusRequest({
            kind: 'refreshed',
            firstId: visible[0]?.id ?? null,
            serial: focusSerialRef.current,
          })
        } else {
          setFocusRequest(null)
        }
        setStatus('ready')
      } catch (error: unknown) {
        if (!isCurrent()) return
        const sanction = communitySanctionOf(error)
        // A failed refresh keeps the row on screen; a ban or a disabled Spotlight still closes it.
        if (inPlace && !sanction && !isDisabledRefusal(error)) {
          onRefreshFailedRef.current?.(() => reloadRef.current())
          return
        }
        setItems([])
        setNextCursor(null)
        setFocusRequest(null)
        if (sanction) onBannedRef.current?.(sanction)
        setStatus(isDisabledRefusal(error) ? 'disabled' : 'error')
      } finally {
        if (isCurrent()) setReplacing(false)
      }
    },
    [
      begin,
      reactionState,
      readItems,
      setNextCursor,
      setReplacing,
      sponsorships,
      textLedger,
    ]
  )

  // Pull to refresh and Retry read page one only for a signed-in member.
  const sessionScopeRef = useRef(sessionScope)
  sessionScopeRef.current = sessionScope
  const reload = useCallback(() => {
    if (sessionScopeRef.current) void load(false, statusRef.current === 'ready')
  }, [load])
  reloadRef.current = reload

  const loadMore = useCallback(() => {
    const cursor = nextCursorRef.current
    if (!cursor || loadingMoreRef.current || replacingRef.current) return
    loadingMoreRef.current = true
    const ticket = reactionState.beginRead()
    const textStamp = textLedger.begin()
    const { controller, isCurrent } = begin()
    setIsLoadingMore(true)
    setLoadMoreFailed(false)
    const stamp = sponsorships.begin()
    void getCommunitySpotlightFromMobile({ cursor, signal: controller.signal })
      .then((page) => {
        if (!isCurrent()) return
        sponsorships.record(page.items, stamp)
        const added = newEntries(itemsRef.current, readItems(page.items, ticket))
        setItems((previous) => {
          const previousById = new Map(previous.map((item) => [item.id, item]))
          return [
            ...previous,
            ...newEntries(previous, added).map((item) =>
              textLedger.reconcile(
                sponsorships.apply(item),
                textStamp,
                previousById.get(item.id)
              )
            ),
          ]
        })
        // View more stays for the cursor this page returned.
        setNextCursor(page.nextCursor)
        // A page whose posts were all filtered or already shown changes nothing
        // the reader can hear, so it moves no focus and stays silent.
        const visible = visiblePageRef.current?.(added, true) ?? added
        const first = visible[0]
        if (first) {
          focusSerialRef.current += 1
          setFocusRequest({
            kind: 'appended',
            firstId: first.id,
            count: visible.length,
            serial: focusSerialRef.current,
          })
        }
      })
      .catch((error: unknown) => {
        if (!isCurrent()) return
        // A stale cursor is ordinary: the snapshot it names expired or the
        // viewer's area moved. The contract's remedy is to restart from page one,
        // which then takes focus and announces the refresh.
        if (communityFailureReason(error) === 'cursor_invalid') {
          void load(true)
          return
        }
        const sanction = communitySanctionOf(error)
        if (sanction) {
          onBannedRef.current?.(sanction)
          setStatus('disabled')
          return
        }
        setLoadMoreFailed(true)
      })
      .finally(() => {
        if (!isCurrent()) return
        loadingMoreRef.current = false
        setIsLoadingMore(false)
      })
  }, [begin, load, reactionState, readItems, setNextCursor, sponsorships, textLedger])

  const abortItemRefreshes = useCallback(() => {
    for (const controller of itemRefreshesRef.current.values()) controller.abort()
    itemRefreshesRef.current.clear()
  }, [])

  // Page one loads once the screen resolves a member, and again on every member
  // change, including a sign-in after the screen mounted. Each change first drops
  // the previous member's cards; without a member the module idles and reads
  // nothing, like web.
  useEffect(() => {
    if (sessionScope === undefined) return
    abortItemRefreshes()
    if (!postTextLedger) fallbackTextLedger.clear()
    setLevel('none')
    setLabel(null)
    setItems([])
    setNextCursor(null)
    setFocusRequest(null)
    if (sessionScope !== null) {
      void load()
      return
    }
    controllerRef.current?.abort()
    generationRef.current += 1
    loadingMoreRef.current = false
    setReplacing(false)
    setIsLoadingMore(false)
    setLoadMoreFailed(false)
    setStatus('idle')
  }, [
    abortItemRefreshes,
    fallbackTextLedger,
    load,
    postTextLedger,
    sessionScope,
    setNextCursor,
    setReplacing,
  ])
  useEffect(
    () => () => {
      controllerRef.current?.abort()
      abortItemRefreshes()
    },
    [abortItemRefreshes]
  )

  const applyReactionChange = useCallback(
    (postId: string, summary: CommunityReactionSummary | null | undefined) => {
      setItems((previous) =>
        previous.flatMap((post) => {
          if (post.id !== postId) return [post]
          if (summary === null) return []
          if (summary === undefined) return [{ ...post, reactions: undefined }]
          if (
            post.reactions &&
            (post.reactions.revision > summary.revision ||
              post.reactions.generation > summary.generation)
          )
            return [post]
          return [{ ...post, reactions: summary }]
        })
      )
    },
    []
  )

  const applyPost = useCallback(
    (post: CommunityReactionFeedItem, readStartClock?: number) => {
      if (post.status !== 'published') {
        textLedger.evict(post.id)
      } else if (readStartClock === undefined) {
        textLedger.record(post)
      }
      setItems((previous) => {
        if (!previous.some((item) => item.id === post.id)) return previous
        if (post.status !== 'published')
          return previous.filter((item) => item.id !== post.id)
        return previous.map((item) =>
          item.id === post.id
            ? {
                ...(readStartClock !== undefined
                  ? textLedger.reconcile(sponsorships.apply(post), readStartClock, item)
                  : reconcileCommunityPostText(sponsorships.apply(post), item)),
                rank: item.rank,
              }
            : item
        )
      })
    },
    [sponsorships, textLedger]
  )

  const applyText = useCallback(
    (postId: string, text: SavedCommunityText) => {
      textLedger.record({ id: postId, ...text, status: 'published' })
      setItems((previous) =>
        previous.map((item) =>
          item.id === postId && (item.textRevision ?? 0) <= text.textRevision
            ? { ...item, ...text }
            : item
        )
      )
    },
    [textLedger]
  )

  // A live read anywhere on the screen (feed, single post, this module) is the
  // latest word on a post's block, for every spotlight copy of it.
  useEffect(
    () =>
      sponsorships.subscribe(() => {
        setItems((previous) => sponsorships.applyAll(previous))
      }),
    [sponsorships]
  )

  const evict = useCallback(
    (postId: string) => {
      textLedger.evict(postId)
      setItems((previous) =>
        previous.some((item) => item.id === postId)
          ? previous.filter((item) => item.id !== postId)
          : previous
      )
    },
    [textLedger]
  )

  const refreshItem = useCallback(
    (postId: string) => {
      const refreshes = itemRefreshesRef.current
      if (refreshes.has(postId) || !itemsRef.current.some((item) => item.id === postId))
        return
      const controller = new AbortController()
      refreshes.set(postId, controller)
      const ticket = reactionState.beginRead()
      const textStamp = textLedger.begin()
      const stamp = sponsorships.begin()
      void getCommunityPostFromMobile(postId, controller.signal)
        .then((post) => {
          if (controller.signal.aborted) return
          sponsorships.record([post], stamp)
          // A null read means the post left the community while this was in flight.
          const fresh = reactionState.read(post, ticket)
          if (fresh) applyPost(fresh, textStamp)
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return
          if (communityFailureReason(error) === 'not_found') evict(postId)
        })
        .finally(() => {
          if (refreshes.get(postId) === controller) refreshes.delete(postId)
        })
    },
    [applyPost, evict, reactionState, sponsorships, textLedger]
  )

  const focusEntry = useCallback((postId: string) => {
    if (!itemsRef.current.some((item) => item.id === postId)) return false
    focusSerialRef.current += 1
    setFocusRequest({ kind: 'targeted', firstId: postId, serial: focusSerialRef.current })
    return true
  }, [])

  const acknowledgeFocusRequest = useCallback((serial: number) => {
    setFocusRequest((current) => (current?.serial === serial ? null : current))
  }, [])

  return {
    status,
    level,
    label,
    items,
    hasMore: nextCursor !== null,
    isLoadingMore,
    isReplacing,
    loadMoreFailed,
    focusRequest,
    reload,
    loadMore,
    applyReactionChange,
    applyPost,
    applyText,
    evict,
    refreshItem,
    focusEntry,
    acknowledgeFocusRequest,
  }
}
