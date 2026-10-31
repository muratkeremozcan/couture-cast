// Learning path Step 44: Community city spotlight.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-44-community-city-spotlight
// Story 6.5 R43: the scroll restore after a required D3 hide gives the member back their
// offset only for the same scope and the same rows. These cases pin the branches the
// screen suite cannot reach, because the screen returns its own held rows unchanged.
import { act, renderHook } from '@testing-library/react'
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native'
import { describe, expect, it, vi } from 'vitest'
import { useCommunityScrollRestore } from './use-community-scroll-restore'

type Row = { id: string }
type Props = { available: boolean; data: readonly Row[] }

const rows = (...ids: string[]): Row[] => ids.map((id) => ({ id }))
const SHOWN = rows('post-a', 'post-b', 'post-c')

function scrolledTo(y: number) {
  return {
    nativeEvent: { contentOffset: { x: 0, y } },
  } as NativeSyntheticEvent<NativeScrollEvent>
}

/** Mounts the hook on a shown feed scrolled to 600, then hides it as unverified. */
function hiddenAt600() {
  const scope = { current: 1 }
  const scrollToOffset = vi.fn()
  const view = renderHook(
    ({ available, data }: Props) => useCommunityScrollRestore({ available, data, scope }),
    { initialProps: { available: true, data: SHOWN } }
  )
  // The hook hands this ref to the FlatList; the double records the restore.
  Object.assign(view.result.current.listRef, { current: { scrollToOffset } })
  act(() => view.result.current.onScroll(scrolledTo(600)))
  view.rerender({ available: false, data: [] })
  return { ...view, scope, scrollToOffset }
}

describe('useCommunityScrollRestore (Story 6.5 R43)', () => {
  it('6.5-R43-MOB-003 restores the hidden offset when the same rows return in the same scope', () => {
    const { rerender, scrollToOffset } = hiddenAt600()
    rerender({ available: true, data: SHOWN })
    expect(scrollToOffset).toHaveBeenCalledExactlyOnceWith({
      offset: 600,
      animated: false,
    })
  })

  it('6.5-R43-MOB-004 leaves the scroll alone when a hidden row does not return', () => {
    const { rerender, result, scrollToOffset } = hiddenAt600()
    rerender({ available: true, data: rows('post-b', 'post-c', 'post-d') })
    // A later layout pass cannot revive the dropped restore either.
    act(() => result.current.onContentSizeChange())
    expect(scrollToOffset).not.toHaveBeenCalled()
  })

  it('6.5-R43-MOB-005 leaves the scroll alone when the filter or session changed while hidden', () => {
    const { rerender, result, scope, scrollToOffset } = hiddenAt600()
    scope.current = 2
    rerender({ available: true, data: SHOWN })
    act(() => result.current.onContentSizeChange())
    expect(scrollToOffset).not.toHaveBeenCalled()
  })

  it('6.5-R43-MOB-006 a drag before the rows lay out cancels the pending restore', () => {
    const { rerender, result, scrollToOffset } = hiddenAt600()
    // Access returns before the rows do, and the member starts scrolling.
    rerender({ available: true, data: [] })
    act(() => result.current.onScrollBeginDrag())
    rerender({ available: true, data: SHOWN })
    act(() => result.current.onContentSizeChange())
    expect(scrollToOffset).not.toHaveBeenCalled()
  })
})
