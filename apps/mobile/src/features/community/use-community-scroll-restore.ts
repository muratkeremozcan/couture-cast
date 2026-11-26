// Story 6.5 (R43): content that hides as unverified (D3) unmounts, which drops the feed
// list's scroll offset. When the same items return in the same scope, the list goes back
// to the offset the member left it at. The list header (the City Spotlight) hides with the
// rows, so a feed with no rows restores the offset too: an app resume hides Community until
// access verifies again, and a member reading the Spotlight above an empty feed kept their
// place only when that hide did not happen.
import { useCallback, useEffect, useRef, type RefObject } from 'react'
import type { FlatList, NativeScrollEvent, NativeSyntheticEvent } from 'react-native'

type HiddenFeed = { offset: number; scope: number; ids: readonly string[] }

/**
 * How long a restore keeps trying once access is back. On Android (Fabric) the jump can run
 * before the returning rows are mounted, and the content size event can arrive before them
 * too, so no later event asks again (CC-7.9 CI on c9614d98: the Community list came back from
 * the in-app browser at the top with the Spotlight mounted).
 */
export const SCROLL_RESTORE_RETRY_MS = 2000

export function useCommunityScrollRestore<T extends { id: string }>({
  available,
  data,
  scope,
}: {
  /** Whether verified community content may show. */
  available: boolean
  /** The rows the list renders right now. */
  data: readonly T[]
  /** Advances whenever the feed's filter or session changes. */
  scope: RefObject<number>
}) {
  const listRef = useRef<FlatList<T>>(null)
  const offsetRef = useRef(0)
  const hiddenRef = useRef<HiddenFeed | null>(null)
  const shownRef = useRef<readonly T[]>(data)
  const availableRef = useRef(available)
  availableRef.current = available
  const dataRef = useRef(data)
  dataRef.current = data
  if (available) shownRef.current = data
  const retryFrameRef = useRef<number | null>(null)
  const retryUntilRef = useRef<number | null>(null)

  const stopRetrying = useCallback(() => {
    if (retryFrameRef.current !== null) cancelAnimationFrame(retryFrameRef.current)
    retryFrameRef.current = null
    retryUntilRef.current = null
  }, [])
  useEffect(() => stopRetrying, [stopRetrying])

  useEffect(() => {
    if (available || hiddenRef.current || offsetRef.current <= 0) return
    stopRetrying()
    hiddenRef.current = {
      offset: offsetRef.current,
      scope: scope.current,
      ids: shownRef.current.map((item) => item.id),
    }
  }, [available, scope, stopRetrying])

  const onScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const offset = event.nativeEvent.contentOffset.y
      const hidden = hiddenRef.current
      if (!availableRef.current) return
      if (hidden) {
        // A restore finishes once the list reaches the offset; a clamped jump waits
        // for more rows to lay out.
        if (offset < hidden.offset - 1) return
        hiddenRef.current = null
        stopRetrying()
      }
      offsetRef.current = offset
    },
    [stopRetrying]
  )

  const onScrollBeginDrag = useCallback(() => {
    // The member scrolls on their own, so a pending restore must not pull them back.
    if (!availableRef.current) return
    hiddenRef.current = null
    stopRetrying()
  }, [stopRetrying])

  // Rows can lay out after the commit that brings them back, so a restore tries again on
  // every content size change, and every frame for SCROLL_RESTORE_RETRY_MS, until the list
  // reports the offset.
  const restoreRef = useRef<() => void>(() => undefined)
  const restore = useCallback(() => {
    const hidden = hiddenRef.current
    const rows = dataRef.current
    if (!hidden || !availableRef.current) return
    // Rows hidden with the feed come back after access does; wait for them.
    if (hidden.ids.length && !rows.length) return
    const ids = new Set(rows.map((item) => item.id))
    if (hidden.scope !== scope.current || !hidden.ids.every((id) => ids.has(id))) {
      hiddenRef.current = null
      stopRetrying()
      return
    }
    listRef.current?.scrollToOffset({ offset: hidden.offset, animated: false })
    retryUntilRef.current ??= Date.now() + SCROLL_RESTORE_RETRY_MS
    if (retryFrameRef.current !== null || hiddenRef.current === null) return
    retryFrameRef.current = requestAnimationFrame(() => {
      retryFrameRef.current = null
      if (Date.now() <= (retryUntilRef.current ?? 0)) restoreRef.current()
    })
  }, [scope, stopRetrying])
  restoreRef.current = restore

  const hasRows = data.length > 0
  useEffect(() => {
    if (available) restore()
  }, [available, hasRows, restore])

  return { listRef, onScroll, onScrollBeginDrag, onContentSizeChange: restore }
}
