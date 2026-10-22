// Story 6.6 owner: the mobile City Spotlight's paging and reaction state.
import type { CommunityReactionState } from '@couture/api-client'
import type {
  CommunityReactionSpotlightItem,
  CommunityReactionSummary,
  CommunitySpotlightLevel,
} from '@couture/api-client/contracts/http'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  communityFailureReason,
  getCommunitySpotlightFromMobile,
} from '@/src/lib/community'

export type SpotlightStatus = 'loading' | 'ready' | 'disabled' | 'error'

/** The first card a View more appended, so focus can move there exactly once. */
export interface SpotlightAppend {
  firstId: string
  count: number
  serial: number
}

export interface CommunitySpotlightView {
  status: SpotlightStatus
  level: CommunitySpotlightLevel
  label: string | null
  items: CommunityReactionSpotlightItem[]
  hasMore: boolean
  isLoadingMore: boolean
  loadMoreFailed: boolean
  lastAppend: SpotlightAppend | null
  reload: () => void
  loadMore: () => void
  /** Mirrors the screen's reaction reconciliation for spotlight copies. */
  applyReactionChange: (
    postId: string,
    summary: CommunityReactionSummary | null | undefined
  ) => void
}

/** Same read refusals as the feed render the localized disabled state. */
function isDisabledRefusal(error: unknown): boolean {
  const reason = communityFailureReason(error)
  return reason === 'disabled' || reason === 'age_gate'
}

export function useCommunitySpotlight({
  sessionScope,
  reactionState,
}: {
  sessionScope: string | null
  reactionState: CommunityReactionState
}): CommunitySpotlightView {
  const [status, setStatus] = useState<SpotlightStatus>('loading')
  const [level, setLevel] = useState<CommunitySpotlightLevel>('none')
  const [label, setLabel] = useState<string | null>(null)
  const [items, setItems] = useState<CommunityReactionSpotlightItem[]>([])
  const [nextCursor, setNextCursorState] = useState<string | null>(null)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [loadMoreFailed, setLoadMoreFailed] = useState(false)
  const [lastAppend, setLastAppend] = useState<SpotlightAppend | null>(null)
  // The rendered View more can act on a render whose cursor an arriving page has
  // already consumed, so the latest cursor is read through a ref.
  const nextCursorRef = useRef<string | null>(null)
  const generationRef = useRef(0)
  const controllerRef = useRef<AbortController | null>(null)
  const loadingMoreRef = useRef(false)
  const appendSerialRef = useRef(0)

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

  const load = useCallback(async () => {
    const ticket = reactionState.beginRead()
    const { controller, isCurrent } = begin()
    loadingMoreRef.current = false
    setIsLoadingMore(false)
    setLoadMoreFailed(false)
    setStatus('loading')
    try {
      const page = await getCommunitySpotlightFromMobile({ signal: controller.signal })
      if (!isCurrent()) return
      setLevel(page.level)
      setLabel(page.label)
      setItems(readItems(page.items, ticket))
      setNextCursor(page.nextCursor)
      setLastAppend(null)
      setStatus('ready')
    } catch (error: unknown) {
      if (!isCurrent()) return
      setItems([])
      setNextCursor(null)
      setStatus(isDisabledRefusal(error) ? 'disabled' : 'error')
    }
  }, [begin, reactionState, readItems, setNextCursor])

  const loadMore = useCallback(() => {
    const cursor = nextCursorRef.current
    if (!cursor || loadingMoreRef.current) return
    loadingMoreRef.current = true
    const ticket = reactionState.beginRead()
    const { controller, isCurrent } = begin()
    setIsLoadingMore(true)
    setLoadMoreFailed(false)
    void getCommunitySpotlightFromMobile({ cursor, signal: controller.signal })
      .then((page) => {
        if (!isCurrent()) return
        const fresh = readItems(page.items, ticket)
        setItems((previous) => {
          const seen = new Set(previous.map((item) => item.id))
          return [...previous, ...fresh.filter((item) => !seen.has(item.id))]
        })
        setNextCursor(page.nextCursor)
        const first = fresh[0]
        if (first) {
          appendSerialRef.current += 1
          setLastAppend({
            firstId: first.id,
            count: fresh.length,
            serial: appendSerialRef.current,
          })
        }
      })
      .catch((error: unknown) => {
        if (!isCurrent()) return
        // A stale cursor is ordinary: the snapshot it names expired or the
        // viewer's area moved. The contract's remedy is to restart from page one.
        if (communityFailureReason(error) === 'cursor_invalid') {
          void load()
          return
        }
        setLoadMoreFailed(true)
      })
      .finally(() => {
        if (!isCurrent()) return
        loadingMoreRef.current = false
        setIsLoadingMore(false)
      })
  }, [begin, load, reactionState, readItems, setNextCursor])

  // Page one loads on mount, like the feed, and again only when a known member
  // changes, so the first session resolution does not repeat the same read.
  const scopeRef = useRef<string | null | undefined>(undefined)
  useEffect(() => {
    const previous = scopeRef.current
    scopeRef.current = sessionScope
    if (previous === undefined || (previous !== null && previous !== sessionScope))
      void load()
  }, [load, sessionScope])
  useEffect(() => () => controllerRef.current?.abort(), [])

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

  return {
    status,
    level,
    label,
    items,
    hasMore: nextCursor !== null,
    isLoadingMore,
    loadMoreFailed,
    lastAppend,
    reload: () => {
      void load()
    },
    loadMore,
    applyReactionChange,
  }
}
