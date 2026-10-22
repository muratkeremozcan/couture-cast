// Story 6.5 (R43): content that hides as unverified (D3) unmounts, which drops the feed
// list's scroll offset. When the same items return in the same scope, the list goes back
// to the offset the member left it at.
import { useCallback, useEffect, useRef, type RefObject } from 'react'
import type { FlatList, NativeScrollEvent, NativeSyntheticEvent } from 'react-native'

type HiddenFeed = { offset: number; scope: number; ids: readonly string[] }

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
  if (available && data.length) shownRef.current = data

  useEffect(() => {
    if (available || hiddenRef.current || offsetRef.current <= 0) return
    hiddenRef.current = {
      offset: offsetRef.current,
      scope: scope.current,
      ids: shownRef.current.map((item) => item.id),
    }
  }, [available, scope])

  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const offset = event.nativeEvent.contentOffset.y
    const hidden = hiddenRef.current
    if (!availableRef.current) return
    if (hidden) {
      // A restore finishes once the list reaches the offset; a clamped jump waits
      // for more rows to lay out.
      if (offset < hidden.offset - 1) return
      hiddenRef.current = null
    }
    offsetRef.current = offset
  }, [])

  const onScrollBeginDrag = useCallback(() => {
    // The member scrolls on their own, so a pending restore must not pull them back.
    if (availableRef.current) hiddenRef.current = null
  }, [])

  // Rows can lay out after the commit that brings them back, so a restore tries again
  // on every content size change until the list reports the offset.
  const restore = useCallback(() => {
    const hidden = hiddenRef.current
    const rows = dataRef.current
    if (!hidden || !availableRef.current || !rows.length) return
    const ids = new Set(rows.map((item) => item.id))
    if (hidden.scope !== scope.current || !hidden.ids.every((id) => ids.has(id))) {
      hiddenRef.current = null
      return
    }
    listRef.current?.scrollToOffset({ offset: hidden.offset, animated: false })
  }, [scope])

  const hasRows = data.length > 0
  useEffect(() => {
    if (available && hasRows) restore()
  }, [available, hasRows, restore])

  return { listRef, onScroll, onScrollBeginDrag, onContentSizeChange: restore }
}
